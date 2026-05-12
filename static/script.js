/* ═══════════════════════════════════════════════════════════════
   Fleet Monitoring Dashboard  ·  script.js
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── Debounce helper ──────────────────────────────────────────
  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  // ── Clock ────────────────────────────────────────────────────
  function updateClock() {
    const el = document.getElementById('tb-clock');
    if (!el) return;
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    el.textContent =
      `${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}-${pad(now.getUTCDate())}` +
      ` ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} UTC`;
  }
  setInterval(updateClock, 1000);
  updateClock();

  // ── Slider fill helper ───────────────────────────────────────
  function updateSliderFill(input) {
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const val = parseFloat(input.value);
    const pct = ((val - min) / (max - min)) * 100;
    input.style.setProperty('--pct', pct.toFixed(1) + '%');
  }

  // ── Sensor config  ─────────────────────────────────────────
  // Each entry: { key, label, unit, min, max, step, default, id }
  const SENSORS = [
    {
      id:      'master',
      key:     'Lever position',
      label:   'LEVER POSITION',
      unit:    '',
      min:     1.0, max: 9.5, step: 0.1, def: 5.2,
      isMaster: true,
    },
    {
      id:      'ship_speed',
      key:     'Ship speed (v)',
      label:   'SHIP SPEED',
      unit:    'kn',
      min:     3, max: 27, step: 1, def: 15,
    },
    {
      id:      'gt_torque',
      key:     'Gas Turbine (GT) shaft torque (GTT) [kN m]',
      label:   'GT SHAFT TORQUE',
      unit:    'kN·m',
      min:     250, max: 73000, step: 50, def: 27000,
    },
    {
      id:      'gt_rpm',
      key:     'GT rate of revolutions (GTn) [rpm]',
      label:   'GT RATE OF REV',
      unit:    'rpm',
      min:     1300, max: 3600, step: 10, def: 2136,
    },
    {
      id:      'gg_rpm',
      key:     'Gas Generator rate of revolutions (GGn) [rpm]',
      label:   'GAS GEN RATE OF REV',
      unit:    'rpm',
      min:     6500, max: 9850, step: 10, def: 8200,
    },
    {
      id:      'ts',
      key:     'Starboard Propeller Torque (Ts) [kN]',
      label:   'STBD PROP TORQUE',
      unit:    'kN',
      min:     5, max: 650, step: 1, def: 227,
    },
    {
      id:      'tp',
      key:     'Port Propeller Torque (Tp) [kN]',
      label:   'PORT PROP TORQUE',
      unit:    'kN',
      min:     5, max: 650, step: 1, def: 227,
    },
    {
      id:      't48',
      key:     'High Pressure (HP) Turbine exit temperature (T48) [C]',
      label:   'HP TURBINE EXIT TEMP',
      unit:    '°C',
      min:     440, max: 1120, step: 1, def: 735,
    },
    {
      id:      't2',
      key:     'GT Compressor outlet air temperature (T2) [C]',
      label:   'COMPRESSOR OUT TEMP',
      unit:    '°C',
      min:     540, max: 790, step: 1, def: 646,
    },
    {
      id:      'p48',
      key:     'HP Turbine exit pressure (P48) [bar]',
      label:   'HP TURBINE EXIT PRESS',
      unit:    'bar',
      min:     1.0, max: 4.6, step: 0.01, def: 2.35,
    },
    {
      id:      'p2',
      key:     'GT Compressor outlet air pressure (P2) [bar]',
      label:   'COMPRESSOR OUT PRESS',
      unit:    'bar',
      min:     5.8, max: 23.2, step: 0.1, def: 12.3,
    },
    {
      id:      'pexh',
      key:     'GT exhaust gas pressure (Pexh) [bar]',
      label:   'EXHAUST GAS PRESS',
      unit:    'bar',
      min:     1.019, max: 1.053, step: 0.001, def: 1.03,
    },
    {
      id:      'tic',
      key:     'Turbine Injecton Control (TIC) [%]',
      label:   'TURBINE INJECT CTRL',
      unit:    '%',
      min:     0, max: 93, step: 0.1, def: 33.6,
    },
    {
      id:      'mf',
      key:     'Fuel flow (mf) [kg/s]',
      label:   'FUEL FLOW',
      unit:    'kg/s',
      min:     0.068, max: 1.84, step: 0.001, def: 0.66,
    },
    {
      id:      'comp_decay',
      key:     'GT Compressor decay state coefficient',
      label:   'COMPRESSOR DECAY',
      unit:    '',
      min:     0.95, max: 1.0, step: 0.001, def: 0.975,
      isDecay: true,
    },
    {
      id:      'turb_decay',
      key:     'GT Turbine decay state coefficient',
      label:   'TURBINE DECAY',
      unit:    '',
      min:     0.975, max: 1.0, step: 0.001, def: 0.9875,
      isDecay: true,
    },
  ];

  // ── Build DOM: master slider ────────────────────────────────
  const masterCfg = SENSORS.find(s => s.isMaster);
  const masterWrap = document.getElementById('master-slider-wrap');
  const masterInput = document.createElement('input');
  masterInput.type = 'range';
  masterInput.id = 'master-slider';
  masterInput.min  = masterCfg.min;
  masterInput.max  = masterCfg.max;
  masterInput.step = masterCfg.step;
  masterInput.value = masterCfg.def;
  masterWrap.appendChild(masterInput);

  const masterValEl = document.getElementById('master-value');
  function updateMasterLabel(v) {
    masterValEl.textContent = parseFloat(v).toFixed(1);
  }
  updateMasterLabel(masterCfg.def);
  updateSliderFill(masterInput);

  masterInput.addEventListener('input', () => {
    updateMasterLabel(masterInput.value);
    updateSliderFill(masterInput);
    debouncedPredict();
  });

  // ── Build DOM: sensor sliders ────────────────────────────────
  const sensorList = document.getElementById('sensor-list');
  const sliderMap = {}; // id -> input element

  SENSORS.filter(s => !s.isMaster).forEach(cfg => {
    const row = document.createElement('div');
    row.className = 'sensor-row';

    const nameEl = document.createElement('span');
    nameEl.className = 'sensor-name';
    nameEl.textContent = cfg.label;

    const valEl = document.createElement('span');
    valEl.className = 'sensor-val';
    valEl.id = `val-${cfg.id}`;
    const fmt = formatSensorVal(cfg.def, cfg);
    valEl.innerHTML = `${fmt} <span class="sensor-unit">${cfg.unit}</span>`;

    const slider = document.createElement('input');
    slider.type  = 'range';
    slider.id    = `slider-${cfg.id}`;
    slider.min   = cfg.min;
    slider.max   = cfg.max;
    slider.step  = cfg.step;
    slider.value = cfg.def;
    slider.className = 'sensor-slider' + (cfg.isDecay ? ' decay-slider' : '');

    sliderMap[cfg.id] = slider;
    updateSliderFill(slider);

    slider.addEventListener('input', () => {
      const valDisplay = document.getElementById(`val-${cfg.id}`);
      const fv = formatSensorVal(slider.value, cfg);
      valDisplay.innerHTML = `${fv} <span class="sensor-unit">${cfg.unit}</span>`;
      updateSliderFill(slider);
      debouncedPredict();
    });

    row.appendChild(nameEl);
    row.appendChild(valEl);
    row.appendChild(slider);
    sensorList.appendChild(row);
  });

  function formatSensorVal(v, cfg) {
    const n = parseFloat(v);
    if (cfg.step < 0.01) return n.toFixed(3);
    if (cfg.step < 1)    return n.toFixed(2);
    if (cfg.step < 10)   return n.toFixed(1);
    return Math.round(n).toString();
  }

  // ── Collect payload ──────────────────────────────────────────
  function collectPayload() {
    const payload = {};
    payload[masterCfg.key] = parseFloat(masterInput.value);
    SENSORS.filter(s => !s.isMaster).forEach(cfg => {
      payload[cfg.key] = parseFloat(sliderMap[cfg.id].value);
    });
    return payload;
  }

  // ── Fetch prediction ─────────────────────────────────────────
  async function fetchPrediction() {
    const t0 = performance.now();
    showSpinner(true);

    try {
      const resp = await fetch('/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectPayload()),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      const latency = Math.round(performance.now() - t0);

      renderResult(data, latency);
    } catch (err) {
      console.error('Prediction error:', err);
      showError();
    } finally {
      showSpinner(false);
    }
  }

  const debouncedPredict = debounce(fetchPrediction, 280);

  // ── Render result ────────────────────────────────────────────
  function renderResult(data, latency) {
    const isWarning = data.status !== 'NOMINAL';

    // Status text
    const statusEl = document.getElementById('status-text');
    statusEl.textContent = data.status;
    statusEl.className   = isWarning ? 'warning' : 'healthy';

    // Probability
    const prob = parseFloat(data.probability);
    document.getElementById('prob-value').textContent = prob.toFixed(1);
    const bar = document.getElementById('prob-bar');
    bar.style.width = prob + '%';
    bar.style.background = isWarning ? 'var(--red)' : 'var(--green)';

    // LED strip
    const leds = document.querySelectorAll('.led');
    const litCount = Math.round((prob / 100) * leds.length);
    leds.forEach((led, i) => {
      led.className = 'led';
      if (i < litCount) {
        if (i < leds.length * 0.5)       led.classList.add('on-green');
        else if (i < leds.length * 0.75) led.classList.add('on-amber');
        else                              led.classList.add('on-red');
      }
    });

    // SHAP image
    const img = document.getElementById('shap-img');
    const placeholder = document.getElementById('shap-placeholder');
    img.src = 'data:image/png;base64,' + data.shap_image_base64;
    img.style.display = 'block';
    placeholder.style.display = 'none';

    // Status bar
    document.getElementById('sb-latency').textContent = latency + 'ms';
    document.getElementById('sb-status-val').textContent = data.status;
    document.getElementById('sb-status-val').style.color =
      isWarning ? 'var(--red)' : 'var(--green)';
  }

  function showSpinner(show) {
    const spinner = document.getElementById('shap-spinner');
    spinner.style.display = show ? 'flex' : 'none';
    if (show) {
      document.getElementById('shap-img').style.display = 'none';
    }
  }

  function showError() {
    document.getElementById('status-text').textContent = 'ERROR';
    document.getElementById('status-text').className = 'warning';
  }

  // ── Initial prediction on load ───────────────────────────────
  window.addEventListener('load', () => {
    setTimeout(fetchPrediction, 400);
  });

})();
