"use client";

import { useTransition } from "react";
import { Ban, PhoneCall, PhoneMissed, PhoneOff, PhoneOutgoing, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtDate, fmtTime, rupees } from "@/lib/format";
import { OUTCOME_LABELS, PICKED_BY_LABELS, PURPOSE_LABELS, RESPONSE_LABELS, type CallOutcome } from "@/lib/recovery";
import type { ParentCall } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { PromiseLine } from "@/components/recovery";
import { deleteCall } from "./actions";

const ICON: Record<CallOutcome, React.ElementType> = {
  connected: PhoneCall,
  no_answer: PhoneMissed,
  busy: PhoneOutgoing,
  switched_off: PhoneOff,
  wrong_number: Ban,
};

/** Every call to the family, newest first: what it was about, who picked up, what they said and how the promise turned out. */
export function CallHistory({ parentId, calls, canDelete, limit }: { parentId: string; calls: ParentCall[]; canDelete: boolean; limit?: number }) {
  if (calls.length === 0) return <Empty title="No calls yet" icon={PhoneCall}>Calls logged for this family show here with what was said.</Empty>;
  const shown = limit ? calls.slice(0, limit) : calls;
  return (
    <ol className="relative space-y-1 before:absolute before:bottom-2 before:left-[19px] before:top-2 before:w-px before:bg-line">
      {shown.map((c) => {
        const Icon = ICON[c.outcome];
        return (
          <li key={c.id} className="relative flex gap-4 rounded-2xl py-2.5 pr-2">
            <span
              className={cn(
                "relative z-10 mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-white",
                c.outcome === "connected" ? "bg-tile-blue" : "bg-tile-gray",
              )}
              aria-hidden
            >
              <Icon className="size-4" strokeWidth={2.2} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-subhead font-semibold text-ink">
                  {OUTCOME_LABELS[c.outcome]}
                  {c.picked_by && <span className="font-normal text-ink-2"> · {PICKED_BY_LABELS[c.picked_by]}</span>}
                </span>
                <span className="flex items-center gap-1 text-footnote text-muted">
                  {fmtDate(c.call_date)}
                  {canDelete && <DeleteCallButton parentId={parentId} callId={c.id} />}
                </span>
              </div>
              {(c.response || c.purpose !== "fees") && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {c.purpose !== "fees" && <Badge tone="neutral">{PURPOSE_LABELS[c.purpose].label}</Badge>}
                  {c.response && (
                    <Badge tone={c.response === "will_pay" ? "accent" : c.response === "refused" || c.response === "complaint" ? "critical" : "neutral"}>
                      {RESPONSE_LABELS[c.response]}
                    </Badge>
                  )}
                </div>
              )}
              {c.summary && <p className="mt-1.5 whitespace-pre-wrap text-subhead text-ink">{c.summary}</p>}
              {c.promised_date && (
                <p className="mt-1.5 text-footnote">
                  <PromiseLine
                    date={c.promised_date}
                    amount={c.promised_amount}
                    status={c.promise?.status ?? null}
                    timing={c.promise?.timing}
                    paid={c.promise?.paid}
                  />
                </p>
              )}
              {c.follow_up_on && <p className="mt-1 text-footnote text-accent">Call again on {fmtDate(c.follow_up_on)}</p>}
              {c.recovered > 0 && <p className="mt-1 text-footnote font-medium text-good-ink">{rupees(c.recovered)} paid because of this call</p>}
              <p className="mt-1 text-caption text-muted">
                {c.author ?? "Staff"} · {fmtTime(c.called_at)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function DeleteCallButton({ parentId, callId }: { parentId: string; callId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-label="Delete call"
      onClick={() => {
        if (confirm("Delete this call from the history?")) start(async () => void (await deleteCall(parentId, callId)));
      }}
      className="rounded-full p-1 text-muted transition-colors hover:bg-fill hover:text-critical-ink"
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}
