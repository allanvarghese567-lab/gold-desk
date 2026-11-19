import asyncio, json, os, time
from contextlib import asynccontextmanager

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from confirmation_engine import (
    DEFAULT_RULE,
    SIGNALS,
    atr_series,
    eval_rule,
    run_all,
)

load_dotenv()
TOKEN = os.getenv("OANDA_TOKEN", "")
ACCOUNT = os.getenv("OANDA_ACCOUNT", "")
SECRET = os.getenv("TV_WEBHOOK_SECRET", "")
ENV = os.getenv("OANDA_ENV", "practice")
REST = "https://api-fxpractice.oanda.com" if ENV == "practice" else "https://api-fxtrade.oanda.com"
STREAM = "https://stream-fxpractice.oanda.com" if ENV == "practice" else "https://stream-fxtrade.oanda.com"
INSTRUMENT = "XAU_USD"
FF_FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
HEAD = {"Authorization": f"Bearer {TOKEN}", "Accept-Datetime-Format": "UNIX"}

subscribers: set[asyncio.Queue] = set()
signals: list[dict] = []
news_cache = {"at": 0.0, "data": []}


def publish(kind: str, payload: dict):
    msg = f"event: {kind}\ndata: {json.dumps(payload)}\n\n"
    for q in list(subscribers):
        if q.full():
            continue
        q.put_nowait(msg)


async def price_stream():
    """Keep one streaming connection to OANDA and fan ticks out to browsers."""
    url = f"{STREAM}/v3/accounts/{ACCOUNT}/pricing/stream"
    while True:
        try:
            async with httpx.AsyncClient(timeout=None) as c:
                async with c.stream("GET", url, headers=HEAD, params={"instruments": INSTRUMENT}) as r:
                    r.raise_for_status()
                    async for line in r.aiter_lines():
                        if not line:
                            continue
                        d = json.loads(line)
                        if d.get("type") != "PRICE" or not d.get("bids") or not d.get("asks"):
                            continue
                        bid, ask = float(d["bids"][0]["price"]), float(d["asks"][0]["price"])
                        publish("tick", {"t": int(time.time()), "bid": bid, "ask": ask, "mid": round((bid + ask) / 2, 3)})
        except Exception as e:
            print("stream error, retrying in 5s:", e)
            await asyncio.sleep(5)


@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(price_stream()) if TOKEN else None
    if not TOKEN:
        print("OANDA_TOKEN missing: copy .env.example to .env and fill it in.")
    yield
    if task:
        task.cancel()


app = FastAPI(lifespan=lifespan)


async def fetch_oanda_bars(granularity: str = "M15", count: int = 300):
    """OHLCV bars for the confirmation engine (volume = OANDA candle volume / tick volume)."""
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(
            f"{REST}/v3/instruments/{INSTRUMENT}/candles",
            headers=HEAD,
            params={"granularity": granularity, "count": min(count, 1000), "price": "M"},
        )
    if r.status_code != 200:
        raise HTTPException(502, r.text)
    bars = []
    for k in r.json().get("candles", []):
        m = k["mid"]
        bars.append({
            "o": float(m["o"]),
            "h": float(m["h"]),
            "l": float(m["l"]),
            "c": float(m["c"]),
            "v": float(k.get("volume") or 0),
            "oi": None,
            "time": int(float(k["time"])),
        })
    return bars


@app.get("/api/candles")
async def candles(granularity: str = "M15", count: int = 500):
    if granularity not in {"M1", "M5", "M15", "H1", "H4", "D"}:
        raise HTTPException(400, "bad granularity")
    bars = await fetch_oanda_bars(granularity, count)
    return [
        {"time": b["time"], "open": b["o"], "high": b["h"], "low": b["l"], "close": b["c"]}
        for b in bars
    ]


@app.get("/api/news")
async def news():
    """Forex Factory weekly feed, cached 15 min. Gold reacts to USD, so USD events only."""
    if time.time() - news_cache["at"] > 900:
        try:
            async with httpx.AsyncClient(timeout=15) as c:
                r = await c.get(FF_FEED, headers={"User-Agent": "Mozilla/5.0"})
            r.raise_for_status()
            news_cache.update(at=time.time(), data=r.json())
        except Exception as e:
            if not news_cache["data"]:
                raise HTTPException(502, f"feed unavailable: {e}")
    return [e for e in news_cache["data"] if e.get("country") == "USD"]


@app.post("/webhook/tv")
async def tv_webhook(req: Request):
    """TradingView alert message example:
    {\"secret\":\"change-me\",\"side\":\"buy\",\"price\":\"{{close}}\",\"note\":\"RSI cross\",\"tf\":\"{{interval}}\"}"""
    body = await req.json()
    if SECRET and body.get("secret") != SECRET:
        raise HTTPException(401, "bad secret")
    body.pop("secret", None)
    body["t"] = int(time.time())
    signals.insert(0, body)
    del signals[50:]
    publish("signal", body)
    return {"ok": True}


@app.get("/api/signals")
async def get_signals():
    return signals


@app.get("/api/confirm")
async def confirm(
    side: str = Query("long", pattern="^(long|short)$"),
    granularity: str = Query("M15"),
    rule: str = Query(None),
    stop_atr: float = Query(2.0, ge=0.3, le=5.0),
    rr: float = Query(2.0, ge=1.0, le=10.0),
):
    """Run the confirmation engine on live OANDA XAU_USD bars."""
    if granularity not in {"M5", "M15", "H1", "H4", "D"}:
        raise HTTPException(400, "granularity must be M5, M15, H1, H4, or D")
    if not TOKEN:
        raise HTTPException(503, "OANDA_TOKEN not configured")

    bars = await fetch_oanda_bars(granularity, 300)
    if len(bars) < 60:
        raise HTTPException(502, "not enough candles from OANDA")

    atr = atr_series(bars)[-1]
    if not atr or atr <= 0:
        raise HTTPException(502, "ATR unavailable")

    entry = bars[-1]["c"]
    s = 1 if side == "long" else -1
    stop = entry - s * stop_atr * atr
    target = entry + s * rr * stop_atr * atr
    ctx = {"entry": entry, "stop": stop, "target": target}

    use_rule = rule or DEFAULT_RULE
    try:
        results = run_all(bars, s, ctx)
        decision = eval_rule(use_rule, results)
    except ValueError as e:
        raise HTTPException(400, str(e))

    total_w = sum(w for (_, _, _, w) in SIGNALS.values())
    got_w = sum(SIGNALS[c][3] for c, v in results.items() if v)
    cats = sorted({c.split("_")[0] for c, v in results.items() if v and not c.startswith("R_")})

    checks = [
        {
            "code": code,
            "ok": bool(results[code]),
            "desc": SIGNALS[code][1],
            "weight": SIGNALS[code][3],
            "category": code.split("_")[0],
        }
        for code in SIGNALS
    ]

    return {
        "side": side,
        "granularity": granularity,
        "entry": round(entry, 3),
        "stop": round(stop, 3),
        "target": round(target, 3),
        "atr": round(atr, 3),
        "stop_atr": stop_atr,
        "rr": rr,
        "rule": use_rule,
        "decision": "ENTER" if decision else "WAIT",
        "score": round(got_w, 2),
        "score_max": round(total_w, 2),
        "score_pct": round(100 * got_w / total_w, 1) if total_w else 0,
        "categories": cats,
        "checks": checks,
        "bar_count": len(bars),
        "bar_time": bars[-1]["time"],
    }


@app.get("/api/confirm/codes")
async def confirm_codes():
    """List available confirmation codes and the default rule."""
    return {
        "default_rule": DEFAULT_RULE,
        "codes": [
            {"code": code, "desc": desc, "need": need, "weight": weight, "category": code.split("_")[0]}
            for code, (_, desc, need, weight) in SIGNALS.items()
        ],
    }


@app.get("/stream")
async def stream(req: Request):
    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    subscribers.add(q)

    async def gen():
        try:
            while not await req.is_disconnected():
                try:
                    yield await asyncio.wait_for(q.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            subscribers.discard(q)

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/")
async def index():
    return FileResponse("static/index.html")


app.mount("/static", StaticFiles(directory="static"), name="static")
