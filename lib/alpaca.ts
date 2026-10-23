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
  trading_blocked: boolean;
  account_blocked: boolean;
};

export type Position = {
  symbol: string;
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
  stop_loss?: number;
  take_profit?: number;
};

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
  const res = await fetch(base + path, {
    ...init,
    headers: { ...credentials(), "Content-Type": "application/json", ...init.headers },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new AlpacaError(res.status, text, path);
  return (text ? JSON.parse(text) : null) as T;
}

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

export function submitOrder(o: NewOrder) {
  const body: Record<string, unknown> = {
    symbol: o.symbol,
    qty: String(o.qty),
    side: o.side,
    type: "market",
    client_order_id: o.client_order_id,
    time_in_force: "day",
  };
  if (o.stop_loss !== undefined) {
    // GTC so the protective stop leg survives past today's close.
    body.time_in_force = "gtc";
    body.order_class = o.take_profit !== undefined ? "bracket" : "oto";
    body.stop_loss = { stop_price: o.stop_loss.toFixed(2) };
    if (o.take_profit !== undefined) body.take_profit = { limit_price: o.take_profit.toFixed(2) };
  }
  return trading<Order>("/v2/orders", { method: "POST", body: JSON.stringify(body) });
}

/** All FILL activities after `after` (ISO), oldest first, following pagination. */
export async function getFills(after?: string): Promise<FillActivity[]> {
  const out: FillActivity[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams({ direction: "asc", page_size: "100" });
    if (after) q.set("after", after);
    if (pageToken) q.set("page_token", pageToken);
    const batch = await trading<FillActivity[]>(`/v2/account/activities/FILL?${q}`);
    out.push(...batch);
    if (batch.length < 100) break;
    pageToken = batch[batch.length - 1].id;
  }
  return out;
}

/** Historical bars for many symbols, following pagination. */
export async function getBars(
  symbols: string[],
  timeframe: string,
  start: Date,
  end?: Date,
): Promise<Record<string, Bar[]>> {
  const out: Record<string, Bar[]> = Object.fromEntries(symbols.map((s) => [s, []]));
  let pageToken: string | undefined;
  for (let page = 0; page < 50; page++) {
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
