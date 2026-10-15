"use client";

import { useState } from "react";
import { Copy, RotateCcw, Save, Users } from "lucide-react";
import type { ActionState } from "@/lib/action-state";
import { fmtDateShort, parseRupees, rupees } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError, FormSuccess, Select } from "@/components/ui/form";
import { useFormAction } from "../_lib/use-form-action";
import { plural } from "../_lib/text";
import { applyStructure, copyStructure, saveStructure } from "./actions";

type Inst = { id: string; number: number; name: string; due_date: string };
type Head = { id: string; name: string; priority: number; is_active: boolean };

const key = (h: string, i: string) => `${h}|${i}`;
const toInput = (paise: number | undefined) => (paise ? String(paise / 100) : "");

export function FeeStructureEditor({
  sessionId,
  sessionName,
  cls,
  installments,
  heads,
  amounts,
  otherClasses,
  stats,
}: {
  sessionId: string;
  sessionName: string;
  cls: { id: string; name: string };
  installments: Inst[];
  heads: Head[];
  amounts: Record<string, number>;
  otherClasses: { id: string; name: string; hasStructure: boolean }[];
  stats: { enrolled: number; withCharges: number; sessionWithoutPlan: number | null };
}) {
  const initialValues = () => {
    const v: Record<string, string> = {};
    for (const h of heads) for (const i of installments) v[key(h.id, i.id)] = toInput(amounts[key(h.id, i.id)]);
    return v;
  };
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  // save and copy share a card: only the latest of the two messages is shown
  const [last, setLast] = useState<"save" | "copy" | null>(null);

  const parsed = (k: string): number | null => {
    const raw = (values[k] ?? "").trim();
    if (raw === "") return 0;
    const p = parseRupees(raw);
    return p === null || p < 0 ? null : p;
  };
  const invalid = Object.keys(values).filter((k) => parsed(k) === null);
  const dirty = Object.keys(values).some((k) => (parsed(k) ?? -1) !== (amounts[k] ?? 0));

  const rowTotal = (h: string) => installments.reduce((s, i) => s + (parsed(key(h, i.id)) ?? 0), 0);
  const colTotal = (i: string) => heads.reduce((s, h) => s + (parsed(key(h.id, i)) ?? 0), 0);
  const grand = heads.reduce((s, h) => s + rowTotal(h.id), 0);

  const save = useFormAction(async (prev: ActionState, fd: FormData) => {
    setLast("save");
    return saveStructure(prev, fd);
  });
  const copy = useFormAction(async (prev: ActionState, fd: FormData) => {
    setLast("copy");
    const res = await copyStructure(prev, fd);
    if (res.ok && res.data) {
      const copied = res.data as Record<string, number>;
      const v: Record<string, string> = {};
      for (const h of heads) for (const i of installments) v[key(h.id, i.id)] = toInput(copied[key(h.id, i.id)]);
      setValues(v);
    }
    return res;
  });
  const apply = useFormAction(applyStructure);

  const cells = heads.flatMap((h) => installments.map((i) => ({ installment_id: i.id, fee_head_id: h.id, amount: values[key(h.id, i.id)] ?? "" })));
  const without = stats.enrolled - stats.withCharges;

  return (
    <div className="space-y-4">
      <Card
        title={`${cls.name} · ${sessionName}`}
        description="Amount in rupees each student of this class pays, per installment and fee head. Leave a cell blank (or 0) when nothing is charged."
      >
        <form onSubmit={save.onSubmit}>
          <input type="hidden" name="session_id" value={sessionId} />
          <input type="hidden" name="class_id" value={cls.id} />
          <input type="hidden" name="cells" value={JSON.stringify(cells)} />
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[520px] border-collapse text-subhead">
              <thead className="bg-surface-2 text-caption text-muted">
                <tr>
                  <th scope="col" className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-left font-medium uppercase tracking-wide">
                    Fee head
                  </th>
                  {installments.map((i) => (
                    <th key={i.id} scope="col" className="px-2 py-2 text-right font-medium" title={i.name}>
                      <span className="block uppercase tracking-wide">{i.name}</span>
                      <span className="block font-normal">due {fmtDateShort(i.due_date)}</span>
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 text-right font-medium uppercase tracking-wide">
                    Year total
                  </th>
                </tr>
              </thead>
              <tbody className="tabular">
                {heads.map((h) => (
                  <tr key={h.id} className="border-t border-line">
                    <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-left font-medium text-ink">
                      <span className="block whitespace-nowrap">{h.name}</span>
                      {!h.is_active && <Badge className="mt-0.5">inactive</Badge>}
                    </th>
                    {installments.map((i) => {
                      const k = key(h.id, i.id);
                      const bad = parsed(k) === null;
                      const changed = !bad && (parsed(k) ?? 0) !== (amounts[k] ?? 0);
                      return (
                        <td key={i.id} className="px-1.5 py-1.5">
                          <input
                            value={values[k] ?? ""}
                            onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                            inputMode="decimal"
                            placeholder="0"
                            aria-label={`${h.name}, ${i.name} (rupees)`}
                            aria-invalid={bad || undefined}
                            className={cn(
                              "h-8 w-full min-w-[84px] rounded-md border bg-surface px-2 text-right text-subhead tabular text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
                              bad ? "border-critical bg-critical-soft" : changed ? "border-accent bg-accent-soft/50" : "border-line-strong",
                            )}
                          />
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-3 py-1.5 text-right font-medium text-ink">{rupees(rowTotal(h.id))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="tabular">
                <tr className="border-t-2 border-line-strong bg-surface-2 font-semibold text-ink">
                  <th scope="row" className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-left">
                    Installment total
                  </th>
                  {installments.map((i) => (
                    <td key={i.id} className="whitespace-nowrap px-3 py-2 text-right">
                      {rupees(colTotal(i.id))}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-2 text-right">{rupees(grand)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" disabled={save.pending || invalid.length > 0 || !dirty}>
              <Save className="size-4" aria-hidden /> {save.pending ? "Saving…" : "Save amounts"}
            </Button>
            <Button type="button" variant="ghost" disabled={!dirty || save.pending} onClick={() => setValues(initialValues())}>
              <RotateCcw className="size-4" aria-hidden /> Undo changes
            </Button>
            {invalid.length > 0 ? (
              <span className="text-footnote text-critical-ink">Fix the highlighted amounts (numbers only, up to 2 decimals).</span>
            ) : dirty ? (
              <Badge tone="warning">Unsaved changes</Badge>
            ) : null}
          </div>
          <div className="mt-2 space-y-2">
            {last === "save" && <FormError message={save.state.error} />}
            {last === "save" && !dirty && <FormSuccess message={save.state.ok ? save.state.message : null} />}
          </div>
        </form>

        <form onSubmit={copy.onSubmit} className="mt-4 border-t border-line pt-4">
          <input type="hidden" name="session_id" value={sessionId} />
          <input type="hidden" name="class_id" value={cls.id} />
          <label htmlFor="copy-from" className="block text-footnote font-medium text-ink-2">
            Copy amounts from another class
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Select id="copy-from" name="from_class" defaultValue="" className="w-auto min-w-[200px] flex-1 sm:max-w-xs">
              <option value="" disabled>
                Choose a class…
              </option>
              {otherClasses.map((c) => (
                <option key={c.id} value={c.id} disabled={!c.hasStructure}>
                  {c.name}
                  {c.hasStructure ? "" : " (no amounts)"}
                </option>
              ))}
            </Select>
            <Button
              type="submit"
              disabled={copy.pending}
              data-confirm={`Replace all ${cls.name} amounts in ${sessionName} with the chosen class's amounts? This saves immediately.`}
            >
              <Copy className="size-4" aria-hidden /> {copy.pending ? "Copying…" : "Copy and save"}
            </Button>
          </div>
          <div className="mt-2 space-y-2">
            {last === "copy" && <FormError message={copy.state.error} />}
            {last === "copy" && <FormSuccess message={copy.state.ok ? copy.state.message : null} />}
          </div>
        </form>
      </Card>

      <Card
        title="Apply to students"
        description="Turns the saved structure into each enrolled student's charges. Only active students get charges."
      >
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-footnote text-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <Users className="size-4 text-muted" aria-hidden />
            <b className="text-ink">{stats.enrolled}</b> active {stats.enrolled === 1 ? "student" : "students"} in {cls.name}
          </span>
          <span>
            <b className="text-ink">{stats.withCharges}</b> already have charges
          </span>
          {without > 0 && (
            <Badge tone="warning">
              {plural(without, "student")} without charges
            </Badge>
          )}
          {stats.sessionWithoutPlan !== null && stats.sessionWithoutPlan > 0 && (
            <span className="text-muted">· {plural(stats.sessionWithoutPlan, "student")} without charges across the session</span>
          )}
        </div>
        <form onSubmit={apply.onSubmit} className="space-y-3">
          <input type="hidden" name="session_id" value={sessionId} />
          <input type="hidden" name="class_id" value={cls.id} />
          <input type="hidden" name="class_name" value={cls.name} />
          <label className="flex items-start gap-2 text-footnote text-ink">
            <input type="checkbox" name="overwrite" className="mt-0.5 size-4 accent-[var(--accent)]" />
            <span>
              Also update existing charges generated from the structure
              <span className="block text-caption text-muted">
                Changes amounts that differ from the structure and removes structure charges no longer in it. Concessions are kept (capped
                at the new amount); manually added charges such as transport are never touched.
              </span>
            </span>
          </label>
          {dirty && <p className="text-footnote text-critical-ink">Save your changes first: applying uses the saved amounts.</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" name="intent" value="class" variant="primary" disabled={apply.pending || dirty || stats.enrolled === 0}>
              {apply.pending ? "Applying…" : `Apply to ${cls.name}`}
            </Button>
            <Button
              type="submit"
              name="intent"
              value="all"
              disabled={apply.pending || dirty}
              data-confirm={`Apply the fee structure to every class in ${sessionName}?`}
            >
              Apply to all classes
            </Button>
          </div>
          <FormError message={apply.state.error} />
          <FormSuccess message={apply.state.ok ? apply.state.message : null} />
        </form>
        <p className="mt-4 border-t border-line pt-3 text-footnote text-muted">
          Without the tick, applying only adds charges students are missing (new students, new installments or fee heads), so it is
          always safe to run again. Concessions and transport are set per student on the student&apos;s fee page.
        </p>
      </Card>
    </div>
  );
}
