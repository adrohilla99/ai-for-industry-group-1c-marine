/* ═══════════════════════════════════════════════════════════════════════════
   Digital Twin Dashboard · script.js
   Dual-ML architecture: lever + dual fault → /predict → twin simulation → AI diagnosis
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── 13 telemetry channels — must match TELEMETRY_KEYS order in app.py ─────
  const SENSOR_CONFIG = [
    { key: 'Ship_Speed',            id: 'slider-ship-speed',            label: 'Ship Speed',            unit: 'kn',   min: 0,    max: 30,    step: 0.1    },
    { key: 'GT_Shaft_Torque',       id: 'slider-gt-shaft-torque',       label: 'GT Shaft Torque',       unit: 'kN·m', min: 0,    max: 80000, step: 10     },
    { key: 'GT_Rate_of_Rev',        id: 'slider-gt-rate-of-rev',        label: 'GT Rate of Rev',        unit: 'rpm',  min: 1000, max: 4000,  step: 1      },
    { key: 'GG_Rate_of_Rev',        id: 'slider-gg-rate-of-rev',        label: 'GG Rate of Rev',        unit: 'rpm',  min: 6000, max: 10000, step: 1      },
    { key: 'Stbd_Prop_Torque',      id: 'slider-stbd-prop-torque',      label: 'Stbd Prop Torque',      unit: 'kN',   min: 0,    max: 700,   step: 0.1    },
    { key: 'Port_Prop_Torque',      id: 'slider-port-prop-torque',      label: 'Port Prop Torque',      unit: 'kN',   min: 0,    max: 700,   step: 0.1    },
    { key: 'HP_Turbine_Exit_Temp',  id: 'slider-hp-turbine-exit-temp',  label: 'HP Turbine Exit Temp',  unit: '°C',   min: 400,  max: 1200,  step: 0.1    },
    { key: 'Compressor_Out_Temp',   id: 'slider-compressor-out-temp',   label: 'Compressor Out Temp',   unit: '°C',   min: 500,  max: 850,   step: 0.1    },
    { key: 'HP_Turbine_Exit_Press', id: 'slider-hp-turbine-exit-press', label: 'HP Turbine Exit Press', unit: 'bar',  min: 1,    max: 5,     step: 0.001  },
    { key: 'Compressor_Out_Press',  id: 'slider-compressor-out-press',  label: 'Compressor Out Press',  unit: 'bar',  min: 5,    max: 25,    step: 0.001  },
    { key: 'Exhaust_Gas_Press',     id: 'slider-exhaust-gas-press',     label: 'Exhaust Gas Press',     unit: 'bar',  min: 1.0,  max: 1.1,   step: 0.0001 },
    { key: 'Turbine_Inject_Ctrl',   id: 'slider-turbine-inject-ctrl',   label: 'Turbine Inject Ctrl',   unit: '%',    min: 0,    max: 110,   step: 0.1    },
    { key: 'Fuel_Flow',             id: 'slider-fuel-flow',             label: 'Fuel Flow',             unit: 'kg/s', min: 0,    max: 2,     step: 0.001  },
  ];

  // ── CSS track-fill: set --pct so the gradient follows the thumb ───────────
  function setSliderFill(el) {
    if (!el) return;
    const min = parseFloat(el.min) || 0;
    const max = parseFloat(el.max) || 100;
    const pct = Math.min(100, Math.max(0, ((parseFloat(el.value) - min) / (max - min)) * 100));
    el.style.setProperty('--pct', pct.toFixed(2) + '%');
  }

  // ── Format a sensor value to an appropriate decimal precision ────────────
  function fmtVal(v, cfg) {
    const n = parseFloat(v);
    if (isNaN(n)) return '—';
    if (cfg.step < 0.01) return n.toFixed(4);
    if (cfg.step < 0.1)  return n.toFixed(3);
    if (cfg.step < 1)    return n.toFixed(1);
    return n.toFixed(0);
  }

  // ── Debounce ──────────────────────────────────────────────────────────────
  function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }


  // ══════════════════════════════════════════════════════════════════════════
  //  MASTER INPUTS  (pre-built in HTML)
  // ══════════════════════════════════════════════════════════════════════════

  const leverSlider     = document.getElementById('lever-slider');
  const compFaultSlider = document.getElementById('compressor-fault-slider');
  if (!leverSlider || !compFaultSlider) {
    console.error('[script.js] Required master sliders not found — check HTML IDs: '
      + 'lever-slider, compressor-fault-slider');
    return;
  }

  [leverSlider, compFaultSlider].forEach(setSliderFill);


  // ══════════════════════════════════════════════════════════════════════════
  //  SENSOR MAP  —  look up the 13 pre-built dependent sliders by ID
  //  Values are driven entirely by the twin model; sliders are visual outputs.
  // ══════════════════════════════════════════════════════════════════════════

  const sensorMap = {};

  for (const cfg of SENSOR_CONFIG) {
    const slider = document.getElementById(cfg.id);
    if (!slider) { console.warn(`[script.js] Slider not found: #${cfg.id}`); continue; }

    // Locate the numeric readout span inside the nearest .sensor-val container,
    // if the HTML provides one (graceful — absent is fine).
    const row   = slider.closest('.sensor-row');
    const numEl = row ? row.querySelector('.sensor-val span:first-child') : null;

    slider.setAttribute('tabindex', '-1');
    slider.style.pointerEvents = 'none';
    setSliderFill(slider);

    sensorMap[cfg.key] = { slider, numEl, cfg };
  }


  // ══════════════════════════════════════════════════════════════════════════
  //  CACHED DOM REFERENCES
  // ══════════════════════════════════════════════════════════════════════════

  const masterValueEl  = document.getElementById('master-value');
  const compFaultValEl = document.getElementById('comp-fault-val');

  const statusEl    = document.getElementById('ai-status');
  const probValEl   = document.getElementById('ai-probability');
  const shapImgEl   = document.getElementById('shap-image');
  const shapSpinner = document.getElementById('shap-spinner');
  const shapPH      = document.getElementById('shap-placeholder');
  const probBarEl   = document.getElementById('prob-bar');
  const sbStatusVal = document.getElementById('sb-status-val');
  const sbLatency     = document.getElementById('sb-latency');
  const panelLatency  = document.getElementById('panel-latency');
  const leds        = document.querySelectorAll('.led');

  // ── Live UTC clock ────────────────────────────────────────────────────────
  (function tickClock() {
    const el = document.getElementById('tb-clock');
    if (el) {
      const d  = new Date();
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      const ss = String(d.getUTCSeconds()).padStart(2, '0');
      el.textContent = `${hh}:${mm}:${ss} UTC`;
    }
    setTimeout(tickClock, 1000);
  })();

  // ── LED strip ─────────────────────────────────────────────────────────────
  function updateLEDs(prob) {
    if (!leds.length) return;
    const lit = Math.round((prob / 100) * leds.length);
    leds.forEach((led, i) => {
      led.classList.remove('on-green', 'on-amber', 'on-red');
      if (i < lit) {
        led.classList.add(prob < 40 ? 'on-green' : prob < 70 ? 'on-amber' : 'on-red');
      }
    });
  }

  // ── Loading / error UI ────────────────────────────────────────────────────
  function setLoading() {
    if (statusEl) {
      statusEl.textContent = 'COMPUTING…';
      statusEl.style.color = 'var(--amber, #f5a623)';
    }
    if (shapSpinner) shapSpinner.style.display = 'flex';
    if (shapPH)      shapPH.style.display      = 'none';
    if (shapImgEl)   shapImgEl.style.display   = 'none';
  }

  function setError(msg) {
    if (statusEl) {
      statusEl.style.color = 'var(--red, #ff4444)';
      statusEl.textContent = 'SERVER ERROR';
    }
    if (shapSpinner) shapSpinner.style.display = 'none';
    if (shapPH) {
      shapPH.style.display = 'block';
      const t = shapPH.querySelector('.shap-placeholder-text');
      if (t) t.textContent = msg || 'Server error';
    }
    console.error('[updateDashboard]', msg);
  }


  // ══════════════════════════════════════════════════════════════════════════
  //  MAIN — fetch /predict, receive twin simulation + AI diagnosis
  // ══════════════════════════════════════════════════════════════════════════

  async function updateDashboard() {
    const lever     = parseFloat(leverSlider.value);
    const compFault = parseFloat(compFaultSlider.value);

    // Update master slider track fills and readouts
    setSliderFill(leverSlider);
    setSliderFill(compFaultSlider);
    if (masterValueEl)  masterValueEl.textContent  = lever.toFixed(1);
    if (compFaultValEl) compFaultValEl.textContent = parseFloat(compFaultSlider.value).toFixed(1);
    setLoading();

    const t0 = performance.now();
    let data;
    try {
      const res = await fetch('/predict', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        // Faults are sent as raw % (0–20); app.py divides by 100 to get decimals.
        body: JSON.stringify({
          Lever_Position:   lever,
          Compressor_Fault: compFault,
          Turbine_Fault:    0,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      setError(err.message);
      return;
    }

    const ms = Math.round(performance.now() - t0);
    if (sbLatency)    sbLatency.textContent    = `${ms} ms`;
    if (panelLatency) panelLatency.textContent = ms;

    // ── 1. Auto-move all 13 dependent sensor sliders ──────────────────────────
    if (data.telemetry) {
      for (const [key, { slider, numEl, cfg }] of Object.entries(sensorMap)) {
        const v = data.telemetry[key];
        if (v == null) continue;
        slider.value = v;
        if (numEl) numEl.textContent = fmtVal(v, cfg);
        setSliderFill(slider);
      }
    }

    // ── 2. AI status (text + colour) ─────────────────────────────────────────
    const isHealthy = data.status === 'HEALTHY';
    const prob       = data.probability ?? 0;

    if (statusEl) {
      statusEl.style.color = isHealthy ? 'var(--green, #00ff88)' : 'var(--red, #ff4444)';
      statusEl.textContent = data.status ?? '—';
    }
    if (sbStatusVal) {
      sbStatusVal.textContent = isHealthy ? 'NOMINAL' : 'ALERT';
      sbStatusVal.style.color = isHealthy ? 'var(--green, #00ff88)' : 'var(--red, #ff4444)';
    }

    // ── 3. Failure probability ────────────────────────────────────────────────
    if (probValEl) probValEl.textContent = `Failure Risk: ${prob}%`;
    if (probBarEl) {
      probBarEl.style.width      = `${Math.min(prob, 100)}%`;
      probBarEl.style.background = isHealthy ? 'var(--green, #00ff88)' : 'var(--red, #ff4444)';
    }
    updateLEDs(prob);

    // ── 4. SHAP waterfall image ───────────────────────────────────────────────
    if (shapSpinner) shapSpinner.style.display = 'none';
    if (data.shap_image && shapImgEl) {
      shapImgEl.src           = `data:image/png;base64,${data.shap_image}`;
      shapImgEl.style.display = 'block';
      if (shapPH) shapPH.style.display = 'none';
    }
  }


  // ══════════════════════════════════════════════════════════════════════════
  //  EVENT WIRING  —  all three master sliders trigger the pipeline
  // ══════════════════════════════════════════════════════════════════════════

  const debouncedUpdate = debounce(updateDashboard, 280);

  leverSlider.addEventListener('input',     debouncedUpdate);
  leverSlider.addEventListener('change',    debouncedUpdate);
  compFaultSlider.addEventListener('input',  debouncedUpdate);
  compFaultSlider.addEventListener('change', debouncedUpdate);

  // Populate dashboard on first load
  updateDashboard();

})();
