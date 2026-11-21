/* Live price resilience: reconnect SSE + REST/candle fallback */
(function(){
  if (typeof series === "undefined" || typeof currentInstrument === "undefined") return;
  let es = null, lastTickAt = 0;
  function snapLocal(t){ return typeof snap === "function" ? snap(t) : t; }
  function apply(d){
    if (d.instrument && d.instrument !== currentInstrument) return;
    const t = snapLocal(d.t), dp = priceDecimals(currentInstrument);
    const priceEl = document.getElementById("price");
    const spreadEl = document.getElementById("spread");
    if (priceEl) {
      priceEl.textContent = Number(d.mid).toFixed(dp);
      if (typeof prev !== "undefined") {
        priceEl.className = prev === null ? "" : (d.mid > prev ? "up" : "down");
        prev = d.mid;
      }
    }
    if (spreadEl) {
      const spr = (d.ask != null && d.bid != null)
        ? ((d.ask - d.bid).toFixed(Math.min(dp, 5)) + " spread · ")
        : "";
      spreadEl.textContent = spr + instrumentLabel(currentInstrument) + " · live";
    }
    try {
      if (typeof last !== "undefined" && last && last.time === t) {
        last.high = Math.max(last.high, d.mid);
        last.low = Math.min(last.low, d.mid);
        last.close = d.mid;
      } else if (typeof last !== "undefined") {
        last = { time: t, open: d.mid, high: d.mid, low: d.mid, close: d.mid };
      }
      if (last) series.update(last);
    } catch (e) {}
  }
  function connect(){
    try { if (es) es.close(); } catch (e) {}
    es = new EventSource("/stream");
    es.addEventListener("tick", function(ev){
      try { const d = JSON.parse(ev.data); lastTickAt = Date.now(); apply(d); } catch (e) {}
    });
    es.onerror = function(){ setTimeout(connect, 3000); };
  }
  connect();
  setInterval(async function(){
    if (Date.now() - lastTickAt < 4000) return;
    try {
      let r = await fetch("/api/pricing?instrument=" + encodeURIComponent(currentInstrument));
      if (r.ok) { apply(await r.json()); return; }
      r = await fetch("/api/candles?granularity=M1&count=1&instrument=" + encodeURIComponent(currentInstrument));
      if (!r.ok) return;
      const arr = await r.json();
      if (!arr.length) return;
      const c = arr[arr.length - 1];
      apply({ instrument: currentInstrument, mid: c.close, bid: c.close, ask: c.close, t: c.time });
    } catch (e) {}
  }, 5000);
})();
