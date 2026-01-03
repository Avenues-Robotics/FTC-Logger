/* FTC Logger UI (self-contained; no CDN deps). */

const $ = (id) => document.getElementById(id);

const CROSSHAIR_CURSOR =
  "url(\"data:image/svg+xml;utf8," +
  "<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20'>" +
  "<line x1='10' y1='0' x2='10' y2='20' stroke='white' stroke-width='1'/>" +
  "<line x1='0' y1='10' x2='20' y2='10' stroke='white' stroke-width='1'/>" +
  "</svg>\") 10 10, crosshair";

const state = {
  opModes: [],
  opMode: "",
  runs: [],
  run: "",
  data: null,      // {t:[], series:{name:[]}}
  visible: new Set(),

  // viewport in data coords:
  xMin: 0, xMax: 1, yMin: -1, yMax: 1,

  // full extents (clamp zoom-out to these):
  full: { xMin: 0, xMax: 1, yMin: -1, yMax: 1 },

  tool: "select", // 'pan' or 'select'
  dragging: false,
  dragStart: null,
  dragRect: null,
  selectionRange: null, // [xMin, xMax] in tUnit
  regressionEnabled: false,
  stats: [],
  tUnit: "s",
};

function setStatus(s) { $("status").textContent = s; }

function cacheBust(url) {
  const sep = url.includes("?") ? "&" : "?";
  return url + sep + "_=" + Date.now();
}

async function fetchJson(url) {
  // bust caches to fix “only first run shows” issues
  const res = await fetch(cacheBust(url), { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return await res.json();
}

function bindDrawerButtons() {
  const openBtn = $("openTable");
  const closeBtn = $("closeTable");
  const manageBtn = $("openManager");
  const modal = $("manageModal");
  const closeModal = $("closeManager");
  const closeModalBtn = $("closeManagerBtn");
  const drawer = $("tableDrawer");
  const finishResize = () => {
    requestAnimationFrame(() => {
      resizeCanvases();
      draw();
    });
  };

  if (drawer) {
    drawer.addEventListener("transitionend", (ev) => {
      if (ev.propertyName === "width") finishResize();
    });
  }
  if (openBtn && drawer) openBtn.onclick = () => {
    drawer.classList.add("open");
    updateToggleUI();
  };
  if (closeBtn && drawer) closeBtn.onclick = () => {
    drawer.classList.remove("open");
    updateToggleUI();
  };
  if (manageBtn) manageBtn.onclick = async () => {
    if (modal) modal.classList.remove("hidden");
    await loadFileTree();
    updateToggleUI();
  };
  if (closeModal) closeModal.onclick = () => {
    if (modal) modal.classList.add("hidden");
    updateToggleUI();
  };
  if (closeModalBtn) closeModalBtn.onclick = () => {
    if (modal) modal.classList.add("hidden");
    updateToggleUI();
  };
}

function resizeCanvases() {
  const plot = $("plot");
  const ov = $("overlay");
  const rect = plot.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const dpr = window.devicePixelRatio || 1;

  plot.width = Math.floor(w * dpr);
  plot.height = Math.floor(h * dpr);
  plot.style.width = "100%";
  plot.style.height = "100%";

  ov.width = plot.width;
  ov.height = plot.height;
  ov.style.width = w + "px";
  ov.style.height = h + "px";
  ov.style.left = plot.offsetLeft + "px";
  ov.style.top = plot.offsetTop + "px";
}

function dataToPx(x, y, w, h) {
  const px = (x - state.xMin) / (state.xMax - state.xMin) * w;
  const py = h - (y - state.yMin) / (state.yMax - state.yMin) * h;
  return [px, py];
}
function pxToData(px, py, w, h) {
  const x = state.xMin + (px / w) * (state.xMax - state.xMin);
  const y = state.yMin + ((h - py) / h) * (state.yMax - state.yMin);
  return [x, y];
}

function getPlotMetrics(dpr) {
  const canvas = $("plot");
  const w = canvas.width;
  const h = canvas.height;
  const marginL = 54 * dpr;
  const marginT = 4 * dpr;
  const marginR = 8 * dpr;
  const marginB = 26 * dpr;
  const plotW = w - marginL - marginR;
  const plotH = h - marginT - marginB;
  return { w, h, marginL, marginT, marginR, marginB, plotW, plotH };
}

function clampViewportToFull() {
  // If viewport is larger than full extents, snap to full
  const vx = state.xMax - state.xMin;
  const vy = state.yMax - state.yMin;
  const fx = state.full.xMax - state.full.xMin;
  const fy = state.full.yMax - state.full.yMin;

  if (vx >= fx) { state.xMin = state.full.xMin; state.xMax = state.full.xMax; }
  else {
    if (state.xMin < state.full.xMin) {
      const d = state.full.xMin - state.xMin;
      state.xMin += d; state.xMax += d;
    }
    if (state.xMax > state.full.xMax) {
      const d = state.xMax - state.full.xMax;
      state.xMin -= d; state.xMax -= d;
    }
  }

  if (vy >= fy) { state.yMin = state.full.yMin; state.yMax = state.full.yMax; }
  else {
    if (state.yMin < state.full.yMin) {
      const d = state.full.yMin - state.yMin;
      state.yMin += d; state.yMax += d;
    }
    if (state.yMax > state.full.yMax) {
      const d = state.yMax - state.full.yMax;
      state.yMin -= d; state.yMax -= d;
    }
  }
}

function zoomBy(factor, aboutX = null, aboutY = null) {
  const cx = (aboutX == null) ? (state.xMin + state.xMax) / 2 : aboutX;
  const cy = (aboutY == null) ? (state.yMin + state.yMax) / 2 : aboutY;

  const hx = (state.xMax - state.xMin) / 2 * factor;
  const hy = (state.yMax - state.yMin) / 2 * factor;

  state.xMin = cx - hx; state.xMax = cx + hx;
  state.yMin = cy - hy; state.yMax = cy + hy;

  // Clamp zoom-out so you can’t go past “all data visible”
  clampViewportToFull();
  draw();
}

function computeFullExtents() {
  const t = state.data?.t || [];
  if (!t.length) {
    state.full = { xMin: 0, xMax: 1, yMin: -1, yMax: 1 };
    return;
  }

  let xMin = t[0], xMax = t[t.length - 1];
  let yMin = Infinity, yMax = -Infinity;

  for (const [name, arr] of Object.entries(state.data.series || {})) {
    // full extents should consider ALL series, not just visible
    for (const v of arr || []) {
      if (typeof v !== "number" || !isFinite(v)) continue;
      yMin = Math.min(yMin, v);
      yMax = Math.max(yMax, v);
    }
  }

  if (!isFinite(yMin) || !isFinite(yMax)) { yMin = -1; yMax = 1; }

  const yPad = (yMax - yMin) * 0.08 || 1;
  state.full = { xMin, xMax, yMin: yMin - yPad, yMax: yMax + yPad };
}

function setViewportToFull() {
  state.xMin = state.full.xMin; state.xMax = state.full.xMax;
  state.yMin = state.full.yMin; state.yMax = state.full.yMax;
  draw();
}

// --- Axes ticks with labels ---
function niceStep(span) {
  // returns 1,2,5 * 10^n steps
  const raw = span / 6; // aim ~6 ticks
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  let nice;
  if (m < 1.5) nice = 1;
  else if (m < 3) nice = 2;
  else if (m < 7) nice = 5;
  else nice = 10;
  return nice * p;
}

function drawAxes(ctx, w, h) {
  const dpr = window.devicePixelRatio || 1;
  const { marginL, marginT, marginB, plotW, plotH } = getPlotMetrics(dpr);

  // background already drawn by caller

  // grid + labels
  ctx.save();
  ctx.translate(marginL, marginT);

  // grid
  ctx.strokeStyle = "rgba(255,255,255,.10)";
  ctx.lineWidth = 1;

  const xSpan = state.xMax - state.xMin;
  const ySpan = state.yMax - state.yMin;
  const xStep = niceStep(xSpan);
  const yStep = niceStep(ySpan);

  const x0 = Math.ceil(state.xMin / xStep) * xStep;
  const y0 = Math.ceil(state.yMin / yStep) * yStep;

  // vertical grid + x labels
  ctx.fillStyle = "rgba(232,236,255,.75)";
  ctx.font = `${Math.max(10, Math.round(12 * (window.devicePixelRatio || 1)))}px system-ui`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  for (let x = x0; x <= state.xMax + xStep * 0.5; x += xStep) {
    const px = (x - state.xMin) / xSpan * plotW;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, plotH);
    ctx.stroke();

    // label (in parent coords, below plot)
    const label = formatTimeLabel(x);
    ctx.fillText(label, px, plotH + 6);
  }

  // horizontal grid + y labels
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let y = y0; y <= state.yMax + yStep * 0.5; y += yStep) {
    const py = plotH - (y - state.yMin) / ySpan * plotH;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(plotW, py);
    ctx.stroke();

    const label = (Math.abs(y) < 1e-9) ? "0" : y.toFixed(yStep < 1 ? 2 : 0);
    // y labels are drawn in left margin area (so draw at x = -6)
    ctx.fillText(label, -6, py);
  }

  // axes border
  ctx.strokeStyle = "rgba(255,255,255,.20)";
  ctx.strokeRect(0, 0, plotW, plotH);

  ctx.restore();

  return { marginL, marginB, plotW, plotH };
}

function draw() {
  const plot = $("plot");
  const ctx = plot.getContext("2d");
  const w = plot.width, h = plot.height;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#070914";
  ctx.fillRect(0, 0, w, h);

  if (!state.data) return;

  const axes = drawAxes(ctx, w, h);
  const { marginL, plotW, plotH } = axes;

  const t = state.data.t || [];
  const names = Object.keys(state.data.series || {});
  const statsByName = new Map(state.stats.map((s) => [s.name, s]));

  // draw series within plot area
  ctx.save();
  ctx.translate(marginL, 4);
  ctx.beginPath();
  ctx.rect(0, 0, plotW, plotH);
  ctx.clip();

  if (state.selectionRange) {
    const selMin = Math.max(state.selectionRange[0], state.xMin);
    const selMax = Math.min(state.selectionRange[1], state.xMax);
    if (selMax > selMin) {
      const x1 = (selMin - state.xMin) / (state.xMax - state.xMin) * plotW;
      const x2 = (selMax - state.xMin) / (state.xMax - state.xMin) * plotW;
      ctx.fillStyle = "rgba(255,255,255,.08)";
      ctx.fillRect(x1, 0, x2 - x1, plotH);
    }
  }

  for (let idx = 0; idx < names.length; idx++) {
    const name = names[idx];
    if (!state.visible.has(name)) continue;

    const arr = state.data.series[name];
    if (!arr || !arr.length) continue;

    ctx.fillStyle = seriesColor(idx);
    const r = 4.0;
    for (let i = 0; i < Math.min(t.length, arr.length); i++) {
      const x = t[i], y = arr[i];
      if (!isFinite(x) || !isFinite(y)) continue;
      if (x < state.xMin || x > state.xMax) continue;

      const px = (x - state.xMin) / (state.xMax - state.xMin) * plotW;
      const py = plotH - (y - state.yMin) / (state.yMax - state.yMin) * plotH;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // regression on top of points
  if (state.regressionEnabled) {
    for (let idx = 0; idx < names.length; idx++) {
      const name = names[idx];
      if (!state.visible.has(name)) continue;
      const stat = statsByName.get(name);
      if (stat && stat.regression) {
        const { m, b, xMin, xMax } = stat.regression;
        const x1 = Math.max(xMin, state.xMin);
        const x2 = Math.min(xMax, state.xMax);
        if (x2 > x1) {
          const y1 = m * x1 + b;
          const y2 = m * x2 + b;

          const p1x = (x1 - state.xMin) / (state.xMax - state.xMin) * plotW;
          const p2x = (x2 - state.xMin) / (state.xMax - state.xMin) * plotW;
          const p1y = plotH - (y1 - state.yMin) / (state.yMax - state.yMin) * plotH;
          const p2y = plotH - (y2 - state.yMin) / (state.yMax - state.yMin) * plotH;

          ctx.save();
          ctx.strokeStyle = regressionColor(idx);
          ctx.lineWidth = 4.0;
          ctx.beginPath();
          ctx.moveTo(p1x, p1y);
          ctx.lineTo(p2x, p2y);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }

  ctx.restore();

  const unitLabel = timeUnitLabel();
  if (unitLabel) {
    ctx.save();
    ctx.fillStyle = "rgba(232,236,255,.65)";
    ctx.font = `${Math.max(10, Math.round(12 * (window.devicePixelRatio || 1)))}px system-ui`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(`t (${unitLabel})`, marginL + plotW - 6, 4 + plotH - 6);
    ctx.restore();
  }

  // selection rect on overlay (canvas coords)
  const ov = $("overlay");
  const octx = ov.getContext("2d");
  octx.clearRect(0, 0, w, h);

  if (state.dragRect) {
    const r = state.dragRect;
    octx.save();
    octx.fillStyle = "rgba(122,162,255,.15)";
    octx.strokeStyle = "rgba(122,162,255,.7)";
    octx.lineWidth = 2;
    octx.fillRect(r.x, r.y, r.w, r.h);
    octx.strokeRect(r.x, r.y, r.w, r.h);
    octx.restore();
  }
}

// --- Table ---
function buildTable() {
  const t = state.data.t || [];
  const series = state.data.series || {};
  const tLabel = timeUnitLabel();
  const cols = [`t${tLabel ? " (" + tLabel + ")" : ""}`, ...Object.keys(series)];

  const head = $("tblHead");
  head.innerHTML = "";
  for (const c of cols) {
    const th = document.createElement("th");
    th.textContent = c;
    head.appendChild(th);
  }

  const body = $("tblBody");
  body.innerHTML = "";

  const n = Math.min(t.length, 2000);
  for (let i = 0; i < n; i++) {
    const tr = document.createElement("tr");
    tr.dataset.t = String(t[i]);
    tr.appendChild(cell(fmt(t[i])));
    for (const name of Object.keys(series)) {
      tr.appendChild(cell(fmt((series[name] || [])[i])));
    }
    body.appendChild(tr);
  }

  function cell(text) {
    const td = document.createElement("td");
    td.textContent = text;
    return td;
  }
}

function fmt(v) {
  if (typeof v !== "number" || !isFinite(v)) return "";
  return v.toFixed(4);
}

// --- Stats + regression ---
function updateStats() {
  if (!state.data) {
    state.stats = [];
    renderStats();
    return;
  }

  const names = Object.keys(state.data.series || {}).filter((n) => state.visible.has(n));
  const range = getStatsRange();
  state.stats = names.map((name) => computeStatsForSeries(name, range)).filter(Boolean);
  renderStats();
  updateTableHighlights();
}

async function loadFileTree() {
  const tree = $("fsTree");
  if (!tree) return;
  try {
    const j = await fetchJson("/logger/api/fs");
    renderFileTree(j.opModes || []);
  } catch (e) {
    tree.textContent = "Failed to load file list: " + e;
  }
}

function renderFileTree(opModes) {
  const tree = $("fsTree");
  if (!tree) return;
  tree.innerHTML = "";

  for (const op of opModes) {
    const group = document.createElement("div");
    group.className = "fsGroup";

    const header = document.createElement("div");
    header.className = "fsGroupHeader";
    const title = document.createElement("div");
    title.textContent = op.name;
    const delOp = document.createElement("button");
    delOp.className = "btn danger";
    delOp.textContent = "Delete OpMode";
    delOp.onclick = async () => {
      if (!confirm(`Delete OpMode "${op.name}" and all runs?`)) return;
      await fetchJson(`/logger/api/delete?opMode=${encodeURIComponent(op.name)}`);
      await refreshOpModeSelection();
      await loadFileTree();
    };
    header.appendChild(title);
    header.appendChild(delOp);
    group.appendChild(header);

    const runs = op.runs || [];
    for (const run of runs) {
      const row = document.createElement("div");
      row.className = "fsRunRow";

      const name = document.createElement("div");
      name.textContent = run.name;

      const meta = document.createElement("div");
      meta.className = "fsRunMeta";
      meta.textContent = formatBytes(run.bytes);

      const spaceIndex = run.name.indexOf(" ");
      const baseName = spaceIndex === -1 ? run.name : run.name.slice(0, spaceIndex);
      const currentSuffix = spaceIndex === -1 ? "" : run.name.slice(spaceIndex + 1).trim();

      const input = document.createElement("input");
      input.className = "input fsSuffix";
      input.placeholder = "suffix";
      input.value = currentSuffix;
      input.addEventListener("focus", () => {
        if (!input.dataset.touched) input.select();
      });
      input.addEventListener("mousedown", (event) => {
        if (!input.dataset.touched) {
          event.preventDefault();
          input.focus();
          input.select();
        }
      });
      input.addEventListener("input", () => {
        input.dataset.touched = "true";
      });
      input.addEventListener("blur", () => {
        delete input.dataset.touched;
      });

      const rename = document.createElement("button");
      rename.className = "btn";
      rename.textContent = "Rename";
      rename.onclick = async () => {
        const suffix = input.value.trim();
        if (suffix === currentSuffix) return;
        await fetchJson(`/logger/api/rename?opMode=${encodeURIComponent(op.name)}&run=${encodeURIComponent(run.name)}&base=${encodeURIComponent(baseName)}&suffix=${encodeURIComponent(suffix)}`);
        input.value = "";
        await refreshOpModeSelection();
        await loadFileTree();
      };

      const delRun = document.createElement("button");
      delRun.className = "btn danger";
      delRun.textContent = "Delete";
      delRun.onclick = async () => {
        if (!confirm(`Delete run "${run.name}"?`)) return;
        await fetchJson(`/logger/api/delete?opMode=${encodeURIComponent(op.name)}&run=${encodeURIComponent(run.name)}`);
        await refreshOpModeSelection();
        await loadFileTree();
      };

      row.appendChild(name);
      row.appendChild(meta);
      row.appendChild(input);
      row.appendChild(rename);
      row.appendChild(delRun);
      group.appendChild(row);
    }

    tree.appendChild(group);
  }
}

function getStatsRange() {
  if (state.selectionRange) return state.selectionRange;
  const t = state.data?.t || [];
  if (t.length) return [t[0], t[t.length - 1]];
  return [state.xMin, state.xMax];
}

function computeStatsForSeries(name, range) {
  const t = state.data?.t || [];
  const arr = (state.data?.series || {})[name] || [];
  const nMax = Math.min(t.length, arr.length);
  const xLo = range[0];
  const xHi = range[1];

  let count = 0;
  let mean = 0;
  let m2 = 0;
  let min = Infinity;
  let max = -Infinity;
  let xMin = null;
  let xMax = null;

  for (let i = 0; i < nMax; i++) {
    const x = t[i];
    const y = arr[i];
    if (!isFinite(x) || !isFinite(y)) continue;
    if (x < xLo || x > xHi) continue;

    count += 1;
    const delta = y - mean;
    mean += delta / count;
    m2 += delta * (y - mean);

    min = Math.min(min, y);
    max = Math.max(max, y);
    if (xMin == null || x < xMin) xMin = x;
    if (xMax == null || x > xMax) xMax = x;
  }

  if (!count) return null;
  const std = Math.sqrt(m2 / count);
  const regression = state.regressionEnabled ? computeRegression(t, arr, [xLo, xHi]) : null;

  return {
    name,
    count,
    mean,
    min,
    max,
    std,
    range: [xMin, xMax],
    regression,
  };
}

function computeRegression(t, arr, range) {
  const nMax = Math.min(t.length, arr.length);
  const xLo = range[0];
  const xHi = range[1];

  let n = 0;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  let yBar = 0;

  for (let i = 0; i < nMax; i++) {
    const xSec = t[i];
    const y = arr[i];
    if (!isFinite(xSec) || !isFinite(y)) continue;
    if (xSec < xLo || xSec > xHi) continue;

    const x = xSec;
    n += 1;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
    yBar = sy / n;
  }

  const denom = (n * sxx - sx * sx);
  if (n < 2 || Math.abs(denom) < 1e-12) return null;

  const m = (n * sxy - sx * sy) / denom;
  const b = (sy - m * sx) / n;

  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < nMax; i++) {
    const xSec = t[i];
    const y = arr[i];
    if (!isFinite(xSec) || !isFinite(y)) continue;
    if (xSec < xLo || xSec > xHi) continue;
    const x = xSec;
    const yHat = m * x + b;
    ssTot += (y - yBar) * (y - yBar);
    ssRes += (y - yHat) * (y - yHat);
  }

  const r2 = ssTot > 0 ? (1 - ssRes / ssTot) : 1;
  return { m, b, r2, xMin: xLo, xMax: xHi };
}

function renderStats() {
  const head = $("statsHead");
  const body = $("statsBody");
  if (!head || !body) return;

  const unitLabel = timeUnitLabel();
  const rangeLabel = unitLabel ? `Range (${unitLabel})` : "Range";
  const slopeLabel = unitLabel ? `m (/${unitLabel})` : "m";
  const cols = ["Series", rangeLabel, "Mean", "Min", "Max", "StDev", slopeLabel, "b", "R²"];
  const widths = ["160px", "130px", "90px", "90px", "90px", "90px", "90px", "90px", "70px"];

  const colgroup = document.createElement("colgroup");
  for (const w of widths) {
    const col = document.createElement("col");
    col.style.width = w;
    colgroup.appendChild(col);
  }

  const table = $("statsTbl");
  if (table) {
    const old = table.querySelector("colgroup");
    if (old) old.remove();
    table.prepend(colgroup);
    table.classList.toggle("regressionOff", !state.regressionEnabled);
  }

  head.innerHTML = "";
  for (const c of cols) {
    const th = document.createElement("th");
    th.textContent = c;
    head.appendChild(th);
  }

  body.innerHTML = "";
  for (const stat of state.stats) {
    const tr = document.createElement("tr");
    tr.appendChild(td(stat.name));
    tr.appendChild(td(formatRange(stat.range)));
    tr.appendChild(td(formatNumber(stat.mean)));
    tr.appendChild(td(formatNumber(stat.min)));
    tr.appendChild(td(formatNumber(stat.max)));
    tr.appendChild(td(formatNumber(stat.std)));

    if (stat.regression) {
      tr.appendChild(td(formatNumber(stat.regression.m, 6)));
      tr.appendChild(td(formatNumber(stat.regression.b, 6)));
      tr.appendChild(td(formatNumber(stat.regression.r2, 6)));
    } else {
      tr.appendChild(td("—"));
      tr.appendChild(td("—"));
      tr.appendChild(td("—"));
    }

    body.appendChild(tr);
  }

  function td(text) {
    const cell = document.createElement("td");
    cell.textContent = text;
    return cell;
  }
}

function updateTableHighlights() {
  const body = $("tblBody");
  if (!body) return;
  const range = state.selectionRange;
  for (const row of body.children) {
    const t = Number(row.dataset.t);
    const selected = range && isFinite(t) && t >= range[0] && t <= range[1];
    row.classList.toggle("selected", Boolean(selected));
  }
}

function formatRange(range) {
  if (!range || range[0] == null || range[1] == null) return "—";
  const a = formatTimeValue(range[0]);
  const b = formatTimeValue(range[1]);
  return `${a}–${b}${timeUnitLabel()}`;
}

function formatNumber(v, digits = 4) {
  if (typeof v !== "number" || !isFinite(v)) return "—";
  return v.toFixed(digits);
}

function formatBytes(bytes) {
  if (typeof bytes !== "number" || !isFinite(bytes)) return "—";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatTimeValue(v) {
  if (!isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs < 1) return v.toFixed(3);
  if (abs < 10) return v.toFixed(2);
  if (abs < 100) return v.toFixed(1);
  return v.toFixed(0);
}

function formatTimeLabel(v) {
  if (!isFinite(v)) return "";
  const abs = Math.abs(v);
  if (abs < 1) return v.toFixed(3);
  if (abs < 10) return v.toFixed(2);
  if (abs < 100) return v.toFixed(1);
  return v.toFixed(0);
}

function timeUnitLabel() {
  return state.tUnit || "";
}

// --- Data selection UI ---
function buildSeriesToggles(names) {
  const list = $("seriesList");
  list.innerHTML = "";

  for (let idx = 0; idx < names.length; idx++) {
    const name = names[idx];
    const row = document.createElement("label");
    row.className = "chk";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = state.visible.has(name);
    cb.onchange = () => {
      if (cb.checked) state.visible.add(name);
      else state.visible.delete(name);
      updateStats();
      draw();
    };

    const span = document.createElement("span");
    span.textContent = name;
    span.style.cursor = "pointer";
    span.style.color = seriesColor(idx);

    row.appendChild(cb);
    row.appendChild(span);
    list.appendChild(row);
  }
}

function renderRunList() {
  const sel = $("runSel");
  if (!sel) return;
  sel.innerHTML = "";
  sel.disabled = state.runs.length === 0;

  for (const r of state.runs) {
    const opt = document.createElement("option");
    opt.value = r;
    opt.textContent = r;
    sel.appendChild(opt);
  }

  sel.value = state.run || "";
}

async function loadOpModes(preserveSelection = true) {
  const j = await fetchJson("/logger/api/opmodes");
  state.opModes = j.opModes || [];

  const sel = $("opModeSel");
  sel.innerHTML = "";
  for (const m of state.opModes) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    sel.appendChild(opt);
  }

  const prev = state.opMode;
  if (preserveSelection && prev && state.opModes.includes(prev)) {
    state.opMode = prev;
  } else {
    state.opMode = state.opModes[0] || "";
  }
  sel.value = state.opMode;
}

async function loadRuns() {
  if (!state.opMode) return;
  const j = await fetchJson(`/logger/api/runs?opMode=${encodeURIComponent(state.opMode)}`);
  state.runs = j.runs || [];

  // pick most recent by default
  state.run = state.runs[0] || "";
  renderRunList();

  if (state.run) await loadData();
  else {
    state.data = null;
    setStatus("No runs found");
    draw();
  }
}

async function loadData() {
  if (!state.opMode || !state.run) return;
  setStatus("Loading…");

  const j = await fetchJson(`/logger/api/data?opMode=${encodeURIComponent(state.opMode)}&run=${encodeURIComponent(state.run)}`);
  state.data = j;
  state.tUnit = normalizeTimeUnit(j.tUnit);

  const seriesNames = Object.keys(j.series || {});
  state.visible = new Set(seriesNames);
  state.selectionRange = null;

  setStatus(`${state.opMode} / ${state.run} (${seriesNames.length} series)`);

  buildSeriesToggles(seriesNames);
  computeFullExtents();
  setViewportToFull();
  buildTable();
  updateStats();
  updateTableHighlights();

  resizeCanvases();
  draw();
}

function normalizeTimeUnit(unit) {
  if (typeof unit !== "string") return "s";
  const u = unit.trim().toLowerCase();
  if (u === "s" || u === "sec" || u === "secs" || u === "seconds") return "s";
  if (u === "ms" || u === "msec" || u === "millis" || u === "milliseconds") return "ms";
  if (u === "ns" || u === "nsec" || u === "nanoseconds") return "ns";
  return unit;
}

// --- UI wiring ---
function wireControls() {
  $("zoomExtents").onclick = () => setViewportToFull();
  $("zoomIn").onclick = () => zoomBy(0.7);
  $("zoomOut").onclick = () => zoomBy(1.4);

  $("selectTool").onclick = () => {
    state.tool = "select";
    updateToggleUI();
    zoomToSelection();
  };
  $("panTool").onclick = () => {
    state.tool = (state.tool === "pan") ? "select" : "pan";
    updateToggleUI();
  };
  $("toggleReg").onclick = () => {
    state.regressionEnabled = !state.regressionEnabled;
    $("toggleReg").textContent = state.regressionEnabled ? "Hide regression" : "Add regression";
    updateStats();
    draw();
  };

  $("opModeSel").onchange = async () => {
    state.opMode = $("opModeSel").value;
    await loadRuns();
  };

  $("runSel").onchange = async () => {
    const next = $("runSel").value;
    if (next === state.run) return;
    state.run = next;
    await loadData();
  };

  const refreshFs = $("refreshFs");
  if (refreshFs) refreshFs.onclick = () => loadFileTree();

  updateToggleUI();
}

function installCanvasInteractions() {
  const canvas = $("plot");

  canvas.addEventListener("wheel", (ev) => {
    if (!ev.ctrlKey) return;
    ev.preventDefault();

    const dpr = window.devicePixelRatio || 1;
    const px = ev.offsetX * dpr;
    const py = ev.offsetY * dpr;

    // convert mouse to data coords (roughly; uses current viewport)
    // For wheel zoom, keep centered about mouse
    const metrics = getPlotMetrics(dpr);
    const axesMarginL = metrics.marginL;
    const axesMarginTop = metrics.marginT;
    const plotW = metrics.plotW;
    const plotH = metrics.plotH;

    const localX = px - axesMarginL;
    const localY = py - axesMarginTop;

    if (localX < 0 || localY < 0 || localX > plotW || localY > plotH) {
      // if outside plot area, zoom about center
      const factor = ev.deltaY < 0 ? 0.85 : 1.18;
      zoomBy(factor);
      return;
    }

    const mx = state.xMin + (localX / plotW) * (state.xMax - state.xMin);
    const my = state.yMax - (localY / plotH) * (state.yMax - state.yMin);

    const factor = ev.deltaY < 0 ? 0.85 : 1.18;
    zoomBy(factor, mx, my);
  }, { passive: false });

  canvas.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    canvas.setPointerCapture(ev.pointerId);
    const dpr = window.devicePixelRatio || 1;
    const px = ev.offsetX * dpr;
    const py = ev.offsetY * dpr;

    state.dragging = true;
    state.dragStart = {
      px, py,
      xMin: state.xMin, xMax: state.xMax,
      yMin: state.yMin, yMax: state.yMax
    };
    state.dragRect = null;
  });

  canvas.addEventListener("pointerup", (ev) => {
    if (!state.dragging) return;
    state.dragging = false;
    canvas.releasePointerCapture(ev.pointerId);

    const dpr = window.devicePixelRatio || 1;

    const metrics = getPlotMetrics(dpr);
    const marginL = metrics.marginL;
    const marginT = metrics.marginT;
    const plotW = metrics.plotW;
    const plotH = metrics.plotH;

    if (state.tool === "select" && state.dragRect) {
      const r = state.dragRect;

      // translate rect coords into plot-local coords
      const xA = Math.max(0, r.x - marginL);
      const yA = Math.max(0, r.y - marginT);
      const xB = Math.min(plotW, (r.x + r.w) - marginL);
      const yB = Math.min(plotH, (r.y + r.h) - marginT);

      if (xB - xA > 4 && yB - yA > 4) {
        const x1 = state.xMin + (xA / plotW) * (state.xMax - state.xMin);
        const x2 = state.xMin + (xB / plotW) * (state.xMax - state.xMin);
        state.selectionRange = [Math.min(x1, x2), Math.max(x1, x2)];
      } else {
        state.selectionRange = null;
      }
      state.dragRect = null;
      if (state.selectionRange) {
        updateStats();
        draw();
      } else {
        clearSelectionAndReset();
      }
    } else {
      state.dragRect = null;
      if (state.tool === "select") {
        clearSelectionAndReset();
      } else {
        draw();
      }
    }
  });

  canvas.addEventListener("pointermove", (ev) => {
    updateHover(ev);
    if (!state.dragging) return;

    const dpr = window.devicePixelRatio || 1;
    const px = ev.offsetX * dpr;
    const py = ev.offsetY * dpr;

    const s = state.dragStart;

    if (state.tool === "pan") {
      // Pan in data coordinates based on pixel delta (approx within plot area)
      const dxPx = px - s.px;
      const dyPx = py - s.py;

      const metrics = getPlotMetrics(dpr);
      const marginL = metrics.marginL;
      const marginT = metrics.marginT;
      const plotW = metrics.plotW;
      const plotH = metrics.plotH;

      const dx = (dxPx / plotW) * (s.xMax - s.xMin);
      const dy = (dyPx / plotH) * (s.yMax - s.yMin);

      state.xMin = s.xMin - dx;
      state.xMax = s.xMax - dx;
      state.yMin = s.yMin + dy;
      state.yMax = s.yMax + dy;

      clampViewportToFull();
      draw();
    } else {
      const x = Math.min(s.px, px);
      const y = Math.min(s.py, py);
      const w = Math.abs(px - s.px);
      const h = Math.abs(py - s.py);
      state.dragRect = { x, y, w, h };
      draw();
    }
  });

  canvas.addEventListener("pointerleave", () => {
    clearHover();
  });
}

function seriesColor(idx) {
  const hue = (idx * 67) % 360;
  return `hsla(${hue}, 85%, 65%, 0.9)`;
}

function regressionColor(idx) {
  const hue = (idx * 67) % 360;
  return `hsla(${hue}, 90%, 40%, 1)`;
}

function zoomToSelection() {
  if (!state.selectionRange || !state.data) return;
  const [xMin, xMax] = state.selectionRange;
  if (!(xMax > xMin)) return;

  const t = state.data.t || [];
  const series = state.data.series || {};
  let yMin = Infinity;
  let yMax = -Infinity;

  const names = Object.keys(series).filter((n) => state.visible.has(n));
  for (const name of names) {
    const arr = series[name] || [];
    const nMax = Math.min(t.length, arr.length);
    for (let i = 0; i < nMax; i++) {
      const x = t[i];
      const y = arr[i];
      if (!isFinite(x) || !isFinite(y)) continue;
      if (x < xMin || x > xMax) continue;
      yMin = Math.min(yMin, y);
      yMax = Math.max(yMax, y);
    }
  }

  state.xMin = xMin;
  state.xMax = xMax;

  if (isFinite(yMin) && isFinite(yMax) && yMax > yMin) {
    const pad = (yMax - yMin) * 0.08 || 1;
    state.yMin = yMin - pad;
    state.yMax = yMax + pad;
  }

  draw();
}

function updateHover(ev) {
  if (!state.data) return;

  const wrap = document.querySelector(".canvasWrap");
  const timeBox = $("hoverTime");
  if (!wrap || !timeBox) return;

  const dpr = window.devicePixelRatio || 1;
  const pxCss = ev.offsetX;
  const pyCss = ev.offsetY;
  const px = pxCss * dpr;
  const py = pyCss * dpr;

  const metrics = getPlotMetrics(dpr);
  const marginL = metrics.marginL;
  const marginT = metrics.marginT;
  const plotW = metrics.plotW;
  const plotH = metrics.plotH;

  const inPlot = px >= marginL && px <= marginL + plotW && py >= marginT && py <= marginT + plotH;
  if (!inPlot) {
    clearHover();
    return;
  }

  const dataX = state.xMin + ((px - marginL) / plotW) * (state.xMax - state.xMin);
  const unit = timeUnitLabel();
  timeBox.textContent = `${formatTimeValue(dataX)}${unit}`;
  const timeLeft = (marginL / dpr) + 16;
  timeBox.style.left = timeLeft + "px";
  timeBox.style.opacity = "1";

  return;
}

function updateToggleUI() {
  const pan = $("panTool");
  const table = $("openTable");
  const manage = $("openManager");
  const drawer = $("tableDrawer");
  const modal = $("manageModal");
  const canvas = $("plot");
  if (pan) pan.classList.toggle("active", state.tool === "pan");
  if (table && drawer) table.classList.toggle("active", drawer.classList.contains("open"));
  if (manage && modal) manage.classList.toggle("active", !modal.classList.contains("hidden"));
  if (canvas) {
    canvas.style.cursor = state.tool === "pan" ? "grab" : CROSSHAIR_CURSOR;
  }
}

function clearHover() {
  const timeBox = $("hoverTime");
  if (timeBox) timeBox.style.opacity = "0";
}

function clearSelectionAndReset() {
  state.selectionRange = null;
  setViewportToFull();
  updateStats();
}

async function refreshOpModeSelection() {
  const prevOp = state.opMode;
  const prevRun = state.run;
  await loadOpModes(true);
  if (state.opMode !== prevOp) {
    await loadRuns();
    return;
  }
  await loadRuns();
  if (prevRun && state.runs.includes(prevRun)) {
    state.run = prevRun;
    $("runSel").value = prevRun;
  }
}

// --- boot ---
window.addEventListener("resize", () => { resizeCanvases(); draw(); });

(async function boot() {
  try {
    bindDrawerButtons();
    wireControls();
    installCanvasInteractions();
    const modal = $("manageModal");
    if (modal) modal.classList.add("hidden");

    await loadOpModes();
    await loadRuns();

    resizeCanvases();
    draw();
  } catch (e) {
    setStatus("Error: " + e);
    console.error(e);
  }
})();
