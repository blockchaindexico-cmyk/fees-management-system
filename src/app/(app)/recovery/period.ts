// The period picked on the recovery dashboard (URL: ?period=today|yesterday|7d|30d|year|custom&from&to).

import { addDays, isIsoDate } from "@/lib/dates";
import { fmtDate } from "@/lib/format";

export const PERIODS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "year", label: "This year" },
  { key: "custom", label: "Custom" },
] as const;

export type PeriodKey = (typeof PERIODS)[number]["key"];

export type Period = { key: PeriodKey; from: string; to: string; label: string; before: string };

/** Dates of a period ending today (the school year starts at `yearStart`). A custom range needs both dates. */
export function resolvePeriod(key: string | undefined, from: string | undefined, to: string | undefined, today: string, yearStart: string | null): Period {
  switch (key) {
    case "today":
      return { key, from: today, to: today, label: "Today", before: "yesterday" };
    case "yesterday":
      return { key, from: addDays(today, -1), to: addDays(today, -1), label: "Yesterday", before: "the day before" };
    case "30d":
      return { key, from: addDays(today, -29), to: today, label: "Last 30 days", before: "the 30 days before" };
    case "year":
      if (yearStart && yearStart <= today) return { key, from: yearStart, to: today, label: "This school year", before: "the same number of days before" };
      break;
    case "custom":
      if (isIsoDate(from) && isIsoDate(to) && from <= to) {
        return { key, from, to, label: from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`, before: "the same number of days before" };
      }
      break;
  }
  return { key: "7d", from: addDays(today, -6), to: today, label: "Last 7 days", before: "the 7 days before" };
}
