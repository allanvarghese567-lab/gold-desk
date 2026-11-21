/* BOS / CHoCH structure chart — candle close confirms (not wick alone) */
let structureChart, structureSeries, structureGran = "H1";
let structureLines = [];
let structureData = [];

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

function findSwings(data, left){
  left = left || 3;
  const highs = [], lows = [];
  for (let i = left; i < data.length - left; i++){
    let isH = true, isL = true;
    for (let k = 1; k <= left; k++){
      if (data[i].high < data[i - k].high || data[i].high < data[i + k].high) isH = false;
      if (data[i].low > data[i - k].low || data[i].low > data[i + k].low) isL = false;
    }
    if (isH) highs.push({ i, time: data[i].time, price: data[i].high });
    if (isL) lows.push({ i, time: data[i].time, price: data[i].low });
  }
  return { highs, lows };
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
        if (prevHigh && lastHigh.price > prevHigh.price && lastLow && prevLow && lastLow.price > prevLow.price){
          activeTrend = 1;
        }
      } else {
        prevLow = lastLow;
        lastLow = s;
        if (prevLow && lastLow.price < prevLow.price && lastHigh && prevHigh && lastHigh.price < prevHigh.price){
          activeTrend = -1;
        }
      }
    }
    const c = data[i];
    if (activeTrend === 1 && lastHigh && lastLow){
      if (c.close > lastHigh.price && i > lastHigh.i){
        confirmed.push({
          type: "BOS", bias: "bull", time: c.time, i,
          level: lastHigh.price,
          top: Math.max(c.high, lastHigh.price),
          bottom: lastHigh.price,
          note: "Close above prior high — uptrend may continue"
        });
        lastHigh = { i, time: c.time, price: c.high };
      }
      if (c.close < lastLow.price && i > lastLow.i){
        confirmed.push({
          type: "CHoCH", bias: "bear", time: c.time, i,
          level: lastLow.price,
          top: lastLow.price,
          bottom: Math.min(c.low, lastLow.price),
          note: "Close below higher low — trend may change"
        });
        activeTrend = -1;
      }
    } else if (activeTrend === -1 && lastHigh && lastLow){
      if (c.close < lastLow.price && i > lastLow.i){
        confirmed.push({
          type: "BOS", bias: "bear", time: c.time, i,
          level: lastLow.price,
          top: lastLow.price,
          bottom: Math.min(c.low, lastLow.price),
          note: "Close below prior low — downtrend may continue"
        });
        lastLow = { i, time: c.time, price: c.low };
      }
      if (c.close > lastHigh.price && i > lastHigh.i){
        confirmed.push({
          type: "CHoCH", bias: "bull", time: c.time, i,
          level: lastHigh.price,
          top: Math.max(c.high, lastHigh.price),
          bottom: lastHigh.price,
          note: "Close above lower high — trend may change"
        });
        activeTrend = 1;
      }
    } else if (activeTrend === 0 && lastHigh && lastLow){
      if (c.close > lastHigh.price && i > lastHigh.i){
        confirmed.push({
          type: "BOS", bias: "bull", time: c.time, i,
          level: lastHigh.price, top: c.high, bottom: lastHigh.price,
          note: "Close above prior high — up structure"
        });
        activeTrend = 1;
      } else if (c.close < lastLow.price && i > lastLow.i){
        confirmed.push({
          type: "BOS", bias: "bear", time: c.time, i,
          level: lastLow.price, top: lastLow.price, bottom: c.low,
          note: "Close below prior low — down structure"
        });
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

function applyStructure(data, events){
  if (!structureSeries) return;
  clearStructureLines();
  structureSeries.setData(data.map(c => ({
    time: c.time, open: c.open, high: c.high, low: c.low, close: c.close
  })));

  const markers = events.map(e => {
    const bull = e.bias === "bull";
    const isCh = e.type === "CHoCH";
    return {
      time: e.time,
      position: bull ? "belowBar" : "aboveBar",
      shape: isCh ? "circle" : "square",
      color: bull ? "#1f8a5b" : "#c8403a",
      text: e.type
    };
  });
  structureSeries.setMarkers(markers);

  events.slice(-8).forEach(e => {
    const bull = e.bias === "bull";
    const isCh = e.type === "CHoCH";
    const col = isCh
      ? (bull ? "rgba(31,138,91,0.95)" : "rgba(200,64,58,0.95)")
      : (bull ? "rgba(31,138,91,0.75)" : "rgba(200,64,58,0.75)");
    structureLines.push(structureSeries.createPriceLine({
      price: e.level,
      color: col,
      lineWidth: isCh ? 2 : 1,
      lineStyle: isCh ? 0 : 2,
      axisLabelVisible: true,
      title: e.type
    }));
  });

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
  try { structureChart.timeScale().fitContent(); } catch(e){}
}

async function loadStructurePanel(){
  initStructureChart();
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
