/* --- Candlestick pattern analysis charts --- */
let miniSingle, miniDual, miniMulti;
function mkMiniChart(el){
  const c=LightweightCharts.createChart(el,{
    autoSize:true,
    layout:{background:{color:"transparent"},textColor:dark?"#a1957a":"#7a6f58"},
    grid:{vertLines:{color:dark?"#26200f":"#eee6d2"},horzLines:{color:dark?"#26200f":"#eee6d2"}},
    timeScale:{timeVisible:true,secondsVisible:false},
    rightPriceScale:{borderVisible:false},
    crosshair:{mode:0}
  });
  const s=c.addCandlestickSeries({upColor:"#1f8a5b",downColor:"#c8403a",borderVisible:false,wickUpColor:"#1f8a5b",wickDownColor:"#c8403a"});
  return {chart:c,series:s};
}
function initPatternCharts(){
  if(miniSingle) return;
  miniSingle=mkMiniChart($("chartSingle"));
  miniDual=mkMiniChart($("chartDual"));
  miniMulti=mkMiniChart($("chartMulti"));
}

function body(c){return Math.abs(c.close-c.open)}
function range(c){return Math.max(c.high-c.low,1e-9)}
function isBull(c){return c.close>=c.open}
function upperWick(c){return c.high-Math.max(c.open,c.close)}
function lowerWick(c){return Math.min(c.open,c.close)-c.low}

function detectSingle(data){
  const out=[];
  const n=data.length;
  for(let i=Math.max(0,n-80);i<n;i++){
    const c=data[i], b=body(c), r=range(c), uw=upperWick(c), lw=lowerWick(c);
    if(b/r<0.1 && uw>0 && lw>0) out.push({i,time:c.time,name:"Doji",bias:"neutral",note:"indecision"});
    else if(lw>=2*b && uw<=b && b/r<0.35) out.push({i,time:c.time,name:"Hammer",bias:"bull",note:"long lower wick rejection"});
    else if(uw>=2*b && lw<=b && b/r<0.35) out.push({i,time:c.time,name:"Shooting star",bias:"bear",note:"long upper wick rejection"});
    else if(b/r>0.9) out.push({i,time:c.time,name:"Marubozu",bias:isBull(c)?"bull":"bear",note:"strong one-sided bar"});
    else if(b/r<0.3 && uw>b && lw>b) out.push({i,time:c.time,name:"Spinning top",bias:"neutral",note:"weak conviction"});
  }
  return out.slice(-12);
}

function detectDual(data){
  const out=[];
  const n=data.length;
  for(let i=Math.max(1,n-80);i<n;i++){
    const a=data[i-1], b=data[i];
    const aBull=isBull(a), bBull=isBull(b);
    if(!aBull && bBull && b.open<=a.close && b.close>=a.open && body(b)>body(a))
      out.push({i,time:b.time,name:"Bull engulfing",bias:"bull",note:"buyers cover prior down bar"});
    if(aBull && !bBull && b.open>=a.close && b.close<=a.open && body(b)>body(a))
      out.push({i,time:b.time,name:"Bear engulfing",bias:"bear",note:"sellers cover prior down bar"});
    if(Math.abs(a.low-b.low)/range(a)<0.08 && !aBull && bBull)
      out.push({i,time:b.time,name:"Tweezer bottom",bias:"bull",note:"matched lows"});
    if(Math.abs(a.high-b.high)/range(a)<0.08 && aBull && !bBull)
      out.push({i,time:b.time,name:"Tweezer top",bias:"bear",note:"matched highs"});
    if(b.high<=a.high && b.low>=a.low)
      out.push({i,time:b.time,name:"Inside bar",bias:"neutral",note:"compression inside mother bar"});
    if(!aBull && bBull && b.open<a.close && b.close>(a.open+a.close)/2 && b.close<a.open)
      out.push({i,time:b.time,name:"Piercing",bias:"bull",note:"reclaim into prior body"});
    if(aBull && !bBull && b.open>a.close && b.close<(a.open+a.close)/2 && b.close>a.open)
      out.push({i,time:b.time,name:"Dark cloud",bias:"bear",note:"reject into prior body"});
  }
  return out.slice(-12);
}

function detectMulti(data){
  const out=[];
  const n=data.length;
  for(let i=Math.max(2,n-80);i<n;i++){
    const a=data[i-2], b=data[i-1], c=data[i];
    if(!isBull(a) && body(b)<body(a)*0.6 && isBull(c) && c.close>(a.open+a.close)/2)
      out.push({i,time:c.time,name:"Morning star",bias:"bull",note:"3-bar bottom sequence"});
    if(isBull(a) && body(b)<body(a)*0.6 && !isBull(c) && c.close<(a.open+a.close)/2)
      out.push({i,time:c.time,name:"Evening star",bias:"bear",note:"3-bar top sequence"});
    if(isBull(a)&&isBull(b)&&isBull(c) && c.close>b.close && b.close>a.close && body(a)>range(a)*0.5)
      out.push({i,time:c.time,name:"Three soldiers",bias:"bull",note:"three strong up closes"});
    if(!isBull(a)&&!isBull(b)&&!isBull(c) && c.close<b.close && b.close<a.close && body(a)>range(a)*0.5)
      out.push({i,time:c.time,name:"Three crows",bias:"bear",note:"three strong down closes"});
  }
  for(let i=Math.max(4,n-80);i<n;i++){
    const w=data.slice(i-4,i+1);
    const first=w[0], last=w[4], mid=w.slice(1,4);
    const midSmall=mid.every(m=>body(m)<body(first)*0.7);
    if(isBull(first)&&isBull(last)&&last.close>first.close&&midSmall&&mid.every(m=>m.close<=first.close))
      out.push({i,time:last.time,name:"Rising three",bias:"bull",note:"continuation after pause"});
    if(!isBull(first)&&!isBull(last)&&last.close<first.close&&midSmall&&mid.every(m=>m.close>=first.close))
      out.push({i,time:last.time,name:"Falling three",bias:"bear",note:"continuation after pause"});
  }
  return out.slice(-12);
}

function patternMarkers(list){
  return list.map(p=>({
    time:p.time,
    position: p.bias==="bull"?"belowBar":"aboveBar",
    shape: p.bias==="bull"?"arrowUp":(p.bias==="bear"?"arrowDown":"circle"),
    color: p.bias==="bull"?"#1f8a5b":(p.bias==="bear"?"#c8403a":"#8a5a00"),
    text: p.name
  })).sort((a,b)=>a.time-b.time);
}

function renderPatternList(el, list){
  if(!list.length){el.innerHTML='<div class="empty">No recent patterns in view.</div>';return}
  el.innerHTML=list.slice().reverse().map(p=>
    `<div class="pi"><span class="tag tag-${p.bias}">${esc(p.name)}</span><span class="txt">${esc(p.note)}</span></div>`
  ).join("");
}

function updatePatternCharts(data){
  initPatternCharts();
  if(!data||data.length<10) return;
  const view=data.slice(-120);
  const singles=detectSingle(view);
  const duals=detectDual(view);
  const multis=detectMulti(view);
  miniSingle.series.setData(view); miniSingle.series.setMarkers(patternMarkers(singles));
  miniDual.series.setData(view); miniDual.series.setMarkers(patternMarkers(duals));
  miniMulti.series.setData(view); miniMulti.series.setMarkers(patternMarkers(multis));
  renderPatternList($("listSingle"), singles);
  renderPatternList($("listDual"), duals);
  renderPatternList($("listMulti"), multis);
  try{miniSingle.chart.timeScale().fitContent();miniDual.chart.timeScale().fitContent();miniMulti.chart.timeScale().fitContent()}catch{}
}
