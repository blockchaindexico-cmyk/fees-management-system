"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useApi } from "@/lib/api/hooks";
import { Check, HandCoins, Pencil, Phone, Sparkles, Users, Wallet, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtDate, num, pct, ratioPct, rupees, rupeesShort } from "@/lib/format";
import { PARTICIPANT_LABELS, PARTICIPANT_RESPONSES, VERDICT_LABELS, fmtPhone, type ParticipantResponse } from "@/lib/recovery";
import type { ActionState } from "@/lib/action-state";
import type { ActivityDetail, ActivityParticipant } from "@/lib/types";
import { useApp } from "@/components/layout/app-shell";
import { Pending } from "@/components/ui/page-state";
import { Badge } from "@/components/ui/badge";
import { StudentSearch } from "@/components/layout/student-search";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented, withParams } from "@/components/ui/segmented";
import { Card } from "@/components/ui/card";
import { Kpi } from "@/components/ui/kpi";
import { Legend, StackedBar } from "@/components/ui/bars";
import { Button, LinkButton } from "@/components/ui/button";
import { Field, FormError, FormSuccess, Input, Select } from "@/components/ui/form";
import { Avatar } from "@/components/ui/avatar";
import { Empty } from "@/components/ui/empty";
import { FeeStatusBadge } from "@/components/ui/status";
import { ParticipantBadge } from "@/components/recovery";
import { useFormAction } from "../../setup/_lib/use-form-action";
import { addClassToActivity, addStudentToActivity, countReceipt, removeParticipant, saveResponse } from "../actions";

const SHOW: { key: "all" | ParticipantResponse; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "pending", label: "Waiting" },
  { key: "positive", label: "Deposited" },
  { key: "partial", label: "Part" },
  { key: "negative", label: "Declined" },
];

export function ActivityView({ id, tab }: { id: string; tab?: string }) {
  const res = useApi<ActivityDetail>(`/api/activities/${id}`);
  if (!res.data) return <Pending queries={[res]} />;
  return <Detail d={res.data} tab={tab} />;
}

function Detail({ d, tab }: { d: ActivityDetail; tab?: string }) {
  const { writer } = useApp();
  const c = d.activity;
  const s = d.stats;
  const base = `/activities/${c.id}`;
  const v = VERDICT_LABELS[s.verdict];
  const show = SHOW.find((x) => x.key === tab)?.key ?? "all";
  const rows = d.rows.filter((r) => show === "all" || r.response === show);
  const responded = s.positive + s.partial + s.negative;

  return (
    <div className="space-y-5">
      <PageHeader
        title={c.name}
        crumbs={[{ label: "Activities", href: "/activities" }, { label: c.name }]}
        description={`From ${fmtDate(c.start_date)}${c.end_date ? ` to ${fmtDate(c.end_date)}` : ""}${c.status === "closed" ? " · closed" : ""}`}
        actions={
          writer && (
            <LinkButton href={`${base}/edit`}>
              <Pencil className="size-4" /> Edit
            </LinkButton>
          )
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={v.tone} title={v.hint}>
            {v.label}
          </Badge>
          {s.owed > 0 && (
            <span className="text-footnote text-ink-2">
              {s.won} of {s.owed} students who owe paid because of it ({pct(ratioPct(s.won, s.owed), 0)})
            </span>
          )}
        </div>
        {c.description && <p className="max-w-3xl text-subhead text-ink-2">{c.description}</p>}
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Users} color="indigo" label="Students" value={num(s.participants)} sub={<>{num(s.owing_now)} still owe {rupeesShort(s.overdue_now)} overdue</>} />
        <Kpi
          icon={Sparkles}
          color="green"
          label="Fees deposited"
          value={num(s.positive)}
          meter={ratioPct(s.positive + s.partial, s.participants)}
          sub={<>{s.partial} in part · {s.negative} declined · {s.pending} waiting</>}
        />
        <Kpi
          icon={HandCoins}
          color="teal"
          label="Counted for the activity"
          value={rupeesShort(s.credited)}
          meter={c.target_amount ? ratioPct(s.credited, c.target_amount) : undefined}
          hint="Receipts the accountant counted as paid because of this activity."
          sub={c.target_amount ? <>{pct(ratioPct(s.credited, c.target_amount), 0)} of {rupeesShort(c.target_amount)} · {s.credited_receipts} receipts</> : <>{s.credited_receipts} receipts</>}
        />
        <Kpi
          icon={Wallet}
          color="blue"
          label="Paid since it started"
          value={rupeesShort(s.paid_since)}
          hint="Everything these students paid between the start and the end (or today), counted for the activity or not."
          sub={<>{s.payers} of {s.participants} students paid something</>}
        />
      </div>

      {s.participants > 0 && (
        <Card title="Response">
          <StackedBar
            total={s.participants}
            segments={[
              { value: s.positive, className: "bg-good", label: "Fees deposited", display: String(s.positive) },
              { value: s.partial, className: "bg-warning", label: "Paid part", display: String(s.partial) },
              { value: s.negative, className: "bg-critical", label: "No / declined", display: String(s.negative) },
            ]}
          />
          <Legend
            className="mt-3"
            items={[
              { label: "Fees deposited", className: "bg-good", value: String(s.positive) },
              { label: "Paid part", className: "bg-warning", value: String(s.partial) },
              { label: "No / declined", className: "bg-critical", value: String(s.negative) },
              { label: "Waiting", className: "bg-fill", value: String(s.pending) },
            ]}
          />
          {responded > 0 && <p className="mt-3 text-footnote text-ink-2">{pct(ratioPct(s.positive + s.partial, responded), 0)} of the families who answered paid something.</p>}
        </Card>
      )}

      {writer && c.status === "active" && <AddStudents activityId={c.id} />}

      <div className="space-y-3">
        <Segmented
          options={SHOW.map((x) => ({
            label: `${x.label} ${x.key === "all" ? s.participants : d.rows.filter((r) => r.response === x.key).length}`,
            href: withParams(base, { tab: x.key === "all" ? undefined : x.key }),
            active: x.key === show,
          }))}
        />
        {rows.length === 0 ? (
          <Card>
            <Empty title={s.participants === 0 ? "No students yet" : "Nobody here"}>{s.participants === 0 && writer ? "Add a class or students above." : null}</Empty>
          </Card>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <Participant key={r.participant_id} r={r} activityId={c.id} writer={writer} since={c.start_date} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AddStudents({ activityId }: { activityId: string }) {
  const { classes } = useApp();
  const { state, pending, onSubmit } = useFormAction(addClassToActivity);
  const [busy, start] = useTransition();
  const [picked, setPicked] = useState<ActionState | null>(null);
  return (
    <Card title="Add students" description="A whole class (or section) of the running session, or one student at a time.">
      <div className="grid gap-5 lg:grid-cols-2">
        <form onSubmit={onSubmit} className="grid items-end gap-3 sm:grid-cols-[1fr_90px]">
          <input type="hidden" name="activity_id" value={activityId} />
          <Field label="Class" htmlFor="class_id">
            <Select id="class_id" name="class_id" required defaultValue="">
              <option value="" disabled>
                Choose a class
              </option>
              {classes
                .filter((k) => k.is_active)
                .map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Section" htmlFor="section">
            <Input id="section" name="section" placeholder="All" maxLength={10} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
            <input type="checkbox" name="only_with_dues" defaultChecked className="size-4 accent-[var(--accent)]" />
            Only students with overdue fees
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add class"}
            </Button>
            <div className="mt-2">
              <FormError message={state.error} />
              <FormSuccess message={state.message} />
            </div>
          </div>
        </form>
        <div>
          <p className="mb-1.5 text-footnote font-medium text-ink-2">Or one student</p>
          <StudentSearch
            mode="pick"
            placeholder={busy ? "Adding…" : "Search name or admission no"}
            onPick={(st) =>
              start(async () => {
                setPicked(null);
                setPicked(await addStudentToActivity(activityId, st.id));
              })
            }
          />
          <div className="mt-2">
            <FormError message={picked?.error} />
            <FormSuccess message={picked?.message} />
          </div>
        </div>
      </div>
    </Card>
  );
}

function Participant({ r, activityId, writer, since }: { r: ActivityParticipant; activityId: string; writer: boolean; since: string }) {
  const { state, pending, onSubmit } = useFormAction(saveResponse);
  const [busy, start] = useTransition();
  const [result, setResult] = useState<ActionState | null>(null);
  const run = (fn: () => Promise<ActionState>) =>
    start(async () => {
      setResult(null);
      const res = await fn();
      if (res.error) setResult(res);
    });

  return (
    <li className="rounded-[var(--radius-card)] bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start gap-3">
        <Avatar name={r.full_name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/students/${r.student_id}`} className="text-subhead font-semibold text-ink hover:text-accent">
              {r.full_name}
            </Link>
            <ParticipantBadge response={r.response} />
            <FeeStatusBadge status={r.fee_status} />
          </div>
          <p className="text-caption text-muted">
            {[r.class_name ? `${r.class_name} · ${r.section}` : null, r.admission_no].filter(Boolean).join(" · ")}
            {r.parent_id && (
              <>
                {" · "}
                <Link href={`/parents/${r.parent_id}`} className="text-accent">
                  {r.parent_name}
                </Link>
              </>
            )}
            {r.phone && (
              <>
                {" · "}
                <a href={`tel:${r.phone}`} className="inline-flex items-center gap-0.5 text-accent">
                  <Phone className="size-3" /> {fmtPhone(r.phone)}
                </a>
              </>
            )}
          </p>
          {r.concerns && <p className="mt-1 text-footnote text-ink-2">Parent&rsquo;s concern: {r.concerns}</p>}
        </div>
        <div className="text-right">
          <p className={cn("text-headline font-semibold tabular", r.total_overdue > 0 ? "text-critical-ink" : "text-good-ink")}>
            {r.total_overdue > 0 ? rupeesShort(r.total_overdue) : "Clear"}
          </p>
          <p className="text-caption text-muted">{r.total_overdue > 0 ? "overdue now" : "nothing overdue"}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-1.5 text-footnote font-medium text-ink-2">
            Receipts since {fmtDate(since)} {r.paid_since > 0 && <span className="text-muted">· {rupees(r.paid_since)} paid since it started</span>}
          </p>
          {r.receipts.length === 0 ? (
            <p className="text-footnote text-muted">Nothing paid since the activity started.</p>
          ) : (
            <ul className="space-y-1.5">
              {r.receipts.map((x) => (
                <li key={x.payment_id} className="flex flex-wrap items-center gap-2 text-subhead">
                  <Link href={`/payments/${x.payment_id}`} className="font-medium text-accent">
                    {x.receipt_no}
                  </Link>
                  <span className="text-footnote text-muted">{fmtDate(x.paid_on)}</span>
                  <span className="font-semibold tabular text-ink">{rupees(x.amount)}</span>
                  {x.credited_elsewhere ? (
                    <span className="text-caption text-muted">counted for {x.credited_elsewhere}</span>
                  ) : x.credited_here ? (
                    writer ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => run(() => countReceipt(x.payment_id, null))}
                        className="inline-flex items-center gap-1 rounded-full bg-good-soft px-2.5 py-0.5 text-caption font-semibold text-good-ink hover:opacity-80"
                        title="Stop counting this receipt for the activity"
                      >
                        <Check className="size-3" /> Counted
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-good-soft px-2.5 py-0.5 text-caption font-semibold text-good-ink">
                        <Check className="size-3" /> Counted
                      </span>
                    )
                  ) : (
                    writer && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => run(() => countReceipt(x.payment_id, r.participant_id))}
                        className="rounded-full bg-accent-soft px-2.5 py-0.5 text-caption font-semibold text-accent hover:bg-accent hover:text-accent-ink"
                      >
                        Paid because of this activity
                      </button>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
          <FormError message={result?.error} />
        </div>

        {writer ? (
          <form onSubmit={onSubmit} className="grid items-end gap-2 sm:grid-cols-[180px_1fr_auto]">
            <input type="hidden" name="activity_id" value={activityId} />
            <input type="hidden" name="participant_id" value={r.participant_id} />
            <Field label="Response" htmlFor={`resp-${r.participant_id}`}>
              <Select id={`resp-${r.participant_id}`} name="response" defaultValue={r.response}>
                {PARTICIPANT_RESPONSES.map((x) => (
                  <option key={x} value={x}>
                    {PARTICIPANT_LABELS[x].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Note" htmlFor={`note-${r.participant_id}`}>
              <Input id={`note-${r.participant_id}`} name="note" defaultValue={r.note ?? ""} placeholder="What the parent said" />
            </Field>
            <div className="flex gap-1">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "…" : "Save"}
              </Button>
              <button
                type="button"
                disabled={busy}
                aria-label="Remove from the activity"
                title="Remove from the activity"
                onClick={() => {
                  if (confirm(`Remove ${r.full_name} from the activity?`)) run(() => removeParticipant(activityId, r.participant_id));
                }}
                className="inline-flex size-8 items-center justify-center rounded-full text-muted hover:bg-fill hover:text-critical-ink"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="sm:col-span-3">
              <FormError message={state.error} />
            </div>
          </form>
        ) : (
          r.note && <p className="text-footnote text-ink-2">{r.note}</p>
        )}
      </div>
    </li>
  );
}
