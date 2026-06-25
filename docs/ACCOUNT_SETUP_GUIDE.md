# Broker market-data setup — Zerodha Kite + Angel One SmartAPI

The app prefers **licensed broker feeds** and falls back to NSE/Yahoo only when no
broker is configured (and only when unlicensed fallbacks are allowed). Open the
broker accounts in **NIYTRI's** name. Both adapters support batched quotes
(`get_quotes_batch`) so the full NSE universe is fetched in a few requests.

The aggregator order is: **Kite → SmartAPI → Upstox → (NSE → Yahoo fallback)**.
Configure either or both; whichever is available is used, with automatic failover.

## Zerodha Kite Connect
1. Open a Zerodha demat+trading account (in NIYTRI's name).
2. Create a Kite Connect app at https://developer.kite.trade (paid plan ~Rs 500/mo
   per app for live + historical data).
3. You get an **API key** and **API secret**. The **access token** is generated
   from a daily login (request token -> access token) and **expires each day**.
4. Put in `backend/.env`:
   ```
   kite_api_key=YOUR_API_KEY
   kite_access_token=TODAYS_ACCESS_TOKEN
   ```
5. Daily token: automate the login (request-token -> session) each morning before
   the scoring run, or set it manually. (We can add a small daily auth helper.)

## Angel One SmartAPI  (free)
1. Open an Angel One account (in NIYTRI's name).
2. Register a SmartAPI app at https://smartapi.angelone.in -> get the **API key**.
3. Auth is TOTP-based (client code + MPIN/password + TOTP) -> returns a **JWT
   access token** valid ~1 day. This is fully automatable (TOTP secret) for a
   hands-off daily refresh.
4. Put in `backend/.env`:
   ```
   smartapi_key=YOUR_API_KEY
   smartapi_client_id=YOUR_CLIENT_CODE
   smartapi_access_token=TODAYS_JWT
   ```
5. Note: Angel keys quotes by **numeric instrument token**, not trading symbol.
   Once credentials exist we load Angel's instrument master and map symbol->token
   (one extra wiring step on first run).

## After configuring
- Restart backend: `sudo systemctl restart broking-backend`.
- Check `GET /api/v1/health` -> `market_data_providers` should list `kite` /
  `smartapi` ahead of `yahoo`.
- With a broker live, set `ALLOW_UNLICENSED_MARKET_DATA=false` in production to
  fully switch off the Yahoo/NSE fallbacks (compliant mode).

## Redistribution note
The free/paid API covers the account holder's own use. Showing real-time quotes to
**end users** is redistribution and may require an exchange data-licensing
agreement on top of the broker API — confirm with the broker / exchange before
commercial launch.
