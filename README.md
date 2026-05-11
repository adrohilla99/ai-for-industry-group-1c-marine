# Predictive Maintenance for Marine Engines

## Overview

This project implements a machine learning pipeline to classify marine engine maintenance statuses based on operational sensor data. The system categorizes engine conditions into three categories: Critical, Requires Maintenance, and Normal.

## Dataset

The analysis uses a simulated dataset representing operational data from 50 marine engines over a two-year period (2023-2024) with 5,000+ records.

### Features

**Numerical Features (10):**
- Engine temperature, oil pressure, fuel consumption, vibration level
- RPM, engine load, coolant temperature, exhaust temperature, running period

**Categorical Features (5):**
- Failure mode, engine type, fuel type, manufacturer, engine ID

**Target Variable:**
- Maintenance status (Critical, Requires Maintenance, Normal)

## Methodology

The project implements the following machine learning pipeline:

1. **Data Preprocessing**
   - Standardization of numerical features
   - One-Hot Encoding for categorical variables
   - Dimensionality reduction using PCA (n_components=0.95)

2. **Model Implementation**
   - Decision Tree Classifier
   - Random Forest Classifier
   - XGBoost Classifier

3. **Hyperparameter Tuning**
   - Grid Search with 3-fold cross-validation
   - Parameter optimization for Random Forest and XGBoost

## Results

| Model          | Accuracy |
|---------------|----------|
| DecisionTree  | 33.17%   |
| RandomForest  | 29.81%   |
| XGBoost      | 30.19%   |

## Project Structure

```
.
├── predictive_maintenance_analysis.ipynb   # Main analysis notebook
├── input/
│   └── marine_engine_data.csv              # Dataset
├── output/                                 # Generated visualizations and results
├── README.md                               # Project documentation
├── requirements.txt                        # Python dependencies
└── .gitignore                              # Git ignore file
```

## Requirements

See `requirements.txt` for all dependencies.

Key packages:
- pandas
- numpy
- scikit-learn
- matplotlib
- seaborn
- xgboost
- joblib

## Usage

To run the analysis:

1. Install required dependencies: `pip install -r requirements.txt`
2. Open and execute: `predictive_maintenance_analysis.ipynb`

## Notes

All visualizations are saved to the `output/` folder.

## Future Improvements

- Expand dataset size for better generalization
- Additional feature engineering
- Explore deep learning approaches
- Advanced hyperparameter optimization
- Feature importance analysis
