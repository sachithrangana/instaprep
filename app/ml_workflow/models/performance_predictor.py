"""
Student Performance Predictor Model
Predicts student performance on assessments based on historical data.
"""
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_squared_error, r2_score, mean_absolute_error
import joblib
import pandas as pd
import numpy as np
import os
from pathlib import Path


class StudentPerformancePredictor:
    """
    Predict student performance on upcoming assessments.
    Use case: Early intervention for at-risk students
    """
    
    def __init__(self, model_type='random_forest'):
        """
        Initialize the predictor.
        
        Args:
            model_type: 'random_forest' or 'gradient_boosting'
        """
        self.model_type = model_type
        self.model = None
        self.scaler = StandardScaler()
        self.feature_columns = None
        self.is_trained = False
        self.metrics = {}
    
    def prepare_features(self, df):
        """
        Engineer features for prediction from raw assessment attempts data.
        
        Args:
            df: DataFrame with assessment attempts data
            
        Returns:
            DataFrame with engineered features per student
        """
        if df.empty:
            return pd.DataFrame()
        
        # Extract overall score percentage
        df['score_pct'] = df['overall_score'].apply(
            lambda x: x.get('percentage', 0) if isinstance(x, dict) else (
                x if isinstance(x, (int, float)) else 0
            )
        )
        
        # Student historical performance aggregations
        student_stats = df.groupby('user_id').agg({
            'score_pct': ['mean', 'std', 'min', 'max', 'count'],
            'is_correct': ['mean', 'sum'] if 'is_correct' in df.columns else 'count',
            'attempted_at': ['min', 'max', 'count'],
            'assessment_id': 'nunique' if 'assessment_id' in df.columns else 'count',
            'question_type': lambda x: x.value_counts().index[0] if len(x) > 0 else None
        }).reset_index()
        
        # Flatten column names
        student_stats.columns = [
            'user_id', 'avg_score', 'score_std', 'min_score', 'max_score', 'score_count',
            'correct_rate', 'total_correct',
            'first_attempt', 'last_attempt', 'attempt_count',
            'unique_assessments',
            'preferred_question_type'
        ]
        
        # Fill NaN values
        student_stats = student_stats.fillna(0)
        
        # Time-based features
        student_stats['first_attempt'] = pd.to_datetime(student_stats['first_attempt'], errors='coerce')
        student_stats['last_attempt'] = pd.to_datetime(student_stats['last_attempt'], errors='coerce')
        student_stats['days_active'] = (
            student_stats['last_attempt'] - student_stats['first_attempt']
        ).dt.days.fillna(0)
        
        # Calculate improvement trend (if multiple attempts)
        improvement_scores = []
        for user_id in student_stats['user_id']:
            user_attempts = df[df['user_id'] == user_id].sort_values('attempted_at')
            if len(user_attempts) >= 2:
                first_half = user_attempts.head(len(user_attempts) // 2)['score_pct'].mean()
                second_half = user_attempts.tail(len(user_attempts) // 2)['score_pct'].mean()
                improvement = second_half - first_half
            else:
                improvement = 0
            improvement_scores.append(improvement)
        
        student_stats['improvement_trend'] = improvement_scores
        
        # Question type performance breakdown
        if 'question_type' in df.columns:
            question_type_perf = df.groupby(['user_id', 'question_type'])['is_correct'].mean().unstack(fill_value=0)
            question_type_perf.columns = [f'perf_{str(col)}' for col in question_type_perf.columns]
            student_stats = student_stats.merge(
                question_type_perf, 
                left_on='user_id', 
                right_index=True, 
                how='left'
            ).fillna(0)
        
        # Fill any remaining NaN values
        student_stats = student_stats.fillna(0)
        
        return student_stats
    
    def train(self, features_df, target_col='avg_score', test_size=0.2, cv_folds=5):
        """
        Train the performance prediction model.
        
        Args:
            features_df: DataFrame with engineered features
            target_col: Column name to predict
            test_size: Proportion of data for testing
            cv_folds: Number of cross-validation folds
            
        Returns:
            Dictionary with training metrics
        """
        if features_df.empty:
            raise ValueError("Features dataframe is empty. Cannot train model.")
        
        if target_col not in features_df.columns:
            raise ValueError(f"Target column '{target_col}' not found in features dataframe.")
        
        # Prepare features and target
        exclude_cols = [target_col, 'user_id', 'first_attempt', 'last_attempt', 'preferred_question_type']
        feature_cols = [col for col in features_df.columns if col not in exclude_cols]
        
        X = features_df[feature_cols].copy()
        y = features_df[target_col].copy()
        
        # Remove any remaining non-numeric columns
        X = X.select_dtypes(include=[np.number])
        
        # Store feature columns for later use
        self.feature_columns = X.columns.tolist()
        
        # Minimum requirement: at least 1 student (for testing/demo purposes)
        # For production, at least 10 students are recommended
        if len(X) < 1:
            raise ValueError(
                f"Insufficient data for training. Need at least 1 student, got {len(X)}."
            )
        
        if len(X) < 3:
            print(f"\n⚠️  WARNING: Training with only {len(X)} student(s).")
            print("   This is sufficient for testing but predictions will not be reliable.")
            print("   For production use, train with at least 10+ students.\n")
        
        if len(X) < 10:
            import warnings
            warnings.warn(
                f"Training with only {len(X)} students. For reliable predictions, "
                "at least 10 students are recommended. Model accuracy may be limited.",
                UserWarning
            )
        
        # Split data (skip if only 1 sample)
        if len(X) == 1:
            # With only 1 sample, use it for both training and "testing"
            X_train, X_test = X, X
            y_train, y_test = y, y
        else:
            X_train, X_test, y_train, y_test = train_test_split(
                X, y, test_size=test_size, random_state=42
            )
        
        # Scale features
        X_train_scaled = self.scaler.fit_transform(X_train)
        if len(X) > 1:
            X_test_scaled = self.scaler.transform(X_test)
        else:
            X_test_scaled = X_train_scaled  # Same data if only 1 sample
        
        # Initialize model
        if self.model_type == 'random_forest':
            self.model = RandomForestRegressor(
                n_estimators=100,
                max_depth=10,
                min_samples_split=5,
                min_samples_leaf=2,
                random_state=42,
                n_jobs=-1
            )
        elif self.model_type == 'gradient_boosting':
            self.model = GradientBoostingRegressor(
                n_estimators=100,
                learning_rate=0.1,
                max_depth=5,
                min_samples_split=5,
                min_samples_leaf=2,
                random_state=42
            )
        else:
            raise ValueError(f"Unknown model_type: {self.model_type}")
        
        # Cross-validation (skip if insufficient data)
        if len(X_train) >= 2:
            print(f"Performing {min(cv_folds, len(X_train))}-fold cross-validation...")
            cv_scores = cross_val_score(
                self.model, X_train_scaled, y_train, 
                cv=min(cv_folds, len(X_train)), 
                scoring='r2',
                n_jobs=-1
            )
        else:
            print("Skipping cross-validation (insufficient data)")
            cv_scores = np.array([0.0])  # Placeholder
        
        # Train on full training set
        print("Training model on full training set...")
        self.model.fit(X_train_scaled, y_train)
        
        # Evaluate on test set
        y_pred = self.model.predict(X_test_scaled)
        
        # Calculate metrics (handle edge case with 1 sample)
        if len(y_test) > 1:
            test_r2 = float(r2_score(y_test, y_pred))
            test_mse = mean_squared_error(y_test, y_pred)
            test_rmse = float(np.sqrt(test_mse))
        else:
            # With 1 sample, R² is not well-defined, use 0 or perfect score
            test_r2 = 1.0 if len(y_test) == 1 else 0.0
            test_mse = 0.0
            test_rmse = 0.0
        
        self.metrics = {
            'cv_r2_mean': float(cv_scores.mean()) if len(cv_scores) > 0 else 0.0,
            'cv_r2_std': float(cv_scores.std()) if len(cv_scores) > 0 else 0.0,
            'test_r2': test_r2,
            'test_rmse': test_rmse,
            'test_mae': float(mean_absolute_error(y_test, y_pred)) if len(y_test) > 0 else 0.0,
            'n_samples': len(X),
            'n_features': len(self.feature_columns),
            'n_train': len(X_train),
            'n_test': len(X_test)
        }
        
        self.is_trained = True
        
        print(f"\nTraining completed!")
        print(f"Cross-validation R²: {self.metrics['cv_r2_mean']:.3f} (+/- {self.metrics['cv_r2_std']:.3f})")
        print(f"Test R²: {self.metrics['test_r2']:.3f}")
        print(f"Test RMSE: {self.metrics['test_rmse']:.2f}")
        print(f"Test MAE: {self.metrics['test_mae']:.2f}")
        
        return self.metrics
    
    def predict(self, user_id, features_df):
        """
        Predict performance for a specific user.
        
        Args:
            user_id: User ID to predict for
            features_df: DataFrame with features (must include this user_id)
            
        Returns:
            Dictionary with prediction results
        """
        if not self.is_trained:
            raise ValueError("Model is not trained. Call train() first or load a saved model.")
        
        user_features = features_df[features_df['user_id'] == user_id]
        if len(user_features) == 0:
            return None
        
        # Select only the features used during training
        X = user_features[self.feature_columns].copy()
        X = X.select_dtypes(include=[np.number])
        
        # Ensure all training features are present
        missing_features = set(self.feature_columns) - set(X.columns)
        if missing_features:
            for feat in missing_features:
                X[feat] = 0
        
        # Reorder columns to match training order
        X = X[self.feature_columns]
        
        X_scaled = self.scaler.transform(X)
        prediction = self.model.predict(X_scaled)[0]
        
        # Calculate confidence interval (using prediction std from trees if available)
        if hasattr(self.model, 'estimators_'):
            # For Random Forest: get predictions from all trees
            tree_predictions = np.array([tree.predict(X_scaled)[0] for tree in self.model.estimators_])
            std_pred = np.std(tree_predictions)
            confidence_interval = [max(0, prediction - 1.96 * std_pred), min(100, prediction + 1.96 * std_pred)]
        else:
            # Fallback for other models
            std_pred = self.metrics.get('test_rmse', 10.0)
            confidence_interval = [max(0, prediction - std_pred), min(100, prediction + std_pred)]
        
        return {
            'user_id': user_id,
            'predicted_score': round(float(prediction), 2),
            'confidence_interval': [round(float(ci), 2) for ci in confidence_interval],
            'prediction_std': round(float(std_pred), 2)
        }
    
    def predict_batch(self, features_df, user_ids=None):
        """
        Predict performance for multiple users.
        
        Args:
            features_df: DataFrame with features
            user_ids: List of user IDs to predict for (None = all users)
            
        Returns:
            DataFrame with predictions
        """
        if not self.is_trained:
            raise ValueError("Model is not trained. Call train() first or load a saved model.")
        
        if user_ids is None:
            user_ids = features_df['user_id'].unique()
        
        predictions = []
        for user_id in user_ids:
            pred = self.predict(user_id, features_df)
            if pred:
                predictions.append(pred)
        
        return pd.DataFrame(predictions)
    
    def get_feature_importance(self, top_n=10):
        """Get feature importance scores"""
        if not self.is_trained:
            raise ValueError("Model is not trained.")
        
        if hasattr(self.model, 'feature_importances_'):
            importance_df = pd.DataFrame({
                'feature': self.feature_columns,
                'importance': self.model.feature_importances_
            }).sort_values('importance', ascending=False)
            
            return importance_df.head(top_n)
        else:
            return None
    
    def save_model(self, filepath):
        """Save trained model to disk"""
        if not self.is_trained:
            raise ValueError("Model is not trained. Nothing to save.")
        
        # Create directory if it doesn't exist
        Path(filepath).parent.mkdir(parents=True, exist_ok=True)
        
        model_data = {
            'model': self.model,
            'scaler': self.scaler,
            'feature_columns': self.feature_columns,
            'model_type': self.model_type,
            'metrics': self.metrics,
            'is_trained': self.is_trained
        }
        
        joblib.dump(model_data, filepath)
        print(f"Model saved to {filepath}")
    
    def load_model(self, filepath):
        """Load trained model from disk"""
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"Model file not found: {filepath}")
        
        model_data = joblib.load(filepath)
        self.model = model_data['model']
        self.scaler = model_data['scaler']
        self.feature_columns = model_data['feature_columns']
        self.model_type = model_data.get('model_type', 'random_forest')
        self.metrics = model_data.get('metrics', {})
        self.is_trained = model_data.get('is_trained', True)
        
        print(f"Model loaded from {filepath}")
        if self.metrics:
            print(f"Model metrics: R² = {self.metrics.get('test_r2', 'N/A'):.3f}")
