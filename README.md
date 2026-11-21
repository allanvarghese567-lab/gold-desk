# Gold Desk

Live XAU/USD (and FX) desk: OANDA stream, confirmation engine, pattern/OB/profile panels, TradingView webhooks.

Public URL: https://gold-desk-ffm8.onrender.com/

## TradingView webhook logging

`POST /webhook/tv` accepts the same JSON as before. Each alert is:

1. Pushed to the live desk (SSE + in-memory list)
2. Appended to SQLite `data/golddesk.db` → table `tv_webhook_log`
3. If `side` + `price` are present → opens a **draft journal** row (`status=open`, `source=tv`)

### Endpoints

- `GET /api/webhook/logs` — persistent webhook log
- `GET /api/journal` — journal rows (including TV drafts)
- `GET /api/signals` — recent signals (memory, else log)

### Example TV alert message

```json
{
  "secret": "your-TV_WEBHOOK_SECRET",
  "side": "buy",
  "price": "{{close}}",
  "instrument": "XAUUSD",
  "tf": "{{interval}}",
  "note": "OB + FVG"
}
```

### Note on Render disk

SQLite lives under `data/`. On free Render, the filesystem can reset on redeploy — treat this as a durable log for the life of the instance, or move to Supabase later for permanent history.
