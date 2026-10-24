import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdminPanel } from "@/components/admin-panel";
import { Card, Empty, PageHeader, Skeleton, StatusBadge, Table } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { briefAttrs } from "@/lib/briefings";
import Link from "next/link";
import { getRuns, RUN_PAGE_SIZES } from "@/lib/queries";

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

const num = (v: string | string[] | undefined) => Math.floor(Number(Array.isArray(v) ? v[0] : v));

async function Runs({ searchParams }: { searchParams: PageProps<"/runs">["searchParams"] }) {
  await connection(); // DB-backed: render at request time, never at build
  const sp = await searchParams;
  const size = (RUN_PAGE_SIZES as readonly number[]).includes(num(sp.size)) ? num(sp.size) : RUN_PAGE_SIZES[0];
  const page = num(sp.page) > 0 ? num(sp.page) : 1;
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
        action={<SizePicker size={size} />}
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
      <Pager page={page} pages={pages} size={size} />
    </div>
  );
}

const href = (page: number, size: number) =>
  `/runs?${new URLSearchParams({ ...(page > 1 ? { page: String(page) } : {}), ...(size !== RUN_PAGE_SIZES[0] ? { size: String(size) } : {}) })}`;

/** How many sorties per page: plain links, so it works without client JS. */
function SizePicker({ size }: { size: number }) {
  return (
    <nav aria-label="Sorties per page" className="flex items-center gap-1">
      <span className="hud mr-1 hidden text-[11px] text-muted sm:inline">Show</span>
      {RUN_PAGE_SIZES.map((n) => (
        <Link
          key={n}
          href={href(1, n)}
          aria-current={n === size ? "page" : undefined}
          className={`hud border px-2 py-0.5 text-[11px] ${n === size ? "border-amber bg-amber text-[#0b0a10]" : "border-line-2 text-ink-2 hover:border-amber/60 hover:text-ink"}`}
        >
          {n}
        </Link>
      ))}
    </nav>
  );
}

function Pager({ page, pages, size }: { page: number; pages: number; size: number }) {
  if (pages <= 1) return null;
  const btn = "hud border px-3 py-1 text-[12px]";
  const live = `${btn} border-line-2 text-ink-2 hover:border-amber hover:text-amber`;
  const dead = `${btn} border-line text-muted/50`;
  return (
    <nav aria-label="Sortie pages" className="mt-4 flex items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={href(page - 1, size)} className={live}>
          ← Newer
        </Link>
      ) : (
        <span className={dead}>← Newer</span>
      )}
      <span className="hud text-[12px] text-muted">
        Page <span className="num text-ink">{page}</span> of <span className="num">{pages.toLocaleString()}</span>
        {page > 1 && (
          <Link href={href(1, size)} className="ml-3 text-amber hover:underline">
            Latest
          </Link>
        )}
      </span>
      {page < pages ? (
        <Link href={href(page + 1, size)} className={live}>
          Older →
        </Link>
      ) : (
        <span className={dead}>Older →</span>
      )}
    </nav>
  );
}
