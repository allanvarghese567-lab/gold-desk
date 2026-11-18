# Gold Desk (XAU/USD)

Live gold chart + Forex Factory red/orange/yellow USD news + TradingView alert signals.

**Live demo:** https://gold-desk-ffm8.onrender.com/

## Run locally
1. Get a free OANDA practice account, generate an API token (My Hub > Manage API Access).
2. `cp .env.example .env` and fill in OANDA_TOKEN and OANDA_ACCOUNT.
3. `pip install -r requirements.txt`
4. `uvicorn main:app --reload`
5. Open http://localhost:8000

## TradingView alerts (optional, needs a paid TradingView plan)
Webhooks need a public HTTPS URL. Use the live URL above or for local testing use `ngrok http 8000`.

In a TradingView alert set Webhook URL to:

```
https://gold-desk-ffm8.onrender.com/webhook/tv
```

and the message to:

```json
{"secret":"golddesk123","side":"buy","price":"{{close}}","note":"my setup","tf":"{{interval}}"}
```

Alerts appear in the Signals panel and as arrows on the chart.
