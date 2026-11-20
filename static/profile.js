/* Footprint + Volume Profile panel (OANDA tick-volume proxy) */
let profileChart, profileSeries, profileMode = "vp";
let profileGran = "M15";
let profileData = [];
let profilePriceLines = [];
let profileCanvas = null;

function initProfileChart(){
  if (profileChart) return;
  const el = $("chartProfile");
  if (!el) return;
  profileChart = LightweightCharts.createChart(el, {
    autoSize: true,
    layout: { background: { color: "transparent" }, textColor: dark ? "#a1957a" : "#7a6f58" },
    grid: { vertLines: { color: dark ? "#26200f" : "#eee6d2" }, horzLines: { color: dark ? "#26200f" : "#eee6d2" } },
    timeScale: { timeVisible: true, secondsVisible: false },
    rightPriceScale: { borderVisible: false },
    crosshair: { mode: 0 }
  });
  profileSeries = profileChart.addCandlestickSeries({
    upColor: "#1f8a5b", downColor: "#c8403a", borderVisible: false,
    wickUpColor: "#1f8a5b", wickDownColor: "#c8403a"
  });
  profileCanvas = document.createElement("canvas");
  profileCanvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2";
  el.style.position = "relative";
  el.appendChild(profileCanvas);

  profileChart.timeScale().subscribeVisibleLogicalRangeChange(() => drawProfileOverlay());
  profileChart.subscribeCrosshairMove(() => drawProfileOverlay());
  window.addEventListener("resize", () => drawProfileOverlay());

  document.querySelectorAll(".profile-tfs").forEach(group => {
    group.addEventListener("click", e => {
      const b = e.target.closest("button[data-g]");
      if (!b) return;
      group.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      profileGran = b.dataset.g;
      loadProfilePanel();
    });
  });
  document.querySelectorAll(".profile-modes button").forEach(b => {
    b.addEventListener("click", () => {
      profileMode = b.dataset.mode;
      document.querySelectorAll(".profile-modes button").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      applyProfileMode();
    });
  });
}

function clearProfileLines(){
  profilePriceLines.forEach(pl => { try { profileSeries.removePriceLine(pl) } catch {} });
  profilePriceLines = [];
}

function buildVolumeProfile(data, bins){
  bins = bins || 40;
  if (!data.length) return null;
  let lo = Infinity, hi = -Infinity, totalV = 0;
  data.forEach(c => {
    lo = Math.min(lo, c.low);
    hi = Math.max(hi, c.high);
    totalV += (c.volume || 0);
  });
  if (!(hi > lo) || totalV <= 0) return null;
  const step = (hi - lo) / bins;
  const hist = new Array(bins).fill(0);
  data.forEach(c => {
    const v = c.volume || 0;
    if (v <= 0) return;
    const i0 = Math.max(0, Math.floor((c.low - lo) / step));
    const i1 = Math.min(bins - 1, Math.floor((c.high - lo) / step));
    const n = Math.max(1, i1 - i0 + 1);
    const share = v / n;
    for (let i = i0; i <= i1; i++) hist[i] += share;
  });
  let pocIdx = 0;
  for (let i = 1; i < bins; i++) if (hist[i] > hist[pocIdx]) pocIdx = i;
  let covered = hist[pocIdx];
  let left = pocIdx, right = pocIdx;
  const target = totalV * 0.70;
  while (covered < target && (left > 0 || right < bins - 1)) {
    const leftV = left > 0 ? hist[left - 1] : -1;
    const rightV = right < bins - 1 ? hist[right + 1] : -1;
    if (rightV >= leftV) { right++; covered += hist[right]; }
    else { left--; covered += hist[left]; }
  }
  const levels = hist.map((v, i) => ({
    price: lo + (i + 0.5) * step,
    vol: v,
    lo: lo + i * step,
    hi: lo + (i + 1) * step
  }));
  const maxV = hist[pocIdx] || 1;
  const hvn = levels.filter(l => l.vol >= maxV * 0.55).slice(0, 8);
  const lvn = levels.filter(l => l.vol > 0 && l.vol <= maxV * 0.12).slice(0, 8);
  return {
    lo, hi, step, hist, levels, maxV, totalV,
    poc: levels[pocIdx].price,
    vah: lo + (right + 1) * step,
    val: lo + left * step,
    pocIdx, left, right, hvn, lvn
  };
}

function footprintStats(data){
  return data.slice(-40).map(c => {
    const v = c.volume || 0;
    const bull = c.close >= c.open;
    const body = Math.abs(c.close - c.open);
    const rng = Math.max(c.high - c.low, 1e-9);
    const bodyShare = Math.min(0.85, 0.35 + body / rng * 0.5);
    const ask = bull ? v * bodyShare : v * (1 - bodyShare);
    const bid = v - ask;
    const delta = ask - bid;
    return {
      time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
      volume: v, bid, ask, delta, bull
    };
  });
}

function drawProfileOverlay(){
  if (!profileCanvas || !profileChart || !profileSeries) return;
  const el = $("chartProfile");
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  profileCanvas.width = Math.max(1, Math.floor(rect.width * dpr));
  profileCanvas.height = Math.max(1, Math.floor(rect.height * dpr));
  profileCanvas.style.width = rect.width + "px";
  profileCanvas.style.height = rect.height + "px";
  const ctx = profileCanvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (!profileData.length) return;

  if (profileMode === "vp") {
    const vp = buildVolumeProfile(profileData, 48);
    if (!vp) return;
    const width = rect.width;
    const maxBarW = Math.min(120, width * 0.28);
    vp.levels.forEach(l => {
      let y1, y2;
      try {
        y1 = profileSeries.priceToCoordinate(l.hi);
        y2 = profileSeries.priceToCoordinate(l.lo);
      } catch { return; }
      if (y1 == null || y2 == null) return;
      const h = Math.max(1, Math.abs(y2 - y1));
      const w = (l.vol / vp.maxV) * maxBarW;
      const isPoc = Math.abs(l.price - vp.poc) < vp.step * 0.6;
      const inVA = l.price >= vp.val && l.price <= vp.vah;
      ctx.fillStyle = isPoc ? "rgba(138,90,0,0.55)" : (inVA ? "rgba(31,138,91,0.28)" : "rgba(122,111,88,0.18)");
      ctx.fillRect(width - w - 4, Math.min(y1, y2), w, h);
    });
  } else {
    const fps = footprintStats(profileData);
    const ts = profileChart.timeScale();
    fps.forEach(f => {
      let x, y;
      try {
        x = ts.timeToCoordinate(f.time);
        y = profileSeries.priceToCoordinate(f.close);
      } catch { return; }
      if (x == null || y == null) return;
      const label = (f.delta >= 0 ? "+" : "") + Math.round(f.delta);
      ctx.font = "10px system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = f.delta >= 0 ? "rgba(31,138,91,0.95)" : "rgba(200,64,58,0.95)";
      ctx.fillText(label, x, y - 10);
      ctx.fillStyle = dark ? "rgba(161,149,122,0.85)" : "rgba(122,111,88,0.9)";
      ctx.fillText(String(Math.round(f.volume)), x, y + 14);
    });
  }
}

function applyProfileMode(){
  if (!profileSeries || !profileData.length) return;
  clearProfileLines();
  const candles = profileData.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
  profileSeries.setData(candles);

  const list = $("listProfile");
  if (profileMode === "vp") {
    const vp = buildVolumeProfile(profileData, 48);
    if (!vp) {
      if (list) list.innerHTML = '<div class="empty">Not enough volume data.</div>';
      drawProfileOverlay();
      return;
    }
    const colPoc = "rgba(138,90,0,0.95)";
    const colVa = "rgba(31,138,91,0.75)";
    profilePriceLines.push(profileSeries.createPriceLine({ price: vp.poc, color: colPoc, lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: "POC" }));
    profilePriceLines.push(profileSeries.createPriceLine({ price: vp.vah, color: colVa, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "VAH" }));
    profilePriceLines.push(profileSeries.createPriceLine({ price: vp.val, color: colVa, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "VAL" }));
    if (list) {
      const hvnHtml = vp.hvn.slice(0, 5).map(l =>
        `<div class="pi"><span class="tag tag-bull">HVN</span><span class="txt">${l.price.toFixed(2)} · vol ${Math.round(l.vol)}</span></div>`
      ).join("");
      const lvnHtml = vp.lvn.slice(0, 5).map(l =>
        `<div class="pi"><span class="tag tag-bear">LVN</span><span class="txt">${l.price.toFixed(2)} · vol ${Math.round(l.vol)}</span></div>`
      ).join("");
      list.innerHTML =
        `<div class="pi"><span class="tag tag-ob">POC</span><span class="txt">${vp.poc.toFixed(2)} · VA ${vp.val.toFixed(2)} – ${vp.vah.toFixed(2)}</span></div>` +
        hvnHtml + lvnHtml +
        `<div class="empty" style="border:0">Tick-volume proxy from OANDA · ~70% value area</div>`;
    }
  } else {
    const fps = footprintStats(profileData).reverse();
    if (list) {
      if (!fps.length) list.innerHTML = '<div class="empty">No bars.</div>';
      else list.innerHTML = fps.slice(0, 16).map(f => {
        const t = new Date(f.time * 1000);
        const ts = String(t.getHours()).padStart(2,"0") + ":" + String(t.getMinutes()).padStart(2,"0");
        const d = (f.delta >= 0 ? "+" : "") + Math.round(f.delta);
        const tag = f.delta >= 0 ? "tag-bull" : "tag-bear";
        return `<div class="pi"><span class="tag ${tag}">Δ ${d}</span><span class="txt">${ts} · bid ${Math.round(f.bid)} · ask ${Math.round(f.ask)} · vol ${Math.round(f.volume)} · ${f.close.toFixed(2)}</span></div>`;
      }).join("") + `<div class="empty" style="border:0">Approx footprint (direction-split tick volume — not true bid/ask prints)</div>`;
    }
  }
  try { profileChart.timeScale().fitContent() } catch {}
  requestAnimationFrame(drawProfileOverlay);
}

async function loadProfilePanel(){
  initProfileChart();
  const list = $("listProfile");
  if (list) list.innerHTML = '<div class="empty">Loading ' + profileGran + "…</div>";
  try {
    const r = await fetch(`/api/candles?granularity=${profileGran}&count=300&instrument=${encodeURIComponent(typeof currentInstrument !== "undefined" ? currentInstrument : "XAU_USD")}`);
    if (!r.ok) throw new Error("candles " + r.status);
    const data = await r.json();
    profileData = data.map(c => ({
      time: c.time, open: c.open, high: c.high, low: c.low, close: c.close,
      volume: c.volume != null ? c.volume : (c.v != null ? c.v : 0)
    }));
    applyProfileMode();
  } catch (e) {
    if (list) list.innerHTML = '<div class="empty">Failed to load profile data</div>';
  }
}

function refreshProfileChart(){ loadProfilePanel() }
