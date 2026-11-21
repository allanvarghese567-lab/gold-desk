/* Trader education tables + live IST session highlight */
(function(){
  const root = document.getElementById("eduMount");
  if (!root) return;

  root.innerHTML = `
  <section class="edu-section" id="eduSection">
    <h2 class="sec">Trader education · India (IST) · bias not prediction</h2>
    <p class="edu-note"><strong>No one can predict price.</strong> “Prediction” means a directional bias that confirmations validate. Ranges are typical, not guarantees. Education only — not financial advice. Test on demo first.</p>
    <div class="edu-live" id="eduLive">
      <span>IST now: <span class="clock" id="eduClock">--:--:--</span></span>
      <span class="sess" data-sess="asian">Asian</span>
      <span class="sess" data-sess="london">London</span>
      <span class="sess" data-sess="ny">New York</span>
      <span class="sess" data-sess="overlap">London–NY overlap</span>
    </div>
    <div class="edu-h">Table 1 · Trading style</div>
    <div class="edu-table-wrap"><table class="edu-table">
      <thead><tr><th>Style</th><th>Timeframes</th><th>Best session</th><th>Bias (prediction)</th><th>Confirmation</th><th>Buy / Sell</th><th>Win rate / RR</th></tr></thead>
      <tbody>
        <tr><td>Scalping</td><td>M1–M5</td><td>London, NY, overlap</td><td>Micro structure / order flow</td><td>1–2 (delta, OB wick)</td><td><span class="buy">Buy:</span> bid absorb + hold VAL/OB<br><span class="sell">Sell:</span> ask absorb + reject VAH/OB</td><td>~45–55% · 1:1–1:1.5</td></tr>
        <tr><td>Day trading</td><td>M5–H1</td><td>London open, overlap</td><td>Intraday BOS / session liquidity</td><td>2–3 (BOS, FVG/OB, session level)</td><td><span class="buy">Buy:</span> discount + bull OB/FVG after sweep<br><span class="sell">Sell:</span> premium + bear OB/FVG after sweep</td><td>~40–55% · 1:1.5–1:3</td></tr>
        <tr><td>Swing trading</td><td>H1–D</td><td>Any; plan London/NY close</td><td>HTF structure + value shift</td><td>3+ (HTF BOS, OB, VA/POC)</td><td><span class="buy">Buy:</span> HTF discount + bull OB retest<br><span class="sell">Sell:</span> HTF premium + bear OB retest</td><td>~35–50% · 1:2–1:4</td></tr>
        <tr><td>Position trading</td><td>D–W</td><td>Weekly open / major data</td><td>Macro + weekly value</td><td>3–4 HTF only</td><td><span class="buy">Buy:</span> weekly discount + shift up<br><span class="sell">Sell:</span> weekly premium + shift down</td><td>~30–45% · 1:3–1:6+</td></tr>
      </tbody>
    </table></div>
    <div class="edu-h">Table 2 · Sessions (IST)</div>
    <div class="edu-table-wrap"><table class="edu-table" id="eduSessionTable">
      <thead><tr><th>Session</th><th>Time in IST</th><th>Character</th><th>Best for</th><th>Buy / Sell</th></tr></thead>
      <tbody>
        <tr data-sess="asian"><td>Asian</td><td>05:30 – 12:30</td><td>Range, thinner gold</td><td>Range fades, level mapping</td><td><span class="buy">Buy:</span> Asia low hold<br><span class="sell">Sell:</span> Asia high reject</td></tr>
        <tr data-sess="london"><td>London</td><td>12:30 – 21:00</td><td>Breakouts, liquidity runs</td><td>Day trades, OB/FVG</td><td><span class="buy">Buy:</span> open sweep low → BOS up<br><span class="sell">Sell:</span> sweep high → BOS down</td></tr>
        <tr data-sess="ny"><td>New York</td><td>18:30 – 01:30+1</td><td>Trend or reversal</td><td>USD data, gold legs</td><td><span class="buy">Buy:</span> NY continuation after London BOS<br><span class="sell">Sell:</span> NY reject London high</td></tr>
        <tr data-sess="overlap"><td>London–NY overlap</td><td>18:30 – 21:00</td><td>Highest volume</td><td>A+ day trades / scalps</td><td><span class="buy">Buy:</span> hold above POC/VAL<br><span class="sell">Sell:</span> fail VAH + delta fade</td></tr>
      </tbody>
    </table></div>
    <div class="edu-h">Table 3 · Trade every day vs A+ setup</div>
    <div class="edu-table-wrap"><table class="edu-table">
      <thead><tr><th></th><th>Trade every day</th><th>A+ setup only</th></tr></thead>
      <tbody>
        <tr><td>Trades per day/week</td><td>1–5 / day</td><td>0–3 / week</td></tr>
        <tr><td>Confirmations</td><td>1–2</td><td>3–5 stacked</td></tr>
        <tr><td>Buy</td><td>First bull signal in session</td><td>HTF discount + sweep + OB + FVG</td></tr>
        <tr><td>Sell</td><td>First bear signal in session</td><td>HTF premium + sweep + OB + FVG</td></tr>
        <tr><td>Win rate / RR</td><td>~40–50% · ~1:1.5</td><td>~45–60% · ~1:2–1:4</td></tr>
        <tr><td>Verdict</td><td>More noise, higher cost</td><td>Fewer trades, better expectancy</td></tr>
      </tbody>
    </table></div>
    <div class="edu-h">Table 4 · High win rate vs high RR</div>
    <div class="edu-table-wrap"><table class="edu-table">
      <thead><tr><th>Focus</th><th>How</th><th>Buy / Sell</th><th>Cost</th></tr></thead>
      <tbody>
        <tr><td>High win rate</td><td>Tight targets, mean-revert to POC/VA</td><td><span class="buy">Buy:</span> fade VAL/POC<br><span class="sell">Sell:</span> fade VAH/POC</td><td>Small RR; one loss needs many wins</td></tr>
        <tr><td>High RR</td><td>Wait displacement; trail to HTF liquidity</td><td><span class="buy">Buy:</span> break + retest bull OB<br><span class="sell">Sell:</span> break + retest bear OB</td><td>Lower win rate; dry spells</td></tr>
        <tr><td>Both</td><td>A+ only; partial 1R, runner 3R+</td><td><span class="buy">Buy:</span> full confluence long<br><span class="sell">Sell:</span> full confluence short</td><td>Patience; fewer fills</td></tr>
      </tbody>
    </table></div>
    <div class="edu-expect">
      <strong>Reality check — expectancy</strong><br>
      Expectancy ≈ (win rate × RR) − (loss rate × 1). Example: 45% at 2R → (0.45×2) − (0.55×1) = +0.35R/trade. High win rate with 0.8R can still lose; high RR with 30% wins can still win. The IST clock only marks the active session — it does not predict direction.
    </div>
  </section>`;

  function updateEduClock(){
    try{
      const fmt = new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kolkata",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
      const parts = new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kolkata",hour:"2-digit",minute:"2-digit",hour12:false,hourCycle:"h23"}).formatToParts(new Date());
      const hh = +(parts.find(p=>p.type==="hour")||{}).value;
      const mm = +(parts.find(p=>p.type==="minute")||{}).value;
      const mins = hh*60+mm;
      const clock = document.getElementById("eduClock");
      if (clock) clock.textContent = fmt.format(new Date()) + " IST";
      const inAsian = mins >= 5*60+30 && mins < 12*60+30;
      const inLondon = mins >= 12*60+30 && mins < 21*60;
      const inNY = mins >= 18*60+30 || mins < 1*60+30;
      const inOverlap = mins >= 18*60+30 && mins < 21*60;
      document.querySelectorAll(".edu-live .sess").forEach(el=>{
        const k = el.dataset.sess;
        const on = k==="asian"?inAsian:k==="london"?inLondon:k==="ny"?inNY:k==="overlap"?inOverlap:false;
        el.classList.toggle("on", !!on);
      });
      document.querySelectorAll("#eduSessionTable tr[data-sess]").forEach(tr=>{
        const k = tr.dataset.sess;
        const on = k==="asian"?inAsian:k==="london"?inLondon:k==="ny"?inNY:k==="overlap"?inOverlap:false;
        tr.classList.toggle("active-row", !!on);
      });
    }catch(e){}
  }
  setInterval(updateEduClock, 1000);
  updateEduClock();
})();
