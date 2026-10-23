"use client";

import type { Parent } from "@/lib/types";
import { ATTITUDES, ATTITUDE_LABELS, BEHAVIOURS, BEHAVIOUR_LABELS, ECONOMIC, ECONOMIC_LABELS, RELATIONS, RELATION_LABELS, type Behaviour } from "@/lib/recovery";
import { Card } from "@/components/ui/card";
import { Field, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui/form";
import { Button, LinkButton } from "@/components/ui/button";
import { useFormAction } from "../setup/_lib/use-form-action";
import { saveParent } from "./actions";

export function ParentForm({ parent, habit }: { parent?: Parent; habit?: Behaviour }) {
  const { state, pending, onSubmit } = useFormAction(saveParent);
  const editing = !!parent;
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {parent && <input type="hidden" name="id" value={parent.id} />}

      <Card title="Contact">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name *" htmlFor="name">
            <Input id="name" name="name" required defaultValue={parent?.name ?? ""} autoFocus={!editing} />
          </Field>
          <Field label="Relation" htmlFor="relation">
            <Select id="relation" name="relation" defaultValue={parent?.relation ?? "father"}>
              {RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {RELATION_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Phone *" htmlFor="phone" hint="One profile per number: students with this number join this family.">
            <Input id="phone" name="phone" type="tel" inputMode="tel" required defaultValue={parent?.phone ?? ""} />
          </Field>
          <Field label="Other phone" htmlFor="alt_phone" hint="e.g. the mother's number. New admissions with it join too.">
            <Input id="alt_phone" name="alt_phone" type="tel" inputMode="tel" defaultValue={parent?.alt_phone ?? ""} />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" defaultValue={parent?.email ?? ""} />
          </Field>
          <Field label="Occupation" htmlFor="occupation">
            <Input id="occupation" name="occupation" defaultValue={parent?.occupation ?? ""} placeholder="e.g. Shop owner, private job" />
          </Field>
          <Field label="Address" htmlFor="address" className="sm:col-span-2 lg:col-span-3">
            <Textarea id="address" name="address" rows={2} defaultValue={parent?.address ?? ""} />
          </Field>
          {editing && (
            <label className="flex items-start gap-2 text-sm text-ink sm:col-span-2 lg:col-span-3">
              <input type="checkbox" name="update_children_phone" defaultChecked className="mt-0.5 size-4 accent-[var(--accent)]" />
              <span>
                If the phone number changes, give the children the new number too
                <span className="block text-caption text-muted">Keeps the family together and sends reminders to the right phone.</span>
              </span>
            </label>
          )}
        </div>
      </Card>

      <Card title="Fees and means" description="Your judgement, used to decide whom to call first and how. It never changes any amount.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Economic condition" htmlFor="economic_status">
            <Select id="economic_status" name="economic_status" defaultValue={parent?.economic_status ?? ""}>
              <option value="">Not known</option>
              {ECONOMIC.map((e) => (
                <option key={e} value={e}>
                  {ECONOMIC_LABELS[e]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="How they pay" htmlFor="payment_behaviour" hint={habit ? "Suggested from the payment records." : undefined}>
            <Select id="payment_behaviour" name="payment_behaviour" defaultValue={habit ?? parent?.payment_behaviour ?? ""}>
              <option value="">Not known</option>
              {BEHAVIOURS.map((b) => (
                <option key={b} value={b} title={BEHAVIOUR_LABELS[b].hint}>
                  {BEHAVIOUR_LABELS[b].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="How they deal with the school" htmlFor="attitude">
            <Select id="attitude" name="attitude" defaultValue={parent?.attitude ?? ""}>
              <option value="">Not known</option>
              {ATTITUDES.map((a) => (
                <option key={a} value={a}>
                  {ATTITUDE_LABELS[a]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Best time to call" htmlFor="best_time_to_call">
            <Input id="best_time_to_call" name="best_time_to_call" defaultValue={parent?.best_time_to_call ?? ""} placeholder="e.g. After 7 pm" />
          </Field>
        </div>
      </Card>

      <Card title="What we know about them" description="Notes for whoever talks to the family next.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Main concern about their child" htmlFor="concerns">
            <Textarea id="concerns" name="concerns" rows={2} defaultValue={parent?.concerns ?? ""} placeholder="e.g. Weak in English speaking, maths marks" />
          </Field>
          <Field label="What matters most to them" htmlFor="priorities">
            <Textarea id="priorities" name="priorities" rows={2} defaultValue={parent?.priorities ?? ""} placeholder="e.g. Results, safety, activities, fee concession" />
          </Field>
          <Field label="How they behave, what they talk about" htmlFor="behaviour_notes" className="sm:col-span-2">
            <Textarea
              id="behaviour_notes"
              name="behaviour_notes"
              rows={3}
              defaultValue={parent?.behaviour_notes ?? ""}
              placeholder="e.g. Polite, keeps their word; prefers WhatsApp; mother handles the fees"
            />
          </Field>
          <Field label="Remarks" htmlFor="remarks" className="sm:col-span-2">
            <Textarea id="remarks" name="remarks" rows={2} defaultValue={parent?.remarks ?? ""} />
          </Field>
        </div>
      </Card>

      <FormError message={state.error} />
      <FormSuccess message={state.message} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Add parent"}
        </Button>
        <LinkButton href={parent ? `/parents/${parent.id}` : "/parents"} variant="ghost">
          {editing ? "Back to profile" : "Cancel"}
        </LinkButton>
      </div>
    </form>
  );
}
