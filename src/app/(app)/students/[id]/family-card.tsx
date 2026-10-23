"use client";

import Link from "next/link";
import { Phone } from "lucide-react";
import { useApi } from "@/lib/api/hooks";
import { fmtDate } from "@/lib/format";
import { OUTCOME_LABELS, PURPOSE_LABELS, RESPONSE_LABELS, fmtPhone } from "@/lib/recovery";
import type { StudentRecovery } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { BehaviourBadge, EconomicBadge, PromiseLine } from "@/components/recovery";

/** The student's family: parent profile, brothers and sisters, the latest calls and promise. (Activities: ActivitiesCard.) */
export function FamilyCard({ studentId }: { studentId: string }) {
  const res = useApi<StudentRecovery>(`/api/students/${studentId}/recovery`);
  if (!res.data) return null;
  const { parent, siblings, calls, promise } = res.data;

  return (
    <Card
      title="Family"
      description="The parent profile is found by phone number; brothers and sisters with the same number share it."
      actions={
        parent ? (
          <Link href={`/parents/${parent.id}`} className="text-footnote font-medium text-accent">
            Parent profile
          </Link>
        ) : undefined
      }
    >
      {parent ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Avatar name={parent.name} size="md" />
            <div className="min-w-0 flex-1">
              <Link href={`/parents/${parent.id}`} className="block truncate text-subhead font-semibold text-ink hover:text-accent">
                {parent.name}
              </Link>
              <a href={`tel:${parent.phone}`} className="inline-flex items-center gap-1 text-caption text-accent">
                <Phone className="size-3" /> {fmtPhone(parent.phone)}
              </a>
            </div>
          </div>
          {(parent.payment_behaviour || parent.economic_status) && (
            <div className="flex flex-wrap gap-1.5">
              <BehaviourBadge value={parent.payment_behaviour} />
              <EconomicBadge value={parent.economic_status} />
            </div>
          )}
          {parent.concerns && <p className="text-footnote text-ink-2">Concern: {parent.concerns}</p>}
          {siblings.length > 0 && (
            <p className="text-footnote text-ink-2">
              {siblings.length === 1 ? "Sibling" : "Siblings"}:{" "}
              {siblings.map((s, i) => (
                <span key={s.student_id}>
                  {i > 0 && ", "}
                  <Link href={`/students/${s.student_id}`} className="font-medium text-accent hover:underline">
                    {s.full_name}
                  </Link>
                  {s.class_name && <span className="text-muted"> ({s.class_name})</span>}
                </span>
              ))}
            </p>
          )}
          {promise && (
            <p className="text-footnote">
              <PromiseLine date={promise.promised_date} amount={promise.promised_amount} status={promise.status} timing={promise.timing} paid={promise.paid} />
            </p>
          )}
          {calls.length > 0 && (
            <ul className="space-y-1.5 border-t border-line pt-3">
              {calls.slice(0, 2).map((c) => (
                <li key={c.id} className="text-footnote">
                  <span className="font-medium text-ink">
                    {fmtDate(c.call_date)} · {c.purpose !== "fees" && `${PURPOSE_LABELS[c.purpose].short} · `}
                    {c.response ? RESPONSE_LABELS[c.response] : OUTCOME_LABELS[c.outcome]}
                  </span>
                  {c.summary && <span className="block text-ink-2">{c.summary}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="text-footnote text-muted">No family linked yet. Add the parent&rsquo;s phone number to the student to link one.</p>
      )}
    </Card>
  );
}
