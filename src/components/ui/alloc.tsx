import type { AllocationLine } from "@/lib/types";
import { rupees } from "@/lib/format";
import { cn } from "@/lib/cn";

const KIND: Record<AllocationLine["kind"], { label: string; dot: string; chip: string }> = {
  current: { label: "This year", dot: "bg-series-1", chip: "bg-accent-soft text-accent" },
  arrears: { label: "Old dues", dot: "bg-series-2", chip: "bg-serious-soft text-serious-ink" },
  advance: { label: "Advance", dot: "bg-series-3", chip: "bg-[rgba(48,176,199,0.14)] text-[#1b7f91] dark:text-[#5fd0e2]" },
};

export function allocText(a: AllocationLine): string {
  if (!a.installment) return `Advance ${rupees(a.amount)}`;
  // one-off items (e.g. "Admission Fee") carry a fee head of the same name; say it once
  const head = a.fee_head && a.fee_head !== a.installment ? ` · ${a.fee_head}` : "";
  return `${a.session} · ${a.installment}${head} ${rupees(a.amount)}`;
}

/** "What it paid for": one compact chip per session + installment, coloured by kind. */
export function AllocLines({ lines, compact = false }: { lines: AllocationLine[]; compact?: boolean }) {
  if (!lines || lines.length === 0) return <span className="text-muted">—</span>;
  const groups = new Map<string, { kind: AllocationLine["kind"]; title: string; amount: number; heads: string[]; inferred: boolean }>();
  for (const a of lines) {
    const key = `${a.kind}|${a.session}|${a.installment_no}`;
    const title = a.installment ? `${a.session} · ${a.installment}` : "Advance";
    const g = groups.get(key) ?? { kind: a.kind, title, amount: 0, heads: [], inferred: false };
    g.amount += a.amount;
    if (a.fee_head && !g.heads.includes(a.fee_head)) g.heads.push(a.fee_head);
    g.inferred = g.inferred || !!a.is_inferred;
    groups.set(key, g);
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {[...groups.values()].map((g, i) => (
        <span
          key={i}
          title={`${KIND[g.kind].label}: ${g.heads.join(", ")}${g.inferred ? " (split by the default rule)" : ""}`}
          className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-[3px] font-medium", compact ? "text-caption" : "text-footnote", KIND[g.kind].chip)}
        >
          <span className={cn("size-1.5 rounded-full", KIND[g.kind].dot)} aria-hidden />
          {g.title}
          <span className="font-semibold tabular">{rupees(g.amount)}</span>
        </span>
      ))}
    </div>
  );
}

export const KIND_LEGEND = [
  { label: "This year", className: "bg-series-1" },
  { label: "Old dues", className: "bg-series-2" },
  { label: "Advance", className: "bg-series-3" },
];
