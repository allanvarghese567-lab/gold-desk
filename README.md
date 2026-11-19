# Gold Desk (XAU/USD)

Live gold chart + Forex Factory red/orange/yellow USD news + TradingView alert signals.

**Live demo:** https://gold-desk-ffm8.onrender.com/

## Run locally
1. Get a free OANDA practice account, generate an API token (My Hub > Manage API Access).
2. `cp .env.example .env` and fill in OANDA_TOKEN and OANDA_ACCOUNT.
3. `pip install -r requirements.txt`
4. `uvicorn main:app --reload`
5. Open http://localhost:8000

## TradingView alerts (optional)
Webhook URL (live):
```
https://gold-desk-ffm8.onrender.com/webhook/tv
```
Message example:
```json
{"secret":"golddesk123","side":"buy","price":"{{close}}","note":"my setup","tf":"{{interval}}"}
```

## Confirmation engine

Live checklist of price / volume / trend / momentum / volatility / multi-TF / risk filters on OANDA XAU/USD bars.

- API: `GET /api/confirm?side=long&granularity=M15`
- Codes list: `GET /api/confirm/codes`
- Default rule: `(P_CLOSE or P_RETEST) and CATS(3) and R_RR`

UI: sidebar panel → pick Long/Short + timeframe → **Run**.
