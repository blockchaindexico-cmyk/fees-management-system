"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { compactAxis, rupees } from "@/lib/format";

const X_AXIS = { stroke: "var(--chart-axis)", tickLine: false, axisLine: false, tick: { fontSize: 11 }, tickMargin: 8 } as const;
const Y_AXIS = { stroke: "var(--chart-axis)", tickLine: false, axisLine: false, tick: { fontSize: 11 }, width: 46 } as const;

type SeriesKey = { key: string; label: string; color: string; shape: "rect" | "line" };

function ChartTooltip({
  active,
  payload,
  label,
  series,
  footer,
  format = rupees,
}: Partial<TooltipContentProps<number, string>> & {
  series: SeriesKey[];
  footer?: (row: Record<string, unknown>) => string | null;
  format?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Record<string, unknown>;
  return (
    <div className="min-w-[190px] rounded-2xl bg-glass px-3.5 py-3 text-footnote shadow-pop backdrop-blur-xl">
      <div className="mb-1.5 font-semibold text-ink">{String(row?.tooltipLabel ?? label)}</div>
      <ul className="space-y-1">
        {series.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-5">
            <span className="inline-flex items-center gap-2 text-ink-2">
              <span className={s.shape === "line" ? "h-[3px] w-3 rounded-full" : "size-2 rounded-full"} style={{ background: s.color }} aria-hidden />
              {s.label}
            </span>
            <span className="font-semibold tabular text-ink">{format(Number(row?.[s.key] ?? 0))}</span>
          </li>
        ))}
      </ul>
      {footer && footer(row) && <div className="mt-2 border-t border-line pt-1.5 text-caption text-muted">{footer(row)}</div>}
    </div>
  );
}

export function ChartLegend({ items }: { items: SeriesKey[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-footnote text-ink-2">
      {items.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className={s.shape === "line" ? "h-[3px] w-3.5 rounded-full" : "size-2 rounded-full"} style={{ background: s.color }} aria-hidden />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function ViewToggle<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="no-print inline-flex rounded-[10px] bg-fill p-[2px] text-caption" role="group" aria-label="Chart view">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={
            value === o.value
              ? "rounded-[8px] bg-surface px-2.5 py-[3px] font-medium text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12)] dark:bg-surface-3"
              : "rounded-[8px] px-2.5 py-[3px] font-medium text-ink-2 hover:text-ink"
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Month-by-month collection across a session.
 * Monthly: scheduled (neutral column) beside received (stacked by what it paid for).
 * Cumulative: running totals of scheduled vs received.
 */
export function CollectionTrendChart({
  data,
  includeArrears,
  hrefBase,
  hrefSuffix = "",
  height = 260,
}: {
  data: {
    month: string;
    label: string;
    expected: number;
    current: number;
    arrears: number;
    advance: number;
    cum_expected?: number;
    cum_current?: number;
    cum_received?: number;
    is_future?: boolean;
  }[];
  includeArrears: boolean;
  hrefBase?: string;
  hrefSuffix?: string;
  height?: number;
}) {
  const router = useRouter();
  const gid = useId().replace(/:/g, "");
  const [view, setView] = useState<"monthly" | "cumulative">("monthly");
  const hasCumulative = data.some((d) => d.cum_expected !== undefined);

  const monthly: SeriesKey[] = [
    { key: "expected", label: "Due", color: "var(--series-track)", shape: "rect" },
    { key: "current", label: "This year", color: "var(--series-1)", shape: "rect" },
    ...(includeArrears
      ? ([
          { key: "arrears", label: "Old dues", color: "var(--series-2)", shape: "rect" },
          { key: "advance", label: "Advance", color: "var(--series-3)", shape: "rect" },
        ] as SeriesKey[])
      : []),
  ];
  const cumulative: SeriesKey[] = [
    { key: "cum_expected", label: "Due so far", color: "var(--ink-2)", shape: "line" },
    { key: "cum_current", label: "Collected so far", color: "var(--series-1)", shape: "line" },
  ];
  const rows = data.map((d) => ({ ...d, tooltipLabel: d.label, cum_current: d.is_future ? null : d.cum_current }));
  const onClick = (e: unknown) => {
    const idx = (e as { activeTooltipIndex?: number | string } | null)?.activeTooltipIndex;
    if (hrefBase && idx !== undefined && idx !== null && rows[Number(idx)]) router.push(`${hrefBase}${rows[Number(idx)].month}${hrefSuffix}`);
  };
  const series = view === "monthly" ? monthly : cumulative;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <ChartLegend items={series} />
        {hasCumulative && (
          <ViewToggle
            value={view}
            onChange={setView}
            options={[
              { value: "monthly", label: "Monthly" },
              { value: "cumulative", label: "Running total" },
            ]}
          />
        )}
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {view === "monthly" ? (
            <ComposedChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -6 }} onClick={onClick} barGap={3} barCategoryGap="28%"
              style={{ cursor: hrefBase ? "pointer" : undefined }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="label" {...X_AXIS} interval={0} minTickGap={2} />
              <YAxis {...Y_AXIS} tickFormatter={(v) => compactAxis(Number(v))} />
              <Tooltip
                cursor={{ fill: "var(--fill-2)", radius: 8 }}
                content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} series={monthly} footer={() => (hrefBase ? "Click to open this month" : null)} />}
              />
              <Bar dataKey="expected" fill="var(--series-track)" maxBarSize={18} radius={[6, 6, 6, 6]} isAnimationActive={false} />
              <Bar dataKey="current" stackId="r" fill="var(--series-1)" maxBarSize={18} radius={includeArrears ? [0, 0, 6, 6] : [6, 6, 6, 6]} isAnimationActive={false} />
              {includeArrears && <Bar dataKey="arrears" stackId="r" fill="var(--series-2)" maxBarSize={18} isAnimationActive={false} />}
              {includeArrears && <Bar dataKey="advance" stackId="r" fill="var(--series-3)" maxBarSize={18} radius={[6, 6, 0, 0]} isAnimationActive={false} />}
            </ComposedChart>
          ) : (
            <ComposedChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -6 }} onClick={onClick} style={{ cursor: hrefBase ? "pointer" : undefined }}>
              <defs>
                <linearGradient id={`cum-${gid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="label" {...X_AXIS} interval={0} minTickGap={2} />
              <YAxis {...Y_AXIS} tickFormatter={(v) => compactAxis(Number(v))} />
              <Tooltip cursor={{ stroke: "var(--line-strong)" }} content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} series={cumulative} />} />
              <Line type="stepAfter" dataKey="cum_expected" stroke="var(--ink-2)" strokeWidth={2} strokeOpacity={0.55} dot={false} isAnimationActive={false} />
              <Area type="monotone" dataKey="cum_current" stroke="var(--series-1)" strokeWidth={2.5} fill={`url(#cum-${gid})`}
                dot={false} activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Money received per day in a month, with a running-total view. */
export function DailyCollectionChart({
  data,
  target,
  height = 230,
}: {
  data: { date: string; day: number; amount: number; count: number; cumulative?: number; is_future: boolean }[];
  target?: number;
  height?: number;
}) {
  const gid = useId().replace(/:/g, "");
  const [view, setView] = useState<"daily" | "cumulative">("daily");
  const canCumulate = data.some((d) => d.cumulative !== undefined);
  const daily: SeriesKey[] = [{ key: "amount", label: "Collected", color: "var(--series-1)", shape: "rect" }];
  const cum: SeriesKey[] = [{ key: "cumulative", label: "Collected so far", color: "var(--series-1)", shape: "line" }];
  const rows = data.map((d) => ({
    ...d,
    cumulative: d.is_future ? null : d.cumulative,
    tooltipLabel: `Day ${d.day} · ${d.count} payment${d.count === 1 ? "" : "s"}`,
  }));
  const max = Math.max(target ?? 0, ...data.map((d) => d.cumulative ?? 0)) * 1.08;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <ChartLegend items={view === "daily" ? daily : [...cum, ...(target ? [{ key: "t", label: "Expected", color: "var(--ink-2)", shape: "line" as const }] : [])]} />
        {canCumulate && (
          <ViewToggle
            value={view}
            onChange={setView}
            options={[
              { value: "daily", label: "Daily" },
              { value: "cumulative", label: "Running total" },
            ]}
          />
        )}
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {view === "daily" ? (
            <ComposedChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -6 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="day" {...X_AXIS} interval="preserveStartEnd" minTickGap={10} />
              <YAxis {...Y_AXIS} tickFormatter={(v) => compactAxis(Number(v))} />
              <Tooltip cursor={{ fill: "var(--fill-2)", radius: 6 }} content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} series={daily} />} />
              <Bar dataKey="amount" fill="var(--series-1)" maxBarSize={14} radius={[5, 5, 5, 5]} isAnimationActive={false} />
            </ComposedChart>
          ) : (
            <ComposedChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -6 }}>
              <defs>
                <linearGradient id={`d-${gid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="day" {...X_AXIS} interval="preserveStartEnd" minTickGap={10} />
              <YAxis {...Y_AXIS} domain={[0, max || 1]} tickFormatter={(v) => compactAxis(Number(v))} />
              <Tooltip cursor={{ stroke: "var(--line-strong)" }} content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} series={cum} />} />
              {target ? <ReferenceLine y={target} stroke="var(--ink-2)" strokeOpacity={0.55} strokeWidth={1.5} /> : null}
              <Area type="monotone" dataKey="cumulative" stroke="var(--series-1)" strokeWidth={2.5} fill={`url(#d-${gid})`} dot={false}
                activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }} connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** @deprecated use DailyCollectionChart's running-total view */
export function CumulativeChart({
  data,
  target,
  height = 220,
}: {
  data: { date: string; day: number; cumulative: number; is_future: boolean }[];
  target: number;
  height?: number;
}) {
  return <DailyCollectionChart data={data.map((d) => ({ ...d, amount: 0, count: 0 }))} target={target} height={height} />;
}

/**
 * Money received per day (week, month), stacked by what brought it in: a call, an activity, or the family paid on
 * its own (neutral). Blue / teal / track from the validated palette; orange stays reserved for old dues.
 */
export function RecoverySourceChart({
  data,
  height = 240,
}: {
  data: { label: string; tooltipLabel: string; calls: number; activities: number; direct: number }[];
  height?: number;
}) {
  const series: SeriesKey[] = [
    { key: "calls", label: "After a call", color: "var(--series-1)", shape: "rect" },
    { key: "activities", label: "From an activity", color: "var(--series-3)", shape: "rect" },
    { key: "direct", label: "Paid on their own", color: "var(--series-track)", shape: "rect" },
  ];
  return (
    <div>
      <div className="mb-4">
        <ChartLegend items={series} />
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -6 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="label" {...X_AXIS} interval="preserveStartEnd" minTickGap={12} />
            <YAxis {...Y_AXIS} tickFormatter={(v) => compactAxis(Number(v))} />
            <Tooltip
              cursor={{ fill: "var(--fill-2)", radius: 6 }}
              content={(p) => (
                <ChartTooltip
                  {...(p as TooltipContentProps<number, string>)}
                  series={series}
                  footer={(r) => `Total ${rupees(Number(r.calls ?? 0) + Number(r.activities ?? 0) + Number(r.direct ?? 0))}`}
                />
              )}
            />
            <Bar dataKey="calls" stackId="m" fill="var(--series-1)" maxBarSize={22} isAnimationActive={false} />
            <Bar dataKey="activities" stackId="m" fill="var(--series-3)" maxBarSize={22} isAnimationActive={false} />
            <Bar dataKey="direct" stackId="m" fill="var(--series-track)" maxBarSize={22} radius={[5, 5, 0, 0]} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Calls per day (week, month): picked up (blue) on top of the ones that did not get through (neutral). */
export function CallsTrendChart({
  data,
  height = 200,
}: {
  data: { label: string; tooltipLabel: string; connected: number; not_reached: number }[];
  height?: number;
}) {
  const series: SeriesKey[] = [
    { key: "connected", label: "Picked up", color: "var(--series-1)", shape: "rect" },
    { key: "not_reached", label: "Not reached", color: "var(--series-track)", shape: "rect" },
  ];
  const count = (v: number) => `${v} ${v === 1 ? "call" : "calls"}`;
  return (
    <div>
      <div className="mb-4">
        <ChartLegend items={series} />
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="label" {...X_AXIS} interval="preserveStartEnd" minTickGap={12} />
            <YAxis {...Y_AXIS} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "var(--fill-2)", radius: 6 }}
              content={(p) => (
                <ChartTooltip
                  {...(p as TooltipContentProps<number, string>)}
                  series={series}
                  format={count}
                  footer={(r) => count(Number(r.connected ?? 0) + Number(r.not_reached ?? 0))}
                />
              )}
            />
            <Bar dataKey="connected" stackId="c" fill="var(--series-1)" maxBarSize={22} isAnimationActive={false} />
            <Bar dataKey="not_reached" stackId="c" fill="var(--series-track)" maxBarSize={22} radius={[5, 5, 0, 0]} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
