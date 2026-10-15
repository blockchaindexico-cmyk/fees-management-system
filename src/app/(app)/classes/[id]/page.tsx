import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { flag, getActiveSession, param } from "@/lib/context";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, pct, ratioPct, rupeesShort } from "@/lib/format";
import type { ClassDetail, FeeStatus, StudentBalance } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented, withParams } from "@/components/ui/segmented";
import { Card } from "@/components/ui/card";
import { Legend, StackedBar } from "@/components/ui/bars";
import { DataTable } from "@/components/ui/data-table";
import { Ring } from "@/components/ui/ring";
import { FEE_STATUS } from "@/components/ui/status";
import { CollectionTrendChart } from "@/components/charts/charts";
import { NoSession } from "@/components/no-session";

export const metadata = { title: "Class" };

const STATUS_KEYS: FeeStatus[] = ["paid_up", "partial", "arrears_only", "not_paying", "free"];
const STATUS_DOT: Record<string, string> = { paid_up: "bg-good", partial: "bg-warning", arrears_only: "bg-serious", not_paying: "bg-critical", free: "bg-tile-gray" };

export default async function ClassPage({ params, searchParams }: PageProps<"/classes/[id]">) {
  await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  const session = await getActiveSession();
  if (!session) return <NoSession />;
  const arrears = flag(sp.arrears, false);
  const section = param(sp.section);
  const supabase = await createClient();

  const [detailRes, studentsRes] = await Promise.all([
    supabase.rpc("class_detail", { p_session: session.id, p_class: id, p_include_arrears: arrears }),
    (() => {
      let q = supabase.rpc("student_balances", { p_session: session.id }).eq("class_id", id);
      if (section) q = q.eq("section", section);
      return q.order("section").order("full_name");
    })(),
  ]);
  if (detailRes.error?.message?.includes("Unknown")) notFound();
  if (detailRes.error || !detailRes.data) throw new Error(detailRes.error?.message ?? "Could not load class");
  const d = detailRes.data as ClassDetail;
  const k = d.kpis;
  const students = ((studentsRes.data ?? []) as StudentBalance[]).map((s) => ({
    ...s,
    who: `Roll ${s.roll_no ?? "—"} · ${s.section}${s.father_name ? " · " + s.father_name : ""}`,
    show_pending: arrears ? s.total_pending : s.pending,
    show_overdue: arrears ? s.total_overdue : s.overdue,
  }));
  const url = (extra: Record<string, string | boolean | undefined>) => withParams(`/classes/${id}`, { arrears: arrears || undefined, section, ...extra });
  const collected = ratioPct(k.received, k.expected) ?? 0;
  const bandsTotal = k.bands.full + k.bands.over_half + k.bands.under_half + k.bands.nothing;

  return (
    <div className="space-y-5">
      <PageHeader
        title={d.class.name}
        description={`${d.session.name} · ${k.students} students${section ? ` · section ${section}` : ""}`}
        crumbs={[{ label: "Classes", href: withParams("/classes", { arrears: arrears || undefined }) }]}
      >
        <Segmented
          options={[
            { label: "This session", href: url({ arrears: undefined }), active: !arrears },
            { label: "Including old dues", href: url({ arrears: true }), active: arrears },
          ]}
        />
        {d.sections.length > 1 && (
          <Segmented
            options={[
              { label: "All sections", href: url({ section: undefined }), active: !section },
              ...d.sections.map((s) => ({ label: s.section, href: url({ section: s.section }), active: section === s.section })),
            ]}
          />
        )}
      </PageHeader>

      <section className="rounded-[28px] bg-surface p-6 shadow-card sm:p-8">
        <div className="flex flex-col gap-8 md:flex-row md:items-center">
          <Ring value={collected} size={168} stroke={16} className="self-center">
            <span className="figure text-[32px] leading-none">{Math.round(collected)}%</span>
            <span className="mt-1 text-footnote text-ink-2">collected</span>
          </Ring>
          <div className="min-w-0 flex-1">
            <div className="grid grid-cols-3 gap-6">
              <div>
                <p className="text-footnote text-ink-2">Collected</p>
                <p className="figure mt-1 text-title1">{rupeesShort(k.received)}</p>
                <p className="text-caption text-muted">of {rupeesShort(k.expected)}</p>
              </div>
              <div>
                <p className="text-footnote text-ink-2">Pending</p>
                <p className="figure mt-1 text-title1">{rupeesShort(k.pending)}</p>
                <p className="text-caption text-muted">{arrears ? `incl. ${rupeesShort(k.prev_pending)} old` : "this session"}</p>
              </div>
              <div>
                <p className="text-footnote text-ink-2">Overdue</p>
                <p className={`figure mt-1 text-title1 ${k.overdue > 0 ? "text-critical-ink" : "text-good-ink"}`}>{rupeesShort(k.overdue)}</p>
                <p className="text-caption text-muted">{pct(ratioPct(k.due_expected - k.overdue, k.due_expected), 0)} of due paid</p>
              </div>
            </div>
            <div className="mt-6">
              <StackedBar
                segments={STATUS_KEYS.map((s) => ({ value: k.status[s as keyof typeof k.status] ?? 0, className: STATUS_DOT[s], label: FEE_STATUS[s].label, display: String(k.status[s as keyof typeof k.status] ?? 0) }))}
              />
              <Legend
                className="mt-3"
                items={STATUS_KEYS.filter((s) => (k.status[s as keyof typeof k.status] ?? 0) > 0).map((s) => ({
                  label: FEE_STATUS[s].label,
                  className: STATUS_DOT[s],
                  value: String(k.status[s as keyof typeof k.status]),
                }))}
              />
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="By month" description="Money from this class each month next to installments due. Click a month to see which students paid.">
          <CollectionTrendChart
            data={d.months.map((m) => ({ ...m, advance: 0 }))}
            includeArrears={arrears}
            hrefBase="/monthly/"
            hrefSuffix={`/${id}${arrears ? "?arrears=1" : ""}`}
            height={220}
          />
        </Card>
        <Card title="Installments">
          <ul className="space-y-4">
            {d.installments.map((i) => (
              <li key={i.id}>
                <Link href={`/installments/${i.number}`} className="group flex items-center gap-4 rounded-2xl p-1 transition-colors hover:bg-fill-2">
                  <Ring value={i.collection_pct} size={56} stroke={7}>
                    <span className="text-caption font-semibold tabular">{Math.round(i.collection_pct ?? 0)}%</span>
                  </Ring>
                  <span className="min-w-0 flex-1">
                    <span className="block text-subhead font-semibold text-ink group-hover:text-accent">{i.name}</span>
                    <span className="block text-caption text-muted">Due {fmtDate(i.due_date)}</span>
                  </span>
                  <span className="text-right">
                    <span className={`block text-subhead font-semibold tabular ${i.gap > 0 ? "text-critical-ink" : "text-good-ink"}`}>{rupeesShort(i.gap)}</span>
                    <span className="block text-caption text-muted">gap</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-6 border-t border-line pt-5">
            <p className="mb-3 text-footnote font-medium text-ink-2">Share of fees paid</p>
            <StackedBar
              total={bandsTotal}
              segments={[
                { value: k.bands.full, className: "bg-good", label: "100%", display: String(k.bands.full) },
                { value: k.bands.over_half, className: "bg-warning", label: "50–99%", display: String(k.bands.over_half) },
                { value: k.bands.under_half, className: "bg-serious", label: "1–49%", display: String(k.bands.under_half) },
                { value: k.bands.nothing, className: "bg-critical", label: "0%", display: String(k.bands.nothing) },
              ]}
            />
            <Legend
              className="mt-3"
              items={[
                { label: "100%", className: "bg-good", value: String(k.bands.full) },
                { label: "50–99%", className: "bg-warning", value: String(k.bands.over_half) },
                { label: "1–49%", className: "bg-serious", value: String(k.bands.under_half) },
                { label: "0%", className: "bg-critical", value: String(k.bands.nothing) },
              ]}
            />
          </div>
        </Card>
      </div>

      <Card title="Students">
        <DataTable
          rows={students as unknown as Record<string, unknown>[]}
          searchKeys={["full_name", "admission_no", "father_name", "phone", "roll_no"]}
          filters={[
            { key: "fee_status", label: "Status", options: STATUS_KEYS.map((s) => ({ value: s, label: FEE_STATUS[s].label })) },
            ...(d.sections.length > 1 ? [{ key: "section", label: "Section", options: d.sections.map((s) => ({ value: s.section, label: s.section })) }] : []),
          ]}
          totals
          pageSize={50}
          exportName={`${d.class.name}-${d.session.name}`}
          exportMeta={[`${d.class.name} · Session ${d.session.name}`, arrears ? "Pending includes previous dues" : "Current session only"]}
          columns={[
            { key: "full_name", label: "Student", type: "person", href: "/students/{student_id}", sub: "who" },
            { key: "received", label: "Paid", type: "money", total: true, hideOnMobile: true },
            { key: "show_pending", label: "Pending", type: "money", total: true },
            { key: "show_overdue", label: "Overdue", type: "money", total: true, alertPositive: true },
            { key: "last_paid_on", label: "Last paid", type: "date", hideOnMobile: true },
            { key: "fee_status", label: "Status", type: "status" },
          ]}
        />
      </Card>
    </div>
  );
}
