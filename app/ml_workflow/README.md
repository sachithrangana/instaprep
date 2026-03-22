# ML Workflow - Student Performance Predictor

This module implements machine learning models for analyzing and predicting student performance on assessments.

## Overview

The Student Performance Predictor uses historical assessment attempt data to predict how students will perform on future assessments. This can be used for:
- Early identification of at-risk students
- Personalized learning recommendations
- Adaptive assessment difficulty

## Structure

```
ml_workflow/
├── data_extractor.py              # Extract data from MongoDB
├── models/
│   └── performance_predictor.py   # ML model implementation
├── scripts/
│   └── train_performance_predictor.py  # Training script
└── saved_models/                  # Trained models stored here
```

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Ensure MongoDB is configured with `MONGODB_URI` environment variable.

## Training the Model

Run the training script to train and save the model:

```bash
python ml_workflow/scripts/train_performance_predictor.py
```

This will:
- Extract assessment attempt data from MongoDB
- Engineer features from the data
- Train a Random Forest regression model
- Save the model to `ml_workflow/saved_models/performance_predictor.pkl`

## Using the Model

### Via API

Once trained, the model is available via API endpoints:

**Get prediction for a student:**
```bash
GET /api/ml/student-performance/<user_id>
```

**Get model information:**
```bash
GET /api/ml/model-info
```

**Trigger model training:**
```bash
POST /api/ml/train-performance-model
```

### Via Python

```python
from ml_workflow.data_extractor import AssessmentDataExtractor
from ml_workflow.models.performance_predictor import StudentPerformancePredictor

# Load trained model
predictor = StudentPerformancePredictor()
predictor.load_model('ml_workflow/saved_models/performance_predictor.pkl')

# Extract data and prepare features
extractor = AssessmentDataExtractor()
df = extractor.extract_attempts_dataframe()
features = predictor.prepare_features(df)

# Predict for a student
prediction = predictor.predict('user-id-123', features)
print(f"Predicted score: {prediction['predicted_score']}")
```

## Model Details

- **Algorithm**: Random Forest Regressor
- **Target**: Average score percentage
- **Features**: Historical performance, attempt patterns, question type preferences, time-based features
- **Metrics**: R², RMSE, MAE

## Notes

- The model requires at least 10 student records with assessment attempts to train
- More data = better predictions
- Model should be retrained periodically as new assessment data becomes available
