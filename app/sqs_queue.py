#!/usr/bin/env python3
"""
SQS queue utilities for sending book upload messages.
"""

import os
import json
import logging
import boto3
from botocore.exceptions import ClientError
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

# SQS Configuration
SQS_QUEUE_NAME = os.environ.get('SQS_QUEUE_NAME', 'book-upload-queue')
SQS_QUEUE_URL = os.environ.get('SQS_QUEUE_URL', '')
SQS_REGION = os.environ.get('SQS_REGION', os.environ.get('S3_REGION', 'ap-south-1'))


def get_sqs_client():
    """Initialize and return SQS client."""
    # Check if AWS credentials are provided
    aws_access_key = os.environ.get('AWS_ACCESS_KEY_ID')
    aws_secret_key = os.environ.get('AWS_SECRET_ACCESS_KEY')
    
    # If credentials are not provided, return None (will use local/default credentials)
    if not aws_access_key or not aws_secret_key:
        try:
            # Try to use default credentials (IAM role, environment, etc.)
            sqs_client = boto3.client('sqs', region_name=SQS_REGION)
            return sqs_client
        except Exception as e:
            logger.error(f"Failed to initialize SQS client: {e}")
            return None
    
    try:
        sqs_client = boto3.client(
            'sqs',
            region_name=SQS_REGION,
            aws_access_key_id=aws_access_key,
            aws_secret_access_key=aws_secret_key
        )
        return sqs_client
    except Exception as e:
        logger.error(f"Failed to initialize SQS client with credentials: {e}")
        return None


def get_queue_url(queue_name: Optional[str] = None) -> Optional[str]:
    """Get the SQS queue URL by name or return the configured URL."""
    if SQS_QUEUE_URL:
        return SQS_QUEUE_URL
    
    queue_name = queue_name or SQS_QUEUE_NAME
    sqs_client = get_sqs_client()
    
    if not sqs_client:
        return None
    
    try:
        response = sqs_client.get_queue_url(QueueName=queue_name)
        return response['QueueUrl']
    except ClientError as e:
        logger.error(f"Failed to get queue URL for {queue_name}: {e}")
        return None


def create_queue_if_not_exists(queue_name: Optional[str] = None) -> Optional[str]:
    """
    Create an SQS queue if it doesn't exist.
    
    Args:
        queue_name: Name of the queue to create. If not provided, uses SQS_QUEUE_NAME.
    
    Returns:
        Queue URL if successful, None otherwise.
    """
    queue_name = queue_name or SQS_QUEUE_NAME
    sqs_client = get_sqs_client()
    
    if not sqs_client:
        logger.error("SQS client not available. Cannot create queue.")
        return None
    
    try:
        # Try to get the queue URL first (queue might already exist)
        try:
            response = sqs_client.get_queue_url(QueueName=queue_name)
            queue_url = response['QueueUrl']
            logger.info(f"Queue '{queue_name}' already exists: {queue_url}")
            return queue_url
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', '')
            if error_code != 'AWS.SimpleQueueService.NonExistentQueue':
                # Some other error occurred
                raise
        
        # Queue doesn't exist, create it
        logger.info(f"Creating SQS queue: {queue_name}")
        response = sqs_client.create_queue(
            QueueName=queue_name,
            Attributes={
                'VisibilityTimeout': '300',  # 5 minutes
                'MessageRetentionPeriod': '1209600',  # 14 days
                'ReceiveMessageWaitTimeSeconds': '20'  # Long polling
            }
        )
        queue_url = response['QueueUrl']
        logger.info(f"Successfully created queue '{queue_name}': {queue_url}")
        return queue_url
        
    except ClientError as e:
        logger.error(f"Failed to create SQS queue '{queue_name}': {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error creating SQS queue '{queue_name}': {e}")
        return None


def send_book_upload_message(book_id: str, sqs_book_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Send a book upload message to SQS queue.
    
    Args:
        book_id: The unique identifier for the book
        sqs_book_data: Dictionary containing book data to send in the message
    
    Returns:
        Dictionary with 'message_id' key containing the SQS message ID
        
    Raises:
        Exception: If message sending fails
    """
    sqs_client = get_sqs_client()
    
    if not sqs_client:
        raise Exception("SQS client not available. Check AWS credentials.")
    
    # Get queue URL
    queue_url = get_queue_url()
    if not queue_url:
        raise Exception(f"Failed to get SQS queue URL. Queue name: {SQS_QUEUE_NAME}")
    
    # Prepare message body
    message_body = json.dumps(sqs_book_data)
    
    try:
        # Send message to SQS
        response = sqs_client.send_message(
            QueueUrl=queue_url,
            MessageBody=message_body,
            MessageAttributes={
                'book_id': {
                    'StringValue': book_id,
                    'DataType': 'String'
                },
                'message_type': {
                    'StringValue': 'book_upload',
                    'DataType': 'String'
                }
            }
        )
        
        message_id = response.get('MessageId')
        if not message_id:
            raise Exception("SQS response did not contain MessageId")
        
        logger.info(f"Successfully sent SQS message for book {book_id}. Message ID: {message_id}")
        
        return {
            'message_id': message_id,
            'md5_of_body': response.get('MD5OfBody'),
            'sequence_number': response.get('SequenceNumber')
        }
        
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', '')
        error_message = e.response.get('Error', {}).get('Message', str(e))
        logger.error(f"AWS SQS error sending message for book {book_id}: {error_code} - {error_message}")
        raise Exception(f"Failed to send SQS message: {error_code} - {error_message}")
    except Exception as e:
        logger.error(f"Unexpected error sending SQS message for book {book_id}: {e}")
        raise
