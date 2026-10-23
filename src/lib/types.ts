// Shapes returned by the API and the database RPCs behind it (db/migrations). Money is integer paise.

import type {
  ActivityVerdict, Attitude, Behaviour, CallOutcome, CallPurpose, CallReason, CallResponse, CallState, Economic,
  ParticipantResponse, PickedBy, PromiseStatus, PromiseTiming, Relation,
} from "@/lib/recovery";

export type AppRole = "admin" | "accountant" | "principal" | "teacher";
export type PaymentMode = "cash" | "upi" | "cheque" | "bank_transfer" | "card" | "other";
export type AllocationKind = "current" | "arrears" | "advance";
export type FeeStatus = "paid_up" | "partial" | "not_paying" | "arrears_only" | "free" | "no_plan";

/** The signed-in login (GET /api/auth/me). role NULL = no access yet. */
export interface Viewer {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole | null;
}

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: AppRole | null;
  class_ids: string[];
  created_at: string;
}

export interface AcademicSession {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
}

export interface SchoolClass {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface FeeHead {
  id: string;
  name: string;
  priority: number;
  is_active: boolean;
}

export interface Installment {
  id: string;
  session_id: string;
  number: number;
  name: string;
  due_date: string;
}

export interface SchoolSettings {
  id: number;
  school_name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  affiliation: string | null;
  receipt_prefix: string;
  receipt_footer: string | null;
  timezone: string;
  allocation_order: "oldest_first" | "current_first";
  session_start_month: number;
  /** a promise counts as kept when paid within this many days after the promised date */
  promise_grace_days: number;
  /** call list rules: families owing at least this much (paise) are called */
  call_min_overdue: number;
  /** families who paid in this many days are not called */
  call_skip_paid_days: number;
  /** days to wait after a call that got through */
  call_gap_days: number;
  /** "high dues" from this amount (paise) */
  call_high_due: number;
  /** families a caller takes at a time */
  call_batch: number;
}

export interface Student {
  id: string;
  admission_no: string;
  full_name: string;
  father_name: string | null;
  mother_name: string | null;
  phone: string | null;
  alt_phone: string | null;
  email: string | null;
  dob: string | null;
  gender: "M" | "F" | "O" | null;
  address: string | null;
  admission_date: string | null;
  status: "active" | "left" | "passed_out";
  left_on: string | null;
  erp_id: string | null;
  remarks: string | null;
  /** the family (parent profile), linked by phone number */
  parent_id: string | null;
}

export interface StudentBalance {
  student_id: string;
  admission_no: string;
  full_name: string;
  father_name: string | null;
  phone: string | null;
  student_status: Student["status"];
  class_id: string | null;
  class_name: string | null;
  class_order: number | null;
  section: string | null;
  roll_no: string | null;
  gross: number;
  concession: number;
  expected: number;
  due_expected: number;
  received: number;
  due_received: number;
  pending: number;
  overdue: number;
  prev_opening: number;
  prev_recovered: number;
  prev_pending: number;
  total_pending: number;
  total_overdue: number;
  advance_balance: number;
  last_paid_on: string | null;
  days_since_payment: number | null;
  paid_pct: number | null;
  fee_status: FeeStatus;
}

export interface StatusCounts {
  paid_up: number;
  partial: number;
  not_paying: number;
  arrears_only: number;
  free: number;
  no_plan?: number;
}

export interface Bands {
  full: number;
  over_half: number;
  under_half: number;
  nothing: number;
}

export interface ClassSummaryRow {
  class_id: string | null;
  class_name: string;
  students: number;
  expected: number;
  received: number;
  pending: number;
  due_expected: number;
  overdue: number;
  prev_pending: number;
  concession: number;
  share_of_pending: number;
  collection_pct: number | null;
  due_collection_pct: number | null;
  status: StatusCounts;
  bands: Bands;
}

export interface TrendPoint {
  month: string;
  label: string;
  expected: number;
  received: number;
  current: number;
  arrears: number;
  advance: number;
  cum_expected: number;
  cum_current: number;
  cum_received: number;
  is_future: boolean;
}

export interface Dashboard {
  session: AcademicSession;
  today: string;
  include_arrears: boolean;
  kpis: {
    students_enrolled: number;
    students_billed: number;
    gross: number;
    concession: number;
    session_expected: number;
    session_received: number;
    session_pending: number;
    session_due_expected: number;
    session_due_received: number;
    session_overdue: number;
    prev_opening: number;
    prev_recovered: number;
    prev_pending: number;
    advance_held: number;
    students_with_overdue: number;
    students_with_prev_dues: number;
  };
  status: StatusCounts;
  cash: { total: number; current: number; arrears: number; advance: number };
  classes: ClassSummaryRow[];
  trend: TrendPoint[];
  heads: { fee_head: string; expected: number; received: number; pending: number }[];
  modes: { mode: PaymentMode; amount: number; count: number }[];
}

export interface MonthSummaryNumbers {
  due_in_month: number;
  prepaid: number;
  carry_over: number;
  arrears_outstanding: number;
  expected: number;
  collected_against_target: number;
  still_to_come: number;
  received: number;
  received_current: number;
  received_arrears: number;
  received_advance: number;
  payments_count: number;
  reversals: number;
  students_paid: number;
  students_expected: number;
  students_expected_paid: number;
  students_expected_not_paid: number;
  students_cleared: number;
  days_in_month: number;
  days_elapsed: number;
  days_left: number;
  run_rate_needed: number | null;
  collection_pct: number | null;
}

export interface MonthClassRow {
  class_id: string | null;
  class_name: string;
  received: number;
  current: number;
  arrears: number;
  advance: number;
  share: number;
  expected: number;
  collected: number;
  still_to_come: number;
  collection_pct: number | null;
  students_paid: number;
  students_expected: number;
  students_not_paid: number;
}

export interface MonthSummary {
  month: string;
  label: string;
  start: string;
  end: string;
  today: string;
  status: "upcoming" | "current" | "past";
  carry: boolean;
  arrears: boolean;
  session: AcademicSession;
  summary: MonthSummaryNumbers;
  daily: { date: string; day: number; amount: number; count: number; cumulative: number; is_future: boolean }[];
  classes: MonthClassRow[];
  modes: { mode: PaymentMode; amount: number; count: number }[];
  heads: { fee_head: string; amount: number }[];
  closed: null | {
    closed_at: string;
    snapshot: { summary: MonthSummaryNumbers; classes: MonthClassRow[]; modes: MonthSummary["modes"] } | null;
  };
}

export interface AllocationLine {
  session: string | null;
  installment: string | null;
  installment_no: number | null;
  fee_head: string | null;
  amount: number;
  kind: AllocationKind;
  is_inferred?: boolean;
}

export interface MonthPayment {
  payment_id: string;
  receipt_no: string;
  paid_on: string;
  amount: number;
  mode: PaymentMode;
  reference_no: string | null;
  source: "app" | "import";
  is_reversal: boolean;
  cancelled: boolean;
  student_id: string;
  full_name: string;
  admission_no: string;
  father_name: string | null;
  class_id: string | null;
  class_name: string | null;
  section: string | null;
  roll_no: string | null;
  allocations: AllocationLine[];
}

export interface NonPayer {
  student_id: string;
  full_name: string;
  admission_no: string;
  father_name: string | null;
  phone: string | null;
  class_id: string | null;
  class_name: string;
  section: string | null;
  roll_no: string | null;
  owed: number;
  last_paid_on: string | null;
}

export interface MonthClassStudent {
  student_id: string;
  full_name: string;
  admission_no: string;
  father_name: string | null;
  phone: string | null;
  section: string | null;
  roll_no: string | null;
  paid: number;
  paid_current: number;
  paid_arrears: number;
  paid_advance: number;
  paid_for: AllocationLine[];
  outstanding_start: number;
  balance_after: number;
  pct_of_outstanding: number | null;
  target: number;
  target_remaining: number;
  status: "paid" | "partial" | "not_paid" | "nothing_due";
  receipts: { payment_id: string; receipt_no: string; paid_on: string; amount: number; mode: PaymentMode }[];
}

export interface MonthClassDetail {
  month: string;
  label: string;
  session: { id: string; name: string };
  class: { id: string; name: string };
  carry: boolean;
  arrears: boolean;
  students: MonthClassStudent[];
}

export interface InstallmentRow {
  id: string;
  number: number;
  name: string;
  due_date: string;
  next_due: string | null;
  students: number;
  students_cleared: number;
  gross: number;
  concession: number;
  expected: number;
  received: number;
  on_time: number;
  late: number;
  gap: number;
  collection_pct: number | null;
  status: "upcoming" | "open" | "closed";
}

export interface InstallmentDetail {
  installment: { id: string; number: number; name: string; due_date: string; session_id: string; next_due: string | null };
  today: string;
  summary: {
    students: number;
    expected: number;
    received: number;
    on_time: number;
    late: number;
    gap: number;
    collection_pct: number | null;
    on_time_pct: number | null;
  };
  classes: {
    class_id: string | null;
    class_name: string;
    students: number;
    students_unpaid: number;
    expected: number;
    received: number;
    gap: number;
    share_of_gap: number;
    collection_pct: number | null;
  }[];
  groups: { group: "full" | "over_half" | "under_half" | "nothing"; students: number; expected: number; received: number; missing: number }[];
  students: {
    student_id: string;
    full_name: string;
    admission_no: string;
    phone: string | null;
    class_name: string;
    section: string | null;
    expected: number;
    received: number;
    gap: number;
    cumulative: number;
    cumulative_pct: number;
    in_top_half: boolean;
    group: "over_half" | "under_half" | "nothing";
  }[];
  timing: { bucket: "on_time" | "late_15" | "late_30" | "late_30_plus"; amount: number; payments: number }[];
  catch_up: { next_due: string | null; amount: number; payments: number };
}

export interface CollectionTarget {
  id: string;
  session_id: string;
  name: string;
  target_pct: number;
  target_date: string;
}

export interface TargetProgress {
  target: CollectionTarget;
  expected: number;
  received: number;
  goal: number;
  gap: number;
  current_pct: number | null;
  students_to_close: {
    student_id: string;
    full_name: string;
    admission_no: string;
    phone: string | null;
    class_name: string;
    section: string | null;
    remaining: number;
    cumulative: number;
  }[];
  classes: { class_name: string; remaining: number; students: number }[];
}

export interface ClassDetail {
  session: { id: string; name: string };
  class: { id: string; name: string };
  include_arrears: boolean;
  kpis: {
    students: number;
    expected: number;
    received: number;
    pending: number;
    due_expected: number;
    overdue: number;
    concession: number;
    prev_pending: number;
    status: StatusCounts;
    bands: Bands;
  };
  sections: { section: string; students: number }[];
  months: { month: string; label: string; expected: number; received: number; current: number; arrears: number; payers: number; is_future: boolean }[];
  installments: { id: string; number: number; name: string; due_date: string; expected: number; received: number; gap: number; collection_pct: number | null }[];
}

export interface DueLine {
  charge_id: string;
  session_id: string;
  session_name: string;
  session_start: string;
  installment_id: string;
  installment_no: number;
  installment_name: string;
  due_date: string;
  fee_head_id: string;
  fee_head: string;
  fee_head_priority: number;
  amount: number;
  concession: number;
  net_amount: number;
  paid: number;
  remaining: number;
  is_overdue: boolean;
}

export interface Student360Installment {
  installment_id: string;
  number: number;
  name: string;
  due_date: string;
  amount: number;
  concession: number;
  net: number;
  paid: number;
  remaining: number;
  status: "waived" | "paid" | "partial" | "partial_overdue" | "overdue" | "upcoming";
  lines: { charge_id: string; fee_head: string; amount: number; concession: number; net: number; paid: number; remaining: number }[];
}

export interface Student360Payment {
  payment_id: string;
  receipt_no: string;
  paid_on: string;
  amount: number;
  mode: PaymentMode;
  reference_no: string | null;
  remarks: string | null;
  source: "app" | "import";
  session_name: string;
  is_reversal: boolean;
  cancelled: boolean;
  outstanding_before: number;
  pct_of_outstanding: number | null;
  allocations: AllocationLine[];
}

export interface Student360 {
  student: Student;
  enrollments: { session_id: string; session_name: string; class_id: string; class_name: string; section: string; roll_no: string | null; is_current: boolean }[];
  current_session: { id: string; name: string } | null;
  balance: null | {
    session_id: string;
    session_name: string;
    expected: number;
    received: number;
    pending: number;
    overdue: number;
    due_expected: number;
    prev_opening: number;
    prev_recovered: number;
    prev_pending: number;
    total_pending: number;
    total_overdue: number;
    advance_balance: number;
    concession: number;
    last_paid_on: string | null;
    days_since_payment: number | null;
  };
  fee_status: FeeStatus | null;
  last_payment: null | { receipt_no: string; paid_on: string; amount: number; current: number; arrears: number; advance: number };
  sessions: {
    session_id: string;
    session_name: string;
    start_date: string;
    end_date: string;
    is_current: boolean;
    class_name: string | null;
    section: string | null;
    amount: number;
    concession: number;
    net: number;
    paid: number;
    remaining: number;
    overdue: number;
    installments: Student360Installment[];
  }[];
  payments: Student360Payment[];
  notes: { id: string; note: string; promised_date: string | null; promised_amount: number | null; created_at: string; author: string | null }[];
  behaviour: {
    allocated_amount: number;
    avg_days_from_due: number | null;
    on_time_pct: number | null;
    year_end_pct: number | null;
    profile: "no_history" | "year_end" | "early" | "on_time" | "late";
  };
  today: string;
}

export interface ReconciliationCheck {
  key: string;
  label: string;
  left: number | null;
  right: number | null;
  ok: boolean;
  count?: boolean;
  warning?: boolean;
  info?: boolean;
  rows?: number;
}

export interface SearchResult {
  id: string;
  admission_no: string;
  full_name: string;
  father_name: string | null;
  phone: string | null;
  status: Student["status"];
  class_name: string | null;
  section: string | null;
  roll_no: string | null;
}

// ---------------------------------------------------------------------------------------------
// API shapes (src/app/api) that are not plain RPC results
// ---------------------------------------------------------------------------------------------

/** GET /api/students: a student with their enrolment in the requested session (nulls when not enrolled). */
export type StudentListRow = Pick<Student, "id" | "admission_no" | "full_name" | "father_name" | "phone" | "status" | "left_on"> & {
  class_id: string | null;
  class_name: string | null;
  class_order: number | null;
  section: string | null;
  roll_no: string | null;
};

/** GET /api/students/[id] */
export type StudentRecord = {
  student: Student;
  enrollment: { class_id: string; section: string; roll_no: string | null } | null;
  /** receipts on record (a student with receipts cannot be deleted) */
  payments: number;
  /** fee lines waived when the student left (restorable on re-activation) */
  waived_lines: number;
};

/** GET /api/students/[id]/fees */
export type FeePlanData = {
  student: Student;
  enrollments: { session_id: string; section: string; roll_no: string | null; class_id: string; class_name: string }[];
  dues: DueLine[];
  /** source and note of every fee line */
  meta: { id: string; source: string; note: string | null }[];
  installments: Installment[];
  heads: FeeHead[];
  /** money not yet matched to any charge */
  advance: number;
};

/** GET /api/payments: one receipt (or cancellation entry) with its class and what it paid for. */
export interface PaymentRegisterRow {
  payment_id: string;
  receipt_no: string;
  paid_on: string;
  amount: number;
  mode: PaymentMode;
  reference_no: string | null;
  remarks: string | null;
  source: "app" | "import";
  session_id: string;
  student_id: string;
  reverses_payment_id: string | null;
  created_at: string;
  full_name: string;
  admission_no: string;
  father_name: string | null;
  /** class in the session the money was received in */
  class_name: string | null;
  section: string | null;
  current: number;
  arrears: number;
  advance: number;
  /** a later entry cancels this receipt */
  cancelled: boolean;
}

/** GET /api/payments/[id] */
export interface ReceiptData {
  payment: { id: string; student_id: string; receipt_no: string; created_at: string; reverses_payment_id: string | null; created_by_name: string | null };
  student: Student360;
  /** the entry that cancelled this receipt, if any */
  reversal: { id: string; receipt_no: string; paid_on: string; remarks: string | null } | null;
  /** the call or activity the receipt is counted for (fee recovery), if any */
  source: { call_id: string | null; participant_id: string | null; label: string; href: string } | null;
}

/** GET /api/analytics/reconciliation */
export interface Reconciliation {
  session: { id: string; name: string };
  checked_at: string;
  checks: ReconciliationCheck[];
}

/** GET /api/setup/checklist */
export interface SetupChecklist {
  active_heads: number;
  installments: Installment[];
  classes_with_structure: string[];
  /** active students enrolled in the session */
  enrolled: number;
  /** enrolled students without fee lines (null when the check could not run) */
  without_plan: number | null;
}

/** GET /api/sessions: a session with what it holds (sessions holding data cannot be deleted). */
export interface SessionSetupRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  enrollments: number;
  payments: number;
  charges: number;
  installments: { id: string; number: number; name: string; due_date: string; charges: number }[];
}

/** GET /api/setup/classes */
export interface ClassSetupRow {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  /** enrolments in every session */
  enrolments: number;
  /** enrolments in the requested session */
  inSession: number;
  /** fee structure amounts (all sessions) */
  structure: number;
}

export interface FeeHeadSetupRow {
  id: string;
  name: string;
  priority: number;
  is_active: boolean;
  charges: number;
  structure: number;
}

/** GET /api/fee-structure */
export interface FeeStructureData {
  installments: Installment[];
  heads: FeeHead[];
  /** paise by `${fee_head_id}|${installment_id}` */
  amounts: Record<string, number>;
  classes_with_structure: string[];
  /** active students of the class enrolled in the session, and how many of them have fee lines */
  enrolled: number;
  with_charges: number;
  no_plan: ReconciliationCheck | null;
}

/** GET /api/promote */
export interface PromotePreview {
  by_class: { class_id: string; active: number; inactive: number; already: number }[];
  target_has_structure: string[];
  /** students already enrolled in the target session */
  target_enrolled: number;
}

/** GET /api/staff */
export interface StaffMember extends Profile {
  last_sign_in_at: string | null;
}

/** GET /api/admin/snapshots: a closed month */
export interface MonthSnapshot {
  month: string;
  closed_at: string;
  closed_by_name: string | null;
}

/** GET /api/admin/audit */
export interface AuditRow {
  id: number;
  at: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details: unknown;
}

// ---------------------------------------------------------------------------------------------
// Fee recovery: parents (families), calls and promises, the daily call list, activities and the dashboard
// ---------------------------------------------------------------------------------------------

export interface Parent {
  id: string;
  /** digits only (no +91 / leading 0); unique */
  phone: string;
  name: string;
  relation: Relation;
  alt_phone: string | null;
  email: string | null;
  address: string | null;
  occupation: string | null;
  economic_status: Economic | null;
  payment_behaviour: Behaviour | null;
  attitude: Attitude | null;
  best_time_to_call: string | null;
  concerns: string | null;
  priorities: string | null;
  behaviour_notes: string | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

/** GET /api/parents: one family with the children's balances in a session added up. */
export interface ParentBalance {
  parent_id: string;
  name: string;
  phone: string;
  alt_phone: string | null;
  relation: Relation;
  economic_status: Economic | null;
  payment_behaviour: Behaviour | null;
  attitude: Attitude | null;
  children: number;
  children_in_session: number;
  children_list: {
    student_id: string;
    full_name: string;
    status: Student["status"];
    class_name: string | null;
    section: string | null;
    fee_status: FeeStatus | null;
    total_pending: number;
    in_session: boolean;
  }[];
  expected: number;
  due_expected: number;
  received: number;
  pending: number;
  overdue: number;
  concession: number;
  prev_opening: number;
  prev_recovered: number;
  prev_pending: number;
  total_pending: number;
  total_overdue: number;
  advance_balance: number;
  last_paid_on: string | null;
  days_since_payment: number | null;
  paid_pct: number | null;
  family_status: FeeStatus | null;
  calls: number;
  last_call_on: string | null;
  last_outcome: CallOutcome | null;
  promise_date: string | null;
  promise_amount: number | null;
  promise_status: PromiseStatus | null;
}

export interface PromiseResult {
  status: PromiseStatus;
  timing: PromiseTiming | null;
  paid: number;
  kept_on: string | null;
  deadline: string;
}

export interface ParentCall {
  id: string;
  call_date: string;
  called_at: string;
  outcome: CallOutcome;
  picked_by: PickedBy | null;
  response: CallResponse | null;
  summary: string | null;
  promised_date: string | null;
  promised_amount: number | null;
  follow_up_on: string | null;
  purpose: CallPurpose;
  author: string | null;
  promise: PromiseResult | null;
  /** receipts counted at the counter as paid because of this call */
  recovered: number;
}

/** A promise from a call or a student note, and how it turned out. */
export interface FamilyPromise {
  source: "call" | "note";
  source_id: string;
  student_id: string | null;
  student_name: string | null;
  made_on: string;
  promised_date: string;
  promised_amount: number | null;
  deadline: string;
  paid: number;
  kept_on: string | null;
  status: PromiseStatus;
  timing: PromiseTiming | null;
}

export interface PromiseReliability {
  made: number;
  kept: number;
  early: number;
  on_date: number;
  grace: number;
  partial: number;
  broken: number;
  pending: number;
  kept_pct: number | null;
}

export interface ParentChild {
  student_id: string;
  full_name: string;
  admission_no: string;
  status: Student["status"];
  left_on: string | null;
  phone: string | null;
  father_name: string | null;
  mother_name: string | null;
  in_session: boolean;
  class_id: string | null;
  class_name: string | null;
  section: string | null;
  roll_no: string | null;
  fee_status: FeeStatus | null;
  expected: number;
  received: number;
  pending: number;
  overdue: number;
  prev_pending: number;
  total_pending: number;
  total_overdue: number;
  advance_balance: number;
  last_paid_on: string | null;
  paid_pct: number | null;
}

/** GET /api/parents/[id] */
export interface Parent360 {
  parent: Parent;
  session: { id: string; name: string } | null;
  today: string;
  grace_days: number;
  children: ParentChild[];
  totals: null | {
    expected: number;
    due_expected: number;
    received: number;
    pending: number;
    overdue: number;
    concession: number;
    prev_opening: number;
    prev_recovered: number;
    prev_pending: number;
    total_pending: number;
    total_overdue: number;
    advance_balance: number;
    last_paid_on: string | null;
    days_since_payment: number | null;
    family_status: FeeStatus | null;
  };
  last_payment: null | {
    payment_id: string;
    receipt_no: string;
    paid_on: string;
    amount: number;
    student_name: string;
    current: number;
    arrears: number;
    advance: number;
  };
  payments: {
    payment_id: string;
    receipt_no: string;
    paid_on: string;
    amount: number;
    mode: PaymentMode;
    student_id: string;
    full_name: string;
    is_reversal: boolean;
    cancelled: boolean;
    current: number;
    arrears: number;
    advance: number;
  }[];
  calls: ParentCall[];
  promises: FamilyPromise[];
  reliability: PromiseReliability;
  behaviour: {
    allocated_amount: number;
    avg_days_from_due: number | null;
    on_time_pct: number | null;
    year_end_pct: number | null;
    profile: "no_history" | "year_end" | "early" | "on_time" | "late";
    payments_per_year: number | null;
    carried_forward: boolean;
    /** the payment-habit tag the records point to */
    suggested: Behaviour | null;
  };
  sessions: { session_id: string; session_name: string; is_current: boolean; net: number; paid: number; remaining: number }[];
  activities: {
    participant_id: string;
    activity_id: string;
    name: string;
    status: "active" | "closed";
    start_date: string;
    end_date: string | null;
    student_id: string;
    student_name: string;
    response: ParticipantResponse;
    note: string | null;
    credited: number;
  }[];
}

// ---------------------------------------------------------------------------------------------
// The daily call list (GET /api/calls)
// ---------------------------------------------------------------------------------------------

export interface CallListChild {
  student_id: string;
  full_name: string;
  class_name: string | null;
  section: string | null;
  total_overdue: number;
}

/** A family on today's call list (to call, called today, or taken by a caller today). */
export interface CallListRow {
  parent_id: string;
  name: string;
  phone: string;
  alt_phone: string | null;
  relation: Relation;
  best_time_to_call: string | null;
  economic_status: Economic | null;
  payment_behaviour: Behaviour | null;
  state: CallState;
  /** place on today's list (families to call only) */
  rank: number | null;
  priority: number;
  /** why the family is on the list; the first is the main reason */
  reasons: CallReason[];
  next_call_on: string | null;
  total_overdue: number;
  prev_pending: number;
  last_paid_on: string | null;
  last_paid_amount: number | null;
  days_since_payment: number | null;
  children: CallListChild[];
  last_call_on: string | null;
  last_outcome: CallOutcome | null;
  last_response: CallResponse | null;
  last_summary: string | null;
  last_caller_name: string | null;
  /** fee calls in a row that did not get through */
  unanswered: number;
  promise_date: string | null;
  promise_amount: number | null;
  promise_status: PromiseStatus | null;
  promise_deadline: string | null;
  promise_paid: number | null;
  assigned_to: string | null;
  assigned_name: string | null;
  /** the fee call logged today */
  today_call: null | {
    id: string;
    outcome: CallOutcome;
    response: CallResponse | null;
    promised_date: string | null;
    promised_amount: number | null;
    follow_up_on: string | null;
    called_at: string;
    caller_id: string | null;
    caller_name: string | null;
  };
}

/** A call made today (about anything). */
export interface TodayCall {
  id: string;
  parent_id: string;
  parent_name: string;
  phone: string;
  purpose: CallPurpose;
  outcome: CallOutcome;
  picked_by: PickedBy | null;
  response: CallResponse | null;
  summary: string | null;
  promised_date: string | null;
  promised_amount: number | null;
  follow_up_on: string | null;
  called_at: string;
  caller_id: string | null;
  caller_name: string | null;
}

/** One caller's calls in a window (today, yesterday, last 7 or 30 days). */
export interface CallerWindow {
  calls: number;
  families: number;
  fee_calls: number;
  connected: number;
  not_reached: number;
  promises: number;
  promised_amount: number;
  kept: number;
  broken: number;
  by_purpose: Partial<Record<CallPurpose, number>>;
  /** receipts paid in the window that were counted for the caller's calls */
  recovered: number;
}

export interface CallRules {
  min_overdue: number;
  skip_paid_days: number;
  gap_days: number;
  high_due: number;
  batch: number;
  grace_days: number;
}

export interface CallBoard {
  today: string;
  me: {
    id: string;
    name: string | null;
    /** families I took from today's list */
    taken: number;
    /** of them, still to call */
    left: number;
    stats: Record<"today" | "yesterday" | "week" | "month", CallerWindow>;
  };
  rules: CallRules;
  counts: {
    due: number;
    /** to call and not taken by anyone yet */
    due_open: number;
    due_overdue: number;
    called: number;
    promised: number;
    promised_amount: number;
    paid_recently: number;
    waiting: number;
    broken: number;
    call_back: number;
  };
  rows: CallListRow[];
  promises_due: {
    parent_id: string;
    name: string;
    phone: string;
    promise_date: string;
    promise_amount: number | null;
    promise_deadline: string;
    promise_paid: number | null;
    total_overdue: number;
  }[];
  calls_today: TodayCall[];
  team: { user_id: string; name: string; is_me: boolean; calls: number; connected: number; promises: number; taken: number; left: number }[];
}

// ---------------------------------------------------------------------------------------------
// Recovery dashboard (GET /api/recovery?from&to)
// ---------------------------------------------------------------------------------------------

export type RecoverySource = "calls" | "activities" | "direct";

export interface RecoveryDashboard {
  period: { from: string; to: string; days: number; prev_from: string; prev_to: string; bucket: "day" | "week" | "month"; today: string };
  money: {
    received: number;
    receipts: number;
    families: number;
    students: number;
    /** the same number of days just before */
    prev_received: number;
    by_source: Record<RecoverySource, { amount: number; receipts: number; families: number }>;
    by_kind: Partial<Record<AllocationKind, number>>;
    trend: { start: string; calls: number; activities: number; direct: number; receipts: number }[];
    by_behaviour: { behaviour: Behaviour | null; amount: number; families: number }[];
  };
  calls: {
    calls: number;
    families: number;
    fee_calls: number;
    connected: number;
    not_reached: number;
    callers: number;
    per_day: number;
    by_purpose: Partial<Record<CallPurpose, number>>;
    by_outcome: Partial<Record<CallOutcome, number>>;
    by_response: Partial<Record<CallResponse, number>>;
    promises: number;
    promised_amount: number;
    kept: number;
    kept_on_time: number;
    partial: number;
    broken: number;
    pending: number;
    promise_paid: number;
    /** receipts of the period counted for a call */
    recovered: number;
    trend: { start: string; calls: number; connected: number }[];
    by_caller: {
      user_id: string;
      name: string;
      calls: number;
      families: number;
      connected: number;
      promises: number;
      kept: number;
      broken: number;
      recovered: number;
    }[];
  };
  /** families we spoke to about fees vs other families with dues */
  impact: {
    spoke: number;
    spoke_paid: number;
    spoke_amount: number;
    spoke_pct: number | null;
    others: number;
    others_paid: number;
    others_amount: number;
    others_pct: number | null;
    /** how many times as likely to pay after we spoke to them */
    lift: number | null;
  };
  activities: {
    id: string;
    name: string;
    status: "active" | "closed";
    start_date: string;
    end_date: string | null;
    participants: number;
    recovered: number;
    receipts: number;
    students_paid: number;
  }[];
}

// ---------------------------------------------------------------------------------------------
// Student activities
// ---------------------------------------------------------------------------------------------

export interface RecoveryActivity {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  status: "active" | "closed";
  target_amount: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** An activity with how it is doing (GET /api/activities). */
export interface ActivitySummary {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "closed";
  start_date: string;
  end_date: string | null;
  target_amount: number | null;
  created_at: string;
  created_by_name: string | null;
  days_running: number;
  participants: number;
  classes: string[];
  positive: number;
  partial: number;
  negative: number;
  pending: number;
  /** students who paid anything since it started */
  payers: number;
  /** students with a receipt counted for it */
  won: number;
  /** students who owed (paid since the start, or owe now) */
  owed: number;
  owing_now: number;
  won_pct: number | null;
  paid_since: number;
  credited: number;
  credited_receipts: number;
  overdue_now: number;
  verdict: ActivityVerdict;
}

export interface ActivityStudentRow {
  participant_id: string;
  activity_id: string;
  activity_name: string;
  activity_status: "active" | "closed";
  student_id: string;
  full_name: string;
  admission_no: string;
  class_id: string | null;
  class_name: string | null;
  section: string | null;
  response: ParticipantResponse;
  note: string | null;
  added_on: string;
  paid_since: number;
  credited: number;
  total_overdue: number;
  fee_status: FeeStatus | null;
}

export interface ActivitiesOverview {
  today: string;
  activities: ActivitySummary[];
  /** running activities by class */
  by_class: {
    class_id: string | null;
    class_name: string;
    activities: number;
    students: number;
    positive: number;
    negative: number;
    payers: number;
    paid_since: number;
    credited: number;
    overdue_now: number;
  }[];
  students: ActivityStudentRow[];
  totals: {
    running: number;
    closed: number;
    credited: number;
    credited_running: number;
    paid_since: number;
    good: number;
    poor: number;
    students: number;
    students_running: number;
    positive: number;
    negative: number;
  };
}

export interface ActivityParticipant {
  participant_id: string;
  student_id: string;
  full_name: string;
  admission_no: string;
  student_status: Student["status"];
  class_name: string | null;
  section: string | null;
  parent_id: string | null;
  parent_name: string | null;
  phone: string | null;
  concerns: string | null;
  total_overdue: number;
  total_pending: number;
  fee_status: FeeStatus | null;
  response: ParticipantResponse;
  note: string | null;
  added_on: string;
  updated_at: string;
  /** paid by the student between the activity's start and its end (or today) */
  paid_since: number;
  /** receipts the accountant counted for this activity */
  credited: number;
  /** receipts since the activity started */
  receipts: { payment_id: string; receipt_no: string; paid_on: string; amount: number; credited_here: boolean; credited_elsewhere: string | null }[];
}

/** GET /api/activities/[id] */
export interface ActivityDetail {
  activity: RecoveryActivity & { created_by_name: string | null };
  today: string;
  session: { id: string; name: string } | null;
  stats: {
    participants: number;
    positive: number;
    partial: number;
    negative: number;
    pending: number;
    credited: number;
    credited_receipts: number;
    paid_since: number;
    payers: number;
    won: number;
    owed: number;
    overdue_now: number;
    owing_now: number;
    days_running: number;
    verdict: ActivityVerdict;
  };
  rows: ActivityParticipant[];
}

// ---------------------------------------------------------------------------------------------
// Student side (GET /api/students/[id]/recovery)
// ---------------------------------------------------------------------------------------------

export interface StudentRecovery {
  parent: null | Pick<
    Parent,
    "id" | "name" | "phone" | "alt_phone" | "relation" | "economic_status" | "payment_behaviour" | "attitude" | "best_time_to_call" | "concerns" | "priorities"
  >;
  siblings: { student_id: string; full_name: string; admission_no: string; status: Student["status"]; class_name: string | null; section: string | null }[];
  /** the family's latest calls, newest first */
  calls: (Pick<ParentCall, "id" | "call_date" | "purpose" | "outcome" | "picked_by" | "response" | "summary" | "promised_date" | "promised_amount" | "author"> & {
    promise_status: PromiseStatus | null;
  })[];
  /** the call the fee counter suggests as the reason for a payment today */
  suggested_call_id: string | null;
  promise: null | { promised_date: string; promised_amount: number | null; deadline: string; paid: number; status: PromiseStatus; timing: PromiseTiming | null; source: "call" | "note" };
  reliability: null | { made: number; kept: number; partial: number; broken: number; pending: number };
  activities: {
    participant_id: string;
    activity_id: string;
    name: string;
    description: string | null;
    status: "active" | "closed";
    start_date: string;
    end_date: string | null;
    target_amount: number | null;
    /** students taking part (1 = an activity for this student alone) */
    participants: number;
    added_on: string;
    response: ParticipantResponse;
    note: string | null;
    updated_at: string;
    updated_by_name: string | null;
    /** what the student paid from the start to the end (or today) */
    paid_since: number;
    /** receipts counted for the activity */
    credited: number;
    credited_receipts: number;
  }[];
  today: string;
}
