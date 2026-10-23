"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import { dateTime, isoDayLabel, shortDate, signedPct, signedUsd, usd, usd0 } from "@/lib/format";

type Tip = TooltipContentProps<ValueType, NameType>;

const axis = {
  stroke: "var(--axis)",
  tick: { fill: "var(--muted)", fontSize: 11, fontFamily: "var(--font-plex-mono)" },
  tickLine: false,
} as const;

const grid = <CartesianGrid stroke="var(--grid)" vertical={false} />;

const cursor = { stroke: "var(--axis)", strokeWidth: 1 };

type Row = { key: string; label: string; value: string; color: string };

function TooltipBox({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="border border-amber/70 bg-[#0b0a10]/95 px-3 py-2 text-[13px] shadow-[0_0_24px_-4px_rgba(255,164,27,0.35)]">
      <div className="hud mb-1 text-[11px] text-amber">{title}</div>
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2 py-0.5">
          <span aria-hidden className="h-0.5 w-3 rounded" style={{ background: r.color }} />
          <span className="num font-semibold text-ink">{r.value}</span>
          <span className="text-ink-2">{r.label}</span>
        </div>
      ))}
    </div>
  );
}


/** Equity over every snapshot. X is the snapshot index so overnight/weekend gaps don't stretch the line. */
export function EquityChart({ data, height = 260 }: { data: { ts: number; equity: number }[]; height?: number | `${number}%` }) {
  return (
    <ResponsiveContainer width="100%" height={height} className="glow-line">
      <AreaChart data={data} margin={{ top: 8, right: 20, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {grid}
        <XAxis
          dataKey="ts"
          {...axis}
          type="category"
          tickFormatter={(v: number) => shortDate(v)}
          minTickGap={48}
        />
        <YAxis
          {...axis}
          axisLine={false}
          width={72}
          // Pad to at least ±0.5% so a flat line doesn't get a ±$2 axis.
          domain={([lo, hi]: readonly number[]) => {
            const pad = Math.max((hi - lo) * 0.1, hi * 0.005);
            return [Math.floor(lo - pad), Math.ceil(hi + pad)];
          }}
          tickFormatter={(v: number) => usd0(v)}
        />
        <Tooltip
          cursor={cursor}
          content={({ active, payload }: Tip) =>
            active && payload?.length ? (
              <TooltipBox
                title={dateTime(payload[0].payload.ts)}
                rows={[{ key: "eq", label: "equity", value: usd(payload[0].payload.equity), color: "var(--series-1)" }]}
              />
            ) : null
          }
        />
        <Area
          type="monotone"
          dataKey="equity"
          stroke="var(--series-1)"
          strokeWidth={2}
          fill="url(#eqFill)"
          isAnimationActive={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--sync)", fill: "var(--bg)" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Portfolio vs benchmarks' cumulative return, indexed to a common start so they share one axis. */
export function PerformanceChart({
  data,
}: {
  data: { date: string; portfolio: number; spy: number | null; btc: number | null }[];
}) {
  // Categorical slots 1–3, in palette order; each series keeps its color regardless of what's shown.
  const series = [
    { key: "portfolio", label: "Your frame", short: "YOU", color: "var(--series-1)" },
    { key: "spy", label: "SPY buy & hold", short: "SPY", color: "var(--series-2)" },
    { key: "btc", label: "BTC buy & hold", short: "BTC", color: "var(--series-3)" },
  ] as const;
  return (
    <div>
      <div className="hud mb-3 flex flex-wrap gap-5 text-[12px] text-ink-2">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-4 rounded" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 8, right: 44, bottom: 0, left: 0 }}>
          {grid}
          <XAxis dataKey="date" {...axis} tickFormatter={isoDayLabel} minTickGap={40} />
          <YAxis {...axis} axisLine={false} width={56} tickFormatter={(v: number) => signedPct(v, 1)} />
          <ReferenceLine y={0} stroke="var(--axis)" />
          <Tooltip
            cursor={cursor}
            content={({ active, payload, label }: Tip) =>
              active && payload?.length ? (
                <TooltipBox
                  title={isoDayLabel(String(label))}
                  rows={series
                    .map((s) => ({ s, v: payload[0].payload[s.key] as number | null }))
                    .filter(({ v }) => v !== null)
                    .map(({ s, v }) => ({ key: s.key, label: s.label, value: signedPct(v!), color: s.color }))}
                />
              ) : null
            }
          />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={s.color}
              strokeWidth={2}
              dot={data.length < 30 ? { r: 3, strokeWidth: 0, fill: s.color } : false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--bg)" }}
              className={s.key === "portfolio" ? "glow-line" : undefined}
              connectNulls
              isAnimationActive={false}
              // Direct end label: identity never rests on color alone.
              label={(p: { x?: number | string; y?: number | string; index?: number }) =>
                p.index === lastIndex(data, s.key) ? (
                  <text
                    key={`end-${s.key}`}
                    x={Number(p.x) + 8}
                    y={Number(p.y)}
                    dy={4}
                    fill={s.color}
                    fontSize={11}
                    fontWeight={700}
                    fontFamily="var(--font-barlow-condensed)"
                    letterSpacing="0.1em"
                  >
                    {s.short}
                  </text>
                ) : (
                  <g key={`none-${s.key}-${p.index}`} />
                )
              }
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DrawdownChart({ data }: { data: { ts: number; dd: number }[] }) {
  // Red only once there is an actual drawdown; a flat 0% line stays neutral.
  const color = data.some((p) => p.dd < 0) ? "var(--loss)" : "var(--muted)";
  return (
    <ResponsiveContainer width="100%" height={160}>
      <AreaChart data={data} margin={{ top: 8, right: 20, bottom: 0, left: 0 }}>
        {grid}
        <XAxis dataKey="ts" {...axis} type="category" tickFormatter={(v: number) => shortDate(v)} minTickGap={48} />
        <YAxis {...axis} axisLine={false} width={56} domain={([lo]: readonly number[]) => [Math.min(lo * 1.1, -0.01), 0]} tickFormatter={(v: number) => signedPct(v, 1)} />
        <Tooltip
          cursor={cursor}
          content={({ active, payload }: Tip) =>
            active && payload?.length ? (
              <TooltipBox
                title={dateTime(payload[0].payload.ts)}
                rows={[{ key: "dd", label: "from peak", value: signedPct(payload[0].payload.dd), color }]}
              />
            ) : null
          }
        />
        <Area
          type="monotone"
          dataKey="dd"
          stroke={color}
          strokeWidth={1.5}
          fill={color}
          fillOpacity={0.12}
          baseValue={0}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Realized P&L per symbol; sign is shown by bar direction, color, and the signed value in the tooltip. */
export function SymbolPnlChart({ data }: { data: { symbol: string; pnl: number; count: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 32 + 24)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap={6}>
        <CartesianGrid stroke="var(--grid)" horizontal={false} />
        <XAxis type="number" {...axis} tickFormatter={(v: number) => usd0(v)} />
        {/* Label column sized to the longest symbol (crypto pairs like "BTC/USD" are wider). */}
        <YAxis
          type="category"
          dataKey="symbol"
          {...axis}
          axisLine={false}
          width={Math.max(44, ...data.map((d) => d.symbol.length * 8 + 12))}
        />
        <ReferenceLine x={0} stroke="var(--axis)" />
        <Tooltip
          cursor={{ fill: "rgba(139, 92, 246, 0.08)" }}
          content={({ active, payload }: Tip) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as { symbol: string; pnl: number; count: number };
            return (
              <TooltipBox
                title={`${p.symbol} · ${p.count} trade${p.count === 1 ? "" : "s"}`}
                rows={[{ key: "pnl", label: "realized", value: signedUsd(p.pnl), color: p.pnl >= 0 ? "var(--gain)" : "var(--loss)" }]}
              />
            );
          }}
        />
        <Bar dataKey="pnl" isAnimationActive={false} maxBarSize={20}>
          {data.map((d) => (
            <Cell
              key={d.symbol}
              fill={d.pnl >= 0 ? "var(--gain)" : "var(--loss)"}
              // Round only the data end, anchoring the bar to the zero baseline.
              radius={(d.pnl >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4]) as unknown as number}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Index of the last non-null value of `key`, where the end label goes. */
function lastIndex<T extends Record<string, unknown>>(data: T[], key: string) {
  for (let i = data.length - 1; i >= 0; i--) if (data[i][key] !== null && data[i][key] !== undefined) return i;
  return -1;
}
