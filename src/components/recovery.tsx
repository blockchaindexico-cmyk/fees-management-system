import { CheckCircle2, CircleAlert, Clock, Hourglass, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fmtDate, rupees } from "@/lib/format";
import {
  BEHAVIOUR_LABELS, ECONOMIC_LABELS, PARTICIPANT_LABELS, PROMISE_LABELS, REASON_LABELS, TIMING_LABELS,
  type Behaviour, type Economic, type ParticipantResponse, type PromiseStatus, type PromiseTiming, type CallReason,
} from "@/lib/recovery";

// Small displays shared by the parent and recovery screens. Status always comes with an icon and a label.

const PROMISE_ICON: Record<PromiseStatus, React.ElementType> = { kept: CheckCircle2, pending: Hourglass, partial: CircleAlert, broken: XCircle };

export function PromiseBadge({ status, timing }: { status: PromiseStatus | null | undefined; timing?: PromiseTiming | null }) {
  if (!status) return null;
  const s = PROMISE_LABELS[status];
  const Icon = PROMISE_ICON[status];
  return (
    <Badge tone={s.tone} title={timing ? TIMING_LABELS[timing] : undefined}>
      <Icon className="size-3" aria-hidden /> {s.label}
      {timing === "early" && " early"}
    </Badge>
  );
}

/** "₹5,000 by 18 Oct" with its result. */
export function PromiseLine({
  date,
  amount,
  status,
  timing,
  paid,
}: {
  date: string;
  amount: number | null;
  status: PromiseStatus | null;
  timing?: PromiseTiming | null;
  paid?: number | null;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="font-medium text-ink">
        Promised {amount ? rupees(amount) : "to pay"} by {fmtDate(date)}
      </span>
      <PromiseBadge status={status} timing={timing} />
      {status === "partial" && paid ? <span className="text-caption text-muted">{rupees(paid)} paid</span> : null}
    </span>
  );
}

export function BehaviourBadge({ value }: { value: Behaviour | null | undefined }) {
  if (!value) return null;
  const b = BEHAVIOUR_LABELS[value];
  return (
    <Badge tone={b.tone} title={b.hint}>
      {b.label}
    </Badge>
  );
}

export function EconomicBadge({ value }: { value: Economic | null | undefined }) {
  if (!value) return null;
  return <Badge title="Economic condition">{ECONOMIC_LABELS[value]}</Badge>;
}

export function ReasonBadges({ reasons }: { reasons: CallReason[] }) {
  if (reasons.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {reasons.map((r) => (
        <Badge key={r} tone={REASON_LABELS[r].tone} title={REASON_LABELS[r].hint}>
          {REASON_LABELS[r].label}
        </Badge>
      ))}
    </span>
  );
}

const PARTICIPANT_ICON: Record<ParticipantResponse, React.ElementType> = { pending: Clock, positive: CheckCircle2, partial: CircleAlert, negative: XCircle };

export function ParticipantBadge({ response }: { response: ParticipantResponse }) {
  const p = PARTICIPANT_LABELS[response];
  const Icon = PARTICIPANT_ICON[response];
  return (
    <Badge tone={p.tone}>
      <Icon className="size-3" aria-hidden /> {p.label}
    </Badge>
  );
}
