/* FTC Logger UI (self-contained; no CDN deps). */

const $ = (id) => document.getElementById(id);

// Thin crosshair cursor for the plot, colored to contrast with the current theme.
function crosshairCursor() {
  const color = currentTheme() === "light" ? "%23161a2b" : "white"; // %23 = '#' inside a data URL
  return "url(\"data:image/svg+xml;utf8," +
    "<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20'>" +
    `<line x1='10' y1='0' x2='10' y2='20' stroke='${color}' stroke-width='1'/>` +
    `<line x1='0' y1='10' x2='20' y2='10' stroke='${color}' stroke-width='1'/>` +
    "</svg>\") 10 10, crosshair";
}

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
  activeRow: null,      // sample index of the point last clicked on the plot (highlighted in the table)
  regressionEnabled: false,
  stats: [],
  tUnit: "s",

  // @Configurable classes from /logger/api/config
  config: [],
  configOpen: new Set(), // classes the user expanded (reset when the OpMode changes)
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
    scrollToActiveRow();
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

function getPlotMetrics(dpr, w = $("plot").width, h = $("plot").height) {
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

function zoomBy(factor, aboutX = null, aboutY = null, xOnly = false) {
  const cx = (aboutX == null) ? (state.xMin + state.xMax) / 2 : aboutX;
  const cy = (aboutY == null) ? (state.yMin + state.yMax) / 2 : aboutY;

  const hx = (state.xMax - state.xMin) / 2 * factor;
  state.xMin = cx - hx; state.xMax = cx + hx;

  if (!xOnly) {
    const hy = (state.yMax - state.yMin) / 2 * factor;
    state.yMin = cy - hy; state.yMax = cy + hy;
  }

  // Clamp zoom-out so you can’t go past “all data visible”
  clampViewportToFull();
  draw();
}

// Full extents span the whole run: first to last sample (also while following live).
function computeFullExtents() {
  const t = state.data?.t || [];
  if (!t.length) {
    state.full = { xMin: 0, xMax: 1, yMin: -1, yMax: 1 };
    return;
  }

  let xMin = t[0], xMax = t[t.length - 1];
  if (!(xMax > xMin)) xMax = xMin + 1; // a single sample still needs a non-zero span
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

// Plot colors. "dark" is the on-screen look; "light" is offered for PNG export.
const PLOT_THEMES = {
  dark: {
    bg: "#070914",
    grid: "rgba(255,255,255,.10)",
    axisText: "rgba(232,236,255,.75)",
    frame: "rgba(255,255,255,.20)",
    selFill: "rgba(255,255,255,.08)",
    unitText: "rgba(232,236,255,.65)",
    marker: "rgba(122,162,255,.9)",
    text: "rgba(232,236,255,.95)",
    boxBg: "rgba(15,19,32,.92)",
    boxBorder: "rgba(122,162,255,.7)",
    series: (idx) => `hsla(${(idx * 67) % 360}, 85%, 65%, 0.9)`,
    regression: (idx) => `hsla(${(idx * 67) % 360}, 90%, 40%, 1)`,
  },
  light: {
    bg: "#ffffff",
    grid: "rgba(0,0,0,.09)",
    axisText: "rgba(20,24,40,.80)",
    frame: "rgba(0,0,0,.35)",
    selFill: "rgba(50,90,210,.10)",
    unitText: "rgba(20,24,40,.65)",
    marker: "rgba(40,80,200,.9)",
    text: "rgba(20,24,40,.95)",
    boxBg: "rgba(255,255,255,.94)",
    boxBorder: "rgba(40,80,200,.6)",
    // Same hues as on screen, darker so they read on white.
    series: (idx) => `hsla(${(idx * 67) % 360}, 80%, 42%, 0.9)`,
    regression: (idx) => `hsla(${(idx * 67) % 360}, 90%, 28%, 1)`,
  },
};

function drawAxes(ctx, w, h, th = PLOT_THEMES.dark) {
  const dpr = window.devicePixelRatio || 1;
  const { marginL, marginT, marginB, plotW, plotH } = getPlotMetrics(dpr, w, h);

  // background already drawn by caller

  // grid + labels
  ctx.save();
  ctx.translate(marginL, marginT);

  // grid
  ctx.strokeStyle = th.grid;
  ctx.lineWidth = 1;

  const xSpan = state.xMax - state.xMin;
  const ySpan = state.yMax - state.yMin;
  const xStep = niceStep(xSpan);
  const yStep = niceStep(ySpan);

  const x0 = Math.ceil(state.xMin / xStep) * xStep;
  const y0 = Math.ceil(state.yMin / yStep) * yStep;

  // vertical grid + x labels
  ctx.fillStyle = th.axisText;
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
    // Keep the label inside the canvas (the last tick sits on the right edge).
    const half = ctx.measureText(label).width / 2;
    const maxCenter = w - marginL - half - 2 * dpr;
    ctx.fillText(label, Math.min(px, maxCenter), plotH + 6);
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
  ctx.strokeStyle = th.frame;
  ctx.strokeRect(0, 0, plotW, plotH);

  ctx.restore();

  return { marginL, marginB, plotW, plotH };
}

function draw() {
  const plot = $("plot");
  const ctx = plot.getContext("2d");
  const w = plot.width, h = plot.height;

  const th = plotTheme();
  const axes = renderPlot(ctx, w, h, th);
  if (!axes) return;
  const { marginL, plotW } = axes;

  // selection rect on overlay (canvas coords)
  const ov = $("overlay");
  const octx = ov.getContext("2d");
  octx.clearRect(0, 0, w, h);

  if (state.dragRect) {
    // A time selection always spans the full plot height; only the drag's x extent matters.
    const r = state.dragRect;
    const x1 = Math.max(marginL, r.x);
    const x2 = Math.min(marginL + plotW, r.x + r.w);
    if (x2 > x1) {
      const top = 4; // must match the translate() in renderPlot()
      octx.save();
      octx.fillStyle = "rgba(122,162,255,.15)";
      octx.strokeStyle = "rgba(122,162,255,.7)";
      octx.lineWidth = 2;
      octx.fillRect(x1, top, x2 - x1, axes.plotH);
      octx.strokeRect(x1, top, x2 - x1, axes.plotH);
      octx.restore();
    }
  }

  drawDeltaTLabel(octx, marginL, plotW, th);
}

// Draw the current view (grid, points, regression, selection band, marker) into ctx,
// a w×h canvas region. Returns the plot geometry, or null when there's no data.
function renderPlot(ctx, w, h, th) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, w, h);

  if (!state.data) return null;

  const axes = drawAxes(ctx, w, h, th);
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
      ctx.fillStyle = th.selFill;
      ctx.fillRect(x1, 0, x2 - x1, plotH);
    }
  }

  for (let idx = 0; idx < names.length; idx++) {
    const name = names[idx];
    if (!state.visible.has(name)) continue;

    const arr = state.data.series[name];
    if (!arr || !arr.length) continue;

    ctx.fillStyle = th.series(idx);
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
          ctx.strokeStyle = th.regression(idx);
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

  // Marker for the active sample (clicked point or clicked table row).
  if (state.activeRow != null) {
    const ta = t[state.activeRow];
    if (isFinite(ta) && ta >= state.xMin && ta <= state.xMax) {
      const dpr = window.devicePixelRatio || 1;
      const lx = (ta - state.xMin) / (state.xMax - state.xMin) * plotW;
      ctx.save();
      ctx.strokeStyle = th.marker;
      ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(lx, 0);
      ctx.lineTo(lx, plotH);
      ctx.stroke();
      ctx.restore();
    }
  }

  ctx.restore();

  const unitLabel = timeUnitLabel();
  if (unitLabel) {
    ctx.save();
    ctx.fillStyle = th.unitText;
    ctx.font = `${Math.max(10, Math.round(12 * (window.devicePixelRatio || 1)))}px system-ui`;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(`t (${unitLabel})`, marginL + plotW - 6, 4 + plotH - 6);
    ctx.restore();
  }

  return axes;
}

// Label the selected time span ("Δt = 1.23 s"), live while dragging and after release.
function drawDeltaTLabel(octx, marginL, plotW, th = PLOT_THEMES.dark) {
  const xSpan = state.xMax - state.xMin;
  if (!(xSpan > 0)) return;

  const dpr = window.devicePixelRatio || 1;
  const plotTop = 4; // must match the translate() in draw()
  let range = null;
  const bandTop = plotTop; // selections always span the full plot height
  if (state.dragging && state.tool === "select" && state.dragRect) {
    const r = state.dragRect;
    const xA = Math.max(0, r.x - marginL);
    const xB = Math.min(plotW, r.x + r.w - marginL);
    if (xB - xA > 4) {
      range = [state.xMin + (xA / plotW) * xSpan, state.xMin + (xB / plotW) * xSpan];
    }
  } else if (state.selectionRange) {
    range = state.selectionRange;
  }
  if (!range) return;

  const dt = range[1] - range[0];
  if (!(dt > 0)) return;

  // Anchor the label over the visible part of the selection.
  const visMin = Math.max(range[0], state.xMin);
  const visMax = Math.min(range[1], state.xMax);
  if (!(visMax > visMin)) return;
  const centerX = marginL + ((visMin + visMax) / 2 - state.xMin) / xSpan * plotW;

  const unit = timeUnitLabel();
  const text = `Δt = ${formatTimeValue(dt)}${unit ? " " + unit : ""}`;

  octx.save();
  octx.font = `600 ${Math.round(12 * dpr)}px system-ui`;
  const padX = 7 * dpr;
  const boxW = octx.measureText(text).width + padX * 2;
  const boxH = 20 * dpr;
  const left = Math.min(Math.max(centerX - boxW / 2, marginL + 2 * dpr), marginL + plotW - boxW - 2 * dpr);
  const top = bandTop + 4 * dpr; // just inside the top edge of the highlight

  octx.fillStyle = th.boxBg;
  octx.strokeStyle = th.boxBorder;
  octx.lineWidth = 1 * dpr;
  octx.beginPath();
  if (octx.roundRect) octx.roundRect(left, top, boxW, boxH, 6 * dpr);
  else octx.rect(left, top, boxW, boxH);
  octx.fill();
  octx.stroke();

  octx.fillStyle = th.text;
  octx.textAlign = "center";
  octx.textBaseline = "middle";
  octx.fillText(text, left + boxW / 2, top + boxH / 2);
  octx.restore();
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
    tr.dataset.i = String(i);
    tr.appendChild(cell(fmt(t[i])));
    for (const name of Object.keys(series)) {
      tr.appendChild(cell(fmt((series[name] || [])[i])));
    }
    body.appendChild(tr);
  }
  updateTableHighlights(); // keep selection/clicked-row highlights across rebuilds

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
  // "Zoom → Selection" only makes sense with a selection.
  const zoomSel = $("selectTool");
  if (zoomSel) zoomSel.disabled = !state.selectionRange;

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
    delOp.textContent = "Delete OpMode Logs";
    delOp.onclick = async () => {
      if (!confirm(`Delete all logs for OpMode "${op.name}"?`)) return;
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
  const seriesNames = Object.keys(state.data?.series || {});
  for (const stat of state.stats) {
    const tr = document.createElement("tr");
    // Same color as the series' checkbox label and plot points.
    const color = seriesColor(seriesNames.indexOf(stat.name));
    tr.style.setProperty("--series-color", color);
    tr.className = "statsRow";
    const nameCell = td(stat.name);
    nameCell.className = "statsName";
    tr.appendChild(nameCell);
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
    row.classList.toggle("active", state.activeRow != null && Number(row.dataset.i) === state.activeRow);
  }
}

// Mark one sample as active: dashed line on the plot + highlighted table row.
function setActiveRow(i, scroll) {
  state.activeRow = i;
  updateTableHighlights();
  if (scroll) scrollToActiveRow();
  draw();
}

// Select the time range spanned by table rows a..b (inclusive) on the plot.
function selectRowRange(a, b) {
  const t = state.data?.t || [];
  const lo = Math.min(a, b), hi = Math.max(a, b);
  state.selectionRange = (hi > lo && isFinite(t[lo]) && isFinite(t[hi])) ? [t[lo], t[hi]] : null;
  updateStats(); // also refreshes table highlights and the Zoom → Selection button
  draw();
}

// Table → plot: click a row to mark it; drag across rows (or Shift+click) to select a range.
function wireTableInteractions() {
  const body = $("tblBody");
  if (!body) return;
  let anchor = null;
  let dragging = false;
  const rowIndex = (ev) => {
    const row = ev.target.closest && ev.target.closest("tr[data-i]");
    return row ? Number(row.dataset.i) : null;
  };

  body.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    const i = rowIndex(ev);
    if (i == null) return;
    ev.preventDefault(); // no text selection while dragging across rows
    if (ev.shiftKey && (anchor != null || state.activeRow != null)) {
      if (anchor == null) anchor = state.activeRow;
      selectRowRange(anchor, i);
    } else {
      anchor = i;
      setActiveRow(i, false);
      dragging = true;
    }
  });
  body.addEventListener("pointerover", (ev) => {
    if (!dragging) return;
    const i = rowIndex(ev);
    if (i != null) selectRowRange(anchor, i);
  });
  window.addEventListener("pointerup", () => { dragging = false; });
}

// Highlight the clicked sample's row and bring it into view if the table is open.
function scrollToActiveRow() {
  const drawer = $("tableDrawer");
  const body = $("tblBody");
  if (state.activeRow == null || !body || !drawer || !drawer.classList.contains("open")) return;
  const row = body.querySelector(`tr[data-i="${state.activeRow}"]`);
  if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
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

// --- Configurable variables ---
// Matches FileSystemUtilities.sanitize() so class names line up with OpMode log folders.
function sanitizeName(name) {
  return String(name || "").replace(/[^A-Za-z0-9._-]+/g, "_");
}

function isCurrentOpModeClass(cls) {
  if (!state.opMode) return false;
  return sanitizeName(cls.simpleName) === state.opMode ||
         sanitizeName(cls.outerSimpleName) === state.opMode;
}

async function loadConfig() {
  const list = $("configList");
  try {
    const j = await fetchJson("/logger/api/config");
    state.config = j.classes || [];
    state.configFailed = false;
  } catch (e) {
    state.configFailed = true;
    state.config = [];
    if (list) list.innerHTML = `<div class="small">Could not load configurable variables (${e.message}).</div>`;
    console.error(e);
    return;
  }
  renderConfig();
}

function renderConfig() {
  const list = $("configList");
  if (!list) return;
  list.innerHTML = "";

  if (state.config.length === 0) {
    const empty = document.createElement("div");
    empty.className = "small";
    empty.textContent = "No @Configurable classes found.";
    list.appendChild(empty);
    return;
  }

  // Current OpMode's class(es) first; the rest keep server (alphabetical) order.
  const current = state.config.filter(isCurrentOpModeClass);
  const others = state.config.filter((c) => !isCurrentOpModeClass(c));

  for (const cls of [...current, ...others]) {
    const isCurrent = current.includes(cls);
    const group = document.createElement("details");
    group.className = "cfgGroup" + (isCurrent ? " current" : "");
    group.open = isCurrent || state.configOpen.has(cls.name);
    group.ontoggle = () => {
      if (isCurrent) return;
      if (group.open) state.configOpen.add(cls.name);
      else state.configOpen.delete(cls.name);
    };

    const summary = document.createElement("summary");
    summary.title = cls.name;
    const label = document.createElement("span");
    label.textContent = cls.displayName || cls.simpleName;
    summary.appendChild(label);
    if (isCurrent) {
      const tag = document.createElement("span");
      tag.className = "cfgCurrentTag";
      tag.textContent = "current";
      summary.appendChild(tag);
    }
    group.appendChild(summary);

    const body = document.createElement("div");
    body.className = "cfgFields";
    for (const field of cls.fields || []) body.appendChild(buildConfigRow(cls, field));
    group.appendChild(body);

    list.appendChild(group);
  }
}

function buildConfigRow(cls, field) {
  const row = document.createElement("label");
  row.className = "cfgRow";

  const name = document.createElement("span");
  name.className = "cfgName";
  name.textContent = field.name;
  name.title = `${field.name} (${field.type})`;
  row.appendChild(name);

  let input;
  if (field.type === "boolean") {
    input = document.createElement("input");
    input.type = "checkbox";
    input.className = "cfgInput";
    input.checked = field.value === "true";
    input.onchange = () => saveConfigValue(cls, field, input, input.checked ? "true" : "false");
  } else if (field.type === "enum") {
    input = document.createElement("select");
    input.className = "cfgInput";
    for (const opt of field.options || []) {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      input.appendChild(o);
    }
    input.value = field.value ?? "";
    input.onchange = () => saveConfigValue(cls, field, input, input.value);
  } else {
    input = document.createElement("input");
    input.type = "text";
    input.className = "cfgInput";
    input.spellcheck = false;
    if (field.type !== "string") input.inputMode = "decimal";
    input.value = field.value ?? "";
    if (field.value === null) input.placeholder = "null";
    input.oninput = () => {
      input.classList.remove("error", "saved");
      input.classList.toggle("dirty", input.value !== (field.value ?? ""));
    };
    input.onkeydown = (ev) => {
      if (ev.key === "Escape") {
        input.value = field.value ?? "";
        input.classList.remove("dirty", "error");
        input.title = "";
        input.blur();
      }
    };
    // 'change' fires on Enter and when leaving an edited field
    input.onchange = () => {
      if (input.value === (field.value ?? "")) {
        input.classList.remove("dirty");
        return;
      }
      saveConfigValue(cls, field, input, input.value);
    };
  }
  row.appendChild(input);

  // ↺ puts the field back to its value in the code (shown only when it differs).
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "cfgReset";
  reset.textContent = "↺";
  reset.onclick = (ev) => {
    ev.preventDefault(); // the row is a <label>; don't also activate the input
    saveConfigValue(cls, field, input, null, true);
  };
  input.resetBtn = reset;
  syncResetButton(reset, field);
  row.appendChild(reset);
  return row;
}

function syncResetButton(btn, field) {
  const differs = field.codeValue !== undefined && field.value !== field.codeValue;
  btn.classList.toggle("visible", differs);
  btn.disabled = !differs;
  const code = field.codeValue === null ? "null" : field.codeValue;
  btn.title = differs ? `Reset to value in code: ${code}` : "";
  btn.setAttribute("aria-label", differs ? `Reset ${field.name} to ${code}` : "");
}

async function saveConfigValue(cls, field, input, value, reset = false) {
  const url = `/logger/api/setconfig?class=${encodeURIComponent(cls.name)}` +
    `&field=${encodeURIComponent(field.name)}` +
    (reset ? "&reset=1" : `&value=${encodeURIComponent(value)}`);
  input.classList.remove("error", "saved");
  try {
    const res = await fetch(cacheBust(url), { cache: "no-store" });
    let j = null;
    try { j = await res.json(); } catch (_) { /* non-JSON error */ }
    if (!res.ok || !j || j.ok === false) {
      throw new Error((j && j.error) || `${res.status} ${res.statusText}`);
    }
    // Use the value the robot reports (e.g. "1" -> "1.0" for doubles)
    field.value = j.field ? j.field.value : value;
    if (input.type === "checkbox") input.checked = field.value === "true";
    else input.value = field.value ?? "";
    input.title = "";
    input.classList.remove("dirty");
    input.classList.add("saved");
    setTimeout(() => input.classList.remove("saved"), 900);
    if (input.resetBtn) syncResetButton(input.resetBtn, field);
  } catch (e) {
    input.classList.add("error");
    input.title = String(e.message || e);
    // Put checkbox/select back to the last known value
    if (input.type === "checkbox") input.checked = field.value === "true";
    else if (input.tagName === "SELECT") input.value = field.value ?? "";
    setStatus(`Could not set ${cls.simpleName}.${field.name}: ${input.title}`);
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
  updateLogPickerLock();
}

// Lock the log picker while an OpMode is initialized or running.
function updateLogPickerLock() {
  const busy = opCtl.state === "init" || opCtl.state === "running";
  const title = busy ? "Stop the OpMode to pick a different log" : "";
  const op = $("opModeSel");
  const run = $("runSel");
  if (op) { op.disabled = busy; op.title = title; }
  if (run) { run.disabled = busy || state.runs.length === 0; run.title = title; }
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
  if (live.following) dismissLive(); // e.g. a rename/delete in Manage Log Files
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
  state.activeRow = null;

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
  // Toolbar zoom changes the time axis only; the y scale stays put.
  $("zoomIn").onclick = () => zoomBy(0.7, null, null, true);
  $("zoomOut").onclick = () => zoomBy(1.4, null, null, true);

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
    dismissLive();
    state.opMode = $("opModeSel").value;
    state.configOpen.clear();
    renderConfig();
    await loadRuns();
  };


  $("runSel").onchange = async () => {
    const next = $("runSel").value;
    if (next === state.run) return;
    dismissLive();
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

    // A click (no real drag) on a data point selects its table row and keeps any time selection.
    const s0 = state.dragStart;
    const moved = Math.hypot(ev.offsetX * dpr - s0.px, ev.offsetY * dpr - s0.py) > 4 * dpr;
    if (!moved) {
      const hit = findNearestPoint(ev.offsetX * dpr, ev.offsetY * dpr, dpr);
      if (hit) {
        state.dragRect = null;
        setActiveRow(hit.i, true);
        return;
      }
      state.activeRow = null;
      updateTableHighlights();
    }

    const metrics = getPlotMetrics(dpr);
    const marginL = metrics.marginL;
    const marginT = metrics.marginT;
    const plotW = metrics.plotW;
    const plotH = metrics.plotH;

    if (state.tool === "select" && state.dragRect) {
      const r = state.dragRect;

      // translate rect x into plot-local coords (selection is time-only, full height)
      const xA = Math.max(0, r.x - marginL);
      const xB = Math.min(plotW, (r.x + r.w) - marginL);

      if (xB - xA > 4) {
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
        clearSelection();
      }
    } else {
      state.dragRect = null;
      if (state.tool === "select") {
        clearSelection();
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

// Series colors follow the page theme (brighter on dark, deeper on light).
function seriesColor(idx) {
  return plotTheme().series(idx);
}

function regressionColor(idx) {
  return plotTheme().regression(idx);
}

// --- Light/dark page theme ---
const THEME_KEY = "ftcLogger.theme";

function currentTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function plotTheme() {
  return PLOT_THEMES[currentTheme()];
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch (_) { /* optional */ }
  updateThemeToggle();
  updateToggleUI(); // plot cursor color
  // Recolor everything that bakes in series colors.
  buildSeriesToggles(Object.keys(state.data?.series || {}));
  renderStats();
  draw();
}

function updateThemeToggle() {
  const btn = $("themeToggle");
  if (!btn) return;
  const label = currentTheme() === "dark" ? "Switch to light mode" : "Switch to dark mode";
  btn.title = label;
  btn.setAttribute("aria-label", label);
}

function wireThemeToggle() {
  const btn = $("themeToggle");
  if (!btn) return;
  btn.onclick = () => setTheme(currentTheme() === "dark" ? "light" : "dark");
  updateThemeToggle();
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

  const dpr = window.devicePixelRatio || 1;
  const px = ev.offsetX * dpr;
  const py = ev.offsetY * dpr;

  const { marginL, marginT, plotW, plotH } = getPlotMetrics(dpr);
  const inPlot = px >= marginL && px <= marginL + plotW && py >= marginT && py <= marginT + plotH;
  if (!inPlot) {
    clearHover();
    return;
  }

  updatePointTooltip(px, py, dpr);
}

// Show "(t, value)" for the nearest visible data point within a few pixels of the cursor.
const POINT_HOVER_RADIUS_CSS = 10;

function updatePointTooltip(px, py, dpr) {
  const tip = $("hoverPoint");
  const plot = $("plot");
  if (!tip || !plot || !state.data) return;

  const best = findNearestPoint(px, py, dpr);
  if (!best) {
    tip.style.opacity = "0";
    return;
  }

  const unit = timeUnitLabel();
  tip.textContent = `(${formatTimeValue(best.x)}${unit ? " " + unit : ""}, ${formatHoverValue(best.y)})`;
  tip.style.borderColor = seriesColor(best.idx);
  positionPointTooltip(tip, plot, best, dpr);
}

// Nearest visible data point within POINT_HOVER_RADIUS_CSS of canvas pixel (px, py), or null.
// Returns { x, y, i (sample index), idx (series index), ptX, ptY (canvas px) }.
function findNearestPoint(px, py, dpr) {
  if (!state.data) return null;
  const { marginL, plotW, plotH } = getPlotMetrics(dpr);
  const plotTop = 4; // must match the translate() in draw()
  const t = state.data.t || [];
  const series = state.data.series || {};
  const names = Object.keys(series);
  const xSpan = state.xMax - state.xMin;
  const ySpan = state.yMax - state.yMin;
  const maxDist = POINT_HOVER_RADIUS_CSS * dpr;

  let best = null;
  let bestD2 = maxDist * maxDist;
  for (let idx = 0; idx < names.length; idx++) {
    const name = names[idx];
    if (!state.visible.has(name)) continue;
    const arr = series[name] || [];
    const n = Math.min(t.length, arr.length);
    for (let i = 0; i < n; i++) {
      const x = t[i], y = arr[i];
      if (!isFinite(x) || !isFinite(y)) continue;
      if (x < state.xMin || x > state.xMax || y < state.yMin || y > state.yMax) continue;
      const ptX = marginL + (x - state.xMin) / xSpan * plotW;
      const ptY = plotTop + plotH - (y - state.yMin) / ySpan * plotH;
      const dx = ptX - px, dy = ptY - py;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestD2) {
        bestD2 = d2;
        best = { x, y, i, idx, ptX, ptY };
      }
    }
  }
  return best;
}

function positionPointTooltip(tip, plot, best, dpr) {
  // Position just above-right of the point, flipping to stay inside the canvas.
  const ptXCss = plot.offsetLeft + best.ptX / dpr;
  const ptYCss = plot.offsetTop + best.ptY / dpr;
  const tipW = tip.offsetWidth;
  const tipH = tip.offsetHeight;
  const gap = 8;
  let left = ptXCss + gap;
  let top = ptYCss - tipH - gap;
  if (left + tipW > plot.offsetLeft + plot.clientWidth) left = ptXCss - tipW - gap;
  if (top < plot.offsetTop) top = ptYCss + gap;
  tip.style.left = left + "px";
  tip.style.top = top + "px";
  tip.style.opacity = "1";
}

function formatHoverValue(v) {
  if (!isFinite(v)) return "—";
  if (v !== 0 && Math.abs(v) < 0.001) return v.toExponential(2);
  return String(Number(v.toPrecision(4)));
}

// --- PNG export dialog ---
const EXPORT_PREFS_KEY = "ftcLogger.exportPrefs";

function loadExportPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(EXPORT_PREFS_KEY) || "{}");
    return { legend: p.legend || "bottom", theme: p.theme || currentTheme() };
  } catch (_) {
    return { legend: "bottom", theme: currentTheme() };
  }
}

function saveExportPrefs(prefs) {
  try { localStorage.setItem(EXPORT_PREFS_KEY, JSON.stringify(prefs)); } catch (_) { /* optional */ }
}

function exportOptions() {
  return { legend: $("exportLegend").value, theme: $("exportTheme").value };
}

function openExportDialog() {
  const plot = $("plot");
  if (!plot || !plot.width || !plot.height || !state.data) return;
  const prefs = loadExportPrefs();
  $("exportLegend").value = prefs.legend;
  $("exportTheme").value = prefs.theme;
  $("exportModal").classList.remove("hidden");
  updateExportPreview();
  $("exportSave").focus();
}

function closeExportDialog() {
  $("exportModal").classList.add("hidden");
  $("exportPreview").innerHTML = "";
}

function updateExportPreview() {
  const opts = exportOptions();
  saveExportPrefs(opts);
  const preview = $("exportPreview");
  preview.innerHTML = "";
  preview.appendChild(renderExportCanvas(opts));
}

function wireExportDialog() {
  $("downloadPng").onclick = () => openExportDialog();
  $("exportLegend").onchange = updateExportPreview;
  $("exportTheme").onchange = updateExportPreview;
  $("exportCancel").onclick = closeExportDialog;
  $("exportBackdrop").onclick = closeExportDialog;
  $("exportSave").onclick = () => {
    savePng(renderExportCanvas(exportOptions()));
    closeExportDialog();
  };
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !$("exportModal").classList.contains("hidden")) closeExportDialog();
  });
}

// Render the current view at screen resolution with the chosen theme and legend placement.
function renderExportCanvas({ legend, theme }) {
  const th = PLOT_THEMES[theme] || PLOT_THEMES.dark;
  const plot = $("plot");
  const dpr = window.devicePixelRatio || 1;
  const w = plot.width, h = plot.height;

  const names = Object.keys(state.data?.series || {});
  const items = names
    .map((name, idx) => ({ name, color: th.series(idx) }))
    .filter((it) => state.visible.has(it.name));
  const showLegend = legend !== "none" && items.length > 0;

  // Legend metrics (device pixels).
  const font = `${Math.round(13 * dpr)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = font;
  const sw = 10 * dpr;       // swatch size
  const swGap = 6 * dpr;     // swatch → text
  const itemGap = 18 * dpr;  // between items in a row
  const rowH = 20 * dpr;
  const pad = 10 * dpr;
  for (const it of items) it.w = sw + swGap + measure.measureText(it.name).width;

  // Wrap items into centered rows for top/bottom legends.
  let rows = [];
  if (showLegend && (legend === "top" || legend === "bottom")) {
    const maxW = w - pad * 2;
    let row = [], rowW = 0;
    for (const it of items) {
      const add = (row.length ? itemGap : 0) + it.w;
      if (row.length && rowW + add > maxW) { rows.push({ items: row, w: rowW }); row = []; rowW = 0; }
      rowW += (row.length ? itemGap : 0) + it.w;
      row.push(it);
    }
    if (row.length) rows.push({ items: row, w: rowW });
  }
  const bandH = rows.length ? rows.length * rowH + pad : 0;
  const colW = showLegend ? Math.max(...items.map((it) => it.w)) : 0;
  const rightW = showLegend && legend === "right" ? colW + pad * 2 : 0;

  const offY = legend === "top" ? bandH : 0;
  const out = document.createElement("canvas");
  out.width = Math.round(w + rightW);
  out.height = Math.round(h + bandH);
  const ctx = out.getContext("2d");
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, out.width, out.height);

  // The plot itself, plus the Δt label for a committed selection.
  ctx.save();
  ctx.translate(0, offY);
  const axes = renderPlot(ctx, w, h, th);
  if (axes && state.selectionRange) drawDeltaTLabel(ctx, axes.marginL, axes.plotW, th);
  ctx.restore();

  if (!showLegend || !axes) return out;

  const drawItem = (it, x, yMid) => {
    ctx.fillStyle = it.color;
    ctx.beginPath();
    ctx.arc(x + sw / 2, yMid, sw / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = th.text;
    ctx.fillText(it.name, x + sw + swGap, yMid);
  };

  ctx.save();
  ctx.font = font;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const plotTop = 4; // must match the translate() in renderPlot()
  const plotLeft = axes.marginL;

  if (legend === "top" || legend === "bottom") {
    // Center the legend under/over the plot area (not the y-axis labels).
    const centerX = plotLeft + axes.plotW / 2;
    const y0 = legend === "top" ? pad / 2 : offY + h;
    rows.forEach((row, r) => {
      let x = Math.max(pad, Math.min(centerX - row.w / 2, out.width - pad - row.w));
      const yMid = y0 + r * rowH + rowH / 2;
      for (const it of row.items) { drawItem(it, x, yMid); x += it.w + itemGap; }
    });
  } else if (legend === "right") {
    const x = w + pad;
    items.forEach((it, r) => drawItem(it, x, offY + plotTop + pad + r * rowH + rowH / 2));
  } else if (legend === "corner") {
    const boxW = colW + pad * 2;
    const boxH = items.length * rowH + pad;
    const bx = plotLeft + axes.plotW - boxW - 8 * dpr;
    const by = offY + plotTop + 8 * dpr;
    ctx.fillStyle = th.boxBg;
    ctx.strokeStyle = th.frame;
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, boxW, boxH, 6 * dpr); else ctx.rect(bx, by, boxW, boxH);
    ctx.fill();
    ctx.stroke();
    items.forEach((it, r) => drawItem(it, bx + pad, by + pad / 2 + r * rowH + rowH / 2));
  }
  ctx.restore();
  return out;
}

function savePng(canvas) {
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, runFileBase("plot") + ".png");
  }, "image/png");
}

// "OpMode_Run" for download file names, or the fallback when no run is loaded.
function runFileBase(fallback) {
  const parts = [state.opMode, state.run].filter(Boolean).map(sanitizeName);
  return parts.length ? parts.join("_") : fallback;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Every sample of the loaded run (not just the rows the table shows), full precision.
function downloadCsv() {
  const t = state.data?.t || [];
  if (!t.length) return;
  const series = state.data.series || {};
  const names = Object.keys(series);
  const unit = timeUnitLabel();

  const esc = (v) => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const num = (v) => (typeof v === "number" && isFinite(v) ? String(v) : "");

  const lines = [[unit ? `t (${unit})` : "t", ...names].map(esc).join(",")];
  for (let i = 0; i < t.length; i++) {
    lines.push([num(t[i]), ...names.map((n) => num((series[n] || [])[i]))].join(","));
  }
  const blob = new Blob([lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, runFileBase("data") + ".csv");
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
    canvas.style.cursor = state.tool === "pan" ? "grab" : crosshairCursor();
  }
}

function clearHover() {
  const tip = $("hoverPoint");
  if (tip) tip.style.opacity = "0";
}

// A click on the plot clears the selection but keeps the current zoom (use Extents to reset).
function clearSelection() {
  state.selectionRange = null;
  updateStats();
  draw();
}

async function refreshOpModeSelection() {
  const prevOp = state.opMode;
  const prevRun = state.run;
  await loadOpModes(true);
  if (state.opMode !== prevOp) renderConfig();
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

// --- OpMode control (Driver Station-style select / INIT / ▶ / ■) ---
const opCtl = {
  list: [],          // [{name, flavor, group}]
  state: "unavailable",
  active: "",
  lastClass: "",
  pending: false,    // a command was sent and we're waiting for the robot to react
  pendingTimer: null,
  pollTimer: null,
};

const OPCTL_STATE_LABELS = {
  unavailable: "Not connected",
  stopped: "Stopped",
  init: "Initialized",
  running: "Running",
};

async function controlApi(path) {
  const res = await fetch(cacheBust(path), { cache: "no-store" });
  let j = null;
  try { j = await res.json(); } catch (_) { /* non-JSON error page */ }
  if (!res.ok || (j && j.ok === false)) {
    throw new Error((j && j.error) || `${res.status} ${res.statusText}`);
  }
  return j || {};
}

function setOpCtlMessage(text, isError = false) {
  const msg = $("opCtlMsg");
  if (!msg) return;
  msg.textContent = text || "";
  msg.classList.toggle("error", !!isError);
}

async function loadControlOpModes() {
  try {
    const j = await controlApi("/logger/api/control/opmodes");
    opCtl.list = j.opModes || [];
  } catch (e) {
    opCtl.list = [];
  }
  renderControlOpModes();
}

function renderControlOpModes() {
  const sel = $("opCtlSel");
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = opCtl.list.length ? "Select OpMode…" : "No OpModes";
  sel.appendChild(placeholder);

  const groups = [["autonomous", "Autonomous"], ["teleop", "TeleOp"]];
  for (const [flavor, label] of groups) {
    const items = opCtl.list.filter((m) => m.flavor === flavor);
    if (!items.length) continue;
    const og = document.createElement("optgroup");
    og.label = label;
    for (const m of items) {
      const opt = document.createElement("option");
      opt.value = m.name;
      opt.textContent = m.name;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }

  if (prev && opCtl.list.some((m) => m.name === prev)) sel.value = prev;
  renderControlState();
}

function renderControlState() {
  const root = $("opCtl");
  const sel = $("opCtlSel");
  if (!root || !sel) return;

  root.dataset.state = opCtl.state;
  $("opCtlStateText").textContent = OPCTL_STATE_LABELS[opCtl.state] || opCtl.state;

  const busy = opCtl.state === "init" || opCtl.state === "running";
  // While an OpMode is active, the selector shows it and is locked (like the DS).
  if (busy && opCtl.active) {
    if (![...sel.options].some((o) => o.value === opCtl.active)) {
      const opt = document.createElement("option");
      opt.value = opCtl.active;
      opt.textContent = opCtl.active;
      sel.appendChild(opt);
    }
    sel.value = opCtl.active;
  }
  sel.disabled = busy || opCtl.state === "unavailable" || opCtl.pending;

  updateLogPickerLock();

  $("opCtlInit").disabled = opCtl.pending || !sel.value;
  $("opCtlStart").disabled = opCtl.pending;
  $("opCtlStop").disabled = opCtl.pending;
}

function applyControlState(j) {
  const prevState = opCtl.state;
  const next = j && j.ready ? j.state : "unavailable";
  const changed = next !== prevState;

  opCtl.state = next;
  opCtl.active = (j && j.active) || "";
  opCtl.lastClass = (j && j.lastClass) || opCtl.lastClass;
  if (j && j.liveRun) {
    opCtl.liveOpMode = j.liveOpMode || "";
    opCtl.liveRun = j.liveRun;
  }

  if (changed && opCtl.pending) {
    opCtl.pending = false;
    clearTimeout(opCtl.pendingTimer);
  }
  if (changed && next !== "unavailable") setOpCtlMessage("");

  // Robot came back (or the list never loaded): fetch the OpMode list.
  if (next !== "unavailable" && (prevState === "unavailable" || !opCtl.list.length)) {
    loadControlOpModes();
  }

  // INIT and STOP are when OpMode code usually changes static fields: show the current values,
  // unless the user is in the middle of editing one.
  if (changed && (next === "init" || (next === "stopped" && prevState !== "unavailable"))) {
    const list = $("configList");
    const editing = list && (list.contains(document.activeElement) || list.querySelector(".cfgInput.dirty"));
    if (!editing) loadConfig();
  }

  // Reconnected (e.g. after installing a new build): @Configurable classes may have changed.
  // On the first connection the page's own startup load covers it, unless that load failed.
  if (next !== "unavailable" && prevState === "unavailable") {
    if (opCtl.wasConnected || state.configFailed) loadConfig();
    opCtl.wasConnected = true;
  }

  renderControlState();

  if (j && j.telemetry) {
    opCtl.telemetrySeq = j.telemetrySeq || "";
    renderTelemetry(j.telemetry);
  }
  renderTelemetryMeta();

  updateLiveFollow();

  // A run just finished and wasn't being followed live: show its log.
  const dismissed = opCtl.liveRun && live.dismissedRun === liveKey(opCtl.liveOpMode, opCtl.liveRun);
  if (changed && prevState === "running" && next === "stopped" && !live.following && !dismissed) {
    setTimeout(showRunAfterStop, 500);
  }
}

// Poll fast while an OpMode is active (telemetry, live plot), slowly when idle.
function scheduleControlPoll() {
  clearTimeout(opCtl.pollTimer);
  pollControlState().finally(() => {
    const active = opCtl.state === "init" || opCtl.state === "running" || opCtl.pending;
    opCtl.pollTimer = setTimeout(scheduleControlPoll, active ? 250 : 1000);
  });
}

async function pollControlState() {
  if (document.hidden) return;
  const t0 = performance.now();
  try {
    const tseq = encodeURIComponent(opCtl.telemetrySeq || "");
    const j = await controlApi(`/logger/api/control/state?tseq=${tseq}`);
    updateHeaderStatus(j, performance.now() - t0);
    applyControlState(j);
  } catch (_) {
    updateHeaderStatus(null, null);
    applyControlState(null);
  }
}

// --- Header: connection, ping, battery ---
const header = { pingMs: null };

// Color cutoffs for the header readouts (text turns yellow at WARN, red at BAD).
// FTC documents a ping under 20 ms as a good link and ~12 V as a healthy, charged battery;
// the Driver Station's exact yellow/red numbers aren't published, so the others are estimates.
const PING_WARN_MS = 20;    // >= this: yellow (FTC wiki: "< 20 msec" is a good connection)
const PING_BAD_MS = 100;    // >= this, or no response: red (estimate)
const BATT_WARN_V = 12.0;   // below this: yellow (FTC: ~12 V is healthy and charged)
const BATT_BAD_V = 11.0;    // below this: red (estimate)

function updateHeaderStatus(j, rttMs) {
  const conn = $("hdrConn");
  const connText = $("hdrConnText");
  const ping = $("hdrPing");
  const pingText = $("hdrPingText");
  const batt = $("hdrBatt");
  const battText = $("hdrBattText");
  if (!conn) return;

  const reachable = !!j;
  const connState = !reachable ? "disconnected" : (j.ready ? "connected" : "notready");
  conn.dataset.state = connState;
  connText.textContent = { connected: "Connected", notready: "Robot not ready", disconnected: "Disconnected" }[connState];

  // Smooth the ping so the number doesn't jitter on every poll.
  if (reachable && isFinite(rttMs)) {
    header.pingMs = header.pingMs == null ? rttMs : header.pingMs * 0.7 + rttMs * 0.3;
    const ms = Math.round(header.pingMs);
    pingText.textContent = `${ms} ms`;
    ping.dataset.level = ms < PING_WARN_MS ? "good" : ms < PING_BAD_MS ? "warn" : "bad";
  } else {
    // No response from the robot: show "no ping" in red.
    header.pingMs = null;
    pingText.textContent = "—";
    ping.dataset.level = reachable ? "none" : "bad";
  }

  const v = reachable ? j.batteryVoltage : null;
  if (typeof v === "number" && isFinite(v)) {
    battText.textContent = `${v.toFixed(2)} V`;
    batt.dataset.level = v >= BATT_WARN_V ? "good" : v >= BATT_BAD_V ? "warn" : "bad";
  } else {
    battText.textContent = "—";
    batt.dataset.level = "none";
  }
}

async function sendControl(path, label) {
  opCtl.pending = true;
  setOpCtlMessage(`${label}…`);
  renderControlState();

  // If the robot never reacts, unlock the buttons again.
  clearTimeout(opCtl.pendingTimer);
  opCtl.pendingTimer = setTimeout(() => {
    opCtl.pending = false;
    setOpCtlMessage("");
    renderControlState();
  }, 4000);

  try {
    await controlApi(path);
  } catch (e) {
    clearTimeout(opCtl.pendingTimer);
    opCtl.pending = false;
    setOpCtlMessage(e.message, true);
    renderControlState();
    return;
  }
  // The robot applies commands on its event loop; check back quickly.
  setTimeout(pollControlState, 150);
  setTimeout(pollControlState, 500);
}

async function emergencyStop() {
  // Bypasses the pending lock: a stop must always go out immediately.
  const root = $("opCtl");
  if (root) {
    root.classList.remove("estop");
    void root.offsetWidth; // restart the flash animation
    root.classList.add("estop");
  }
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  await sendControl("/logger/api/control/stop", "E-stop");
}

// --- Telemetry (what the Driver Station shows for the current OpMode) ---
// HTML display format isn't stored by the SDK, so detect it from the content.
const TELEMETRY_HTML_RE = /<\/?(b|i|u|br|font|span|big|small|h[1-6]|p|div|sub|sup|tt|strike|s|em|strong|code|pre)\b[^>]*>/i;
const TELEMETRY_ALLOWED_TAGS = new Set(["B", "I", "U", "BR", "FONT", "SPAN", "BIG", "SMALL", "H1", "H2", "H3", "H4",
  "H5", "H6", "P", "DIV", "SUB", "SUP", "TT", "STRIKE", "S", "EM", "STRONG", "CODE", "PRE"]);

function sanitizeTelemetryHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstChild;
  const clean = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE || !TELEMETRY_ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(doc.createTextNode(child.textContent || ""));
        continue;
      }
      for (const attr of [...child.attributes]) {
        const keep = (child.tagName === "FONT" && (attr.name === "color" || attr.name === "size" || attr.name === "face")) ||
          (attr.name === "style" && /^[\s;]*(color|background-color|font-weight|font-style|font-size)\s*:[^;:()]*;?\s*$/i.test(attr.value));
        if (!keep) child.removeAttribute(attr.name);
      }
      clean(child);
    }
  };
  clean(root);
  return root.innerHTML;
}

function renderTelemetry(t) {
  const box = $("telemetry");
  if (!box) return;
  const lines = t.lines || [];
  const log = t.log || [];
  const html = [...lines, ...log].some((l) => TELEMETRY_HTML_RE.test(l));

  box.innerHTML = "";
  if (!lines.length && !log.length) {
    box.innerHTML = `<div class="small">The OpMode hasn't sent any telemetry yet.</div>`;
    return;
  }
  const addLine = (parent, text) => {
    const div = document.createElement("div");
    div.className = "tLine";
    if (html) div.innerHTML = sanitizeTelemetryHtml(text);
    else div.textContent = text;
    parent.appendChild(div);
  };
  for (const l of lines) addLine(box, l);
  if (log.length) {
    const logBox = document.createElement("div");
    logBox.className = "tLog";
    for (const l of log) addLine(logBox, l);
    box.appendChild(logBox);
  }
}

function renderTelemetryMeta() {
  const box = $("telemetry");
  const meta = $("telemetryMeta");
  const active = opCtl.state === "init" || opCtl.state === "running";
  if (box) box.classList.toggle("stale", !active && !!opCtl.telemetrySeq);
  if (meta) {
    meta.textContent = opCtl.state === "unavailable" ? "" :
      active ? (opCtl.active || "") : (opCtl.telemetrySeq ? "Last run" : "");
  }
}

// --- Live plot: tail the active OpMode's log while it runs ---
const live = {
  enabled: true,      // the "Live" toggle in the plot header
  dismissedRun: "",   // a live run the user navigated away from (don't jump back to it)
  following: false,
  opMode: "",
  run: "",
  offset: 0,
  timer: null,
  busy: false,
  lastStats: 0,
  lastTable: 0,
};

try { live.enabled = localStorage.getItem("ftcLogger.live") !== "off"; } catch (_) { /* storage blocked */ }

function liveKey(op, run) { return `${op}/${run}`; }

function updateLiveFollow() {
  const robotActive = opCtl.state === "init" || opCtl.state === "running";
  const target = robotActive && opCtl.liveRun ? liveKey(opCtl.liveOpMode, opCtl.liveRun) : "";
  const want = live.enabled && target && target !== live.dismissedRun;

  if (want && (!live.following || liveKey(live.opMode, live.run) !== target)) {
    startFollowing(opCtl.liveOpMode, opCtl.liveRun);
  } else if (live.following && !want) {
    // Robot stopped: grab the last rows. Live turned off / dismissed: just stop.
    stopFollowing(!robotActive);
  }
  updateLiveUI();
}

async function startFollowing(op, run) {
  stopFollowing(false);
  live.following = true;
  live.opMode = op;
  live.run = run;
  live.offset = 0;

  // Point the log selectors at the live run.
  try {
    if (!state.opModes.includes(op)) await loadOpModes(true);
    if (state.opMode !== op) {
      state.opMode = op;
      state.configOpen.clear();
      renderConfig();
    }
    $("opModeSel").value = op;
    const j = await fetchJson(`/logger/api/runs?opMode=${encodeURIComponent(op)}`);
    state.runs = j.runs || [];
  } catch (_) {
    state.runs = [];
  }
  if (!live.following || live.run !== run) return; // superseded while awaiting
  if (!state.runs.includes(run)) state.runs.unshift(run);
  state.run = run;
  renderRunList();

  state.data = { t: [], series: {} };
  state.tUnit = "s";
  state.visible = new Set();
  state.selectionRange = null;
  state.activeRow = null;
  buildSeriesToggles([]);
  computeFullExtents();
  setViewportToFull();
  buildTable();
  updateStats();
  updateLiveUI();

  await liveTick();
  if (live.following && live.run === run) live.timer = setInterval(liveTick, 250);
}

async function stopFollowing(finalFetch) {
  clearInterval(live.timer);
  live.timer = null;
  if (!live.following) return;
  if (finalFetch) await liveTick(true);
  live.following = false;
  if (state.data) {
    buildTable();
    updateStats();
    const n = Object.keys(state.data.series || {}).length;
    setStatus(`${state.opMode} / ${state.run} (${n} series)`);
  }
  updateLiveUI();
}

async function liveTick(force = false) {
  if (!live.following || (live.busy && !force)) return;
  live.busy = true;
  const run = live.run;
  try {
    const j = await fetchJson(
      `/logger/api/data?opMode=${encodeURIComponent(live.opMode)}&run=${encodeURIComponent(run)}&offset=${live.offset}`);
    if (!live.following || live.run !== run) return;
    appendLiveData(j);
  } catch (_) {
    // File may not exist yet (OpMode hasn't created its LogWriter); try again next tick.
  } finally {
    live.busy = false;
  }
}

function appendLiveData(j) {
  if (j.reset) state.data = { t: [], series: {} };
  live.offset = typeof j.offset === "number" ? j.offset : live.offset;
  if (j.tUnit) state.tUnit = normalizeTimeUnit(j.tUnit);

  const t = j.t || [];
  const series = j.series || {};
  const data = state.data;

  let newSeries = false;
  for (const [name, vals] of Object.entries(series)) {
    if (!data.series[name]) {
      data.series[name] = [];
      state.visible.add(name);
      newSeries = true;
    }
    for (const v of vals) data.series[name].push(v);
  }
  for (const v of t) data.t.push(v);
  if (newSeries) buildSeriesToggles(Object.keys(data.series));

  // Keep auto-scaling unless the user has zoomed or panned away from the full view.
  const atFull = state.xMin === state.full.xMin && state.xMax === state.full.xMax &&
                 state.yMin === state.full.yMin && state.yMax === state.full.yMax;
  if (t.length || j.reset) {
    computeFullExtents();
    if (atFull) setViewportToFull(); else draw();
  }

  const now = performance.now();
  if (now - live.lastStats > 500) { live.lastStats = now; updateStats(); }
  const drawer = $("tableDrawer");
  if (drawer && drawer.classList.contains("open") && now - live.lastTable > 1000) {
    live.lastTable = now;
    buildTable();
  }
  setStatus(`${state.opMode} / ${state.run} · ${data.t.length} rows`);
}

// User picked a different log while a run is live: stop following that run.
function dismissLive() {
  if (!live.following) return;
  live.dismissedRun = liveKey(live.opMode, live.run);
  stopFollowing(false);
}

function updateLiveUI() {
  const btn = $("liveToggle");
  if (btn) {
    btn.classList.toggle("active", live.enabled);
    btn.classList.toggle("streaming", live.following);
    btn.title = live.following ? "Following the running OpMode's log (click to stop following)"
      : live.enabled ? "Live plot is on: the running OpMode's log will be followed"
      : "Live plot is off";
  }
}

function wireLiveToggle() {
  const btn = $("liveToggle");
  if (!btn) return;
  btn.onclick = () => {
    if (live.following) {
      live.enabled = false;
    } else {
      live.enabled = !live.enabled;
      if (live.enabled) live.dismissedRun = "";
    }
    try { localStorage.setItem("ftcLogger.live", live.enabled ? "on" : "off"); } catch (_) { /* ignore */ }
    updateLiveFollow();
  };
  updateLiveUI();
}

async function showRunAfterStop() {
  if (opCtl.liveRun) {
    try {
      await loadOpModes(true);
      if (state.opModes.includes(opCtl.liveOpMode)) {
        if (state.opMode !== opCtl.liveOpMode) {
          state.opMode = opCtl.liveOpMode;
          state.configOpen.clear();
          renderConfig();
        }
        $("opModeSel").value = state.opMode;
        const j = await fetchJson(`/logger/api/runs?opMode=${encodeURIComponent(state.opMode)}`);
        state.runs = j.runs || [];
        if (state.runs.includes(opCtl.liveRun)) {
          state.run = opCtl.liveRun;
          renderRunList();
          await loadData();
          return;
        }
      }
    } catch (e) {
      console.error(e);
    }
  }
  await showLatestRunFor(opCtl.lastClass);
}

async function showLatestRunFor(className) {
  try {
    await loadOpModes(true);
    const folder = sanitizeName(className);
    if (folder && state.opModes.includes(folder)) {
      if (state.opMode !== folder) {
        state.opMode = folder;
        $("opModeSel").value = folder;
        state.configOpen.clear();
        renderConfig();
      }
      await loadRuns(); // picks the newest run
    } else {
      await refreshOpModeSelection();
    }
  } catch (e) {
    console.error(e);
  }
}

function wireOpModeControl() {
  const sel = $("opCtlSel");
  if (!sel) return;
  sel.onchange = () => { setOpCtlMessage(""); renderControlState(); };

  $("opCtlInit").onclick = () => {
    if (!sel.value) return;
    sendControl(`/logger/api/control/init?name=${encodeURIComponent(sel.value)}`, "Initializing");
  };
  $("opCtlStart").onclick = () => sendControl("/logger/api/control/start", "Starting");
  $("opCtlStop").onclick = () => sendControl("/logger/api/control/stop", "Stopping");

  // Space bar = emergency stop while an OpMode is initialized or running.
  // Listens in the capture phase so it works no matter what has focus, and swallows
  // the key so it can't also "click" a focused button (e.g. ▶ right after starting).
  let spaceHandled = false;
  window.addEventListener("keydown", (ev) => {
    if (ev.code !== "Space" && ev.key !== " ") return;
    const active = opCtl.state === "init" || opCtl.state === "running" || opCtl.pending;
    if (!active) return;
    ev.preventDefault();
    ev.stopPropagation();
    spaceHandled = true;
    if (ev.repeat) return;
    emergencyStop();
  }, true);
  window.addEventListener("keyup", (ev) => {
    if (!spaceHandled || (ev.code !== "Space" && ev.key !== " ")) return;
    ev.preventDefault();
    ev.stopPropagation();
    spaceHandled = false;
  }, true);

  document.addEventListener("visibilitychange", () => { if (!document.hidden) pollControlState(); });
  scheduleControlPoll();
}

// --- boot ---
window.addEventListener("resize", () => { resizeCanvases(); draw(); });

(async function boot() {
  try {
    bindDrawerButtons();
    wireControls();
    wireTableInteractions();
    wireExportDialog();
    wireThemeToggle();
    $("downloadCsv").onclick = downloadCsv;
    wireOpModeControl();
    wireLiveToggle();
    installCanvasInteractions();
    const modal = $("manageModal");
    if (modal) modal.classList.add("hidden");

    await loadOpModes();
    loadConfig(); // independent of runs; failures are shown in the panel
    await loadRuns();

    resizeCanvases();
    draw();
  } catch (e) {
    setStatus("Error: " + e);
    console.error(e);
  }
})();
