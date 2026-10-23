# Paper Trader

A rule-based trading bot that paper-trades US stocks on **Alpaca's paper account** using real market data, with a public read-only dashboard for history, positions, and analytics.

- **Bot**: `POST /api/tick` runs one cycle. GitHub Actions calls it every 15 minutes on weekdays.
- **Dashboard**: Next.js 16 (Cache Components) on Vercel, backed by Neon Postgres.
- **Safety**: the Alpaca client refuses any base URL other than `paper-api.alpaca.markets`.

## How a tick works (`lib/engine.ts`)

1. Record a `bot_runs` row. Skip if another run is still in flight.
2. Sync the account, positions, open orders, FILL activities, the last week's orders, and SPY daily closes into Postgres. Write an equity snapshot.
3. If the bot is paused or the market is closed, stop there.
4. Fetch completed regular-session 15-minute bars (IEX feed) for the universe. Run each symbol's strategy.
5. Buys go through the risk gate (`lib/risk.ts`), then become an OTO order: a market entry plus a GTC 5% stop. Sells cancel the stop leg, then exit at market.
6. Client order IDs are `{strategy}.{side}.{symbol}.{barTime}`. That makes retries idempotent and attributes every fill to a strategy.

## Strategies (`lib/strategies/`)

| Strategy | Symbols | Entry | Exit |
|---|---|---|---|
| `rsi_revert` | SPY QQQ AAPL MSFT GOOGL | RSI(14) < 30 | RSI > 55, or the 5% stop |
| `sma_cross` | NVDA AMZN META TSLA AMD | SMA20 crosses above SMA50 (within 3 bars) | SMA20 < SMA50, or the 5% stop |

Universe, parameters, and risk limits live in `lib/config.ts`. To add a strategy, implement the `Strategy` interface and register it in `lib/strategies/index.ts`.

**Risk limits**: 10% of equity per position, at most 8 positions, whole shares only, and new entries halt at −3% daily P&L.

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
3. **Deploy**: `vercel deploy --prod`
4. **Scheduler**: push the repo to GitHub, then add the Actions secrets `TICK_URL` (`https://<your-app>/api/tick`) and `CRON_SECRET`.

## Local development

```sh
npm run dev
# Dry run: evaluates strategies even when the market is closed, never places orders
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "localhost:3000/api/tick?dryRun=1"
npm test
```

The **Runs** page has an admin panel (needs `ADMIN_SECRET`) with: dry run, run a tick now, pause/resume, and liquidate all.
