"use client";

import { Trash2 } from "lucide-react";
import { useApi } from "@/lib/api/hooks";
import type { ActivityDetail } from "@/lib/types";
import { RequireRole } from "@/components/layout/app-shell";
import { Pending } from "@/components/ui/page-state";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form";
import { useFormAction } from "../../../setup/_lib/use-form-action";
import { deleteActivity } from "../../actions";
import { ActivityForm } from "../../activity-form";

export function EditActivity({ id }: { id: string }) {
  return (
    <RequireRole role="writer">
      <Editor id={id} />
    </RequireRole>
  );
}

function Editor({ id }: { id: string }) {
  const res = useApi<ActivityDetail>(`/api/activities/${id}`, { refreshInterval: 0, revalidateOnFocus: false });
  if (!res.data) return <Pending queries={[res]} />;
  const d = res.data;
  return (
    <>
      <PageHeader title={d.activity.name} crumbs={[{ label: "Activities", href: "/activities" }, { label: d.activity.name, href: `/activities/${id}` }, { label: "Edit" }]} />
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ActivityForm activity={d.activity} today={d.today} />
        </div>
        <DeleteCard id={id} used={d.stats.credited_receipts > 0} />
      </div>
    </>
  );
}

function DeleteCard({ id, used }: { id: string; used: boolean }) {
  const { state, pending, onSubmit } = useFormAction(deleteActivity);
  return (
    <Card title="Delete">
      {used ? (
        <p className="text-footnote text-ink-2">Receipts are already counted for it. Set its status to Closed instead, so the results stay on record.</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <p className="text-footnote text-ink-2">No receipt is counted for it yet. The students&rsquo; responses go with it.</p>
          <FormError message={state.error} />
          <Button type="submit" variant="danger" disabled={pending} data-confirm="Delete this activity?">
            <Trash2 className="size-4" /> {pending ? "Deleting…" : "Delete"}
          </Button>
        </form>
      )}
    </Card>
  );
}
