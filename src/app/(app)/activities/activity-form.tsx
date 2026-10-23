"use client";

import type { RecoveryActivity } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Field, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui/form";
import { Button, LinkButton } from "@/components/ui/button";
import { toRupeeInput } from "../students/helpers";
import { useFormAction } from "../setup/_lib/use-form-action";
import { saveActivity } from "./actions";

/** Name, dates, description and target of a student activity (new or existing). */
export function ActivityForm({ activity, today }: { activity?: RecoveryActivity; today: string }) {
  const { state, pending, onSubmit } = useFormAction(saveActivity);
  const a = activity;
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {a && <input type="hidden" name="id" value={a.id} />}
      <Card title="Activity">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Name *" htmlFor="name" className="sm:col-span-2">
            <Input id="name" name="name" required defaultValue={a?.name ?? ""} autoFocus={!a} placeholder="e.g. English speaking club for Class 6–7" />
          </Field>
          <Field label="Starts *" htmlFor="start_date">
            <Input id="start_date" name="start_date" type="date" required defaultValue={a?.start_date ?? today} />
          </Field>
          <Field label="Ends" htmlFor="end_date" hint="Optional.">
            <Input id="end_date" name="end_date" type="date" defaultValue={a?.end_date ?? ""} />
          </Field>
          <Field label="What we do, and what we ask of the parents" htmlFor="description" className="sm:col-span-2 lg:col-span-4">
            <Textarea
              id="description"
              name="description"
              rows={2}
              defaultValue={a?.description ?? ""}
              placeholder="e.g. Extra spoken-English practice three days a week; parents asked to clear pending fees so the school can run it"
            />
          </Field>
          <Field label="Fees to recover (₹)" htmlFor="target_amount" hint="Optional. Shown as progress.">
            <Input id="target_amount" name="target_amount" inputMode="decimal" defaultValue={toRupeeInput(a?.target_amount)} />
          </Field>
          {a && (
            <Field label="Status" htmlFor="status" hint="A closed activity keeps its results.">
              <Select id="status" name="status" defaultValue={a.status}>
                <option value="active">Running</option>
                <option value="closed">Closed</option>
              </Select>
            </Field>
          )}
        </div>
        {!a && <p className="mt-4 text-footnote text-ink-2">Next you add the students: a whole class, or one by one.</p>}
      </Card>

      <FormError message={state.error} />
      <FormSuccess message={state.ok && !state.redirect ? state.message : null} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : a ? "Save changes" : "Create activity"}
        </Button>
        <LinkButton href={a ? `/activities/${a.id}` : "/activities"} variant="ghost">
          Cancel
        </LinkButton>
      </div>
    </form>
  );
}
