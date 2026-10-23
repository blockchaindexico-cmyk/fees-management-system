"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Merge, Trash2 } from "lucide-react";
import { param, type SearchParams } from "@/lib/context";
import { useApi } from "@/lib/api/hooks";
import { BEHAVIOURS, type Behaviour } from "@/lib/recovery";
import type { ActionState } from "@/lib/action-state";
import type { Parent360 } from "@/lib/types";
import { RequireRole } from "@/components/layout/app-shell";
import { StudentSearch } from "@/components/layout/student-search";
import { Pending } from "@/components/ui/page-state";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, FormError, FormSuccess, Input } from "@/components/ui/form";
import { FeeStatusBadge } from "@/components/ui/status";
import { useFormAction } from "../../../setup/_lib/use-form-action";
import { addChild, deleteParent, mergeParent } from "../../actions";
import { ParentForm } from "../../parent-form";

export function EditParent({ id, sp }: { id: string; sp: SearchParams }) {
  return (
    <RequireRole role="writer">
      <Editor id={id} sp={sp} />
    </RequireRole>
  );
}

function Editor({ id, sp }: { id: string; sp: SearchParams }) {
  const res = useApi<Parent360>(`/api/parents/${id}`, { refreshInterval: 0, revalidateOnFocus: false });
  if (!res.data) return <Pending queries={[res]} />;
  const d = res.data;
  const habit = param(sp.habit);

  return (
    <>
      <PageHeader title={d.parent.name} crumbs={[{ label: "Parents", href: "/parents" }, { label: d.parent.name, href: `/parents/${id}` }, { label: "Edit" }]} />
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ParentForm parent={d.parent} habit={BEHAVIOURS.includes(habit as Behaviour) ? (habit as Behaviour) : undefined} />
        </div>
        <div className="space-y-4">
          <Children id={id} d={d} />
          <MergeCard id={id} />
          <DeleteCard id={id} kids={d.children.length} calls={d.calls.length} />
        </div>
      </div>
    </>
  );
}

function Children({ id, d }: { id: string; d: Parent360 }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionState | null>(null);
  return (
    <Card title="Children" description="Students join automatically by phone number. Add a brother or sister here when they were admitted with another number.">
      <ul className="space-y-2">
        {d.children.length === 0 && <li className="text-footnote text-muted">No children in this family yet.</li>}
        {d.children.map((c) => (
          <li key={c.student_id} className="flex items-center gap-3">
            <Avatar name={c.full_name} size="sm" />
            <Link href={`/students/${c.student_id}`} className="min-w-0 flex-1 truncate text-subhead font-medium text-ink hover:text-accent">
              {c.full_name}
              <span className="block text-caption font-normal text-muted">{[c.class_name, c.admission_no, c.phone].filter(Boolean).join(" · ")}</span>
            </Link>
            <FeeStatusBadge status={c.fee_status} />
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <StudentSearch
          mode="pick"
          placeholder={pending ? "Adding…" : "Add a child: search name or admission no"}
          onPick={(s) =>
            start(async () => {
              setResult(null);
              setResult(await addChild(id, s.id));
            })
          }
        />
        <div className="mt-2">
          <FormError message={result?.error} />
          <FormSuccess message={result?.message} />
        </div>
      </div>
    </Card>
  );
}

function MergeCard({ id }: { id: string }) {
  const { state, pending, onSubmit } = useFormAction(mergeParent);
  return (
    <Card title="Same family, two profiles?" description="Moves the children and the call history to the other profile and keeps this number as its other phone. This profile is then removed.">
      <form onSubmit={onSubmit} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <Field label="Phone number of the profile to keep" htmlFor="merge_phone">
          <Input id="merge_phone" name="phone" type="tel" inputMode="tel" required />
        </Field>
        <FormError message={state.error} />
        <Button type="submit" disabled={pending} data-confirm="Merge this profile into the other one? This cannot be undone.">
          <Merge className="size-4" /> {pending ? "Merging…" : "Merge into that profile"}
        </Button>
      </form>
    </Card>
  );
}

function DeleteCard({ id, kids, calls }: { id: string; kids: number; calls: number }) {
  const { state, pending, onSubmit } = useFormAction(deleteParent);
  const blocked = kids > 0 || calls > 0;
  return (
    <Card title="Delete profile">
      {blocked ? (
        <p className="text-footnote text-ink-2">
          {kids > 0 ? "It still has children." : "It has call history."} To remove it, merge it into the right profile instead.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <p className="text-footnote text-ink-2">This profile has no children and no calls.</p>
          <FormError message={state.error} />
          <Button type="submit" variant="danger" disabled={pending} data-confirm="Delete this parent profile?">
            <Trash2 className="size-4" /> {pending ? "Deleting…" : "Delete profile"}
          </Button>
        </form>
      )}
    </Card>
  );
}
