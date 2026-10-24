import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { DebriefChart } from "@/components/charts";
import { UnitEmblem, unitFor, type UnitId } from "@/components/emblems";
import { ActionBadge, Card, Delta, Empty, KeyValueList, PageHeader, Skeleton, StatStrip, Table } from "@/components/ui";
import { dateTime, duration, qty, signedPct, signedUsd, usd } from "@/lib/format";
import { briefAttrs } from "@/lib/briefings";
import { getDebrief } from "@/lib/queries";

export const metadata: Metadata = { title: "Mission debrief" };

export default function DebriefPage({ searchParams }: PageProps<"/trades/debrief">) {
  return (
    <>
      <PageHeader
        code="SYS-03 // Combat log // Debrief"
        title="Mission debrief"
        subtitle="One closed engagement, start to finish"
        brief={briefAttrs("page-debrief")}
      >
        <Link href="/trades" className="hud text-[13px] text-amber hover:underline">
          ← Combat log
        </Link>
      </PageHeader>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Debrief searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const fmtIndicators = (ind: Record<string, number | null>) =>
  Object.entries(ind)
    .filter(([k, v]) => k !== "close" && v !== null)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");

async function Debrief({ searchParams }: { searchParams: PageProps<"/trades/debrief">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const entry = typeof sp.entry === "string" ? sp.entry : "";
  const exit = typeof sp.exit === "string" ? sp.exit : "";
  const t = entry && exit ? await getDebrief(entry, exit) : null;
  if (!t) {
    return (
      <Card>
        <Empty>That engagement isn&apos;t in the log.</Empty>
      </Card>
    );
  }
  const unit = unitFor(t.strategy);
  const win = t.pnl > 0;
  const exitLabel = { stop: "Protective stop", signal: "Strategy exit signal", manual: "Manual exit", unknown: "Exit" }[t.exitKind];

  return (
    <div className="grid grid-cols-1 gap-5">
      <section
        className={`frame boot ${win ? "frame-hot" : ""}`}
        tabIndex={0}
        {...briefAttrs("debrief-hero", {
          symbol: t.symbol,
          unit: t.strategy,
          pnl: signedUsd(t.pnl),
          pnlRaw: t.pnl,
          ret: signedPct(t.returnPct),
          exitBy: exitLabel,
        })}
      >
        <div className="frame-body flex flex-wrap items-center gap-x-8 gap-y-4 px-6 py-5">
          {unit ? (
            <UnitEmblem unit={t.strategy as UnitId} size={64} />
          ) : (
            <div className="hud grid size-16 place-items-center border border-line-2 text-[12px] text-muted">Manual</div>
          )}
          <div>
            <div className="hud text-[12px]" style={{ color: unit?.secondary }}>
              {unit ? `${unit.code} ${unit.callsign}` : "Manual trade"} · {t.assetClass === "crypto" ? "Crypto" : "Equities"}
            </div>
            <div className="num mt-1 text-[30px] leading-none text-ink">{t.symbol}</div>
          </div>
          <div className="ml-auto text-right">
            <div className={`font-title text-[30px] leading-none font-extrabold ${win ? "text-sync" : "text-alert"}`}>
              {win ? "Target neutralized" : "Withdrawn"}
            </div>
            <div className="mt-1 text-[18px]">
              <Delta value={t.pnl}>
                {signedUsd(t.pnl)} ({signedPct(t.returnPct)})
              </Delta>
            </div>
          </div>
        </div>
      </section>

      <StatStrip
        items={[
          { label: "Entry", value: usd(t.entryPrice), sub: dateTime(t.entryTs) },
          { label: "Exit", value: usd(t.exitPrice), sub: dateTime(t.exitTs) },
          { label: "Held", value: duration(t.holdMs), sub: `${qty(t.qty)} ${t.assetClass === "crypto" ? "coins" : "shares"}` },
          {
            label: "Exit by",
            value: exitLabel,
            sub: t.fees > 0 ? `fees ${usd(t.fees)}` : "no fees",
            brief: briefAttrs("exit-by", { value: exitLabel, kind: t.exitKind }),
          },
        ]}
      />

      <Card
        title="Flight path"
        subtitle="15-minute closes around the engagement"
        code="DBR-01"
        tone="hot"
        brief={briefAttrs("flight-path", {
          entry: usd(t.entryPrice),
          exit: usd(t.exitPrice),
          stop: t.stopPrice ? usd(t.stopPrice) : null,
        })}
      >
        {t.bars.length > 1 ? (
          <DebriefChart
            bars={t.bars}
            entryTs={t.entryTs}
            exitTs={t.exitTs}
            entryPrice={t.entryPrice}
            exitPrice={t.exitPrice}
            stopPrice={t.stopPrice}
            win={win}
          />
        ) : (
          <Empty>Price history for this window isn&apos;t available.</Empty>
        )}
      </Card>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
        <Card
          title="Why it fired"
          subtitle="Buy/sell calls on this target during the engagement"
          code="DBR-02"
          className="lg:col-span-2"
          brief={briefAttrs("why-fired", { count: t.signals.length })}
        >
          {t.signals.length ? (
            <Table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Order</th>
                  <th>Assessment</th>
                  <th>Telemetry</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {t.signals.map((s, i) => (
                  <tr
                    key={i}
                    {...briefAttrs("call", {
                      symbol: t.symbol,
                      unit: t.strategy,
                      action: s.action,
                      reason: s.reason,
                      outcome: s.note ?? "—",
                      acted: s.acted,
                    })}
                  >
                    <td className="num whitespace-nowrap text-ink-2">{dateTime(s.ts)}</td>
                    <td>
                      <ActionBadge action={s.action} />
                    </td>
                    <td className="text-ink-2">{s.reason}</td>
                    <td className="num text-[12px] text-muted">{fmtIndicators(s.indicators)}</td>
                    <td className={s.acted ? "text-ink" : "text-muted"}>{s.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty>No strategy calls recorded. This was placed manually or before signals were logged.</Empty>
          )}
        </Card>
        <Card
          title="Flight data"
          code="DBR-03"
          brief={briefAttrs("flight-data", { stop: t.stopPrice ? usd(t.stopPrice) : null, fees: usd(t.fees) })}
        >
          <KeyValueList
            rows={[
              { label: "Protective stop", value: t.stopPrice ? usd(t.stopPrice) : "—" },
              { label: "Fees", value: usd(t.fees) },
              { label: "Entry order", value: <span className="text-[12px]">{t.entryClientId ?? "—"}</span> },
              { label: "Exit order", value: <span className="text-[12px]">{t.exitClientId ?? "—"}</span> },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
