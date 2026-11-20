/* Candlestick pattern analysis — independent TF + FVG / BAG */
let miniSingle, miniDual, miniMulti;
const patternGran = { single: "M15", dual: "M15", multi: "M15" };
const patternCache = { single: null, dual: null, multi: null };
const zoneLines = { single: [], dual: [], multi: [] };

function mkMiniChart(el){
  const c = LightweightCharts.createChart(el, {
    autoSize: true,
    layout: { background: { color: "transparent" }, textColor: dark ? "#a1957a" : "#7a6f58" },
    grid: { vertLines: { color: dark ? "#26200f" : "#eee6d2" }, horzLines: { color: dark ? "#26200f" : "#eee6d2" } },
    timeScale: { timeVisible: true, secondsVisible: false },
    rightPriceScale: { borderVisible: false },
    crosshair: { mode: 0 }
  });
  const s = c.addCandlestickSeries({
    upColor: "#1f8a5b", downColor: "#c8403a", borderVisible: false,
    wickUpColor: "#1f8a5b", wickDownColor: "#c8403a"
  });
  return { chart: c, series: s };
}

function initPatternCharts(){
  if (miniSingle) return;
  miniSingle = mkMiniChart($("chartSingle"));
  miniDual = mkMiniChart($("chartDual"));
  miniMulti = mkMiniChart($("chartMulti"));
  document.querySelectorAll(".pattern-tfs").forEach(group => {
    group.addEventListener("click", e => {
      const b = e.target.closest("button[data-g]");
      if (!b) return;
      const kind = group.dataset.kind;
      group.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      patternGran[kind] = b.dataset.g;
      loadPatternPanel(kind);
    });
  });
}

function body(c){ return Math.abs(c.close - c.open) }
function range(c){ return Math.max(c.high - c.low, 1e-9) }
function isBull(c){ return c.close >= c.open }
function upperWick(c){ return c.high - Math.max(c.open, c.close) }
function lowerWick(c){ return Math.min(c.open, c.close) - c.low }

function detectSingle(data){
  const out = [];
  const n = data.length;
  for (let i = Math.max(0, n - 80); i < n; i++){
    const c = data[i], b = body(c), r = range(c), uw = upperWick(c), lw = lowerWick(c);
    if (b / r < 0.1 && uw > 0 && lw > 0) out.push({ i, time: c.time, name: "Doji", bias: "neutral", note: "indecision" });
    else if (lw >= 2 * b && uw <= b && b / r < 0.35) out.push({ i, time: c.time, name: "Hammer", bias: "bull", note: "long lower wick rejection" });
    else if (uw >= 2 * b && lw <= b && b / r < 0.35) out.push({ i, time: c.time, name: "Shooting star", bias: "bear", note: "long upper wick rejection" });
    else if (b / r > 0.9) out.push({ i, time: c.time, name: "Marubozu", bias: isBull(c) ? "bull" : "bear", note: "strong one-sided bar" });
    else if (b / r < 0.3 && uw > b && lw > b) out.push({ i, time: c.time, name: "Spinning top", bias: "neutral", note: "weak conviction" });
  }
  return out.slice(-12);
}

function detectDual(data){
  const out = [];
  const n = data.length;
  for (let i = Math.max(1, n - 80); i < n; i++){
    const a = data[i - 1], b = data[i];
    const aBull = isBull(a), bBull = isBull(b);
    if (!aBull && bBull && b.open <= a.close && b.close >= a.open && body(b) > body(a))
      out.push({ i, time: b.time, name: "Bull engulfing", bias: "bull", note: "buyers cover prior down bar" });
    if (aBull && !bBull && b.open >= a.close && b.close <= a.open && body(b) > body(a))
      out.push({ i, time: b.time, name: "Bear engulfing", bias: "bear", note: "sellers cover prior up bar" });
    if (Math.abs(a.low - b.low) / range(a) < 0.08 && !aBull && bBull)
      out.push({ i, time: b.time, name: "Tweezer bottom", bias: "bull", note: "matched lows" });
    if (Math.abs(a.high - b.high) / range(a) < 0.08 && aBull && !bBull)
      out.push({ i, time: b.time, name: "Tweezer top", bias: "bear", note: "matched highs" });
    if (b.high <= a.high && b.low >= a.low)
      out.push({ i, time: b.time, name: "Inside bar", bias: "neutral", note: "compression inside mother bar" });
    if (!aBull && bBull && b.open < a.close && b.close > (a.open + a.close) / 2 && b.close < a.open)
      out.push({ i, time: b.time, name: "Piercing", bias: "bull", note: "reclaim into prior body" });
    if (aBull && !bBull && b.open > a.close && b.close < (a.open + a.close) / 2 && b.close > a.open)
      out.push({ i, time: b.time, name: "Dark cloud", bias: "bear", note: "reject into prior body" });
  }
  return out.slice(-12);
}

function detectMulti(data){
  const out = [];
  const n = data.length;
  for (let i = Math.max(2, n - 80); i < n; i++){
    const a = data[i - 2], b = data[i - 1], c = data[i];
    if (!isBull(a) && body(b) < body(a) * 0.6 && isBull(c) && c.close > (a.open + a.close) / 2)
      out.push({ i, time: c.time, name: "Morning star", bias: "bull", note: "3-bar bottom sequence" });
    if (isBull(a) && body(b) < body(a) * 0.6 && !isBull(c) && c.close < (a.open + a.close) / 2)
      out.push({ i, time: c.time, name: "Evening star", bias: "bear", note: "3-bar top sequence" });
    if (isBull(a) && isBull(b) && isBull(c) && c.close > b.close && b.close > a.close && body(a) > range(a) * 0.5)
      out.push({ i, time: c.time, name: "Three soldiers", bias: "bull", note: "three strong up closes" });
    if (!isBull(a) && !isBull(b) && !isBull(c) && c.close < b.close && b.close < a.close && body(a) > range(a) * 0.5)
      out.push({ i, time: c.time, name: "Three crows", bias: "bear", note: "three strong down closes" });
  }
  for (let i = Math.max(4, n - 80); i < n; i++){
    const w = data.slice(i - 4, i + 1);
    const first = w[0], last = w[4], mid = w.slice(1, 4);
    const midSmall = mid.every(m => body(m) < body(first) * 0.7);
    if (isBull(first) && isBull(last) && last.close > first.close && midSmall && mid.every(m => m.close <= first.close))
      out.push({ i, time: last.time, name: "Rising three", bias: "bull", note: "continuation after pause" });
    if (!isBull(first) && !isBull(last) && last.close < first.close && midSmall && mid.every(m => m.close >= first.close))
      out.push({ i, time: last.time, name: "Falling three", bias: "bear", note: "continuation after pause" });
  }
  return out.slice(-12);
}

function detectFVG(data){
  const out = [];
  const n = data.length;
  for (let i = Math.max(2, n - 100); i < n; i++){
    const a = data[i - 2], b = data[i - 1], c = data[i];
    if (a.high < c.low){
      const top = c.low, bottom = a.high;
      if ((top - bottom) / Math.max(range(b), 1e-9) > 0.05)
        out.push({ i, time: b.time, name: "FVG", bias: "bull", note: "bullish imbalance " + bottom.toFixed(2) + "–" + top.toFixed(2), top, bottom });
    }
    if (c.high < a.low){
      const top = a.low, bottom = c.high;
      if ((top - bottom) / Math.max(range(b), 1e-9) > 0.05)
        out.push({ i, time: b.time, name: "FVG", bias: "bear", note: "bearish imbalance " + bottom.toFixed(2) + "–" + top.toFixed(2), top, bottom });
    }
  }
  return out.slice(-8);
}

function detectBAG(data){
  const out = [];
  const n = data.length;
  for (let i = Math.max(1, n - 100); i < n; i++){
    const a = data[i - 1], b = data[i];
    if (b.low > a.high){
      const gap = b.low - a.high;
      if (gap / range(a) > 0.08 && isBull(b) && body(b) / range(b) > 0.5)
        out.push({ i, time: b.time, name: "BAG", bias: "bull", note: "bull breakaway gap +" + gap.toFixed(2), top: b.low, bottom: a.high });
    }
    if (b.high < a.low){
      const gap = a.low - b.high;
      if (gap / range(a) > 0.08 && !isBull(b) && body(b) / range(b) > 0.5)
        out.push({ i, time: b.time, name: "BAG", bias: "bear", note: "bear breakaway gap -" + gap.toFixed(2), top: a.low, bottom: b.high });
    }
  }
  return out.slice(-8);
}

function patternMarkers(list){
  return list.map(p => ({
    time: p.time,
    position: p.bias === "bull" ? "belowBar" : "aboveBar",
    shape: p.name === "FVG" ? "square" : (p.name === "BAG" ? "circle" : (p.bias === "bull" ? "arrowUp" : (p.bias === "bear" ? "arrowDown" : "circle"))),
    color: p.bias === "bull" ? "#1f8a5b" : (p.bias === "bear" ? "#c8403a" : "#8a5a00"),
    text: p.name
  })).sort((a, b) => a.time - b.time);
}

function clearZones(kind){
  const mini = kind === "single" ? miniSingle : (kind === "dual" ? miniDual : miniMulti);
  if (!mini) return;
  (zoneLines[kind] || []).forEach(pl => { try { mini.series.removePriceLine(pl) } catch {} });
  zoneLines[kind] = [];
}

function drawZones(kind, zones){
  const mini = kind === "single" ? miniSingle : (kind === "dual" ? miniDual : miniMulti);
  if (!mini) return;
  clearZones(kind);
  zones.slice(-6).forEach(z => {
    if (z.top == null || z.bottom == null) return;
    const col = z.bias === "bull" ? "rgba(31,138,91,0.55)" : "rgba(200,64,58,0.55)";
    const title = z.name + (z.bias === "bull" ? " ↑" : " ↓");
    zoneLines[kind].push(mini.series.createPriceLine({
      price: z.top, color: col, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title
    }));
    zoneLines[kind].push(mini.series.createPriceLine({
      price: z.bottom, color: col, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: ""
    }));
  });
}

function renderPatternList(el, list){
  if (!list.length){ el.innerHTML = '<div class="empty">No recent patterns in view.</div>'; return }
  el.innerHTML = list.slice().reverse().map(p =>
    `<div class="pi"><span class="tag tag-${p.bias}">${esc(p.name)}</span><span class="txt">${esc(p.note)}</span></div>`
  ).join("");
}

function applyPanel(kind, data){
  const view = data.slice(-120);
  let list, mini, listEl;
  const fvg = detectFVG(view);
  const bag = detectBAG(view);
  if (kind === "single"){
    list = detectSingle(view).concat(bag.slice(-4));
    mini = miniSingle; listEl = $("listSingle");
  } else if (kind === "dual"){
    list = detectDual(view).concat(bag.slice(-4)).concat(fvg.slice(-3));
    mini = miniDual; listEl = $("listDual");
  } else {
    list = detectMulti(view).concat(fvg.slice(-5)).concat(bag.slice(-3));
    mini = miniMulti; listEl = $("listMulti");
  }
  const seen = new Set();
  list = list.filter(p => {
    const k = p.name + ":" + p.time;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(-14);

  mini.series.setData(view);
  mini.series.setMarkers(patternMarkers(list));
  renderPatternList(listEl, list);
  const zones = fvg.concat(bag).filter(z => z.top != null);
  drawZones(kind, zones);
  try { mini.chart.timeScale().fitContent() } catch {}
}

async function loadPatternPanel(kind){
  initPatternCharts();
  const gran = patternGran[kind];
  const listId = kind === "single" ? "listSingle" : (kind === "dual" ? "listDual" : "listMulti");
  $(listId).innerHTML = '<div class="empty">Loading ' + gran + "…</div>";
  try {
    const r = await fetch(`/api/candles?granularity=${gran}&count=300&instrument=${encodeURIComponent(currentInstrument)}`);
    if (!r.ok) throw new Error("candles " + r.status);
    const data = await r.json();
    patternCache[kind] = data;
    applyPanel(kind, data);
  } catch (e) {
    $(listId).innerHTML = '<div class="empty">Failed to load ' + gran + "</div>";
  }
}

function refreshAllPatternCharts(){
  initPatternCharts();
  loadPatternPanel("single");
  loadPatternPanel("dual");
  loadPatternPanel("multi");
}

function updatePatternCharts(data){ refreshAllPatternCharts() }
