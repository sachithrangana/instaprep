"""
Data extraction module for pulling assessment data from MongoDB.
"""
import pandas as pd
from pymongo import MongoClient
from datetime import datetime
import os

class AssessmentDataExtractor:
    """Extract and prepare data from MongoDB for ML workflows"""
    
    def __init__(self, mongodb_uri=None, db_name=None):
        self.mongodb_uri = mongodb_uri or os.environ.get('MONGODB_URI', '')
        self.db_name = db_name or os.environ.get('MONGODB_DB_NAME', 'instaprep')
        self.client = None
        
        if self.mongodb_uri:
            try:
                self.client = MongoClient(self.mongodb_uri)
                # Test connection
                self.client.admin.command('ping')
                print(f"Successfully connected to MongoDB: {self.db_name}")
            except Exception as e:
                print(f"Warning: Could not connect to MongoDB: {e}")
                self.client = None
    
    def extract_attempts_dataframe(self, limit=None):
        """Extract all assessment attempts as pandas DataFrame"""
        if not self.client:
            raise ValueError("MongoDB connection not configured. Please set MONGODB_URI environment variable.")
        
        db = self.client[self.db_name]
        collection = db['assessment_attempts']
        
        # Fetch all attempts
        query = {} if limit is None else {}
        attempts = list(collection.find(query).limit(limit) if limit else collection.find(query))
        
        if not attempts:
            print("Warning: No assessment attempts found in database")
            return pd.DataFrame()
        
        df = pd.DataFrame(attempts)
        
        # Convert timestamps
        if 'attempted_at' in df.columns:
            df['attempted_at'] = pd.to_datetime(df['attempted_at'], errors='coerce')
        
        # Link assessments to courses via assessment collection
        if 'assessment_id' in df.columns:
            assessments_collection = db['assessments']
            assessment_to_course = {}
            
            # Fetch assessments to get course_id (sourceId when sourceType is 'course')
            assessment_ids = df['assessment_id'].unique().tolist()
            if assessment_ids:
                assessments = list(assessments_collection.find(
                    {'id': {'$in': assessment_ids}},
                    {'id': 1, 'sourceId': 1, 'sourceType': 1}
                ))
                
                for assessment in assessments:
                    # If sourceType is 'course', use sourceId as course_id
                    if assessment.get('sourceType') == 'course':
                        assessment_to_course[assessment['id']] = assessment.get('sourceId')
            
            # Add course_id to dataframe
            df['course_id'] = df['assessment_id'].map(assessment_to_course)
        
        # Expand question_scores into separate rows
        if 'question_scores' in df.columns:
            # Filter out rows where question_scores is empty or None
            df = df[df['question_scores'].notna() & (df['question_scores'].str.len() > 0 if df['question_scores'].dtype == 'object' else True)]
            
            if len(df) > 0:
                df = df.explode('question_scores').reset_index(drop=True)
                question_scores_df = pd.json_normalize(df['question_scores'])
                
                # Only merge if question_scores_df has data
                if len(question_scores_df) > 0:
                    df = pd.concat([df.drop('question_scores', axis=1), question_scores_df], axis=1)
        
        return df
    
    def extract_student_features(self, limit=None):
        """Create student-level aggregated features"""
        df = self.extract_attempts_dataframe(limit=limit)
        
        if df.empty:
            return pd.DataFrame()
        
        # Extract overall score percentage
        df['score_pct'] = df['overall_score'].apply(
            lambda x: x.get('percentage', 0) if isinstance(x, dict) else (
                x if isinstance(x, (int, float)) else 0
            )
        )
        
        # Aggregate by student
        student_features = df.groupby('user_id').agg({
            'score_pct': ['mean', 'std', 'count'],
            'is_correct': ['mean', 'sum', 'count'] if 'is_correct' in df.columns else 'count',
            'attempted_at': ['min', 'max', 'count'],
            'assessment_id': 'nunique' if 'assessment_id' in df.columns else 'count'
        }).reset_index()
        
        # Flatten column names
        student_features.columns = [
            'user_id', 'avg_score', 'score_std', 'score_count',
            'correct_rate', 'correct_sum', 'correct_count',
            'first_attempt', 'last_attempt', 'attempt_count',
            'unique_assessments'
        ]
        
        # Calculate additional metrics
        student_features['avg_score'] = student_features['avg_score'].fillna(0)
        student_features['score_std'] = student_features['score_std'].fillna(0)
        student_features['correct_rate'] = student_features['correct_rate'].fillna(0)
        
        # Time-based features
        student_features['first_attempt'] = pd.to_datetime(student_features['first_attempt'], errors='coerce')
        student_features['last_attempt'] = pd.to_datetime(student_features['last_attempt'], errors='coerce')
        student_features['days_active'] = (
            student_features['last_attempt'] - student_features['first_attempt']
        ).dt.days.fillna(0)
        
        # Fill any remaining NaN values
        student_features = student_features.fillna(0)
        
        return student_features
    
    def extract_course_features(self, course_id=None, limit=None):
        """Create student-course level aggregated features for course-specific predictions"""
        df = self.extract_attempts_dataframe(limit=limit)
        
        if df.empty:
            return pd.DataFrame()
        
        # Filter by course if specified
        if course_id and 'course_id' in df.columns:
            df = df[df['course_id'] == course_id]
            if df.empty:
                return pd.DataFrame()
        
        # Extract overall score percentage
        df['score_pct'] = df['overall_score'].apply(
            lambda x: x.get('percentage', 0) if isinstance(x, dict) else (
                x if isinstance(x, (int, float)) else 0
            )
        )
        
        # Aggregate by student and course
        group_cols = ['user_id']
        if 'course_id' in df.columns:
            group_cols.append('course_id')
        
        course_features = df.groupby(group_cols).agg({
            'score_pct': ['mean', 'std', 'count'],
            'is_correct': ['mean', 'sum', 'count'] if 'is_correct' in df.columns else 'count',
            'attempted_at': ['min', 'max', 'count'],
            'assessment_id': 'nunique' if 'assessment_id' in df.columns else 'count',
            'question_type': lambda x: x.mode()[0] if len(x.mode()) > 0 else None
        }).reset_index()
        
        # Flatten column names
        cols = group_cols.copy()
        cols.extend([
            'avg_score', 'score_std', 'score_count',
            'correct_rate', 'correct_sum', 'correct_count',
            'first_attempt', 'last_attempt', 'attempt_count',
            'unique_assessments', 'preferred_question_type'
        ])
        course_features.columns = cols
        
        # Calculate additional metrics
        course_features['avg_score'] = course_features['avg_score'].fillna(0)
        course_features['score_std'] = course_features['score_std'].fillna(0)
        course_features['correct_rate'] = course_features['correct_rate'].fillna(0)
        
        # Time-based features
        course_features['first_attempt'] = pd.to_datetime(course_features['first_attempt'], errors='coerce')
        course_features['last_attempt'] = pd.to_datetime(course_features['last_attempt'], errors='coerce')
        course_features['days_active'] = (
            course_features['last_attempt'] - course_features['first_attempt']
        ).dt.days.fillna(0)
        
        # Calculate improvement trend for this course
        improvement_scores = []
        for idx, row in course_features.iterrows():
            user_id = row['user_id']
            course = row.get('course_id')
            user_attempts = df[df['user_id'] == user_id]
            if course:
                user_attempts = user_attempts[user_attempts['course_id'] == course]
            user_attempts = user_attempts.sort_values('attempted_at')
            if len(user_attempts) >= 2:
                first_half = user_attempts.head(len(user_attempts) // 2)['score_pct'].mean()
                second_half = user_attempts.tail(len(user_attempts) // 2)['score_pct'].mean()
                improvement = second_half - first_half
            else:
                improvement = 0
            improvement_scores.append(improvement)
        
        course_features['improvement_trend'] = improvement_scores
        
        # Fill any remaining NaN values
        course_features = course_features.fillna(0)
        
        return course_features
    
    def close(self):
        """Close MongoDB connection"""
        if self.client:
            self.client.close()
