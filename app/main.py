#!/usr/bin/env python3
"""
Flask backend API for book browsing application.
"""

import sys
from pathlib import Path

from dotenv import load_dotenv
import os

env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(env_path)

load_dotenv()
print(os.getenv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT"))

# Add the app directory to Python path to allow imports
app_dir = Path(__file__).parent
if str(app_dir) not in sys.path:
    sys.path.insert(0, str(app_dir))

from flask import Flask, jsonify, send_from_directory, request
from flask_cors import CORS
import pandas as pd
import json
import os
import re
import hashlib
import subprocess
import shutil
import uuid
import yaml
from werkzeug.utils import secure_filename
from datetime import datetime
import boto3
from botocore.exceptions import ClientError
from botocore.client import Config
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure, OperationFailure
from typing import Optional, Dict, Any
from pydantic import BaseModel
from mangum import Mangum

from run_queries import (
    run_query,  # Convenience function
)
import asyncio
import random

app = Flask(__name__)
CORS(app)
handler = Mangum(app)

# Base directory for GraphRAG projects
BASE_DIR = Path(__file__).parent

# Directory for uploaded books (for temporary storage before S3 upload)
UPLOAD_DIR = BASE_DIR / 'uploads'
UPLOAD_DIR.mkdir(exist_ok=True)

# Allowed file extensions
ALLOWED_EXTENSIONS = {'pdf', 'txt', 'doc', 'docx', 'epub'}

# S3 Configuration
S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME', 'instaprep-books')
S3_REGION = os.environ.get('S3_REGION', 'ap-south-1')  # Default to ap-south-1 to match bucket location
S3_FOLDER = os.environ.get('S3_FOLDER', 'books/')

# MongoDB Configuration
MONGODB_URI = os.environ.get('MONGODB_URI', '')
MONGODB_DB_NAME = os.environ.get('MONGODB_DB_NAME', 'instaprep')
MONGODB_COLLECTION_NAME = os.environ.get('MONGODB_COLLECTION_NAME', 'books')
MONGODB_COURSES_COLLECTION_NAME = os.environ.get('MONGODB_COURSES_COLLECTION_NAME', 'courses')
MONGODB_ASSESSMENTS_COLLECTION_NAME = os.environ.get('MONGODB_ASSESSMENTS_COLLECTION_NAME', 'assessments')
MONGODB_CHAPTERS_COLLECTION_NAME = os.environ.get('MONGODB_CHAPTERS_COLLECTION_NAME', 'chapters')
MONGODB_SECTIONS_COLLECTION_NAME = os.environ.get('MONGODB_SECTIONS_COLLECTION_NAME', 'sections')
MONGODB_OBJECTIVES_COLLECTION_NAME = os.environ.get('MONGODB_OBJECTIVES_COLLECTION_NAME', 'objectives')
MONGODB_ASSESSMENT_ATTEMPTS_COLLECTION_NAME = os.environ.get('MONGODB_ASSESSMENT_ATTEMPTS_COLLECTION_NAME', 'assessment_attempts')
MONGODB_ENROLLMENTS_COLLECTION_NAME = os.environ.get('MONGODB_ENROLLMENTS_COLLECTION_NAME', 'enrollments')
MONGODB_FEEDBACK_COLLECTION_NAME = os.environ.get('MONGODB_FEEDBACK_COLLECTION_NAME', 'feedback')

# Azure Document Intelligence Configuration
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = os.environ.get('AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT', '')
AZURE_DOCUMENT_INTELLIGENCE_API_KEY = os.environ.get('AZURE_DOCUMENT_INTELLIGENCE_API_KEY', '')

from sqs_queue import send_book_upload_message, create_queue_if_not_exists

# Initialize S3 client
def get_s3_client():
    """Initialize and return S3 client."""
    # Check if AWS credentials are provided
    aws_access_key = os.environ.get('AWS_ACCESS_KEY_ID')
    aws_secret_key = os.environ.get('AWS_SECRET_ACCESS_KEY')
    
    # If credentials are not provided, return None (will use local storage)
    if not aws_access_key or not aws_secret_key:
        return None
    
    try:
        # Use environment variables or IAM role for credentials
        # Configure to use AWS Signature Version 4 (required for some S3 regions)
        # Explicitly set region in Config to ensure presigned URLs use correct region
        config = Config(
            signature_version='s3v4',
            region_name=S3_REGION
        )
        s3_client = boto3.client(
            's3',
            region_name=S3_REGION,
            aws_access_key_id=aws_access_key,
            aws_secret_access_key=aws_secret_key,
            config=config
        )
        # Verify the client is using the correct region
        if hasattr(s3_client.meta, 'region_name'):
            actual_region = s3_client.meta.region_name
            if actual_region != S3_REGION:
                print(f"Warning: S3 client region mismatch. Expected {S3_REGION}, got {actual_region}")
            else:
                print(f"S3 client initialized with region: {actual_region}")
        return s3_client
    except Exception as e:
        print(f"Warning: Could not initialize S3 client: {e}")
        return None

def create_bucket_if_not_exists():
    """
    Create S3 bucket if it doesn't exist.
    
    Raises:
        Exception: If bucket creation fails or S3 client is not configured
    """
    s3_client = get_s3_client()
    if not s3_client:
        raise Exception("S3 client not configured. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.")
    
    # Check if bucket exists
    try:
        s3_client.head_bucket(Bucket=S3_BUCKET_NAME)
        print(f"S3 bucket '{S3_BUCKET_NAME}' already exists")
        return
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', '')
        # If bucket doesn't exist (404 or NoSuchBucket), we'll create it
        if error_code not in ('404', 'NoSuchBucket'):
            # Other error (e.g., access denied, 403)
            error_msg = f"Error checking S3 bucket '{S3_BUCKET_NAME}': {str(e)}"
            print(f"Error: {error_msg}")
            raise Exception(error_msg)
    
    # Bucket doesn't exist, create it
    try:
        if S3_REGION == 'us-east-1':
            # us-east-1 doesn't support LocationConstraint
            s3_client.create_bucket(Bucket=S3_BUCKET_NAME)
        else:
            s3_client.create_bucket(
                Bucket=S3_BUCKET_NAME,
                CreateBucketConfiguration={'LocationConstraint': S3_REGION}
            )
        print(f"Created S3 bucket '{S3_BUCKET_NAME}' in region '{S3_REGION}'")
    except ClientError as create_error:
        error_code = create_error.response.get('Error', {}).get('Code', '')
        # If bucket already exists or is owned by us, that's fine
        if error_code in ('BucketAlreadyExists', 'BucketAlreadyOwnedByYou'):
            print(f"S3 bucket '{S3_BUCKET_NAME}' already exists")
        else:
            error_msg = f"Failed to create S3 bucket '{S3_BUCKET_NAME}': {str(create_error)}"
            print(f"Error: {error_msg}")
            raise Exception(error_msg)


def upload_pdf_to_s3(file_content: bytes, file_name: str, book_id: str) -> Dict[str, Any]:
    """
    Upload PDF file content to S3.
    
    Args:
        file_content: Binary content of the PDF file
        file_name: Original filename
        book_id: Unique book identifier
    
    Returns:
        Dictionary containing:
            - bucket: S3 bucket name
            - key: S3 object key
            - s3_url: S3 URL in format s3://bucket/key
            - public_url: Presigned URL (expires in 1 hour) or None if private
            - file_size: Size of the file in bytes
    
    Raises:
        Exception: If upload fails or S3 client is not configured
    """
    s3_client = get_s3_client()
    if not s3_client:
        raise Exception("S3 client not configured. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.")
    
    # Generate S3 key: books/{book_id}/{sanitized_filename}
    sanitized_filename = secure_filename(file_name)
    s3_key = f"{S3_FOLDER}{book_id}/{sanitized_filename}"
    
    try:
        # Upload file to S3
        s3_client.put_object(
            Bucket=S3_BUCKET_NAME,
            Key=s3_key,
            Body=file_content,
            ContentType='application/pdf'
        )
        
        print(f"Successfully uploaded PDF to S3: s3://{S3_BUCKET_NAME}/{s3_key}")
        
        # Generate presigned URL (expires in 1 hour)
        try:
            public_url = s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': S3_BUCKET_NAME, 'Key': s3_key},
                ExpiresIn=3600  # 1 hour
            )
        except Exception as url_error:
            print(f"Warning: Failed to generate presigned URL: {url_error}")
            public_url = None
        
        return {
            "bucket": S3_BUCKET_NAME,
            "key": s3_key,
            "s3_url": f"s3://{S3_BUCKET_NAME}/{s3_key}",
            "public_url": public_url,
            "file_size": len(file_content)
        }
        
    except ClientError as e:
        error_msg = f"Failed to upload PDF to S3: {str(e)}"
        print(f"Error: {error_msg}")
        raise Exception(error_msg)
    except Exception as e:
        error_msg = f"Unexpected error uploading PDF to S3: {str(e)}"
        print(f"Error: {error_msg}")
        raise Exception(error_msg)


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def upload_directory_to_s3(s3_client, local_dir: Path, s3_prefix: str, bucket_name: str):
    """
    Upload a directory recursively to S3.
    
    Args:
        s3_client: Boto3 S3 client
        local_dir: Local directory path to upload
        s3_prefix: S3 key prefix (e.g., 'graphrag-indexes/book-id/')
        bucket_name: S3 bucket name
    
    Returns:
        List of uploaded S3 keys
    """
    uploaded_keys = []
    
    if not local_dir.exists() or not local_dir.is_dir():
        print(f"Warning: Directory does not exist or is not a directory: {local_dir}")
        return uploaded_keys
    
    # Walk through all files in the directory
    for root, dirs, files in os.walk(local_dir):
        # Skip hidden directories and cache (optional - you may want to include cache)
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        
        for file in files:
            # Skip hidden files
            if file.startswith('.'):
                continue
            
            local_file_path = Path(root) / file
            # Calculate relative path from local_dir
            relative_path = local_file_path.relative_to(local_dir)
            # Create S3 key by joining prefix with relative path (using forward slashes)
            s3_key = f"{s3_prefix}{str(relative_path).replace(os.sep, '/')}"
            
            try:
                # Determine content type
                content_type = get_content_type(local_file_path.suffix.lstrip('.'))
                
                # Upload file
                s3_client.upload_file(
                    str(local_file_path),
                    bucket_name,
                    s3_key,
                    ExtraArgs={'ContentType': content_type}
                )
                uploaded_keys.append(s3_key)
                print(f"Uploaded to S3: s3://{bucket_name}/{s3_key}")
            except Exception as e:
                print(f"Error uploading {local_file_path} to S3: {e}")
                # Continue with other files
    
    return uploaded_keys


def get_azure_document_intelligence_client():
    """Initialize and return Azure Document Intelligence client."""
    if not AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT or not AZURE_DOCUMENT_INTELLIGENCE_API_KEY:
        return None
    
    try:
        from azure.ai.documentintelligence import DocumentIntelligenceClient
        from azure.core.credentials import AzureKeyCredential
        
        client = DocumentIntelligenceClient(
            endpoint=AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT,
            credential=AzureKeyCredential(AZURE_DOCUMENT_INTELLIGENCE_API_KEY)
        )
        return client
    except ImportError:
        print("Warning: azure-ai-documentintelligence package not installed")
        return None
    except Exception as e:
        print(f"Warning: Could not initialize Azure Document Intelligence client: {e}")
        return None


def convert_markdown_to_text(markdown_content: str) -> str:
    """
    Convert markdown content to plain text by removing markdown syntax.
    Preserves content structure while removing formatting.
    
    Args:
        markdown_content: Markdown string to convert
        
    Returns:
        Plain text string
    """
    text = markdown_content
    
    # Extract table content before removing tags
    def extract_table_text(match):
        table_content = match.group(0)
        # Extract text from table cells
        cell_text = re.findall(r'<td[^>]*>(.*?)</td>', table_content, re.DOTALL | re.IGNORECASE)
        return '\n'.join(cell.strip() for cell in cell_text if cell.strip())
    
    # Extract table content before removing tags
    text = re.sub(r'<table>.*?</table>', extract_table_text, text, flags=re.DOTALL | re.IGNORECASE)
    
    # Remove remaining HTML-like tags
    text = re.sub(r'<[^>]+>', '', text)
    
    # Remove HTML comments
    text = re.sub(r'<!--.*?-->', '', text, flags=re.DOTALL)
    
    # Remove markdown headers but keep the text (convert # Header to Header)
    text = re.sub(r'^#+\s+(.+)$', r'\1', text, flags=re.MULTILINE)
    
    # Remove markdown bold/italic (**text**, *text*)
    text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)
    text = re.sub(r'\*([^*]+)\*', r'\1', text)
    
    # Remove markdown links [text](url) - keep the text
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
    
    # Remove markdown images ![alt](url) - keep alt text if available
    text = re.sub(r'!\[([^\]]*)\]\([^\)]+\)', r'\1', text)
    
    # Remove markdown code blocks (```code```) - keep the code content
    text = re.sub(r'```[^`]*```', '', text, flags=re.DOTALL)
    
    # Remove inline code (`code`) - keep the code content
    text = re.sub(r'`([^`]+)`', r'\1', text)
    
    # Remove markdown list markers (-, *, +) but keep the content
    text = re.sub(r'^[\s]*[-*+]\s+', '', text, flags=re.MULTILINE)
    
    # Remove markdown numbered lists but keep the content
    text = re.sub(r'^\s*\d+\.\s+', '', text, flags=re.MULTILINE)
    
    # Remove horizontal rules (---, ***)
    text = re.sub(r'^[-*]{3,}$', '', text, flags=re.MULTILINE)
    
    # Remove blockquotes (>) but keep the content
    text = re.sub(r'^>\s+', '', text, flags=re.MULTILINE)
    
    # Clean up multiple blank lines (replace 3+ with 2)
    text = re.sub(r'\n{3,}', '\n\n', text)
    
    # Strip leading/trailing whitespace from each line
    lines = [line.strip() for line in text.split('\n')]
    text = '\n'.join(lines)
    
    # Remove completely empty lines at start/end
    text = text.strip()
    
    return text


async def process_pdf_with_azure_di(pdf_path: Path, output_path: Path):
    """
    Process PDF file with Azure Document Intelligence using layout analysis.
    Saves markdown first, then converts to text and deletes markdown file.
    
    Args:
        pdf_path: Path to the input PDF file
        output_path: Path to save the extracted text file (will be .txt)
        
    Returns:
        bool: True if successful, False otherwise
    """
    client = get_azure_document_intelligence_client()
    if not client:
        print("Azure Document Intelligence not configured, skipping PDF processing")
        return False
    
    try:
        # Read PDF file
        with open(pdf_path, 'rb') as f:
            pdf_data = f.read()
        
        print(f"Processing PDF with Azure Document Intelligence: {pdf_path}")
        
        # Analyze document with layout model (prebuilt-layout)
        # This model extracts text with layout understanding, tables, and structure
        poller = client.begin_analyze_document(
            model_id="prebuilt-layout",
            body=pdf_data,  # Required: PDF data as bytes
            content_type="application/pdf",  # Content type for binary body
            output_content_format="markdown",  # Get markdown output with layout preserved
            pages=None,  # Process all pages
            features=["languages", "formulas"],
            locale="en-US"
        )
        
        # Wait for analysis to complete
        result = poller.result()
        
        # Extract content and write to markdown file first
        if result.content:
            # Create markdown file path (same location, .md extension)
            markdown_path = output_path.with_suffix('.md')
            
            # Save markdown content first
            with open(markdown_path, 'w', encoding='utf-8') as f:
                f.write(result.content)
            
            print(f"Markdown file saved: {markdown_path}")
            print(f"Markdown content length: {len(result.content)} characters")
            
            # Convert markdown to text
            print("Converting markdown to text...")
            text_content = convert_markdown_to_text(result.content)
            
            # Save text content
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(text_content)
            
            print(f"Text file saved: {output_path}")
            print(f"Text content length: {len(text_content)} characters")
            
            # Delete markdown file
            if markdown_path.exists():
                markdown_path.unlink()
                print(f"Markdown file deleted: {markdown_path}")
            
            # Log additional information if available
            if hasattr(result, 'pages') and result.pages:
                print(f"Processed {len(result.pages)} pages")
            
            return True
        else:
            print("Warning: No content extracted from PDF")
            return False
            
    except Exception as e:
        print(f"Error processing PDF with Azure Document Intelligence: {e}")
        import traceback
        traceback.print_exc()
        return False


def get_mongodb_client():
    """Initialize and return MongoDB client."""
    if not MONGODB_URI:
        print("MongoDB URI not configured. Set MONGODB_URI environment variable to use MongoDB.")
        return None
    
    try:
        client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=5000)
        # Test connection
        client.admin.command('ping')
        print(f"Successfully connected to MongoDB: {MONGODB_DB_NAME}.{MONGODB_COLLECTION_NAME}")
        return client
    except ConnectionFailure as e:
        print(f"Warning: Could not connect to MongoDB (Connection Failure): {e}")
        print("Please check:")
        print("  1. MongoDB connection string (MONGODB_URI) is correct")
        print("  2. Cluster name in the connection string exists")
        print("  3. Network connectivity to MongoDB Atlas")
        print("  4. IP whitelist includes your current IP address")
        return None
    except Exception as e:
        error_msg = str(e)
        if "DNS query name does not exist" in error_msg:
            print(f"Warning: MongoDB cluster not found: {e}")
            print("The cluster name in your connection string does not exist.")
            print("Please verify:")
            print("  1. Connection string format: mongodb+srv://username:password@cluster-name.mongodb.net/")
            print("  2. Cluster name is correct")
            print("  3. You have access to the cluster")
        else:
            print(f"Warning: Could not connect to MongoDB: {e}")
        return None


def get_mongodb_collection():
    """Get MongoDB collection for books."""
    client = get_mongodb_client()
    if not client:
        return None
    try:
        db = client[MONGODB_DB_NAME]
        collection = db[MONGODB_COLLECTION_NAME]
        return collection
    except Exception as e:
        print(f"Error accessing MongoDB collection: {e}")
        return None


def get_mongodb_courses_collection():
    """Get MongoDB collection for courses."""
    client = get_mongodb_client()
    if not client:
        return None
    try:
        db = client[MONGODB_DB_NAME]
        collection = db[MONGODB_COURSES_COLLECTION_NAME]
        return collection
    except Exception as e:
        print(f"Error accessing MongoDB courses collection: {e}")
        return None

def get_mongodb_objectives_collection():
    """Get MongoDB collection for courses."""
    client = get_mongodb_client()
    if not client:
        return None
    try:
        db = client[MONGODB_DB_NAME]
        collection = db[MONGODB_COURSES_COLLECTION_NAME]
        return collection
    except Exception as e:
        print(f"Error accessing MongoDB courses collection: {e}")
        return None


def get_mongodb_assessments_collection():
    """Get MongoDB collection for assessments."""
    client = get_mongodb_client()
    if not client:
        return None
    try:
        db = client[MONGODB_DB_NAME]
        collection = db[MONGODB_ASSESSMENTS_COLLECTION_NAME]
        return collection
    except Exception as e:
        print(f"Error accessing MongoDB assessments collection: {e}")
        return None


def get_mongodb_chapters_collection():
    """Get MongoDB collection for chapters."""
    client = get_mongodb_client()
    if not client:
        return None
    try:
        db = client[MONGODB_DB_NAME]
        collection = db[MONGODB_CHAPTERS_COLLECTION_NAME]
        return collection
    except Exception as e:
        print(f"Error accessing MongoDB chapters collection: {e}")
        return None


def get_mongodb_sections_collection():
    """Get MongoDB collection for sections."""
    client = get_mongodb_client()
    if not client:
        return None
    try:
        db = client[MONGODB_DB_NAME]
        collection = db[MONGODB_SECTIONS_COLLECTION_NAME]
        return collection
    except Exception as e:
        print(f"Error accessing MongoDB sections collection: {e}")
        return None


def get_mongodb_objectives_collection():
    """Get MongoDB collection for objectives."""
    client = get_mongodb_client()
    if not client:
        return None
    try:
        db = client[MONGODB_DB_NAME]
        collection = db[MONGODB_OBJECTIVES_COLLECTION_NAME]
        return collection
    except Exception as e:
        print(f"Error accessing MongoDB objectives collection: {e}")
        return None


def get_mongodb_assessment_attempts_collection():
    """Get MongoDB collection for assessment attempts."""
    client = get_mongodb_client()
    if not client:
        return None
    try:
        db = client[MONGODB_DB_NAME]
        collection = db[MONGODB_ASSESSMENT_ATTEMPTS_COLLECTION_NAME]
        return collection
    except Exception as e:
        print(f"Error accessing MongoDB assessment attempts collection: {e}")
        return None


def get_mongodb_enrollments_collection():
    """Get MongoDB collection for course enrollments."""
    client = get_mongodb_client()
    if not client:
        return None
    try:
        db = client[MONGODB_DB_NAME]
        collection = db[MONGODB_ENROLLMENTS_COLLECTION_NAME]
        return collection
    except Exception as e:
        print(f"Error accessing MongoDB enrollments collection: {e}")
        return None


def get_mongodb_feedback_collection():
    """Get MongoDB collection for user feedback."""
    client = get_mongodb_client()
    if not client:
        return None
    try:
        db = client[MONGODB_DB_NAME]
        collection = db[MONGODB_FEEDBACK_COLLECTION_NAME]
        return collection
    except Exception as e:
        print(f"Error accessing MongoDB feedback collection: {e}")
        return None


def save_feedback_entry(feedback_entry):
    """Persist feedback to MongoDB, with local JSON fallback."""
    collection = get_mongodb_feedback_collection()

    if collection is not None:
        try:
            collection.insert_one(make_json_serializable(feedback_entry.copy()))
            return True
        except Exception as e:
            print(f"Error saving feedback to MongoDB: {e}")

    feedback_file = UPLOAD_DIR / 'feedback.json'
    try:
        existing_feedback = []
        if feedback_file.exists():
            with open(feedback_file, 'r') as f:
                existing_feedback = json.load(f)
        existing_feedback.append(make_json_serializable(feedback_entry.copy()))
        with open(feedback_file, 'w') as f:
            json.dump(existing_feedback, f, indent=2)
        return True
    except Exception as e:
        print(f"Error saving feedback to local file: {e}")
        return False


def load_books_from_mongodb():
    """Load books from MongoDB or local fallback."""
    collection = get_mongodb_collection()
    
    if collection is not None:
        try:
            # Load all books from MongoDB
            books = list(collection.find({}, {'_id': 0}))  # Exclude _id field
            return books
        except Exception as e:
            print(f"Error loading books from MongoDB: {e}")
            # Fall back to local file
            pass
    
    # # Fallback to local file
    # books_file = UPLOAD_DIR / 'books.json'
    # if books_file.exists():
    #     try:
    #         with open(books_file, 'r') as f:
    #             return json.load(f)
    #     except Exception as e:
    #         print(f"Error loading local books.json: {e}")
    #         return []
    return []


# Keep old function name for backward compatibility
def load_books_from_s3():
    """Alias for load_books_from_mongodb for backward compatibility."""
    return load_books_from_mongodb()


def save_chapter_to_mongodb(chapter_data):
    """Save a single chapter to MongoDB (upsert by chapter_id)."""
    collection = get_mongodb_chapters_collection()
    
    # Convert chapter_data to JSON-serializable format before saving
    serializable_chapter_data = make_json_serializable(chapter_data.copy())
    
    if collection is not None:
        try:
            # Upsert by chapter_id
            collection.update_one(
                {'chapter_id': serializable_chapter_data.get('chapter_id')},
                {'$set': serializable_chapter_data},
                upsert=True
            )
            print(f"Saved chapter to MongoDB: {serializable_chapter_data.get('chapter_id')}")
            return True
        except Exception as e:
            print(f"Error saving chapter to MongoDB: {e}")
            return False
    
    # MongoDB not configured - skip (chapters should be in MongoDB)
    print("MongoDB not configured, cannot save chapter")
    return False


def save_section_to_mongodb(section_data):
    """Save a single section to MongoDB (upsert by section_id)."""
    collection = get_mongodb_sections_collection()
    
    # Convert section_data to JSON-serializable format before saving
    serializable_section_data = make_json_serializable(section_data.copy())
    
    if collection is not None:
        try:
            # Upsert by section_id
            collection.update_one(
                {'section_id': serializable_section_data.get('section_id')},
                {'$set': serializable_section_data},
                upsert=True
            )
            print(f"Saved section to MongoDB: {serializable_section_data.get('section_id')}")
            return True
        except Exception as e:
            print(f"Error saving section to MongoDB: {e}")
            return False
    
    # MongoDB not configured - skip (sections should be in MongoDB)
    print("MongoDB not configured, cannot save section")
    return False


def save_objective_to_mongodb(objective_data):
    """Save a single objective to MongoDB (upsert by objective_id)."""
    collection = get_mongodb_objectives_collection()
    
    # Convert objective_data to JSON-serializable format before saving
    serializable_objective_data = make_json_serializable(objective_data.copy())
    
    if collection is not None:
        try:
            # Upsert by objective_id (using the 'id' field from the objective)
            objective_id = serializable_objective_data.get('objective_id') or serializable_objective_data.get('id')
            if objective_id:
                collection.update_one(
                    {'objective_id': objective_id},
                    {'$set': serializable_objective_data},
                    upsert=True
                )
                print(f"Saved objective to MongoDB: {objective_id}")
                return True
            else:
                print(f"Warning: Objective missing ID, cannot save to MongoDB")
                return False
        except Exception as e:
            print(f"Error saving objective to MongoDB: {e}")
            return False
    
    # MongoDB not configured - skip (objectives should be in MongoDB)
    print("MongoDB not configured, cannot save objective")
    return False


def get_book_chapter_section_counts(book_id):
    """Get actual chapter and section counts from MongoDB collections for a book."""
    chapters_collection = get_mongodb_chapters_collection()
    sections_collection = get_mongodb_sections_collection()
    
    chapter_count = 0
    section_count = 0
    
    if chapters_collection is not None:
        try:
            chapter_count = chapters_collection.count_documents({'book_id': book_id})
        except Exception as e:
            print(f"Error counting chapters for book {book_id}: {e}")
    
    if sections_collection is not None:
        try:
            section_count = sections_collection.count_documents({'book_id': book_id})
        except Exception as e:
            print(f"Error counting sections for book {book_id}: {e}")
    
    return chapter_count, section_count


def save_book_to_mongodb(book_data):
    """Save a single book to MongoDB (upsert by id)."""
    collection = get_mongodb_collection()
    
    # Convert book_data to JSON-serializable format before saving
    serializable_book_data = make_json_serializable(book_data.copy())
    
    # Verify counts from MongoDB collections if book_id is available
    book_id = serializable_book_data.get('id')
    if book_id:
        db_chapter_count, db_section_count = get_book_chapter_section_counts(book_id)
        # Update counts to match what's actually in the collections
        if db_chapter_count > 0:
            serializable_book_data['total_chapters'] = db_chapter_count
        if db_section_count > 0:
            serializable_book_data['total_sections'] = db_section_count
    
    if collection is not None:
        try:
            # Upsert book by id
            result = collection.update_one(
                {'id': serializable_book_data['id']},
                {'$set': serializable_book_data},
                upsert=True
            )
            print(f"Successfully saved book to MongoDB: {serializable_book_data['id']}")
            # Only fall back to local if MongoDB save fails
            return True
        except Exception as e:
            print(f"Error saving book to MongoDB: {e}")
            # Fall back to local file only on error
            return save_books_to_local([serializable_book_data], append=True)
    
    # MongoDB not configured - use local file
    print("MongoDB not configured, saving to local file")
    return save_books_to_local([serializable_book_data], append=True)

def save_objectives_to_mongodb(books):
    """Save all books to MongoDB (replaces all documents)."""
    collection = get_mongodb_collection()
    
    if collection is not None:
        try:
            # Clear existing books and insert all
            collection.delete_many({})
            if books:
                collection.insert_many(books)
            print(f"Successfully saved {len(books)} books to MongoDB")
            return True
        except Exception as e:
            print(f"Error saving books to MongoDB: {e}")
            # Fall back to local file only on error
            return save_books_to_local(books)
    
    # MongoDB not configured - use local file
    print("MongoDB not configured, saving to local file")
    return save_books_to_local(books)

def save_books_to_mongodb(books):
    """Save all books to MongoDB (replaces all documents)."""
    collection = get_mongodb_collection()
    
    if collection is not None:
        try:
            # Clear existing books and insert all
            collection.delete_many({})
            if books:
                collection.insert_many(books)
            print(f"Successfully saved {len(books)} books to MongoDB")
            return True
        except Exception as e:
            print(f"Error saving books to MongoDB: {e}")
            # Fall back to local file only on error
            return save_books_to_local(books)
    
    # MongoDB not configured - use local file
    print("MongoDB not configured, saving to local file")
    return save_books_to_local(books)


def make_json_serializable(obj):
    """Convert non-JSON-serializable objects (like DataFrames) to serializable formats."""
    if isinstance(obj, pd.DataFrame):
        # Convert DataFrame to list of dictionaries
        return obj.to_dict('records')
    elif isinstance(obj, pd.Series):
        # Convert Series to dictionary
        return obj.to_dict()
    elif isinstance(obj, dict):
        # Recursively process dictionaries
        return {key: make_json_serializable(value) for key, value in obj.items()}
    elif isinstance(obj, (list, tuple)):
        # Recursively process lists and tuples
        return [make_json_serializable(item) for item in obj]
    elif hasattr(obj, '__dict__'):
        # Convert objects with __dict__ to dictionaries
        return make_json_serializable(obj.__dict__)
    else:
        # For primitive types (str, int, float, bool, None), return as-is
        try:
            json.dumps(obj)  # Test if it's JSON serializable
            return obj
        except (TypeError, ValueError):
            # If not serializable, convert to string
            return str(obj)


def save_books_to_local(books, append=False):
    """Save books to local JSON file."""
    books_file = UPLOAD_DIR / 'books.json'
    try:
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        
        if append and books_file.exists():
            # Load existing and append
            with open(books_file, 'r') as f:
                existing_books = json.load(f)
            # Merge by book_id (update existing, add new)
            existing_ids = {b.get('book_id') for b in existing_books}
            for book in books:
                if book.get('book_id') in existing_ids:
                    # Update existing
                    for i, existing in enumerate(existing_books):
                        if existing.get('book_id') == book.get('book_id'):
                            existing_books[i] = book
                            break
                else:
                    # Add new
                    existing_books.append(book)
            books = existing_books
        
        # Convert any non-serializable objects before saving
        serializable_books = make_json_serializable(books)
        
        with open(books_file, 'w') as f:
            json.dump(serializable_books, f, indent=2)
        return True
    except Exception as e:
        print(f"Error saving local books.json: {e}")
        return False


# Keep old function name for backward compatibility
def save_books_to_s3(books):
    """Alias for save_books_to_mongodb for backward compatibility."""
    return save_books_to_mongodb(books)


def load_courses_from_mongodb():
    """Load courses from MongoDB or local fallback."""
    collection = get_mongodb_courses_collection()
    
    # Load books to create book_id to title mapping for backward compatibility
    uploaded_books = load_books_from_mongodb()
    book_id_to_title = {}
    for book in uploaded_books:
        book_id = book.get('id') or book.get('book_id')
        book_title = book.get('title') or book.get('name') or f"Book {book_id}"
        if book_id:
            book_id_to_title[book_id] = book_title
    
    if collection is not None:
        try:
            # Load all courses from MongoDB
            courses = list(collection.find({}, {'_id': 0}))  # Exclude _id field
            # Only set to empty array if the field is completely missing (preserve existing data structures)
            for course in courses:
                if 'selected_chapters' not in course:
                    course['selected_chapters'] = []
                if 'selected_sections' not in course:
                    course['selected_sections'] = []
                if 'books' not in course:
                    course['books'] = []
                
                # Populate book_title for selected_chapters if missing (backward compatibility)
                for chapter in course.get('selected_chapters', []):
                    if 'book_title' not in chapter and chapter.get('book_id'):
                        chapter['book_title'] = book_id_to_title.get(chapter['book_id'], f"Book {chapter['book_id']}")
                
                # Populate book_title for selected_sections if missing (backward compatibility)
                for section in course.get('selected_sections', []):
                    if 'book_title' not in section and section.get('book_id'):
                        section['book_title'] = book_id_to_title.get(section['book_id'], f"Book {section['book_id']}")
                
                # Ensure involvedBooksCount is present (calculate if missing for backward compatibility)
                if 'involvedBooksCount' not in course or course['involvedBooksCount'] is None:
                    # Calculate from book_ids if available, otherwise from books array
                    if 'book_ids' in course and course['book_ids']:
                        course['involvedBooksCount'] = len(course['book_ids'])
                    elif course.get('books') and isinstance(course['books'], list):
                        course['involvedBooksCount'] = len(course['books'])
                    else:
                        # Calculate from selected_chapters and selected_sections
                        book_ids_set = set()
                        for chapter in course.get('selected_chapters', []):
                            if chapter.get('book_id'):
                                book_ids_set.add(chapter['book_id'])
                        for section in course.get('selected_sections', []):
                            if section.get('book_id'):
                                book_ids_set.add(section['book_id'])
                        course['involvedBooksCount'] = len(book_ids_set) if book_ids_set else 0
            return courses
        except Exception as e:
            print(f"Error loading courses from MongoDB: {e}")
            # Fall back to local file
            pass
    
    # Fallback to local file
    courses_file = UPLOAD_DIR / 'courses.json'
    if courses_file.exists():
        try:
            with open(courses_file, 'r') as f:
                courses = json.load(f)
            # Only set to empty array if the field is completely missing (preserve existing data structures)
            if isinstance(courses, list):
                for course in courses:
                    if 'selected_chapters' not in course:
                        course['selected_chapters'] = []
                    if 'selected_sections' not in course:
                        course['selected_sections'] = []
                    if 'books' not in course:
                        course['books'] = []
                    
                    # Populate book_title for selected_chapters if missing (backward compatibility)
                    for chapter in course.get('selected_chapters', []):
                        if 'book_title' not in chapter and chapter.get('book_id'):
                            chapter['book_title'] = book_id_to_title.get(chapter['book_id'], f"Book {chapter['book_id']}")
                    
                    # Populate book_title for selected_sections if missing (backward compatibility)
                    for section in course.get('selected_sections', []):
                        if 'book_title' not in section and section.get('book_id'):
                            section['book_title'] = book_id_to_title.get(section['book_id'], f"Book {section['book_id']}")
                    
                    # Ensure involvedBooksCount is present (calculate if missing for backward compatibility)
                    if 'involvedBooksCount' not in course or course['involvedBooksCount'] is None:
                        # Calculate from book_ids if available, otherwise from books array
                        if 'book_ids' in course and course['book_ids']:
                            course['involvedBooksCount'] = len(course['book_ids'])
                        elif course.get('books') and isinstance(course['books'], list):
                            course['involvedBooksCount'] = len(course['books'])
                        else:
                            # Calculate from selected_chapters and selected_sections
                            book_ids_set = set()
                            for chapter in course.get('selected_chapters', []):
                                if chapter.get('book_id'):
                                    book_ids_set.add(chapter['book_id'])
                            for section in course.get('selected_sections', []):
                                if section.get('book_id'):
                                    book_ids_set.add(section['book_id'])
                            course['involvedBooksCount'] = len(book_ids_set) if book_ids_set else 0
            return courses if isinstance(courses, list) else []
        except Exception as e:
            print(f"Error loading local courses.json: {e}")
            return []
    return []


def load_chapters_from_mongodb():
    """Load chapters from MongoDB or local fallback."""
    collection = get_mongodb_chapters_collection()
    
    if collection is not None:
        try:
            # Load all chapters from MongoDB
            chapters = list(collection.find({}, {'_id': 0}))  # Exclude _id field
            return chapters
        except Exception as e:
            print(f"Error loading chapters from MongoDB: {e}")
            # Fall back to local file
            pass
    
    # Fallback to local file (if needed in the future)
    # chapters_file = UPLOAD_DIR / 'chapters.json'
    # if chapters_file.exists():
    #     try:
    #         with open(chapters_file, 'r') as f:
    #             return json.load(f)
    #     except Exception as e:
    #         print(f"Error loading local chapters.json: {e}")
    #         return []
    return []


def load_sections_from_mongodb():
    """Load sections from MongoDB or local fallback."""
    collection = get_mongodb_sections_collection()
    
    if collection is not None:
        try:
            # Load all sections from MongoDB
            sections = list(collection.find({}, {'_id': 0}))  # Exclude _id field
            return sections
        except Exception as e:
            print(f"Error loading sections from MongoDB: {e}")
            # Fall back to local file
            pass
    
    # Fallback to local file (if needed in the future)
    # sections_file = UPLOAD_DIR / 'sections.json'
    # if sections_file.exists():
    #     try:
    #         with open(sections_file, 'r') as f:
    #             return json.load(f)
    #     except Exception as e:
    #         print(f"Error loading local sections.json: {e}")
    #         return []
    return []


def save_course_to_mongodb(course_data):
    """Save a single course to MongoDB (upsert by id)."""
    collection = get_mongodb_courses_collection()
    
    # Convert course_data to JSON-serializable format before saving
    serializable_course_data = make_json_serializable(course_data.copy())
    
    if collection is not None:
        try:
            # Upsert course by id
            result = collection.update_one(
                {'id': serializable_course_data['id']},
                {'$set': serializable_course_data},
                upsert=True
            )
            print(f"Successfully saved course to MongoDB: {serializable_course_data['id']}")
            # Only fall back to local if MongoDB save fails
            return True
        except Exception as e:
            print(f"Error saving course to MongoDB: {e}")
            # Fall back to local file only on error
            return save_courses_to_local([serializable_course_data], append=True)
    
    # MongoDB not configured - use local file
    print("MongoDB not configured, saving course to local file")
    return save_courses_to_local([serializable_course_data], append=True)


def save_courses_to_local(courses, append=False):
    """Save courses to local JSON file (fallback)."""
    courses_file = UPLOAD_DIR / 'courses.json'
    try:
        if append and courses_file.exists():
            with open(courses_file, 'r') as f:
                existing_courses = json.load(f)
            # Update existing courses or add new ones
            for course in courses:
                existing_index = next((i for i, c in enumerate(existing_courses) if c.get('id') == course.get('id')), None)
                if existing_index is not None:
                    existing_courses[existing_index] = course
                else:
                    existing_courses.append(course)
            courses = existing_courses
        
        with open(courses_file, 'w') as f:
            json.dump(courses, f, indent=2)
        return True
    except Exception as e:
        print(f"Error saving courses to local file: {e}")
        return False


def load_assessments_from_mongodb():
    """Load assessments from MongoDB or local fallback."""
    collection = get_mongodb_assessments_collection()
    
    if collection is not None:
        try:
            # Load all assessments from MongoDB
            assessments = list(collection.find({}, {'_id': 0}))  # Exclude _id field
            return assessments
        except Exception as e:
            print(f"Error loading assessments from MongoDB: {e}")
            # Fall back to local file
            pass
    
    # Fallback to local file
    assessments_file = UPLOAD_DIR / 'assessments.json'
    if assessments_file.exists():
        try:
            with open(assessments_file, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading local assessments.json: {e}")
            return []
    return []


def load_assessment_by_id_from_mongodb(assessment_id):
    """Load a single assessment by ID from MongoDB or local fallback."""
    collection = get_mongodb_assessments_collection()
    
    if collection is not None:
        try:
            # Load assessment directly from MongoDB by ID
            assessment = collection.find_one({'id': assessment_id}, {'_id': 0})
            if assessment:
                return assessment
        except Exception as e:
            print(f"Error loading assessment {assessment_id} from MongoDB: {e}")
            # Fall back to local file
            pass
    
    # Fallback to local file
    assessments_file = UPLOAD_DIR / 'assessments.json'
    if assessments_file.exists():
        try:
            with open(assessments_file, 'r') as f:
                assessments = json.load(f)
                assessment = next((a for a in assessments if a.get('id') == assessment_id), None)
                if assessment:
                    return assessment
        except Exception as e:
            print(f"Error loading local assessments.json: {e}")
            return None
    return None


def save_assessment_to_mongodb(assessment_data):
    """Save a single assessment to MongoDB (upsert by id)."""
    collection = get_mongodb_assessments_collection()
    
    # Convert assessment_data to JSON-serializable format before saving
    serializable_assessment_data = make_json_serializable(assessment_data.copy())
    
    if collection is not None:
        try:
            # Upsert assessment by id
            result = collection.update_one(
                {'id': serializable_assessment_data['id']},
                {'$set': serializable_assessment_data},
                upsert=True
            )
            print(f"Successfully saved assessment to MongoDB: {serializable_assessment_data['id']}")
            # Only fall back to local if MongoDB save fails
            return True
        except Exception as e:
            print(f"Error saving assessment to MongoDB: {e}")
            # Fall back to local file only on error
            return save_assessments_to_local([serializable_assessment_data], append=True)
    
    # MongoDB not configured - use local file
    print("MongoDB not configured, saving assessment to local file")
    return save_assessments_to_local([serializable_assessment_data], append=True)


def save_assessments_to_local(assessments, append=False):
    """Save assessments to local JSON file (fallback)."""
    assessments_file = UPLOAD_DIR / 'assessments.json'
    try:
        if append and assessments_file.exists():
            with open(assessments_file, 'r') as f:
                existing_assessments = json.load(f)
            # Update existing assessments or add new ones
            for assessment in assessments:
                existing_index = next((i for i, a in enumerate(existing_assessments) if a.get('id') == assessment.get('id')), None)
                if existing_index is not None:
                    existing_assessments[existing_index] = assessment
                else:
                    existing_assessments.append(assessment)
            assessments = existing_assessments
        
        with open(assessments_file, 'w') as f:
            json.dump(assessments, f, indent=2)
        return True
    except Exception as e:
        print(f"Error saving assessments to local file: {e}")
        return False


def load_graphrag_data(project_dir: str):
    """Load documents and text_units from a GraphRAG project."""
    project_path = Path(project_dir)
    output_path = project_path / "output"
    
    try:
        documents_df = pd.read_parquet(output_path / "documents.parquet")
        text_units_df = pd.read_parquet(output_path / "text_units.parquet")
        return documents_df, text_units_df
    except Exception as e:
        print(f"Error loading data from {project_dir}: {e}")
        return None, None


def get_all_projects():
    """Find all GraphRAG project directories."""
    base = Path(BASE_DIR)
    projects = []
    
    for item in base.iterdir():
        if item.is_dir() and not item.name.startswith('.') and item.name != 'venv':
            settings_file = item / "settings.yaml"
            output_dir = item / "output" / "documents.parquet"
            if settings_file.exists() and output_dir.exists():
                projects.append({
                    "id": item.name,
                    "name": item.name.replace('_', ' ').title(),
                    "path": str(item)
                })
    
    return projects


@app.route('/api/books', methods=['GET'])
def get_books():
    """Get list of all books (documents from all projects)."""
    projects = get_all_projects()
    all_books = []
    
    for project in projects:
        documents_df, _ = load_graphrag_data(project["path"])
        if documents_df is not None:
            for _, doc in documents_df.iterrows():
                all_books.append({
                    "id": doc.get("id", ""),
                    "title": doc.get("title", "Untitled"),
                    "project_id": project["id"],
                    "project_name": project["name"],
                    "text_unit_count": len(doc.get("text_unit_ids", [])) if isinstance(doc.get("text_unit_ids"), list) else 0
                })
    
    return jsonify(all_books)


@app.route('/api/books/uploaded', methods=['GET'])
def get_uploaded_books():
    """Get list of all uploaded books."""
    books = load_books_from_mongodb()
    return jsonify(books)


@app.route('/api/books/migrate-to-mongodb', methods=['POST'])
def migrate_books_to_mongodb():
    """Migrate books from local books.json to MongoDB."""
    try:
        collection = get_mongodb_collection()
        if collection is None:
            return jsonify({"error": "MongoDB not configured. Please set MONGODB_URI environment variable."}), 400
        
        # Load books from local file
        books_file = UPLOAD_DIR / 'books.json'
        if not books_file.exists():
            return jsonify({"message": "No local books.json file found", "migrated": 0}), 200
        
        with open(books_file, 'r') as f:
            local_books = json.load(f)
        
        if not local_books:
            return jsonify({"message": "No books found in local file", "migrated": 0}), 200
        
        # Save to MongoDB (upsert each book to avoid duplicates)
        migrated_count = 0
        for book in local_books:
            try:
                collection.update_one(
                    {'book_id': book['book_id']},
                    {'$set': book},
                    upsert=True
                )
                migrated_count += 1
            except Exception as e:
                print(f"Error migrating book {book.get('book_id', 'unknown')}: {e}")
        
        return jsonify({
            "success": True,
            "message": f"Successfully migrated {migrated_count} books to MongoDB",
            "migrated": migrated_count,
            "total": len(local_books)
        }), 200
        
    except Exception as e:
        import traceback
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500


@app.route('/api/books/<book_id>', methods=['GET'])
def get_book_details(book_id):
    """Get details of a specific book including its chapters/sections and objectives."""
    # First, try to load from MongoDB (which has objectives and structured data)
    collection = get_mongodb_collection()
    if collection is not None:
        try:
            book_data = collection.find_one({'book_id': book_id})
            if book_data:
                # Get objectives from MongoDB objectives collection
                objectives_collection = get_mongodb_objectives_collection()
                objectives = []
                if objectives_collection is not None:
                    try:
                        objectives_cursor = objectives_collection.find({'book_id': book_id})
                        objectives = list(objectives_cursor)
                        # Format objectives to match expected structure: [{id, text}]
                        objectives = [
                            {
                                "id": obj.get("objective_id") or obj.get("id", ""),
                                "text": obj.get("text", "")
                            }
                            for obj in objectives
                            if obj.get("text")
                        ]
                    except Exception as e:
                        print(f"Error loading objectives from MongoDB: {e}")
                
                # If objectives not found in separate collection, check if they're in book_data
                if not objectives and book_data.get("objectives"):
                    objectives = book_data.get("objectives", [])
                
                # Get chapters from book_data or from chapters collection
                chapters = []
                if book_data.get("chapters") and isinstance(book_data["chapters"], list):
                    chapters = book_data["chapters"]
                else:
                    # Try to get chapters from separate chapters collection
                    chapters_collection = get_mongodb_chapters_collection()
                    if chapters_collection is not None:
                        try:
                            chapters_cursor = chapters_collection.find({'book_id': book_id}, {'_id': 0})
                            chapters_list = list(chapters_cursor)
                            if chapters_list:
                                # Sort by chapter_index if available
                                chapters_list.sort(key=lambda x: x.get('chapter_index', 0))
                                # For each chapter, get its sections from sections collection
                                sections_collection = get_mongodb_sections_collection()
                                for chapter in chapters_list:
                                    chapter_id = chapter.get('chapter_id')
                                    if chapter_id and sections_collection is not None:
                                        try:
                                            chapter_sections_cursor = sections_collection.find(
                                                {'chapter_id': chapter_id}, 
                                                {'_id': 0}
                                            )
                                            chapter_sections = list(chapter_sections_cursor)
                                            # Sort sections by section_index if available
                                            chapter_sections.sort(key=lambda x: x.get('section_index', 0))
                                            chapter['sections'] = chapter_sections
                                        except Exception as e:
                                            print(f"Error loading sections for chapter {chapter_id}: {e}")
                                            chapter['sections'] = []
                                    else:
                                        chapter['sections'] = []
                                chapters = chapters_list
                        except Exception as e:
                            print(f"Error loading chapters from MongoDB: {e}")
                
                # Get sections from MongoDB sections collection or from book_data
                sections = []
                if book_data.get("sections") and isinstance(book_data["sections"], list):
                    sections = book_data["sections"]
                elif chapters and len(chapters) > 0:
                    # Extract sections from chapters
                    for chapter in chapters:
                        if chapter.get("sections") and isinstance(chapter["sections"], list):
                            sections.extend(chapter["sections"])
                
                # If no sections found, try to get from GraphRAG as fallback
                if not sections:
                    projects = get_all_projects()
                    for project in projects:
                        documents_df, text_units_df = load_graphrag_data(project["path"])
                        if documents_df is not None and text_units_df is not None:
                            book = documents_df[documents_df["id"] == book_id]
                            if not book.empty:
                                book = book.iloc[0]
                                text_unit_ids = book.get("text_unit_ids", [])
                                
                                if isinstance(text_unit_ids, list) and len(text_unit_ids) > 0:
                                    book_text_units = text_units_df[text_units_df["id"].isin(text_unit_ids)]
                                    if "human_readable_id" in book_text_units.columns:
                                        book_text_units = book_text_units.sort_values("human_readable_id")
                                    
                                    for idx, (_, tu) in enumerate(book_text_units.iterrows()):
                                        text = tu.get("text", "")
                                        sections.append({
                                            "id": tu.get("id", ""),
                                            "section_number": idx + 1,
                                            "text": text[:500] + "..." if len(text) > 500 else text,
                                            "full_text": text,
                                            "n_tokens": int(tu.get("n_tokens", 0))
                                        })
                                break
                
                return jsonify({
                    "id": book_data.get("book_id", ""),
                    "book_id": book_data.get("book_id", ""),
                    "title": book_data.get("title", "Untitled"),
                    "s3_location": book_data.get("s3_location", ""),
                    # "project_id": book_data.get("project_id", ""),
                    # "project_name": book_data.get("project_name", ""),
                    "description": book_data.get("description", ""),
                    # "text": book_data.get("text", ""),
                    "chapters": chapters,
                    "total_chapters": len(chapters) if chapters else book_data.get("total_chapters", 0),
                    "sections": sections,
                    "total_sections": len(sections) if sections else book_data.get("total_sections", 0),
                    "objectives": objectives,
                    "total_objectives": len(objectives)
                })
        except Exception as e:
            print(f"Error loading book from MongoDB: {e}")
    
    # Fallback to GraphRAG projects
    projects = get_all_projects()
    
    for project in projects:
        documents_df, text_units_df = load_graphrag_data(project["path"])
        if documents_df is not None and text_units_df is not None:
            book = documents_df[documents_df["id"] == book_id]
            if not book.empty:
                book = book.iloc[0]
                text_unit_ids = book.get("text_unit_ids", [])
                
                # Get text units for this book
                sections = []
                if isinstance(text_unit_ids, list) and len(text_unit_ids) > 0:
                    # Filter text units by their IDs
                    book_text_units = text_units_df[text_units_df["id"].isin(text_unit_ids)]
                    
                    # Sort by human_readable_id if available, otherwise by index
                    if "human_readable_id" in book_text_units.columns:
                        book_text_units = book_text_units.sort_values("human_readable_id")
                    
                    for idx, (_, tu) in enumerate(book_text_units.iterrows()):
                        text = tu.get("text", "")
                        sections.append({
                            "id": tu.get("id", ""),
                            "section_number": idx + 1,
                            "text": text[:500] + "..." if len(text) > 500 else text,
                            "full_text": text,
                            "n_tokens": int(tu.get("n_tokens", 0))
                        })
                
                # Try to get objectives from MongoDB even for GraphRAG books
                objectives = []
                objectives_collection = get_mongodb_objectives_collection()
                if objectives_collection is not None:
                    try:
                        objectives_cursor = objectives_collection.find({'book_id': book_id}, {'_id': 0})
                        objectives = list(objectives_cursor)
                        objectives = [
                            {
                                "id": obj.get("objective_id") or obj.get("id", ""),
                                "text": obj.get("text", "")
                            }
                            for obj in objectives
                            if obj.get("text")
                        ]
                    except Exception as e:
                        print(f"Error loading objectives from MongoDB: {e}")
                
                # Try to get chapters from MongoDB even for GraphRAG books
                chapters = []
                chapters_collection = get_mongodb_chapters_collection()
                if chapters_collection is not None:
                    try:
                        chapters_cursor = chapters_collection.find({'book_id': book_id}, {'_id': 0})
                        chapters_list = list(chapters_cursor)
                        if chapters_list:
                            # Sort by chapter_index if available
                            chapters_list.sort(key=lambda x: x.get('chapter_index', 0))
                            # For each chapter, get its sections from sections collection
                            sections_collection = get_mongodb_sections_collection()
                            for chapter in chapters_list:
                                chapter_id = chapter.get('chapter_id')
                                if chapter_id and sections_collection is not None:
                                    try:
                                        chapter_sections_cursor = sections_collection.find(
                                            {'chapter_id': chapter_id}, 
                                            {'_id': 0}
                                        )
                                        chapter_sections = list(chapter_sections_cursor)
                                        # Sort sections by section_index if available
                                        chapter_sections.sort(key=lambda x: x.get('section_index', 0))
                                        chapter['sections'] = chapter_sections
                                    except Exception as e:
                                        print(f"Error loading sections for chapter {chapter_id}: {e}")
                                        chapter['sections'] = []
                                else:
                                    chapter['sections'] = []
                            chapters = chapters_list
                    except Exception as e:
                        print(f"Error loading chapters from MongoDB: {e}")
                
                return jsonify({
                    "id": book.get("id", ""),
                    "title": book.get("title", "Untitled"),
                    "project_id": project["id"],
                    "project_name": project["name"],
                    "text": book.get("text", ""),
                    "chapters": chapters,
                    "total_chapters": len(chapters),
                    "sections": sections,
                    "total_sections": len(sections),
                    "objectives": objectives,
                    "total_objectives": len(objectives)
                })
    
    return jsonify({"error": "Book not found"}), 404


@app.route('/api/sections/<section_id>', methods=['GET'])
def get_section_details(section_id):
    """Get full details of a specific section."""
    projects = get_all_projects()
    
    for project in projects:
        _, text_units_df = load_graphrag_data(project["path"])
        if text_units_df is not None:
            section = text_units_df[text_units_df["id"] == section_id]
            if not section.empty:
                section = section.iloc[0]
                return jsonify({
                    "id": section.get("id", ""),
                    "text": section.get("text", ""),
                    "n_tokens": int(section.get("n_tokens", 0)),
                    "document_ids": section.get("document_ids", [])
                })
    
    return jsonify({"error": "Section not found"}), 404


@app.route('/api/projects', methods=['GET'])
def get_projects():
    """Get list of all GraphRAG projects."""
    projects = get_all_projects()
    return jsonify(projects)


@app.route('/health', methods=['GET'])
@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint to verify service is running."""
    return jsonify({
        "status": "healthy",
        "service": "graphrag-testing",
        "timestamp": datetime.now().isoformat()
    }), 200

from pymongo.database import Database
import logging

logger = logging.getLogger(__name__)

# Global MongoDB database instance
_mongo_db = None


def get_mongodb_database(database_name: Optional[str] = None) -> Database:
    """Get MongoDB database instance."""
    global _mongo_db
    
    db_name = database_name or os.getenv('MONGODB_DATABASE_NAME', 'bookstore')
    
    if _mongo_db is None or _mongo_db.name != db_name:
        client = get_mongodb_client()
        if client is None:
            raise ConnectionError("MongoDB client is not available. Please check your MongoDB configuration.")
        _mongo_db = client[db_name]
        logger.info(f"Using MongoDB database: {db_name}")
    
    return _mongo_db

def get_book_collection():
    """Get the book collection from MongoDB."""
    db = get_mongodb_database()
    return db['books']

class S3Location(BaseModel):
    """S3 location information."""
    bucket: str
    key: str
    s3_url: str
    public_url: str
    file_name: str
    file_size: int 
    
class BookUploadResponse(BaseModel):
    """Response model for book upload."""
    book_id: str
    status: str
    message: str
    sqs_message_id: Optional[str] = None
    s3_location: Optional[S3Location] = None
    created_at: str

@app.route("/v1/api/books/upload", methods=['POST'])
async def upload_book_v1():
    """
    Upload a book PDF to S3, create a record in MongoDB, and send a job to SQS queue for LTL processing.
    
    This endpoint performs the following steps in order:
    1. Uploads the PDF file to S3 bucket
    2. Creates a book record in MongoDB 'books' collection with S3 location
    3. Sends a message to SQS queue for long-term processing (LTL job)
    
    Returns:
        BookUploadResponse with book_id, status, S3 location, and SQS message ID
    """
    try:
        # Get file from request
        if 'file' not in request.files:
            return jsonify({"error": "No file provided"}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400
        
        file_name = file.filename
        
        # Validate PDF file (basic check)
        if not file_name.lower().endswith('.pdf'):
            return jsonify({"error": "File must be a PDF"}), 400
        
        # Read file content
        file_content = file.read()
        
        if not file_content:
            return jsonify({"error": "File is empty"}), 400
        
        # Get form data
        title = request.form.get('title', '')
        description = request.form.get('description', '')
        
        if not title:
            return jsonify({"error": "Title is required"}), 400
        
        # Generate unique book ID
        book_id = str(uuid.uuid4())
        
        logger.info(f"Uploading PDF to S3: {file_name} (size: {len(file_content)} bytes)")
        
        # Step 1: Upload PDF to S3
        try:
            # Ensure bucket exists
            create_bucket_if_not_exists()
            
            # Upload to S3
            s3_info = upload_pdf_to_s3(
                file_content=file_content,
                file_name=file_name,
                book_id=book_id
            )
            
            logger.info(f"PDF uploaded to S3: {s3_info['s3_url']}")
        except Exception as s3_error:
            logger.error(f"Failed to upload PDF to S3: {s3_error}")
            return jsonify({"error": f"Failed to upload PDF to S3: {str(s3_error)}"}), 500
        
        # Step 2: Create book record in MongoDB
        book_document = {
            "_id": book_id,
            "book_id": book_id,
            "file": file_name,
            "title": title,
            "description": description,
            "s3_location": {
                "bucket": s3_info["bucket"],
                "key": s3_info["key"],
                "s3_url": s3_info["s3_url"],
                "public_url": s3_info["public_url"]
            },
            "file_size": s3_info["file_size"],
            "content_type": "application/pdf",
            "status": "pending",  # pending, processing, completed, failed
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat()
        }
        
        # Insert book record into MongoDB
        collection = get_book_collection()
        result = collection.insert_one(book_document)
        
        if not result.inserted_id:
            return jsonify({"error": "Failed to insert book record into MongoDB"}), 500
        
        logger.info(f"Book record inserted into MongoDB: {book_id}")
        
        # Step 3: Prepare book data for SQS message
        sqs_book_data = {
            "_id": book_id,
            "book_id": book_id,
            "file": file_name,
            "title": title,
            "description": description,
            "s3_location": {
                "bucket": s3_info["bucket"],
                "key": s3_info["key"],
                "s3_url": s3_info["s3_url"],
                "public_url": s3_info["public_url"]
            },
            "file_size": s3_info["file_size"],
            "content_type": "application/pdf",
            "status": "pending",
            "created_at": book_document["created_at"],
            "updated_at": book_document["updated_at"]
        }
        
        # Step 4: Send message to SQS queue for LTL job
        try:
            # Ensure queue exists
            # create_queue_if_not_exists()
            
            sqs_response = send_book_upload_message(book_id, sqs_book_data)
            sqs_message_id = sqs_response.get('message_id')
            
            logger.info(f"SQS message sent for book upload job: {book_id}, Message ID: {sqs_message_id}")
        except Exception as sqs_error:
            logger.error(f"Failed to send SQS message: {sqs_error}")
            # Update book status to indicate SQS failure
            collection.update_one(
                {"_id": book_id},
                {"$set": {"status": "sqs_failed", "sqs_error": str(sqs_error)}}
            )
            # Still return success for MongoDB and S3, but note SQS failure
            return jsonify({
                "book_id": book_id,
                "status": "partial_success",
                "message": "PDF uploaded to S3 and record created in MongoDB, but failed to send to SQS queue",
                "sqs_message_id": None,
                "s3_location": s3_info,
                "created_at": book_document["created_at"]
            }), 200
        
        # Update book status to indicate SQS message sent
        collection.update_one(
            {"_id": book_id},
            {"$set": {"status": "queued", "sqs_message_id": sqs_message_id}}
        )
        
        return jsonify({
            "book_id": book_id,
            "status": "success",
            "message": "PDF uploaded to S3, record created, and uploaded to processing queue",
            "sqs_message_id": sqs_message_id,
            "s3_location": s3_info,
            "created_at": book_document["created_at"]
        }), 200
        
    except Exception as e:
        logger.exception(f"Error uploading book: {e}")
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500

@app.route('/api/books/upload', methods=['POST'])
async def upload_book():
    """Upload a new book file to S3."""
    print("\n" + "="*80)
    print("DEBUG: Starting book upload endpoint")
    print("="*80)
    try:
        # Validate file
        if 'file' not in request.files:
            print("DEBUG: No file in request.files")
            return jsonify({"error": "No file provided"}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400
        
        if not allowed_file(file.filename):
            return jsonify({"error": f"File type not allowed. Allowed types: {', '.join(ALLOWED_EXTENSIONS)}"}), 400
        
        # Get form data
        title = request.form.get('title', '')
        project_name = request.form.get('project_name', 'Custom Project')
        description = request.form.get('description', '')
        
        if not title:
            # Use filename as title if not provided
            title = secure_filename(file.filename).rsplit('.', 1)[0]
        
        # Generate unique ID for the book
        filename = secure_filename(file.filename)
        book_id = hashlib.sha256(f"{filename}".encode()).hexdigest()

        # Save file temporarily for S3 upload
        file_extension = filename.rsplit('.', 1)[1].lower() if '.' in filename else ''
        saved_filename = f"{book_id}_{filename}"
        temp_file_path = UPLOAD_DIR / saved_filename
        
        # Ensure upload directory exists
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        
        # Save file temporarily
        file.save(str(temp_file_path))
        
        # Get actual file size
        file_size = temp_file_path.stat().st_size
        print(f"DEBUG: File saved to {temp_file_path}, size: {file_size} bytes")
        
        # Upload to S3 (private bucket - using signed URLs)
        s3_client = get_s3_client()
        print(f"DEBUG: S3 client initialized: {s3_client is not None}")
        file_path_value = None
        s3_key = None
        
        # Create GraphRAG folder structure for this book
        graphrag_store_dir = BASE_DIR / 'indexes'
        book_graphrag_root = graphrag_store_dir / book_id  # Project root for this book
        book_graphrag_input = book_graphrag_root / 'input'  # Input directory
        
        print(f"DEBUG: GraphRAG directories - root: {book_graphrag_root}, input: {book_graphrag_input}")
        
        # Create directories if they don't exist
        graphrag_store_dir.mkdir(parents=True, exist_ok=True)
        book_graphrag_root.mkdir(parents=True, exist_ok=True)
        book_graphrag_input.mkdir(parents=True, exist_ok=True)
        
        print(f"DEBUG: GraphRAG directory created: {book_graphrag_root}")
        
        # Process PDF with Azure Document Intelligence (layout analysis)
        if file_extension == 'pdf' and temp_file_path.exists():
            # Create output text file path in input directory
            output_text_file = book_graphrag_input / f"{book_id}.txt"
            
            # Process PDF with Azure Document Intelligence
            di_success = await process_pdf_with_azure_di(temp_file_path, output_text_file)
        
        # Initialize GraphRAG project for this book
        print(f"Initializing GraphRAG project at: {book_graphrag_root}")
        try:
            result = subprocess.run(
                ["graphrag", "init", "--root", str(book_graphrag_root)],
                cwd=str(BASE_DIR),
                capture_output=True,
                text=True,
                check=True
            )
            print(f"GraphRAG init completed successfully: {result.stdout}")
            
            # Set GRAPHRAG_API_KEY from global .env file
            env_file = book_graphrag_root / ".env"
            global_env_file = BASE_DIR / ".env"
            
            # Read GRAPHRAG_API_KEY from global .env file
            graphrag_api_key = None
            if global_env_file.exists():
                with open(global_env_file, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith('GRAPHRAG_API_KEY='):
                            # Extract the value after the equals sign
                            graphrag_api_key = line.split('=', 1)[1] if '=' in line else ''
                            break
            
            # Also check environment variable as fallback
            if not graphrag_api_key:
                graphrag_api_key = os.environ.get('GRAPHRAG_API_KEY', '')
            
            # Write to book's .env file
            if env_file.exists() or graphrag_api_key:
                with open(env_file, 'w', encoding='utf-8') as f:
                    f.write(f'GRAPHRAG_API_KEY={graphrag_api_key}\n')
                
                if graphrag_api_key:
                    print(f"Set GRAPHRAG_API_KEY in .env file from global .env")
                else:
                    print(f"Set GRAPHRAG_API_KEY= (empty) in .env file")
            
            # Modify settings.yaml to change the model
            settings_file = book_graphrag_root / "settings.yaml"
            if settings_file.exists():
                with open(settings_file, 'r', encoding='utf-8') as f:
                    settings_content = f.read()
                
                # Change model from gpt-4-turbo-preview to gpt-5-mini (or your preferred model)
                import re
                # Replace model in default_chat_model
                settings_content = re.sub(
                    r'(default_chat_model:.*?\n.*?model:)\s+gpt-4-turbo-preview',
                    r'\1 gpt-5-mini',
                    settings_content,
                    flags=re.DOTALL
                )
                
                # Also handle if model is on the same line
                settings_content = settings_content.replace(
                    'model: gpt-4-turbo-preview',
                    'model: gpt-5-mini'
                )
                
                with open(settings_file, 'w', encoding='utf-8') as f:
                    f.write(settings_content)
                
                print(f"Updated settings.yaml to use gpt-5-mini model")
        except subprocess.CalledProcessError as e:
            print(f"Error initializing GraphRAG project: {e.stderr}")
            # Continue anyway - the directory might already exist or init might have partial success
        except Exception as e:
            print(f"Unexpected error during GraphRAG init: {str(e)}")

        
        try:
            print(f"DEBUG: Starting GraphRAG indexing...")
            result = subprocess.run(
                ["graphrag", "index", "--root", str(book_graphrag_root)],
                cwd=str(BASE_DIR),
                capture_output=True,
                text=True,
                check=True
            )
            print(f"DEBUG: GraphRAG index completed successfully")
            print(f"DEBUG: Index stdout (first 500 chars): {result.stdout[:500] if result.stdout else 'None'}")
        except subprocess.CalledProcessError as e:
            print(f"DEBUG ERROR: GraphRAG indexing failed with CalledProcessError")
            print(f"DEBUG: stderr: {e.stderr}")
            print(f"DEBUG: stdout: {e.stdout}")
            # Continue anyway - the directory might already exist or init might have partial success
        except Exception as e:
            print(f"DEBUG ERROR: Unexpected error during GraphRAG index: {str(e)}")
            import traceback
            traceback.print_exc()
            # Continue anyway
        if s3_client:
            try:
                s3_key = f"{S3_FOLDER}{saved_filename}"
                # Upload file to S3 (private, no public access)
                s3_client.upload_file(
                    str(temp_file_path),
                    S3_BUCKET_NAME,
                    s3_key,
                    ExtraArgs={'ContentType': get_content_type(file_extension)}
                )
                
                # Store S3 reference instead of public URL
                # Presigned URLs will be generated on-demand via API endpoint
                file_path_value = f"s3://{S3_BUCKET_NAME}/{s3_key}"
                print(f"S3 upload successful: {file_path_value}")
                
                # Delete temporary file after successful upload
                if temp_file_path.exists():
                    temp_file_path.unlink()
                    
            except ClientError as e:
                error_msg = str(e)
                print(f"S3 upload error: {error_msg}")
                # Clean up temp file on error
                if temp_file_path.exists():
                    try:
                        temp_file_path.unlink()
                    except:
                        pass
                return jsonify({"error": f"Failed to upload to S3: {error_msg}"}), 500
            except Exception as e:
                error_msg = str(e)
                print(f"Unexpected error during S3 upload: {error_msg}")
                # Clean up temp file on error
                if temp_file_path.exists():
                    try:
                        temp_file_path.unlink()
                    except:
                        pass
                return jsonify({"error": f"Upload failed: {error_msg}"}), 500
        else:
            # Fallback: keep file locally if S3 is not configured
            print("Warning: S3 not configured, saving file locally")
            file_path_value = str(temp_file_path.relative_to(BASE_DIR))
        
        # Estimate text unit count based on file size (rough estimate)
        estimated_text_unit_count = max(10, file_size // 1024)
        
        
        print("DEBUG: Chapter, sections and objectives extraction started...")
        print(f"DEBUG: book_graphrag_root: {book_graphrag_root}")
        print(f"DEBUG: s3_key: {s3_key}")
        # Extract book structure: chapters, sections, and learning objectives
        # Using basic search to find all relevant content sections
        chapters_response = None
        try:
            print("DEBUG: Calling run_query with method='basic'")
            chapters_response, context_data = await run_query(
                    root_dir=str(book_graphrag_root),
                    s3_key=s3_key,
                    query=(
                        "Extract the complete hierarchical structure of this book including: "+
                          "1) All chapter titles and their content summaries, "+
                          "2) All section headings and their detailed descriptions within each chapter, "+
                          "3) All learning objectives, goals, or key takeaways for each chapter and section. "  
                          "Please provide this information in a well-structured JSON format with clear organization showing the chapter-section-objective hierarchy. "
                          +"Sample output: "+
                          "{"+
                          "  \"chapters\": ["+
                          "    {"+
                          "      \"title\": \"Chapter 1\","+
                          "      \"summary\": \"This chapter covers the basics of ...\","+
                          "      \"sections\": ["+
                          "        {"+
                          "          \"title\": \"Section 1.1\","+
                          "          \"description\": \"This section covers ...\","+
                          "          \"objectives\": [\"Understand ...\", \"Apply ...\", \"Analyze ...\"]"+
                          "        }"+
                          "      ]"+
                          "    }"+
                          "  ]"+
                          "}"
                    ),
                    method="basic",
                )    
            print("DEBUG: Chapter extraction completed successfully")
            print(f"DEBUG: chapters_response type: {type(chapters_response)}")
            print(f"DEBUG: chapters_response length: {len(str(chapters_response)) if chapters_response else 0}")
        except Exception as e:
            print(f"DEBUG ERROR: Failed to extract chapters/sections: {e}")
            print(f"DEBUG ERROR: Exception type: {type(e).__name__}")
            import traceback
            print("DEBUG ERROR: Full traceback:")
            traceback.print_exc()
            # Continue with None chapters_response - book will be saved without chapter data
            chapters_response = None

        # Extract JSON from response, removing any prefix text
        def extract_json_from_response(response_text):
            """Extract JSON object from a string that may contain prefix text before the JSON."""
            if not isinstance(response_text, str):
                return response_text
            
            # Remove markdown code blocks if present
            response_text = response_text.strip()
            if response_text.startswith("```json"):
                response_text = response_text[7:].strip()
            if response_text.startswith("```"):
                response_text = response_text[3:].strip()
            if response_text.endswith("```"):
                response_text = response_text[:-3].strip()
            
            # Find the first occurrence of '{' (start of JSON object)
            first_brace = response_text.find('{')
            
            if first_brace != -1:
                # Extract everything from first '{' onwards
                json_candidate = response_text[first_brace:]
                
                # Find the matching closing brace by counting braces
                brace_count = 0
                last_brace = -1
                for i, char in enumerate(json_candidate):
                    if char == '{':
                        brace_count += 1
                    elif char == '}':
                        brace_count -= 1
                        if brace_count == 0:
                            last_brace = i
                            break
                
                if last_brace != -1:
                    # Extract the complete JSON object
                    json_str = json_candidate[:last_brace + 1]
                    try:
                        # Try to parse and return as dict
                        parsed_json = json.loads(json_str)
                        return parsed_json
                    except json.JSONDecodeError as e:
                        # If parsing fails, try to clean up common issues
                        # Remove any trailing text after the JSON
                        print(f"Warning: JSON parsing failed, attempting cleanup: {e}")
                        return json_str
                else:
                    # No matching closing brace found
                    print("Warning: No matching closing brace found in JSON response")
                    return response_text[first_brace:]  # Return from first brace to end
            else:
                # No opening brace found, return original
                return response_text

        print("DEBUG: Processing chapters_response for storage")
        # Convert chapters_response to JSON-serializable format (convert DataFrame to dict/list if needed)
        chapters_serializable = make_json_serializable(chapters_response)
        print(f"DEBUG: chapters_serializable type: {type(chapters_serializable)}")
        
        # Extract JSON from string response if it's a string
        if isinstance(chapters_serializable, str):
            print("DEBUG: chapters_serializable is a string, extracting JSON")
            chapters_data = extract_json_from_response(chapters_serializable)
            # If extraction resulted in a dict, convert back to JSON string for storage
            if isinstance(chapters_data, dict):
                chapters_data = json.dumps(chapters_data, ensure_ascii=False)
                print("DEBUG: Converted dict to JSON string")
        else:
            # If it was converted from DataFrame or other type, convert to JSON string
            chapters_data = json.dumps(chapters_serializable, ensure_ascii=False) if chapters_serializable is not None else None
            print(f"DEBUG: chapters_data type: {type(chapters_data)}, length: {len(chapters_data) if chapters_data else 0}")

        print("DEBUG: Creating book metadata")
        # Create book metadata
        book_data = {
            "id": book_id,
            "title": title,
            "project_name": project_name,
            "description": description,
            "filename": filename,
            "file_path": file_path_value,
            "s3_bucket": S3_BUCKET_NAME if s3_client else None,
            "s3_key": s3_key if s3_client else None,
            "uploaded_at": datetime.now().isoformat(),
            "text_unit_count": estimated_text_unit_count,
            "file_size": file_size,
            "chapters": [],  # Will be populated with structured chapters array
            "sections": [],  # Will be populated with structured sections array
            "objectives": [],  # Will be populated with all objectives: [{id, text}]
            "objective_ids": []  # Will be populated with array of objective IDs
        }
        
        # Extract and save chapters and sections to separate collections
        if chapters_data:
            print("DEBUG: Extracting chapters and sections from book")
            try:
                # Parse chapters data
                chapters_parsed = None
                if isinstance(chapters_data, str):
                    # Check if string is empty or whitespace
                    chapters_data_stripped = chapters_data.strip()
                    if not chapters_data_stripped:
                        print("DEBUG WARNING: chapters_data is empty string, skipping parsing")
                        chapters_parsed = None
                    else:
                        try:
                            # Try to parse as JSON directly
                            chapters_parsed = json.loads(chapters_data_stripped)
                        except json.JSONDecodeError as json_err:
                            # If direct parsing fails, try using extract_json_from_response
                            print(f"DEBUG WARNING: Direct JSON parsing failed: {json_err}, trying extract_json_from_response")
                            chapters_parsed = extract_json_from_response(chapters_data_stripped)
                            # If it's still a string after extraction, try parsing again
                            if isinstance(chapters_parsed, str):
                                try:
                                    chapters_parsed = json.loads(chapters_parsed)
                                except json.JSONDecodeError:
                                    print(f"DEBUG ERROR: Failed to parse chapters_data as JSON after extraction")
                                    print(f"DEBUG: chapters_data preview: {chapters_data_stripped[:200]}")
                                    chapters_parsed = None
                else:
                    chapters_parsed = chapters_data
                
                # Handle different structures: could be dict with 'chapters' key, or direct list
                chapters_list = None
                if isinstance(chapters_parsed, dict) and 'chapters' in chapters_parsed:
                    chapters_list = chapters_parsed.get('chapters')
                elif isinstance(chapters_parsed, list):
                    chapters_list = chapters_parsed
                
                if chapters_list and isinstance(chapters_list, list):
                    print(f"DEBUG: Found {len(chapters_list)} chapters to save")
                    chapter_ids = []
                    chapters_array = []  # Structured chapters array for book_data
                    sections_array = []  # Structured sections array for book_data
                    
                    for chapter_idx, chapter in enumerate(chapters_list):
                        # Generate chapter_id
                        chapter_id = f"{book_id}_chapter_{chapter_idx}"
                        
                        # Extract chapter text
                        chapter_text = (
                            chapter.get('summary') or 
                            chapter.get('text') or 
                            chapter.get('content') or 
                            chapter.get('description') or 
                            ''
                        )
                        
                        # Generate text_id
                        text_id = generate_text_id(chapter_text)
                        
                        # Extract and save objectives from chapter (if any)
                        chapter_objectives = chapter.get('objectives', [])
                        chapter_objective_ids = []
                        if chapter_objectives and isinstance(chapter_objectives, list):
                            # Ensure objectives have the correct format with id and text
                            formatted_objectives = []
                            for obj in chapter_objectives:
                                if isinstance(obj, dict):
                                    # Ensure it has both id and text
                                    if 'id' in obj and 'text' in obj:
                                        objective_id = obj['id']
                                        formatted_objectives.append(obj)
                                    elif 'text' in obj:
                                        # Generate UUID if missing
                                        objective_id = str(uuid.uuid4())
                                        formatted_objectives.append({
                                            "id": objective_id,
                                            "text": obj['text']
                                        })
                                    else:
                                        # Convert to proper format
                                        objective_id = str(uuid.uuid4())
                                        formatted_objectives.append({
                                            "id": objective_id,
                                            "text": str(obj)
                                        })
                                else:
                                    # Convert string to proper format
                                    objective_id = str(uuid.uuid4())
                                    formatted_objectives.append({
                                        "id": objective_id,
                                        "text": str(obj)
                                    })
                                
                                # Save each objective to MongoDB objectives collection
                                objective_doc = {
                                    "objective_id": objective_id,
                                    "book_id": book_id,
                                    "chapter_id": chapter_id,
                                    "section_id": None,  # Chapter-level objective (no section)
                                    "text": formatted_objectives[-1]['text'],
                                    "created_at": datetime.now().isoformat()
                                }
                                save_objective_to_mongodb(objective_doc)
                                chapter_objective_ids.append(objective_id)
                            
                            chapter_objectives = formatted_objectives
                        else:
                            chapter_objectives = []
                        
                        # Create chapter document for separate collection
                        chapter_doc = {
                            "book_id": book_id,
                            "chapter_id": chapter_id,
                            "text": chapter_text,
                            "text_id": text_id,
                            "title": chapter.get('title', f'Chapter {chapter_idx + 1}'),
                            "chapter_index": chapter_idx,
                            "objective_ids": chapter_objective_ids,  # Store only objective IDs (objectives in separate collection)
                            "created_at": datetime.now().isoformat()
                        }
                        
                        # Save chapter to MongoDB
                        save_chapter_to_mongodb(chapter_doc)
                        chapter_ids.append(chapter_id)
                        
                        # Create structured chapter object for book_data
                        chapter_obj = {
                            "chapter_id": chapter_id,
                            "title": chapter.get('title', f'Chapter {chapter_idx + 1}'),
                            "text": chapter_text,
                            "text_id": text_id,
                            "chapter_index": chapter_idx,
                            "objectives": chapter_objectives,  # Keep full objectives in book_data for reference
                            "objective_ids": chapter_objective_ids,  # Also store IDs for reference
                            "sections": []
                        }
                        
                        # Extract and save sections for this chapter
                        sections = chapter.get('sections', [])
                        if sections and isinstance(sections, list):
                            for section_idx, section in enumerate(sections):
                                # Generate section_id
                                section_id = f"{book_id}_chapter_{chapter_idx}_section_{section_idx}"
                                
                                # Extract section text
                                section_text = (
                                    section.get('description') or 
                                    section.get('text') or 
                                    section.get('content') or 
                                    section.get('summary') or 
                                    ''
                                )
                                
                                # Generate text_id
                                section_text_id = generate_text_id(section_text)
                                
                                # Extract and save objectives from section (required format: [{"id": "uuid", "text": "..."}])
                                section_objectives = section.get('objectives', [])
                                section_objective_ids = []
                                if section_objectives and isinstance(section_objectives, list):
                                    # Ensure objectives have the correct format with id and text
                                    formatted_objectives = []
                                    for obj in section_objectives:
                                        if isinstance(obj, dict):
                                            # Ensure it has both id and text
                                            if 'id' in obj and 'text' in obj:
                                                objective_id = obj['id']
                                                formatted_objectives.append(obj)
                                            elif 'text' in obj:
                                                # Generate UUID if missing
                                                objective_id = str(uuid.uuid4())
                                                formatted_objectives.append({
                                                    "id": objective_id,
                                                    "text": obj['text']
                                                })
                                            else:
                                                # Convert to proper format
                                                objective_id = str(uuid.uuid4())
                                                formatted_objectives.append({
                                                    "id": objective_id,
                                                    "text": str(obj)
                                                })
                                        else:
                                            # Convert string to proper format
                                            objective_id = str(uuid.uuid4())
                                            formatted_objectives.append({
                                                "id": objective_id,
                                                "text": str(obj)
                                            })
                                        
                                        # Save each objective to MongoDB
                                        objective_doc = {
                                            "objective_id": objective_id,
                                            "book_id": book_id,
                                            "chapter_id": chapter_id,
                                            "section_id": section_id,  # Section-level objective
                                            "text": formatted_objectives[-1]['text'],
                                            "created_at": datetime.now().isoformat()
                                        }
                                        save_objective_to_mongodb(objective_doc)
                                        section_objective_ids.append(objective_id)
                                    
                                    section_objectives = formatted_objectives
                                else:
                                    section_objectives = []
                                
                                # Create section document for separate collection
                                section_doc = {
                                    "book_id": book_id,
                                    "chapter_id": chapter_id,
                                    "section_id": section_id,
                                    "text": section_text,
                                    "text_id": section_text_id,
                                    "title": section.get('title', f'Section {section_idx + 1}'),
                                    "section_index": section_idx,
                                    "objective_ids": section_objective_ids,  # Store only objective IDs
                                    "created_at": datetime.now().isoformat()
                                }
                                
                                # Save section to MongoDB
                                save_section_to_mongodb(section_doc)
                                
                                # Create structured section object for book_data
                                section_obj = {
                                    "section_id": section_id,
                                    "chapter_id": chapter_id,
                                    "title": section.get('title', f'Section {section_idx + 1}'),
                                    "text": section_text,
                                    "text_id": section_text_id,
                                    "section_index": section_idx,
                                    "objectives": section_objectives,  # Keep full objectives in book_data for reference
                                    "objective_ids": section_objective_ids  # Also store IDs for reference
                                }
                                
                                # Add section to chapter's sections array
                                chapter_obj["sections"].append(section_obj)
                                # Also add to flat sections array
                                sections_array.append(section_obj)
                        
                        # Add chapter to chapters array
                        chapters_array.append(chapter_obj)
                    
                    # Add chapters and sections arrays to book_data
                    book_data['chapters'] = chapters_array
                    book_data['sections'] = sections_array
                    
                    # Also add counts for easy access
                    book_data['total_chapters'] = len(chapters_array)
                    book_data['total_sections'] = len(sections_array)
                    


                    # TODO: get objetives of the book using global graphRag query and save it on new DB collection and link it to book as well



                    print(f"DEBUG: Saved {len(chapter_ids)} chapters and {len(sections_array)} sections to MongoDB")
            except Exception as e:
                print(f"DEBUG ERROR: Failed to extract/save chapters and sections: {e}")
                import traceback
                traceback.print_exc()
        
        # Extract all objectives from the book using GraphRAG global query
        print("DEBUG: Extracting objectives from book using GraphRAG global query")
        book_objectives = []  # Collect all objectives for the book: [{id, text}]
        
        try:
            objectives_response, objectives_context = await run_query(
                root_dir=str(book_graphrag_root),
                s3_key=s3_key,
                query=(
                    "Extract all learning objectives, goals, and key takeaways from this book. "
                    "List them as a comprehensive set of learning objectives that students should achieve after reading this book. "
                    "Return the objectives in a JSON array format where each objective has an 'id' (unique identifier) and 'text' (the objective description). "
                    "JSON format: {\"objectives\": [{\"id\": \"unique-id\", \"text\": \"objective text\"}, ...]}"
                ),
                method="global",
                community_level=0,
            )
            print("DEBUG: Objectives extraction completed successfully")
            print(f"DEBUG: objectives_response type: {type(objectives_response)}")
            
            # Parse objectives from response
            if objectives_response:
                objectives_text = str(objectives_response)
                
                # Try to extract JSON from response
                try:
                    # Try parsing as JSON directly
                    if isinstance(objectives_response, (dict, list)):
                        objectives_parsed = objectives_response
                    else:
                        # Extract JSON from string response
                        objectives_parsed = json.loads(objectives_text)
                except (json.JSONDecodeError, ValueError):
                    # Try to extract JSON from text using the helper function
                    try:
                        objectives_parsed = extract_json_from_response(objectives_text)
                        # extract_json_from_response may return a dict (parsed) or string
                        if isinstance(objectives_parsed, str):
                            objectives_parsed = json.loads(objectives_parsed)
                    except (json.JSONDecodeError, ValueError, TypeError) as e:
                        print(f"DEBUG WARNING: Could not parse objectives JSON: {e}")
                        objectives_parsed = None
                
                # Extract objectives array
                objectives_list = None
                if isinstance(objectives_parsed, dict) and 'objectives' in objectives_parsed:
                    objectives_list = objectives_parsed.get('objectives')
                elif isinstance(objectives_parsed, list):
                    objectives_list = objectives_parsed
                
                if objectives_list and isinstance(objectives_list, list):
                    print(f"DEBUG: Found {len(objectives_list)} objectives to save")
                    for obj in objectives_list:
                        objective_id = None
                        objective_text = None
                        
                        if isinstance(obj, dict):
                            # Ensure it has both id and text
                            if 'id' in obj and 'text' in obj:
                                objective_id = obj['id']
                                objective_text = obj['text']
                            elif 'text' in obj:
                                # Generate UUID if missing
                                objective_id = str(uuid.uuid4())
                                objective_text = obj['text']
                            elif 'objective' in obj:
                                # Handle alternative format
                                objective_id = str(uuid.uuid4())
                                objective_text = str(obj['objective'])
                            else:
                                # Convert to proper format
                                objective_id = str(uuid.uuid4())
                                objective_text = str(obj)
                        else:
                            # Convert string to proper format
                            objective_id = str(uuid.uuid4())
                            objective_text = str(obj)
                        
                        if objective_id and objective_text:
                            # Save objective to MongoDB
                            objective_doc = {
                                "objective_id": objective_id,
                                "book_id": book_id,
                                "chapter_id": None,  # Book-level objective (not tied to specific chapter)
                                "section_id": None,  # Book-level objective (not tied to specific section)
                                "text": objective_text,
                                "created_at": datetime.now().isoformat()
                            }
                            save_objective_to_mongodb(objective_doc)
                            
                            # Add to book objectives array (simplified format: {id, text})
                            book_objectives.append({
                                "id": objective_id,
                                "text": objective_text
                            })
                    
                    print(f"DEBUG: Saved {len(book_objectives)} objectives to MongoDB")
        except Exception as e:
            print(f"DEBUG ERROR: Failed to extract/save objectives: {e}")
            import traceback
            traceback.print_exc()
        
        # Add objectives to book_data
        book_data['objectives'] = book_objectives  # Full objects: [{id, text}, ...]
        book_data['objective_ids'] = [obj['id'] for obj in book_objectives]  # Array of objective IDs for easy reference
        book_data['total_objectives'] = len(book_objectives)
        
        # Save book to MongoDB (upsert by id)
        print("DEBUG: Saving book to MongoDB")
        save_book_to_mongodb(book_data)
        print("DEBUG: Book saved successfully")
        # Save GraphRAG index to S3
        
        print("DEBUG: Upload completed successfully, returning response")
        print("="*80 + "\n")
        return jsonify({
            "success": True,
            "message": "Book uploaded successfully to S3" if s3_client else "Book uploaded successfully (local storage)",
            "book": book_data
        }), 201
        
    except Exception as e:
        print("\n" + "="*80)
        print("DEBUG ERROR: Exception in upload_book endpoint")
        print(f"DEBUG ERROR: Exception type: {type(e).__name__}")
        print(f"DEBUG ERROR: Exception message: {str(e)}")
        print("="*80)
        import traceback
        print("DEBUG ERROR: Full traceback:")
        traceback.print_exc()
        print("="*80 + "\n")
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500


def get_content_type(file_extension):
    """Get content type for file extension."""
    content_types = {
        'pdf': 'application/pdf',
        'txt': 'text/plain',
        'doc': 'application/msword',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'epub': 'application/epub+zip'
    }
    return content_types.get(file_extension.lower(), 'application/octet-stream')


@app.route('/api/books/<book_id>/download-url', methods=['GET'])
def get_book_download_url(book_id):
    """Generate a presigned URL for downloading a book file from S3."""
    try:
        # Load book metadata
        books = load_books_from_mongodb()
        
        book = next((b for b in books if b.get('book_id') == book_id), None)
        if not book:
            return jsonify({"error": "Book not found"}), 404
        
        # Get S3 location from book
        s3_location = book.get('s3_location')
        if not s3_location:
            return jsonify({"error": "Book file not available"}), 404
        
        # Extract bucket and key from s3_location
        s3_bucket = s3_location.get('bucket')
        s3_key = s3_location.get('key')
        
        # If no bucket/key, check if there's a public_url (might be a direct URL)
        if not s3_bucket or not s3_key:
            public_url = s3_location.get('public_url')
            if public_url:
                # Check if it's already a direct URL (not presigned)
                if '?' not in public_url or 'Expires=' not in public_url:
                    return jsonify({
                        "download_url": public_url,
                        "expires_in": None,
                        "storage_type": "public"
                    })
            return jsonify({"error": "Book file not available"}), 404
        
        # Generate fresh presigned URL for S3 (always generate new to avoid expiration)
        s3_client = get_s3_client()
        if not s3_client:
            return jsonify({"error": "S3 client not configured"}), 500
        
        # Generate presigned URL (expires in 1 hour - 3600 seconds by default)
        # You can adjust this expiration time as needed via query parameter
        expires_in = int(request.args.get('expires_in', 3600))
        expires_in = min(expires_in, 604800)  # Max 7 days
        
        try:
            presigned_url = s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': s3_bucket, 'Key': s3_key},
                ExpiresIn=expires_in
            )
            
            return jsonify({
                "download_url": presigned_url,
                "expires_in": expires_in,
                "storage_type": "s3"
            })
        except Exception as e:
            print(f"S3 presigned URL generation error: {e}")
            import traceback
            print(traceback.format_exc())
            return jsonify({"error": f"Failed to generate download URL: {str(e)}"}), 500
        
    except Exception as e:
        import traceback
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500


@app.route('/api/files/uploads/<path:filename>', methods=['GET'])
def serve_local_file(filename):
    """Serve local file uploads (fallback when S3 is not configured)."""
    try:
        file_path = UPLOAD_DIR / filename
        if not file_path.exists() or not file_path.is_file():
            return jsonify({"error": "File not found"}), 404
        
        # Security check: ensure file is within uploads directory
        if not str(file_path.resolve()).startswith(str(UPLOAD_DIR.resolve())):
            return jsonify({"error": "Invalid file path"}), 403
        
        return send_from_directory(str(UPLOAD_DIR), filename)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def generate_text_id(text):
    """Generate a unique ID from text content using hash."""
    if not text or not isinstance(text, str):
        return None
    # Generate a hash-based ID from the text content
    text_hash = hashlib.sha256(text.encode('utf-8')).hexdigest()[:16]
    return f"{text_hash}"


@app.route('/api/courses/create', methods=['POST'])
def create_course():
    """Create a new course from selected books, chapters, and sections."""
    try:
        data = request.get_json()
        
        title = data.get('title', '')
        description = data.get('description', '')
    
        book_ids = data.get('book_ids', [])
        selected_chapters_ids = data.get('selected_chapters', {})  # { bookId: [chapterId1, ...] } - from frontend (now using IDs)
        selected_sections_ids = data.get('selected_sections', {})

        # print(f"DEBUG: selected_sections_ids: {selected_sections_ids}")
        
        if not title:
            return jsonify({"error": "Course title is required"}), 400
        
        # Load uploaded books from MongoDB (these have complete data)
        uploaded_books = load_books_from_mongodb()
        chapters = load_chapters_from_mongodb()
        sections = load_sections_from_mongodb()
        
        # Create a mapping of book_id to book_title for quick lookup
        book_id_to_title = {}
        for book in uploaded_books:
            book_id = book.get('id') or book.get('book_id')
            book_title = book.get('title') or book.get('name') or f"Book {book_id}"
            if book_id:
                book_id_to_title[book_id] = book_title
        
        # Create a mapping of chapter_id to chapter data (title and text) for quick lookup
        chapter_id_to_data = {}
        for chapter in chapters:
            chapter_id = chapter.get('chapter_id')
            if chapter_id:
                chapter_id_to_data[chapter_id] = {
                    "chapter_title": chapter.get('title') or chapter.get('name') or f"Chapter {chapter_id}",
                    "chapter_text": chapter.get('text') or chapter.get('summary') or chapter.get('content') or chapter.get('description') or ''
                }
        
        # Filter chapters based on book_ids and selected_chapters_ids
        selected_chapters = []
        for chapter in chapters:
            chapter_book_id = chapter.get('book_id')
            chapter_id = chapter.get('chapter_id')
            
            # Check if chapter belongs to one of the selected books
            if chapter_book_id in book_ids:
                # Check if this chapter is explicitly selected
                if (chapter_book_id in selected_chapters_ids and 
                    chapter_id in selected_chapters_ids[chapter_book_id]):
                    # Ensure text and title are exposed, and include book_title
                    chapter_data = {
                        "book_id": chapter_book_id,
                        "chapter_id": chapter_id,
                        "book_title": book_id_to_title.get(chapter_book_id, f"Book {chapter_book_id}"),
                        "title": chapter.get('title') or chapter.get('name') or f"Chapter {chapter_id}",
                        "text": chapter.get('text') or chapter.get('summary') or chapter.get('content') or chapter.get('description') or '',
                        **{k: v for k, v in chapter.items() if k not in ['_id']}  # Include all other fields
                    }
                    selected_chapters.append(chapter_data)
        
        # Filter sections based on book_ids, selected_chapters_ids, and selected_sections_ids
        sections_extracted = []
        selected_sections = []
        
        # Load objectives if needed
        objectives_collection = get_mongodb_objectives_collection()
        all_objectives = []
        if objectives_collection is not None:
            try:
                all_objectives = list(objectives_collection.find({}, {'_id': 0}))
            except Exception as e:
                print(f"Error loading objectives from MongoDB: {e}")
        
        for section in sections:
            section_book_id = section.get('book_id')
            section_chapter_id = section.get('chapter_id')
            section_id = section.get('section_id')
            print(f"DEBUG: section: {section}")
            # Check if section belongs to one of the selected books
            if section_book_id in book_ids:
                # ONLY include sections that are explicitly selected in selected_sections_ids
                # Do NOT include all sections from selected chapters - only explicitly selected sections
                if (section_book_id in selected_sections_ids and 
                    section_chapter_id in selected_sections_ids[section_book_id] and
                    section_id in selected_sections_ids[section_book_id][section_chapter_id]):
                    # Section is explicitly selected - include it
                    # Add objectives for this section if available
                    section_objectives = [
                        obj for obj in all_objectives 
                        if (obj.get('book_id') == section_book_id and 
                            obj.get('chapter_id') == section_chapter_id and 
                            obj.get('section_id') == section_id)
                    ]
                    
                    # Get chapter data for this section
                    chapter_data = chapter_id_to_data.get(section_chapter_id, {})
                    chapter_title = chapter_data.get('chapter_title', f"Chapter {section_chapter_id}")
                    chapter_text = chapter_data.get('chapter_text', '')
                    
                    # Create section object with objectives, ensuring text and title are exposed, and include book_title and chapter info
                    section_data = {
                        "book_id": section_book_id,
                        "chapter_id": section_chapter_id,
                        "section_id": section_id,
                        "book_title": book_id_to_title.get(section_book_id, f"Book {section_book_id}"),
                        "chapter_title": chapter_title,
                        "chapter_text": chapter_text,
                        "title": section.get('title') or section.get('name') or f"Section {section_id}",
                        "text": section.get('text') or section.get('summary') or section.get('content') or section.get('description') or '',
                        "objectives": section_objectives,
                        **{k: v for k, v in section.items() if k not in ['_id']}  # Include all other fields
                    }
                    
                    sections_extracted.append(section_data)
                    selected_sections.append(section_data)
        
        selected_chapters_count = len(selected_chapters)
        selected_sections_count = len(selected_sections)
        
        # Calculate involved books count - unique books from book_ids, selected_chapters, and selected_sections
        involved_book_ids = set(book_ids)
        
        # Add books from selected chapters
        for chapter in selected_chapters:
            chapter_book_id = chapter.get('book_id')
            if chapter_book_id:
                involved_book_ids.add(chapter_book_id)
        
        # Add books from selected sections
        for section in selected_sections:
            section_book_id = section.get('book_id')
            if section_book_id:
                involved_book_ids.add(section_book_id)
        
        involved_books_count = len(involved_book_ids)
        
        # Generate course ID
        course_id = f"course-{hashlib.sha256(f'{title}{datetime.now().isoformat()}'.encode()).hexdigest()[:16]}"
        
        # Ensure selected_chapters and selected_sections are always arrays (not None or missing)
        if not isinstance(selected_chapters, list):
            selected_chapters = []
        if not isinstance(selected_sections, list):
            selected_sections = []
        
        # Recalculate counts from actual arrays to ensure accuracy
        selected_chapters_count = len(selected_chapters)
        selected_sections_count = len(selected_sections)
        
        # Debug logging
        print(f"DEBUG: selected_chapters count: {len(selected_chapters)}")
        print(f"DEBUG: selected_sections count: {len(selected_sections)}")
        print(f"DEBUG: selected_chapters_count: {selected_chapters_count}")
        print(f"DEBUG: selected_sections_count: {selected_sections_count}")
        if len(selected_chapters) > 0:
            print(f"DEBUG: selected_chapters sample: {selected_chapters[0]}")
        if len(selected_sections) > 0:
            print(f"DEBUG: selected_sections sample: {selected_sections[0]}")
        
        # Combine chapters and sections into hierarchical structure (sections nested under chapters)
        combined_structure = []
        for chapter in selected_chapters:
            chapter_id = chapter.get('chapter_id')
            # Create chapter object with its sections
            chapter_with_sections = chapter.copy()
            # Find all sections that belong to this chapter
            chapter_sections = [
                section for section in selected_sections 
                if section.get('chapter_id') == chapter_id
            ]
            chapter_with_sections['sections'] = chapter_sections
            combined_structure.append(chapter_with_sections)
        
        # Also include sections that don't belong to any selected chapter (standalone sections)
        chapter_ids_in_structure = {ch.get('chapter_id') for ch in selected_chapters}
        standalone_sections = [
            section for section in selected_sections 
            if section.get('chapter_id') not in chapter_ids_in_structure
        ]
        
        # If there are standalone sections, add them as chapters without chapter data
        for section in standalone_sections:
            # Create a minimal chapter structure for standalone sections
            standalone_chapter = {
                "chapter_title": section.get('chapter_title', ''),
                "chapter_text": section.get('chapter_text', '')
            }
            combined_structure.append(standalone_chapter)
        
        # Create course data with hierarchical structure
        course_data = {
            "id": course_id,
            "title": title,
            "description": description,
            # "books": serialized_books,  # Store complete book data, properly serialized
            # "course_structure": course_structure,  # Hierarchical structure: Book -> Chapter -> Section -> Objectives
            # "chapter_ids": chapter_ids,  # Array of chapter IDs (chapters stored separately during book upload)
            # "section_ids": section_ids,  # Array of section IDs (sections stored separately during book upload)
            "selected_chapters": selected_chapters,  # Array of {book_id, chapter_id, text, text_id} for frontend compatibility
            "selected_sections": selected_sections,  # Array of {book_id, chapter_id, section_id, text, text_id} for frontend compatibility
            "combined_structure": combined_structure,  # Hierarchical structure: Chapters with sections nested inside
            # Only store counts for selected items, not total counts
            "totalSections": selected_sections_count,  # Only selected sections
            "totalChapters": selected_chapters_count,  # Only selected chapters
            "selectedChaptersCount": selected_chapters_count,
            "selectedSectionsCount": selected_sections_count,
            "involvedBooksCount": involved_books_count,  # Count of unique books involved in the course
            "book_ids": list(involved_book_ids),  # List of unique book IDs involved
            # "objectives": default_objectives[:len(selected_books) * 3],  # Limit to reasonable number
            "created_at": datetime.now().isoformat()
        }
        print(f"---------------------------------------DEBUG: course_data: {course_data}")
        print(f"DEBUG: selected_chapters: {selected_chapters}")
        print(f"DEBUG: selected_sections: {selected_sections}")
        print(f"DEBUG: selected_chapters_count: {selected_chapters_count}")
        print(f"DEBUG: selected_sections_count: {selected_sections_count}")
        print(f"DEBUG: totalSections: {selected_sections_count}")
        print(f"DEBUG: totalChapters: {selected_chapters_count}")
        print(f"DEBUG: selectedChaptersCount: {selected_chapters_count}")
        print(f"DEBUG: selectedSectionsCount: {selected_sections_count}")
        
        # Save course to MongoDB (source of truth)
        # This will persist all book data including metadata, chapters, description, etc.
        save_course_to_mongodb(course_data)
        
        return jsonify({
            "success": True,
            "message": "Course created successfully",
            "course": course_data
        }), 201
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/courses', methods=['GET'])
def get_courses():
    """Get all courses from MongoDB."""
    try:
        courses = load_courses_from_mongodb()
        return jsonify(courses), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/assessments/create', methods=['POST'])
def create_assessment():
    """Create an assessment (Test, Homework, or Exam) - saves metadata only, questions generated on launch."""
    try:
        data = request.get_json()
        
        assessment_type = data.get('type', 'test')  # test, homework, exam
        source_type = data.get('sourceType')  # book, course, section
        source = data.get('source', {})
        source_id = source.get('id') if isinstance(source, dict) else None
        selected_sections = data.get('selectedSections', [])
        num_questions = data.get('numQuestions', 10)
        difficulty = data.get('difficulty', 'medium')
        question_types = data.get('questionTypes', {})
        objectives = data.get('objectives', [])
        title = data.get('title', f"{assessment_type.title()} Assessment")
        
        if not source_type:
            return jsonify({"error": "sourceType is required"}), 400
        
        # Generate assessment ID
        assessment_id = f"assessment-{hashlib.sha256(f'{title}{datetime.now().isoformat()}'.encode()).hexdigest()[:16]}"
        
        # Save assessment metadata without questions (questions will be generated on launch)
        assessment_data = {
            "id": assessment_id,
            "type": assessment_type,
            "title": title,
            "questions": [],  # Empty - will be generated on launch
            "numQuestions": num_questions,
            "difficulty": difficulty,
            "questionTypes": question_types,
            "objectives": objectives,
            "sourceType": source_type,
            "sourceId": source_id,
            "source": source,  # Store full source object for reference
            "selectedSections": selected_sections,  # Store selected sections for section-based assessments
            "status": "pending",  # Status: pending, generating, ready
            "created_at": datetime.now().isoformat()
        }
        
        # Save assessment to MongoDB (source of truth)
        save_assessment_to_mongodb(assessment_data)
        
        return jsonify({
            "success": True,
            "message": f"{assessment_type.title()} created successfully. Questions will be generated when you launch the assessment.",
            "assessment": assessment_data
        }), 201
        
    except Exception as e:
        import traceback
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500


@app.route('/api/assessments', methods=['GET'])
def get_assessments():
    """Get all assessments from MongoDB."""
    try:
        assessments = load_assessments_from_mongodb()
        return jsonify(assessments), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/assessments/<assessment_id>', methods=['GET'])
def get_assessment(assessment_id):
    """Get a specific assessment by ID from MongoDB."""
    try:
        assessment = load_assessment_by_id_from_mongodb(assessment_id)
        if assessment:
            return jsonify(assessment), 200
        else:
            return jsonify({"error": "Assessment not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/assessments/<assessment_id>/questions/<int:question_index>', methods=['PUT'])
def update_assessment_question(assessment_id, question_index):
    """Update a specific question in an assessment."""
    try:
        # Load assessment from MongoDB
        assessment = load_assessment_by_id_from_mongodb(assessment_id)
        
        if not assessment:
            return jsonify({"error": "Assessment not found"}), 404
        
        questions = assessment.get('questions', [])
        if question_index < 0 or question_index >= len(questions):
            return jsonify({"error": f"Question index {question_index} out of range"}), 400
        
        # Get updated question data from request
        data = request.get_json()
        if not data:
            return jsonify({"error": "No question data provided"}), 400
        
        # Update the question at the specified index
        questions[question_index] = {**questions[question_index], **data}
        assessment['questions'] = questions
        
        # Add updated_at timestamp
        assessment['updated_at'] = datetime.now().isoformat()
        
        # Save updated assessment to MongoDB
        save_assessment_to_mongodb(assessment)
        
        return jsonify({
            "success": True,
            "message": "Question updated successfully",
            "assessment": assessment
        }), 200
        
    except Exception as e:
        import traceback
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500


@app.route('/api/assessments/<assessment_id>', methods=['DELETE'])
def delete_assessment(assessment_id):
    """Delete an assessment from MongoDB."""
    try:
        collection = get_mongodb_assessments_collection()
        
        if collection is not None:
            # Delete from MongoDB
            result = collection.delete_one({'id': assessment_id})
            
            if result.deleted_count > 0:
                return jsonify({
                    "success": True,
                    "message": "Assessment deleted successfully"
                }), 200
            else:
                return jsonify({"error": "Assessment not found"}), 404
        else:
            # Fallback: delete from local file
            assessments_file = UPLOAD_DIR / 'assessments.json'
            if assessments_file.exists():
                with open(assessments_file, 'r') as f:
                    assessments = json.load(f)
                
                # Filter out the deleted assessment
                updated_assessments = [a for a in assessments if a.get('id') != assessment_id]
                
                if len(updated_assessments) < len(assessments):
                    with open(assessments_file, 'w') as f:
                        json.dump(updated_assessments, f, indent=2)
                    return jsonify({
                        "success": True,
                        "message": "Assessment deleted successfully"
                    }), 200
                else:
                    return jsonify({"error": "Assessment not found"}), 404
            else:
                return jsonify({"error": "Assessment not found"}), 404
                
    except Exception as e:
        import traceback
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500


@app.route('/api/assessments/<assessment_id>/generate', methods=['POST'])
def generate_assessment_questions_endpoint(assessment_id):
    """Generate questions for an assessment when it is launched."""
    import asyncio
    
    try:
        # Get course_id from request body if provided
        data = request.get_json() or {}
        course_id_from_request = data.get('course_id')
        
        # Get course data by using course ID and extract selected_chapters and selected_sections
        course_selected_chapters = []
        course_selected_sections = []
        course_combined_structure = []
        
        if course_id_from_request:
            try:
                # Get course directly from MongoDB by course_id
                courses_collection = get_mongodb_courses_collection()
                course_data = None
                if courses_collection is not None:
                    course_data = courses_collection.find_one({'id': course_id_from_request}, {'_id': 0})
                    if course_data:
                        # Ensure required fields exist
                        if 'selected_chapters' not in course_data:
                            course_data['selected_chapters'] = []
                        if 'selected_sections' not in course_data:
                            course_data['selected_sections'] = []
                        if 'books' not in course_data:
                            course_data['books'] = []
                
                if course_data:
                    # Extract selected chapters and sections from course
                    course_selected_chapters = course_data.get('selected_chapters', [])
                    course_selected_sections = course_data.get('selected_sections', [])
                    course_combined_structure = course_data.get('combined_structure', [])
                    print('++++++++++++++++++++++++')
                    print('course_selected_sections--', course_selected_chapters)
                    print('++++++++++++++++++++++++')
                    print(f"DEBUG: Loaded course {course_id_from_request} - chapters: {len(course_selected_chapters)}, sections: {len(course_selected_sections)}")
                    
                    
                    print(f"DEBUG: Enriched course data - chapters with content: {sum(1 for ch in course_selected_chapters if ch.get('text'))}, sections with content: {sum(1 for sec in course_selected_sections if sec.get('text'))}")
            except Exception as e:
                print(f"DEBUG: Error loading course data for course_id {course_id_from_request}: {e}")
                import traceback
                traceback.print_exc()
        
        # Load assessment from MongoDB directly by ID
        assessment = load_assessment_by_id_from_mongodb(assessment_id)
        
        if not assessment:
            return jsonify({"error": "Assessment not found"}), 404
        
        # Check if questions already exist
        if assessment.get('questions') and len(assessment.get('questions', [])) > 0:
            return jsonify({
                "success": True,
                "message": "Questions already generated",
                "assessment": assessment
            }), 200
        
        # Check if generation is already in progress
        # Note: We allow retries if status is 'generating' (handles cases where previous attempt failed)
        # The status check prevents duplicate concurrent calls within the same request cycle
        
        # Update status to generating
        assessment['status'] = 'generating'
        save_assessment_to_mongodb(assessment)
        
        # Get assessment parameters
        assessment_type = assessment.get('type', 'test')
        source_type = assessment.get('sourceType')
        source_id = assessment.get('sourceId')
        source = assessment.get('source', {})
        selected_sections = assessment.get('selectedSections', [])
        num_questions = assessment.get('numQuestions', 10)
        difficulty = assessment.get('difficulty', 'medium')
        question_types = assessment.get('questionTypes', {})
        objectives = assessment.get('objectives', [])
        
        
        # Get books from course or assessment source and set up multi-index search
        assessment_content = []
        books = []
        book_ids = set()
        project_path = None
        multi_index_config_path = None  # Will hold path to temporary multi-index config if created
        
        if source_type == 'course':
            # Get book_ids from course_selected_chapters and course_selected_sections
            for chapter in course_selected_chapters:
                if chapter.get('book_id'):
                    book_ids.add(chapter['book_id'])
            for section in course_selected_sections:
                if section.get('book_id'):
                    book_ids.add(section['book_id'])
            
            # Load books from MongoDB
            if book_ids:
                uploaded_books = load_books_from_mongodb()
                books = [book for book in uploaded_books if (book.get('id') or book.get('book_id')) in book_ids]
                
                graphrag_store_dir = BASE_DIR / 'indexes'
                
                # Get first book_id (used for both single and multi-index cases)
                first_book_id = list(book_ids)[0] if book_ids else None
                
                if not first_book_id:
                    assessment['status'] = 'error'
                    save_assessment_to_mongodb(assessment)
                    return jsonify({"error": "No valid book IDs found in course"}), 500
                
                # Helper function to fix vector_store structure
                def fix_vector_store_structure(settings_dict):
                    """Convert flat vector_store format to nested format if needed."""
                    if 'vector_store' in settings_dict:
                        vs = settings_dict['vector_store']
                        # Check if it's in flat format (has 'type' and 'db_uri' as direct keys, not nested)
                        # Flat format: {type: 'lancedb', db_uri: 'output/lancedb'}
                        # Nested format: {default_vector_store: {type: 'lancedb', db_uri: 'output/lancedb'}}
                        if isinstance(vs, dict):
                            # Check if it's already in nested format (has a key that maps to a dict with 'type' or 'db_uri')
                            has_nested_structure = any(
                                isinstance(v, dict) and ('type' in v or 'db_uri' in v)
                                for v in vs.values()
                            )
                            
                            # If it has 'type' and 'db_uri' as direct keys AND no nested structure, convert it
                            if 'type' in vs and 'db_uri' in vs and not has_nested_structure:
                                # Convert flat format to nested format
                                vs_type = vs.pop('type')
                                vs_db_uri = vs.pop('db_uri', 'output/lancedb')
                                # Keep any other keys that might exist
                                other_keys = {k: v for k, v in vs.items() if k not in ['type', 'db_uri']}
                                settings_dict['vector_store'] = {
                                    'default_vector_store': {
                                        'type': vs_type,
                                        'db_uri': vs_db_uri,
                                        'container_name': 'default',
                                        **other_keys
                                    }
                                }
                                print(f"DEBUG: Converted vector_store from flat to nested format")
                                print(f"DEBUG: New vector_store structure: {settings_dict['vector_store']}")
                                return True
                    return False
                
                # If multiple books, create multi-index config
                if len(book_ids) > 1:
                    # Create temporary multi-index settings.yaml
                    # Use first book's settings.yaml as template
                    template_settings_path = graphrag_store_dir / first_book_id / 'settings.yaml'
                    
                    if template_settings_path.exists():
                        # Read template settings
                        with open(template_settings_path, 'r') as f:
                            settings = yaml.safe_load(f)
                        
                        # Fix vector_store structure
                        fix_vector_store_structure(settings)
                        
                        # Create outputs dictionary for multi-index search
                        settings['outputs'] = {}
                        for bid in book_ids:
                            # Use relative path from graphrag-store root
                            book_output_path = str(Path(bid) / 'output')
                            # Use book_id as index name
                            settings['outputs'][bid] = {
                                'type': 'file',
                                'base_dir': book_output_path
                            }
                        
                        # Remove single output if exists
                        if 'output' in settings:
                            del settings['output']
                        
                        # Create temporary config file in graphrag-store root
                        multi_index_config_path = graphrag_store_dir / 'multi_index_settings.yaml'
                        with open(multi_index_config_path, 'w') as f:
                            yaml.dump(settings, f, default_flow_style=False, sort_keys=False)
                        
                        # Use graphrag-store root as project_path for multi-index
                        project_path = str(graphrag_store_dir)
                        # Convert Path to string for config_filepath
                        multi_index_config_path = str(multi_index_config_path)
                        print(f"DEBUG: Created multi-index config with {len(book_ids)} indexes: {list(book_ids)}")
                        print(f"DEBUG: Multi-index config path: {multi_index_config_path}")
                    else:
                        # Fallback to single index if template not found
                        project_path = str(graphrag_store_dir / first_book_id)
                        print(f"DEBUG: Template settings.yaml not found, using single index: {first_book_id}")
                else:
                    # Single book - create temporary fixed config to handle vector_store structure
                    single_book_settings_path = graphrag_store_dir / first_book_id / 'settings.yaml'
                    if single_book_settings_path.exists():
                        # Read and fix the settings
                        with open(single_book_settings_path, 'r') as f:
                            settings = yaml.safe_load(f)
                        
                        # Fix vector_store structure if needed
                        if fix_vector_store_structure(settings):
                            # Create temporary fixed config
                            temp_config_path = graphrag_store_dir / first_book_id / 'temp_settings_fixed.yaml'
                            with open(temp_config_path, 'w') as f:
                                yaml.dump(settings, f, default_flow_style=False, sort_keys=False)
                            project_path = str(graphrag_store_dir / first_book_id)
                            multi_index_config_path = str(temp_config_path)
                            print(f"DEBUG: Created fixed config for single book: {multi_index_config_path}")
                        else:
                            # No fix needed, use original
                            project_path = str(graphrag_store_dir / first_book_id)
                            print(f"DEBUG: Using original settings.yaml for single book: {first_book_id}")
                    else:
                        project_path = str(graphrag_store_dir / first_book_id)
                        print(f"DEBUG: Settings.yaml not found for book: {first_book_id}")
        elif source_type == 'book' and source:
            # For book source, use the source book
            book_id = source.get('id') or source.get('book_id')
            if book_id:
                books = [source] if isinstance(source, dict) else [source]
                graphrag_store_dir = BASE_DIR / 'indexes'
                project_path = str(graphrag_store_dir / book_id)
        
        # If no project_path found, return error
        if not project_path:
            assessment['status'] = 'error'
            save_assessment_to_mongodb(assessment)
            return jsonify({"error": "Could not determine GraphRAG project path. Please ensure the book has been processed."}), 500
        
        # Helper function to run async code
        async def run_assessment_generation():
            nonlocal project_path, books, num_questions, difficulty, question_types, objectives, assessment_type
            nonlocal course_selected_chapters, course_selected_sections, course_combined_structure, selected_sections, multi_index_config_path
            
            # Use combined_structure if available (preferred), otherwise fall back to separate chapters/sections
            combined_structure_to_use = course_combined_structure if course_combined_structure else None
            chapters_to_use = course_selected_chapters if course_selected_chapters else []
            sections_to_use = course_selected_sections if course_selected_sections else selected_sections
            
            # Generate questions using GraphRAG
            questions = await generate_assessment_with_graphrag(
                project_path=project_path,
                num_questions=num_questions,
                difficulty=difficulty,
                question_types=question_types,
                objectives=objectives,
                assessment_type=assessment_type,
                section_ids=None,  # Can be extracted from selected_sections if needed
                selected_chapters=chapters_to_use,
                selected_sections=sections_to_use,
                combined_structure=combined_structure_to_use,
                config_filepath=multi_index_config_path  # Pass multi-index config if created
            )
            
            return questions
        
        # Run async function directly in a new event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            questions = loop.run_until_complete(run_assessment_generation())
            if questions:
                random.shuffle(questions)
        except Exception as e:
            import traceback
            error_traceback = traceback.format_exc()
            error_message = str(e)
            print(f"ERROR generating questions: {error_message}")
            print(f"Traceback: {error_traceback}")
            assessment['status'] = 'error'
            save_assessment_to_mongodb(assessment)
            loop.close()
            return jsonify({
                "error": error_message,
                "traceback": error_traceback
            }), 500
        finally:
            loop.close()
            # Clean up temporary multi-index config file if created
            if multi_index_config_path:
                try:
                    config_path = Path(multi_index_config_path)
                    if config_path.exists():
                        config_path.unlink()
                        print(f"DEBUG: Cleaned up temporary multi-index config: {multi_index_config_path}")
                except Exception as e:
                    print(f"DEBUG: Error cleaning up temp config: {e}")
        
        if not questions:
            assessment['status'] = 'error'
            save_assessment_to_mongodb(assessment)
            return jsonify({"error": "Failed to generate questions"}), 500
        
        # Update assessment with generated questions
        assessment['questions'] = questions
        assessment['status'] = 'ready'
        save_assessment_to_mongodb(assessment)
        
        return jsonify({
            "success": True,
            "message": f"Generated {len(questions)} questions successfully",
            "assessment": assessment
        }), 200
        
    except Exception as e:
        import traceback
        error_traceback = traceback.format_exc()
        error_message = str(e)
        
        print(f"ERROR in generate_assessment_questions_endpoint: {error_message}")
        print(f"Traceback: {error_traceback}")
        
        # Try to update assessment status to error
        try:
            assessments = load_assessments_from_mongodb()
            assessment = next((a for a in assessments if a.get('id') == assessment_id), None)
            if assessment:
                assessment['status'] = 'error'
                save_assessment_to_mongodb(assessment)
        except Exception as update_error:
            print(f"ERROR updating assessment status: {update_error}")
        
        return jsonify({
            "error": error_message,
            "traceback": error_traceback,
            "assessment_id": assessment_id
        }), 500


async def generate_assessment_with_graphrag(project_path, num_questions, difficulty, question_types, objectives, assessment_type, section_ids=None, selected_chapters=None, selected_sections=None, combined_structure=None, config_filepath=None):
    """Generate assessment questions using GraphRAG based on selected chapters, sections, and objectives."""
    
    # Input validation
    if not project_path:
        raise ValueError("project_path is required")
    if not isinstance(num_questions, int) or num_questions < 1:
        num_questions = 10
    
    # Build question type list
    question_type_list = []
    if question_types and isinstance(question_types, dict):
        if question_types.get("multipleChoice"):
            question_type_list.append("multiple_choice")
        if question_types.get("shortAnswer"):
            question_type_list.append("short_answer")
        if question_types.get("essay"):
            question_type_list.append("essay")
        if question_types.get("trueFalse"):
            question_type_list.append("true_false")
    
    if not question_type_list:
        question_type_list = ["short_answer", "multiple_choice"]
    
    # Collect content from combined_structure if available (preferred method)
    chapters_content = []
    sections_content = []
    
    if combined_structure and isinstance(combined_structure, list):
        # Use combined_structure directly from MongoDB
        print("DEBUG: Using combined_structure from MongoDB")
        print(f"DEBUG: combined_structure has {len(combined_structure)} chapters")
        
        total_sections = 0
        for chapter_item in combined_structure[:10]:  # Limit to 10 chapters for prompt size
            # Extract chapter content
            chapter_text = chapter_item.get('text', '') or chapter_item.get('chapter_text', '')
            chapter_title = chapter_item.get('title', '') or chapter_item.get('chapter_title', '')
            
            if chapter_text:
                chapters_content.append(f"Chapter: {chapter_text}\n")
    
            # Extract sections from this chapter
            chapter_sections = chapter_item.get('sections', [])
            if chapter_sections:
                print(f"DEBUG: Chapter '{chapter_title}' has {len(chapter_sections)} sections")
                total_sections += len(chapter_sections)
                
                for section_obj in chapter_sections[:15]:  # Limit sections per chapter
                    section_text = section_obj.get('text', '')
                    section_title = section_obj.get('title', '')
            
            if section_text:
                sections_content.append(f"Section: {section_text}\n")
    
        print(f"DEBUG: Extracted {len(chapters_content)} chapters and {len(sections_content)} sections from combined_structure")
        print(f"DEBUG: Total sections in structure: {total_sections}")
    else:
        # Fallback to separate selected_chapters and selected_sections
        print("DEBUG: Using separate selected_chapters and selected_sections")
    
    # Build the content context
    content_parts = []
    
    if chapters_content:
        content_parts.append("SELECTED CHAPTERS CONTENT:")
        content_parts.extend([f"  {i+1}. {ch}" for i, ch in enumerate(chapters_content)])
    
    if sections_content:
        content_parts.append("\nSELECTED SECTIONS CONTENT:")
        content_parts.extend([f"  {i+1}. {sec}" for i, sec in enumerate(sections_content)])
    
    content_context = "\n".join(content_parts) if content_parts else "the provided educational content"
    
    # Build the prompt
    assessment_type_name = assessment_type.title() if assessment_type else "Test"
    difficulty_level = difficulty.title() if difficulty else "Medium"
    
    prompt = f"""Generate exactly {num_questions} high-quality {assessment_type_name} questions ({difficulty_level} difficulty) based on the following content:

{content_context}

REQUIREMENTS:

1. QUESTION TYPES: Create a diverse mix of: {', '.join(question_type_list)} only
   - Distribute questions evenly across all types
   - Each question must be one of these types only

2. CONTENT SCOPE: 
   - Generate questions ONLY from the chapters and sections provided above
   - Focus on key concepts, important details, and relationships from the specified content

3. QUESTION QUALITY:
   - Clear, unambiguous, and educationally valuable
   - Test understanding, application, analysis, and critical thinking
   - Appropriate for {difficulty_level} difficulty level

4. MULTILINGUAL: Provide ALL content in BOTH English and Sinhala
   - Every question, option, answer, and explanation must have both English and Sinhala versions
   - Use field names with "_sinhala" suffix for Sinhala versions

OUTPUT FORMAT (JSON array only, no other text):
[
  {{
    "question_number": 1,
    "question_type": "multiple_choice|short_answer|essay|true_false",
    "question": "Question text in English",
    "question_sinhala": "ප්‍රශ්නය සිංහලෙන්",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "options_sinhala": ["විකල්පය A", "විකල්පය B", "විකල්පය C", "විකල්පය D"],
    "correct_answer": "Correct answer in English",
    "correct_answer_sinhala": "නිවැරදි පිළිතුර සිංහලෙන්",
    "explanation": "Explanation in English",
    "explanation_sinhala": "පැහැදිලි කිරීම සිංහලෙන්",
    "difficulty": "{difficulty_level}",
    "points": 1
  }}
]

CRITICAL: Every question MUST include both English and Sinhala versions for all fields (question, options, correct_answer, explanation).
Generate exactly {num_questions} questions based on the provided content."""
    
    # Generate questions using GraphRAG
    questions = []
    try:
        print(f"Generating {num_questions} {assessment_type_name} questions using GraphRAG...")
        print(f"DEBUG: Using project_path: {project_path}")
        if config_filepath:
            print(f"DEBUG: Using multi-index config: {config_filepath}")
        
        print(f"DEBUG: project_path: {project_path}")   
        print(f"DEBUG: config_filepath: {config_filepath}") 
        response, context = await run_query(
            root_dir=project_path,
            query=prompt,
            method="local",
            community_level=0,  # Use community level 0 for local search
            response_type="json",
            dynamic_community_selection=True,
            config_filepath=config_filepath  # Pass multi-index config if provided
        )

        
        if response:
            questions = await parse_questions_from_response(
                response, num_questions, question_type_list, difficulty, assessment_type, project_path
            )
            
            # Ensure all questions have Sinhala versions - translate if missing
            if questions and project_path:
                needs_translation = False
                for q in questions:
                    if (not q.get("question_sinhala") and q.get("question")) or \
                       (not q.get("correct_answer_sinhala") and q.get("correct_answer")) or \
                       (not q.get("explanation_sinhala") and q.get("explanation")) or \
                       (q.get("options") and not q.get("options_sinhala")):
                        needs_translation = True
                        break
                
                if needs_translation:
                    print("Translating missing Sinhala versions...")
                    questions = await translate_questions_to_sinhala(questions, project_path)
        else:
            raise Exception("Empty response from GraphRAG")
            
    except Exception as e:
        print(f"Error in GraphRAG question generation: {e}")
        import traceback
        traceback.print_exc()
        
        # Fallback to basic generation
        if not questions:
            print("Falling back to basic question generation...")
            questions = generate_assessment_questions_fallback(
                None, None, num_questions, difficulty, question_types, objectives
            )
    
    # Return the requested number of questions
    return questions[:num_questions] if questions else []


async def translate_questions_to_sinhala(questions, project_path):
    """Translate English questions to Sinhala using GraphRAG if translations are missing."""
    if not questions or not project_path:
        return questions
    
    # Check if any questions need translation
    needs_translation = False
    for q in questions:
        if (not q.get("question_sinhala") and q.get("question")) or \
           (not q.get("correct_answer_sinhala") and q.get("correct_answer")) or \
           (not q.get("explanation_sinhala") and q.get("explanation")) or \
           (q.get("options") and not q.get("options_sinhala")):
            needs_translation = True
            break
    
    if not needs_translation:
        return questions
    
    print("Translating questions to Sinhala...")
    
    try:
        # Use GraphRAG to translate in a batch to reduce event loop conflicts
        from run_queries import run_query
        import re
        
        # Get current event loop to ensure we're using the right one
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = asyncio.get_event_loop()
        
        # Batch translation: collect all items to translate, then translate in one go
        translation_items = []
        for idx, q in enumerate(questions):
            if not q.get("question_sinhala") and q.get("question"):
                translation_items.append(("question", idx, q['question']))
            if q.get("options") and (not q.get("options_sinhala") or len(q.get("options_sinhala", [])) == 0):
                for opt_idx, opt in enumerate(q["options"]):
                    translation_items.append(("option", idx, opt_idx, opt))
            if not q.get("correct_answer_sinhala") and q.get("correct_answer"):
                translation_items.append(("answer", idx, q['correct_answer']))
            if not q.get("explanation_sinhala") and q.get("explanation"):
                translation_items.append(("explanation", idx, q['explanation']))
        
        # Translate in smaller batches to avoid overwhelming the event loop
        batch_size = 5
        for batch_start in range(0, len(translation_items), batch_size):
            batch = translation_items[batch_start:batch_start + batch_size]
            
            # Create a batch translation prompt
            batch_text = "\n".join([f"{item[-1]}" for item in batch])
            batch_prompt = f"Translate the following English educational content to Sinhala. Provide only the Sinhala translations, one per line, nothing else:\n{batch_text}"
            
            try:
                trans_response, _ = await run_query(
                    root_dir=project_path,
                    query=batch_prompt,
                    method="local",
                    response_type="text"
                )
                
                # Parse translations (assuming one per line or separated)
                translations = [line.strip() for line in trans_response.strip().split('\n') if line.strip()]
                
                # Apply translations
                for batch_idx, item in enumerate(batch):
                    if batch_idx < len(translations):
                        trans_text = translations[batch_idx]
                        # Clean translation
                        trans_text = re.sub(r'^(Translation|Sinhala|පරිවර්තනය)[:\s]*', '', trans_text, flags=re.IGNORECASE).strip()
                        
                        item_type = item[0]
                        q_idx = item[1]
                        q = questions[q_idx]
                        
                        if item_type == "question":
                            q["question_sinhala"] = trans_text
                        elif item_type == "option":
                            opt_idx = item[2]
                            if not q.get("options_sinhala"):
                                q["options_sinhala"] = [""] * len(q.get("options", []))
                            if opt_idx < len(q["options_sinhala"]):
                                q["options_sinhala"][opt_idx] = trans_text
                        elif item_type == "answer":
                            q["correct_answer_sinhala"] = trans_text
                        elif item_type == "explanation":
                            q["explanation_sinhala"] = trans_text
            except Exception as batch_error:
                print(f"Error in batch translation: {batch_error}")
                # Fall back to individual translations for this batch
                for item in batch:
                    try:
                        item_type = item[0]
                        q_idx = item[1]
                        q = questions[q_idx]
                        text_to_translate = item[-1] if item_type != "option" else item[-1]
                        
                        trans_prompt = f"Translate to Sinhala: {text_to_translate}"
                        trans_response, _ = await run_query(
                            root_dir=project_path,
                            query=trans_prompt,
                            method="global",
                            response_type="text"
                        )
                        trans_text = trans_response.strip().split('\n')[0].strip()
                        trans_text = re.sub(r'^(Translation|Sinhala|පරිවර්තනය)[:\s]*', '', trans_text, flags=re.IGNORECASE).strip()
                        
                        if item_type == "question":
                            q["question_sinhala"] = trans_text
                        elif item_type == "option":
                            opt_idx = item[2]
                            if not q.get("options_sinhala"):
                                q["options_sinhala"] = [""] * len(q.get("options", []))
                            if opt_idx < len(q["options_sinhala"]):
                                q["options_sinhala"][opt_idx] = trans_text
                        elif item_type == "answer":
                            q["correct_answer_sinhala"] = trans_text
                        elif item_type == "explanation":
                            q["explanation_sinhala"] = trans_text
                    except Exception as e:
                        print(f"Error translating individual item: {e}")
                        continue
        
    except Exception as e:
        print(f"Error translating to Sinhala: {e}")
        import traceback
        traceback.print_exc()
        # Continue with English-only questions if translation fails
    
    return questions


async def translate_questions_to_sinhala_simple(questions, project_path):
    """Simple translation function that works within the same event loop context."""
    if not questions or not project_path:
        return questions
    
    from run_queries import run_query
    import re
    
    print(f"Translating {len(questions)} questions to Sinhala...")
    
    # Translate in a single batch to minimize API calls and event loop issues
    translation_pairs = []
    for idx, q in enumerate(questions):
        if q.get("question") and (not q.get("question_sinhala") or not q.get("question_sinhala").strip()):
            translation_pairs.append(("question", idx, q["question"]))
        
        if q.get("options"):
            if not q.get("options_sinhala") or len(q.get("options_sinhala", [])) == 0:
                for opt_idx, opt in enumerate(q["options"]):
                    translation_pairs.append(("option", idx, opt_idx, opt))
        
        if q.get("correct_answer") and (not q.get("correct_answer_sinhala") or not q.get("correct_answer_sinhala").strip()):
            translation_pairs.append(("answer", idx, q["correct_answer"]))
        
        if q.get("explanation") and (not q.get("explanation_sinhala") or not q.get("explanation_sinhala").strip()):
            translation_pairs.append(("explanation", idx, q["explanation"]))
    
    if not translation_pairs:
        return questions
    
    # Create a single translation prompt for all items
    items_to_translate = [pair[-1] for pair in translation_pairs]
    translation_text = "\n".join([f"{i+1}. {item}" for i, item in enumerate(items_to_translate)])
    
    translation_prompt = f"""Translate the following English educational content to Sinhala. 
Provide the translations in the same order, one per line, numbered 1-{len(items_to_translate)}.
Provide ONLY the Sinhala translations, nothing else.

Content to translate:
{translation_text}"""
    
    try:
        trans_response, _ = await run_query(
            root_dir=project_path,
            query=translation_prompt,
            method="global",
            response_type="text"
        )
        
        # Parse translations (one per line, numbered)
        lines = [line.strip() for line in trans_response.strip().split('\n') if line.strip()]
        translations = []
        for line in lines:
            # Remove numbering if present (e.g., "1. translation" -> "translation")
            cleaned = re.sub(r'^\d+[\.\)]\s*', '', line).strip()
            if cleaned:
                translations.append(cleaned)
        
        # Apply translations
        for pair_idx, pair in enumerate(translation_pairs):
            if pair_idx < len(translations):
                trans_text = translations[pair_idx]
                item_type = pair[0]
                q_idx = pair[1]
                q = questions[q_idx]
                
                if item_type == "question":
                    q["question_sinhala"] = trans_text
                elif item_type == "option":
                    opt_idx = pair[2]
                    if not q.get("options_sinhala"):
                        q["options_sinhala"] = [""] * len(q.get("options", []))
                    if opt_idx < len(q["options_sinhala"]):
                        q["options_sinhala"][opt_idx] = trans_text
                elif item_type == "answer":
                    q["correct_answer_sinhala"] = trans_text
                elif item_type == "explanation":
                    q["explanation_sinhala"] = trans_text
    
    except RuntimeError as e:
        # Catch event loop errors specifically - these occur when queues are bound to different loops
        if "bound to a different event loop" in str(e):
            print(f"Translation skipped due to event loop conflict: {e}")
            print("Sinhala translations will be empty. GraphRAG should generate them in the initial response.")
            # Ensure all Sinhala fields exist (empty)
            for q in questions:
                if not q.get("question_sinhala"):
                    q["question_sinhala"] = ""
                if not q.get("options_sinhala"):
                    q["options_sinhala"] = []
                if not q.get("correct_answer_sinhala"):
                    q["correct_answer_sinhala"] = ""
                if not q.get("explanation_sinhala"):
                    q["explanation_sinhala"] = ""
        else:
            raise  # Re-raise if it's a different RuntimeError
    except Exception as e:
        print(f"Batch translation failed: {e}")
        import traceback
        traceback.print_exc()
        # Don't fall back to individual translations if we're in an event loop conflict
        # Just ensure fields exist
        for q in questions:
            if not q.get("question_sinhala"):
                q["question_sinhala"] = ""
            if not q.get("options_sinhala"):
                q["options_sinhala"] = []
            if not q.get("correct_answer_sinhala"):
                q["correct_answer_sinhala"] = ""
            if not q.get("explanation_sinhala"):
                q["explanation_sinhala"] = ""
    
    return questions


import asyncio
from googletrans import Translator

async def translate_text_to_sinhala(question_text: str) -> str:
    translator = Translator()
    translation = await translator.translate(question_text, src="en", dest="si")
    return translation.text;

async def translate_list_to_sinhala(items):
    """Translate a list of English strings to Sinhala using googletrans."""
    if not items or not isinstance(items, list):
        return []

    translated_items = []
    for item in items:
        text = str(item).strip() if item is not None else ""
        if not text:
            translated_items.append("")
            continue
        try:
            translated_items.append(await translate_text_to_sinhala(text))
        except Exception:
            # Keep the list shape stable even if one translation fails.
            translated_items.append("")
    return translated_items

async def parse_questions_from_response(response, num_questions, question_type_list, difficulty, assessment_type, project_path=None):
    """Parse questions from GraphRAG response (JSON or text format) and translate to Sinhala if needed."""
    questions = []
    
    # Log the response for debugging (first 1000 chars)
    # print(f"GraphRAG response (first 1000 chars): {response[:1000] if response else 'None'}")
    
    try:
        # Try to extract JSON from response using robust extraction
        import re
        import json
        
        if not response or not isinstance(response, str):
            print("Warning: Empty or invalid response, falling back to text extraction")
            questions = extract_questions_from_text(str(response) if response else "", num_questions, question_type_list, difficulty, assessment_type)
            # if project_path:
            #     questions = await translate_questions_to_sinhala(questions, project_path)
            return questions
        
        # First, try to find JSON array pattern (non-greedy to get first complete array)
        json_match = re.search(r'\[[\s\S]*?\]', response, re.DOTALL)
        if not json_match:
            # Try to find a more complete JSON array by matching balanced brackets
            bracket_count = 0
            start_idx = response.find('[')
            if start_idx != -1:
                for i in range(start_idx, len(response)):
                    if response[i] == '[':
                        bracket_count += 1
                    elif response[i] == ']':
                        bracket_count -= 1
                        if bracket_count == 0:
                            # Create a match object manually
                            class MatchObj:
                                def group(self):
                                    return response[start_idx:i+1]
                            json_match = MatchObj()
                            break
        
        if json_match:
            try:
                json_str = json_match.group()
            except AttributeError:
                # If json_match is a MatchObj, use the group method
                json_str = json_match.group() if hasattr(json_match, 'group') else str(json_match)
            
            # Clean up the JSON string
            json_str = json_str.strip()
            # Remove markdown code blocks if present
            if json_str.startswith("```json"):
                json_str = json_str[7:].strip()
            if json_str.startswith("```"):
                json_str = json_str[3:].strip()
            if json_str.endswith("```"):
                json_str = json_str[:-3].strip()
            
            # Validate JSON string is not empty
            if not json_str or len(json_str.strip()) < 2:
                print("Warning: Empty or invalid JSON string, falling back to text extraction")
                raise ValueError("Empty or invalid JSON string")
            
            try:
                questions_data = json.loads(json_str)
            except json.JSONDecodeError as e:
                print(f"JSON parsing error: {e}")
                error_pos = getattr(e, 'pos', None)
                if error_pos:
                    # Show context around the error
                    start = max(0, error_pos - 100)
                    end = min(len(json_str), error_pos + 100)
                    print(f"Error at position {error_pos}, context: ...{json_str[start:end]}...")
                    print(f"Line {e.lineno}, column {e.colno}")
                print(f"JSON string (first 1000 chars): {json_str[:1000]}")
                print(f"Attempting to fix JSON...")
                
                # Try to fix common JSON issues
                fixed_json = json_str
                
                # 1. Remove trailing commas before closing brackets/braces
                fixed_json = re.sub(r',\s*\]', ']', fixed_json)
                fixed_json = re.sub(r',\s*\}', '}', fixed_json)
                
                # 2. Fix missing commas between objects in array (e.g., }{ -> },{)
                fixed_json = re.sub(r'\}\s*\{', '},{', fixed_json)
                
                # 3. Fix missing commas after values - be more aggressive
                # First, handle the specific case: "string1",\n    "string2" (comma present but needs fixing)
                # Then handle: "string1"\n    "string2" (missing comma with newlines/whitespace)
                fixed_json = re.sub(r'"\s*,\s*\n\s*"', '",\n    "', fixed_json)  # Normalize comma + newline pattern
                # Pattern: "string1"\n\s+"string2" (missing comma between strings in array, with newlines)
                # This is the specific case from the error: "osed of cellulose"\n    "Multicellularity"
                fixed_json = re.sub(r'"\s*\n\s+"', '",\n    "', fixed_json)  # Fix missing comma with newlines
                # Pattern: "string1"  "string2" (missing comma with multiple spaces, but not in key-value pairs)
                fixed_json = re.sub(r'"\s{2,}(?!\s*:)', '", "', fixed_json)  # Fix multiple spaces, but not if followed by :
                # Pattern: "string1" "string2" (missing comma, adjacent strings, but not in key-value pairs)
                fixed_json = re.sub(r'"\s+"(?!\s*:)', '", "', fixed_json)  # Fix adjacent strings, but not if followed by :
                # After string values before a number/boolean/null
                fixed_json = re.sub(r'"\s+\n\s*(\d+|true|false|null)', r'",\n    \1', fixed_json)  # Handle newlines
                fixed_json = re.sub(r'"\s+(\d+|true|false|null)', r'", \1', fixed_json)  # Handle spaces
                fixed_json = re.sub(r'"\s*(\d+|true|false|null)', r'",\1', fixed_json)  # Handle no whitespace
                # After string values before opening brace
                fixed_json = re.sub(r'"\s*\{', '",{', fixed_json)
                # After string values before closing brace (if not already followed by comma)
                fixed_json = re.sub(r'"\s*\}', '"}', fixed_json)  # This might be end of value, check context
                
                # After number/boolean/null values before string
                fixed_json = re.sub(r'(\d+|true|false|null)\s*"', r'\1,"', fixed_json)
                # After number/boolean/null values before opening brace
                fixed_json = re.sub(r'(\d+|true|false|null)\s*\{', r'\1,{', fixed_json)
                # After number/boolean/null values before closing brace
                fixed_json = re.sub(r'(\d+|true|false|null)\s*\}', r'\1}', fixed_json)
                
                # 4. Fix missing commas between key-value pairs
                # Pattern: "key": value"key" (missing comma after value)
                fixed_json = re.sub(r':\s*("[^"]*")\s*"', r': \1,"', fixed_json)
                # Pattern: "key": number"key" (missing comma)
                fixed_json = re.sub(r':\s*(\d+)\s*"', r': \1,"', fixed_json)
                
                # 5. Fix missing commas in arrays
                # Pattern: "value1" "value2" (missing comma)
                fixed_json = re.sub(r'"\s*"', '","', fixed_json)
                # Pattern: value1 value2 (numbers/booleans)
                fixed_json = re.sub(r'(\d+|true|false|null)\s+(\d+|true|false|null)', r'\1,\2', fixed_json)
                
                # 6. Remove comments (// and /* */)
                fixed_json = re.sub(r'//.*?$', '', fixed_json, flags=re.MULTILINE)
                fixed_json = re.sub(r'/\*.*?\*/', '', fixed_json, flags=re.DOTALL)
                
                # 7. Fix common issues around the error position (char 385 area)
                # Look for patterns that commonly cause "Expecting ',' delimiter" errors
                # Pattern: value followed by key without comma
                fixed_json = re.sub(r'(["\d\]}])\s*"([^:"]+)"\s*:', r'\1,"\2":', fixed_json)
                
                # 6. Fix unescaped newlines in strings (replace with \n)
                # This is complex, so we'll be conservative
                
                # Try to parse the fixed JSON
                questions_data = None  # Initialize
                try:
                    questions_data = json.loads(fixed_json)
                except json.JSONDecodeError as e2:
                    print(f"JSON fix attempt failed: {e2}")
                    error_pos2 = getattr(e2, 'pos', None)
                    if error_pos2:
                        start2 = max(0, error_pos2 - 50)
                        end2 = min(len(fixed_json), error_pos2 + 50)
                        print(f"Error at position {error_pos2}, context: ...{fixed_json[start2:end2]}...")
                        print(f"Characters around error: '{fixed_json[max(0,error_pos2-5):min(len(fixed_json),error_pos2+5)]}'")
                        
                        # Check if error is at the end of array (trailing comma or empty element)
                        error_context = fixed_json[max(0, error_pos2-20):min(len(fixed_json), error_pos2+5)]
                        if ']' in error_context and (',' in error_context or error_context.strip().endswith(']')):
                            # Try removing trailing comma before closing bracket
                            try:
                                # Remove trailing comma before ]
                                test_json = re.sub(r',\s*\]', ']', fixed_json)
                                if test_json != fixed_json:
                                    test_data = json.loads(test_json)
                                    fixed_json = test_json
                                    questions_data = test_data
                                    print(f"Fixed by removing trailing comma before closing bracket")
                                    # Don't continue with other fixes if this worked
                                    if questions_data is not None:
                                        pass  # Will skip the aggressive fixes below
                            except:
                                pass
                        
                        # Try to fix the specific error position by inserting a comma
                        # Look backwards from error position for a value that needs a comma
                        if questions_data is None:
                            for i in range(error_pos2 - 1, max(0, error_pos2 - 30), -1):
                                char = fixed_json[i]
                                # If we find a quote, number, or closing bracket/brace, try inserting comma after it
                                if char in ['"', '}', ']'] or char.isdigit():
                                    # Check if next non-whitespace is a quote (likely a key)
                                    next_chars = fixed_json[i+1:error_pos2+5].strip()
                                    if next_chars.startswith('"') and ',' not in fixed_json[max(0,i-5):i+1]:
                                        # Try inserting comma
                                        try:
                                            test_json = fixed_json[:i+1] + ',' + fixed_json[i+1:]
                                            test_data = json.loads(test_json)
                                            fixed_json = test_json
                                            questions_data = test_data
                                            print(f"Fixed by inserting comma after position {i+1}")
                                            break
                                        except:
                                            pass
                    
                    if questions_data is None:
                        print(f"Trying more aggressive fixes...")
                    
                    # More aggressive: try to extract and fix individual objects using proper parsing
                    try:
                        objects = []
                        # Use a proper JSON-like parser that handles errors gracefully
                        # Extract objects by finding balanced braces, ignoring string content
                        brace_count = 0
                        current_obj = ""
                        in_string = False
                        escape_next = False
                        obj_start = -1
                        
                        for i, char in enumerate(fixed_json):
                            if escape_next:
                                escape_next = False
                                if obj_start >= 0:
                                    current_obj += char
                                continue
                            
                            if char == '\\':
                                escape_next = True
                                if obj_start >= 0:
                                    current_obj += char
                                continue
                            
                            if char == '"' and not escape_next:
                                in_string = not in_string
                            
                            if not in_string:
                                if char == '[':
                                    # Skip array start
                                    continue
                                elif char == '{':
                                    if brace_count == 0:
                                        obj_start = i
                                        current_obj = ""
                                    brace_count += 1
                                    if obj_start >= 0:
                                        current_obj += char
                                elif char == '}':
                                    brace_count -= 1
                                    if obj_start >= 0:
                                        current_obj += char
                                    if brace_count == 0 and obj_start >= 0:
                                        # Complete object found
                                        try:
                                            # Try to parse as-is
                                            obj = json.loads(current_obj)
                                            objects.append(obj)
                                        except json.JSONDecodeError:
                                            # Try to fix this specific object
                                            obj_str = current_obj
                                            # Apply fixes to this object
                                            obj_str = re.sub(r',\s*\}', '}', obj_str)
                                            obj_str = re.sub(r',\s*\]', ']', obj_str)
                                            obj_str = re.sub(r'\}\s*\{', '},{', obj_str)
                                            # Try to add missing commas
                                            obj_str = re.sub(r'"\s*"', '","', obj_str)
                                            try:
                                                obj = json.loads(obj_str)
                                                objects.append(obj)
                                            except:
                                                # Last attempt: try to extract just the question field
                                                try:
                                                    question_match = re.search(r'"question"\s*:\s*"([^"]*)"', obj_str)
                                                    if question_match:
                                                        # Create a minimal valid object
                                                        obj = {"question": question_match.group(1)}
                                                        objects.append(obj)
                                                except:
                                                    pass
                                        obj_start = -1
                                        current_obj = ""
                                elif obj_start >= 0:
                                    current_obj += char
                            
                            elif obj_start >= 0:
                                current_obj += char
                        
                        if objects:
                            questions_data = objects
                            print(f"Successfully extracted {len(objects)} objects using aggressive parsing")
                        else:
                            print("Could not extract any valid objects, will try regex extraction")
                            questions_data = None  # Don't raise, let it fall through to regex extraction
                    except Exception as e3:
                        print(f"Aggressive fix also failed: {e3}")
                        import traceback
                        traceback.print_exc()
                        questions_data = None  # Set to None to trigger regex extraction
                    
                    # Last resort: try to extract individual question objects using regex
                    if questions_data is None:
                        print("Trying to extract individual question objects with regex...")
                        questions_data = []
                        # Use a more sophisticated pattern that handles nested structures
                        # Find objects that contain "question" field
                        pattern = r'\{[^{}]*(?:"question"[^{}]*)\}'
                        question_matches = re.findall(pattern, response, re.DOTALL)
                        for match in question_matches:
                            try:
                                match = match.strip()
                                # Apply multiple fixes
                                match = re.sub(r',\s*\}', '}', match)
                                match = re.sub(r',\s*\]', ']', match)
                                match = re.sub(r'\}\s*\{', '},{', match)
                                match = re.sub(r'"\s*"', '","', match)
                                if match.startswith('{') and match.endswith('}'):
                                    q_obj = json.loads(match)
                                    questions_data.append(q_obj)
                            except Exception as parse_err:
                                print(f"Failed to parse question object: {parse_err}")
                                continue
                        
                        if not questions_data:
                            print("Could not parse JSON from response, falling back to text extraction")
                            questions_data = None
            
            if questions_data and isinstance(questions_data, list):
                for q_data in questions_data[:num_questions]:
                    # Extract question text - try multiple possible field names
                    question_text = (
                        q_data.get("question") or 
                        q_data.get("question_text") or 
                        q_data.get("text") or 
                        q_data.get("q") or
                        str(q_data.get("question", "")).strip()
                    )
                    
                    # Skip questions without text
                    if not question_text or not question_text.strip():
                        print(f"Warning: Skipping question {len(questions) + 1} - no question text found. Data: {q_data}")
                        continue
                    
                    choices = q_data.get("choices") or q_data.get("options") or []
                    translated_choices_sinhala = await translate_list_to_sinhala(choices) if choices else []

                    q_type = q_data.get("question_type") or q_data.get("type") or question_type_list[len(questions) % len(question_type_list)]
                    question = {
                        "id": f"q{len(questions) + 1}",
                        "number": len(questions) + 1,
                        "type": q_type,
                        "question": question_text.strip(),
                        "question_sinhala_google_translate": await translate_text_to_sinhala(question_text.strip()),
                        "question_sinhala": q_data.get("question_sinhala") or q_data.get("question_sinhala_text") or "",
                        "options": q_data.get("options") or q_data.get("choices") or [],
                        "options_sinhala_google_translate": translated_choices_sinhala,
                        "options_sinhala": q_data.get("options_sinhala") or q_data.get("choices_sinhala") or [],
                        "correct_answer": q_data.get("correct_answer") or q_data.get("answer") or q_data.get("correct") or "",
                        "correct_answer_sinhala": q_data.get("correct_answer_sinhala") or "",
                        "correct_answer_sinhala_google_translate": await translate_text_to_sinhala(q_data.get("correct_answer") or q_data.get("answer") or q_data.get("correct") or ""),
                        "explanation": q_data.get("explanation") or q_data.get("explanation_text") or "",
                        "explanation_sinhala": q_data.get("explanation_sinhala") or "",
                        "explanation_sinhala_google_translate": await translate_text_to_sinhala(q_data.get("explanation") or q_data.get("explanation_text") or ""),
                        "difficulty": q_data.get("difficulty", difficulty),
                        "points": q_data.get("points") or q_data.get("point") or 1
                    }
                    
                    # Ensure True/False questions have options
                    if q_type == "true_false" and (not question["options"] or len(question["options"]) == 0):
                        question["options"] = ["True", "False"]
                        question["options_sinhala"] = ["සත්‍ය", "මිත්‍යා"]
                        # If correct_answer is not set or not True/False, set a default
                        if not question["correct_answer"] or question["correct_answer"] not in ["True", "False"]:
                            import random
                            correct = random.choice(["True", "False"])
                            question["correct_answer"] = correct
                            question["correct_answer_sinhala"] = "සත්‍ය" if correct == "True" else "මිත්‍යා"
                    
                    # Validate that question has text before adding
                    if not question.get("question") or not question["question"].strip():
                        print(f"Warning: Skipping question {len(questions) + 1} - question text is empty after processing")
                        continue
                    
                    # If Sinhala translations are missing, translate from English
                    if not question.get("question_sinhala") and question.get("question"):
                        question["question_sinhala"] = ""  # Will be translated later
                    if not question.get("options_sinhala"):
                        question["options_sinhala"] = []
                    if not question.get("correct_answer_sinhala") and question.get("correct_answer"):
                        question["correct_answer_sinhala"] = ""  # Will be translated later
                    if not question.get("explanation_sinhala") and question.get("explanation"):
                        question["explanation_sinhala"] = ""  # Will be translated later
                    
                    questions.append(question)
            else:
                # If questions_data is not a list, try to extract questions from text
                print("questions_data is not a list, falling back to text extraction")
                questions = extract_questions_from_text(response, num_questions, question_type_list, difficulty, assessment_type)
        else:
            # No JSON found, parse text format - extract questions manually
            print("No JSON array found in response, using text extraction")
            questions = extract_questions_from_text(response, num_questions, question_type_list, difficulty, assessment_type)
    except Exception as e:
        print(f"Error parsing JSON response: {e}")
        import traceback
        traceback.print_exc()
        # Fallback to text parsing
        print("Falling back to text extraction due to exception")
        questions = extract_questions_from_text(response if response else "", num_questions, question_type_list, difficulty, assessment_type)
    
    # Check if Sinhala translations are missing and translate if needed
    # Note: Translation may be skipped if event loop conflicts occur
    needs_translation = False
    for q in questions:
        if (q.get("question") and (not q.get("question_sinhala") or not q.get("question_sinhala").strip())) or \
           (q.get("options") and (not q.get("options_sinhala") or len(q.get("options_sinhala", [])) == 0)) or \
           (q.get("correct_answer") and (not q.get("correct_answer_sinhala") or not q.get("correct_answer_sinhala").strip())) or \
           (q.get("explanation") and (not q.get("explanation_sinhala") or not q.get("explanation_sinhala").strip())):
            needs_translation = True
            break
    
    if needs_translation and project_path:
        print("Some Sinhala translations are missing. Translating...")
        try:
            questions = await translate_questions_to_sinhala_simple(questions, project_path)
        except RuntimeError as e:
            # Catch event loop errors specifically - these occur when queues are bound to different loops
            if "bound to a different event loop" in str(e):
                print(f"Translation skipped due to event loop conflict: {e}")
                print("Sinhala translations will be empty. GraphRAG should generate them in the initial response.")
            else:
                raise  # Re-raise if it's a different RuntimeError
        except Exception as e:
            print(f"Translation failed, continuing with available translations: {e}")
        
        # Ensure placeholders exist even if translation failed
        for q in questions:
            if not q.get("question_sinhala") and q.get("question"):
                q["question_sinhala"] = ""
            if not q.get("options_sinhala") and q.get("options"):
                q["options_sinhala"] = []
            if not q.get("correct_answer_sinhala") and q.get("correct_answer"):
                q["correct_answer_sinhala"] = ""
            if not q.get("explanation_sinhala") and q.get("explanation"):
                q["explanation_sinhala"] = ""
    else:
        # Ensure all fields exist even if empty
        for q in questions:
            if not q.get("question_sinhala") and q.get("question"):
                q["question_sinhala"] = ""
            if not q.get("options_sinhala") and q.get("options"):
                q["options_sinhala"] = []
            if not q.get("correct_answer_sinhala") and q.get("correct_answer"):
                q["correct_answer_sinhala"] = ""
            if not q.get("explanation_sinhala") and q.get("explanation"):
                q["explanation_sinhala"] = ""
    
    # Final validation: filter out any questions without text
    valid_questions = []
    for q in questions:
        if q.get("question") and q["question"].strip():
            valid_questions.append(q)
        else:
            print(f"Warning: Filtering out question {q.get('id', 'unknown')} - no question text")
    
    if len(valid_questions) < len(questions):
        print(f"Warning: Filtered out {len(questions) - len(valid_questions)} questions without text")
    
    return valid_questions


def extract_questions_from_text(text, num_questions, question_type_list, difficulty, assessment_type):
    """Extract questions from text response when JSON parsing fails."""
    questions = []
    lines = text.split('\n')
    current_question = None
    
    for line in lines:
        print(line)
        line = line.strip()
        if not line:
            continue
        
        # Look for question patterns
        # if re.match(r'^\d+[\.\)]', line) or '?' in line:
        #     if current_question:
        #         questions.append(current_question)
        #     if len(questions) >= num_questions:
        #         break
            
        #     q_type = question_type_list[len(questions) % len(question_type_list)]
        #     current_question = {
        #         "id": f"q{len(questions) + 1}",
        #         "number": len(questions) + 1,
        #         "type": q_type,
        #         "question": line,
        #         "options": [],
        #         "correct_answer": "",
        #         "explanation": "",
        #         "difficulty": difficulty,
        #         "points": 1
        #     }
        # elif current_question:
        #     # Add to current question
        #     if line.startswith(('A)', 'B)', 'C)', 'D)', 'a)', 'b)', 'c)', 'd)')):
        #         current_question["options"].append(line[2:].strip())
        #     elif 'answer' in line.lower() or 'correct' in line.lower():
        #         current_question["correct_answer"] = line
    
    # if current_question and len(questions) < num_questions:
    #     questions.append(current_question)
    
    return questions


def extract_key_concepts_from_response(response):
    """Extract key concepts from GraphRAG response."""
    concepts = []
    if isinstance(response, str):
        # Simple extraction: look for bullet points, numbered items, or key phrases
        lines = response.split('\n')
        for line in lines:
            line = line.strip()
            if line and (line.startswith('-') or line.startswith('•') or 
                        line[0].isdigit() or len(line) > 20):
                # Clean up the line
                concept = line.lstrip('-•0123456789. ').strip()
                if concept and len(concept) > 10:
                    concepts.append(concept[:200])  # Limit length
    elif isinstance(response, dict):
        # If response is a dict, extract text fields
        if 'text' in response:
            concepts = extract_key_concepts_from_response(response['text'])
        elif 'response' in response:
            concepts = extract_key_concepts_from_response(response['response'])
    
    # If no concepts found, generate some defaults
    if not concepts:
        concepts = [
            "Fundamental concepts and principles",
            "Key relationships and connections",
            "Important definitions and terminology",
            "Application of knowledge",
            "Analysis and critical thinking"
        ]
    
    return concepts[:10]  # Limit to 10 concepts


def create_question_from_concept(concept, q_type, question_num, difficulty, assessment_type):
    """Create a question from a key concept."""
    import random
    
    question = {
        "id": f"q-{question_num}",
        "type": q_type,
        "question": f"Based on the concept: {concept[:100]}, {get_question_prompt(q_type)}",
        "question_sinhala": "",  # Will be filled by translation if available
        "points": get_points_for_type(q_type, difficulty),
        "difficulty": difficulty,
        "concept": concept[:200],
        "options_sinhala": [],
        "correct_answer_sinhala": "",
        "explanation_sinhala": ""
    }
    
    if q_type == "multiple_choice":
        question["options"] = generate_multiple_choice_options(concept)
        question["correct_answer"] = question["options"][0]  # First option is correct
        question["options_sinhala"] = []
    elif q_type == "true_false":
        question["options"] = ["True", "False"]
        question["options_sinhala"] = ["සත්‍ය", "මිත්‍යා"]
        correct = random.choice(["True", "False"])
        question["correct_answer"] = correct
        question["correct_answer_sinhala"] = "සත්‍ය" if correct == "True" else "මිත්‍යා"
    else:
        question["correct_answer"] = f"Answer should address: {concept[:150]}"
        question["correct_answer_sinhala"] = ""
    
    return question


def get_question_prompt(q_type):
    """Get question prompt based on type."""
    prompts = {
        "multiple_choice": "which of the following is most accurate?",
        "short_answer": "explain this concept in your own words.",
        "essay": "write a detailed explanation of this concept.",
        "true_false": "determine if the following statement is true or false."
    }
    return prompts.get(q_type, "explain this concept.")


def get_points_for_type(q_type, difficulty):
    """Get points for question based on type and difficulty."""
    base_points = {
        "multiple_choice": 1,
        "true_false": 1,
        "short_answer": 2,
        "essay": 5
    }
    
    difficulty_multiplier = {
        "easy": 1,
        "medium": 1.5,
        "hard": 2
    }
    
    base = base_points.get(q_type, 1)
    multiplier = difficulty_multiplier.get(difficulty, 1)
    return int(base * multiplier)


def generate_multiple_choice_options(concept):
    """Generate multiple choice options."""
    options = [
        f"Correct answer related to: {concept[:50]}",
        "Incorrect option A",
        "Incorrect option B",
        "Incorrect option C"
    ]
    return options


def generate_assessment_questions_fallback(documents_df, text_units_df, num_questions, difficulty, question_types, objectives):
    """Generate assessment questions from content (fallback method)."""
    questions = []
    question_type_list = []
    if question_types.get("multipleChoice"):
        question_type_list.append("multiple_choice")
    if question_types.get("shortAnswer"):
        question_type_list.append("short_answer")
    if question_types.get("essay"):
        question_type_list.append("essay")
    if question_types.get("trueFalse"):
        question_type_list.append("true_false")
    
    if not question_type_list:
        question_type_list = ["short_answer"]
    
    # Generate questions based on available types
    for i in range(min(num_questions, 20)):
        q_type = question_type_list[i % len(question_type_list)]
        question = {
            "id": f"q-{i+1}",
            "type": q_type,
            "question": f"Sample {q_type.replace('_', ' ')} question {i+1} about the content",
            "question_sinhala": "",
            "points": get_points_for_type(q_type, difficulty),
            "difficulty": difficulty,
            "options_sinhala": [],
            "correct_answer_sinhala": "",
            "explanation_sinhala": ""
        }
        
        if q_type == "multiple_choice":
            question["options"] = ["Option A", "Option B", "Option C", "Option D"]
            question["options_sinhala"] = []
            question["correct_answer"] = "Option A"
            question["correct_answer_sinhala"] = ""
        elif q_type == "true_false":
            question["options"] = ["True", "False"]
            question["options_sinhala"] = ["සත්‍ය", "මිත්‍යා"]
            question["correct_answer"] = "True"
            question["correct_answer_sinhala"] = "සත්‍ය"
        else:
            question["correct_answer"] = "Sample answer based on content"
            question["correct_answer_sinhala"] = ""
        
        questions.append(question)
    
    return questions


def verify_auth_token(request):
    """Verify authentication token from request headers."""
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return None
    token = auth_header.replace('Bearer ', '').strip()
    return token if token else None


def calculate_assessment_score(user_answers, questions):
    """Calculate score for an assessment attempt with per-question details."""
    if not questions or not user_answers:
        return {
            "correct": 0,
            "total": 0,
            "percentage": 0,
            "question_scores": []
        }
    
    correct = 0
    total = len(questions)
    question_scores = []
    
    for idx, q in enumerate(questions):
        question_id = q.get('id') or q.get('number')
        user_answer = user_answers.get(str(question_id)) or user_answers.get(question_id)
        correct_answer = q.get('correct_answer') or q.get('correctAnswer')
        points = q.get('points', 1)
        question_type = q.get('type')
        
        is_correct = False
        score_earned = 0
        
        if user_answer and correct_answer:
            # Normalize answers for comparison
            normalized_user = str(user_answer).strip().lower()
            normalized_correct = str(correct_answer).strip().lower()
            
            # For multiple choice, check option match
            if question_type == 'multiple_choice' and q.get('options'):
                correct_index = next(
                    (i for i, opt in enumerate(q['options']) 
                     if str(opt).strip().lower() == normalized_correct or str(opt) == correct_answer),
                    -1
                )
                user_index = next(
                    (i for i, opt in enumerate(q['options']) 
                     if str(opt).strip().lower() == normalized_user or str(opt) == user_answer),
                    -1
                )
                if correct_index != -1 and user_index == correct_index:
                    is_correct = True
                elif normalized_user == normalized_correct:
                    is_correct = True
            # For true/false, exact match
            elif question_type == 'true_false':
                if normalized_user == normalized_correct:
                    is_correct = True
            # For short_answer and essay, check exact match
            else:
                if normalized_user == normalized_correct:
                    is_correct = True
        
        if is_correct:
            correct += 1
            score_earned = points
        
        question_scores.append({
            "question_id": question_id,
            "question_type": question_type,
            "points_possible": points,
            "points_earned": score_earned,
            "is_correct": is_correct
        })
    
    percentage = round((correct / total) * 100) if total > 0 else 0
    
    return {
        "correct": correct,
        "total": total,
        "percentage": percentage,
        "question_scores": question_scores
    }


@app.route('/api/assessments/<assessment_id>/attempts', methods=['POST'])
def save_assessment_attempt(assessment_id):
    """Save an assessment attempt with Assessment ID, score per question ID, and question type."""
    try:
        # Verify authentication
        token = verify_auth_token(request)
        if not token:
            return jsonify({"error": "Authentication required"}), 401
        
        # Get user info from request body
        data = request.get_json() or {}
        user = data.get('user')
        user_answers = data.get('answers', {})
        
        if not user:
            return jsonify({"error": "User information is required"}), 400
        
        # Load assessment to get questions
        assessment = load_assessment_by_id_from_mongodb(assessment_id)
        if not assessment:
            return jsonify({"error": "Assessment not found"}), 404
        
        questions = assessment.get('questions', [])
        if not questions:
            return jsonify({"error": "Assessment questions not available"}), 400
        
        # Calculate score with per-question details
        score_result = calculate_assessment_score(user_answers, questions)
        
        # Create attempt record with required fields: Assessment ID, question scores (with question_id, question_type, score)
        user_id = user.get("id") if user else ""
        timestamp = datetime.now().isoformat()
        attempt_id = f"attempt-{hashlib.sha256(f'{assessment_id}{user_id}{timestamp}'.encode()).hexdigest()[:16]}"
        
        attempt_data = {
            "id": attempt_id,
            "assessment_id": assessment_id,  # Assessment ID
            "user_id": user.get('id'),
            "user_email": user.get('email'),
            "user_name": user.get('name'),
            # Question scores with question_id, question_type, and score (points_earned/points_possible)
            "question_scores": score_result.get("question_scores", []),  # Each contains: question_id, question_type, points_earned, points_possible, is_correct
            "overall_score": {
                "correct": score_result.get("correct", 0),
                "total": score_result.get("total", 0),
                "percentage": score_result.get("percentage", 0)
            },
            "attempted_at": datetime.now().isoformat()
        }
        
        # Save to MongoDB
        collection = get_mongodb_assessment_attempts_collection()
        if collection is not None:
            try:
                # Convert to JSON-serializable format
                serializable_attempt = make_json_serializable(attempt_data.copy())
                collection.insert_one(serializable_attempt)
                
                return jsonify({
                    "success": True,
                    "message": "Assessment attempt saved successfully",
                    "attempt": attempt_data
                }), 201
            except Exception as e:
                print(f"Error saving assessment attempt to MongoDB: {e}")
                return jsonify({"error": f"Failed to save attempt: {str(e)}"}), 500
        else:
            return jsonify({"error": "Database connection unavailable"}), 500
            
    except Exception as e:
        import traceback
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500


@app.route('/api/ml/student-performance/<user_id>', methods=['GET'])
def predict_student_performance(user_id):
    """Get performance prediction for a student (overall or per course)."""
    try:
        course_id = request.args.get('course_id')  # Optional course filter
        from ml_workflow.models.performance_predictor import StudentPerformancePredictor
        from ml_workflow.data_extractor import AssessmentDataExtractor
        from pathlib import Path
        
        # Try to load saved model
        model_path = Path(__file__).parent / 'ml_workflow' / 'saved_models' / 'performance_predictor.pkl'
        
        predictor = StudentPerformancePredictor()
        
        if model_path.exists():
            try:
                predictor.load_model(str(model_path))
            except Exception as e:
                print(f"Warning: Could not load saved model: {e}")
                return jsonify({
                    "error": "Model not available. Please train the model first.",
                    "details": str(e)
                }), 503
        else:
            return jsonify({
                "error": "Model not found. Please train the model first.",
                "training_script": "ml_workflow/scripts/train_performance_predictor.py"
            }), 503
        
        # Extract and prepare data
        extractor = AssessmentDataExtractor()
        try:
            df = extractor.extract_attempts_dataframe()
            
            if df.empty:
                return jsonify({"error": "No assessment data available"}), 404
            
            # Prepare features based on whether course_id is provided
            if course_id:
                # Course-specific prediction
                features = extractor.extract_course_features(course_id=course_id)
                if features.empty:
                    return jsonify({
                        "error": f"No data found for course {course_id}",
                        "user_id": user_id,
                        "course_id": course_id
                    }), 404
                
                # Use course features directly (they're already aggregated per student-course)
                user_features = features[features['user_id'] == user_id]
                if user_features.empty:
                    return jsonify({
                        "error": f"User {user_id} has no data for course {course_id}",
                        "user_id": user_id,
                        "course_id": course_id
                    }), 404
                
                # Predict using course features
                # For now, use a simple average if model not trained for courses
                # In future, could train separate course-specific models
                avg_score = float(user_features['avg_score'].iloc[0])
                prediction = {
                    'user_id': user_id,
                    'course_id': course_id,
                    'predicted_score': round(avg_score, 2),
                    'confidence_interval': [
                        round(max(0, avg_score - 10), 2),
                        round(min(100, avg_score + 10), 2)
                    ],
                    'prediction_std': 10.0
                }
            else:
                # Overall prediction (existing logic)
                features = predictor.prepare_features(df)
                
                if features.empty:
                    return jsonify({"error": "Could not prepare features from data"}), 500
                
                # Predict
                prediction = predictor.predict(user_id, features)
            
            if prediction:
                return jsonify({
                    "success": True,
                    "prediction": prediction
                }), 200
            else:
                return jsonify({
                    "error": "User not found or insufficient data",
                    "user_id": user_id
                }), 404
                
        finally:
            extractor.close()
            
    except Exception as e:
        import traceback
        return jsonify({
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 500


@app.route('/api/ml/train-performance-model', methods=['POST'])
def train_performance_model():
    """Trigger training of the performance prediction model (admin only)."""
    try:
        import subprocess
        from pathlib import Path
        
        training_script = Path(__file__).parent / 'ml_workflow' / 'scripts' / 'train_performance_predictor.py'
        
        if not training_script.exists():
            return jsonify({"error": "Training script not found"}), 404
        
        # Run training in background (or synchronously for demo)
        result = subprocess.run(
            ['python', str(training_script)],
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout
        )
        
        if result.returncode == 0:
            return jsonify({
                "success": True,
                "message": "Model training completed",
                "output": result.stdout
            }), 200
        else:
            return jsonify({
                "error": "Training failed",
                "output": result.stdout,
                "error_output": result.stderr
            }), 500
            
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Training timeout"}), 500
    except Exception as e:
        import traceback
        return jsonify({
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 500


@app.route('/api/ml/model-info', methods=['GET'])
def get_model_info():
    """Get information about the trained model."""
    try:
        from ml_workflow.models.performance_predictor import StudentPerformancePredictor
        from pathlib import Path
        import os
        
        model_path = Path(__file__).parent / 'ml_workflow' / 'saved_models' / 'performance_predictor.pkl'
        
        if not model_path.exists():
            return jsonify({
                "model_exists": False,
                "message": "Model not trained yet"
            }), 404
        
        predictor = StudentPerformancePredictor()
        predictor.load_model(str(model_path))
        
        # Get model info
        info = {
            "model_exists": True,
            "model_type": predictor.model_type,
            "is_trained": predictor.is_trained,
            "metrics": predictor.metrics,
            "n_features": len(predictor.feature_columns) if predictor.feature_columns else 0,
            "model_size_mb": round(os.path.getsize(model_path) / (1024 * 1024), 2)
        }
        
        # Get feature importance
        if predictor.is_trained:
            importance = predictor.get_feature_importance(top_n=10)
            if importance is not None:
                info["top_features"] = importance.to_dict('records')
        
        return jsonify(info), 200
        
    except Exception as e:
        return jsonify({
            "error": str(e)
        }), 500


@app.route('/api/ml/student-performance-courses/<user_id>', methods=['GET'])
def predict_student_performance_all_courses(user_id):
    """Get performance predictions for a student across all courses."""
    try:
        from ml_workflow.data_extractor import AssessmentDataExtractor
        import pandas as pd
        
        extractor = AssessmentDataExtractor()
        
        try:
            # Get course-specific features for all courses
            course_features = extractor.extract_course_features()
            
            if course_features.empty:
                return jsonify({
                    "success": True,
                    "predictions": [],
                    "message": "No course data available"
                }), 200
            
            # Filter for this user
            user_course_features = course_features[course_features['user_id'] == user_id]
            
            if user_course_features.empty:
                return jsonify({
                    "success": True,
                    "predictions": [],
                    "message": f"No course data found for user {user_id}"
                }), 200
            
            # Get course names from MongoDB
            courses_collection = get_mongodb_courses_collection()
            course_names = {}
            if courses_collection:
                course_ids = user_course_features['course_id'].dropna().unique().tolist()
                if course_ids:
                    courses = list(courses_collection.find(
                        {'id': {'$in': course_ids}},
                        {'id': 1, 'title': 1}
                    ))
                    course_names = {c['id']: c.get('title', 'Unknown Course') for c in courses}
            
            # Get attempt details for each course
            db = extractor.client[extractor.db_name]
            attempts_collection = db['assessment_attempts']
            assessments_collection = db['assessments']
            
            # Get assessment IDs for each course
            course_assessment_map = {}
            if assessments_collection:
                for course_id in user_course_features['course_id'].dropna().unique():
                    assessments = list(assessments_collection.find(
                        {'sourceType': 'course', 'sourceId': course_id},
                        {'id': 1, 'title': 1}
                    ))
                    course_assessment_map[course_id] = {a['id']: a.get('title', 'Assessment') for a in assessments}
            
            # Build predictions for each course with attempt details
            predictions = []
            for _, row in user_course_features.iterrows():
                course_id = row.get('course_id')
                avg_score = float(row['avg_score']) if pd.notna(row['avg_score']) else 0.0
                
                # Get attempt details for this course (all students)
                attempt_details = []
                if course_id and course_id in course_assessment_map:
                    assessment_ids = list(course_assessment_map[course_id].keys())
                    if assessment_ids:
                        # Fetch attempts for ALL users in this course (not just the logged-in user)
                        course_attempts = list(attempts_collection.find(
                            {'assessment_id': {'$in': assessment_ids}},
                            {'_id': 0, 'id': 1, 'assessment_id': 1, 'overall_score': 1, 'attempted_at': 1, 'user_id': 1, 'user_name': 1, 'user_email': 1}
                        ).sort('attempted_at', -1))  # Sort by most recent first
                        
                        for attempt in course_attempts:
                            assessment_id = attempt.get('assessment_id')
                            overall_score = attempt.get('overall_score', {})
                            
                            attempt_details.append({
                                'attempt_id': attempt.get('id'),
                                'assessment_id': assessment_id,
                                'assessment_title': course_assessment_map[course_id].get(assessment_id, 'Assessment'),
                                'score': overall_score.get('percentage', 0) if isinstance(overall_score, dict) else 0,
                                'correct': overall_score.get('correct', 0) if isinstance(overall_score, dict) else 0,
                                'total': overall_score.get('total', 0) if isinstance(overall_score, dict) else 0,
                                'attempted_at': attempt.get('attempted_at'),
                                'user_id': attempt.get('user_id'),
                                'user_name': attempt.get('user_name'),
                                'user_email': attempt.get('user_email')
                            })
                
                predictions.append({
                    'course_id': course_id,
                    'course_title': course_names.get(course_id, 'Unknown Course'),
                    'predicted_score': round(avg_score, 2),
                    'confidence_interval': [
                        round(max(0, avg_score - 10), 2),
                        round(min(100, avg_score + 10), 2)
                    ],
                    'attempt_count': int(row.get('attempt_count', 0)),
                    'last_attempt': row.get('last_attempt').isoformat() if pd.notna(row.get('last_attempt')) else None,
                    'attempts': attempt_details  # Include detailed attempt history
                })
            
            return jsonify({
                "success": True,
                "predictions": predictions,
                "user_id": user_id
            }), 200
            
        finally:
            extractor.close()
            
    except Exception as e:
        import traceback
        return jsonify({
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 500


@app.route('/api/enrollments', methods=['POST'])
def enroll_in_course():
    """Enroll a student in a course."""
    try:
        data = request.get_json()
        user_id = data.get('user_id')
        course_id = data.get('course_id')
        
        if not user_id or not course_id:
            return jsonify({"error": "user_id and course_id are required"}), 400
        
        enrollments_collection = get_mongodb_enrollments_collection()
        courses_collection = get_mongodb_courses_collection()
        
        if enrollments_collection is None or courses_collection is None:
            return jsonify({"error": "MongoDB not configured"}), 500
        
        # Check if course exists
        course = courses_collection.find_one({'id': course_id})
        if not course:
            return jsonify({"error": "Course not found"}), 404
        
        # Check if already enrolled
        existing_enrollment = enrollments_collection.find_one({
            'user_id': user_id,
            'course_id': course_id
        }, {'_id': 0})
        
        if existing_enrollment:
            return jsonify({
                "success": True,
                "message": "Already enrolled in this course",
                "enrollment": existing_enrollment
            }), 200
        
        # Create enrollment
        enrollment = {
            'id': f"enrollment-{user_id}-{course_id}-{datetime.now().isoformat()}",
            'user_id': user_id,
            'course_id': course_id,
            'course_title': course.get('title', 'Course'),
            'enrolled_at': datetime.now().isoformat(),
            'status': 'active'
        }
        
        enrollments_collection.insert_one(enrollment)
        
        # Remove _id if MongoDB added it (ObjectId is not JSON serializable)
        enrollment.pop('_id', None)
        
        return jsonify({
            "success": True,
            "message": "Successfully enrolled in course",
            "enrollment": enrollment
        }), 201
        
    except Exception as e:
        import traceback
        return jsonify({
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 500


@app.route('/api/enrollments/<user_id>/<course_id>', methods=['DELETE'])
def unenroll_from_course(user_id, course_id):
    """Unenroll a student from a course."""
    try:
        enrollments_collection = get_mongodb_enrollments_collection()
        
        if enrollments_collection is None:
            return jsonify({"error": "MongoDB not configured"}), 500
        
        result = enrollments_collection.delete_one({
            'user_id': user_id,
            'course_id': course_id
        })
        
        if result.deleted_count > 0:
            return jsonify({
                "success": True,
                "message": "Successfully unenrolled from course"
            }), 200
        else:
            return jsonify({
                "error": "Enrollment not found"
            }), 404
        
    except Exception as e:
        import traceback
        return jsonify({
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 500


@app.route('/api/enrollments/<user_id>/<course_id>', methods=['GET'])
def check_enrollment(user_id, course_id):
    """Check if a student is enrolled in a course."""
    try:
        enrollments_collection = get_mongodb_enrollments_collection()
        
        if enrollments_collection is None:
            return jsonify({
                "success": True,
                "enrolled": False,
                "message": "MongoDB not configured"
            }), 200
        
        enrollment = enrollments_collection.find_one({
            'user_id': user_id,
            'course_id': course_id
        }, {'_id': 0})
        
        return jsonify({
            "success": True,
            "enrolled": enrollment is not None,
            "enrollment": enrollment if enrollment else None
        }), 200
        
    except Exception as e:
        import traceback
        return jsonify({
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 500


@app.route('/api/enrollments/<user_id>', methods=['GET'])
def get_user_enrollments(user_id):
    """Get all courses a student is enrolled in."""
    try:
        enrollments_collection = get_mongodb_enrollments_collection()
        
        if enrollments_collection is None:
            return jsonify({
                "success": True,
                "enrollments": [],
                "message": "MongoDB not configured"
            }), 200
        
        enrollments = list(enrollments_collection.find(
            {'user_id': user_id, 'status': 'active'},
            {'_id': 0}
        ))
        
        return jsonify({
            "success": True,
            "enrollments": enrollments
        }), 200
        
    except Exception as e:
        import traceback
        return jsonify({
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 500


@app.route('/api/recommendations/user/<user_id>', methods=['GET'])
def get_user_recommendations(user_id):
    """Get user-level recommendations for a student."""
    try:
        attempts_collection = get_mongodb_assessment_attempts_collection()
        
        if not attempts_collection:
            return jsonify({
                "success": True,
                "recommendations": {
                    "videos": [],
                    "blogs": [],
                    "courseMaterials": []
                },
                "message": "MongoDB not configured"
            }), 200
        
        # For now, always return dummy data for Personal Recommendations
        # TODO: Implement actual recommendation logic based on user performance
        recommendations = {
            "videos": [
                {"id": 1, "title": "Study Strategies for Better Performance", "url": "https://example.com/video1", "duration": "12:30", "type": "video"},
                {"id": 2, "title": "Time Management Tips", "url": "https://example.com/video2", "duration": "15:00", "type": "video"},
                {"id": 3, "title": "Effective Note-Taking Techniques", "url": "https://example.com/video3", "duration": "18:45", "type": "video"},
                {"id": 4, "title": "Memory Improvement Methods", "url": "https://example.com/video4", "duration": "14:20", "type": "video"}
            ],
            "blogs": [
                {"id": 1, "title": "How to Improve Your Study Habits", "url": "https://example.com/blog1", "readTime": "5 min", "type": "blog"},
                {"id": 2, "title": "10 Tips for Academic Success", "url": "https://example.com/blog2", "readTime": "8 min", "type": "blog"},
                {"id": 3, "title": "Building Effective Learning Routines", "url": "https://example.com/blog3", "readTime": "6 min", "type": "blog"}
            ],
            "courseMaterials": [
                {"id": 1, "title": "General Study Guide", "url": "https://example.com/material1", "format": "PDF", "type": "material"},
                {"id": 2, "title": "Exam Preparation Checklist", "url": "https://example.com/material2", "format": "PDF", "type": "material"},
                {"id": 3, "title": "Learning Resources Library", "url": "https://example.com/material3", "format": "DOC", "type": "material"}
            ]
        }
        
        return jsonify({
            "success": True,
            "recommendations": recommendations
        }), 200
        
    except Exception as e:
        import traceback
        return jsonify({
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 500


@app.route('/api/recommendations/course/<course_id>/user/<user_id>', methods=['GET'])
def get_course_recommendations_for_user(course_id, user_id):
    """Get course-level recommendations for a specific student in a course."""
    try:
        courses_collection = get_mongodb_courses_collection()
        assessments_collection = get_mongodb_assessments_collection()
        attempts_collection = get_mongodb_assessment_attempts_collection()
        
        if not courses_collection or not assessments_collection or not attempts_collection:
            return jsonify({
                "success": True,
                "recommendations": {
                    "videos": [],
                    "blogs": [],
                    "courseMaterials": []
                },
                "message": "MongoDB not configured"
            }), 200
        
        # Get assessments for this course
        course_assessments = list(assessments_collection.find({'sourceType': 'course', 'sourceId': course_id}))
        assessment_ids = [a['id'] for a in course_assessments]
        
        if not assessment_ids:
            return jsonify({
                "success": True,
                "recommendations": {
                    "videos": [],
                    "blogs": [],
                    "courseMaterials": []
                }
            }), 200
        
        # Get attempts by this user for this course
        user_attempts = list(attempts_collection.find({
            'user_id': user_id,
            'assessment_id': {'$in': assessment_ids}
        }))
        
        # Calculate average score for this course
        total_score = 0
        total_questions = 0
        for attempt in user_attempts:
            overall_score = attempt.get('overall_score', {})
            if isinstance(overall_score, dict):
                total_score += overall_score.get('correct', 0)
                total_questions += overall_score.get('total', 0)
        
        avg_score = (total_score / total_questions * 100) if total_questions > 0 else 0
        
        # Get course details
        course = courses_collection.find_one({'id': course_id})
        course_title = course.get('title', 'Course') if course else 'Course'
        
        # Generate recommendations based on course and performance
        # For now, return dummy data (TODO: implement actual recommendation logic)
        recommendations = {
            "videos": [
                {"id": 1, "title": f"{course_title} - Review Session", "url": "https://example.com/video1", "duration": "20:00", "type": "video"},
                {"id": 2, "title": f"{course_title} - Practice Problems", "url": "https://example.com/video2", "duration": "18:30", "type": "video"}
            ] if avg_score < 75 else [
                {"id": 1, "title": f"{course_title} - Advanced Topics", "url": "https://example.com/video1", "duration": "25:00", "type": "video"}
            ],
            "blogs": [
                {"id": 1, "title": f"{course_title} Study Tips", "url": "https://example.com/blog1", "readTime": "7 min", "type": "blog"}
            ],
            "courseMaterials": [
                {"id": 1, "title": f"{course_title} - Chapter Notes", "url": "https://example.com/material1", "format": "PDF", "type": "material"},
                {"id": 2, "title": f"{course_title} - Practice Questions", "url": "https://example.com/material2", "format": "PDF", "type": "material"}
            ]
        }
        
        return jsonify({
            "success": True,
            "course_id": course_id,
            "course_title": course_title,
            "recommendations": recommendations
        }), 200
        
    except Exception as e:
        import traceback
        return jsonify({
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 500


@app.route('/api/feedback', methods=['POST'])
def submit_feedback():
    """Store product feedback submitted by users."""
    try:
        data = request.get_json() or {}

        message = (data.get('message') or '').strip()
        if not message:
            return jsonify({"error": "Feedback message is required"}), 400

        feedback_entry = {
            "id": str(uuid.uuid4()),
            "type": (data.get('type') or 'general').strip()[:50],
            "rating": data.get('rating'),
            "message": message,
            "email": (data.get('email') or '').strip()[:200],
            "context": (data.get('context') or '').strip()[:200],
            "user_id": data.get('user_id'),
            "user_name": (data.get('user_name') or '').strip()[:120],
            "created_at": datetime.utcnow().isoformat() + 'Z'
        }

        # Normalize rating into [1, 5] when provided
        if feedback_entry["rating"] is not None:
            try:
                feedback_entry["rating"] = max(1, min(5, int(feedback_entry["rating"])))
            except (ValueError, TypeError):
                feedback_entry["rating"] = None

        if save_feedback_entry(feedback_entry):
            return jsonify({
                "success": True,
                "message": "Feedback submitted successfully",
                "feedback_id": feedback_entry["id"]
            }), 201

        return jsonify({"error": "Failed to save feedback"}), 500
    except Exception as e:
        import traceback
        return jsonify({
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 500


@app.route('/')
def index():
    """Serve the frontend application."""
    build_path = Path(__file__).parent / 'frontend' / 'build'
    if build_path.exists():
        return send_from_directory(str(build_path), 'index.html')
    else:
        return jsonify({
            "message": "React build not found. Run 'npm run build' in the frontend directory.",
            "dev_mode": "For development, run 'npm start' in the frontend directory separately."
        }), 404


@app.route('/api/auth/google', methods=['POST'])
def google_login():
    """Handle Google OAuth login."""
    try:
        data = request.get_json()
        credential = data.get('credential')
        
        if not credential:
            return jsonify({"error": "Google credential is required"}), 400
        
        # For demo purposes, we'll decode the JWT token without full verification
        # In production, you should verify the token with Google's public keys
        import base64
        
        try:
            # Decode JWT token (without verification for demo)
            # Format: header.payload.signature
            parts = credential.split('.')
            if len(parts) != 3:
                return jsonify({"error": "Invalid credential format"}), 400
            
            # Decode payload (add padding if needed)
            payload = parts[1]
            padding = len(payload) % 4
            if padding:
                payload += '=' * (4 - padding)
            
            decoded_payload = base64.urlsafe_b64decode(payload)
            user_info = json.loads(decoded_payload)
            
            # Extract user information
            email = user_info.get('email', '')
            name = user_info.get('name', email.split('@')[0])
            picture = user_info.get('picture', '')
            
            if not email:
                return jsonify({"error": "Email not found in Google credential"}), 400
            
            # Only allow Gmail accounts
            if not email.endswith('@gmail.com'):
                return jsonify({"error": "Only Gmail accounts are allowed"}), 403
            
            # Generate a session token
            token = hashlib.sha256(f'{email}{datetime.now().isoformat()}'.encode()).hexdigest()
            
            user_data = {
                "id": f"user-{hashlib.sha256(email.encode()).hexdigest()[:8]}",
                "email": email,
                "name": name,
                "picture": picture,
                "role": "student"
            }
            
            return jsonify({
                "success": True,
                "message": "Login successful",
                "token": token,
                "user": user_data
            }), 200
            
        except Exception as decode_error:
            return jsonify({"error": f"Failed to decode credential: {str(decode_error)}"}), 400
            
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/<path:path>')
def serve_static(path):
    """Serve static files from React build."""
    build_path = Path(__file__).parent / 'frontend' / 'build'
    if build_path.exists():
        return send_from_directory(str(build_path), path)
    return jsonify({"error": "Build not found"}), 404


if __name__ == '__main__':
    app.run(debug=True, port=5000)

# AWS Lambda handler - only used for deployment
# handler = Mangum(app)

