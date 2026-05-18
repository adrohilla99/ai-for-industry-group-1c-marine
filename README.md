# Digital Twin for Predictive Maintenance of a Marine Gas Turbine

## Overview

This project implements a web-based Digital Twin dashboard for the real-time monitoring and predictive maintenance of a naval vessel's gas turbine propulsion system. The system uses a dual-model machine learning architecture to simulate healthy engine behavior, diagnose degradation based on live telemetry, and provide explainable AI insights into its predictions.

The interactive dashboard allows users to control the engine's lever position and inject simulated faults to observe how the system responds and predicts potential failures.

## Architecture

The project is composed of three main parts: a frontend web interface, a Flask backend server, and a machine learning pipeline for training the models.

### 1. Machine Learning Models

Two core models work together to form the digital twin:

*   **Model A: The Simulator (`digital_twin_model.pkl`)**
    *   **Type:** `MultiOutputRegressor` (using XGBoost as the base estimator).
    *   **Purpose:** Acts as the "healthy" digital twin. It is trained *only* on data from healthy engine states.
    *   **Input:** A single feature: `Lever position`.
    *   **Output:** 13 "healthy" sensor readings (telemetry) corresponding to that lever position.

*   **Model B: The Diagnoser (`diagnosis_model.pkl`)**
    *   **Type:** `XGBRegressor`.
    *   **Purpose:** Predicts the overall health of the engine. It is trained on the full dataset (both healthy and degraded states).
    *   **Input:** 14 features, including the `Lever position` and the 13 (potentially faulty) sensor readings.
    *   **Output:** A single continuous value representing the engine's overall decay coefficient.

### 2. Backend (`app.py`)

A Flask server that orchestrates the predictive pipeline:
1.  Receives the `Lever position` and fault injection percentages from the frontend.
2.  **Simulate:** Uses **Model A** to generate the expected "healthy" telemetry for the given lever position.
3.  **Inject Faults:** Artificially degrades the healthy telemetry based on the user's fault injection settings.
4.  **Diagnose:** Feeds the (now potentially faulty) 14 features into **Model B** to get a real-time engine health diagnosis.
5.  **Explain:** Uses **SHAP (SHapley Additive exPlanations)** to generate a waterfall plot, explaining which features contributed most to the diagnosis.
6.  Sends the final status, failure probability, telemetry, and SHAP plot back to the frontend.

### 3. Frontend (`templates/index.html`, `static/`)

An interactive dashboard that allows a user to:
- Control the simulated `Lever position`.
- Inject `Compressor` and `Turbine` faults via sliders.
- View the live simulated sensor telemetry.
- See the AI's real-time diagnosis (System Status and Failure Probability).
- Analyze the SHAP waterfall plot to understand the AI's reasoning.

## Methodology

The models are trained in the `naval-vessel-predictive-maintenance.ipynb` notebook.

1.  **Digital Twin Model (Simulator):**
    - The dataset is filtered to include only "healthy" rows (where decay coefficients are >= 0.99).
    - An `XGBRegressor` wrapped in a `MultiOutputRegressor` is trained to predict 13 sensor outputs from the `Lever position`.

2.  **Diagnosis Model:**
    - The full dataset is used.
    - The target variable is created by averaging the compressor and turbine decay coefficients into a single `Overall_Decay` score.
    - Four models (`LinearRegression`, `DecisionTree`, `RandomForest`, `XGBoost`) are compared.
    - The best-performing model based on Mean Squared Error (MSE) is selected, retrained on the full dataset, and saved.

## Project Structure

```
.
├── app.py                                  # Flask backend server
├── naval-vessel-predictive-maintenance.ipynb # Notebook for model training & analysis
├── digital_twin_model.pkl                  # Model A: The Simulator
├── diagnosis_model.pkl                     # Model B: The Diagnoser
├── templates/
│   └── index.html                          # Frontend dashboard HTML
├── static/
│   ├── style.css                           # Dashboard CSS
│   └── script.js                           # Dashboard JavaScript
├── input/
│   └── data.csv                            # Dataset
├── README.md                               # Project documentation
└── requirements.txt                        # Python dependencies
```

## Requirements

See `requirements.txt` for all dependencies. Key packages include:
- Flask
- pandas
- scikit-learn
- xgboost
- joblib
- shap
- matplotlib

## Usage

1.  **Train the Models:**
    - Open and run all cells in `naval-vessel-predictive-maintenance.ipynb` to generate `digital_twin_model.pkl` and `diagnosis_model.pkl`.

2.  **Run the Web Application:**
    - Install dependencies: `pip install -r requirements.txt`
    - Start the Flask server: `python app.py`
    - Open a web browser and navigate to `http://127.0.0.1:5000`.
