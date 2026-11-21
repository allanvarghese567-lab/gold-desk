/* CRT + TBS + RANGE warning (sideways) */
let crtChart, crtSeries, crtGran = "H1";
let crtLastEvents = [], crtLastData = [], crtPulseTimer = null, crtLines = [];

function initCrtChart(){
  if (crtChart) return;
  const el = $("chartCrt");
  if (!el) return;
  crtChart = LightweightCharts.createChart(el, {
    autoSize: true,
    layout: { background: { color: "transparent" }, textColor: dark ? "#a1957a" : "#7a6f58" },
    grid: { vertLines: { color: dark ? "#26200f" : "#eee6d2" }, horzLines: { color: dark ? "#26200f" : "#eee6d2" } },
    timeScale: { timeVisible: true, secondsVisible: false },
    rightPriceScale: { borderVisible: false },
    crosshair: { mode: 0 }
  });
  crtSeries = crtChart.addCandlestickSeries({
    upColor: "#1f8a5b", downColor: "#c8403a", borderVisible: false,
    wickUpColor: "#1f8a5b", wickDownColor: "#c8403a"
  });
  crtChart.timeScale().subscribeVisibleTimeRangeChange(() => drawCrtBlocks());
  window.addEventListener("resize", () => drawCrtBlocks());
  document.querySelectorAll(".crt-tfs").forEach(group => {
    group.addEventListener("click", e => {
      const b = e.target.closest("button[data-g]");
      if (!b) return;
      group.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      crtGran = b.dataset.g;
      loadCrtPanel();
    });
  });
}

function clearCrtLines(){
  crtLines.forEach(pl => { try { crtSeries.removePriceLine(pl); } catch(e){} });
  crtLines = [];
}

function detectCrt(data){
  if (!data || data.length < 4) return [];
  const out = [];
  for (let i = 0; i < data.length - 1; i++){
    const c1 = data[i], c2 = data[i + 1];
    const rHi = c1.high, rLo = c1.low;
    if (rHi <= rLo) continue;
    const sweptHigh = c2.high > rHi;
    const sweptLow  = c2.low  < rLo;
    const closeInside = c2.close < rHi && c2.close > rLo;
    if (sweptHigh && !sweptLow && closeInside){
      out.push({ kind: "CRT", bias: "bear", time: c2.time, c1Time: c1.time, i: i + 1,
        high: rHi, low: rLo, mid: (rHi + rLo) / 2, level: rHi, top: rHi, bottom: rLo, sweep: c2.high,
        note: "Sweep of CRT high · close back inside · target CRT low" });
    }
    if (sweptLow && !sweptHigh && closeInside){
      out.push({ kind: "CRT", bias: "bull", time: c2.time, c1Time: c1.time, i: i + 1,
        high: rHi, low: rLo, mid: (rHi + rLo) / 2, level: rLo, top: rHi, bottom: rLo, sweep: c2.low,
        note: "Sweep of CRT low · close back inside · target CRT high" });
    }
  }
  const dedup = [];
  for (const e of out){
    const prev = dedup[dedup.length - 1];
    if (prev && prev.bias === e.bias && Math.abs(prev.i - e.i) < 2) continue;
    dedup.push(e);
  }
  return dedup.slice(-12);
}

function detectTbsAfterCrt(data, crtEvents){
  const tbs = [];
  for (const crt of crtEvents){
    const start = crt.i + 1;
    const end = Math.min(data.length - 1, start + 24);
    if (start >= data.length) continue;
    for (let i = start + 2; i <= end; i++){
      const c = data[i];
      const win = data.slice(Math.max(start, i - 6), i);
      if (win.length < 2) continue;
      const localHigh = Math.max(...win.map(x => x.high));
      const localLow  = Math.min(...win.map(x => x.low));
      if (crt.bias === "bull"){
        if (c.low < localLow && c.close > localLow && c.open > localLow){
          tbs.push({ kind: "TBS", bias: "bull", time: c.time, i, parentTime: crt.time,
            high: Math.max(c.high, localLow), low: c.low, top: Math.max(c.open, c.close), bottom: c.low, level: localLow,
            note: "Turtle Body Soup · false break low · body closed back up" });
          break;
        }
      } else {
        if (c.high > localHigh && c.close < localHigh && c.open < localHigh){
          tbs.push({ kind: "TBS", bias: "bear", time: c.time, i, parentTime: crt.time,
            high: c.high, low: Math.min(c.low, localHigh), top: c.high, bottom: Math.min(c.open, c.close), level: localHigh,
            note: "Turtle Body Soup · false break high · body closed back down" });
          break;
        }
      }
    }
  }
  return tbs.slice(-12);
}

function detectRangeCrt(data){
  if (!data || data.length < 40) return null;
  const slice = data.slice(-40);
  const hi = Math.max(...slice.map(c => c.high));
  const lo = Math.min(...slice.map(c => c.low));
  if (hi <= lo) return null;
  const avgBody = slice.reduce((s, c) => s + Math.abs(c.close - c.open), 0) / slice.length;
  const width = hi - lo;
  if (avgBody <= 0) return null;
  const nearHi = slice.filter(c => c.high >= hi - width * 0.15).length;
  const nearLo = slice.filter(c => c.low <= lo + width * 0.15).length;
  const mid = (hi + lo) / 2;
  const crosses = slice.filter(c => (c.low < mid && c.high > mid)).length;
  if (nearHi >= 3 && nearLo >= 3 && crosses >= 8 && width < avgBody * 25){
    return {
      kind: "RANGE", bias: "sideways",
      time: slice[0].time, c1Time: slice[0].time, endTime: slice[slice.length - 1].time,
      top: hi, bottom: lo, high: hi, low: lo, level: mid,
      note: "Sideways / range — no clear trend · warning"
    };
  }
  return null;
}

function ensureCrtOverlay(){
  const host = $("chartCrt");
  if (!host) return null;
  host.style.position = host.style.position || "relative";
  let cv = host.querySelector("canvas.crt-overlay");
  if (!cv){
    cv = document.createElement("canvas");
    cv.className = "crt-overlay";
    cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;";
    host.appendChild(cv);
  }
  return cv;
}

function drawCrtBlocks(){
  const cv = ensureCrtOverlay();
  if (!cv || !crtChart || !crtSeries) return;
  const rect = cv.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.floor(rect.width * dpr));
  cv.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const events = crtLastEvents || [];
  const data = crtLastData || [];
  if (!events.length || !data.length) return;
  const ts = crtChart.timeScale();
  const lastTime = data[data.length - 1].time;
  events.forEach(e => {
    const bull = e.bias === "bull";
    const isTbs = e.kind === "TBS";
    const isRange = e.kind === "RANGE" || e.bias === "sideways";
    const fill = isRange ? [232, 185, 35] : (isTbs ? [224, 176, 74] : (bull ? [31, 138, 91] : [200, 64, 58]));
    let hi = Math.max(e.top != null ? e.top : e.high, e.bottom != null ? e.bottom : e.low);
    let lo = Math.min(e.top != null ? e.top : e.high, e.bottom != null ? e.bottom : e.low);
    if (hi - lo < 1e-6){
      const pad = Math.max(Math.abs(e.level || e.high) * 0.0003, 0.4);
      hi = (e.level || e.high) + pad;
      lo = (e.level || e.low) - pad;
    }
    const t0 = e.c1Time != null ? e.c1Time : e.time;
    const x1 = ts.timeToCoordinate(t0);
    const x2 = ts.timeToCoordinate(isTbs ? e.time : (e.endTime != null ? e.endTime : lastTime));
    const y1 = crtSeries.priceToCoordinate(hi);
    const y2 = crtSeries.priceToCoordinate(lo);
    if (x1 == null || y1 == null || y2 == null) return;
    const left = Math.min(x1, x2 != null ? x2 : x1 + 36);
    const right = Math.max(x1, x2 != null ? x2 : x1 + 36);
    const topY = Math.min(y1, y2);
    const botY = Math.max(y1, y2);
    const w = Math.max(4, right - left);
    const h = Math.max(3, botY - topY);
    let a;
    if (isRange) a = 0.14 + 0.08 * Math.sin(Date.now() / 600);
    else if (isTbs) {
      const t = (Date.now() % 700) / 700;
      const wave = t < 0.5 ? t * 2 : (1 - t) * 2;
      a = 0.14 + 0.30 * wave;
    } else a = 0.18;
    ctx.fillStyle = `rgba(${fill[0]},${fill[1]},${fill[2]},${a})`;
    ctx.fillRect(left, topY, w, h);
    let ba = isTbs || isRange ? (0.45 + 0.35 * Math.abs(Math.sin(Date.now() / 500))) : 0.55;
    ctx.strokeStyle = `rgba(${fill[0]},${fill[1]},${fill[2]},${ba})`;
    ctx.lineWidth = isTbs || isRange ? 2 : 1.5;
    ctx.strokeRect(left + 0.5, topY + 0.5, w - 1, h - 1);
    ctx.font = "bold 10px system-ui,sans-serif";
    ctx.fillStyle = `rgba(${fill[0]},${fill[1]},${fill[2]},0.95)`;
    const label = isRange ? "RANGE" : e.kind;
    if (w > 28 && h > 12) ctx.fillText(label, left + 4, topY + 11);
  });
}

function applyCrt(data, events){
  if (!crtSeries) return;
  clearCrtLines();
  crtSeries.setData(data.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
  crtSeries.setMarkers([]);
  const recent = events.slice(-14);
  const rangeCrt = detectRangeCrt(data);
  crtLastEvents = rangeCrt ? [...recent, rangeCrt] : recent;
  crtLastData = data;
  const lastCrt = [...recent].reverse().find(e => e.kind === "CRT");
  if (lastCrt){
    const col = lastCrt.bias === "bull" ? "rgba(31,138,91,0.4)" : "rgba(200,64,58,0.4)";
    [["high", lastCrt.high], ["low", lastCrt.low], ["mid", lastCrt.mid]].forEach(([title, price]) => {
      crtLines.push(crtSeries.createPriceLine({
        price, color: col, lineWidth: 1, lineStyle: title === "mid" ? 2 : 0,
        axisLabelVisible: true, title: title === "mid" ? "50%" : "CRT"
      }));
    });
  }
  drawCrtBlocks();
  try { crtChart.timeScale().fitContent(); } catch(e){}
  setTimeout(drawCrtBlocks, 50);
  setTimeout(drawCrtBlocks, 200);
  const list = $("listCrt");
  if (list){
    const all = crtLastEvents;
    if (!all.length){
      list.innerHTML = '<div class="empty">No CRT yet. Need C1 range + C2 sweep of <b>one</b> side and close back inside.</div>';
    } else {
      list.innerHTML = all.slice().reverse().map(e => {
        const bull = e.bias === "bull";
        const isTbs = e.kind === "TBS";
        const isRange = e.kind === "RANGE" || e.bias === "sideways";
        const tag = isRange ? "tag-range" : (isTbs ? "tag-tbs" : (bull ? "tag-bos-bull" : "tag-bos-bear"));
        const t = new Date(e.time * 1000);
        const ts = t.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
        return `<div class="pi structure-row ${isTbs || isRange ? "choch-blink" : ""}">
          <span class="tag ${tag}">${isRange ? "RANGE" : e.kind}</span>
          <span class="txt"><b>${isRange ? "Sideways" : (bull ? "Up" : "Down")}</b> · ${ts}<br><span class="meta">${e.note || ""}</span></span>
        </div>`;
      }).join("");
    }
  }
}

function startCrtPulse(){
  if (crtPulseTimer) return;
  crtPulseTimer = setInterval(() => {
    if (!(crtLastEvents || []).some(e => e.kind === "TBS" || e.kind === "RANGE")) return;
    drawCrtBlocks();
  }, 100);
}

async function loadCrtPanel(){
  initCrtChart();
  startCrtPulse();
  const list = $("listCrt");
  if (list) list.innerHTML = '<div class="empty">Loading CRT / TBS…</div>';
  try {
    const ins = typeof currentInstrument !== "undefined" ? currentInstrument : "XAU_USD";
    const r = await fetch(`/api/candles?granularity=${crtGran}&count=300&instrument=${encodeURIComponent(ins)}`);
    if (!r.ok) throw new Error("candles");
    const data = await r.json();
    const crts = detectCrt(data);
    const tbs = detectTbsAfterCrt(data, crts);
    const merged = [...crts, ...tbs].sort((a, b) => a.time - b.time);
    applyCrt(data, merged);
  } catch (e) {
    if (list) list.innerHTML = '<div class="empty">Could not load CRT chart.</div>';
  }
}

function refreshCrtChart(){ loadCrtPanel(); }
