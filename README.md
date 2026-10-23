# Paper Trader

A rule-based trading bot that paper-trades US stocks and crypto on **Alpaca's paper account** using real market data, with a public read-only dashboard for history, positions, and analytics.

- **Bot**: `POST /api/tick` runs one cycle. GitHub Actions calls it every 15 minutes, 24/7: crypto trades every tick, stocks only during market hours.
- **Dashboard**: Next.js 16 (Cache Components) on Vercel, backed by Neon Postgres.
- **Safety**: the Alpaca client refuses any base URL other than `paper-api.alpaca.markets`.

## How a tick works (`lib/engine.ts`)

1. Record a `bot_runs` row. Skip if another run is still in flight.
2. Sync the account, positions, open orders, FILL activities, the last week's orders, and SPY daily closes into Postgres. Write an equity snapshot.
3. If the bot is paused, stop there. Stocks are skipped while the market is closed; crypto always runs.
4. Fetch completed 15-minute bars: regular-session only for stocks (IEX feed), all hours for crypto. Run each symbol's strategy.
5. Buys go through the risk gate (`lib/risk.ts`).
   - **Stocks** become an OTO order: a market entry plus a GTC 5% stop.
   - **Crypto** has no OTO on Alpaca, so the bot buys at market, then places its own GTC 5% stop-limit. Every tick it checks each crypto position still has a correctly sized stop, and replaces it if not.
   - Sells cancel the stop, then exit at market.
6. Client order IDs are `{strategy}.{side}.{symbol}.{barTime}`. That makes retries idempotent and attributes every fill to a strategy.
7. Alpaca reports crypto as `BTCUSD` in positions and fills but `BTC/USD` in orders; everything is stored as `BTC/USD`.

## Strategies (`lib/strategies/`)

| Strategy | Symbols | Entry | Exit |
|---|---|---|---|
| `rsi_revert` | SPY QQQ AAPL MSFT GOOGL | RSI(14) < 30 | RSI > 55, or the 5% stop |
| `sma_cross` | NVDA AMZN META TSLA AMD | SMA20 crosses above SMA50 (within 3 bars) | SMA20 < SMA50, or the 5% stop |
| `sma_cross` | BTC/USD ETH/USD | same | same |
| `rsi_revert` | SOL/USD | same | same |

Universe, parameters, and risk limits live in `lib/config.ts`. To add a strategy, implement the `Strategy` interface and register it in `lib/strategies/index.ts`.

**Risk limits**
- Stocks: 10% of equity per position, whole shares only.
- Crypto: 5% of equity per coin, 30% for all crypto combined, fractional amounts, bought with cash (no margin).
- Shared: at most 8 positions in total, and new entries halt at −3% daily P&L.

Crypto trades pay Alpaca's trading fee. Fees are synced from the account's `CFEE` activities and shown next to realized P&L; round-trip P&L itself is before fees.

## Setup

1. **Alpaca**: create a free account at https://app.alpaca.markets, switch to **Paper Trading**, and generate an API key.
2. **Vercel + Neon**:
   ```sh
   npm i -g vercel && vercel login
   vercel link
   vercel integration add neon      # provisions DATABASE_URL
   vercel env add ALPACA_KEY_ID
   vercel env add ALPACA_SECRET_KEY
   vercel env add CRON_SECRET       # openssl rand -hex 32
   vercel env add ADMIN_SECRET      # openssl rand -hex 32
   vercel env pull .env.local
   npm run db:migrate
   ```
3. **Deploy**: connect the repo with `vercel git connect`. Every push to `main` then deploys to production. Use `vercel deploy --prod` for a one-off manual deploy.
4. **Scheduler**: push the repo to GitHub, then add the Actions secrets `TICK_URL` (`https://<your-app>/api/tick`) and `CRON_SECRET`. The 24/7 schedule uses about 2,900 Actions minutes a month: free on a public repo, over the 2,000-minute free tier on a private one. On public repos GitHub disables schedules after 60 days without commits; re-enable from the Actions tab.

## Local development

```sh
npm run dev
# Dry run: evaluates strategies even when the market is closed, never places orders
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "localhost:3000/api/tick?dryRun=1"
npm test
```

The **Runs** page has an admin panel (needs `ADMIN_SECRET`) with: dry run, run a tick now, pause/resume, and liquidate all.
