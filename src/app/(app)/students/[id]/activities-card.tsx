"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Plus, Sparkles, UserPlus, X } from "lucide-react";
import { useApi } from "@/lib/api/hooks";
import { fmtDate, fmtDateTime, pct, ratioPct, rupees, rupeesShort } from "@/lib/format";
import { PARTICIPANT_LABELS, PARTICIPANT_RESPONSES } from "@/lib/recovery";
import type { ActionState } from "@/lib/action-state";
import type { RecoveryActivity, StudentRecovery } from "@/lib/types";
import { useApp } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui/form";
import { IconTile } from "@/components/ui/kpi";
import { Meter } from "@/components/ui/bars";
import { Empty } from "@/components/ui/empty";
import { ParticipantBadge } from "@/components/recovery";
import { useFormAction } from "../../setup/_lib/use-form-action";
import { addStudentToActivity, saveResponse } from "../../activities/actions";
import { createStudentActivity } from "./activity-actions";

type Activity = StudentRecovery["activities"][number];

/**
 * Fee recovery activities of one student: what is being done, how the family responded and what came in since.
 * Admins and accountants record the response here, start an activity for this student alone, or add them to a
 * running one. Receipts are counted for an activity on its own page (or at the fee counter).
 */
export function ActivitiesCard({ studentId, studentName, overdue }: { studentId: string; studentName: string; overdue: number }) {
  const { writer } = useApp();
  const res = useApi<StudentRecovery>(`/api/students/${studentId}/recovery`);
  const running = useApi<RecoveryActivity[]>(writer ? "/api/activities?running=1" : null);
  const [mode, setMode] = useState<"list" | "new" | "join">("list");
  const [notice, setNotice] = useState<string | null>(null);
  if (!res.data) return null;
  const { activities, parent, today } = res.data;
  const first = studentName.split(" ")[0];
  const joinable = (running.data ?? []).filter((c) => !activities.some((a) => a.activity_id === c.id));
  const done = (message?: string) => {
    setMode("list");
    setNotice(message ?? null);
  };

  return (
    <Card
      title="Recovery activities"
      description="Things the school does for this student that also help bring the fees in (extra practice, a trip, a club…), how the family responded and what was paid since."
      actions={
        writer &&
        mode === "list" && (
          <>
            {joinable.length > 0 && (
              <Button
                size="sm"
                onClick={() => {
                  setNotice(null);
                  setMode("join");
                }}
              >
                <UserPlus className="size-3.5" /> Add to running
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setNotice(null);
                setMode("new");
              }}
            >
              <Plus className="size-3.5" /> New activity for {first}
            </Button>
          </>
        )
      }
    >
      <FormSuccess message={notice} />
      {mode === "new" && (
        <NewActivity studentId={studentId} first={first} concern={parent?.concerns ?? null} overdue={overdue} today={today} onDone={done} />
      )}
      {mode === "join" && <JoinActivity studentId={studentId} options={joinable} onDone={done} />}

      {activities.length === 0 ? (
        mode === "list" && (
          <Empty title="No activities yet" icon={Sparkles}>
            {parent?.concerns ? <>Parent&rsquo;s concern: {parent.concerns}. </> : null}
            {writer ? `Start one for ${first}, or add ${first} to an activity that is running.` : null}
          </Empty>
        )
      ) : (
        <ul className={notice || mode !== "list" ? "mt-4 space-y-3" : "space-y-3"}>
          {activities.map((a) => (
            <ActivityItem key={a.participant_id} a={a} first={first} writer={writer} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ActivityItem({ a, first, writer }: { a: Activity; first: string; writer: boolean }) {
  const { state, pending, onSubmit } = useFormAction(saveResponse);
  const others = a.participants - 1;
  return (
    <li className="rounded-2xl bg-fill-2 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <IconTile icon={Sparkles} color="indigo" size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/activities/${a.activity_id}`} className="text-subhead font-semibold text-ink hover:text-accent">
              {a.name}
            </Link>
            <ParticipantBadge response={a.response} />
            <Badge>{others > 0 ? `with ${others} other${others === 1 ? "" : "s"}` : `just ${first}`}</Badge>
            {a.status === "closed" && <Badge>Closed</Badge>}
          </div>
          <p className="text-caption text-muted">
            From {fmtDate(a.start_date)}
            {a.end_date ? ` to ${fmtDate(a.end_date)}` : ""}
          </p>
          {a.description && <p className="mt-1.5 text-footnote text-ink-2">{a.description}</p>}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-surface p-3 text-center sm:grid-cols-3">
        <div>
          <dd className="text-headline font-semibold tabular text-ink">{rupeesShort(a.paid_since)}</dd>
          <dt className="text-caption text-muted">paid since it started</dt>
        </div>
        <div>
          <dd className="text-headline font-semibold tabular text-good-ink">{rupeesShort(a.credited)}</dd>
          <dt className="text-caption text-muted">
            counted for it{a.credited_receipts > 0 ? ` · ${a.credited_receipts} receipt${a.credited_receipts === 1 ? "" : "s"}` : ""}
          </dt>
        </div>
        {a.target_amount && others === 0 ? (
          <div className="col-span-2 sm:col-span-1">
            <dd className="text-headline font-semibold tabular text-ink">{pct(ratioPct(a.credited, a.target_amount), 0)}</dd>
            <dt className="text-caption text-muted">of the {rupeesShort(a.target_amount)} target</dt>
            <Meter value={ratioPct(a.credited, a.target_amount)} className="mt-1.5" color="bg-good" track="bg-good-soft" />
          </div>
        ) : null}
      </dl>

      {writer ? (
        <form onSubmit={onSubmit} className="mt-3 grid items-end gap-2 sm:grid-cols-[180px_1fr_auto]">
          <input type="hidden" name="activity_id" value={a.activity_id} />
          <input type="hidden" name="participant_id" value={a.participant_id} />
          <Field label="Response" htmlFor={`sresp-${a.participant_id}`}>
            <Select id={`sresp-${a.participant_id}`} name="response" defaultValue={a.response}>
              {PARTICIPANT_RESPONSES.map((x) => (
                <option key={x} value={x}>
                  {PARTICIPANT_LABELS[x].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="What the family said" htmlFor={`snote-${a.participant_id}`}>
            <Input id={`snote-${a.participant_id}`} name="note" defaultValue={a.note ?? ""} placeholder="e.g. Will pay after the first class" />
          </Field>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <div className="sm:col-span-3">
            <FormError message={state.error} />
          </div>
        </form>
      ) : (
        a.note && <p className="mt-3 text-footnote text-ink">{a.note}</p>
      )}

      <p className="mt-2 flex flex-wrap items-center justify-between gap-2 text-caption text-muted">
        <span>
          {a.response === "pending" ? (
            <>Added on {fmtDate(a.added_on)}</>
          ) : (
            <>
              Response recorded {fmtDateTime(a.updated_at)}
              {a.updated_by_name ? ` by ${a.updated_by_name}` : ""}
            </>
          )}
        </span>
        <Link href={`/activities/${a.activity_id}`} className="font-medium text-accent">
          {writer ? "Count receipts for it" : "Open activity"}
        </Link>
      </p>
    </li>
  );
}

function NewActivity({
  studentId,
  first,
  concern,
  overdue,
  today,
  onDone,
}: {
  studentId: string;
  first: string;
  concern: string | null;
  overdue: number;
  today: string;
  onDone: (message?: string) => void;
}) {
  const { state, pending, onSubmit } = useFormAction(async (prev: ActionState, fd: FormData) => {
    const r = await createStudentActivity(prev, fd);
    if (r.ok) onDone(r.message);
    return r;
  });
  return (
    <form onSubmit={onSubmit} className="mb-4 space-y-3 rounded-2xl border border-line p-4">
      <input type="hidden" name="student_id" value={studentId} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-subhead font-semibold text-ink">New activity for {first}</p>
          {concern && <p className="text-footnote text-ink-2">Parent&rsquo;s concern: {concern}</p>}
        </div>
        <button type="button" onClick={() => onDone()} aria-label="Close" className="rounded-full p-1 text-muted hover:bg-fill hover:text-ink">
          <X className="size-4" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name *" htmlFor="act_name" className="sm:col-span-2">
          <Input id="act_name" name="name" required autoFocus placeholder={`e.g. Spoken English practice for ${first}`} />
        </Field>
        <Field label="What we do, and what we ask of the parents" htmlFor="act_description" className="sm:col-span-2">
          <Textarea
            id="act_description"
            name="description"
            rows={2}
            placeholder="e.g. 30 minutes of speaking practice after school, three days a week; parents asked to clear the pending installment"
          />
        </Field>
        <Field label="Starts *" htmlFor="act_start">
          <Input id="act_start" name="start_date" type="date" required defaultValue={today} />
        </Field>
        <Field label="Ends" htmlFor="act_end" hint="Optional.">
          <Input id="act_end" name="end_date" type="date" />
        </Field>
        <Field label="Fees to recover (₹)" htmlFor="act_target" hint={overdue > 0 ? `Overdue now: ${rupees(overdue)}.` : "Optional."}>
          <Input id="act_target" name="target_amount" inputMode="decimal" />
        </Field>
      </div>
      <FormError message={state.error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Creating…" : "Create activity"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => onDone()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function JoinActivity({ studentId, options, onDone }: { studentId: string; options: RecoveryActivity[]; onDone: (message?: string) => void }) {
  const [activityId, setActivityId] = useState(options[0]?.id ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mb-4 space-y-3 rounded-2xl border border-line p-4">
      <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto_auto]">
        <Field label="Running activity" htmlFor="join_activity">
          <Select id="join_activity" value={activityId} onChange={(e) => setActivityId(e.target.value)}>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          type="button"
          variant="primary"
          disabled={pending || !activityId}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await addStudentToActivity(activityId, studentId);
              if (r.error) setError(r.error);
              else onDone(r.message);
            })
          }
        >
          {pending ? "Adding…" : "Add"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => onDone()}>
          Cancel
        </Button>
      </div>
      <FormError message={error} />
    </div>
  );
}
