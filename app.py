"""
Digital Twin Predictive Maintenance Dashboard — Flask Backend
Dual-ML Architecture:
  TWIN_MODEL       : MultiOutputRegressor  —  Lever_Position (1) → 13 telemetry outputs
  CLASSIFIER_MODEL : RandomForestRegressor —  Lever + 13 telemetry (14) → Engine Decay Coefficient
"""

import io
import base64
import warnings

import joblib
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

import numpy as np
import pandas as pd
import shap
from flask import Flask, request, jsonify, render_template

warnings.filterwarnings('ignore')

app = Flask(__name__)


# ══════════════════════════════════════════════════════════════════════════════
#  FEATURE SCHEMA
# ══════════════════════════════════════════════════════════════════════════════

TELEMETRY_KEYS = [
    'Ship_Speed',
    'GT_Shaft_Torque',
    'GT_Rate_of_Rev',
    'GG_Rate_of_Rev',
    'Stbd_Prop_Torque',
    'Port_Prop_Torque',
    'HP_Turbine_Exit_Temp',
    'Compressor_Out_Temp',
    'HP_Turbine_Exit_Press',
    'Compressor_Out_Press',
    'Exhaust_Gas_Press',
    'Turbine_Inject_Ctrl',
    'Fuel_Flow',
]

CLASSIFIER_COLS = ['Lever_Position'] + TELEMETRY_KEYS

FEATURE_LABELS = {
    'Lever_Position':        'Lever Position',
    'Ship_Speed':            'Ship Speed [kn]',
    'GT_Shaft_Torque':       'GT Shaft Torque [kN·m]',
    'GT_Rate_of_Rev':        'GT Rate of Rev [rpm]',
    'GG_Rate_of_Rev':        'GG Rate of Rev [rpm]',
    'Stbd_Prop_Torque':      'Stbd Prop Torque [kN]',
    'Port_Prop_Torque':      'Port Prop Torque [kN]',
    'HP_Turbine_Exit_Temp':  'HP Turbine Exit Temp [°C]',
    'Compressor_Out_Temp':   'Compressor Out Temp [°C]',
    'HP_Turbine_Exit_Press': 'HP Turbine Exit Press [bar]',
    'Compressor_Out_Press':  'Compressor Out Press [bar]',
    'Exhaust_Gas_Press':     'Exhaust Gas Press [bar]',
    'Turbine_Inject_Ctrl':   'Turbine Inject Ctrl [%]',
    'Fuel_Flow':             'Fuel Flow [kg/s]',
}

# Decay thresholds: output of CLASSIFIER_MODEL is a decay coefficient ~0.975–0.996.
# Lower value = more degraded.
_HEALTHY_DECAY  = 0.990
_CRITICAL_DECAY = 0.982


# ══════════════════════════════════════════════════════════════════════════════
#  MODEL INITIALIZATION
# ══════════════════════════════════════════════════════════════════════════════

try:
    TWIN_MODEL       = joblib.load('digital_twin_model.pkl')
    CLASSIFIER_MODEL = joblib.load('diagnosis_model.pkl')
    EXPLAINER        = shap.TreeExplainer(CLASSIFIER_MODEL)
    print(f"[startup] Loaded digital_twin_model.pkl : {type(TWIN_MODEL).__name__} "
          f"(n_features_in_={getattr(TWIN_MODEL, 'n_features_in_', '?')})")
    print(f"[startup] Loaded diagnosis_model.pkl    : {type(CLASSIFIER_MODEL).__name__} "
          f"(n_features_in_={getattr(CLASSIFIER_MODEL, 'n_features_in_', '?')})")
except FileNotFoundError as e:
    print(f"[startup] ERROR — model file not found: {e}")
    print("[startup] Ensure digital_twin_model.pkl and diagnosis_model.pkl are in the project root.")
    raise


# ══════════════════════════════════════════════════════════════════════════════
#  PIPELINE HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _simulate_telemetry(lever: float) -> dict:
    """Step A — twin model: lever → 13 healthy sensor values."""
    predicted = TWIN_MODEL.predict([[lever]])[0]
    return dict(zip(TELEMETRY_KEYS, predicted.tolist()))


def _inject_faults(telemetry: dict, compressor_fault: float, turbine_fault: float) -> dict:
    """Step B — manipulate the two SHAP-dominant features to simulate degradation."""
    faulted = telemetry.copy()
    faulted['Compressor_Out_Temp'] = telemetry['Compressor_Out_Temp'] * (1 + compressor_fault - turbine_fault)
    faulted['GT_Rate_of_Rev']      = telemetry['GT_Rate_of_Rev']      * (1 - compressor_fault + turbine_fault)
    return faulted


_DECAY_RANGE = _HEALTHY_DECAY - _CRITICAL_DECAY  # 0.008 — width of the danger band


def _diagnose(lever: float, telemetry: dict) -> tuple[str, float]:
    """Step C — failure probability relative to the healthy baseline at this lever position.

    Fixed global thresholds break at high lever values because the model outputs
    naturally lower decay coefficients under high load.  Instead we ask the model
    what a *fault-free* engine looks like right now, then measure how far below
    that baseline the faulted telemetry sits.
    """
    # Healthy reference: what decay does the model expect with no faults at this lever?
    healthy_tel   = _simulate_telemetry(lever)
    healthy_row   = np.array([[lever] + [healthy_tel[k] for k in TELEMETRY_KEYS]])
    healthy_decay = float(np.mean(np.atleast_1d(CLASSIFIER_MODEL.predict(healthy_row)[0])))

    # Actual (possibly faulted) decay
    row        = np.array([[lever] + [telemetry[k] for k in TELEMETRY_KEYS]])
    mean_decay = float(np.mean(np.atleast_1d(CLASSIFIER_MODEL.predict(row)[0])))

    critical_decay = healthy_decay - _DECAY_RANGE

    if mean_decay >= healthy_decay:
        prob = 0.0
    elif mean_decay <= critical_decay:
        prob = 1.0
    else:
        linear_prob = (healthy_decay - mean_decay) / _DECAY_RANGE
        prob = linear_prob ** 0.5

    status = 'MAINTENANCE REQUIRED' if prob >= 0.6 else 'HEALTHY'
    return status, prob


def _shap_waterfall_b64(lever: float, telemetry: dict) -> str:
    """Step D — SHAP waterfall for the diagnosis row; returns base64 PNG."""
    row = pd.DataFrame(
        [[lever] + [telemetry[k] for k in TELEMETRY_KEYS]],
        columns=CLASSIFIER_COLS,
    )

    shap_vals = EXPLAINER(row.values)
    shap_vals.feature_names = [FEATURE_LABELS[c] for c in CLASSIFIER_COLS]

    # Single-output RFR → 2D Explanation (samples, features); pick sample 0.
    sv = shap_vals[0]

    # Scale by 100 so the waterfall shows readable numbers (e.g. ±0.4)
    # instead of the raw decay-coefficient variance (e.g. ±0.004).
    sv.values      = sv.values      * 100
    sv.base_values = sv.base_values * 100

    fig = plt.figure(figsize=(7, 4))
    fig.patch.set_facecolor('#1a1a1a')
    shap.plots.waterfall(sv, show=False, max_display=10)

    for ax in fig.get_axes():
        ax.set_facecolor('#1a1a1a')
        ax.tick_params(colors='#cccccc', labelsize=8)
        for spine in ax.spines.values():
            spine.set_edgecolor('#444444')
        ax.xaxis.label.set_color('#cccccc')
        ax.yaxis.label.set_color('#cccccc')

    plt.gcf().patch.set_facecolor('#1a1a1a')
    plt.tight_layout(pad=0.8)

    buf = io.BytesIO()
    plt.savefig(buf, format='png', dpi=90, bbox_inches='tight',
                facecolor='#1a1a1a', edgecolor='none')
    buf.seek(0)
    img_b64 = base64.b64encode(buf.read()).decode('utf-8')
    plt.clf()
    plt.close('all')
    buf.close()
    return img_b64


# ══════════════════════════════════════════════════════════════════════════════
#  ROUTES
# ══════════════════════════════════════════════════════════════════════════════

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/predict', methods=['POST'])
def predict():
    payload = request.get_json(force=True)

    try:
        lever = float(np.clip(float(payload['Lever_Position']), 1.1, 9.3))
    except (KeyError, TypeError, ValueError):
        return jsonify({'error': 'Missing or invalid Lever_Position'}), 400

    # Faults arrive as raw % (0–20); convert to decimals for the fault equations.
    try:
        comp_fault = float(np.clip(float(payload.get('Compressor_Fault', 0)), 0, 20)) / 100
    except (TypeError, ValueError):
        comp_fault = 0.0

    try:
        turb_fault = float(np.clip(float(payload.get('Turbine_Fault', 0)), 0, 20)) / 100
    except (TypeError, ValueError):
        turb_fault = 0.0

    # A — Simulate healthy telemetry via digital twin
    telemetry = _simulate_telemetry(lever)
    # B — Inject dual-fault degradation onto Compressor_Out_Temp and GT_Rate_of_Rev
    telemetry = _inject_faults(telemetry, comp_fault, turb_fault)
    # C — Diagnose via decay regressor
    status, prob = _diagnose(lever, telemetry)
    # D — SHAP waterfall explanation
    img_b64 = _shap_waterfall_b64(lever, telemetry)

    return jsonify({
        'status':      status,
        'probability': round(prob * 100, 1),
        'telemetry':   telemetry,
        'shap_image':  img_b64,
    })


if __name__ == '__main__':
    app.run(debug=True, port=5000)
