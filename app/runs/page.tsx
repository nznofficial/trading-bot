import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdminPanel } from "@/components/admin-panel";
import { Card, Empty, PageHeader, Skeleton, StatusBadge, Table } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { briefAttrs } from "@/lib/briefings";
import { Pager, PAGE_SIZES, readPaging, SizePicker, type PageHref } from "@/components/pager";
import { getRuns } from "@/lib/queries";

export const metadata: Metadata = { title: "Sorties" };

export default function RunsPage({ searchParams }: PageProps<"/runs">) {
  return (
    <>
      <PageHeader
        code="SYS-05 // Sorties"
        title="Sorties"
        subtitle="Every scheduled launch · 15-minute cycle, around the clock"
        brief={briefAttrs("page-sorties")}
      />
      <div className="grid grid-cols-1 gap-4">
        <Suspense fallback={<Skeleton />}>
          <Runs searchParams={searchParams} />
        </Suspense>
        <AdminPanel />
      </div>
    </>
  );
}

async function Runs({ searchParams }: { searchParams: PageProps<"/runs">["searchParams"] }) {
  await connection(); // DB-backed: render at request time, never at build
  const sp = await searchParams;
  const { page, size } = readPaging(sp.page, sp.size);
  const { runs, total, pages } = await getRuns(page, size);
  const from = total ? (page - 1) * size + 1 : 0;
  const to = Math.min(total, page * size);
  return (
    <div>
      <Card
        title="Sortie record"
        subtitle={`${from}–${to} of ${total.toLocaleString()} · newest first`}
        code="OPS-01"
        brief={briefAttrs("sortie-record", { count: total, latest: runs[0] && page === 1 ? dateTime(runs[0].startedAt) : null })}
        action={<SizePicker size={size} href={href} label="Sorties per page" />}
      >
        {runs.length ? (
          <Table>
            <thead>
              <tr>
                <th>#</th>
                <th>Started</th>
                <th>Status</th>
                <th>Trigger</th>
                <th className="text-right!">Signals</th>
                <th className="text-right!">Orders</th>
                <th className="text-right!">Duration</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr
                  key={r.id}
                  {...briefAttrs("sortie", {
                    id: r.id,
                    status: r.status,
                    started: dateTime(r.startedAt),
                    trigger: r.trigger,
                    signals: r.signals,
                    orders: r.ordersPlaced,
                    duration: r.durationMs === null ? null : `${(r.durationMs / 1000).toFixed(1)}s`,
                    detail: r.error ?? r.message,
                  })}
                >
                  <td className="text-muted">{r.id}</td>
                  <td className="num whitespace-nowrap text-ink-2">{dateTime(r.startedAt)}</td>
                  <td className="whitespace-nowrap"><StatusBadge status={r.status} /></td>
                  <td className="hud text-[12px] whitespace-nowrap text-ink-2">{r.trigger ?? "—"}</td>
                  <td className="num text-right">{r.signals}</td>
                  <td className="num text-right">{r.ordersPlaced}</td>
                  <td className="num text-right text-ink-2">{r.durationMs === null ? "—" : `${(r.durationMs / 1000).toFixed(1)}s`}</td>
                  <td className={r.error ? "text-loss" : "text-ink-2"}>{r.error ?? r.message ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No runs yet.</Empty>
        )}
      </Card>
      <Pager page={page} pages={pages} size={size} href={href} label="Sortie pages" />
    </div>
  );
}

const href: PageHref = (page, size) =>
  `/runs?${new URLSearchParams({ ...(page > 1 ? { page: String(page) } : {}), ...(size !== PAGE_SIZES[0] ? { size: String(size) } : {}) })}`;
