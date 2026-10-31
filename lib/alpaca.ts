import { ALPACA_DATA_URL, ALPACA_PAPER_URL, DATA_FEED } from "./config";

export type Clock = {
  timestamp: string;
  is_open: boolean;
  next_open: string;
  next_close: string;
};

export type Account = {
  id: string;
  status: string;
  equity: string;
  last_equity: string;
  cash: string;
  buying_power: string;
  long_market_value: string;
  /** Cash available for non-marginable assets such as crypto. */
  non_marginable_buying_power: string;
  trading_blocked: boolean;
  account_blocked: boolean;
};

export type Position = {
  symbol: string;
  asset_class: string;
  qty: string;
  side: "long" | "short";
  avg_entry_price: string;
  current_price: string;
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
};

export type Order = {
  id: string;
  client_order_id: string;
  symbol: string;
  asset_class?: string;
  side: "buy" | "sell";
  qty: string | null;
  filled_qty: string;
  type: string;
  order_class: string;
  status: string;
  submitted_at: string;
  filled_at: string | null;
  filled_avg_price: string | null;
  stop_price: string | null;
  limit_price: string | null;
  legs: Order[] | null;
};

/** Crypto trading fee. Alpaca charges it in the asset received, so qty × price is its USD value. */
export type FeeActivity = {
  id: string;
  activity_type: "CFEE";
  date?: string;
  transaction_time?: string;
  created_at?: string;
  /** Missing on USD-denominated sell fees. */
  symbol?: string;
  qty?: string;
  price?: string;
  net_amount?: string;
  order_id?: string;
};

export type FillActivity = {
  id: string;
  activity_type: "FILL";
  transaction_time: string;
  type: "fill" | "partial_fill";
  price: string;
  qty: string;
  side: "buy" | "sell" | "sell_short";
  symbol: string;
  order_id: string;
};

export type Bar = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type NewOrder = {
  symbol: string;
  qty: number;
  side: "buy" | "sell";
  client_order_id: string;
  /** Defaults to "market". */
  type?: "market" | "stop_limit";
  /** Defaults to "day" (stocks); crypto orders must be "gtc" or "ioc". */
  time_in_force?: "day" | "gtc" | "ioc";
  stop_price?: number;
  limit_price?: number;
  /** Stocks only: attach a protective stop leg (OTO, or bracket with take_profit). */
  stop_loss?: number;
  take_profit?: number;
};

export type NewsArticle = {
  id: number;
  created_at: string;
  updated_at: string;
  headline: string;
  summary: string;
  author: string;
  source: string;
  url: string;
  /** Crypto pairs appear in compact form ("BTCUSD"). */
  symbols: string[];
};

/** Format a quantity without float noise: whole numbers as-is, fractions to 9 dp (Alpaca's crypto increment). */
export const formatQty = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(9).replace(/\.?0+$/, ""));

export class AlpacaError extends Error {
  constructor(
    public status: number,
    public body: string,
    path: string,
  ) {
    super(`Alpaca ${status} on ${path}: ${body.slice(0, 300)}`);
  }
}

function credentials() {
  const keyId = process.env.ALPACA_KEY_ID;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!keyId || !secret) throw new Error("ALPACA_KEY_ID / ALPACA_SECRET_KEY are not set");
  return { "APCA-API-KEY-ID": keyId, "APCA-API-SECRET-KEY": secret };
}

async function request<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
  // Hard guard: this bot only ever talks to the paper trading endpoint.
  if (base !== ALPACA_PAPER_URL && base !== ALPACA_DATA_URL) {
    throw new Error(`Refusing to call non-paper Alpaca endpoint: ${base}`);
  }
  // Retry rate limits (429) with backoff; long simulations make ~150 data requests per run.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(base + path, {
      ...init,
      headers: { ...credentials(), "Content-Type": "application/json", ...init.headers },
      cache: "no-store",
    });
    const text = await res.text();
    if (res.status === 429 && attempt < 4) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new AlpacaError(res.status, text, path);
    return (text ? JSON.parse(text) : null) as T;
  }
}

/** Safety cap on pagination loops. Crypto pages hold ~1 week of 15-min bars, so a year ≈ 52 pages. */
const MAX_PAGES = 2000;

const trading = <T>(path: string, init?: RequestInit) => request<T>(ALPACA_PAPER_URL, path, init);
const data = <T>(path: string) => request<T>(ALPACA_DATA_URL, path);

export const getClock = () => trading<Clock>("/v2/clock");
export const getAccount = () => trading<Account>("/v2/account");
export const getPositions = () => trading<Position[]>("/v2/positions");

/** nested=true groups bracket/OTO legs under their parent; nested=false lists every order flat. */
export function getOrders(params: { status: "open" | "closed" | "all"; nested: boolean; after?: string }) {
  const q = new URLSearchParams({
    status: params.status,
    limit: "500",
    nested: String(params.nested),
    direction: "desc",
  });
  if (params.after) q.set("after", params.after);
  return trading<Order[]>(`/v2/orders?${q}`);
}

export const getOrder = (id: string) => trading<Order>(`/v2/orders/${id}`);
export const cancelOrder = (id: string) => trading<null>(`/v2/orders/${id}`, { method: "DELETE" });
export const closeAllPositions = () =>
  trading<unknown>("/v2/positions?cancel_orders=true", { method: "DELETE" });

/** Change a resting order in place (used to raise a protective stop). Alpaca returns the replacement order. */
export function replaceOrder(id: string, change: { stop_price?: number; limit_price?: number }) {
  const body: Record<string, string> = {};
  if (change.stop_price !== undefined) body.stop_price = change.stop_price.toFixed(2);
  if (change.limit_price !== undefined) body.limit_price = change.limit_price.toFixed(2);
  return trading<Order>(`/v2/orders/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function submitOrder(o: NewOrder) {
  const body: Record<string, unknown> = {
    symbol: o.symbol,
    qty: formatQty(o.qty),
    side: o.side,
    type: o.type ?? "market",
    client_order_id: o.client_order_id,
    time_in_force: o.time_in_force ?? "day",
  };
  if (o.stop_price !== undefined) body.stop_price = o.stop_price.toFixed(2);
  if (o.limit_price !== undefined) body.limit_price = o.limit_price.toFixed(2);
  if (o.stop_loss !== undefined) {
    // GTC so the protective stop leg survives past today's close.
    body.time_in_force = "gtc";
    body.order_class = o.take_profit !== undefined ? "bracket" : "oto";
    body.stop_loss = { stop_price: o.stop_loss.toFixed(2) };
    if (o.take_profit !== undefined) body.take_profit = { limit_price: o.take_profit.toFixed(2) };
  }
  return trading<Order>("/v2/orders", { method: "POST", body: JSON.stringify(body) });
}

/** All activities of one type after `after` (ISO), oldest first, following pagination. */
async function getActivities<T extends { id: string }>(type: string, after?: string): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ direction: "asc", page_size: "100" });
    if (after) q.set("after", after);
    if (pageToken) q.set("page_token", pageToken);
    const batch = await trading<T[]>(`/v2/account/activities/${type}?${q}`);
    out.push(...batch);
    if (batch.length < 100) break;
    pageToken = batch[batch.length - 1].id;
  }
  return out;
}

export const getFills = (after?: string) => getActivities<FillActivity>("FILL", after);
export const getFees = (after?: string) => getActivities<FeeActivity>("CFEE", after);

/** Historical bars for many symbols, following pagination. */
export async function getBars(
  symbols: string[],
  timeframe: string,
  start: Date,
  end?: Date,
): Promise<Record<string, Bar[]>> {
  const out: Record<string, Bar[]> = Object.fromEntries(symbols.map((s) => [s, []]));
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({
      symbols: symbols.join(","),
      timeframe,
      start: start.toISOString(),
      limit: "10000",
      feed: DATA_FEED,
      adjustment: "all",
      sort: "asc",
    });
    if (end) q.set("end", end.toISOString());
    if (pageToken) q.set("page_token", pageToken);
    const res = await data<{ bars: Record<string, Bar[]> | null; next_page_token: string | null }>(
      `/v2/stocks/bars?${q}`,
    );
    for (const [sym, bars] of Object.entries(res.bars ?? {})) (out[sym] ??= []).push(...bars);
    if (!res.next_page_token) break;
    pageToken = res.next_page_token;
  }
  return out;
}

/**
 * Historical crypto bars (all hours) for "BTC/USD"-style pairs. The crypto endpoint returns only
 * ~1 week of 15-min bars per page regardless of `limit`, so each symbol pages on its own, in parallel.
 */
export async function getCryptoBars(
  symbols: string[],
  timeframe: string,
  start: Date,
): Promise<Record<string, Bar[]>> {
  const one = async (symbol: string) => {
    const out: Bar[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = new URLSearchParams({ symbols: symbol, timeframe, start: start.toISOString(), limit: "10000", sort: "asc" });
      if (pageToken) q.set("page_token", pageToken);
      const res = await data<{ bars: Record<string, Bar[]> | null; next_page_token: string | null }>(
        `/v1beta3/crypto/us/bars?${q}`,
      );
      out.push(...(res.bars?.[symbol] ?? []));
      if (!res.next_page_token) break;
      pageToken = res.next_page_token;
    }
    return [symbol, out] as const;
  };
  return Object.fromEntries(await Promise.all(symbols.map(one)));
}

/** News articles tagged with any of `symbols`, oldest first, following pagination. */
export async function getNews(params: {
  symbols: string[];
  start: Date;
  end?: Date;
  /** Stop after this many pages of 50. */
  maxPages?: number;
}): Promise<NewsArticle[]> {
  const out: NewsArticle[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < (params.maxPages ?? MAX_PAGES); page++) {
    const q = new URLSearchParams({
      symbols: params.symbols.join(","),
      start: params.start.toISOString(),
      limit: "50",
      sort: "asc",
      include_content: "false",
      exclude_contentless: "false",
    });
    if (params.end) q.set("end", params.end.toISOString());
    if (pageToken) q.set("page_token", pageToken);
    const res = await data<{ news: NewsArticle[] | null; next_page_token: string | null }>(`/v1beta1/news?${q}`);
    out.push(...(res.news ?? []));
    if (!res.next_page_token) break;
    pageToken = res.next_page_token;
  }
  return out;
}
