import io
import base64
import pickle
import warnings
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import pandas as pd
import numpy as np
import shap
from flask import Flask, request, jsonify, render_template

warnings.filterwarnings('ignore')

app = Flask(__name__)

# ── Load model on startup ──────────────────────────────────────────────────────
with open('random_forest_model.pkl', 'rb') as f:
    bundle = pickle.load(f)


def _is_feature_list(value):
    if not isinstance(value, (list, tuple, np.ndarray, pd.Index)):
        return False
    return all(isinstance(item, str) for item in value)


if isinstance(bundle, dict):
    MODEL = bundle.get('model') or bundle.get('estimator')
    FEATURE_COLS = bundle.get('feature_cols') or bundle.get('feature_columns')
elif isinstance(bundle, (list, tuple)) and len(bundle) >= 2:
    if _is_feature_list(bundle[0]):
        FEATURE_COLS = list(bundle[0])
        MODEL = bundle[1]
    elif _is_feature_list(bundle[1]):
        FEATURE_COLS = list(bundle[1])
        MODEL = bundle[0]
    else:
        MODEL = bundle[0]
        FEATURE_COLS = bundle[1]
else:
    MODEL = bundle
    FEATURE_COLS = None

if not _is_feature_list(FEATURE_COLS):
    FEATURE_COLS = None

# Pre-build SHAP explainer once (expensive)
EXPLAINER = shap.TreeExplainer(MODEL)

# Friendly short labels for the SHAP plot
FEATURE_LABELS = {
    'Lever position':                                          'Lever Position',
    'Ship speed (v)':                                         'Ship Speed [kn]',
    'Gas Turbine (GT) shaft torque (GTT) [kN m]':             'GT Shaft Torque [kN·m]',
    'GT rate of revolutions (GTn) [rpm]':                     'GT Rate of Rev [rpm]',
    'Gas Generator rate of revolutions (GGn) [rpm]':          'GG Rate of Rev [rpm]',
    'Starboard Propeller Torque (Ts) [kN]':                   'Stbd Prop Torque [kN]',
    'Port Propeller Torque (Tp) [kN]':                        'Port Prop Torque [kN]',
    'High Pressure (HP) Turbine exit temperature (T48) [C]': 'HP Turbine Exit Temp [°C]',
    'GT Compressor outlet air temperature (T2) [C]':          'Compressor Out Temp [°C]',
    'HP Turbine exit pressure (P48) [bar]':                   'HP Turbine Exit Press [bar]',
    'GT Compressor outlet air pressure (P2) [bar]':           'Compressor Out Press [bar]',
    'GT exhaust gas pressure (Pexh) [bar]':                   'Exhaust Gas Press [bar]',
    'Turbine Injecton Control (TIC) [%]':                     'Turbine Inject Ctrl [%]',
    'Fuel flow (mf) [kg/s]':                                  'Fuel Flow [kg/s]',
    'GT Compressor decay state coefficient':                  'Compressor Decay Coeff',
    'GT Turbine decay state coefficient':                     'Turbine Decay Coeff',
}

# ── Default/nominal sensor values ─────────────────────────────────────────────
DEFAULTS = {
    'Lever position':                                          5.2,
    'Ship speed (v)':                                         15,
    'Gas Turbine (GT) shaft torque (GTT) [kN m]':             27000,
    'GT rate of revolutions (GTn) [rpm]':                     2136,
    'Gas Generator rate of revolutions (GGn) [rpm]':          8200,
    'Starboard Propeller Torque (Ts) [kN]':                   227,
    'Port Propeller Torque (Tp) [kN]':                        227,
    'High Pressure (HP) Turbine exit temperature (T48) [C]': 735,
    'GT Compressor outlet air temperature (T2) [C]':          646,
    'HP Turbine exit pressure (P48) [bar]':                   2.35,
    'GT Compressor outlet air pressure (P2) [bar]':           12.3,
    'GT exhaust gas pressure (Pexh) [bar]':                   1.03,
    'Turbine Injecton Control (TIC) [%]':                     33.6,
    'Fuel flow (mf) [kg/s]':                                  0.66,
    'GT Compressor decay state coefficient':                  0.975,
    'GT Turbine decay state coefficient':                     0.9875,
}

if FEATURE_COLS is None:
    FEATURE_COLS = [
    'Lever position',
    'Ship speed (v)',
    'Gas Turbine (GT) shaft torque (GTT) [kN m]',
    'GT rate of revolutions (GTn) [rpm]',
    'Gas Generator rate of revolutions (GGn) [rpm]',
    'Starboard Propeller Torque (Ts) [kN]',
    'Port Propeller Torque (Tp) [kN]',
    'High Pressure (HP) Turbine exit temperature (T48) [C]',
    'GT Compressor outlet air temperature (T2) [C]',
    'HP Turbine exit pressure (P48) [bar]',
    'GT Compressor outlet air pressure (P2) [bar]',
    'GT exhaust gas pressure (Pexh) [bar]',
    'Turbine Injecton Control (TIC) [%]',
    'Fuel flow (mf) [kg/s]',
    'GT Compressor decay state coefficient',
    'GT Turbine decay state coefficient',
]


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/predict', methods=['POST'])
def predict():
    payload = request.get_json(force=True)
    print("Received payload:", payload)  # Log incoming data

    # Build feature row from payload (falling back to defaults for hidden sensors)
    row = {}
    for col in FEATURE_COLS:
        row[col] = float(payload.get(col, DEFAULTS[col]))

    df_row = pd.DataFrame([row], columns=FEATURE_COLS)
    print("DataFrame row for prediction:\n", df_row) # Log DataFrame

    # ── Prediction ────────────────────────────────────────────────────────────
    if hasattr(MODEL, 'predict_proba'):
        proba = MODEL.predict_proba(df_row)[0]
        failure_prob = float(proba[1])
    else:
        prediction = MODEL.predict(df_row)
        prediction_value = np.asarray(prediction).reshape(-1)[0]
        failure_prob = float(np.clip(prediction_value, 0.0, 1.0))
    
    print(f"Predicted failure probability: {failure_prob:.4f}") # Log prediction
    
    status = 'MAINTENANCE REQUIRED' if failure_prob >= 0.5 else 'NOMINAL'

    # ── SHAP waterfall ────────────────────────────────────────────────────────
    shap_values = EXPLAINER(df_row)

    # Rename features for readability
    shap_values.feature_names = [FEATURE_LABELS.get(c, c) for c in FEATURE_COLS]

    fig, ax = plt.subplots(figsize=(9, 5.5))
    fig.patch.set_facecolor('#1a1a1a')

    # For binary classifiers, shap_values has shape (n_samples, n_features, n_classes)
    # We want the failure class (index 1) for the first (only) sample
    sv = shap_values[0, :, 1] if shap_values.values.ndim == 3 else shap_values[0]
    shap.plots.waterfall(sv, show=False, max_display=12)

    # Style the existing axes to match the dark industrial theme
    fig_axes = plt.gcf().get_axes()
    for a in fig_axes:
        a.set_facecolor('#1a1a1a')
        a.tick_params(colors='#c8c8c8', labelsize=8)
        for spine in a.spines.values():
            spine.set_edgecolor('#444444')
        a.xaxis.label.set_color('#c8c8c8')
        a.yaxis.label.set_color('#c8c8c8')
        a.title.set_color('#c8c8c8') if hasattr(a, 'title') else None

    plt.gcf().patch.set_facecolor('#1a1a1a')
    plt.tight_layout(pad=0.8)

    buf = io.BytesIO()
    plt.savefig(buf, format='png', dpi=110, bbox_inches='tight',
                facecolor='#1a1a1a', edgecolor='none')
    buf.seek(0)
    img_b64 = base64.b64encode(buf.read()).decode('utf-8')
    plt.close('all')
    buf.close()

    return jsonify({
        'status': status,
        'probability': round(failure_prob * 100, 2),
        'shap_image_base64': img_b64,
    })


if __name__ == '__main__':
    app.run(debug=True, port=5000)
