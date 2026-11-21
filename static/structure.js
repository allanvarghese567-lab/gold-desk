/* BOS / CHoCH — semi-transparent zone blocks; candle close confirms */
let structureChart, structureSeries, structureGran = "H1";
let structureLines = [];
let structureData = [];
let structureLastEvents = [];
let structureLastData = [];
let structurePulseTimer = null;

function initStructureChart(){
  if (structureChart) return;
  const el = $("chartStructure");
  if (!el) return;
  structureChart = LightweightCharts.createChart(el, {
    autoSize: true,
    layout: { background: { color: "transparent" }, textColor: dark ? "#a1957a" : "#7a6f58" },
    grid: { vertLines: { color: dark ? "#26200f" : "#eee6d2" }, horzLines: { color: dark ? "#26200f" : "#eee6d2" } },
    timeScale: { timeVisible: true, secondsVisible: false },
    rightPriceScale: { borderVisible: false },
    crosshair: { mode: 0 }
  });
  structureSeries = structureChart.addCandlestickSeries({
    upColor: "#1f8a5b", downColor: "#c8403a", borderVisible: false,
    wickUpColor: "#1f8a5b", wickDownColor: "#c8403a"
  });
  structureChart.timeScale().subscribeVisibleTimeRangeChange(() => drawStructureBlocks());
  window.addEventListener("resize", () => drawStructureBlocks());
  document.querySelectorAll(".structure-tfs").forEach(group => {
    group.addEventListener("click", e => {
      const b = e.target.closest("button[data-g]");
      if (!b) return;
      group.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      structureGran = b.dataset.g;
      loadStructurePanel();
    });
  });
}

function clearStructureLines(){
  structureLines.forEach(pl => { try { structureSeries.removePriceLine(pl); } catch(e){} });
  structureLines = [];
}

function detectBosChoch(data){
  if (!data || data.length < 30) return [];
  let activeTrend = 0;
  let lastHigh = null, lastLow = null;
  let prevHigh = null, prevLow = null;
  const byIndex = {};
  for (let i = 3; i < data.length - 3; i++){
    let isH = true, isL = true;
    for (let k = 1; k <= 3; k++){
      if (data[i].high <= data[i - k].high || data[i].high <= data[i + k].high) isH = false;
      if (data[i].low >= data[i - k].low || data[i].low >= data[i + k].low) isL = false;
    }
    if (isH) byIndex[i] = { i, time: data[i].time, price: data[i].high, type: "H" };
    if (isL) byIndex[i] = { i, time: data[i].time, price: data[i].low, type: "L" };
  }
  const confirmed = [];
  for (let i = 0; i < data.length; i++){
    if (byIndex[i]){
      const s = byIndex[i];
      if (s.type === "H"){
        prevHigh = lastHigh;
        lastHigh = s;
        if (prevHigh && lastHigh.price > prevHigh.price && lastLow && prevLow && lastLow.price > prevLow.price) activeTrend = 1;
      } else {
        prevLow = lastLow;
        lastLow = s;
        if (prevLow && lastLow.price < prevLow.price && lastHigh && prevHigh && lastHigh.price < prevHigh.price) activeTrend = -1;
      }
    }
    const c = data[i];
    if (activeTrend === 1 && lastHigh && lastLow){
      if (c.close > lastHigh.price && i > lastHigh.i){
        confirmed.push({ type: "BOS", bias: "bull", time: c.time, i, level: lastHigh.price, top: Math.max(c.high, lastHigh.price), bottom: lastHigh.price, note: "Close above prior high — uptrend may continue" });
        lastHigh = { i, time: c.time, price: c.high };
      }
      if (c.close < lastLow.price && i > lastLow.i){
        confirmed.push({ type: "CHoCH", bias: "bear", time: c.time, i, level: lastLow.price, top: lastLow.price, bottom: Math.min(c.low, lastLow.price), note: "Close below higher low — trend may change" });
        activeTrend = -1;
      }
    } else if (activeTrend === -1 && lastHigh && lastLow){
      if (c.close < lastLow.price && i > lastLow.i){
        confirmed.push({ type: "BOS", bias: "bear", time: c.time, i, level: lastLow.price, top: lastLow.price, bottom: Math.min(c.low, lastLow.price), note: "Close below prior low — downtrend may continue" });
        lastLow = { i, time: c.time, price: c.low };
      }
      if (c.close > lastHigh.price && i > lastHigh.i){
        confirmed.push({ type: "CHoCH", bias: "bull", time: c.time, i, level: lastHigh.price, top: Math.max(c.high, lastHigh.price), bottom: lastHigh.price, note: "Close above lower high — trend may change" });
        activeTrend = 1;
      }
    } else if (activeTrend === 0 && lastHigh && lastLow){
      if (c.close > lastHigh.price && i > lastHigh.i){
        confirmed.push({ type: "BOS", bias: "bull", time: c.time, i, level: lastHigh.price, top: c.high, bottom: lastHigh.price, note: "Close above prior high — up structure" });
        activeTrend = 1;
      } else if (c.close < lastLow.price && i > lastLow.i){
        confirmed.push({ type: "BOS", bias: "bear", time: c.time, i, level: lastLow.price, top: lastLow.price, bottom: c.low, note: "Close below prior low — down structure" });
        activeTrend = -1;
      }
    }
  }
  const out = [];
  for (const e of confirmed){
    const prev = out[out.length - 1];
    if (prev && prev.type === e.type && prev.bias === e.bias && Math.abs(prev.i - e.i) < 3) continue;
    out.push(e);
  }
  return out.slice(-20);
}

function ensureStructureOverlay(){
  const host = $("chartStructure");
  if (!host) return null;
  host.style.position = host.style.position || "relative";
  let cv = host.querySelector("canvas.structure-overlay");
  if (!cv){
    cv = document.createElement("canvas");
    cv.className = "structure-overlay";
    cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;";
    host.appendChild(cv);
  }
  return cv;
}

function drawStructureBlocks(){
  const cv = ensureStructureOverlay();
  if (!cv || !structureChart || !structureSeries) return;
  const rect = cv.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.floor(rect.width * dpr));
  cv.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const events = structureLastEvents || [];
  const data = structureLastData || [];
  if (!events.length || !data.length) return;

  const ts = structureChart.timeScale();
  const lastTime = data[data.length - 1].time;

  events.forEach(e => {
    const bull = e.bias === "bull";
    const isCh = e.type === "CHoCH";
    const top = e.top != null ? e.top : e.level;
    const bottom = e.bottom != null ? e.bottom : e.level;
    let hi = Math.max(top, bottom);
    let lo = Math.min(top, bottom);
    if (hi - lo < 1e-6){
      const pad = Math.max(Math.abs(e.level) * 0.0004, 0.5);
      hi = e.level + pad;
      lo = e.level - pad;
    }

    const x1 = ts.timeToCoordinate(e.time);
    const x2 = ts.timeToCoordinate(lastTime);
    const y1 = structureSeries.priceToCoordinate(hi);
    const y2 = structureSeries.priceToCoordinate(lo);
    if (x1 == null || y1 == null || y2 == null) return;

    const left = Math.min(x1, x2 != null ? x2 : x1 + 40);
    const right = Math.max(x1, x2 != null ? x2 : x1 + 40);
    const topY = Math.min(y1, y2);
    const botY = Math.max(y1, y2);
    const w = Math.max(4, right - left);
    const h = Math.max(3, botY - topY);

    // Trend color: green=up, red=down
    const base = bull ? [31, 138, 91] : [200, 64, 58];
    // BOS: solid highlighted block
    // CHoCH: same trend color, always blinks
    let a;
    if (isCh) {
      const t = (Date.now() % 700) / 700;
      const wave = t < 0.5 ? t * 2 : (1 - t) * 2;
      a = 0.12 + 0.32 * wave;
    } else {
      a = 0.28;
    }
    ctx.fillStyle = `rgba(${base[0]},${base[1]},${base[2]},${a})`;
    ctx.fillRect(left, topY, w, h);

    let ba;
    if (isCh) {
      const t = (Date.now() % 700) / 700;
      const wave = t < 0.5 ? t * 2 : (1 - t) * 2;
      ba = 0.40 + 0.55 * wave;
    } else {
      ba = 0.92;
    }
    ctx.strokeStyle = `rgba(${base[0]},${base[1]},${base[2]},${ba})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(left + 0.5, topY + 0.5, w - 1, h - 1);

    if (isCh && a > 0.30) {
      ctx.strokeStyle = `rgba(${base[0]},${base[1]},${base[2]},0.35)`;
      ctx.lineWidth = 4;
      ctx.strokeRect(left - 1, topY - 1, w + 2, h + 2);
    }

    ctx.font = "bold 10px system-ui,sans-serif";
    ctx.fillStyle = `rgba(${base[0]},${base[1]},${base[2]},0.98)`;
    const label = e.type;
    const tw = ctx.measureText(label).width;
    if (w > tw + 8 && h > 12) ctx.fillText(label, left + 4, topY + 11);
  });
}

function applyStructure(data, events){
  if (!structureSeries) return;
  clearStructureLines();
  structureSeries.setData(data.map(c => ({
    time: c.time, open: c.open, high: c.high, low: c.low, close: c.close
  })));
  structureSeries.setMarkers([]);

  const recent = events.slice(-10);
  structureLastEvents = recent;
  structureLastData = data;

  if (recent.length){
    const e = recent[recent.length - 1];
    const bull = e.bias === "bull";
    const isCh = e.type === "CHoCH";
    structureLines.push(structureSeries.createPriceLine({
      price: e.level,
      color: isCh
        ? (bull ? "rgba(31,138,91,0.55)" : "rgba(200,64,58,0.55)")
        : (bull ? "rgba(31,138,91,0.45)" : "rgba(200,64,58,0.45)"),
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: e.type
    }));
  }

  drawStructureBlocks();
  try { structureChart.timeScale().fitContent(); } catch(e){}
  setTimeout(drawStructureBlocks, 50);
  setTimeout(drawStructureBlocks, 200);

  const list = $("listStructure");
  if (list){
    if (!events.length){
      list.innerHTML = '<div class="empty">No BOS / CHoCH yet on this timeframe. Needs clear swing highs & lows and a candle <b>close</b> beyond them.</div>';
    } else {
      list.innerHTML = events.slice().reverse().map(e => {
        const bull = e.bias === "bull";
        const isCh = e.type === "CHoCH";
        const tag = isCh ? (bull ? "tag-choch-bull" : "tag-choch-bear") : (bull ? "tag-bos-bull" : "tag-bos-bear");
        const t = new Date(e.time * 1000);
        const ts = t.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
        return `<div class="pi structure-row ${isCh ? "choch-blink" : ""}">
          <span class="tag ${tag}">${e.type}</span>
          <span class="txt"><b>${bull ? "Up" : "Down"}</b> · level ${e.level.toFixed(2)} · ${ts}<br><span class="meta">${e.note}</span></span>
        </div>`;
      }).join("");
    }
  }
}

function startStructurePulse(){
  if (structurePulseTimer) return;
  structurePulseTimer = setInterval(() => {
    if (!(structureLastEvents || []).some(e => e.type === "CHoCH")) return;
    drawStructureBlocks();
  }, 100);
}

async function loadStructurePanel(){
  initStructureChart();
  startStructurePulse();
  const list = $("listStructure");
  if (list) list.innerHTML = '<div class="empty">Loading structure…</div>';
  try {
    const ins = typeof currentInstrument !== "undefined" ? currentInstrument : "XAU_USD";
    const r = await fetch(`/api/candles?granularity=${structureGran}&count=300&instrument=${encodeURIComponent(ins)}`);
    if (!r.ok) throw new Error("candles");
    const data = await r.json();
    structureData = data;
    const events = detectBosChoch(data);
    applyStructure(data, events);
  } catch (e) {
    if (list) list.innerHTML = '<div class="empty">Could not load structure chart.</div>';
  }
}

function refreshStructureChart(){ loadStructurePanel(); }
