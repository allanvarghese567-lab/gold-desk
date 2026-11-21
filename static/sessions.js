/* Session background bands on main chart — IST hours */
/* Asian 04:00–12:00 · London 12:30–21:00 · New York 18:30–03:00 · Overlap 18:30–21:00 IST */
const SESSION_COLORS = {
  asian:   { fill: "rgba(90, 140, 200, 0.12)",  stroke: "rgba(90, 140, 200, 0.35)",  label: "Asia" },
  london:  { fill: "rgba(31, 138, 91, 0.10)",   stroke: "rgba(31, 138, 91, 0.30)",   label: "London" },
  ny:      { fill: "rgba(200, 64, 58, 0.10)",    stroke: "rgba(200, 64, 58, 0.30)",    label: "NY" },
  overlap: { fill: "rgba(224, 176, 74, 0.16)",   stroke: "rgba(224, 176, 74, 0.45)",   label: "Overlap" }
};

function istParts(unixSec) {
  const d = new Date(unixSec * 1000 + 5.5 * 3600 * 1000);
  return {
    h: d.getUTCHours(),
    m: d.getUTCMinutes(),
    dayKey: d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
  };
}

function minutesIST(unixSec) {
  const p = istParts(unixSec);
  return p.h * 60 + p.m;
}

function sessionAt(unixSec) {
  const m = minutesIST(unixSec);
  if (m >= 18 * 60 + 30 && m < 21 * 60) return "overlap";
  if (m >= 18 * 60 + 30 || m < 3 * 60) return "ny";
  if (m >= 12 * 60 + 30 && m < 21 * 60) return "london";
  if (m >= 4 * 60 && m < 12 * 60) return "asian";
  if (m >= 3 * 60 && m < 4 * 60) return "asian";
  if (m >= 12 * 60 && m < 12 * 60 + 30) return "london";
  return null;
}

function ensureSessionOverlay() {
  const host = $("chart");
  if (!host) return null;
  host.style.position = host.style.position || "relative";
  let cv = host.querySelector("canvas.session-overlay");
  if (!cv) {
    cv = document.createElement("canvas");
    cv.className = "session-overlay";
    cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;";
    host.appendChild(cv);
  }
  return cv;
}

function buildSessionSegments(data) {
  if (!data || data.length < 2) return [];
  const segs = [];
  let cur = sessionAt(data[0].time);
  let start = data[0].time;
  for (let i = 1; i < data.length; i++) {
    const s = sessionAt(data[i].time);
    if (s !== cur) {
      if (cur) segs.push({ session: cur, t0: start, t1: data[i - 1].time });
      cur = s;
      start = data[i].time;
    }
  }
  if (cur) segs.push({ session: cur, t0: start, t1: data[data.length - 1].time });
  return segs;
}

let sessionLastData = [];

function drawSessionBands() {
  const cv = ensureSessionOverlay();
  if (!cv || typeof chart === "undefined" || !chart) return;
  const host = $("chart");
  const rect = host.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.floor(rect.width * dpr));
  cv.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const data = sessionLastData;
  if (!data.length) return;
  const segs = buildSessionSegments(data);
  const ts = chart.timeScale();

  segs.forEach(seg => {
    const col = SESSION_COLORS[seg.session];
    if (!col) return;
    const x1 = ts.timeToCoordinate(seg.t0);
    const x2 = ts.timeToCoordinate(seg.t1);
    if (x1 == null && x2 == null) return;
    const left = Math.min(x1 != null ? x1 : x2, x2 != null ? x2 : x1);
    const right = Math.max(x1 != null ? x1 : x2, x2 != null ? x2 : x1);
    const w = Math.max(2, right - left + 2);
    ctx.fillStyle = col.fill;
    ctx.fillRect(left, 0, w, rect.height);
    ctx.strokeStyle = col.stroke;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left + 0.5, 0);
    ctx.lineTo(left + 0.5, rect.height);
    ctx.stroke();
  });

  const keys = ["asian", "london", "overlap", "ny"];
  let lx = 8, ly = 8;
  ctx.font = "11px system-ui,sans-serif";
  keys.forEach(k => {
    const c = SESSION_COLORS[k];
    ctx.fillStyle = c.fill.replace(/[\d.]+\)$/, "0.55)");
    ctx.fillRect(lx, ly, 12, 12);
    ctx.strokeStyle = c.stroke;
    ctx.strokeRect(lx + 0.5, ly + 0.5, 11, 11);
    ctx.fillStyle = "rgba(161,149,122,0.95)";
    ctx.fillText(c.label, lx + 16, ly + 10);
    lx += 16 + ctx.measureText(c.label).width + 14;
  });
}

function applySessionBands(data) {
  sessionLastData = data || [];
  drawSessionBands();
  setTimeout(drawSessionBands, 40);
  setTimeout(drawSessionBands, 200);
}

function initSessionBands() {
  if (typeof chart === "undefined" || !chart) return;
  chart.timeScale().subscribeVisibleTimeRangeChange(() => drawSessionBands());
  window.addEventListener("resize", () => drawSessionBands());
}

function refreshSessionBands() {
  if (typeof candleData !== "undefined" && candleData && candleData.length) {
    applySessionBands(candleData);
  }
}
