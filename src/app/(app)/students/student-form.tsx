"use client";

import type { SchoolClass, Student } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Field, FormError, FormSuccess, Input, Select, Textarea } from "@/components/ui/form";
import { Button, LinkButton } from "@/components/ui/button";
import { saveStudent } from "./actions";
import { useFormAction } from "./use-form-action";

export type EnrollmentValue = { class_id: string; section: string; roll_no: string | null } | null;

export function StudentForm({
  student,
  enrollment,
  classes,
  session,
  today,
}: {
  student?: Student;
  enrollment?: EnrollmentValue;
  classes: SchoolClass[];
  session: { id: string; name: string } | null;
  today: string;
}) {
  const [state, onSubmit, pending] = useFormAction(saveStudent);
  const editing = !!student;
  const activeClasses = classes.filter((c) => c.is_active || c.id === enrollment?.class_id);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {student && <input type="hidden" name="id" value={student.id} />}
      {session && <input type="hidden" name="session_id" value={session.id} />}

      <Card title="Student">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Admission no *" htmlFor="admission_no">
            <Input id="admission_no" name="admission_no" required defaultValue={student?.admission_no ?? ""} autoFocus={!editing} />
          </Field>
          <Field label="Full name *" htmlFor="full_name" className="lg:col-span-2">
            <Input id="full_name" name="full_name" required defaultValue={student?.full_name ?? ""} />
          </Field>
          <Field label="Date of birth" htmlFor="dob">
            <Input id="dob" name="dob" type="date" max={today} defaultValue={student?.dob ?? ""} />
          </Field>
          <Field label="Gender" htmlFor="gender">
            <Select id="gender" name="gender" defaultValue={student?.gender ?? ""}>
              <option value="">—</option>
              <option value="M">Male</option>
              <option value="F">Female</option>
              <option value="O">Other</option>
            </Select>
          </Field>
          <Field label="Admission date" htmlFor="admission_date">
            <Input
              id="admission_date"
              name="admission_date"
              type="date"
              defaultValue={student?.admission_date ?? (editing ? "" : today)}
            />
          </Field>
        </div>
      </Card>

      <Card title="Parents & contact">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Father's name" htmlFor="father_name">
            <Input id="father_name" name="father_name" defaultValue={student?.father_name ?? ""} />
          </Field>
          <Field label="Mother's name" htmlFor="mother_name">
            <Input id="mother_name" name="mother_name" defaultValue={student?.mother_name ?? ""} />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" defaultValue={student?.email ?? ""} />
          </Field>
          <Field label="Phone" htmlFor="phone" hint="Used for fee reminders. Brothers and sisters with the same number share one parent profile.">
            <Input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={student?.phone ?? ""} />
          </Field>
          <Field label="Alternate phone" htmlFor="alt_phone">
            <Input id="alt_phone" name="alt_phone" type="tel" inputMode="tel" defaultValue={student?.alt_phone ?? ""} />
          </Field>
          <Field label="Address" htmlFor="address" className="sm:col-span-2 lg:col-span-3">
            <Textarea id="address" name="address" rows={2} defaultValue={student?.address ?? ""} />
          </Field>
          <Field label="Remarks" htmlFor="remarks" className="sm:col-span-2 lg:col-span-3">
            <Textarea id="remarks" name="remarks" rows={2} defaultValue={student?.remarks ?? ""} />
          </Field>
        </div>
      </Card>

      <Card
        title={session ? `Class in ${session.name}` : "Class"}
        description={
          session
            ? "The session picked in the top bar. Changing the class re-syncs the student's fee charges to the new class's fee structure (manual lines are kept)."
            : "Create an academic session first to enrol the student in a class."
        }
      >
        {session ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Class" htmlFor="class_id" hint={enrollment ? "To take a student out of this session, mark them as left." : "Leave empty to save without a class."}>
              <Select id="class_id" name="class_id" defaultValue={enrollment?.class_id ?? ""}>
                {!enrollment && <option value="">— Not enrolled —</option>}
                {activeClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Section" htmlFor="section">
              <Input id="section" name="section" defaultValue={enrollment?.section ?? "A"} maxLength={10} />
            </Field>
            <Field label="Roll no" htmlFor="roll_no">
              <Input id="roll_no" name="roll_no" defaultValue={enrollment?.roll_no ?? ""} maxLength={20} />
            </Field>
            <label className="flex items-start gap-2 text-sm text-ink sm:col-span-3">
              <input type="checkbox" name="generate" defaultChecked className="mt-0.5 size-4 accent-[var(--accent)]" />
              <span>
                Generate fee charges from the class fee structure
                <span className="block text-caption text-muted">
                  {editing
                    ? "Applies when the student is newly enrolled, moves to another class, or has no fee plan yet in this session."
                    : "Creates this session's installments for the chosen class. You can adjust them later on the fee plan page."}
                </span>
              </span>
            </label>
          </div>
        ) : (
          <p className="text-sm text-ink-2">No session yet.</p>
        )}
      </Card>

      <FormError message={state.error} />
      <FormSuccess message={state.message} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Add student"}
        </Button>
        <LinkButton href={student ? `/students/${student.id}` : "/students"} variant="ghost">
          Cancel
        </LinkButton>
      </div>
    </form>
  );
}
