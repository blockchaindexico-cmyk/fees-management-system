-- =============================================================================
-- Demo data for local development (`npm run db:reset` runs this file).
-- Creates a login:  admin@school.test / admin12345
-- Two sessions (2025-26 closed, 2026-27 running), ~330 students, realistic
-- payment behaviour (early, on-time, late, partial, defaulters), arrears,
-- concessions, transport, cancelled receipts and a few notes.
-- Fee recovery: brothers and sisters sharing a parent (phone number), parent
-- profiles, four weeks of calls by three staff members (fees, PTM, results,
-- queries) with kept / broken / open promises, today's call list taken by two
-- callers, and three student activities. Receipts are counted for the call or
-- the activity that brought them in.
-- Deterministic: the same data is produced on every reset.
-- =============================================================================

-- Local admin user (password admin12345, hashed with src/server/auth/password.mjs) -------
do $$
declare uid uuid := '11111111-1111-1111-1111-111111111111';
begin
  if not exists (select 1 from public.app_users where lower(email) = 'admin@school.test') then
    insert into public.app_users (id, email, password_hash)
    values (uid, 'admin@school.test',
            'scrypt$16384$8$1$r1wYA357eU3Hvu03+PwNhw==$mf5rDXRi60HMbMzRAoa/40vfkyTTETb3E44HsmmHsmNMr9V8ojHqbJGGC+TbnXlqi9xwpEpfLHXrAUw34Findw==');
    update public.profiles set full_name = 'School Admin' where id = uid;
  end if;
end $$;

-- Two more staff members who call parents (password admin12345): an accountant and the principal ----------------
do $$
declare v_hash text := 'scrypt$16384$8$1$r1wYA357eU3Hvu03+PwNhw==$mf5rDXRi60HMbMzRAoa/40vfkyTTETb3E44HsmmHsmNMr9V8ojHqbJGGC+TbnXlqi9xwpEpfLHXrAUw34Findw==';
begin
  insert into public.app_users (id, email, password_hash)
  select v.id, v.email, v_hash
    from (values ('22222222-2222-2222-2222-222222222222'::uuid, 'neha@school.test'),
                 ('33333333-3333-3333-3333-333333333333'::uuid, 'ravi@school.test')) v(id, email)
   where not exists (select 1 from public.app_users u where lower(u.email) = v.email);
  update public.profiles set full_name = 'Neha Joshi', role = 'accountant' where id = '22222222-2222-2222-2222-222222222222';
  update public.profiles set full_name = 'Ravi Mehta', role = 'principal' where id = '33333333-3333-3333-3333-333333333333';
end $$;

-- School data -------------------------------------------------------------------
do $$
declare
  boys    text[] := array['Aarav','Vivaan','Aditya','Vihaan','Arjun','Sai','Reyansh','Ayaan','Krishna','Ishaan','Shaurya',
                          'Atharv','Advik','Pranav','Advait','Dhruv','Kabir','Ritvik','Aarush','Kian','Darsh','Veer','Rudra',
                          'Yash','Harsh','Rohan','Kunal','Manav','Nikhil','Parth','Rahul','Siddharth','Tanmay','Utkarsh','Varun'];
  girls   text[] := array['Saanvi','Aanya','Aadhya','Aaradhya','Ananya','Pari','Anika','Navya','Diya','Myra','Sara','Ira',
                          'Ahana','Anvi','Prisha','Riya','Kavya','Isha','Meera','Nisha','Pooja','Shruti','Tanvi','Vanya',
                          'Zoya','Khushi','Neha','Palak','Simran','Sneha'];
  surnames text[] := array['Sharma','Verma','Gupta','Agarwal','Jain','Singh','Choudhary','Meena','Yadav','Kumawat','Saini',
                           'Joshi','Mathur','Khandelwal','Goyal','Mittal','Bansal','Rathore','Shekhawat','Soni','Purohit',
                           'Tiwari','Mishra','Pareek','Sethi'];
  fathers text[] := array['Rajesh','Suresh','Mahesh','Ramesh','Dinesh','Mukesh','Sanjay','Vijay','Ajay','Manoj','Anil','Sunil',
                          'Rakesh','Naresh','Pankaj','Deepak','Ashok','Vinod','Pradeep','Sandeep','Amit','Sumit','Vikas',
                          'Rohit','Gaurav'];
  mothers text[] := array['Sunita','Anita','Kavita','Rekha','Seema','Neetu','Pooja','Priya','Mamta','Suman','Geeta','Asha',
                          'Manju','Ritu','Shalini','Swati','Preeti','Renu','Usha','Kiran'];
  class_names text[] := array['Nursery','LKG','UKG','Class 1','Class 2','Class 3','Class 4','Class 5','Class 6','Class 7',
                              'Class 8','Class 9','Class 10'];
  modes   public.payment_mode[] := array['cash','cash','cash','cash','upi','upi','upi','upi','bank_transfer','cheque','cheque','card'];
  profiles text[] := array['early','early','early','ontime','ontime','ontime','late','late','partial','partial','defaulter'];

  v_today  date := public.fees_today();
  s_prev   uuid;
  s_cur    uuid;
  cls      uuid[] := '{}';
  h_tui    uuid; h_ann uuid; h_exam uuid; h_trans uuid;
  inst     record;
  k        integer;
  n        integer;
  j        integer;
  v_id     uuid;
  v_male   boolean;
  v_first  text;
  v_sur    text;
  v_prof   text;
  v_adm    integer := 0;
  v_sec    text;
  v_has_prev boolean;
  srow     record;
  ins      record;
  v_due    bigint;
  v_paid_on date;
  v_amt    bigint;
  v_frac   numeric;
  pr       record;
  uid      uuid := '11111111-1111-1111-1111-111111111111';
  u_neha   uuid := '22222222-2222-2222-2222-222222222222';
  u_ravi   uuid := '33333333-3333-3333-3333-333333333333';
  v_act1   uuid;
  v_act2   uuid;
  v_act3   uuid;
begin
  perform setseed(0.2026);
  perform set_config('fees.skip_realloc', 'on', true);

  update public.school_settings
     set school_name = 'Sunrise Public School',
         address = '12 Station Road, Malviya Nagar, Jaipur, Rajasthan 302017',
         phone = '+91 141 400 0000', email = 'accounts@sunrise.test',
         affiliation = 'Affiliated to CBSE, New Delhi', receipt_prefix = 'SPS'
   where id = 1;

  insert into public.academic_sessions (name, start_date, end_date, is_current)
  values ('2025-26', '2025-04-01', '2026-03-31', false) returning id into s_prev;
  insert into public.academic_sessions (name, start_date, end_date, is_current)
  values ('2026-27', '2026-04-01', '2027-03-31', true) returning id into s_cur;

  insert into public.installments (session_id, number, name, due_date) values
    (s_prev, 1, 'Installment 1 (Apr-Jul)', '2025-04-10'),
    (s_prev, 2, 'Installment 2 (Aug-Nov)', '2025-08-10'),
    (s_prev, 3, 'Installment 3 (Dec-Mar)', '2025-12-10'),
    (s_cur,  1, 'Installment 1 (Apr-Jul)', '2026-04-10'),
    (s_cur,  2, 'Installment 2 (Aug-Nov)', '2026-08-10'),
    (s_cur,  3, 'Installment 3 (Dec-Mar)', '2026-12-10');

  for k in 1 .. array_length(class_names, 1) loop
    insert into public.classes (name, sort_order) values (class_names[k], k) returning id into v_id;
    cls := cls || v_id;
  end loop;

  insert into public.fee_heads (name, priority) values ('Tuition Fee', 10) returning id into h_tui;
  insert into public.fee_heads (name, priority) values ('Annual Charges', 20) returning id into h_ann;
  insert into public.fee_heads (name, priority) values ('Exam Fee', 30) returning id into h_exam;
  insert into public.fee_heads (name, priority) values ('Transport Fee', 40) returning id into h_trans;

  -- fee structure (paise). 2026-27 is ~8% dearer.
  for inst in select i.*, (i.session_id = s_cur) as is_cur from public.installments i loop
    for k in 1 .. array_length(cls, 1) loop
      insert into public.fee_structures (class_id, installment_id, fee_head_id, amount)
      values (cls[k], inst.id, h_tui,
              (round((6000 + k * 700) * case when inst.is_cur then 1.08 else 1 end / 100) * 100 * 100)::bigint);
      if inst.number = 1 then
        insert into public.fee_structures (class_id, installment_id, fee_head_id, amount)
        values (cls[k], inst.id, h_ann, ((4000 + k * 100) * case when inst.is_cur then 1.1 else 1 end * 100)::bigint);
      end if;
      if inst.number in (2, 3) and k >= 4 then
        insert into public.fee_structures (class_id, installment_id, fee_head_id, amount)
        values (cls[k], inst.id, h_exam, 120000);
      end if;
    end loop;
  end loop;

  -- students ------------------------------------------------------------------
  create temp table _seed_stu (id uuid, profile text, transport boolean, conc numeric) on commit drop;

  -- current-year classes (index k), plus last year's Class 10 who have passed out (k = 14)
  for k in 1 .. array_length(cls, 1) + 1 loop
    n := 18 + floor(random() * 12)::int;
    for j in 1 .. n loop
      v_adm := v_adm + 1;
      v_male := random() < 0.52;
      v_first := case when v_male then boys[1 + floor(random() * array_length(boys, 1))::int]
                      else girls[1 + floor(random() * array_length(girls, 1))::int] end;
      v_sur := surnames[1 + floor(random() * array_length(surnames, 1))::int];
      v_prof := profiles[1 + floor(random() * array_length(profiles, 1))::int];
      v_sec := case when n > 24 and j > n / 2 then 'B' else 'A' end;
      -- most students in UKG and above were here last year (one class lower)
      v_has_prev := (k >= 2 and random() < 0.9) or k = 14;

      insert into public.students (admission_no, full_name, father_name, mother_name, phone, gender, dob,
                                   address, admission_date, status)
      values ('SPS' || lpad(v_adm::text, 4, '0'),
              v_first || ' ' || v_sur,
              fathers[1 + floor(random() * array_length(fathers, 1))::int] || ' ' || v_sur,
              mothers[1 + floor(random() * array_length(mothers, 1))::int] || ' ' || v_sur,
              '9' || lpad(floor(random() * 999999999)::text, 9, '0'),
              case when v_male then 'M' else 'F' end,
              make_date(2023 - least(k, 13) - 3 + 1, 1 + floor(random() * 12)::int, 1 + floor(random() * 28)::int),
              (1 + floor(random() * 200)::int) || ', ' || (array['Malviya Nagar','Mansarovar','Vaishali Nagar','C-Scheme',
                 'Jagatpura','Raja Park','Sanganer','Tonk Road'])[1 + floor(random() * 8)::int] || ', Jaipur',
              case when v_has_prev then date '2025-04-01' - (floor(random() * 1500))::int else date '2026-04-01' - (floor(random() * 20))::int end,
              case when k = 14 then 'passed_out'::public.student_status else 'active' end)
      returning id into v_id;

      if k <= array_length(cls, 1) then
        insert into public.enrollments (student_id, session_id, class_id, section, roll_no)
        values (v_id, s_cur, cls[k], v_sec, j::text);
      end if;
      if v_has_prev then
        insert into public.enrollments (student_id, session_id, class_id, section, roll_no)
        values (v_id, s_prev, cls[k - 1], v_sec, j::text);
      end if;

      insert into _seed_stu values (
        v_id, v_prof, random() < 0.35,
        case when random() < 0.02 then 100 when random() < 0.08 then 50 when random() < 0.05 then 25 else 0 end);
    end loop;
  end loop;

  -- brothers and sisters: some students share their family's phone (and parents' names). The
  -- students_link_parent trigger moves them into one parent profile; the emptied profiles are dropped.
  with g as (
    select st.id, st.phone, st.father_name, st.mother_name, st.address, split_part(st.full_name, ' ', 2) as sur,
           row_number() over (partition by split_part(st.full_name, ' ', 2) order by st.admission_no) as rn
      from public.students st where st.status = 'active'
  )
  update public.students s
     set phone = h.phone, father_name = h.father_name, mother_name = h.mother_name, address = h.address
    from g join g h on h.sur = g.sur and h.rn = g.rn - case when g.rn % 10 = 3 then 2 else 1 end
   where s.id = g.id and (g.rn % 5 = 2 or g.rn % 10 = 3);
  delete from public.parents p where not exists (select 1 from public.students st where st.parent_id = p.id);

  -- what the staff know about most families (choices follow the family's payment habit; hashes of the
  -- phone number keep them deterministic without drawing on random())
  with fam as (
    select distinct on (st.parent_id) st.parent_id, ss.profile, (hashtext(p.phone)::bigint + 2147483648) as h
      from public.students st
      join _seed_stu ss on ss.id = st.id
      join public.parents p on p.id = st.parent_id
     order by st.parent_id, st.admission_no
  )
  update public.parents p
     set economic_status = case f.profile
                             when 'early' then (array['upper_middle', 'high'])[1 + f.h % 2]
                             when 'ontime' then (array['middle', 'upper_middle'])[1 + f.h % 2]
                             when 'late' then (array['middle', 'lower_middle'])[1 + f.h % 2]
                             when 'partial' then (array['lower_middle', 'low'])[1 + f.h % 2]
                             else (array['high', 'middle', 'low'])[1 + f.h % 3] end,
         payment_behaviour = case f.profile
                               when 'early' then 'regular'
                               when 'ontime' then 'installment_wise'
                               when 'late' then (array['year_end', 'irregular'])[1 + (f.h / 3) % 2]
                               when 'partial' then (array['willing_struggling', 'carries_forward'])[1 + (f.h / 3) % 2]
                               else case when f.h % 3 = 2 then 'non_payer' else 'capable_not_paying' end end,
         attitude = case f.profile
                      when 'early' then 'cooperative'
                      when 'ontime' then (array['cooperative', 'neutral'])[1 + (f.h / 5) % 2]
                      when 'late' then (array['neutral', 'demanding'])[1 + (f.h / 5) % 2]
                      when 'partial' then (array['cooperative', 'neutral'])[1 + (f.h / 5) % 2]
                      else (array['demanding', 'difficult', 'neutral'])[1 + (f.h / 5) % 3] end,
         occupation = (array['Shop owner', 'Government job', 'Private job', 'Farmer', 'Driver', 'Teacher', 'Business',
                             'Daily wage worker', 'Doctor', 'Contractor'])[1 + (f.h / 7) % 10],
         best_time_to_call = (array['After 7 pm', 'Morning before 9', 'Lunch time (1–2 pm)', 'Weekends only', null])[1 + (f.h / 11) % 5],
         concerns = (array['Weak in English speaking', 'Maths marks are dropping', 'Wants more homework support',
                           'School bus timing', 'Discipline in class', 'Board exam preparation', 'Handwriting and spelling',
                           'Wants more sports and activities'])[1 + (f.h / 13) % 8],
         priorities = (array['Good results', 'Spoken English and confidence', 'Safety and transport', 'Sports and activities',
                             'Fee concession or easy installments', 'Personal attention from teachers'])[1 + (f.h / 17) % 6],
         behaviour_notes = (array['Polite on calls, usually keeps their word.',
                                  'Busy; prefers short calls and WhatsApp reminders.',
                                  'Asks for more time every installment, but pays eventually.',
                                  'Gets upset when reminded in front of others. Speak privately.',
                                  'Mother handles fees; father rarely picks up.',
                                  'Compares our fees with other schools; mentions concessions.'])[1 + (f.h / 19) % 6]
    from fam f
   where p.id = f.parent_id and f.h % 10 < 7;

  -- charges from structure, then transport + concessions
  insert into public.student_charges (student_id, session_id, installment_id, fee_head_id, amount, source)
  select e.student_id, e.session_id, fs.installment_id, fs.fee_head_id, fs.amount, 'structure'
    from public.enrollments e
    join public.fee_structures fs on fs.class_id = e.class_id
    join public.installments i on i.id = fs.installment_id and i.session_id = e.session_id;

  insert into public.student_charges (student_id, session_id, installment_id, fee_head_id, amount, source)
  select e.student_id, e.session_id, i.id, h_trans, case when e.session_id = s_cur then 380000 else 350000 end, 'manual'
    from public.enrollments e
    join _seed_stu ss on ss.id = e.student_id and ss.transport
    join public.installments i on i.session_id = e.session_id;

  update public.student_charges sc
     set concession = round(sc.amount * ss.conc / 100)::bigint,
         note = case when ss.conc = 100 then 'RTE / free seat' when ss.conc = 50 then 'Staff ward' else 'Sibling concession' end
    from _seed_stu ss
   where ss.id = sc.student_id and ss.conc > 0 and sc.fee_head_id = h_tui;

  -- payments ------------------------------------------------------------------
  create temp table _seed_pay (student_id uuid, paid_on date, amount bigint, mode public.payment_mode) on commit drop;

  for srow in select ss.*, e.session_id, s.start_date
              from _seed_stu ss
              join public.enrollments e on e.student_id = ss.id
              join public.academic_sessions s on s.id = e.session_id
             order by s.start_date
  loop
    -- behaviour drifts a little between years
    v_prof := case when random() < 0.15 then profiles[1 + floor(random() * array_length(profiles, 1))::int] else srow.profile end;

    for ins in select i.* from public.installments i where i.session_id = srow.session_id order by i.number loop
      select coalesce(sum(net_amount), 0) into v_due
        from public.student_charges where student_id = srow.id and installment_id = ins.id;
      continue when v_due <= 0;

      if v_prof = 'early' then
        insert into _seed_pay values (srow.id, ins.due_date - floor(random() * 15)::int, v_due, modes[1 + floor(random() * 12)::int]);
      elsif v_prof = 'ontime' then
        insert into _seed_pay values (srow.id, ins.due_date + floor(random() * 10)::int, v_due, modes[1 + floor(random() * 12)::int]);
      elsif v_prof = 'late' then
        if random() < 0.85 then
          insert into _seed_pay values (srow.id, ins.due_date + 20 + floor(random() * 60)::int, v_due, modes[1 + floor(random() * 12)::int]);
        end if;
      elsif v_prof = 'partial' then
        v_frac := 0.4 + random() * 0.4;
        insert into _seed_pay values (srow.id, ins.due_date + floor(random() * 30)::int,
                                      (round(v_due * v_frac / 50000) * 50000)::bigint, modes[1 + floor(random() * 12)::int]);
        if random() < 0.5 then
          insert into _seed_pay values (srow.id, ins.due_date + 60 + floor(random() * 90)::int,
                                        (round(v_due * (1 - v_frac) / 50000) * 50000)::bigint, modes[1 + floor(random() * 12)::int]);
        end if;
      else -- defaulter
        if ins.number = 1 and random() < 0.6 then
          insert into _seed_pay values (srow.id, ins.due_date + 30 + floor(random() * 120)::int,
                                        (round(v_due * (0.2 + random() * 0.3) / 50000) * 50000)::bigint, 'cash');
        end if;
      end if;
    end loop;
  end loop;

  -- some arrears recovery in the running year from last year's defaulters / late payers
  insert into _seed_pay
  select ss.id, date '2026-04-15' + floor(random() * 150)::int, (round((5000 + random() * 15000) / 500) * 500 * 100)::bigint, 'cash'
    from _seed_stu ss
   where ss.profile in ('defaulter', 'partial') and random() < 0.35;

  -- fee recovery: fee calls over the last four weeks by three staff members. About half of the families who pay
  -- late, in part or not at all were called; those who promised either paid (early, on the day, within the grace
  -- day or only in part) or did not.
  create temp table _seed_calls on commit drop as
  with fam as (
    select distinct on (st.parent_id) st.parent_id, st.id as head_id, ss.profile, (hashtext(p.phone)::bigint + 2147483648) as h
      from public.students st
      join _seed_stu ss on ss.id = st.id
      join public.parents p on p.id = st.parent_id
     where st.status = 'active'
       and exists (select 1 from public.enrollments e where e.student_id = st.id and e.session_id = s_cur)
     order by st.parent_id, st.admission_no
  ),
  c as (
    select fam.parent_id, fam.head_id, fam.h,
           (v_today - 1 - ((fam.h / 7) % 27)::int) as call_date,
           case when fam.h % 10 < 6 then 'connected' when fam.h % 10 in (6, 9) then 'no_answer'
                when fam.h % 10 = 7 then 'busy' else 'switched_off' end as outcome,
           case when (fam.h / 11) % 10 < 6 then 'will_pay' when (fam.h / 11) % 10 = 6 then 'needs_time'
                when (fam.h / 11) % 10 = 7 then 'financial_issue' when (fam.h / 11) % 10 = 8 then 'complaint'
                else 'call_later' end as resp
      from fam
     where fam.profile in ('defaulter', 'partial', 'late') and fam.h % 2 = 0
  )
  select c.parent_id, c.head_id, c.h, c.call_date, c.outcome,
         case when c.outcome = 'connected' then (array['father', 'father', 'mother', 'guardian'])[1 + (c.h / 23) % 4] end as picked_by,
         case when c.outcome = 'connected' then c.resp end as response,
         case when c.outcome = 'no_answer' then 'Rang, no answer.'
              when c.outcome = 'busy' then 'Cut the call; try in the evening.'
              when c.outcome = 'switched_off' then 'Phone switched off.'
              when c.resp = 'will_pay' then (array['Will pay after salary.', 'Said they will come to the office and pay.',
                                                   'Promised to clear the overdue installment.', 'Will pay by UPI.'])[1 + (c.h / 29) % 4]
              when c.resp = 'needs_time' then 'Asked for a few more weeks; crop money expected next month.'
              when c.resp = 'financial_issue' then 'Lost job recently; asked about a concession.'
              when c.resp = 'complaint' then 'Unhappy about the bus timing; wants to meet the principal before paying.'
              else 'In a meeting; asked to call again next week.' end as summary,
         case when c.outcome = 'connected' and c.resp = 'will_pay' then c.call_date + 2 + ((c.h / 13) % 8)::int end as promised_date,
         case when c.outcome = 'connected' and c.resp = 'will_pay' and (c.h / 17) % 3 <> 0
              then ((5000 + ((c.h / 19) % 6) * 2500) * 100)::bigint end as promised_amount,
         case when c.outcome = 'connected' and c.resp = 'call_later' then c.call_date + 3 + ((c.h / 31) % 5)::int end as follow_up_on,
         (array[uid, u_neha, u_neha, u_ravi])[1 + (c.h / 53) % 4] as caller
    from c;

  insert into public.parent_calls (parent_id, purpose, call_date, called_at, outcome, picked_by, response, summary,
                                   promised_date, promised_amount, follow_up_on, created_by)
  select sc.parent_id, 'fees', sc.call_date,
         (sc.call_date + time '10:00' + ((sc.h / 37) % 420) * interval '1 minute') at time zone 'Asia/Kolkata',
         sc.outcome, sc.picked_by, sc.response, sc.summary, sc.promised_date, sc.promised_amount, sc.follow_up_on, sc.caller
    from _seed_calls sc;

  -- calls about other things: parent-teacher meetings, results, a parent's question
  insert into public.parent_calls (parent_id, purpose, call_date, called_at, outcome, picked_by, summary, created_by)
  select x.parent_id, x.purpose, x.call_date,
         least((x.call_date + time '11:00' + ((x.h / 37) % 360) * interval '1 minute') at time zone 'Asia/Kolkata',
               now() - interval '10 minutes'),
         x.outcome,
         case when x.outcome = 'connected' then (array['father', 'mother', 'mother', 'guardian'])[1 + (x.h / 23) % 4] end,
         case when x.outcome <> 'connected' then 'No answer.'
              when x.purpose = 'ptm' then (array['Invited to the parent-teacher meeting on Saturday; both parents will come.',
                                                 'Reminded about the PTM; the mother will attend.'])[1 + (x.h / 29) % 2]
              when x.purpose = 'performance' then (array['Shared the half-yearly results; weak in maths, suggested extra practice.',
                                                         'Told them about the good unit-test marks in science.'])[1 + (x.h / 29) % 2]
              when x.purpose = 'query' then (array['Asked about the new bus timings; explained the route change.',
                                                   'Asked when the second installment is due.'])[1 + (x.h / 29) % 2]
              else 'Informed about the annual day rehearsals next week.' end,
         x.caller
    from (select f.parent_id, f.h,
                 (array['ptm', 'ptm', 'performance', 'query', 'other'])[1 + (f.h / 61) % 5] as purpose,
                 v_today - ((f.h / 67) % 28)::int as call_date,
                 case when f.h % 5 = 4 then 'no_answer' else 'connected' end as outcome,
                 (array[uid, u_neha, u_ravi, u_ravi])[1 + (f.h / 71) % 4] as caller
            from (select distinct on (st.parent_id) st.parent_id, (hashtext(p.phone || 'o')::bigint + 2147483648) as h
                    from public.students st
                    join public.parents p on p.id = st.parent_id
                   where st.status = 'active'
                   order by st.parent_id) f
           where f.h % 6 = 1) x;

  -- promises kept (on or before the day, or the grace day after it), some kept only in part, the rest not kept
  insert into _seed_pay
  select sc.head_id,
         case when (sc.h / 41) % 4 = 3 then sc.promised_date + 1 else greatest(sc.call_date, sc.promised_date - ((sc.h / 41) % 4)::int) end,
         case when (sc.h / 43) % 5 = 2 then coalesce(sc.promised_amount, 500000) / 2 else coalesce(sc.promised_amount, 500000) end,
         (array['cash', 'upi'])[1 + (sc.h / 47) % 2]::public.payment_mode
    from _seed_calls sc
   where sc.promised_date is not null and (sc.h / 43) % 5 < 3;

  -- student activities used to recover fees
  insert into public.recovery_activities (name, description, start_date, target_amount, created_by, created_at)
  values ('English speaking club',
          'Extra spoken-English practice three days a week for Class 6 and 7 students whose parents worry about it. '
          || 'Parents were asked to clear pending fees so the school can run it.',
          v_today - 25, 20000000, uid, (v_today - 25)::timestamp + interval '9 hours')
  returning id into v_act1;
  insert into public.recovery_activities (name, description, start_date, end_date, created_by, created_at)
  values ('Class 8 science trip',
          'A day trip to the science centre, open to Class 8 students whose fees are paid up to date.',
          v_today - 12, v_today + 10, uid, (v_today - 12)::timestamp + interval '9 hours')
  returning id into v_act2;
  insert into public.recovery_activities (name, description, start_date, target_amount, created_by, created_at)
  values ('Maths remedial classes',
          'Extra maths classes after school for Class 9 and 10 students who scored low in the unit tests. '
          || 'Parents were reminded of pending fees at the first class.',
          v_today - 20, 30000000, u_neha, (v_today - 20)::timestamp + interval '9 hours')
  returning id into v_act3;

  insert into public.recovery_participants (activity_id, student_id, added_on, updated_by, updated_at)
  select x.act, x.student_id, x.start_on, uid, x.start_on::timestamp + interval '10 hours'
    from (select e.student_id,
                 case when c.name = 'Class 8' then v_act2 when c.name in ('Class 9', 'Class 10') then v_act3 else v_act1 end as act,
                 case when c.name = 'Class 8' then v_today - 12 when c.name in ('Class 9', 'Class 10') then v_today - 20
                      else v_today - 25 end as start_on
            from public.enrollments e
            join _seed_stu ss on ss.id = e.student_id
            join public.classes c on c.id = e.class_id
           where e.session_id = s_cur and c.name in ('Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10')
             and ss.profile in ('partial', 'defaulter', 'late')) x;

  -- about half of them paid after the activity started (only one in five for the maths classes)
  insert into _seed_pay
  select rp.student_id,
         ra.start_date + 2 + ((hashtext(st.admission_no)::bigint + 2147483648) % 15)::int,
         ((5000 + ((hashtext(st.admission_no || 'a')::bigint + 2147483648) % 5) * 2500) * 100)::bigint,
         'cash'
    from public.recovery_participants rp
    join public.recovery_activities ra on ra.id = rp.activity_id
    join public.students st on st.id = rp.student_id
   where (hashtext(st.admission_no)::bigint + 2147483648) % (case when ra.id = v_act3 then 5 else 2 end) = 0;

  delete from _seed_pay where paid_on > v_today or amount <= 0;

  insert into public.payments (receipt_no, student_id, session_id, paid_on, amount, mode, reference_no, source, created_at, created_by)
  select 'TMP-' || row_number() over (), sp.student_id, public.session_for_date(sp.paid_on), sp.paid_on, sp.amount, sp.mode,
         case sp.mode when 'upi' then 'UPI' || lpad(floor(random() * 1e9)::text, 10, '0')
                      when 'cheque' then 'CHQ ' || lpad(floor(random() * 999999)::text, 6, '0')
                      when 'bank_transfer' then 'NEFT' || lpad(floor(random() * 1e9)::text, 10, '0')
                      when 'card' then 'POS' || lpad(floor(random() * 99999)::text, 5, '0')
         end,
         case when sp.paid_on < date '2026-04-01' then 'import' else 'app' end,
         least(sp.paid_on::timestamp + interval '9 hours' + (floor(random() * 420) || ' minutes')::interval, now() - interval '5 minutes'),
         '11111111-1111-1111-1111-111111111111'
    from _seed_pay sp
   where public.session_for_date(sp.paid_on) is not null;

  -- receipt numbers in date order per session
  update public.payments p
     set receipt_no = 'SPS' || to_char(s.start_date, 'YY') || to_char(s.end_date, 'YY') || '/' || lpad(x.rn::text, 5, '0')
    from (select id, session_id, row_number() over (partition by session_id order by created_at, id) rn from public.payments) x
    join public.academic_sessions s on s.id = x.session_id
   where x.id = p.id;

  insert into public.receipt_counters (session_id, last_no)
  select session_id, count(*) from public.payments group by session_id;

  -- a few cancelled receipts in the running session (wrong student / bounced cheque)
  for pr in select * from public.payments where session_id = s_cur and paid_on < v_today - 10 order by created_at, id offset 40 limit 3 loop
    insert into public.payments (receipt_no, student_id, session_id, paid_on, amount, mode, reference_no, remarks,
                                 source, reverses_payment_id, created_at, created_by)
    values (pr.receipt_no || '-C', pr.student_id, pr.session_id, pr.paid_on + 2, -pr.amount, pr.mode, pr.reference_no,
            'Cancelled: ' || case when pr.mode = 'cheque' then 'cheque bounced' else 'entered against wrong student' end,
            'app', pr.id, least(pr.created_at + interval '2 days', now() - interval '1 minute'), '11111111-1111-1111-1111-111111111111');
  end loop;

  -- at the counter the accountant ticked most receipts that kept a promise, and some paid within a week of a
  -- call that got through, as "because of the call"
  insert into public.recovery_credits (payment_id, call_id, created_by, created_at)
  select distinct on (p.id) p.id, c.id, u_neha, least(p.created_at + interval '2 minutes', now() - interval '1 minute')
    from public.parent_calls c
    join public.students st on st.parent_id = c.parent_id
    join public.payments p on p.student_id = st.id and p.amount > 0
                          and p.paid_on between c.call_date and coalesce(c.promised_date + 1, c.call_date + 7)
   where c.purpose = 'fees' and c.outcome = 'connected'
     and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
     and (hashtext(p.receipt_no || 'c')::bigint + 2147483648) % (case when c.promised_date is not null then 5 else 2 end) <> 0
   order by p.id, c.call_date desc
  on conflict (payment_id) do nothing;

  -- the accountant credited most of the activity participants' receipts to the activity; some parents said no
  insert into public.recovery_credits (payment_id, participant_id, created_by, created_at)
  select distinct on (rp.id) p.id, rp.id, uid, least(p.created_at + interval '1 hour', now() - interval '1 minute')
    from public.recovery_participants rp
    join public.recovery_activities ra on ra.id = rp.activity_id
    join public.payments p on p.student_id = rp.student_id and p.amount > 0 and p.paid_on >= ra.start_date
   where not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
     and case when ra.id = v_act3 then (hashtext(p.receipt_no)::bigint + 2147483648) % 3 = 0
              else (hashtext(p.receipt_no)::bigint + 2147483648) % 4 <> 0 end
   order by rp.id, p.paid_on, p.created_at
  on conflict (payment_id) do nothing;
  update public.recovery_participants rp
     set response = case when exists (select 1 from public.recovery_credits rc where rc.participant_id = rp.id) then 'positive'
                         when (hashtext(st.admission_no || 'r')::bigint + 2147483648) % 3 = 0 then 'negative'
                         else 'pending' end,
         note = case when exists (select 1 from public.recovery_credits rc where rc.participant_id = rp.id) then null
                     when (hashtext(st.admission_no || 'r')::bigint + 2147483648) % 3 = 0
                       then (array['Parent says they will pay only after the half-yearly exams.',
                                   'Not interested in the activity; will pay at year end.'])[1 + (hashtext(st.admission_no)::bigint + 2147483648) % 2] end
    from public.students st
   where st.id = rp.student_id;

  -- two students left mid-year: future installments waived
  update public.students set status = 'left', left_on = '2026-07-20'
   where id in (select e.student_id from public.enrollments e join public.students st on st.id = e.student_id
                 where e.session_id = s_cur and st.status = 'active' order by st.admission_no offset 57 limit 2);
  update public.student_charges sc set concession_before_waiver = sc.concession, concession = sc.amount, note = 'Waived: left on 20 Jul 2026'
    from public.installments i, public.students st
   where i.id = sc.installment_id and st.id = sc.student_id and st.status = 'left'
     and i.due_date > st.left_on;

  -- notes / promises for some defaulters
  insert into public.student_notes (student_id, note, promised_date, promised_amount, created_by, created_at)
  select ss.id,
         (array['Father called, will pay after salary on the 10th.',
                'Promised to clear Installment 1 dues this month.',
                'Requested fee concession, pending with principal.',
                'Phone not reachable. Sent reminder on WhatsApp.'])[1 + floor(random() * 4)::int],
         case when random() < 0.6 then v_today + floor(random() * 20)::int end,
         case when random() < 0.6 then (round((5000 + random() * 10000) / 500) * 500 * 100)::bigint end,
         '11111111-1111-1111-1111-111111111111',
         now() - (floor(random() * 30) || ' days')::interval
    from _seed_stu ss
   where ss.profile = 'defaulter' and random() < 0.5;

  insert into public.collection_targets (session_id, name, target_pct, target_date)
  values (s_cur, '90% of fees due by 31 December', 90, '2026-12-31');

  perform set_config('fees.skip_realloc', 'off', true);
  perform public.reallocate_all();

  -- today's call list: Neha and Ravi took families from it and have called a few of them already
  perform set_config('app.user_id', u_neha::text, true);
  perform public.take_calls(10);
  perform set_config('app.user_id', u_ravi::text, true);
  perform public.take_calls(6);
  perform set_config('app.user_id', '', true);

  insert into public.parent_calls (parent_id, purpose, call_date, called_at, outcome, picked_by, response, summary,
                                   promised_date, promised_amount, follow_up_on, created_by)
  select a.parent_id, 'fees', v_today, now() - (a.rn * 23) * interval '1 minute',
         (array['connected', 'no_answer', 'connected', 'busy'])[a.rn],
         (array['father', null, 'mother', null])[a.rn],
         (array['will_pay', null, 'needs_time', null])[a.rn],
         (array['Will pay the overdue installment at the counter on Saturday.', 'No answer.',
                'Waiting for the harvest money; asked us to call next week.', 'Cut the call.'])[a.rn],
         case when a.rn = 1 then v_today + 3 end,
         case when a.rn = 1 then 1000000::bigint end,
         case when a.rn = 3 then v_today + 6 end,
         a.assigned_to
    from (select x.*, row_number() over (partition by x.assigned_to order by x.assigned_at, x.parent_id)::int as rn
            from public.call_assignments x where x.call_date = v_today) a
   where a.rn <= case when a.assigned_to = u_neha then 4 else 2 end;
end $$;
