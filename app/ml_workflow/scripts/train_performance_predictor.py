#!/usr/bin/env python3
"""
Training script for Student Performance Predictor.
Run this script to train and save the model.
"""
import sys
import os
from pathlib import Path

# Load environment variables from .env file if it exists
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).parent.parent.parent / '.env'
    if env_path.exists():
        load_dotenv(env_path)
        print(f"Loaded environment variables from {env_path}")
except ImportError:
    # python-dotenv not installed, continue without it
    pass

# Add parent directory to path to import modules
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from ml_workflow.data_extractor import AssessmentDataExtractor
from ml_workflow.models.performance_predictor import StudentPerformancePredictor

def main():
    print("=" * 60)
    print("Student Performance Predictor - Training Script")
    print("=" * 60)
    
    # Initialize data extractor
    print("\n1. Extracting data from MongoDB...")
    extractor = AssessmentDataExtractor()
    
    try:
        # Extract raw data
        df_raw = extractor.extract_attempts_dataframe()
        
        if df_raw.empty:
            print("ERROR: No assessment attempts found in database.")
            print("Please ensure assessments have been taken and saved to MongoDB.")
            print("\nTo generate training data:")
            print("  1. Have students log in and take assessments")
            print("  2. Ensure assessments are submitted (not just viewed)")
            print("  3. At least 10 different students need to complete assessments")
            return
        
        num_students = df_raw['user_id'].nunique()
        num_attempts = len(df_raw)
        
        print(f"   Found {num_attempts} assessment attempt records")
        print(f"   Unique students: {num_students}")
        
        if num_students < 10:
            print(f"\n⚠️  WARNING: Only {num_students} student(s) found. Model requires at least 10 students.")
            print("   The model will not train reliably with this amount of data.")
            print("\n   Solutions:")
            print("     - Have more students complete assessments (need ~9 more students)")
            print("     - Or: Lower the minimum requirement in the code for testing (not recommended for production)")
            print("\n   Continuing anyway...")
        
        # Prepare features
        print("\n2. Engineering features...")
        predictor = StudentPerformancePredictor(model_type='random_forest')
        features_df = predictor.prepare_features(df_raw)
        
        if features_df.empty:
            print("ERROR: Could not engineer features from data.")
            return
        
        print(f"   Created features for {len(features_df)} students")
        print(f"   Feature columns: {len(features_df.columns)}")
        
        # Train model
        print("\n3. Training model...")
        metrics = predictor.train(features_df, target_col='avg_score')
        
        # Display feature importance
        print("\n4. Top 10 Most Important Features:")
        importance = predictor.get_feature_importance(top_n=10)
        if importance is not None:
            for idx, row in importance.iterrows():
                print(f"   {row['feature']}: {row['importance']:.4f}")
        
        # Save model
        print("\n5. Saving model...")
        model_dir = Path(__file__).parent.parent.parent / 'ml_workflow' / 'saved_models'
        model_dir.mkdir(parents=True, exist_ok=True)
        model_path = model_dir / 'performance_predictor.pkl'
        predictor.save_model(str(model_path))
        
        print("\n" + "=" * 60)
        print("Training completed successfully!")
        print(f"Model saved to: {model_path}")
        print("=" * 60)
        
    except Exception as e:
        print(f"\nERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        return 1
    
    finally:
        extractor.close()
    
    return 0

if __name__ == '__main__':
    exit(main())
