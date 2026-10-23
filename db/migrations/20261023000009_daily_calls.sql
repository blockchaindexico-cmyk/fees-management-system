-- =============================================================================
-- Fee recovery, reworked: a daily call list instead of call campaigns, calls about anything (not only fees),
-- receipts counted for the call or the activity that brought them in, and the recovery dashboard.
--
--   * parent_calls.purpose  fees | performance | ptm | query | other. What the family said about fees and the
--                           date they promised to pay by are recorded on fee calls only.
--   * the call list         worked out afresh every day from the rules in school_settings (call_*):
--                           every family owing at least call_min_overdue (overdue, incl. old dues), except
--                             - families who paid in the last call_skip_paid_days days,
--                             - families waiting for a promise (until the promised date + the grace days),
--                             - families called recently: call_gap_days after a call that got through, the
--                               next day after one that did not, or the date they asked to be called on.
--                           A broken promise puts the family back on the list the day after its deadline,
--                           whatever they paid before. Ordered by priority, each with its main reason.
--   * call_assignments      the families each caller takes from the day's list ("my list").
--   * recovery_activities   student activities (formerly recovery_campaigns of kind 'activity').
--   * recovery_credits      a receipt counted for the call or the activity that brought it in (one per receipt).
--
-- Money is bigint paise. All figures come from the functions below.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Call list rules
-- ---------------------------------------------------------------------------
alter table public.school_settings
  add column call_min_overdue    bigint   not null default 50000   check (call_min_overdue > 0),            -- ₹500
  add column call_skip_paid_days smallint not null default 30      check (call_skip_paid_days between 0 and 180),
  add column call_gap_days       smallint not null default 7       check (call_gap_days between 1 and 60),
  add column call_high_due       bigint   not null default 2000000 check (call_high_due > 0),             -- ₹20,000
  add column call_batch          smallint not null default 10      check (call_batch between 1 and 100);    -- "give me N families"

-- ---------------------------------------------------------------------------
-- Call campaigns go: calls keep their history without one
-- ---------------------------------------------------------------------------
drop function public.call_queue(uuid[]);
drop function public.campaign_detail(uuid);
drop function public.recovery_overview();
drop function public.log_parent_call(uuid, text, uuid, date, text, text, text, date, bigint, date);
drop function public.add_activity_participants(uuid, uuid[], uuid, text, boolean);
drop function public.credit_recovery_payment(uuid, uuid);
drop function public.parent_promises(uuid);

alter table public.parent_calls drop column campaign_id;
delete from public.recovery_campaigns where kind = 'calls';

alter table public.parent_calls
  add column purpose text not null default 'fees' check (purpose in ('fees', 'performance', 'ptm', 'query', 'other'));
alter table public.parent_calls
  add constraint parent_calls_fee_details check (purpose = 'fees' or (response is null and promised_date is null));
create index parent_calls_day_idx on public.parent_calls (call_date, created_by);

-- What is left of the campaigns are the student activities
alter table public.recovery_campaigns rename to recovery_activities;
alter table public.recovery_activities
  drop column kind,
  drop column class_ids,
  drop column min_due,
  drop column silent_days,
  drop column high_due,
  drop column include_old_dues,
  drop column include_broken,
  drop column recall_days;
alter trigger recovery_campaigns_touch on public.recovery_activities rename to recovery_activities_touch;
alter table public.recovery_participants rename column campaign_id to activity_id;

-- A receipt is counted for a call or for an activity
alter table public.recovery_credits alter column participant_id drop not null;
alter table public.recovery_credits add column call_id uuid references public.parent_calls (id) on delete cascade;
alter table public.recovery_credits add constraint recovery_credits_one_source check (num_nonnulls(participant_id, call_id) = 1);
create index recovery_credits_call_idx on public.recovery_credits (call_id);

-- The families each caller takes from the day's list
create table public.call_assignments (
  call_date    date not null,
  parent_id    uuid not null references public.parents (id) on delete cascade,
  assigned_to  uuid not null references public.app_users (id) on delete cascade,
  assigned_at  timestamptz not null default now(),
  primary key (call_date, parent_id)
);
create index call_assignments_user_idx on public.call_assignments (call_date, assigned_to);

alter table public.call_assignments enable row level security;
create policy staff_read on public.call_assignments for select to public using ((select public.is_staff()));

-- ---------------------------------------------------------------------------
-- Promises (from fee calls and from student notes) and whether they were kept
-- ---------------------------------------------------------------------------
create function public.parent_promises(p_parent uuid default null)
returns table (
  source          text,     -- 'call' | 'note'
  source_id       uuid,
  parent_id       uuid,
  student_id      uuid,     -- notes: the student the note is on
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
    select 'call'::text as src, c.id as sid, c.parent_id as pid, null::uuid as stid,
           c.created_by as by_id, c.called_at as at_ts, c.call_date as on_day, c.promised_date as pdate, c.promised_amount as pamt
      from public.parent_calls c
     where c.promised_date is not null and (p_parent is null or c.parent_id = p_parent)
    union all
    select 'note', n.id, st.parent_id, n.student_id, n.created_by, n.created_at,
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
  select x.src, x.sid, x.pid, x.stid, x.by_id, x.at_ts, x.on_day, x.pdate, x.pamt, x.dl, x.paid_amt, x.kept_day,
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
-- Log a call (any staff member: principals and office staff call parents too)
-- ---------------------------------------------------------------------------
create function public.log_parent_call(
  p_parent          uuid,
  p_outcome         text,
  p_purpose         text default 'fees',
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
  v_today   date := public.fees_today();
  v_date    date := coalesce(p_call_date, public.fees_today());
  v_purpose text := coalesce(p_purpose, 'fees');
  v_id      uuid;
begin
  perform public.assert_staff();
  if not exists (select 1 from public.parents where id = p_parent) then raise exception 'Parent not found'; end if;
  if v_purpose not in ('fees', 'performance', 'ptm', 'query', 'other') then raise exception 'Choose what the call was about'; end if;
  if v_date > v_today then raise exception 'The call date cannot be in the future'; end if;
  if v_date < v_today - 60 then raise exception 'Calls more than 60 days old cannot be logged'; end if;
  if p_outcome <> 'connected' and (p_picked_by is not null or p_response is not null or p_promised_date is not null) then
    raise exception 'Who picked up, what they said and a promise can only be recorded when the call got through';
  end if;
  if v_purpose <> 'fees' and (p_response is not null or p_promised_date is not null) then
    raise exception 'What they said about fees and a promise to pay are recorded on fee calls';
  end if;
  if p_promised_amount is not null and p_promised_date is null then raise exception 'Enter the date they promised to pay by'; end if;
  if p_promised_date is not null and p_promised_date < v_date then raise exception 'The promised date cannot be before the call'; end if;
  if p_follow_up_on is not null and p_follow_up_on <= v_date then raise exception 'The next call date must be after the call'; end if;

  insert into public.parent_calls (parent_id, purpose, call_date, outcome, picked_by, response, summary,
                                   promised_date, promised_amount, follow_up_on)
  values (p_parent, v_purpose, v_date, p_outcome, p_picked_by, p_response, nullif(trim(p_summary), ''),
          p_promised_date, p_promised_amount, p_follow_up_on)
  returning id into v_id;
  -- a fee call made today puts the family on the caller's list for today (unless someone else took it)
  if v_purpose = 'fees' and v_date = v_today then
    insert into public.call_assignments (call_date, parent_id, assigned_to)
    values (v_today, p_parent, public.current_user_id())
    on conflict (call_date, parent_id) do nothing;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- The day's call list: every family with dues, its state today, priority and reasons
--
--   state     due           : on today's list
--             called        : a fee call was logged today (whatever came of it)
--             promised      : waiting for a promise (until its deadline)
--             paid_recently : paid in the last call_skip_paid_days days
--             waiting       : called recently; back on the list on next_call_on
--             cleared       : owes less than call_min_overdue (only listed when called or taken today)
--   reasons   broken_promise / partial_promise : the promise ran out unpaid and no fee call got through since
--             call_back  : the date they asked to be called on has come
--             high_dues  : owes at least call_high_due
--             never_paid : no payment on record; silent: nothing paid for 60 days or more
--             old_dues   : owes fees of earlier sessions
--             overdue    : none of the above, owes at least call_min_overdue
--             not_reached: the last fee calls did not get through
--   priority  broken promises and call-backs first, then the bigger dues, the longer silence and old dues;
--             families who can pay (economic condition, payment habit) move up, unreachable ones move down
-- ---------------------------------------------------------------------------
create function public.call_list()
returns table (
  parent_id          uuid,
  state              text,
  priority           integer,
  reasons            text[],
  next_call_on       date,
  total_overdue      bigint,
  prev_pending       bigint,
  last_paid_on       date,
  last_paid_amount   bigint,
  days_since_payment integer,
  children           jsonb,
  last_call_on       date,
  last_outcome       text,
  last_response      text,
  last_summary       text,
  last_caller        uuid,
  unanswered         integer,
  follow_up_on       date,
  promise_date       date,
  promise_amount     bigint,
  promise_status     text,
  promise_deadline   date,
  promise_paid       bigint,
  assigned_to        uuid
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_today date := public.fees_today();
  v_sess  uuid := public.running_session();
  v_set   public.school_settings;
begin
  perform public.assert_staff();
  if v_sess is null then return; end if;
  select * into v_set from public.school_settings where id = 1;

  return query
  with sb as materialized (
    select b.student_id, b.full_name, b.class_name, b.class_order, b.section, b.total_overdue, b.prev_pending
      from public.student_balances(v_sess) b
  ),
  fam as (
    select st.parent_id as pid,
           sum(sb.total_overdue)::bigint as tod,
           sum(sb.prev_pending)::bigint as pp,
           jsonb_agg(jsonb_build_object('student_id', sb.student_id, 'full_name', sb.full_name, 'class_name', sb.class_name,
                                        'section', sb.section, 'total_overdue', sb.total_overdue)
                     order by sb.class_order nulls last, sb.full_name) as kids
      from sb
      join public.students st on st.id = sb.student_id
     where st.parent_id is not null
     group by st.parent_id
  ),
  lp as (     -- the family's last payment day and what it paid that day
    select x.pid, x.last_paid, sum(x.amount) filter (where x.paid_on = x.last_paid)::bigint as amt
      from (select st.parent_id as pid, p.paid_on, p.amount, max(p.paid_on) over (partition by st.parent_id) as last_paid
              from public.payments p
              join public.students st on st.id = p.student_id
             where st.parent_id is not null and p.amount > 0
               and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)) x
     group by x.pid, x.last_paid
  ),
  pr as (     -- the latest promise
    select distinct on (x.parent_id) x.parent_id as pid, x.promised_date, x.promised_amount, x.status, x.deadline, x.paid
      from public.parent_promises() x
     order by x.parent_id, x.made_on desc, x.made_at desc
  ),
  conn as (   -- the last fee call that got through
    select distinct on (c.parent_id) c.parent_id as pid, c.call_date, c.called_at
      from public.parent_calls c
     where c.purpose = 'fees' and c.outcome = 'connected'
     order by c.parent_id, c.call_date desc, c.called_at desc
  ),
  lc as (     -- the last fee call, and how many fee calls in a row did not get through
    select y.* from (
      select c.parent_id as pid, c.call_date, c.outcome, c.response, c.summary, c.follow_up_on, c.created_by,
             (count(*) filter (where c.outcome <> 'connected'
                                 and (conn.pid is null or (c.call_date, c.called_at) > (conn.call_date, conn.called_at)))
                over (partition by c.parent_id))::integer as n_missed,
             row_number() over (partition by c.parent_id order by c.call_date desc, c.called_at desc, c.id) as rn
        from public.parent_calls c
        left join conn on conn.pid = c.parent_id
       where c.purpose = 'fees'
    ) y
     where y.rn = 1
  ),
  asg as (
    select a.parent_id as pid, a.assigned_to from public.call_assignments a where a.call_date = v_today
  ),
  b as (
    select pa.id as pid, pa.economic_status, pa.payment_behaviour,
           coalesce(f.tod, 0)::bigint as tod, coalesce(f.pp, 0)::bigint as pp, coalesce(f.kids, '[]'::jsonb) as kids,
           lp.last_paid, lp.amt as last_amt,
           pr.promised_date as p_date, pr.promised_amount as p_amount, pr.status as p_status, pr.deadline as p_deadline,
           pr.paid as p_paid,
           lc.call_date as lc_on, lc.outcome as lc_outcome, lc.response as lc_response, lc.summary as lc_summary,
           lc.follow_up_on as lc_follow, lc.created_by as lc_by, coalesce(lc.n_missed, 0) as n_missed,
           asg.assigned_to as asg_to,
           coalesce(f.tod, 0) >= v_set.call_min_overdue as owes,
           coalesce(pr.status in ('broken', 'partial')
                    and coalesce(conn.call_date, '-infinity'::date) <= pr.deadline
                    and coalesce(lp.last_paid, '-infinity'::date) <= pr.deadline, false) as r_broken,
           coalesce(lc.follow_up_on <= v_today, false) as r_callback
      from public.parents pa
      left join fam f on f.pid = pa.id
      left join lp on lp.pid = pa.id
      left join pr on pr.pid = pa.id
      left join conn on conn.pid = pa.id
      left join lc on lc.pid = pa.id
      left join asg on asg.pid = pa.id
     where coalesce(f.tod, 0) >= v_set.call_min_overdue or lc.call_date = v_today or asg.pid is not null
  ),
  s as (
    select b.*,
           -- the earliest day the last fee call allows the next one
           case when b.lc_on is null then v_today
                when b.r_broken and b.lc_on <= b.p_deadline then v_today
                when b.lc_follow is not null then b.lc_follow
                when b.lc_outcome = 'connected' then b.lc_on + v_set.call_gap_days
                else b.lc_on + 1 end as next_by_call,
           (b.last_paid is not null and b.last_paid > v_today - v_set.call_skip_paid_days) as paid_recently
      from b
  ),
  t as (
    select s.*,
           case
             when s.lc_on = v_today then 'called'
             when not s.owes then 'cleared'
             when s.p_status = 'pending' then 'promised'
             when s.next_by_call > v_today then 'waiting'
             when s.r_broken or s.r_callback then 'due'
             when s.paid_recently then 'paid_recently'
             else 'due'
           end as st,
           (s.tod >= v_set.call_high_due) as r_high,
           (s.last_paid is null) as r_never,
           (s.last_paid is not null and v_today - s.last_paid >= 60) as r_silent,
           (s.pp > 0) as r_old
      from s
  )
  select t.pid, t.st,
         (case when t.r_broken then case when t.p_status = 'partial' then 35 else 40 end
               when t.r_callback then 30 else 0 end
          + least(30, round(30.0 * t.tod / v_set.call_high_due))
          + case when t.last_paid is null then 15 else least(15, (v_today - t.last_paid) / 6) end
          + case when t.r_old then 5 else 0 end
          + case t.economic_status when 'high' then 6 when 'upper_middle' then 5 when 'middle' then 4
                                   when 'lower_middle' then 2 when 'low' then 1 else 3 end
          + case t.payment_behaviour
              when 'capable_not_paying' then 10 when 'irregular' then 8 when 'installment_wise' then 6 when 'regular' then 6
              when 'year_end' then case when extract(month from v_today) in (1, 2, 3) then 8 else 3 end
              when 'carries_forward' then 4 when 'willing_struggling' then 2 when 'non_payer' then 1 else 5 end
          - least(9, 3 * t.n_missed)
         )::integer,
         array_remove(array[
           case when t.r_broken then case when t.p_status = 'partial' then 'partial_promise' else 'broken_promise' end end,
           case when t.r_callback then 'call_back' end,
           case when t.r_high then 'high_dues' end,
           case when t.r_never then 'never_paid' when t.r_silent then 'silent' end,
           case when t.r_old then 'old_dues' end,
           case when t.owes and not (t.r_high or t.r_never or t.r_silent or t.r_old) then 'overdue' end,
           case when t.n_missed > 0 then 'not_reached' end], null),
         case
           when t.st = 'due' then v_today
           when t.st = 'cleared' then null
           when t.p_status = 'pending' then t.p_deadline + 1
           when t.r_broken or t.r_callback then t.next_by_call
           else greatest(t.next_by_call, case when t.paid_recently then t.last_paid + v_set.call_skip_paid_days end)
         end,
         t.tod, t.pp, t.last_paid, t.last_amt, (v_today - t.last_paid)::integer, t.kids,
         t.lc_on, t.lc_outcome, t.lc_response, t.lc_summary, t.lc_by, t.n_missed, t.lc_follow,
         t.p_date, t.p_amount, t.p_status, t.p_deadline, t.p_paid,
         t.asg_to
    from t
   where t.st <> 'cleared' or t.asg_to is not null;
end $$;

-- ---------------------------------------------------------------------------
-- Taking families from the day's list
-- ---------------------------------------------------------------------------

-- The next p_count families (default: call_batch) to call, highest priority first, that nobody has taken yet
create function public.take_calls(p_count integer default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.fees_today();
  v_count integer;
  v_n     integer;
begin
  perform public.assert_staff();
  select coalesce(p_count, s.call_batch) into v_count from public.school_settings s where s.id = 1;
  if v_count < 1 or v_count > 100 then raise exception 'Take between 1 and 100 families at a time'; end if;
  perform pg_advisory_xact_lock(hashtext('fees.call_assignments'));
  insert into public.call_assignments (call_date, parent_id, assigned_to)
  select v_today, q.parent_id, public.current_user_id()
    from public.call_list() q
   where q.state = 'due' and q.assigned_to is null
   order by q.priority desc, q.total_overdue desc, q.parent_id
   limit v_count
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Take one family for today (an admin or accountant may take it over from another caller)
create function public.take_call(p_parent uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.fees_today();
  v_me    uuid := public.current_user_id();
  v_by    uuid;
  v_name  text;
begin
  perform public.assert_staff();
  if not exists (select 1 from public.parents where id = p_parent) then raise exception 'Parent not found'; end if;
  perform pg_advisory_xact_lock(hashtext('fees.call_assignments'));
  select a.assigned_to, coalesce(nullif(p.full_name, ''), p.email)
    into v_by, v_name
    from public.call_assignments a
    left join public.profiles p on p.id = a.assigned_to
   where a.call_date = v_today and a.parent_id = p_parent;
  if v_by = v_me then return; end if;
  if v_by is not null and not public.can_write() then
    raise exception '% is calling this family today', coalesce(v_name, 'Someone else');
  end if;
  insert into public.call_assignments (call_date, parent_id, assigned_to) values (v_today, p_parent, v_me)
  on conflict (call_date, parent_id) do update set assigned_to = excluded.assigned_to, assigned_at = now();
end $$;

-- Give families back to the day's list: one (yours, or anyone's for an admin / accountant), or all of yours
-- that have not been called yet
create function public.release_calls(p_parent uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.fees_today();
  v_n     integer;
begin
  perform public.assert_staff();
  if p_parent is not null then
    delete from public.call_assignments a
     where a.call_date = v_today and a.parent_id = p_parent
       and (a.assigned_to = public.current_user_id() or public.can_write());
  else
    delete from public.call_assignments a
     where a.call_date = v_today and a.assigned_to = public.current_user_id()
       and not exists (select 1 from public.parent_calls c
                        where c.parent_id = a.parent_id and c.call_date = v_today and c.purpose = 'fees');
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;


-- ---------------------------------------------------------------------------
-- The calling page: today's list, who called whom today and my own figures
-- ---------------------------------------------------------------------------
create function public.call_board()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := public.fees_today();
  v_me    uuid := public.current_user_id();
  v_set   public.school_settings;
  v_list  jsonb;
  v_calls jsonb;
  v_mine  jsonb;
begin
  perform public.assert_staff();
  select * into v_set from public.school_settings where id = 1;

  with q as materialized (select * from public.call_list()),
  ranked as (
    select q.*,
           case when q.state = 'due' then row_number() over (partition by q.state = 'due'
                                                              order by q.priority desc, q.total_overdue desc, q.parent_id) end as rank
      from q
  ),
  tc as (     -- the latest fee call of today per family
    select distinct on (c.parent_id) c.parent_id as pid, c.id, c.outcome, c.response, c.promised_date, c.promised_amount,
           c.follow_up_on, c.called_at, c.created_by
      from public.parent_calls c
     where c.call_date = v_today and c.purpose = 'fees'
     order by c.parent_id, c.called_at desc
  ),
  who as (    -- everybody who called or took families today
    select c.created_by as uid from public.parent_calls c where c.call_date = v_today and c.created_by is not null
    union
    select a.assigned_to from public.call_assignments a where a.call_date = v_today
  )
  select jsonb_build_object(
    -- families to call today, called today, or taken by someone today (highest priority first)
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
               'parent_id', r.parent_id, 'name', p.name, 'phone', p.phone, 'alt_phone', p.alt_phone, 'relation', p.relation,
               'best_time_to_call', p.best_time_to_call, 'economic_status', p.economic_status,
               'payment_behaviour', p.payment_behaviour,
               'state', r.state, 'rank', r.rank, 'priority', r.priority, 'reasons', to_jsonb(r.reasons),
               'next_call_on', r.next_call_on,
               'total_overdue', r.total_overdue, 'prev_pending', r.prev_pending, 'last_paid_on', r.last_paid_on,
               'last_paid_amount', r.last_paid_amount, 'days_since_payment', r.days_since_payment, 'children', r.children,
               'last_call_on', r.last_call_on, 'last_outcome', r.last_outcome, 'last_response', r.last_response,
               'last_summary', r.last_summary, 'last_caller_name', coalesce(nullif(lcp.full_name, ''), lcp.email),
               'unanswered', r.unanswered,
               'promise_date', r.promise_date, 'promise_amount', r.promise_amount, 'promise_status', r.promise_status,
               'promise_deadline', r.promise_deadline, 'promise_paid', r.promise_paid,
               'assigned_to', r.assigned_to, 'assigned_name', coalesce(nullif(ap.full_name, ''), ap.email),
               'today_call', case when tc.id is null then null else jsonb_build_object(
                                'id', tc.id, 'outcome', tc.outcome, 'response', tc.response, 'promised_date', tc.promised_date,
                                'promised_amount', tc.promised_amount, 'follow_up_on', tc.follow_up_on, 'called_at', tc.called_at,
                                'caller_id', tc.created_by, 'caller_name', coalesce(nullif(tp.full_name, ''), tp.email)) end
             ) order by (r.state = 'due') desc, r.rank, tc.called_at desc nulls last, r.total_overdue desc, p.name), '[]'::jsonb)
               from ranked r
               join public.parents p on p.id = r.parent_id
               left join public.profiles lcp on lcp.id = r.last_caller
               left join public.profiles ap on ap.id = r.assigned_to
               left join tc on tc.pid = r.parent_id
               left join public.profiles tp on tp.id = tc.created_by
              where r.state in ('due', 'called') or r.assigned_to is not null),
    'counts', (select jsonb_build_object(
                 'due', count(*) filter (where q.state = 'due'),
                 'due_open', count(*) filter (where q.state = 'due' and q.assigned_to is null),
                 'due_overdue', coalesce(sum(q.total_overdue) filter (where q.state = 'due'), 0),
                 'called', count(*) filter (where q.state = 'called'),
                 'promised', count(*) filter (where q.state = 'promised'),
                 'promised_amount', coalesce(sum(q.promise_amount) filter (where q.state = 'promised'), 0),
                 'paid_recently', count(*) filter (where q.state = 'paid_recently'),
                 'waiting', count(*) filter (where q.state = 'waiting'),
                 'broken', count(*) filter (where q.state = 'due' and q.reasons && array['broken_promise', 'partial_promise']),
                 'call_back', count(*) filter (where q.state = 'due' and 'call_back' = any (q.reasons)))
                 from q),
    -- promises falling due in the next three days (unpaid, the family comes back on the list)
    'promises_due', (select coalesce(jsonb_agg(jsonb_build_object(
                       'parent_id', q.parent_id, 'name', p.name, 'phone', p.phone, 'promise_date', q.promise_date,
                       'promise_amount', q.promise_amount, 'promise_deadline', q.promise_deadline, 'promise_paid', q.promise_paid,
                       'total_overdue', q.total_overdue
                     ) order by q.promise_date, p.name), '[]'::jsonb)
                       from q join public.parents p on p.id = q.parent_id
                      where q.state = 'promised' and q.promise_date <= v_today + 3),
    -- callers today: calls made, families taken and how many of those are still to call
    'team', (select coalesce(jsonb_agg(jsonb_build_object(
               'user_id', w.uid, 'name', coalesce(nullif(pf.full_name, ''), pf.email, 'Unknown'), 'is_me', w.uid = v_me,
               'calls', (select count(*) from public.parent_calls c where c.call_date = v_today and c.created_by = w.uid),
               'connected', (select count(*) from public.parent_calls c
                              where c.call_date = v_today and c.created_by = w.uid and c.outcome = 'connected'),
               'promises', (select count(*) from public.parent_calls c
                             where c.call_date = v_today and c.created_by = w.uid and c.promised_date is not null),
               'taken', (select count(*) from public.call_assignments a where a.call_date = v_today and a.assigned_to = w.uid),
               'left', (select count(*) from q where q.assigned_to = w.uid and q.state = 'due')
             ) order by w.uid = v_me desc, coalesce(nullif(pf.full_name, ''), pf.email)), '[]'::jsonb)
               from who w left join public.profiles pf on pf.id = w.uid),
    'my_taken', (select count(*) from public.call_assignments a where a.call_date = v_today and a.assigned_to = v_me),
    'my_left', (select count(*) from q where q.assigned_to = v_me and q.state = 'due')
  )
    into v_list;

  -- every call made today, about anything
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'parent_id', c.parent_id, 'parent_name', p.name, 'phone', p.phone, 'purpose', c.purpose,
           'outcome', c.outcome, 'picked_by', c.picked_by, 'response', c.response, 'summary', c.summary,
           'promised_date', c.promised_date, 'promised_amount', c.promised_amount, 'follow_up_on', c.follow_up_on,
           'called_at', c.called_at, 'caller_id', c.created_by, 'caller_name', coalesce(nullif(pf.full_name, ''), pf.email)
         ) order by c.called_at desc), '[]'::jsonb)
    into v_calls
    from public.parent_calls c
    join public.parents p on p.id = c.parent_id
    left join public.profiles pf on pf.id = c.created_by
   where c.call_date = v_today;

  -- my calls today, yesterday, in the last 7 and 30 days, and what came in because of them
  with pp as (select x.source_id, x.status from public.parent_promises() x where x.source = 'call'),
  mine as (
    select c.call_date, c.parent_id, c.purpose, c.outcome, c.promised_date, c.promised_amount, pp.status as p_status
      from public.parent_calls c
      left join pp on pp.source_id = c.id
     where c.created_by = v_me and c.call_date > v_today - 30
  ),
  cred as (
    select p.paid_on, p.amount
      from public.recovery_credits rc
      join public.parent_calls c on c.id = rc.call_id and c.created_by = v_me
      join public.payments p on p.id = rc.payment_id
     where p.paid_on > v_today - 30
       and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
  ),
  w(key, d_from, d_to) as (
    values ('today', v_today, v_today), ('yesterday', v_today - 1, v_today - 1), ('week', v_today - 6, v_today),
           ('month', v_today - 29, v_today)
  )
  select jsonb_object_agg(w.key, jsonb_build_object(
           'calls', (select count(*) from mine m where m.call_date between w.d_from and w.d_to),
           'families', (select count(distinct m.parent_id) from mine m where m.call_date between w.d_from and w.d_to),
           'fee_calls', (select count(*) from mine m where m.call_date between w.d_from and w.d_to and m.purpose = 'fees'),
           'connected', (select count(*) from mine m where m.call_date between w.d_from and w.d_to and m.outcome = 'connected'),
           'not_reached', (select count(*) from mine m where m.call_date between w.d_from and w.d_to and m.outcome <> 'connected'),
           'promises', (select count(*) from mine m where m.call_date between w.d_from and w.d_to and m.promised_date is not null),
           'promised_amount', (select coalesce(sum(m.promised_amount), 0) from mine m where m.call_date between w.d_from and w.d_to),
           'kept', (select count(*) from mine m where m.call_date between w.d_from and w.d_to and m.p_status = 'kept'),
           'broken', (select count(*) from mine m where m.call_date between w.d_from and w.d_to and m.p_status in ('broken', 'partial')),
           'by_purpose', (select coalesce(jsonb_object_agg(x.purpose, x.n), '{}'::jsonb)
                            from (select m.purpose, count(*) as n from mine m where m.call_date between w.d_from and w.d_to
                                   group by m.purpose) x),
           'recovered', (select coalesce(sum(cr.amount), 0) from cred cr where cr.paid_on between w.d_from and w.d_to)
         ))
    into v_mine
    from w;

  return jsonb_build_object(
    'today', v_today,
    'me', jsonb_build_object(
      'id', v_me,
      'name', (select coalesce(nullif(pf.full_name, ''), pf.email) from public.profiles pf where pf.id = v_me),
      'taken', v_list -> 'my_taken',
      'left', v_list -> 'my_left',
      'stats', v_mine),
    'rules', jsonb_build_object('min_overdue', v_set.call_min_overdue, 'skip_paid_days', v_set.call_skip_paid_days,
                                'gap_days', v_set.call_gap_days, 'high_due', v_set.call_high_due, 'batch', v_set.call_batch,
                                'grace_days', v_set.promise_grace_days),
    'counts', v_list -> 'counts',
    'rows', v_list -> 'rows',
    'promises_due', v_list -> 'promises_due',
    'calls_today', v_calls,
    'team', v_list -> 'team'
  );
end $$;

-- ---------------------------------------------------------------------------
-- What brought a receipt in: a call to the family or an activity of the student (or nothing: both null)
-- ---------------------------------------------------------------------------
create function public.set_payment_source(p_payment uuid, p_call uuid default null, p_participant uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_p      public.payments;
  v_parent uuid;
  v_c      public.parent_calls;
  v_pa     public.recovery_participants;
  v_a      public.recovery_activities;
begin
  perform public.assert_writer();
  if p_call is not null and p_participant is not null then raise exception 'Choose a call or an activity, not both'; end if;
  select * into v_p from public.payments where id = p_payment;
  if not found then raise exception 'Payment not found'; end if;
  if v_p.amount <= 0 or exists (select 1 from public.payments r where r.reverses_payment_id = v_p.id) then
    raise exception 'Receipt % is cancelled', v_p.receipt_no;
  end if;

  if p_call is null and p_participant is null then
    delete from public.recovery_credits where payment_id = p_payment;
    if found then
      perform public.audit('clear_payment_source', 'recovery_credits', p_payment::text, jsonb_build_object('receipt_no', v_p.receipt_no));
    end if;
    return;
  end if;

  if p_call is not null then
    select * into v_c from public.parent_calls where id = p_call;
    if not found then raise exception 'Call not found'; end if;
    select st.parent_id into v_parent from public.students st where st.id = v_p.student_id;
    if v_parent is distinct from v_c.parent_id then raise exception 'That call was made to another family'; end if;
    if v_c.call_date > v_p.paid_on then raise exception 'That call was made after receipt % was paid', v_p.receipt_no; end if;
  else
    select * into v_pa from public.recovery_participants where id = p_participant;
    if not found then raise exception 'Participant not found'; end if;
    select * into v_a from public.recovery_activities where id = v_pa.activity_id;
    if v_p.student_id <> v_pa.student_id then raise exception 'Receipt % belongs to another student', v_p.receipt_no; end if;
    if v_p.paid_on < v_a.start_date then raise exception 'Receipt % was paid before the activity started', v_p.receipt_no; end if;
  end if;

  insert into public.recovery_credits (payment_id, call_id, participant_id)
  values (p_payment, p_call, p_participant)
  on conflict (payment_id) do update
    set call_id = excluded.call_id, participant_id = excluded.participant_id,
        created_by = public.current_user_id(), created_at = now();

  if p_participant is not null then
    update public.recovery_participants
       set response = 'positive', updated_by = public.current_user_id(), updated_at = now()
     where id = p_participant and response = 'pending';
  end if;
  perform public.audit('set_payment_source', 'recovery_credits', p_payment::text,
    jsonb_build_object('receipt_no', v_p.receipt_no, 'amount', v_p.amount, 'call', p_call, 'activity', v_a.id,
                       'participant', p_participant));
end $$;

-- ---------------------------------------------------------------------------
-- Student activities
-- ---------------------------------------------------------------------------

-- Add students to an activity: chosen students and / or every active student of a class (section) in the
-- running session; p_only_dues keeps only those who owe overdue fees
create function public.add_activity_participants(
  p_activity  uuid,
  p_students  uuid[] default null,
  p_class     uuid default null,
  p_section   text default null,
  p_only_dues boolean default false
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_sess  uuid := public.running_session();
  v_today date := public.fees_today();
  v_n     integer;
begin
  perform public.assert_writer();
  if not exists (select 1 from public.recovery_activities where id = p_activity) then raise exception 'Activity not found'; end if;
  if p_class is null and coalesce(cardinality(p_students), 0) = 0 then raise exception 'Choose a class or at least one student'; end if;

  with cand as (
    select st.id from public.students st where st.id = any (coalesce(p_students, '{}'))
    union
    select e.student_id from public.enrollments e
      join public.students st on st.id = e.student_id and st.status = 'active'
     where p_class is not null and e.session_id = v_sess and e.class_id = p_class
       and (nullif(trim(p_section), '') is null or e.section = trim(p_section))
  )
  insert into public.recovery_participants (activity_id, student_id, added_on)
  select p_activity, cand.id, v_today
    from cand
   where not p_only_dues
      or (v_sess is not null and exists (select 1 from public.student_balances(v_sess) b
                                          where b.student_id = cand.id and b.total_overdue > 0))
  on conflict (activity_id, student_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Figures of activity participants (of one activity or student, or all): what each paid since the activity started (to its
-- end or today), what was counted for the activity and what they owe now
create function public.activity_participant_figures(p_activity uuid default null, p_student uuid default null)
returns table (
  participant_id uuid,
  activity_id    uuid,
  student_id     uuid,
  full_name      text,
  admission_no   text,
  student_status text,
  class_id       uuid,
  class_name     text,
  class_order    integer,
  section        text,
  parent_id      uuid,
  response       text,
  note           text,
  added_on       date,
  updated_at     timestamptz,
  updated_by     uuid,
  paid_since     bigint,   -- receipts since the activity started, up to its end or today
  credited       bigint,   -- receipts counted for this activity
  credited_n     integer,
  total_overdue  bigint,
  total_pending  bigint,
  fee_status     text
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_today date := public.fees_today();
  v_sess  uuid := public.running_session();
begin
  perform public.assert_staff();
  return query
  with pa as (
    select rp.*, a.start_date, least(coalesce(a.end_date, v_today), v_today) as last_day
      from public.recovery_participants rp
      join public.recovery_activities a on a.id = rp.activity_id
     where (p_activity is null or rp.activity_id = p_activity) and (p_student is null or rp.student_id = p_student)
  ),
  sb as materialized (   -- (no session yet: no balances)
    select b.* from public.academic_sessions s
     cross join lateral public.student_balances(s.id) b
     where s.id = v_sess and b.student_id in (select pa.student_id from pa)
  ),
  pay as (
    select p.id, p.student_id, p.paid_on, p.amount
      from public.payments p
     where p.student_id in (select pa.student_id from pa) and p.amount > 0
       and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
  )
  select pa.id, pa.activity_id, st.id, st.full_name, st.admission_no, st.status::text,
         sb.class_id, sb.class_name, sb.class_order, sb.section, st.parent_id,
         pa.response, pa.note, pa.added_on, pa.updated_at, pa.updated_by,
         coalesce((select sum(y.amount) from pay y
                    where y.student_id = pa.student_id and y.paid_on between pa.start_date and pa.last_day), 0)::bigint,
         coalesce((select sum(y.amount) from pay y join public.recovery_credits rc on rc.payment_id = y.id
                    where rc.participant_id = pa.id), 0)::bigint,
         (select count(*) from pay y join public.recovery_credits rc on rc.payment_id = y.id where rc.participant_id = pa.id)::integer,
         coalesce(sb.total_overdue, 0)::bigint, coalesce(sb.total_pending, 0)::bigint, sb.fee_status
    from pa
    join public.students st on st.id = pa.student_id
    left join sb on sb.student_id = pa.student_id;
end $$;

-- How an activity is doing (internal)
--   won      students who owed (paid since the start, or owe now) with a receipt counted for the activity
--   verdict  too_early : less than a week old and nothing counted yet
--            good      : half or more of them were won, or the target is reached
--            fair      : a quarter or more
--            poor      : fewer
create function public.activity_verdict(p_students bigint, p_days integer, p_credited bigint, p_target bigint, p_won bigint, p_owed bigint)
returns text language sql immutable as $$
  select case
           when p_students = 0 then 'no_students'
           when p_days < 7 and p_credited = 0 then 'too_early'
           when (p_target is not null and p_credited >= p_target) or p_owed = 0 or 100.0 * p_won / p_owed >= 50 then 'good'
           when 100.0 * p_won / p_owed >= 25 then 'fair'
           else 'poor'
         end
$$;

-- Every activity with how it is doing, the same by class, and every student taking part
create function public.activities_overview()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := public.fees_today();
  v_out   jsonb;
begin
  perform public.assert_staff();

  with f as materialized (select * from public.activity_participant_figures()),
  a as (
    select ac.*,
           (least(coalesce(ac.end_date, v_today), v_today) - ac.start_date + 1) as days_running,
           count(f.participant_id) as n,
           count(f.participant_id) filter (where f.response = 'positive') as positive,
           count(f.participant_id) filter (where f.response = 'partial') as partial,
           count(f.participant_id) filter (where f.response = 'negative') as negative,
           count(f.participant_id) filter (where f.response = 'pending') as pending,
           count(f.participant_id) filter (where f.paid_since > 0) as payers,
           count(f.participant_id) filter (where f.credited_n > 0) as won,
           count(f.participant_id) filter (where f.paid_since > 0 or f.total_overdue > 0) as owed,
           count(f.participant_id) filter (where f.total_overdue > 0) as owing_now,
           coalesce(sum(f.paid_since), 0) as paid_since,
           coalesce(sum(f.credited), 0) as credited,
           coalesce(sum(f.credited_n), 0) as credited_n,
           coalesce(sum(f.total_overdue), 0) as overdue_now,
           coalesce(jsonb_agg(distinct f.class_name) filter (where f.class_name is not null), '[]'::jsonb) as classes
      from public.recovery_activities ac
      left join f on f.activity_id = ac.id
     group by ac.id
  ),
  v as (
    select a.*,
           case when a.owed > 0 then round(100.0 * a.won / a.owed) end as won_pct,
           public.activity_verdict(a.n, a.days_running, a.credited::bigint, a.target_amount, a.won, a.owed) as verdict
      from a
  )
  select jsonb_build_object(
    'today', v_today,
    'activities', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', v.id, 'name', v.name, 'description', v.description, 'status', v.status,
                     'start_date', v.start_date, 'end_date', v.end_date, 'target_amount', v.target_amount,
                     'created_at', v.created_at,
                     'created_by_name', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = v.created_by),
                     'days_running', v.days_running, 'participants', v.n, 'classes', v.classes,
                     'positive', v.positive, 'partial', v.partial, 'negative', v.negative, 'pending', v.pending,
                     'payers', v.payers, 'won', v.won, 'owed', v.owed, 'owing_now', v.owing_now, 'won_pct', v.won_pct,
                     'paid_since', v.paid_since, 'credited', v.credited, 'credited_receipts', v.credited_n,
                     'overdue_now', v.overdue_now, 'verdict', v.verdict
                   ) order by (v.status = 'active') desc, v.credited desc, v.start_date desc, v.name), '[]'::jsonb) from v),
    'by_class', (select coalesce(jsonb_agg(jsonb_build_object(
                   'class_id', x.class_id, 'class_name', x.class_name, 'activities', x.activities, 'students', x.students,
                   'positive', x.positive, 'negative', x.negative, 'payers', x.payers, 'paid_since', x.paid_since,
                   'credited', x.credited, 'overdue_now', x.overdue_now
                 ) order by x.class_order nulls last, x.class_name), '[]'::jsonb)
                   from (select f.class_id, coalesce(f.class_name, 'Not enrolled') as class_name, min(f.class_order) as class_order,
                                count(distinct f.activity_id) as activities, count(distinct f.student_id) as students,
                                count(*) filter (where f.response = 'positive') as positive,
                                count(*) filter (where f.response = 'negative') as negative,
                                count(distinct f.student_id) filter (where f.paid_since > 0) as payers,
                                sum(f.paid_since) as paid_since, sum(f.credited) as credited,
                                sum(f.total_overdue) as overdue_now
                           from f
                           join public.recovery_activities ac on ac.id = f.activity_id and ac.status = 'active'
                          group by f.class_id, f.class_name) x),
    'students', (select coalesce(jsonb_agg(jsonb_build_object(
                   'participant_id', f.participant_id, 'activity_id', f.activity_id, 'activity_name', ac.name,
                   'activity_status', ac.status, 'student_id', f.student_id, 'full_name', f.full_name,
                   'admission_no', f.admission_no, 'class_id', f.class_id, 'class_name', f.class_name, 'section', f.section,
                   'response', f.response, 'note', f.note, 'added_on', f.added_on, 'paid_since', f.paid_since,
                   'credited', f.credited, 'total_overdue', f.total_overdue, 'fee_status', f.fee_status
                 ) order by f.class_order nulls last, f.section, f.full_name, ac.start_date desc), '[]'::jsonb)
                   from f join public.recovery_activities ac on ac.id = f.activity_id),
    'totals', (select jsonb_build_object(
                 'running', count(*) filter (where v.status = 'active'),
                 'closed', count(*) filter (where v.status = 'closed'),
                 'credited', coalesce(sum(v.credited), 0),
                 'credited_running', coalesce(sum(v.credited) filter (where v.status = 'active'), 0),
                 'paid_since', coalesce(sum(v.paid_since), 0),
                 'good', count(*) filter (where v.status = 'active' and v.verdict = 'good'),
                 'poor', count(*) filter (where v.status = 'active' and v.verdict = 'poor'))
                 from v)
      || (select jsonb_build_object('students', count(distinct f.student_id),
                                    'students_running', count(distinct f.student_id) filter (where ac.status = 'active'),
                                    'positive', count(*) filter (where f.response = 'positive'),
                                    'negative', count(*) filter (where f.response = 'negative'))
            from f join public.recovery_activities ac on ac.id = f.activity_id)
  )
    into v_out;
  return v_out;
end $$;

-- One activity: its participants with their response, what they paid since it started and the receipts counted
create function public.activity_detail(p_activity uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_a     public.recovery_activities;
  v_today date := public.fees_today();
  v_sess  uuid := public.running_session();
  v_rows  jsonb;
  v_stats jsonb;
begin
  perform public.assert_staff();
  select * into v_a from public.recovery_activities where id = p_activity;
  if not found then raise exception 'Activity not found'; end if;

  with f as materialized (select * from public.activity_participant_figures(p_activity)),
  pay as (   -- receipts of the participants since the activity started (not cancelled), with what they are counted for
    select p.student_id, p.id, p.receipt_no, p.paid_on, p.amount, rc.participant_id, rc.call_id,
           ca.name as credited_activity, cc.call_date as credited_call_on
      from public.payments p
      left join public.recovery_credits rc on rc.payment_id = p.id
      left join public.recovery_participants cp on cp.id = rc.participant_id
      left join public.recovery_activities ca on ca.id = cp.activity_id
      left join public.parent_calls cc on cc.id = rc.call_id
     where p.student_id in (select f.student_id from f)
       and p.amount > 0 and p.paid_on >= v_a.start_date
       and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'participant_id', f.participant_id, 'student_id', f.student_id, 'full_name', f.full_name,
           'admission_no', f.admission_no, 'student_status', f.student_status, 'class_name', f.class_name, 'section', f.section,
           'parent_id', f.parent_id, 'parent_name', par.name, 'phone', coalesce(par.phone, st.phone), 'concerns', par.concerns,
           'total_overdue', f.total_overdue, 'total_pending', f.total_pending, 'fee_status', f.fee_status,
           'response', f.response, 'note', f.note, 'added_on', f.added_on, 'updated_at', f.updated_at,
           'paid_since', f.paid_since, 'credited', f.credited,
           'receipts', (select coalesce(jsonb_agg(jsonb_build_object(
                          'payment_id', y.id, 'receipt_no', y.receipt_no, 'paid_on', y.paid_on, 'amount', y.amount,
                          'credited_here', y.participant_id is not distinct from f.participant_id,
                          'credited_elsewhere', case when y.participant_id is distinct from f.participant_id
                                                     then coalesce(y.credited_activity,
                                                                   case when y.call_id is not null then 'Call of ' || to_char(y.credited_call_on, 'DD Mon') end)
                                                end
                        ) order by y.paid_on desc), '[]'::jsonb)
                          from pay y where y.student_id = f.student_id)
         ) order by f.class_order nulls last, f.section, f.full_name), '[]'::jsonb),
         jsonb_build_object(
           'participants', count(*),
           'positive', count(*) filter (where f.response = 'positive'),
           'partial', count(*) filter (where f.response = 'partial'),
           'negative', count(*) filter (where f.response = 'negative'),
           'pending', count(*) filter (where f.response = 'pending'),
           'credited', coalesce(sum(f.credited), 0),
           'credited_receipts', coalesce(sum(f.credited_n), 0),
           'paid_since', coalesce(sum(f.paid_since), 0),
           'payers', count(*) filter (where f.paid_since > 0),
           'won', count(*) filter (where f.credited_n > 0),
           'owed', count(*) filter (where f.paid_since > 0 or f.total_overdue > 0),
           'overdue_now', coalesce(sum(f.total_overdue), 0),
           'owing_now', count(*) filter (where f.total_overdue > 0),
           'days_running', least(coalesce(v_a.end_date, v_today), v_today) - v_a.start_date + 1,
           'verdict', public.activity_verdict(count(*), least(coalesce(v_a.end_date, v_today), v_today) - v_a.start_date + 1,
                                              coalesce(sum(f.credited), 0)::bigint, v_a.target_amount,
                                              count(*) filter (where f.credited_n > 0),
                                              count(*) filter (where f.paid_since > 0 or f.total_overdue > 0)))
    into v_rows, v_stats
    from f
    join public.students st on st.id = f.student_id
    left join public.parents par on par.id = f.parent_id;

  return jsonb_build_object(
    'activity', to_jsonb(v_a) || jsonb_build_object(
      'created_by_name', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = v_a.created_by)),
    'today', v_today,
    'session', (select jsonb_build_object('id', s.id, 'name', s.name) from public.academic_sessions s where s.id = v_sess),
    'stats', v_stats,
    'rows', v_rows
  );
end $$;

-- ---------------------------------------------------------------------------
-- Recovery dashboard for a period: money received and what brought it in, calls and their results, whether
-- talking to families makes a difference, and the activities that brought the most
--
--   money     receipts paid in the period that were not cancelled, split by what they were counted for
--             (a call, an activity, or nothing: the family paid on its own), compared with the period before
--   impact    families we spoke to about fees in the period: share that paid on or after the first such call;
--             other families with dues (owing call_min_overdue now, or who paid fees that had fallen due in
--             the period): share that paid fees that had fallen due
-- ---------------------------------------------------------------------------
create function public.recovery_dashboard(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today   date := public.fees_today();
  v_sess    uuid := public.running_session();
  v_days    integer;
  v_elapsed integer;
  v_pfrom   date;
  v_pto     date;
  v_bucket  text;
  v_min     bigint;
  v_money   jsonb;
  v_calls   jsonb;
  v_impact  jsonb;
  v_acts    jsonb;
begin
  perform public.assert_staff();
  if p_from is null or p_to is null or p_from > p_to then raise exception 'Choose a valid period'; end if;
  if p_to - p_from > 731 then raise exception 'Choose a period of two years or less'; end if;
  v_days := p_to - p_from + 1;
  v_elapsed := greatest(1, least(p_to, v_today) - p_from + 1);
  v_pto := p_from - 1;
  v_pfrom := p_from - v_days;
  v_bucket := case when v_days <= 62 then 'day' when v_days <= 400 then 'week' else 'month' end;
  select s.call_min_overdue into v_min from public.school_settings s where s.id = 1;

  -- money received and what brought it in
  with rc as (
    select p.id, p.student_id, st.parent_id, p.paid_on, p.amount,
           case when cr.call_id is not null then 'calls' when cr.participant_id is not null then 'activities' else 'direct' end as src
      from public.payments p
      join public.students st on st.id = p.student_id
      left join public.recovery_credits cr on cr.payment_id = p.id
     where p.amount > 0 and p.paid_on between v_pfrom and p_to
       and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
  ),
  cur as (select * from rc where rc.paid_on >= p_from),
  buckets as (
    select g::date as d
      from generate_series(date_trunc(v_bucket, p_from::timestamp), p_to::timestamp, ('1 ' || v_bucket)::interval) g
  ),
  src as (
    select s.key, coalesce(sum(cur.amount), 0) as amt, count(cur.id) as n,
           count(distinct coalesce(cur.parent_id, cur.student_id)) as fams
      from (values ('calls'), ('activities'), ('direct')) s(key)
      left join cur on cur.src = s.key
     group by s.key
  )
  select jsonb_build_object(
    'received', (select coalesce(sum(cur.amount), 0) from cur),
    'receipts', (select count(*) from cur),
    'families', (select count(distinct coalesce(cur.parent_id, cur.student_id)) from cur),
    'students', (select count(distinct cur.student_id) from cur),
    'prev_received', (select coalesce(sum(rc.amount), 0) from rc where rc.paid_on <= v_pto),
    'by_source', (select jsonb_object_agg(src.key, jsonb_build_object('amount', src.amt, 'receipts', src.n, 'families', src.fams)) from src),
    'by_kind', (select coalesce(jsonb_object_agg(x.kind, x.amt), '{}'::jsonb)
                  from (select a.kind::text as kind, sum(a.amount) as amt from public.allocations a
                         where a.payment_id in (select cur.id from cur) group by a.kind) x),
    'trend', (select coalesce(jsonb_agg(jsonb_build_object(
                'start', b.d, 'calls', coalesce(x.calls, 0), 'activities', coalesce(x.acts, 0), 'direct', coalesce(x.direct, 0),
                'receipts', coalesce(x.n, 0)) order by b.d), '[]'::jsonb)
                from buckets b
                left join (select date_trunc(v_bucket, c2.paid_on::timestamp)::date as d,
                                  sum(c2.amount) filter (where c2.src = 'calls') as calls,
                                  sum(c2.amount) filter (where c2.src = 'activities') as acts,
                                  sum(c2.amount) filter (where c2.src = 'direct') as direct,
                                  count(*) as n
                             from cur c2 group by 1) x on x.d = b.d),
    'by_behaviour', (select coalesce(jsonb_agg(jsonb_build_object('behaviour', x.b, 'amount', x.amt, 'families', x.n)
                                               order by x.amt desc), '[]'::jsonb)
                       from (select pa.payment_behaviour as b, sum(c3.amount) as amt,
                                    count(distinct coalesce(c3.parent_id, c3.student_id)) as n
                               from cur c3 left join public.parents pa on pa.id = c3.parent_id
                              group by pa.payment_behaviour) x)
  )
    into v_money;

  -- calls made in the period and what came of them
  with c as (select * from public.parent_calls c where c.call_date between p_from and p_to),
  pp as (select x.* from public.parent_promises() x where x.source = 'call' and x.made_on between p_from and p_to),
  cred as (   -- receipts of the period counted for a call (made in the period or before)
    select rc.call_id, k.created_by, p.amount
      from public.recovery_credits rc
      join public.parent_calls k on k.id = rc.call_id
      join public.payments p on p.id = rc.payment_id
     where p.paid_on between p_from and p_to
       and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
  ),
  buckets as (
    select g::date as d
      from generate_series(date_trunc(v_bucket, p_from::timestamp), p_to::timestamp, ('1 ' || v_bucket)::interval) g
  ),
  who as (select c.created_by as uid from c union select cred.created_by from cred)
  select jsonb_build_object(
    'calls', (select count(*) from c),
    'families', (select count(distinct c.parent_id) from c),
    'fee_calls', (select count(*) from c where c.purpose = 'fees'),
    'connected', (select count(*) from c where c.outcome = 'connected'),
    'not_reached', (select count(*) from c where c.outcome <> 'connected'),
    'callers', (select count(distinct c.created_by) from c),
    'per_day', (select round(count(*)::numeric / v_elapsed, 1) from c),
    'by_purpose', (select coalesce(jsonb_object_agg(x.purpose, x.n), '{}'::jsonb)
                     from (select c.purpose, count(*) as n from c group by c.purpose) x),
    'by_outcome', (select coalesce(jsonb_object_agg(x.outcome, x.n), '{}'::jsonb)
                     from (select c.outcome, count(*) as n from c group by c.outcome) x),
    'by_response', (select coalesce(jsonb_object_agg(x.response, x.n), '{}'::jsonb)
                      from (select c.response, count(*) as n from c where c.response is not null group by c.response) x),
    'promises', (select count(*) from pp),
    'promised_amount', (select coalesce(sum(pp.promised_amount), 0) from pp),
    'kept', (select count(*) from pp where pp.status = 'kept'),
    'kept_on_time', (select count(*) from pp where pp.timing in ('early', 'on_date')),
    'partial', (select count(*) from pp where pp.status = 'partial'),
    'broken', (select count(*) from pp where pp.status = 'broken'),
    'pending', (select count(*) from pp where pp.status = 'pending'),
    'promise_paid', (select coalesce(sum(pp.paid), 0) from pp),
    'recovered', (select coalesce(sum(cred.amount), 0) from cred),
    'trend', (select coalesce(jsonb_agg(jsonb_build_object('start', b.d, 'calls', coalesce(x.n, 0),
                                                           'connected', coalesce(x.conn, 0)) order by b.d), '[]'::jsonb)
                from buckets b
                left join (select date_trunc(v_bucket, c.call_date::timestamp)::date as d, count(*) as n,
                                  count(*) filter (where c.outcome = 'connected') as conn
                             from c group by 1) x on x.d = b.d),
    'by_caller', (select coalesce(jsonb_agg(jsonb_build_object(
                    'user_id', w.uid, 'name', coalesce(nullif(pf.full_name, ''), pf.email, 'Unknown'),
                    'calls', (select count(*) from c where c.created_by = w.uid),
                    'families', (select count(distinct c.parent_id) from c where c.created_by = w.uid),
                    'connected', (select count(*) from c where c.created_by = w.uid and c.outcome = 'connected'),
                    'promises', (select count(*) from pp where pp.made_by = w.uid),
                    'kept', (select count(*) from pp where pp.made_by = w.uid and pp.status = 'kept'),
                    'broken', (select count(*) from pp where pp.made_by = w.uid and pp.status in ('broken', 'partial')),
                    'recovered', (select coalesce(sum(cred.amount), 0) from cred where cred.created_by = w.uid)
                  ) order by (select count(*) from c where c.created_by = w.uid) desc,
                             coalesce(nullif(pf.full_name, ''), pf.email)), '[]'::jsonb)
                    from who w left join public.profiles pf on pf.id = w.uid
                   where w.uid is not null)
  )
    into v_calls;

  -- does talking to families make a difference?
  with fam as materialized (   -- what each family owes now
    select st.parent_id as pid, sum(b.total_overdue) as tod
      from public.academic_sessions s
     cross join lateral public.student_balances(s.id) b
      join public.students st on st.id = b.student_id
     where s.id = v_sess and st.parent_id is not null
     group by st.parent_id
  ),
  spoke as (
    select c.parent_id as pid, min(c.call_date) as first_on
      from public.parent_calls c
     where c.call_date between p_from and p_to and c.purpose = 'fees' and c.outcome = 'connected'
     group by c.parent_id
  ),
  pay as (
    select st.parent_id as pid, p.id, p.paid_on, p.amount
      from public.payments p
      join public.students st on st.id = p.student_id
     where st.parent_id is not null and p.amount > 0 and p.paid_on between p_from and p_to
       and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
  ),
  paid_due as (   -- families who paid fees that had fallen due (old dues, or installments past their due date)
    select distinct pay.pid
      from pay
      join public.allocations a on a.payment_id = pay.id
      left join public.installments i on i.id = a.installment_id
     where a.amount > 0 and (a.kind = 'arrears' or (a.kind = 'current' and i.due_date <= a.paid_on))
  ),
  called as (
    select s.pid, coalesce(sum(y.amount), 0) as amt
      from spoke s left join pay y on y.pid = s.pid and y.paid_on >= s.first_on
     group by s.pid
  ),
  pop as (select fam.pid from fam where fam.tod >= v_min union select paid_due.pid from paid_due),
  others as (
    select o.pid, exists (select 1 from paid_due d where d.pid = o.pid) as paid, coalesce(sum(y.amount), 0) as amt
      from pop o
      left join pay y on y.pid = o.pid
     where not exists (select 1 from spoke s where s.pid = o.pid)
     group by o.pid
  ),
  r as (
    select (select count(*) from called) as spoke,
           (select count(*) from called where called.amt > 0) as spoke_paid,
           (select coalesce(sum(called.amt), 0) from called) as spoke_amount,
           (select count(*) from others) as others,
           (select count(*) from others where others.paid) as others_paid,
           (select coalesce(sum(others.amt) filter (where others.paid), 0) from others) as others_amount
  )
  select jsonb_build_object(
           'spoke', r.spoke, 'spoke_paid', r.spoke_paid, 'spoke_amount', r.spoke_amount,
           'spoke_pct', case when r.spoke > 0 then round(100.0 * r.spoke_paid / r.spoke) end,
           'others', r.others, 'others_paid', r.others_paid, 'others_amount', r.others_amount,
           'others_pct', case when r.others > 0 then round(100.0 * r.others_paid / r.others) end,
           'lift', case when r.spoke > 0 and r.others > 0 and r.others_paid > 0
                        then round((r.spoke_paid::numeric / r.spoke) / (r.others_paid::numeric / r.others), 1) end)
    into v_impact
    from r;

  -- activities: what each brought in during the period
  with cr as (
    select rp.activity_id, p.student_id, p.amount
      from public.recovery_credits rc
      join public.recovery_participants rp on rp.id = rc.participant_id
      join public.payments p on p.id = rc.payment_id
     where p.paid_on between p_from and p_to
       and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
  ),
  x as (select cr.activity_id, sum(cr.amount) as amt, count(*) as n, count(distinct cr.student_id) as students from cr group by 1)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'name', a.name, 'status', a.status, 'start_date', a.start_date, 'end_date', a.end_date,
           'participants', (select count(*) from public.recovery_participants rp where rp.activity_id = a.id),
           'recovered', coalesce(x.amt, 0), 'receipts', coalesce(x.n, 0), 'students_paid', coalesce(x.students, 0)
         ) order by coalesce(x.amt, 0) desc, a.start_date desc), '[]'::jsonb)
    into v_acts
    from public.recovery_activities a
    left join x on x.activity_id = a.id
   where x.amt > 0 or (a.start_date <= p_to and coalesce(a.end_date, v_today) >= p_from);

  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'days', v_days, 'prev_from', v_pfrom, 'prev_to', v_pto,
                                 'bucket', v_bucket, 'today', v_today),
    'money', v_money,
    'calls', v_calls,
    'impact', v_impact,
    'activities', v_acts
  );
end $$;

-- ---------------------------------------------------------------------------
-- Parent 360 again: calls say what they were about and what came in because of them; activities by their new name
-- ---------------------------------------------------------------------------
create or replace function public.parent_360(p_parent uuid, p_session uuid default null)
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
           'follow_up_on', c.follow_up_on, 'purpose', c.purpose,
           'author', coalesce(nullif(pr.full_name, ''), pr.email),
           'recovered', coalesce((select sum(p.amount) from public.recovery_credits cr join public.payments p on p.id = cr.payment_id
                                   where cr.call_id = c.id
                                     and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)), 0),
           'promise', case when pp.source_id is null then null
                           else jsonb_build_object('status', pp.status, 'timing', pp.timing, 'paid', pp.paid,
                                                   'kept_on', pp.kept_on, 'deadline', pp.deadline) end
         ) order by c.call_date desc, c.called_at desc), '[]'::jsonb)
    into v_calls
    from public.parent_calls c
    left join public.profiles pr on pr.id = c.created_by
    left join public.parent_promises(p_parent) pp on pp.source = 'call' and pp.source_id = c.id
   where c.parent_id = p_parent;

  -- every promise (calls and student notes) and how reliable the family is
  with pp as (select * from public.parent_promises(p_parent))
  select coalesce(jsonb_agg(jsonb_build_object(
           'source', pp.source, 'source_id', pp.source_id, 'student_id', pp.student_id, 'student_name', st.full_name,
           'made_on', pp.made_on, 'promised_date', pp.promised_date,
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
    left join public.students st on st.id = pp.student_id;

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
           'participant_id', rp.id, 'activity_id', c.id, 'name', c.name, 'status', c.status,
           'start_date', c.start_date, 'end_date', c.end_date, 'student_id', st.id, 'student_name', st.full_name,
           'response', rp.response, 'note', rp.note,
           'credited', coalesce((select sum(p.amount) from public.recovery_credits rc join public.payments p on p.id = rc.payment_id
                                  where rc.participant_id = rp.id
                                    and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)), 0)
         ) order by c.start_date desc, st.full_name), '[]'::jsonb)
    into v_acts
    from public.recovery_participants rp
    join public.recovery_activities c on c.id = rp.activity_id
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
-- Student side: the family, its latest calls (with the promise each made), the activities of the student, and
-- the call the counter should suggest as the reason for a payment today (a fee call that got through in the
-- last 7 days, or one whose promise is still running)
-- ---------------------------------------------------------------------------
create or replace function public.student_recovery(p_student uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_st      public.students;
  v_p       public.parents;
  v_sess    uuid := public.running_session();
  v_today   date := public.fees_today();
  v_sib     jsonb;
  v_calls   jsonb;
  v_promise jsonb;
  v_rel     jsonb;
  v_acts    jsonb;
  v_suggest uuid;
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

    with pp as (select * from public.parent_promises(v_st.parent_id) x where x.source = 'call')
    select coalesce(jsonb_agg(x.j order by x.call_date desc, x.called_at desc), '[]'::jsonb)
      into v_calls
      from (select c.call_date, c.called_at,
                   jsonb_build_object('id', c.id, 'call_date', c.call_date, 'purpose', c.purpose, 'outcome', c.outcome,
                                      'picked_by', c.picked_by, 'response', c.response, 'summary', c.summary,
                                      'promised_date', c.promised_date, 'promised_amount', c.promised_amount,
                                      'promise_status', pp.status, 'author', coalesce(nullif(pr.full_name, ''), pr.email)) as j
              from public.parent_calls c
              left join public.profiles pr on pr.id = c.created_by
              left join pp on pp.source_id = c.id
             where c.parent_id = v_st.parent_id
             order by c.call_date desc, c.called_at desc
             limit 8) x;

    select c.id into v_suggest
      from public.parent_calls c
      left join public.parent_promises(v_st.parent_id) pp on pp.source = 'call' and pp.source_id = c.id
     where c.parent_id = v_st.parent_id and c.purpose = 'fees' and c.outcome = 'connected'
       and (c.call_date >= v_today - 7 or pp.status = 'pending')
     order by (pp.status = 'pending') desc nulls last, c.call_date desc, c.called_at desc
     limit 1;

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

  -- activities with what the student paid since each started (to its end, or today) and what was counted for it
  select coalesce(jsonb_agg(jsonb_build_object(
           'participant_id', f.participant_id, 'activity_id', a.id, 'name', a.name, 'description', a.description,
           'status', a.status, 'start_date', a.start_date, 'end_date', a.end_date, 'target_amount', a.target_amount,
           'participants', (select count(*) from public.recovery_participants x where x.activity_id = a.id),
           'added_on', f.added_on, 'response', f.response, 'note', f.note, 'updated_at', f.updated_at,
           'updated_by_name', (select coalesce(nullif(pr.full_name, ''), pr.email) from public.profiles pr where pr.id = f.updated_by),
           'paid_since', f.paid_since, 'credited', f.credited, 'credited_receipts', f.credited_n
         ) order by (a.status = 'active') desc, a.start_date desc, a.created_at desc), '[]'::jsonb)
    into v_acts
    from public.activity_participant_figures(p_student => p_student) f
    join public.recovery_activities a on a.id = f.activity_id;

  return jsonb_build_object(
    'parent', case when v_p.id is null then null else jsonb_build_object(
                'id', v_p.id, 'name', v_p.name, 'phone', v_p.phone, 'alt_phone', v_p.alt_phone, 'relation', v_p.relation,
                'economic_status', v_p.economic_status, 'payment_behaviour', v_p.payment_behaviour, 'attitude', v_p.attitude,
                'best_time_to_call', v_p.best_time_to_call, 'concerns', v_p.concerns, 'priorities', v_p.priorities) end,
    'siblings', coalesce(v_sib, '[]'::jsonb),
    'calls', coalesce(v_calls, '[]'::jsonb),
    'suggested_call_id', v_suggest,
    'promise', v_promise,
    'reliability', v_rel,
    'activities', v_acts,
    'today', v_today
  );
end $$;

-- =============================================================================
-- Function privileges: the new internal helpers stay with the owner (re-run grant_app_access after this migration)
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
                 'public.activity_participant_figures(uuid, uuid), '
                 'public.activity_verdict(bigint, integer, bigint, bigint, bigint, bigint), '
                 'public.grant_app_access(name) from %I', p_role);
end $$;

revoke execute on all functions in schema public from public;
