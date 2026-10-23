"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { SchoolSettings } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui/form";
import { updateAllocationRule, updateCallRules, updateSchoolProfile } from "./actions";
import { toRupeeInput } from "../students/helpers";
import { useFormAction } from "./use-form-action";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function SchoolProfileForm({ settings }: { settings: SchoolSettings }) {
  const [state, onSubmit, pending] = useFormAction(updateSchoolProfile);
  return (
    <Card title="School profile" description="Printed on receipts and reports.">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="School name *" htmlFor="school_name" className="sm:col-span-2">
            <Input id="school_name" name="school_name" required defaultValue={settings.school_name} />
          </Field>
          <Field label="Address" htmlFor="address" className="sm:col-span-2">
            <Textarea id="address" name="address" rows={2} defaultValue={settings.address ?? ""} />
          </Field>
          <Field label="Phone" htmlFor="phone">
            <Input id="phone" name="phone" type="tel" defaultValue={settings.phone ?? ""} />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" defaultValue={settings.email ?? ""} />
          </Field>
          <Field label="Affiliation" htmlFor="affiliation" className="sm:col-span-2" hint="For example: Affiliated to CBSE, New Delhi (No. 1234567)">
            <Input id="affiliation" name="affiliation" defaultValue={settings.affiliation ?? ""} />
          </Field>
          <Field
            label="Receipt prefix *"
            htmlFor="receipt_prefix"
            hint={`New receipts look like ${settings.receipt_prefix}2627/00001 (prefix + session + number). Existing receipt numbers never change.`}
          >
            <Input id="receipt_prefix" name="receipt_prefix" required maxLength={12} defaultValue={settings.receipt_prefix} />
          </Field>
          <Field label="Sessions start in" htmlFor="session_start_month" hint="Used to suggest dates for new sessions.">
            <Select id="session_start_month" name="session_start_month" defaultValue={String(settings.session_start_month)}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Receipt footer" htmlFor="receipt_footer" className="sm:col-span-2">
            <Textarea id="receipt_footer" name="receipt_footer" rows={2} defaultValue={settings.receipt_footer ?? ""} />
          </Field>
        </div>
        <FormError message={state.error} />
        <FormSuccess message={state.message} />
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
      </form>
    </Card>
  );
}

const RULES = [
  {
    value: "oldest_first",
    label: "Oldest dues first — previous sessions before current fees (recommended)",
    hint: "A payment first clears unpaid fees from earlier sessions, then this session's installments in due-date order.",
  },
  {
    value: "current_first",
    label: "Current session first, then oldest dues",
    hint: "A payment first clears the running session's installments; older dues are cleared only after that.",
  },
] as const;

export function AllocationRuleForm({ current }: { current: SchoolSettings["allocation_order"] }) {
  const [state, onSubmit, pending] = useFormAction(updateAllocationRule);
  const [choice, setChoice] = useState<string>(current);
  const changed = choice !== current;

  return (
    <Card
      title="Payment allocation rule"
      description="How a payment is split across a student's dues when the counter does not pick specific installments."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="sr-only">Allocation rule</legend>
          {RULES.map((r) => (
            <label
              key={r.value}
              className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft/40"
            >
              <input
                type="radio"
                name="allocation_order"
                value={r.value}
                checked={choice === r.value}
                onChange={() => setChoice(r.value)}
                className="mt-1 size-4 accent-[var(--accent)]"
              />
              <span>
                <span className="block text-sm font-medium text-ink">
                  {r.label}
                  {r.value === current && <span className="ml-2 text-caption font-normal text-muted">(current)</span>}
                </span>
                <span className="mt-0.5 block text-footnote text-ink-2">{r.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="flex items-start gap-2 rounded-2xl bg-warning-soft px-3 py-2 text-footnote text-ink">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Changing the rule re-runs the allocation of <b>every payment ever recorded</b>. Receipts and amounts do not change, but what each
            payment paid for (and therefore previous-dues recovery, class and month figures) will. Closed months keep their frozen numbers.
          </span>
        </p>
        <FormError message={state.error} />
        <FormSuccess message={state.message} />
        <Button type="submit" variant={changed ? "primary" : "secondary"} disabled={pending || !changed}>
          {pending ? "Re-matching all payments…" : changed ? "Change rule and re-run allocation" : "No change"}
        </Button>
      </form>
    </Card>
  );
}

/** The rules that build the daily call list (Calls page), and the grace days of a payment promise. */
export function CallRulesForm({ settings }: { settings: SchoolSettings }) {
  const [state, onSubmit, pending] = useFormAction(updateCallRules);
  return (
    <Card
      id="call-rules"
      title="Daily call list"
      description="Every day the system lists the families to call, best first. These rules decide who is on the list and when a family comes back to it."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Call families owing at least (₹ overdue)" htmlFor="min_overdue">
            <Input id="min_overdue" name="min_overdue" inputMode="decimal" required defaultValue={toRupeeInput(settings.call_min_overdue)} />
          </Field>
          <Field label="High dues from (₹)" htmlFor="high_due" hint="Families owing this much are called first.">
            <Input id="high_due" name="high_due" inputMode="decimal" required defaultValue={toRupeeInput(settings.call_high_due)} />
          </Field>
          <Field label="Skip families who paid in the last (days)" htmlFor="skip_paid_days" hint="A family that paid recently is not called.">
            <Input id="skip_paid_days" name="skip_paid_days" type="number" min={0} max={180} required defaultValue={settings.call_skip_paid_days} />
          </Field>
          <Field label="After a call that got through, wait (days)" htmlFor="gap_days" hint="If nobody picks up, the family is tried again the next day.">
            <Input id="gap_days" name="gap_days" type="number" min={1} max={60} required defaultValue={settings.call_gap_days} />
          </Field>
          <Field
            label="Grace days after a promised date"
            htmlFor="grace_days"
            hint="With 1: promised for the 18th, paid on the 19th = kept; not paid by the 19th = back on the list on the 20th."
          >
            <Input id="grace_days" name="grace_days" type="number" min={0} max={30} required defaultValue={settings.promise_grace_days} />
          </Field>
          <Field label="Families a caller gets at a time" htmlFor="batch">
            <Input id="batch" name="batch" type="number" min={1} max={100} required defaultValue={settings.call_batch} />
          </Field>
        </div>
        <FormError message={state.error} />
        <FormSuccess message={state.message} />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </form>
    </Card>
  );
}
