import Link from "next/link";
import { ChevronRight, Plus, Target } from "lucide-react";
import { requireStaff, canWrite } from "@/lib/auth";
import { getActiveSession } from "@/lib/context";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, rupees, rupeesShort } from "@/lib/format";
import type { CollectionTarget, InstallmentRow, TargetProgress } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Legend, StackedBar } from "@/components/ui/bars";
import { Ring } from "@/components/ui/ring";
import { Empty } from "@/components/ui/empty";
import { NoSession } from "@/components/no-session";
import { TargetForm, DeleteTargetButton } from "./target-form";

export const metadata = { title: "Installments" };

const STATUS = {
  upcoming: { label: "Upcoming", tone: "neutral" },
  open: { label: "Open", tone: "accent" },
  closed: { label: "Closed", tone: "neutral" },
} as const;

const TIMING_LEGEND = [
  { label: "On time", className: "bg-series-1" },
  { label: "Late", className: "bg-series-2" },
  { label: "Missing", className: "bg-series-track" },
];

export default async function InstallmentsPage() {
  const viewer = await requireStaff();
  const session = await getActiveSession();
  if (!session) return <NoSession />;
  const supabase = await createClient();
  const [{ data, error }, { data: targetsData }] = await Promise.all([
    supabase.rpc("installments_overview", { p_session: session.id }),
    supabase.from("collection_targets").select("*").eq("session_id", session.id).order("target_date"),
  ]);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as InstallmentRow[];
  const targets = (targetsData ?? []) as CollectionTarget[];
  const progress = await Promise.all(
    targets.map(async (t) => {
      const { data: p } = await supabase.rpc("target_progress", { p_target: t.id });
      return p as TargetProgress | null;
    }),
  );
  const tot = rows.reduce(
    (a, r) => ({ expected: a.expected + r.expected, received: a.received + r.received, on_time: a.on_time + r.on_time, late: a.late + r.late, gap: a.gap + r.gap }),
    { expected: 0, received: 0, on_time: 0, late: 0, gap: 0 },
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Installments"
        description={`${session.name} · ${rupeesShort(tot.received)} of ${rupeesShort(tot.expected)} collected`}
        info="Collected = money allocated to each installment, whenever it was paid. Open an installment to see which classes and students make up the gap."
      />

      {rows.length === 0 ? (
        <Card>
          <Empty title="No installments yet">
            Add them in <Link className="text-accent" href="/setup/sessions">Setup → Sessions</Link>.
          </Empty>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((r, i) => (
              <Link
                key={r.id}
                href={`/installments/${r.number}`}
                className="animate-rise group rounded-[var(--radius-card)] bg-surface p-6 shadow-card transition-transform duration-200 hover:-translate-y-0.5"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-headline font-semibold text-ink">{r.name}</p>
                    <p className="text-footnote text-ink-2">Due {fmtDate(r.due_date)}</p>
                  </div>
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                </div>
                <div className="mt-6 flex items-center gap-6">
                  <Ring value={r.collection_pct} size={112} stroke={12} color={r.status === "upcoming" ? "var(--tile-gray)" : "var(--series-1)"}>
                    <span className="figure text-title2">{Math.round(r.collection_pct ?? 0)}%</span>
                  </Ring>
                  <dl className="grid flex-1 gap-2.5 text-footnote">
                    <div>
                      <dt className="text-ink-2">Collected</dt>
                      <dd className="text-title3 font-semibold tabular text-ink">{rupeesShort(r.received)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-2">Gap</dt>
                      <dd className={`text-title3 font-semibold tabular ${r.gap > 0 && r.status !== "upcoming" ? "text-critical-ink" : "text-ink"}`}>{rupeesShort(r.gap)}</dd>
                    </div>
                  </dl>
                </div>
                <div className="mt-6">
                  <StackedBar
                    total={r.expected}
                    segments={[
                      { value: r.on_time, className: "bg-series-1", label: "On time", display: rupees(r.on_time) },
                      { value: r.late, className: "bg-series-2", label: "Late", display: rupees(r.late) },
                      { value: r.gap, className: "bg-series-track", label: "Missing", display: rupees(r.gap) },
                    ]}
                  />
                  <div className="mt-2.5 flex items-center justify-between text-caption text-muted">
                    <span>
                      {r.students_cleared} of {r.students} students cleared
                    </span>
                    <span className="inline-flex items-center gap-0.5 font-medium text-accent">
                      Details <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <Card title="Whole year" description="Money received by each due date, received late, and still missing. A growing grey part means the shortfall is being carried forward.">
            <StackedBar
              height="h-4"
              total={tot.expected}
              segments={[
                { value: tot.on_time, className: "bg-series-1", label: "On time", display: rupees(tot.on_time) },
                { value: tot.late, className: "bg-series-2", label: "Late", display: rupees(tot.late) },
                { value: tot.gap, className: "bg-series-track", label: "Missing", display: rupees(tot.gap) },
              ]}
            />
            <Legend
              className="mt-3"
              items={[
                { ...TIMING_LEGEND[0], value: rupeesShort(tot.on_time) },
                { ...TIMING_LEGEND[1], value: rupeesShort(tot.late) },
                { ...TIMING_LEGEND[2], value: rupeesShort(tot.gap) },
              ]}
            />
          </Card>
        </>
      )}

      <Card title="Targets" description="Set a goal like “90% of fees due by 31 December”. Each target shows the gap and who would close it.">
        {targets.length === 0 && <p className="mb-2 text-subhead text-ink-2">No targets yet.</p>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {targets.map((t, i) => {
            const p = progress[i];
            if (!p) return null;
            const reached = p.gap <= 0;
            return (
              <div key={t.id} className="flex items-center gap-5 rounded-2xl bg-fill-2 p-5">
                <Ring value={p.current_pct} size={92} stroke={10} color={reached ? "var(--good)" : "var(--series-1)"}>
                  <span className="text-headline font-semibold tabular">{Math.round(p.current_pct ?? 0)}%</span>
                </Ring>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-subhead font-semibold text-ink">
                      <Target className="size-4 text-muted" aria-hidden /> {Number(t.target_pct)}% by {fmtDate(t.target_date)}
                    </p>
                    {canWrite(viewer.role) && <DeleteTargetButton id={t.id} />}
                  </div>
                  <p className="mt-1 text-footnote text-ink-2">
                    {reached ? (
                      <span className="font-semibold text-good-ink">Target reached</span>
                    ) : (
                      <>
                        <span className="font-semibold text-critical-ink">{rupeesShort(p.gap)}</span> short of {rupeesShort(p.goal)}
                      </>
                    )}
                  </p>
                  {!reached && (
                    <Link href={`/installments/targets/${t.id}`} className="mt-2 inline-flex items-center gap-0.5 text-footnote font-medium text-accent">
                      {p.students_to_close.length} students to call <ChevronRight className="size-3.5" />
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {canWrite(viewer.role) && (
          <details className="group mt-4">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full bg-fill px-3.5 py-1.5 text-footnote font-medium text-ink hover:bg-[rgba(118,118,128,0.18)]">
              <Plus className="size-3.5" /> New target
            </summary>
            <div className="mt-4">
              <TargetForm sessionId={session.id} defaultDate={session.end_date} />
            </div>
          </details>
        )}
      </Card>
    </div>
  );
}
