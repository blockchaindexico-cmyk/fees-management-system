-- =============================================================================
-- Fee recovery: parent (family) profiles, call campaigns and recovery activities
--
--   * parents         one profile per family, keyed by a unique phone number.
--                     Students are linked to it automatically by their phone
--                     (brothers and sisters with the same number share a parent).
--   * parent_calls    every recovery call: who picked up, what they said, the
--                     date (and amount) they promised to pay by.
--   * promises        a promise is kept when the family pays (any child) between
--                     the call and the promised date + the grace days in
--                     school_settings; otherwise it is broken (nothing paid) or
--                     partly kept. Promises written in student notes count too.
--   * recovery_campaigns
--       kind 'calls'    a call campaign: its rules pick the parents to call
--                       (call_queue) and every call is logged against it.
--       kind 'activity' a student activity used to recover fees (e.g. extra
--                       English practice, a trip open to students whose fees
--                       are paid): participants, their response and the
--                       receipts the accountant credits to the activity.
--
-- Money is bigint paise. All figures come from the functions below.
-- =============================================================================

-- A promise is kept if the money arrives within this many days after the promised date
alter table public.school_settings
  add column promise_grace_days smallint not null default 1 check (promise_grace_days between 0 and 30);

-- Phone numbers are compared as digits only, without the +91 / leading 0 (NULL when not a phone number)
create function public.normalize_phone(p_phone text) returns text
language sql immutable as $$
  select case when length(d) between 6 and 15 then d end
    from (select case
                   when length(x) = 12 and left(x, 2) = '91' then right(x, 10)
                   when length(x) = 11 and left(x, 1) = '0' then right(x, 10)
                   else x
                 end as d
            from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as x) a) b
$$;

-- ---------------------------------------------------------------------------
-- Parents (one per family)
-- ---------------------------------------------------------------------------
create table public.parents (
  id                 uuid primary key default gen_random_uuid(),
  phone              text not null check (phone ~ '^[0-9]{6,15}$'),
  name               text not null,
  relation           text not null default 'father' check (relation in ('father', 'mother', 'guardian', 'other')),
  alt_phone          text check (alt_phone ~ '^[0-9]{6,15}$'),
  email              text,
  address            text,
  occupation         text,
  -- staff's judgement of the family's means
  economic_status    text check (economic_status in ('low', 'lower_middle', 'middle', 'upper_middle', 'high')),
  -- how the family pays fees
  payment_behaviour  text check (payment_behaviour in ('regular', 'installment_wise', 'year_end', 'carries_forward',
                                                       'willing_struggling', 'capable_not_paying', 'irregular', 'non_payer')),
  -- how they deal with the school
  attitude           text check (attitude in ('cooperative', 'neutral', 'demanding', 'difficult')),
  best_time_to_call  text,
  concerns           text,   -- their main concern about the child (English, maths, discipline, transport…)
  priorities         text,   -- what matters most to them
  behaviour_notes    text,   -- how they behave and what they talk about when we call or meet
  remarks            text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index parents_phone_key on public.parents (phone);
create index parents_alt_phone_idx on public.parents (alt_phone) where alt_phone is not null;
create trigger parents_touch before update on public.parents
  for each row execute function public.touch_updated_at();

alter table public.students add column parent_id uuid references public.parents (id) on delete set null;
create index students_parent_idx on public.students (parent_id);

-- New student or new phone number -> the family with that number (created when there is none yet).
-- A student moved by hand to a family with another number stays there until their own number changes.
create function public.students_link_parent() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := public.normalize_phone(new.phone);
  v_old   text;
  v_cur   public.parents;
begin
  if v_phone is null then return new; end if;
  if tg_op = 'UPDATE' then
    v_old := public.normalize_phone(old.phone);
    if v_old is not distinct from v_phone and new.parent_id is not null then return new; end if;
  end if;

  if new.parent_id is not null then
    select * into v_cur from public.parents where id = new.parent_id;
    if v_cur.phone = v_phone or v_cur.alt_phone = v_phone then return new; end if;
    -- linked by hand (not through the old number): keep it
    if tg_op = 'INSERT' or v_old is null or (v_cur.phone is distinct from v_old and v_cur.alt_phone is distinct from v_old) then
      return new;
    end if;
  end if;

  select p.id into new.parent_id from public.parents p
   where p.phone = v_phone or p.alt_phone = v_phone
   order by (p.phone = v_phone) desc, p.created_at
   limit 1;
  if new.parent_id is null then
    insert into public.parents (phone, name, relation, address)
    values (v_phone,
            coalesce(nullif(trim(new.father_name), ''), nullif(trim(new.mother_name), ''), 'Parent of ' || new.full_name),
            case when nullif(trim(new.father_name), '') is not null then 'father'
                 when nullif(trim(new.mother_name), '') is not null then 'mother'
                 else 'guardian' end,
            new.address)
    returning id into new.parent_id;
  end if;
  return new;
end $$;

create trigger students_link_parent
  before insert or update of phone on public.students
  for each row execute function public.students_link_parent();

-- Link every student without a family to the profile of their phone number (internal; used below and by
-- link_students_to_parents)
create function public.link_parents_by_phone() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_created integer;
  v_linked  integer;
begin
  insert into public.parents (phone, name, relation, address)
  select distinct on (x.phone) x.phone,
         coalesce(nullif(trim(x.father_name), ''), nullif(trim(x.mother_name), ''), 'Parent of ' || x.full_name),
         case when nullif(trim(x.father_name), '') is not null then 'father'
              when nullif(trim(x.mother_name), '') is not null then 'mother'
              else 'guardian' end,
         x.address
    from (select public.normalize_phone(st.phone) as phone, st.father_name, st.mother_name, st.full_name, st.address,
                 st.status, st.admission_no
            from public.students st
           where st.parent_id is null) x
   where x.phone is not null
     and not exists (select 1 from public.parents p where p.phone = x.phone or p.alt_phone = x.phone)
   order by x.phone, (x.status = 'active') desc, x.admission_no;
  get diagnostics v_created = row_count;

  update public.students st
     set parent_id = (select p.id from public.parents p
                       where p.phone = public.normalize_phone(st.phone) or p.alt_phone = public.normalize_phone(st.phone)
                       order by (p.phone = public.normalize_phone(st.phone)) desc, p.created_at
                       limit 1)
   where st.parent_id is null
     and public.normalize_phone(st.phone) is not null;
  get diagnostics v_linked = row_count;

  return jsonb_build_object('created', v_created, 'linked', v_linked);
end $$;

select public.link_parents_by_phone();

-- Public RPC: link students whose family is not known yet
create function public.link_students_to_parents() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.assert_writer();
  v := public.link_parents_by_phone();
  perform public.audit('link_parents', 'parents', null, v);
  return v;
end $$;

-- Two profiles of one family (e.g. father's and mother's number): move children and calls, keep the other
-- number as the alternate phone so new admissions with it join this family too
create function public.merge_parents(p_from uuid, p_into uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_from public.parents;
  v_into public.parents;
  v_n    integer;
begin
  perform public.assert_writer();
  if p_from = p_into then raise exception 'Choose two different parent profiles'; end if;
  select * into v_from from public.parents where id = p_from for update;
  select * into v_into from public.parents where id = p_into for update;
  if v_from.id is null or v_into.id is null then raise exception 'Parent not found'; end if;

  update public.students set parent_id = p_into where parent_id = p_from;
  get diagnostics v_n = row_count;
  update public.parent_calls set parent_id = p_into where parent_id = p_from;
  delete from public.parents where id = p_from;

  update public.parents
     set alt_phone         = coalesce(alt_phone, nullif(v_from.phone, phone)),
         email             = coalesce(email, v_from.email),
         address           = coalesce(address, v_from.address),
         occupation        = coalesce(occupation, v_from.occupation),
         economic_status   = coalesce(economic_status, v_from.economic_status),
         payment_behaviour = coalesce(payment_behaviour, v_from.payment_behaviour),
         attitude          = coalesce(attitude, v_from.attitude),
         best_time_to_call = coalesce(best_time_to_call, v_from.best_time_to_call),
         concerns          = coalesce(concerns, v_from.concerns),
         priorities        = coalesce(priorities, v_from.priorities),
         behaviour_notes   = coalesce(behaviour_notes, v_from.behaviour_notes),
         remarks           = coalesce(remarks, v_from.remarks)
   where id = p_into;

  perform public.audit('merge_parents', 'parents', p_into::text,
    jsonb_build_object('from', p_from, 'from_phone', v_from.phone, 'from_name', v_from.name, 'children', v_n));
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Recovery campaigns (calls) and activities
-- ---------------------------------------------------------------------------
create table public.recovery_campaigns (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('calls', 'activity')),
  name             text not null,
  description      text,
  start_date       date not null default public.fees_today(),
  end_date         date,
  status           text not null default 'active' check (status in ('active', 'closed')),
  target_amount    bigint check (target_amount is null or target_amount > 0),
  -- call list rules (kind = 'calls'): a family owing at least min_due (overdue, incl. old dues) is called when
  -- any enabled rule holds
  class_ids        uuid[] not null default '{}',     -- only families with a child in these classes (empty = all)
  min_due          bigint not null default 100 check (min_due > 0),
  silent_days      integer default 60 check (silent_days is null or silent_days between 1 and 730),  -- nothing paid for this long
  high_due         bigint default 2000000 check (high_due is null or high_due > 0),       -- owes at least this much
  include_old_dues boolean not null default true,                                         -- has previous-session dues
  include_broken   boolean not null default true,                                         -- did not keep a promise
  recall_days      integer not null default 7 check (recall_days between 1 and 90),       -- gap after a call / payment
  created_by       uuid default public.current_user_id() references public.app_users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create trigger recovery_campaigns_touch before update on public.recovery_campaigns
  for each row execute function public.touch_updated_at();

create table public.parent_calls (
  id               uuid primary key default gen_random_uuid(),
  parent_id        uuid not null references public.parents (id) on delete restrict,
  campaign_id      uuid references public.recovery_campaigns (id) on delete set null,
  call_date        date not null,
  called_at        timestamptz not null default now(),
  outcome          text not null check (outcome in ('connected', 'no_answer', 'busy', 'switched_off', 'wrong_number')),
  picked_by        text check (picked_by in ('father', 'mother', 'guardian', 'student', 'other')),
  response         text check (response in ('will_pay', 'needs_time', 'financial_issue', 'complaint', 'already_paid',
                                            'refused', 'call_later', 'other')),
  summary          text,
  promised_date    date,
  promised_amount  bigint check (promised_amount is null or promised_amount > 0),
  follow_up_on     date,
  created_by       uuid default public.current_user_id() references public.app_users (id) on delete set null,
  check (outcome = 'connected' or (picked_by is null and response is null and promised_date is null)),
  check (promised_amount is null or promised_date is not null),
  check (promised_date is null or promised_date >= call_date),
  check (follow_up_on is null or follow_up_on > call_date)
);
create index parent_calls_parent_idx on public.parent_calls (parent_id, call_date desc);
create index parent_calls_campaign_idx on public.parent_calls (campaign_id, parent_id);

create table public.recovery_participants (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.recovery_campaigns (id) on delete cascade,
  student_id   uuid not null references public.students (id) on delete cascade,
  added_on     date not null,
  response     text not null default 'pending' check (response in ('pending', 'positive', 'partial', 'negative')),
  note         text,
  updated_by   uuid default public.current_user_id() references public.app_users (id) on delete set null,
  updated_at   timestamptz not null default now(),
  unique (campaign_id, student_id)
);
create index recovery_participants_student_idx on public.recovery_participants (student_id);

-- A receipt the accountant counts as paid because of an activity (each receipt counts for one activity)
create table public.recovery_credits (
  payment_id      uuid primary key references public.payments (id) on delete cascade,
  participant_id  uuid not null references public.recovery_participants (id) on delete cascade,
  created_by      uuid default public.current_user_id() references public.app_users (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index recovery_credits_participant_idx on public.recovery_credits (participant_id);

-- The session whose dues are "today's" dues: the current one, else the latest that has started
create function public.running_session() returns uuid
language sql stable set search_path = public as $$
  select id from public.academic_sessions
   order by is_current desc, (start_date <= public.fees_today()) desc, start_date desc
   limit 1
$$;

-- Family fee status from the family's summed balances (same wording as a student's fee status)
create function public.family_fee_status(p_in_session integer, p_all_no_plan boolean, p_expected bigint,
                                         p_overdue bigint, p_received bigint, p_prev_pending bigint)
returns text language sql immutable as $$
  select case
           when coalesce(p_in_session, 0) = 0 then null
           when p_all_no_plan and p_prev_pending = 0 then 'no_plan'
           when p_expected = 0 and p_prev_pending = 0 then 'free'
           when p_overdue = 0 and p_prev_pending = 0 then 'paid_up'
           when p_overdue = 0 then 'arrears_only'
           when p_received = 0 then 'not_paying'
           else 'partial'
         end
$$;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

-- Any staff member may log a call (principals call parents too); everything else needs admin / accountant
create function public.log_parent_call(
  p_parent          uuid,
  p_outcome         text,
  p_campaign        uuid default null,
  p_call_date       date default null,
  p_picked_by       text default null,
  p_response        text default null,
  p_summary         text default null,
  p_promised_date   date default null,
  p_promised_amount bigint default null,
  p_follow_up_on    date default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.fees_today();
  v_date  date := coalesce(p_call_date, public.fees_today());
  v_c     public.recovery_campaigns;
  v_id    uuid;
begin
  perform public.assert_staff();
  if not exists (select 1 from public.parents where id = p_parent) then raise exception 'Parent not found'; end if;
  if p_campaign is not null then
    select * into v_c from public.recovery_campaigns where id = p_campaign;
    if not found then raise exception 'Campaign not found'; end if;
    if v_c.kind <> 'calls' then raise exception 'Calls can only be logged in a call campaign'; end if;
    if v_c.status <> 'active' then raise exception 'This campaign is closed. Reopen it to log calls in it.'; end if;
  end if;
  if v_date > v_today then raise exception 'The call date cannot be in the future'; end if;
  if v_date < v_today - 60 then raise exception 'Calls more than 60 days old cannot be logged'; end if;
  if p_outcome <> 'connected' and (p_picked_by is not null or p_response is not null or p_promised_date is not null) then
    raise exception 'Who picked up, what they said and a promise can only be recorded when the call got through';
  end if;
  if p_promised_amount is not null and p_promised_date is null then raise exception 'Enter the date they promised to pay by'; end if;
  if p_promised_date is not null and p_promised_date < v_date then raise exception 'The promised date cannot be before the call'; end if;
  if p_follow_up_on is not null and p_follow_up_on <= v_date then raise exception 'The next call date must be after the call'; end if;

  insert into public.parent_calls (parent_id, campaign_id, call_date, outcome, picked_by, response, summary,
                                   promised_date, promised_amount, follow_up_on)
  values (p_parent, p_campaign, v_date, p_outcome, p_picked_by, p_response, nullif(trim(p_summary), ''),
          p_promised_date, p_promised_amount, p_follow_up_on)
  returning id into v_id;
  return v_id;
end $$;

-- Add students to an activity: chosen students and / or every active student of a class (section) in the
-- running session; p_only_dues keeps only those who owe overdue fees
create function public.add_activity_participants(
  p_campaign  uuid,
  p_students  uuid[] default null,
  p_class     uuid default null,
  p_section   text default null,
  p_only_dues boolean default false
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_c     public.recovery_campaigns;
  v_sess  uuid := public.running_session();
  v_today date := public.fees_today();
  v_n     integer;
begin
  perform public.assert_writer();
  select * into v_c from public.recovery_campaigns where id = p_campaign;
  if not found then raise exception 'Campaign not found'; end if;
  if v_c.kind <> 'activity' then raise exception 'Students can only be added to a student activity'; end if;
  if p_class is null and coalesce(cardinality(p_students), 0) = 0 then raise exception 'Choose a class or at least one student'; end if;

  if p_only_dues and v_sess is not null then
    with cand as (
      select st.id from public.students st where st.id = any (coalesce(p_students, '{}'))
      union
      select e.student_id from public.enrollments e
        join public.students st on st.id = e.student_id and st.status = 'active'
       where p_class is not null and e.session_id = v_sess and e.class_id = p_class
         and (nullif(trim(p_section), '') is null or e.section = trim(p_section))
    )
    insert into public.recovery_participants (campaign_id, student_id, added_on)
    select p_campaign, cand.id, v_today
      from cand
      join (select b.student_id from public.student_balances(v_sess) b where b.total_overdue > 0) d on d.student_id = cand.id
    on conflict (campaign_id, student_id) do nothing;
  else
    with cand as (
      select st.id from public.students st where st.id = any (coalesce(p_students, '{}'))
      union
      select e.student_id from public.enrollments e
        join public.students st on st.id = e.student_id and st.status = 'active'
       where p_class is not null and e.session_id = v_sess and e.class_id = p_class
         and (nullif(trim(p_section), '') is null or e.section = trim(p_section))
    )
    insert into public.recovery_participants (campaign_id, student_id, added_on)
    select p_campaign, cand.id, v_today from cand
    on conflict (campaign_id, student_id) do nothing;
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Count a receipt as paid because of an activity (marks a pending participant as a positive response)
create function public.credit_recovery_payment(p_participant uuid, p_payment uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_pa    public.recovery_participants;
  v_c     public.recovery_campaigns;
  v_p     public.payments;
  v_other text;
begin
  perform public.assert_writer();
  select * into v_pa from public.recovery_participants where id = p_participant;
  if not found then raise exception 'Participant not found'; end if;
  select * into v_c from public.recovery_campaigns where id = v_pa.campaign_id;
  select * into v_p from public.payments where id = p_payment;
  if not found then raise exception 'Payment not found'; end if;
  if v_p.student_id <> v_pa.student_id then raise exception 'Receipt % belongs to another student', v_p.receipt_no; end if;
  if v_p.amount <= 0 or exists (select 1 from public.payments r where r.reverses_payment_id = v_p.id) then
    raise exception 'Receipt % is cancelled', v_p.receipt_no;
  end if;
  if v_p.paid_on < v_c.start_date then
    raise exception 'Receipt % was paid before the activity started', v_p.receipt_no;
  end if;
  select c.name into v_other
    from public.recovery_credits rc
    join public.recovery_participants rp on rp.id = rc.participant_id
    join public.recovery_campaigns c on c.id = rp.campaign_id
   where rc.payment_id = p_payment;
  if v_other is not null then raise exception 'Receipt % is already counted for "%"', v_p.receipt_no, v_other; end if;

  insert into public.recovery_credits (payment_id, participant_id) values (p_payment, p_participant);
  update public.recovery_participants
     set response = 'positive', updated_by = public.current_user_id(), updated_at = now()
   where id = p_participant and response = 'pending';
  perform public.audit('credit_recovery', 'recovery_credits', p_payment::text,
    jsonb_build_object('campaign', v_c.id, 'participant', p_participant, 'receipt_no', v_p.receipt_no, 'amount', v_p.amount));
end $$;

-- ---------------------------------------------------------------------------
-- Promises (from calls and from student notes) and whether they were kept
-- ---------------------------------------------------------------------------
create function public.parent_promises(p_parent uuid default null)
returns table (
  source          text,     -- 'call' | 'note'
  source_id       uuid,
  parent_id       uuid,
  student_id      uuid,     -- notes: the student the note is on
  campaign_id     uuid,
  made_by         uuid,
  made_at         timestamptz,
  made_on         date,
  promised_date   date,
  promised_amount bigint,
  deadline        date,     -- promised date + grace days
  paid            bigint,   -- paid by the family (any child) from the day of the promise to the deadline
  kept_on         date,     -- the day the promised amount (or any payment, when no amount) was reached
  status          text,     -- kept | pending | partial | broken
  timing          text      -- when kept: early | on_date | grace
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_today date := public.fees_today();
  v_grace integer;
  v_tz    text;
begin
  perform public.assert_staff();
  select s.promise_grace_days, s.timezone into v_grace, v_tz from public.school_settings s where s.id = 1;
  v_grace := coalesce(v_grace, 1);

  return query
  with pr as (
    select 'call'::text as src, c.id as sid, c.parent_id as pid, null::uuid as stid, c.campaign_id as cid,
           c.created_by as by_id, c.called_at as at_ts, c.call_date as on_day, c.promised_date as pdate, c.promised_amount as pamt
      from public.parent_calls c
     where c.promised_date is not null and (p_parent is null or c.parent_id = p_parent)
    union all
    select 'note', n.id, st.parent_id, n.student_id, null::uuid, n.created_by, n.created_at,
           (n.created_at at time zone coalesce(v_tz, 'Asia/Kolkata'))::date, n.promised_date, n.promised_amount
      from public.student_notes n
      join public.students st on st.id = n.student_id
     where n.promised_date is not null and st.parent_id is not null and (p_parent is null or st.parent_id = p_parent)
  ),
  pay as (   -- receipts of the families that were not cancelled
    select st.parent_id as pid, p.id, p.paid_on, p.amount, p.created_at
      from public.payments p
      join public.students st on st.id = p.student_id
     where p.amount > 0 and st.parent_id is not null
       and (p_parent is null or st.parent_id = p_parent)
       and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
  ),
  x as (
    select pr.*, pr.pdate + v_grace as dl,
           coalesce((select sum(y.amount) from pay y
                      where y.pid = pr.pid and y.paid_on between pr.on_day and pr.pdate + v_grace), 0)::bigint as paid_amt,
           (select min(z.paid_on)
              from (select y.paid_on, sum(y.amount) over (order by y.paid_on, y.created_at, y.id) as cum
                      from pay y
                     where y.pid = pr.pid and y.paid_on between pr.on_day and pr.pdate + v_grace) z
             where z.cum >= coalesce(pr.pamt, 1)) as kept_day
      from pr
  )
  select x.src, x.sid, x.pid, x.stid, x.cid, x.by_id, x.at_ts, x.on_day, x.pdate, x.pamt, x.dl, x.paid_amt, x.kept_day,
         case when x.kept_day is not null then 'kept'
              when v_today <= x.dl then 'pending'
              when x.paid_amt > 0 then 'partial'
              else 'broken' end,
         case when x.kept_day is null then null
              when x.kept_day < x.pdate then 'early'
              when x.kept_day = x.pdate then 'on_date'
              else 'grace' end
    from x;
end $$;

-- ---------------------------------------------------------------------------
-- Parent (family) balances for a session: the children's student_balances added up
-- ---------------------------------------------------------------------------
create function public.parent_balances(p_session uuid)
returns table (
  parent_id           uuid,
  name                text,
  phone               text,
  alt_phone           text,
  relation            text,
  economic_status     text,
  payment_behaviour   text,
  attitude            text,
  children            integer,   -- linked students (any status)
  children_in_session integer,   -- of them, in this session's balances
  children_list       jsonb,
  expected            bigint,
  due_expected        bigint,
  received            bigint,
  pending             bigint,
  overdue             bigint,
  concession          bigint,
  prev_opening        bigint,
  prev_recovered      bigint,
  prev_pending        bigint,
  total_pending       bigint,
  total_overdue       bigint,
  advance_balance     bigint,
  last_paid_on        date,
  days_since_payment  integer,
  paid_pct            numeric,
  family_status       text,
  calls               integer,
  last_call_on        date,
  last_outcome        text,
  promise_date        date,
  promise_amount      bigint,
  promise_status      text
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_today date := public.fees_today();
begin
  perform public.assert_staff();
  return query
  with sb as materialized (select * from public.student_balances(p_session)),
  k as (
    select st.parent_id as pid, st.id as sid, st.full_name, st.status as st_status, b.student_id is not null as in_s,
           b.class_name, b.class_order, b.section, b.fee_status,
           coalesce(b.expected, 0) as e, coalesce(b.due_expected, 0) as de, coalesce(b.received, 0) as r,
           coalesce(b.pending, 0) as pe, coalesce(b.overdue, 0) as od, coalesce(b.concession, 0) as co,
           coalesce(b.prev_opening, 0) as po, coalesce(b.prev_recovered, 0) as pr, coalesce(b.prev_pending, 0) as pp,
           coalesce(b.total_pending, 0) as tp, coalesce(b.total_overdue, 0) as tod, coalesce(b.advance_balance, 0) as adv
      from public.students st
      left join sb b on b.student_id = st.id
     where st.parent_id is not null
  ),
  fam as (
    select k.pid,
           count(*)::int as n_children,
           (count(*) filter (where k.in_s))::int as n_in,
           jsonb_agg(jsonb_build_object('student_id', k.sid, 'full_name', k.full_name, 'status', k.st_status,
                                        'class_name', k.class_name, 'section', k.section, 'fee_status', k.fee_status,
                                        'total_pending', k.tp, 'in_session', k.in_s)
                     order by k.in_s desc, k.class_order nulls last, k.full_name) as list,
           sum(k.e)::bigint as e, sum(k.de)::bigint as de, sum(k.r)::bigint as r, sum(k.pe)::bigint as pe,
           sum(k.od)::bigint as od, sum(k.co)::bigint as co, sum(k.po)::bigint as po, sum(k.pr)::bigint as pr,
           sum(k.pp)::bigint as pp, sum(k.tp)::bigint as tp, sum(k.tod)::bigint as tod, sum(k.adv)::bigint as adv,
           coalesce(bool_and(k.fee_status = 'no_plan') filter (where k.in_s), false) as all_no_plan
      from k
     group by k.pid
  ),
  lp as (
    select st.parent_id as pid, max(p.paid_on) as last_paid
      from public.payments p
      join public.students st on st.id = p.student_id
     where st.parent_id is not null and p.amount > 0
       and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
     group by st.parent_id
  ),
  cs as (
    select c.parent_id as pid, count(*)::int as n, max(c.call_date) as last_on,
           (array_agg(c.outcome order by c.call_date desc, c.called_at desc))[1] as last_outcome
      from public.parent_calls c
     group by c.parent_id
  ),
  pr as (
    select distinct on (x.parent_id) x.parent_id as pid, x.promised_date, x.promised_amount, x.status
      from public.parent_promises() x
     order by x.parent_id, x.made_on desc, x.made_at desc
  )
  select p.id, p.name, p.phone, p.alt_phone, p.relation, p.economic_status, p.payment_behaviour, p.attitude,
         coalesce(f.n_children, 0), coalesce(f.n_in, 0), coalesce(f.list, '[]'::jsonb),
         coalesce(f.e, 0)::bigint, coalesce(f.de, 0)::bigint, coalesce(f.r, 0)::bigint, coalesce(f.pe, 0)::bigint,
         coalesce(f.od, 0)::bigint, coalesce(f.co, 0)::bigint, coalesce(f.po, 0)::bigint, coalesce(f.pr, 0)::bigint,
         coalesce(f.pp, 0)::bigint, coalesce(f.tp, 0)::bigint, coalesce(f.tod, 0)::bigint, coalesce(f.adv, 0)::bigint,
         lp.last_paid, (v_today - lp.last_paid)::integer,
         case when f.e > 0 then round(100.0 * f.r / f.e, 1) end,
         public.family_fee_status(f.n_in, f.all_no_plan, f.e, f.od, f.r, f.pp),
         coalesce(cs.n, 0), cs.last_on, cs.last_outcome,
         pr.promised_date, pr.promised_amount, pr.status
    from public.parents p
    left join fam f on f.pid = p.id
    left join lp on lp.pid = p.id
    left join cs on cs.pid = p.id
    left join pr on pr.pid = p.id;
end $$;

-- ---------------------------------------------------------------------------
-- Parent 360: the family's children, fees, payments, calls, promises, habit and activities
-- ---------------------------------------------------------------------------
create function public.parent_360(p_parent uuid, p_session uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_p         public.parents;
  v_today     date := public.fees_today();
  v_sess      public.academic_sessions;
  v_children  jsonb;
  v_totals    jsonb;
  v_last      jsonb;
  v_payments  jsonb;
  v_calls     jsonb;
  v_promises  jsonb;
  v_rel       jsonb;
  v_beh       jsonb;
  v_acts      jsonb;
  v_sessions  jsonb;
  v_last_paid date;
  v_per_year  numeric;
begin
  perform public.assert_staff();
  select * into v_p from public.parents where id = p_parent;
  if not found then raise exception 'Parent not found'; end if;
  select * into v_sess from public.academic_sessions where id = coalesce(p_session, public.running_session());

  select max(p.paid_on) into v_last_paid
    from public.payments p join public.students st on st.id = p.student_id
   where st.parent_id = p_parent and p.amount > 0
     and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id);

  if v_sess.id is not null then
    with sb as materialized (
      select b.* from public.student_balances(v_sess.id) b
       where b.student_id in (select s2.id from public.students s2 where s2.parent_id = p_parent)
    ),
    k as (
      select st.id, st.full_name, st.admission_no, st.status, st.left_on, st.phone, st.father_name, st.mother_name,
             b.student_id is not null as in_s, b.class_id, b.class_name, b.class_order, b.section, b.roll_no, b.fee_status,
             coalesce(b.expected, 0) as expected, coalesce(b.due_expected, 0) as due_expected,
             coalesce(b.received, 0) as received, coalesce(b.pending, 0) as pending, coalesce(b.overdue, 0) as overdue,
             coalesce(b.concession, 0) as concession, coalesce(b.prev_opening, 0) as prev_opening,
             coalesce(b.prev_recovered, 0) as prev_recovered, coalesce(b.prev_pending, 0) as prev_pending,
             coalesce(b.total_pending, 0) as total_pending, coalesce(b.total_overdue, 0) as total_overdue,
             coalesce(b.advance_balance, 0) as advance_balance, b.last_paid_on, b.paid_pct
        from public.students st
        left join sb b on b.student_id = st.id
       where st.parent_id = p_parent
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'student_id', k.id, 'full_name', k.full_name, 'admission_no', k.admission_no, 'status', k.status,
             'left_on', k.left_on, 'phone', k.phone, 'father_name', k.father_name, 'mother_name', k.mother_name,
             'in_session', k.in_s, 'class_id', k.class_id, 'class_name', k.class_name, 'section', k.section, 'roll_no', k.roll_no,
             'fee_status', k.fee_status, 'expected', k.expected, 'received', k.received, 'pending', k.pending,
             'overdue', k.overdue, 'prev_pending', k.prev_pending, 'total_pending', k.total_pending,
             'total_overdue', k.total_overdue, 'advance_balance', k.advance_balance, 'last_paid_on', k.last_paid_on,
             'paid_pct', k.paid_pct
           ) order by k.in_s desc, k.class_order nulls last, k.full_name), '[]'::jsonb),
           jsonb_build_object(
             'expected', coalesce(sum(k.expected), 0), 'due_expected', coalesce(sum(k.due_expected), 0),
             'received', coalesce(sum(k.received), 0), 'pending', coalesce(sum(k.pending), 0),
             'overdue', coalesce(sum(k.overdue), 0), 'concession', coalesce(sum(k.concession), 0),
             'prev_opening', coalesce(sum(k.prev_opening), 0), 'prev_recovered', coalesce(sum(k.prev_recovered), 0),
             'prev_pending', coalesce(sum(k.prev_pending), 0), 'total_pending', coalesce(sum(k.total_pending), 0),
             'total_overdue', coalesce(sum(k.total_overdue), 0), 'advance_balance', coalesce(sum(k.advance_balance), 0),
             'last_paid_on', v_last_paid, 'days_since_payment', v_today - v_last_paid,
             'family_status', public.family_fee_status((count(*) filter (where k.in_s))::int,
                                                        coalesce(bool_and(k.fee_status = 'no_plan') filter (where k.in_s), false),
                                                        coalesce(sum(k.expected), 0)::bigint, coalesce(sum(k.overdue), 0)::bigint,
                                                        coalesce(sum(k.received), 0)::bigint, coalesce(sum(k.prev_pending), 0)::bigint))
      into v_children, v_totals
      from k;
  else
    select coalesce(jsonb_agg(jsonb_build_object('student_id', st.id, 'full_name', st.full_name, 'admission_no', st.admission_no,
                                                 'status', st.status, 'in_session', false) order by st.full_name), '[]'::jsonb)
      into v_children
      from public.students st where st.parent_id = p_parent;
  end if;

  -- the family's latest payment and what it paid for
  select jsonb_build_object(
           'payment_id', p.id, 'receipt_no', p.receipt_no, 'paid_on', p.paid_on, 'amount', p.amount, 'student_name', st.full_name,
           'current', coalesce(sum(a.amount) filter (where a.kind = 'current'), 0),
           'arrears', coalesce(sum(a.amount) filter (where a.kind = 'arrears'), 0),
           'advance', coalesce(sum(a.amount) filter (where a.kind = 'advance'), 0))
    into v_last
    from public.payments p
    join public.students st on st.id = p.student_id
    left join public.allocations a on a.payment_id = p.id
   where p.id = (select p2.id from public.payments p2 join public.students s2 on s2.id = p2.student_id
                  where s2.parent_id = p_parent and p2.amount > 0
                    and not exists (select 1 from public.payments r where r.reverses_payment_id = p2.id)
                  order by p2.paid_on desc, p2.created_at desc limit 1)
   group by p.id, p.receipt_no, p.paid_on, p.amount, st.full_name;

  -- every receipt of every child, newest first
  select coalesce(jsonb_agg(x.j order by x.paid_on desc, x.created_at desc), '[]'::jsonb)
    into v_payments
    from (
      select p.paid_on, p.created_at,
             jsonb_build_object(
               'payment_id', p.id, 'receipt_no', p.receipt_no, 'paid_on', p.paid_on, 'amount', p.amount, 'mode', p.mode,
               'student_id', st.id, 'full_name', st.full_name,
               'is_reversal', p.reverses_payment_id is not null,
               'cancelled', exists (select 1 from public.payments r where r.reverses_payment_id = p.id),
               'current', coalesce((select sum(a.amount) from public.allocations a where a.payment_id = p.id and a.kind = 'current'), 0),
               'arrears', coalesce((select sum(a.amount) from public.allocations a where a.payment_id = p.id and a.kind = 'arrears'), 0),
               'advance', coalesce((select sum(a.amount) from public.allocations a where a.payment_id = p.id and a.kind = 'advance'), 0)
             ) as j
        from public.payments p
        join public.students st on st.id = p.student_id
       where st.parent_id = p_parent
       order by p.paid_on desc, p.created_at desc
       limit 200
    ) x;

  -- call history, each promise with how it turned out
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'call_date', c.call_date, 'called_at', c.called_at, 'outcome', c.outcome, 'picked_by', c.picked_by,
           'response', c.response, 'summary', c.summary, 'promised_date', c.promised_date, 'promised_amount', c.promised_amount,
           'follow_up_on', c.follow_up_on, 'campaign_id', c.campaign_id, 'campaign_name', rc.name,
           'author', coalesce(nullif(pr.full_name, ''), pr.email),
           'promise', case when pp.source_id is null then null
                           else jsonb_build_object('status', pp.status, 'timing', pp.timing, 'paid', pp.paid,
                                                   'kept_on', pp.kept_on, 'deadline', pp.deadline) end
         ) order by c.call_date desc, c.called_at desc), '[]'::jsonb)
    into v_calls
    from public.parent_calls c
    left join public.recovery_campaigns rc on rc.id = c.campaign_id
    left join public.profiles pr on pr.id = c.created_by
    left join public.parent_promises(p_parent) pp on pp.source = 'call' and pp.source_id = c.id
   where c.parent_id = p_parent;

  -- every promise (calls and student notes) and how reliable the family is
  with pp as (select * from public.parent_promises(p_parent))
  select coalesce(jsonb_agg(jsonb_build_object(
           'source', pp.source, 'source_id', pp.source_id, 'student_id', pp.student_id, 'student_name', st.full_name,
           'campaign_name', rc.name, 'made_on', pp.made_on, 'promised_date', pp.promised_date,
           'promised_amount', pp.promised_amount, 'deadline', pp.deadline, 'paid', pp.paid, 'kept_on', pp.kept_on,
           'status', pp.status, 'timing', pp.timing
         ) order by pp.made_on desc, pp.made_at desc), '[]'::jsonb),
         jsonb_build_object(
           'made', count(*),
           'kept', count(*) filter (where pp.status = 'kept'),
           'early', count(*) filter (where pp.timing = 'early'),
           'on_date', count(*) filter (where pp.timing = 'on_date'),
           'grace', count(*) filter (where pp.timing = 'grace'),
           'partial', count(*) filter (where pp.status = 'partial'),
           'broken', count(*) filter (where pp.status = 'broken'),
           'pending', count(*) filter (where pp.status = 'pending'),
           'kept_pct', case when count(*) filter (where pp.status <> 'pending') > 0
                            then round(100.0 * count(*) filter (where pp.status = 'kept')
                                       / count(*) filter (where pp.status <> 'pending')) end)
    into v_promises, v_rel
    from pp
    left join public.students st on st.id = pp.student_id
    left join public.recovery_campaigns rc on rc.id = pp.campaign_id;

  -- payment habit of the whole family, from money that went to charges (same rules as a student's habit)
  select count(*)::numeric / nullif(count(distinct p.session_id), 0)
    into v_per_year
    from public.payments p join public.students st on st.id = p.student_id
   where st.parent_id = p_parent and p.amount > 0
     and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id);

  with x as (
    select a.amount, (a.paid_on - i.due_date) as days, extract(month from a.paid_on)::int as mon
      from public.allocations a
      join public.installments i on i.id = a.installment_id
      join public.students st on st.id = a.student_id
     where st.parent_id = p_parent and a.amount > 0
  ),
  h as (
    select coalesce(sum(x.amount), 0) as amt,
           case when sum(x.amount) > 0 then round(sum(x.days * x.amount)::numeric / sum(x.amount), 0) end as avg_days,
           case when sum(x.amount) > 0 then round(100.0 * coalesce(sum(x.amount) filter (where x.days <= 0), 0) / sum(x.amount), 0) end as on_time,
           case when sum(x.amount) > 0 then round(100.0 * coalesce(sum(x.amount) filter (where x.mon in (1, 2, 3)), 0) / sum(x.amount), 0) end as year_end,
           case
             when coalesce(sum(x.amount), 0) = 0 then 'no_history'
             when sum(x.amount) filter (where x.mon in (1, 2, 3) and x.days > 30) > sum(x.amount) * 0.5 then 'year_end'
             when sum(x.days * x.amount)::numeric / sum(x.amount) <= -7 then 'early'
             when sum(x.days * x.amount)::numeric / sum(x.amount) <= 15 then 'on_time'
             else 'late'
           end as profile
      from x
  )
  select jsonb_build_object(
           'allocated_amount', h.amt, 'avg_days_from_due', h.avg_days, 'on_time_pct', h.on_time, 'year_end_pct', h.year_end,
           'profile', h.profile,
           'payments_per_year', round(v_per_year, 1),
           'carried_forward', coalesce((v_totals ->> 'prev_opening')::bigint, 0) > 0,
           'suggested', case
              when h.profile = 'no_history' then case when coalesce((v_totals ->> 'total_overdue')::bigint, 0) > 0 then 'non_payer' end
              when coalesce((v_totals ->> 'prev_opening')::bigint, 0) > 0 and h.profile in ('late', 'year_end') then 'carries_forward'
              when h.profile = 'year_end' then 'year_end'
              when h.profile in ('early', 'on_time') then case when coalesce(v_per_year, 0) >= 2 then 'installment_wise' else 'regular' end
              else 'irregular'
           end)
    into v_beh
    from h;

  -- what the family owes per session (old dues carried into later years show here)
  select coalesce(jsonb_agg(jsonb_build_object(
           'session_id', s.id, 'session_name', s.name, 'is_current', s.is_current,
           'net', x.net, 'paid', x.paid, 'remaining', x.net - x.paid
         ) order by s.start_date desc), '[]'::jsonb)
    into v_sessions
    from (
      select sc.session_id, sum(sc.net_amount)::bigint as net, coalesce(sum(al.amt), 0)::bigint as paid
        from public.student_charges sc
        join public.students st on st.id = sc.student_id and st.parent_id = p_parent
        left join (select a.charge_id, sum(a.amount) as amt from public.allocations a
                    where a.student_id in (select s2.id from public.students s2 where s2.parent_id = p_parent)
                    group by a.charge_id) al on al.charge_id = sc.id
       group by sc.session_id
    ) x
    join public.academic_sessions s on s.id = x.session_id;

  -- recovery activities the children took part in
  select coalesce(jsonb_agg(jsonb_build_object(
           'participant_id', rp.id, 'campaign_id', c.id, 'name', c.name, 'status', c.status,
           'start_date', c.start_date, 'end_date', c.end_date, 'student_id', st.id, 'student_name', st.full_name,
           'response', rp.response, 'note', rp.note,
           'credited', coalesce((select sum(p.amount) from public.recovery_credits rc join public.payments p on p.id = rc.payment_id
                                  where rc.participant_id = rp.id
                                    and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)), 0)
         ) order by c.start_date desc, st.full_name), '[]'::jsonb)
    into v_acts
    from public.recovery_participants rp
    join public.recovery_campaigns c on c.id = rp.campaign_id
    join public.students st on st.id = rp.student_id
   where st.parent_id = p_parent;

  return jsonb_build_object(
    'parent', to_jsonb(v_p),
    'session', case when v_sess.id is null then null else jsonb_build_object('id', v_sess.id, 'name', v_sess.name) end,
    'today', v_today,
    'grace_days', (select promise_grace_days from public.school_settings where id = 1),
    'children', coalesce(v_children, '[]'::jsonb),
    'totals', v_totals,
    'last_payment', v_last,
    'payments', v_payments,
    'calls', v_calls,
    'promises', v_promises,
    'reliability', v_rel,
    'behaviour', v_beh,
    'sessions', v_sessions,
    'activities', v_acts
  );
end $$;

-- ---------------------------------------------------------------------------
-- Call list of call campaigns
--
-- For every family in the campaign's classes (dues of the running session, incl. old dues):
--   reasons   broken_promise / partial_promise : the promise ran out unpaid and no call got through since
--             call_back  : the last call asked to call again on a date that has come
--             high_dues  : owes at least high_due
--             silent     : nothing paid for silent_days (or ever)
--             old_dues   : owes previous-session dues
--             owes       : the campaign has no rules, so everyone owing min_due
--   state     cleared  : owes less than min_due
--             promised : waiting for a promise (until its deadline)
--             off_list : no rule holds any more (shown only when called in this campaign)
--             due      : call now. A broken promise is due the day after its deadline.
--             waiting  : called recently (1 day after an unanswered call, recall_days after a call that got
--                        through, or the date they asked for) or paid in the last recall_days (a broken promise
--                        only waits for a call made after its deadline)
--   priority  broken promises and call-backs first, then the bigger dues; silent families, old dues and families
--             who can pay (economic condition, payment habit) move up
-- ---------------------------------------------------------------------------
create function public.call_queue(p_campaigns uuid[])
returns table (
  campaign_id        uuid,
  parent_id          uuid,
  state              text,
  next_call_on       date,
  priority           integer,
  reasons            text[],
  total_overdue      bigint,
  total_pending      bigint,
  prev_pending       bigint,
  last_paid_on       date,
  days_since_payment integer,
  children           jsonb,
  calls              integer,
  first_call_on      date,
  last_call_on       date,
  last_outcome       text,
  last_response      text,
  last_summary       text,
  follow_up_on       date,
  promise_date       date,
  promise_amount     bigint,
  promise_status     text,
  promise_deadline   date,
  promise_paid       bigint
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_today date := public.fees_today();
  v_sess  uuid := public.running_session();
begin
  perform public.assert_staff();
  if v_sess is null or coalesce(cardinality(p_campaigns), 0) = 0 then return; end if;

  return query
  with camp as (
    select c.* from public.recovery_campaigns c where c.id = any (p_campaigns) and c.kind = 'calls'
  ),
  sb as materialized (
    select b.student_id, b.full_name, b.class_id, b.class_name, b.class_order, b.section,
           b.total_overdue, b.total_pending, b.prev_pending
      from public.student_balances(v_sess) b
  ),
  fam as (
    select st.parent_id as pid,
           sum(sb.total_overdue)::bigint as tod,
           sum(sb.total_pending)::bigint as tp,
           sum(sb.prev_pending)::bigint as pp,
           coalesce(array_agg(sb.class_id) filter (where sb.class_id is not null), '{}') as cls,
           jsonb_agg(jsonb_build_object('student_id', sb.student_id, 'full_name', sb.full_name, 'class_name', sb.class_name,
                                        'section', sb.section, 'total_overdue', sb.total_overdue)
                     order by sb.class_order nulls last, sb.full_name) as kids
      from sb
      join public.students st on st.id = sb.student_id
     where st.parent_id is not null
     group by st.parent_id
  ),
  lp as (
    select st.parent_id as pid, max(p.paid_on) as last_paid
      from public.payments p
      join public.students st on st.id = p.student_id
     where st.parent_id is not null and p.amount > 0
       and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
     group by st.parent_id
  ),
  pr as (
    select distinct on (x.parent_id) x.parent_id as pid, x.promised_date, x.promised_amount, x.status, x.deadline, x.paid
      from public.parent_promises() x
     order by x.parent_id, x.made_on desc, x.made_at desc
  ),
  conn as (   -- the last call (any campaign) that got through
    select c.parent_id as pid, max(c.call_date) as last_on
      from public.parent_calls c where c.outcome = 'connected' group by c.parent_id
  ),
  cc as (     -- the latest call of each family in each campaign
    select y.* from (
      select c.campaign_id as cid, c.parent_id as pid, c.call_date, c.outcome, c.response, c.summary, c.follow_up_on,
             count(*) over w as n, min(c.call_date) over w as first_on,
             row_number() over (partition by c.campaign_id, c.parent_id order by c.call_date desc, c.called_at desc, c.id) as rn
        from public.parent_calls c
       where c.campaign_id = any (p_campaigns)
      window w as (partition by c.campaign_id, c.parent_id)
    ) y
     where y.rn = 1
  ),
  b as (
    select camp.id as cid, camp.min_due, camp.high_due, camp.recall_days,
           f.pid, f.tod, f.tp, f.pp, f.kids, lp.last_paid,
           pr.promised_date as p_date, pr.promised_amount as p_amount, pr.status as p_status, pr.deadline as p_deadline,
           pr.paid as p_paid,
           cc.n as n_calls, cc.first_on, cc.call_date as lc_on, cc.outcome as lc_outcome, cc.response as lc_response,
           cc.summary as lc_summary, cc.follow_up_on as lc_follow,
           pa.economic_status, pa.payment_behaviour,
           coalesce(camp.include_broken and pr.status in ('broken', 'partial')
                    and coalesce(conn.last_on, '-infinity'::date) <= pr.deadline
                    and coalesce(lp.last_paid, '-infinity'::date) <= pr.deadline, false) as r_broken,
           coalesce(cc.follow_up_on <= v_today, false) as r_callback,
           (camp.silent_days is not null and (lp.last_paid is null or v_today - lp.last_paid >= camp.silent_days)) as r_silent,
           (camp.high_due is not null and f.tod >= camp.high_due) as r_high,
           (camp.include_old_dues and f.pp > 0) as r_old,
           (camp.silent_days is null and camp.high_due is null and not camp.include_old_dues and not camp.include_broken) as r_any
      from camp
      cross join fam f
      join public.parents pa on pa.id = f.pid
      left join lp on lp.pid = f.pid
      left join pr on pr.pid = f.pid
      left join conn on conn.pid = f.pid
      left join cc on cc.cid = camp.id and cc.pid = f.pid
     where cardinality(camp.class_ids) = 0 or f.cls && camp.class_ids
  ),
  s as (
    select b.*,
           (b.r_broken or b.r_callback or b.r_silent or b.r_high or b.r_old or b.r_any) as matches,
           -- the earliest day the last call of this campaign allows the next one
           case when b.lc_on is null then v_today
                when b.r_broken and b.lc_on <= b.p_deadline then v_today
                when b.lc_follow is not null then b.lc_follow
                when b.lc_outcome = 'connected' then b.lc_on + b.recall_days
                else b.lc_on + 1 end as next_by_call
      from b
  ),
  t as (
    select s.*,
           case
             when s.tod <= 0 or s.tod < s.min_due then 'cleared'
             when s.p_status = 'pending' then 'promised'
             when not s.matches then 'off_list'
             when s.next_by_call > v_today then 'waiting'
             when s.r_broken then 'due'
             when s.last_paid > v_today - s.recall_days then 'waiting'
             else 'due'
           end as st
      from s
  )
  select t.cid, t.pid, t.st,
         case t.st
           when 'due' then v_today
           when 'promised' then t.p_deadline + 1
           when 'waiting' then case when t.r_broken then t.next_by_call
                                    else greatest(t.next_by_call, coalesce(t.last_paid + t.recall_days, t.next_by_call)) end
         end,
         (case when t.r_broken then 40 when t.r_callback then 30 else 0 end
          + least(30, round(30.0 * t.tod / coalesce(t.high_due, 2000000)))
          + case when t.r_silent then 10 else 0 end
          + case when t.r_old then 8 else 0 end
          + case t.economic_status when 'high' then 12 when 'upper_middle' then 10 when 'middle' then 7
                                   when 'lower_middle' then 4 when 'low' then 1 else 5 end
          + case t.payment_behaviour
              when 'capable_not_paying' then 10 when 'irregular' then 8 when 'installment_wise' then 7 when 'regular' then 7
              when 'year_end' then case when extract(month from v_today) in (1, 2, 3) then 10 else 4 end
              when 'carries_forward' then 5 when 'willing_struggling' then 3 when 'non_payer' then 2 else 5 end
         )::integer,
         array_remove(array[
           case when t.r_broken then case when t.p_status = 'partial' then 'partial_promise' else 'broken_promise' end end,
           case when t.r_callback then 'call_back' end,
           case when t.r_high then 'high_dues' end,
           case when t.r_silent then 'silent' end,
           case when t.r_old then 'old_dues' end,
           case when t.r_any then 'owes' end], null),
         t.tod, t.tp, t.pp, t.last_paid, (v_today - t.last_paid)::integer, t.kids,
         coalesce(t.n_calls, 0)::integer, t.first_on, t.lc_on, t.lc_outcome, t.lc_response, t.lc_summary, t.lc_follow,
         t.p_date, t.p_amount, t.p_status, t.p_deadline, t.p_paid
    from t
   where t.n_calls is not null or (t.matches and t.st <> 'cleared');
end $$;

-- ---------------------------------------------------------------------------
-- One campaign: its rules, results and the call list (calls) or participants (activity)
-- ---------------------------------------------------------------------------
create function public.campaign_detail(p_campaign uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_c       public.recovery_campaigns;
  v_today   date := public.fees_today();
  v_end     date;
  v_sess    uuid := public.running_session();
  v_info    jsonb;
  v_stats   jsonb;
  v_rows    jsonb;
  v_counts  jsonb;
  v_extra   jsonb := '{}';
begin
  perform public.assert_staff();
  select * into v_c from public.recovery_campaigns where id = p_campaign;
  if not found then raise exception 'Campaign not found'; end if;
  v_end := least(coalesce(v_c.end_date, v_today), v_today);

  v_info := to_jsonb(v_c) || jsonb_build_object(
    'created_by_name', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = v_c.created_by),
    'classes', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort_order, c.name), '[]'::jsonb)
                  from public.classes c where c.id = any (v_c.class_ids)));

  if v_c.kind = 'calls' then
    with q as (select * from public.call_queue(array[p_campaign]))
    select coalesce(jsonb_agg(jsonb_build_object(
             'parent_id', q.parent_id, 'name', p.name, 'phone', p.phone, 'alt_phone', p.alt_phone, 'relation', p.relation,
             'economic_status', p.economic_status, 'payment_behaviour', p.payment_behaviour, 'attitude', p.attitude,
             'best_time_to_call', p.best_time_to_call,
             'state', q.state, 'next_call_on', q.next_call_on, 'priority', q.priority, 'reasons', to_jsonb(q.reasons),
             'total_overdue', q.total_overdue, 'total_pending', q.total_pending, 'prev_pending', q.prev_pending,
             'last_paid_on', q.last_paid_on, 'days_since_payment', q.days_since_payment, 'children', q.children,
             'calls', q.calls, 'first_call_on', q.first_call_on, 'last_call_on', q.last_call_on, 'last_outcome', q.last_outcome,
             'last_response', q.last_response, 'last_summary', q.last_summary, 'follow_up_on', q.follow_up_on,
             'promise_date', q.promise_date, 'promise_amount', q.promise_amount, 'promise_status', q.promise_status,
             'promise_deadline', q.promise_deadline, 'promise_paid', q.promise_paid
           ) order by (q.state = 'due') desc, q.priority desc, q.total_overdue desc, p.name), '[]'::jsonb),
           jsonb_build_object(
             'due', count(*) filter (where q.state = 'due'),
             'due_overdue', coalesce(sum(q.total_overdue) filter (where q.state = 'due'), 0),
             'promised', count(*) filter (where q.state = 'promised'),
             'waiting', count(*) filter (where q.state = 'waiting'),
             'cleared', count(*) filter (where q.state = 'cleared'),
             'off_list', count(*) filter (where q.state = 'off_list'),
             'broken', count(*) filter (where q.state = 'due' and q.reasons && array['broken_promise', 'partial_promise']))
      into v_rows, v_counts
      from q
      join public.parents p on p.id = q.parent_id;

    with c as (select * from public.parent_calls where campaign_id = p_campaign),
    pr as (select * from public.parent_promises() x where x.source = 'call' and x.campaign_id = p_campaign),
    fc as (select c.parent_id, min(c.call_date) as d from c group by c.parent_id),
    rec as (   -- money the called families paid from their first call in this campaign to its end
      select fc.parent_id, sum(p.amount) as amt
        from fc
        join public.students st on st.parent_id = fc.parent_id
        join public.payments p on p.student_id = st.id
       where p.amount > 0 and p.paid_on between fc.d and v_end
         and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
       group by fc.parent_id
    )
    select jsonb_build_object(
             'calls', (select count(*) from c),
             'parents_called', (select count(distinct c.parent_id) from c),
             'connected', (select count(*) from c where c.outcome = 'connected'),
             'calls_today', (select count(*) from c where c.call_date = v_today),
             'promises', (select count(*) from pr),
             'promised_amount', (select coalesce(sum(pr.promised_amount), 0) from pr),
             'kept', (select count(*) from pr where pr.status = 'kept'),
             'kept_early', (select count(*) from pr where pr.timing = 'early'),
             'kept_on_date', (select count(*) from pr where pr.timing = 'on_date'),
             'kept_grace', (select count(*) from pr where pr.timing = 'grace'),
             'partial', (select count(*) from pr where pr.status = 'partial'),
             'broken', (select count(*) from pr where pr.status = 'broken'),
             'pending', (select count(*) from pr where pr.status = 'pending'),
             'promise_paid', (select coalesce(sum(pr.paid), 0) from pr),
             'recovered', (select coalesce(sum(rec.amt), 0) from rec),
             'families_paid', (select count(*) from rec where rec.amt > 0)
           ) || v_counts
      into v_stats;

    with c as (select * from public.parent_calls where campaign_id = p_campaign)
    select jsonb_build_object(
             'by_outcome', (select coalesce(jsonb_object_agg(x.outcome, x.n), '{}'::jsonb)
                              from (select c.outcome, count(*) as n from c group by c.outcome) x),
             'by_response', (select coalesce(jsonb_object_agg(x.response, x.n), '{}'::jsonb)
                               from (select c.response, count(*) as n from c where c.response is not null group by c.response) x),
             'by_staff', (select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'calls', x.n, 'connected', x.conn,
                                                                       'promises', x.prom) order by x.n desc, x.name), '[]'::jsonb)
                            from (select coalesce(nullif(p.full_name, ''), p.email, 'Unknown') as name, count(*) as n,
                                         count(*) filter (where c.outcome = 'connected') as conn,
                                         count(*) filter (where c.promised_date is not null) as prom
                                    from c left join public.profiles p on p.id = c.created_by
                                   group by 1) x),
             'recent_calls', (select coalesce(jsonb_agg(x.j order by x.call_date desc, x.called_at desc), '[]'::jsonb)
                                from (select c.call_date, c.called_at,
                                             jsonb_build_object('id', c.id, 'parent_id', c.parent_id, 'parent_name', pa.name,
                                                                'phone', pa.phone, 'call_date', c.call_date, 'called_at', c.called_at,
                                                                'outcome', c.outcome, 'picked_by', c.picked_by, 'response', c.response,
                                                                'summary', c.summary, 'promised_date', c.promised_date,
                                                                'promised_amount', c.promised_amount, 'follow_up_on', c.follow_up_on,
                                                                'author', coalesce(nullif(p.full_name, ''), p.email),
                                                                'promise_status', pp.status, 'promise_timing', pp.timing) as j
                                        from c
                                        join public.parents pa on pa.id = c.parent_id
                                        left join public.profiles p on p.id = c.created_by
                                        left join public.parent_promises() pp on pp.source = 'call' and pp.source_id = c.id
                                       order by c.call_date desc, c.called_at desc
                                       limit 50) x)
           )
      into v_extra;
  else
    with pa as (select * from public.recovery_participants where campaign_id = p_campaign),
    sb as materialized (   -- (no session yet: no balances)
      select b.* from public.academic_sessions s
       cross join lateral public.student_balances(s.id) b
       where s.id = v_sess and b.student_id in (select pa.student_id from pa)
    ),
    pay as (   -- receipts of the participants since the activity started (not cancelled)
      select p.student_id, p.id, p.receipt_no, p.paid_on, p.amount, rc.participant_id as credited_to, cc.name as credited_name
        from public.payments p
        left join public.recovery_credits rc on rc.payment_id = p.id
        left join public.recovery_participants cp on cp.id = rc.participant_id
        left join public.recovery_campaigns cc on cc.id = cp.campaign_id
       where p.student_id in (select pa.student_id from pa)
         and p.amount > 0 and p.paid_on >= v_c.start_date
         and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
    ),
    r as (
      select pa.id, pa.student_id, pa.response, pa.note, pa.added_on, pa.updated_at,
             coalesce((select sum(y.amount) from pay y where y.student_id = pa.student_id and y.paid_on <= v_end), 0) as paid_during,
             coalesce((select sum(y.amount) from pay y where y.credited_to = pa.id), 0) as credited,
             (select count(*) from pay y where y.credited_to = pa.id) as credited_n,
             (select coalesce(jsonb_agg(jsonb_build_object('payment_id', y.id, 'receipt_no', y.receipt_no, 'paid_on', y.paid_on,
                                                           'amount', y.amount, 'credited_here', y.credited_to = pa.id,
                                                           'credited_elsewhere', case when y.credited_to <> pa.id then y.credited_name end)
                                        order by y.paid_on desc), '[]'::jsonb)
                from pay y where y.student_id = pa.student_id) as receipts
        from pa
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'participant_id', r.id, 'student_id', st.id, 'full_name', st.full_name, 'admission_no', st.admission_no,
             'student_status', st.status, 'class_name', sb.class_name, 'section', sb.section,
             'parent_id', st.parent_id, 'parent_name', par.name, 'phone', coalesce(par.phone, st.phone),
             'concerns', par.concerns,
             'total_overdue', coalesce(sb.total_overdue, 0), 'total_pending', coalesce(sb.total_pending, 0),
             'fee_status', sb.fee_status,
             'response', r.response, 'note', r.note, 'added_on', r.added_on, 'updated_at', r.updated_at,
             'paid_during', r.paid_during, 'credited', r.credited, 'receipts', r.receipts
           ) order by sb.class_order nulls last, sb.section, st.full_name), '[]'::jsonb),
           jsonb_build_object(
             'participants', count(*),
             'positive', count(*) filter (where r.response = 'positive'),
             'partial', count(*) filter (where r.response = 'partial'),
             'negative', count(*) filter (where r.response = 'negative'),
             'pending', count(*) filter (where r.response = 'pending'),
             'credited', coalesce(sum(r.credited), 0),
             'credited_receipts', coalesce(sum(r.credited_n), 0),
             'paid_during', coalesce(sum(r.paid_during), 0),
             'payers', count(*) filter (where r.paid_during > 0),
             'overdue_now', coalesce(sum(sb.total_overdue), 0),
             'owing_now', count(*) filter (where coalesce(sb.total_overdue, 0) > 0),
             'recovered', coalesce(sum(r.credited), 0))
      into v_rows, v_stats
      from r
      join public.students st on st.id = r.student_id
      left join public.parents par on par.id = st.parent_id
      left join sb on sb.student_id = r.student_id;
  end if;

  return jsonb_build_object(
    'kind', v_c.kind,
    'campaign', v_info,
    'today', v_today,
    'session', (select jsonb_build_object('id', s.id, 'name', s.name) from public.academic_sessions s where s.id = v_sess),
    'grace_days', (select promise_grace_days from public.school_settings where id = 1),
    'stats', v_stats,
    'rows', v_rows
  ) || v_extra;
end $$;

-- ---------------------------------------------------------------------------
-- Recovery overview: every campaign with its results, today's work and promises falling due
-- ---------------------------------------------------------------------------
create function public.recovery_overview()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today     date := public.fees_today();
  v_active    uuid[];
  v_kpis      jsonb;
  v_open      jsonb;
  v_campaigns jsonb;
  v_upcoming  jsonb;
  v_broken    jsonb;
begin
  perform public.assert_staff();
  select coalesce(array_agg(c.id), '{}') into v_active
    from public.recovery_campaigns c where c.kind = 'calls' and c.status = 'active';

  with q as (select * from public.call_queue(v_active)),
  qd as (
    select q.campaign_id, count(*) filter (where q.state = 'due') as due, count(*) filter (where q.state = 'promised') as promised
      from q group by q.campaign_id
  ),
  calls as (
    select c.campaign_id, count(*) as n, count(distinct c.parent_id) as parents,
           count(*) filter (where c.outcome = 'connected') as connected, max(c.call_date) as last_on
      from public.parent_calls c where c.campaign_id is not null group by c.campaign_id
  ),
  pr as (
    select x.campaign_id, count(*) as n, count(*) filter (where x.status = 'kept') as kept,
           count(*) filter (where x.status in ('broken', 'partial')) as broken, count(*) filter (where x.status = 'pending') as pending
      from public.parent_promises() x where x.source = 'call' and x.campaign_id is not null group by x.campaign_id
  ),
  fc as (
    select c.campaign_id, c.parent_id, min(c.call_date) as d
      from public.parent_calls c where c.campaign_id is not null group by c.campaign_id, c.parent_id
  ),
  rec as (
    select fc.campaign_id, sum(p.amount) as amt, count(distinct fc.parent_id) as families
      from fc
      join public.recovery_campaigns rc on rc.id = fc.campaign_id
      join public.students st on st.parent_id = fc.parent_id
      join public.payments p on p.student_id = st.id
     where p.amount > 0 and p.paid_on between fc.d and least(coalesce(rc.end_date, v_today), v_today)
       and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
     group by fc.campaign_id
  ),
  parts as (
    select rp.campaign_id, count(*) as n,
           count(*) filter (where rp.response = 'positive') as positive,
           count(*) filter (where rp.response = 'partial') as partial,
           count(*) filter (where rp.response = 'negative') as negative,
           count(*) filter (where rp.response = 'pending') as pending
      from public.recovery_participants rp group by rp.campaign_id
  ),
  cred as (
    select rp.campaign_id, sum(p.amount) as amt, count(*) as n
      from public.recovery_credits rc
      join public.recovery_participants rp on rp.id = rc.participant_id
      join public.payments p on p.id = rc.payment_id
     where not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
     group by rp.campaign_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'kind', c.kind, 'name', c.name, 'description', c.description, 'status', c.status,
           'start_date', c.start_date, 'end_date', c.end_date, 'target_amount', c.target_amount, 'created_at', c.created_at,
           'calls', coalesce(calls.n, 0), 'parents_called', coalesce(calls.parents, 0),
           'connected', coalesce(calls.connected, 0), 'last_call_on', calls.last_on,
           'promises', coalesce(pr.n, 0), 'kept', coalesce(pr.kept, 0), 'broken', coalesce(pr.broken, 0),
           'promises_pending', coalesce(pr.pending, 0),
           'to_call', qd.due, 'promised_now', qd.promised,
           'participants', coalesce(parts.n, 0), 'positive', coalesce(parts.positive, 0), 'partial', coalesce(parts.partial, 0),
           'negative', coalesce(parts.negative, 0), 'pending', coalesce(parts.pending, 0),
           'credited_receipts', coalesce(cred.n, 0), 'families_paid', coalesce(rec.families, 0),
           'recovered', case when c.kind = 'calls' then coalesce(rec.amt, 0) else coalesce(cred.amt, 0) end
         ) order by (c.status = 'active') desc, c.start_date desc, c.created_at desc), '[]'::jsonb),
         jsonb_build_object(
           'active_campaigns', count(*) filter (where c.status = 'active'),
           'active_call_campaigns', count(*) filter (where c.status = 'active' and c.kind = 'calls'),
           'families_to_call', (select count(distinct q.parent_id) from q where q.state = 'due'),
           'recovered_calls', coalesce(sum(rec.amt), 0),
           'recovered_activities', coalesce(sum(cred.amt), 0),
           'participants', coalesce(sum(parts.n), 0),
           'positive', coalesce(sum(parts.positive), 0))
    into v_campaigns, v_kpis
    from public.recovery_campaigns c
    left join qd on qd.campaign_id = c.id
    left join calls on calls.campaign_id = c.id
    left join pr on pr.campaign_id = c.id
    left join rec on rec.campaign_id = c.id
    left join parts on parts.campaign_id = c.id
    left join cred on cred.campaign_id = c.id;

  v_kpis := v_kpis || (
    select jsonb_build_object(
             'calls_today', count(*) filter (where c.call_date = v_today),
             'calls_week', count(*) filter (where c.call_date > v_today - 7),
             'connected_week', count(*) filter (where c.call_date > v_today - 7 and c.outcome = 'connected'))
      from public.parent_calls c);

  -- promise results of the last 90 days (all promises), and the families' latest promises still open
  v_kpis := v_kpis || (
    select jsonb_build_object(
             'kept_90', count(*) filter (where x.status = 'kept'),
             'partial_90', count(*) filter (where x.status = 'partial'),
             'broken_90', count(*) filter (where x.status = 'broken'),
             'kept_pct_90', case when count(*) filter (where x.status <> 'pending') > 0
                                 then round(100.0 * count(*) filter (where x.status = 'kept') / count(*) filter (where x.status <> 'pending')) end,
             'on_time_90', count(*) filter (where x.timing in ('early', 'on_date')))
      from public.parent_promises() x
     where x.promised_date > v_today - 90);

  with lp as (
    select distinct on (x.parent_id) x.* from public.parent_promises() x order by x.parent_id, x.made_on desc, x.made_at desc
  )
  select jsonb_build_object(
           'promises_pending', count(*) filter (where lp.status = 'pending'),
           'promised_pending_amount', coalesce(sum(lp.promised_amount) filter (where lp.status = 'pending'), 0),
           'promises_due_week', count(*) filter (where lp.status = 'pending' and lp.promised_date <= v_today + 7)),
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'parent_id', y.parent_id, 'name', p.name, 'phone', p.phone, 'promised_date', y.promised_date,
                   'promised_amount', y.promised_amount, 'deadline', y.deadline, 'paid', y.paid, 'source', y.source,
                   'campaign_name', rc.name, 'student_name', st.full_name
                 ) order by y.promised_date, p.name), '[]'::jsonb)
            from (select * from lp where lp.status = 'pending' order by lp.promised_date limit 30) y
            join public.parents p on p.id = y.parent_id
            left join public.recovery_campaigns rc on rc.id = y.campaign_id
            left join public.students st on st.id = y.student_id),
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'parent_id', y.parent_id, 'name', p.name, 'phone', p.phone, 'promised_date', y.promised_date,
                   'promised_amount', y.promised_amount, 'deadline', y.deadline, 'paid', y.paid, 'status', y.status,
                   'source', y.source, 'campaign_name', rc.name, 'student_name', st.full_name
                 ) order by y.deadline desc, p.name), '[]'::jsonb)
            from (select * from lp where lp.status in ('broken', 'partial') and lp.deadline >= v_today - 30
                   order by lp.deadline desc limit 30) y
            join public.parents p on p.id = y.parent_id
            left join public.recovery_campaigns rc on rc.id = y.campaign_id
            left join public.students st on st.id = y.student_id)
    into v_open, v_upcoming, v_broken
    from lp;

  return jsonb_build_object(
    'today', v_today,
    'grace_days', (select promise_grace_days from public.school_settings where id = 1),
    'kpis', v_kpis || v_open,
    'campaigns', v_campaigns,
    'upcoming_promises', v_upcoming,
    'broken_promises', v_broken
  );
end $$;

-- ---------------------------------------------------------------------------
-- Student side: their family, the latest calls to it and the activities they are part of
-- ---------------------------------------------------------------------------
create function public.student_recovery(p_student uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_st      public.students;
  v_p       public.parents;
  v_sess    uuid := public.running_session();
  v_sib     jsonb;
  v_calls   jsonb;
  v_promise jsonb;
  v_rel     jsonb;
  v_acts    jsonb;
begin
  perform public.assert_staff();
  select * into v_st from public.students where id = p_student;
  if not found then raise exception 'Student not found'; end if;

  if v_st.parent_id is not null then
    select * into v_p from public.parents where id = v_st.parent_id;

    select coalesce(jsonb_agg(jsonb_build_object('student_id', s.id, 'full_name', s.full_name, 'admission_no', s.admission_no,
                                                 'status', s.status, 'class_name', c.name, 'section', e.section)
                              order by c.sort_order nulls last, s.full_name), '[]'::jsonb)
      into v_sib
      from public.students s
      left join public.enrollments e on e.student_id = s.id and e.session_id = v_sess
      left join public.classes c on c.id = e.class_id
     where s.parent_id = v_st.parent_id and s.id <> p_student;

    select coalesce(jsonb_agg(x.j order by x.call_date desc, x.called_at desc), '[]'::jsonb)
      into v_calls
      from (select c.call_date, c.called_at,
                   jsonb_build_object('id', c.id, 'call_date', c.call_date, 'outcome', c.outcome, 'picked_by', c.picked_by,
                                      'response', c.response, 'summary', c.summary, 'promised_date', c.promised_date,
                                      'promised_amount', c.promised_amount, 'campaign_name', rc.name,
                                      'author', coalesce(nullif(pr.full_name, ''), pr.email)) as j
              from public.parent_calls c
              left join public.recovery_campaigns rc on rc.id = c.campaign_id
              left join public.profiles pr on pr.id = c.created_by
             where c.parent_id = v_st.parent_id
             order by c.call_date desc, c.called_at desc
             limit 5) x;

    with pp as (select * from public.parent_promises(v_st.parent_id))
    select (select jsonb_build_object('promised_date', y.promised_date, 'promised_amount', y.promised_amount,
                                      'deadline', y.deadline, 'paid', y.paid, 'status', y.status, 'timing', y.timing,
                                      'source', y.source)
              from pp y order by y.made_on desc, y.made_at desc limit 1),
           jsonb_build_object('made', count(*), 'kept', count(*) filter (where pp.status = 'kept'),
                              'partial', count(*) filter (where pp.status = 'partial'),
                              'broken', count(*) filter (where pp.status = 'broken'),
                              'pending', count(*) filter (where pp.status = 'pending'))
      into v_promise, v_rel
      from pp;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'participant_id', rp.id, 'campaign_id', c.id, 'name', c.name, 'description', c.description, 'status', c.status,
           'start_date', c.start_date, 'end_date', c.end_date, 'response', rp.response, 'note', rp.note,
           'credited', coalesce((select sum(p.amount) from public.recovery_credits rc join public.payments p on p.id = rc.payment_id
                                  where rc.participant_id = rp.id
                                    and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)), 0)
         ) order by (c.status = 'active') desc, c.start_date desc), '[]'::jsonb)
    into v_acts
    from public.recovery_participants rp
    join public.recovery_campaigns c on c.id = rp.campaign_id
   where rp.student_id = p_student;

  return jsonb_build_object(
    'parent', case when v_p.id is null then null else jsonb_build_object(
                'id', v_p.id, 'name', v_p.name, 'phone', v_p.phone, 'alt_phone', v_p.alt_phone, 'relation', v_p.relation,
                'economic_status', v_p.economic_status, 'payment_behaviour', v_p.payment_behaviour, 'attitude', v_p.attitude,
                'best_time_to_call', v_p.best_time_to_call, 'concerns', v_p.concerns, 'priorities', v_p.priorities) end,
    'siblings', coalesce(v_sib, '[]'::jsonb),
    'calls', coalesce(v_calls, '[]'::jsonb),
    'promise', v_promise,
    'reliability', v_rel,
    'activities', v_acts
  );
end $$;

-- =============================================================================
-- Row level security (see the schema migration). Calls, participants' credits and merges are written
-- through the SECURITY DEFINER functions above; profiles, campaigns and responses are plain edits.
-- =============================================================================
alter table public.parents               enable row level security;
alter table public.recovery_campaigns    enable row level security;
alter table public.parent_calls          enable row level security;
alter table public.recovery_participants enable row level security;
alter table public.recovery_credits      enable row level security;

create policy staff_read on public.parents               for select to public using ((select public.is_staff()));
create policy staff_read on public.recovery_campaigns    for select to public using ((select public.is_staff()));
create policy staff_read on public.parent_calls          for select to public using ((select public.is_staff()));
create policy staff_read on public.recovery_participants for select to public using ((select public.is_staff()));
create policy staff_read on public.recovery_credits      for select to public using ((select public.is_staff()));

create policy writer_all on public.parents               for all to public using ((select public.can_write())) with check ((select public.can_write()));
create policy writer_all on public.recovery_campaigns    for all to public using ((select public.can_write())) with check ((select public.can_write()));
create policy writer_all on public.recovery_participants for all to public using ((select public.can_write())) with check ((select public.can_write()));
create policy writer_delete on public.parent_calls       for delete to public using ((select public.can_write()));
create policy writer_delete on public.recovery_credits   for delete to public using ((select public.can_write()));

-- =============================================================================
-- Function privileges: new helpers stay internal (re-run grant_app_access after this migration)
-- =============================================================================
create or replace function public.grant_app_access(p_role name) returns void
language plpgsql set search_path = public as $$
begin
  execute format('grant usage on schema public, extensions to %I', p_role);
  execute format('grant select, insert, update, delete on all tables in schema public to %I', p_role);
  execute format('grant usage, select on all sequences in schema public to %I', p_role);
  execute format('grant execute on all functions in schema public to %I', p_role);

  -- bookkeeping and internal helpers stay with the owner
  if to_regclass('public.schema_migrations') is not null then
    execute format('revoke all on table public.schema_migrations from %I', p_role);
  end if;
  execute format('revoke execute on function public.next_receipt_no(uuid), public.reallocate_student(uuid), '
                 'public.reallocate_all(), public.month_target_charges(date, boolean, boolean), '
                 'public.set_skip_realloc(boolean), public.profiles_keep_one_admin(), '
                 'public.students_link_parent(), public.link_parents_by_phone(), public.running_session(), '
                 'public.family_fee_status(integer, boolean, bigint, bigint, bigint, bigint), '
                 'public.grant_app_access(name) from %I', p_role);
end $$;

revoke execute on all functions in schema public from public;
