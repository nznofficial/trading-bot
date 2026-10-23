import { connection } from "next/server";
import { Suspense } from "react";
import { AdminPanel } from "@/components/admin-panel";
import { Card, Empty, PageHeader, Skeleton, StatusBadge, Table } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { getRuns } from "@/lib/queries";

export default function RunsPage() {
  return (
    <>
      <PageHeader kicker="Operations" title="Runs" subtitle="Every bot tick: triggered every 15 minutes on weekdays by GitHub Actions." />
      <div className="grid grid-cols-1 gap-4">
        <Suspense fallback={<Skeleton />}>
          <Runs />
        </Suspense>
        <AdminPanel />
      </div>
    </>
  );
}

async function Runs() {
  await connection(); // DB-backed: render at request time, never at build
  const runs = await getRuns();
  return (
    <Card title="Run log" subtitle="Latest 150">
      {runs.length ? (
        <Table>
          <thead>
            <tr>
              <th>#</th>
              <th>Started</th>
              <th>Status</th>
              <th className="text-right!">Signals</th>
              <th className="text-right!">Orders</th>
              <th className="text-right!">Duration</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="text-muted">{r.id}</td>
                <td className="num text-xs whitespace-nowrap text-ink-2">{dateTime(r.startedAt)}</td>
                <td className="whitespace-nowrap"><StatusBadge status={r.status} /></td>
                <td className="num text-right">{r.signals}</td>
                <td className="num text-right">{r.ordersPlaced}</td>
                <td className="num text-right text-ink-2">{r.durationMs === null ? "—" : `${(r.durationMs / 1000).toFixed(1)}s`}</td>
                <td className={r.error ? "text-down" : "text-ink-2"}>{r.error ?? r.message ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <Empty>No runs yet.</Empty>
      )}
    </Card>
  );
}
