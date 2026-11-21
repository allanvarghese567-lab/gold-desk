/* Simple education tables + live IST session highlight */
(function(){
  const root = document.getElementById("eduMount");
  if (!root) return;

  root.innerHTML = `
  <section class="edu-section" id="eduSection">
    <h2 class="sec">Trading basics · India time (IST)</h2>
    <p class="edu-note">
      <strong>No one can know the next price for sure.</strong>
      A “bias” only means “lean buy or lean sell” until other checks agree.
      Numbers below are typical ranges, not promises.
      This is learning material, not advice. Practice on a demo account first.
    </p>
    <div class="edu-live" id="eduLive">
      <span>India time now: <span class="clock" id="eduClock">--:--:--</span></span>
      <span class="sess" data-sess="asian">Asia market</span>
      <span class="sess" data-sess="london">London market</span>
      <span class="sess" data-sess="ny">New York market</span>
      <span class="sess" data-sess="overlap">London + New York together</span>
    </div>

    <div class="edu-h">Table 1 · How long you hold a trade</div>
    <div class="edu-table-wrap"><table class="edu-table">
      <thead>
        <tr>
          <th>Style</th>
          <th>What it means</th>
          <th>Chart speed</th>
          <th>Best market hours (IST)</th>
          <th>Buy means / Sell means</th>
          <th>How often you may be right / reward vs risk</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Scalping</td>
          <td>Very fast trades, seconds to minutes</td>
          <td>1–5 min charts</td>
          <td>London, New York, or both open</td>
          <td><span class="buy">Buy:</span> price holds a low and turns up<br><span class="sell">Sell:</span> price fails a high and turns down</td>
          <td>About half the time right · small profit target vs small stop</td>
        </tr>
        <tr>
          <td>Day trading</td>
          <td>Open and close the same day</td>
          <td>5 min–1 hour charts</td>
          <td>London open, or London+NY together</td>
          <td><span class="buy">Buy:</span> after a dip in a rising move<br><span class="sell">Sell:</span> after a bounce in a falling move</td>
          <td>Often under half right · aim for more reward than risk</td>
        </tr>
        <tr>
          <td>Swing trading</td>
          <td>Hold hours to several days</td>
          <td>1 hour–daily charts</td>
          <td>Plan around London/NY close</td>
          <td><span class="buy">Buy:</span> support zone on higher chart holds<br><span class="sell">Sell:</span> resistance zone on higher chart fails</td>
          <td>Fewer wins needed if each win is larger</td>
        </tr>
        <tr>
          <td>Position trading</td>
          <td>Hold days to weeks</td>
          <td>Daily–weekly charts</td>
          <td>Around big news or weekly open</td>
          <td><span class="buy">Buy:</span> long-term uptrend pullback<br><span class="sell">Sell:</span> long-term downtrend bounce</td>
          <td>Fewer trades · larger targets</td>
        </tr>
      </tbody>
    </table></div>

    <div class="edu-h">Table 2 · World market sessions (India time)</div>
    <div class="edu-table-wrap"><table class="edu-table" id="eduSessionTable">
      <thead>
        <tr>
          <th>Session</th>
          <th>Time in IST</th>
          <th>What price often does</th>
          <th>Best use</th>
          <th>Buy means / Sell means</th>
        </tr>
      </thead>
      <tbody>
        <tr data-sess="asian">
          <td>Asia market</td>
          <td>05:30 – 12:30</td>
          <td>Quieter, more sideways</td>
          <td>Mark levels; smaller range trades</td>
          <td><span class="buy">Buy:</span> bounce from Asia low<br><span class="sell">Sell:</span> reject from Asia high</td>
        </tr>
        <tr data-sess="london">
          <td>London market</td>
          <td>12:30 – 21:00</td>
          <td>Breaks levels more often</td>
          <td>Day trades in gold and FX</td>
          <td><span class="buy">Buy:</span> sweeps a low then rises<br><span class="sell">Sell:</span> sweeps a high then falls</td>
        </tr>
        <tr data-sess="ny">
          <td>New York market</td>
          <td>18:30 – 01:30 next day</td>
          <td>Strong trends or sharp turns</td>
          <td>USD news; gold follow-through</td>
          <td><span class="buy">Buy:</span> continues London’s up move<br><span class="sell">Sell:</span> fails London’s high</td>
        </tr>
        <tr data-sess="overlap">
          <td>London + New York together</td>
          <td>18:30 – 21:00</td>
          <td>Busiest, biggest moves</td>
          <td>Best window for clear day setups</td>
          <td><span class="buy">Buy:</span> holds above a fair-price area<br><span class="sell">Sell:</span> fails above a high-value area</td>
        </tr>
      </tbody>
    </table></div>

    <div class="edu-h">Table 3 · Trading every day vs waiting for a clear setup</div>
    <div class="edu-table-wrap"><table class="edu-table">
      <thead>
        <tr><th></th><th>Trade almost every day</th><th>Only clear (A+) setups</th></tr>
      </thead>
      <tbody>
        <tr><td>How many trades</td><td>1–5 per day</td><td>0–3 per week</td></tr>
        <tr><td>How many checks before entry</td><td>1–2</td><td>3–5 things agree</td></tr>
        <tr><td>Buy means</td><td>First “go up” signal in the session</td><td>Dip in value area + support + clear turn up</td></tr>
        <tr><td>Sell means</td><td>First “go down” signal in the session</td><td>Rally in expensive area + resistance + clear turn down</td></tr>
        <tr><td>Being right / size of win</td><td>About 40–50% right · smaller wins</td><td>Often better quality · larger wins when right</td></tr>
        <tr><td>Simple verdict</td><td>More noise, more fees, more stress</td><td>Fewer trades, easier to manage</td></tr>
      </tbody>
    </table></div>

    <div class="edu-h">Table 4 · High win rate vs big reward</div>
    <div class="edu-table-wrap"><table class="edu-table">
      <thead>
        <tr>
          <th>Focus</th>
          <th>Plain meaning</th>
          <th>Buy means / Sell means</th>
          <th>Trade-off</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>High win rate</td>
          <td>Many small wins; take profit quickly near “fair price”</td>
          <td><span class="buy">Buy:</span> fade a dip toward fair price<br><span class="sell">Sell:</span> fade a spike toward fair price</td>
          <td>One loss can wipe several small wins</td>
        </tr>
        <tr>
          <td>High reward vs risk</td>
          <td>Fewer wins, but each win aims for 2–3× what you risk</td>
          <td><span class="buy">Buy:</span> break + retest of support<br><span class="sell">Sell:</span> break + retest of resistance</td>
          <td>Long waiting periods and losing streaks feel harder</td>
        </tr>
        <tr>
          <td>Balanced</td>
          <td>Wait for clear setup; bank some profit early, let rest run</td>
          <td><span class="buy">Buy:</span> only when several checks agree long<br><span class="sell">Sell:</span> only when several checks agree short</td>
          <td>Needs patience; fewer fills</td>
        </tr>
      </tbody>
    </table></div>

    <div class="edu-expect">
      <strong>Simple money math (expectancy)</strong><br>
      Average result per trade ≈ (how often you win × average win size) − (how often you lose × average loss size).<br>
      Example: win 45% of the time, and wins are about 2× the size of losses → you still come out ahead on average.<br>
      High win rate with tiny targets can still lose money. Low win rate with larger targets can still work.<br>
      The green session lights only show <em>which market is open</em> — they do not say price will go up or down.<br><br>
      <strong>Word list</strong><br>
      <em>Bias</em> = lean buy or sell · <em>Stop</em> = planned exit if wrong · <em>Target</em> = planned take-profit<br>
      <em>Support</em> = area where buyers often step in · <em>Resistance</em> = area where sellers often step in<br>
      <em>Risk : reward</em> = how much you risk vs how much you aim to make · <em>Session</em> = which world market is open
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
