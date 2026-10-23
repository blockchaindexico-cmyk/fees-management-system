-- Parent profiles linked by phone, promises, the daily call list, taking families from it, receipts counted for a
-- call or an activity, student activities and the recovery dashboard.  Run with: npm run db:test
begin;
create extension if not exists pgtap with schema extensions;
-- the app's database role, set up the way grant_app_access() documents it
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'fees_api_test') then create role fees_api_test nologin; end if;
end $$;
select public.grant_app_access('fees_api_test');
select plan(60);

insert into public.app_users (id, email, password_hash)
values ('55555555-5555-5555-5555-555555555555', 'pgtap-admin4@school.test', 'x'),
       ('44444444-4444-4444-4444-444444444444', 'pgtap-principal4@school.test', 'x')
on conflict (id) do nothing;
update public.profiles set role = 'admin' where id = '55555555-5555-5555-5555-555555555555';
update public.profiles set role = 'principal' where id = '44444444-4444-4444-4444-444444444444';
select set_config('app.user_id', '55555555-5555-5555-5555-555555555555', true);
update public.school_settings set promise_grace_days = 1 where id = 1;

-- fixtures (as owner): a session covering the last few weeks (the running one, or a new one) with an
-- installment already due; five students in four families
create temp table fx (k text primary key, id uuid);
grant select on fx to fees_api_test;
insert into fx
select 's', coalesce(public.session_for_date(public.fees_today() - 20),
                     public.create_session('PGTAP4', public.fees_today() - 200, public.fees_today() + 160,
                       jsonb_build_array(jsonb_build_object('number', 1, 'name', 'I1', 'due_date', public.fees_today() - 30)), true, null));
insert into fx select 'i', id from public.installments
 where session_id = (select id from fx where k = 's') and due_date <= public.fees_today() - 5 order by due_date desc limit 1;
insert into public.fee_heads (name, priority) values ('PGTAP4 Fee', 3);
insert into fx select 'h', id from public.fee_heads where name = 'PGTAP4 Fee';

insert into public.students (admission_no, full_name, father_name, phone) values
  ('PGTAP4-1', 'Asha One', 'Ravi One', '+91 90000 11111'),
  ('PGTAP4-2', 'Bina One', 'Ravi One', '090000-11111'),
  ('PGTAP4-3', 'Chetan Two', 'Mohan Two', '9000022222'),
  ('PGTAP4-4', 'Dev Three', null, '9000033333'),
  ('PGTAP4-5', 'Esha Four', 'Arun Four', '9000044444'),
  ('PGTAP4-6', 'Farid Five', 'Kamal Five', '9000055555'),
  ('PGTAP4-8', 'Gopal Six', 'Hemant Six', '9000077777'),
  ('PGTAP4-9', 'Hari Seven', 'Jagdish Seven', '9000088888');
insert into fx select 'st' || right(admission_no, 1), id from public.students where admission_no like 'PGTAP4-%';
insert into fx select 'pA', parent_id from public.students where admission_no = 'PGTAP4-1';
insert into fx select 'pB', parent_id from public.students where admission_no = 'PGTAP4-3';
insert into fx select 'pC', parent_id from public.students where admission_no = 'PGTAP4-4';
insert into fx select 'pD', parent_id from public.students where admission_no = 'PGTAP4-5';
insert into fx select 'pE', parent_id from public.students where admission_no = 'PGTAP4-8';
insert into fx select 'pF', parent_id from public.students where admission_no = 'PGTAP4-9';

-- ₹1,000 due on the installment for each of the first five
insert into public.student_charges (student_id, session_id, installment_id, fee_head_id, amount, source)
select st.id, (select id from fx where k = 's'), (select id from fx where k = 'i'), (select id from fx where k = 'h'), 100000, 'manual'
  from public.students st where st.admission_no in ('PGTAP4-1', 'PGTAP4-2', 'PGTAP4-3', 'PGTAP4-4', 'PGTAP4-5', 'PGTAP4-8');
-- and ₹300 (less than the ₹500 the call list starts at) for the last one
insert into public.student_charges (student_id, session_id, installment_id, fee_head_id, amount, source)
select (select id from fx where k = 'st9'), (select id from fx where k = 's'), (select id from fx where k = 'i'), (select id from fx where k = 'h'), 30000, 'manual';
update public.school_settings set call_min_overdue = 50000, call_skip_paid_days = 30, call_gap_days = 7, call_high_due = 2000000 where id = 1;

-- phone numbers and families -------------------------------------------------------------
select is(public.normalize_phone('+91 98765-43210'), '9876543210', '+91 is dropped');
select is(public.normalize_phone('098765 43210'), '9876543210', 'a leading 0 is dropped');
select is(public.normalize_phone('n/a'), null, 'text that is not a phone number gives no family');
select is((select parent_id from public.students where admission_no = 'PGTAP4-2'), (select id from fx where k = 'pA'),
  'brother and sister with the same number (written differently) share one parent');
select is((select name || '|' || relation || '|' || phone from public.parents where id = (select id from fx where k = 'pA')),
  'Ravi One|father|9000011111', 'the profile is named after the father and keeps the digits of the number');
select is((select relation from public.parents where id = (select id from fx where k = 'pC')), 'guardian',
  'no parent names: a guardian profile');

update public.students set phone = '9000066666' where admission_no = 'PGTAP4-6';
select ok((select p.phone = '9000066666' from public.students st join public.parents p on p.id = st.parent_id where st.admission_no = 'PGTAP4-6'),
  'a new phone number moves the student to that number''s family');
update public.students set parent_id = (select id from fx where k = 'pA') where admission_no = 'PGTAP4-6';
update public.students set full_name = 'Farid Five K', phone = '+91 9000066666' where admission_no = 'PGTAP4-6';
select is((select parent_id from public.students where admission_no = 'PGTAP4-6'), (select id from fx where k = 'pA'),
  'a student moved by hand stays in that family when the same number is re-typed');
update public.students set parent_id = null where admission_no = 'PGTAP4-6';

-- family balances add up ---------------------------------------------------------------
select is((select sum(f.total_pending)::bigint from public.parent_balances((select id from fx where k = 's')) f
            where f.parent_id in (select id from fx where k in ('pA', 'pB', 'pC', 'pD'))),
          (select sum(b.total_pending)::bigint from public.student_balances((select id from fx where k = 's')) b
            where b.student_id in (select id from fx where k in ('st1', 'st2', 'st3', 'st4', 'st5'))),
  'family pending = the sum of the children''s pending');
select is((select children from public.parent_balances((select id from fx where k = 's')) f where f.parent_id = (select id from fx where k = 'pA')),
  2, 'family A has two children');

-- promises -------------------------------------------------------------------------------
-- fee calls 10 days ago, promising to pay 5 days ago (deadline 4 days ago with one grace day)
insert into public.parent_calls (parent_id, call_date, outcome, picked_by, response, promised_date, promised_amount)
select id, public.fees_today() - 10, 'connected', 'father', 'will_pay', public.fees_today() - 5, case when k = 'pC' then 100000 end
  from fx where k in ('pA', 'pB', 'pC', 'pD');

-- A: a sibling paid before the date (kept early); B: nothing (broken); C: part of the promised ₹1,000 (partly kept);
-- D: paid the day after the date (kept within the grace day)
insert into public.payments (receipt_no, student_id, session_id, paid_on, amount, mode, source) values
  ('PGTAP4-R1', (select id from fx where k = 'st2'), (select id from fx where k = 's'), public.fees_today() - 6, 50000, 'cash', 'import'),
  ('PGTAP4-R2', (select id from fx where k = 'st4'), (select id from fx where k = 's'), public.fees_today() - 7, 30000, 'cash', 'import'),
  ('PGTAP4-R3', (select id from fx where k = 'st5'), (select id from fx where k = 's'), public.fees_today() - 4, 20000, 'cash', 'import');

select is((select status || '/' || timing from public.parent_promises((select id from fx where k = 'pA'))), 'kept/early',
  'paid by a brother or sister before the promised date: kept early');
select is((select status from public.parent_promises((select id from fx where k = 'pB'))), 'broken', 'nothing paid by the deadline: broken');
select is((select status || '/' || paid from public.parent_promises((select id from fx where k = 'pC'))), 'partial/30000',
  'less than the promised amount: partly kept');
select is((select status || '/' || timing from public.parent_promises((select id from fx where k = 'pD'))), 'kept/grace',
  'paid on the grace day: kept');

-- the daily call list ----------------------------------------------------------------------
create temp view cl as select * from public.call_list();
grant select on cl to fees_api_test;
-- one family's row of today's list (by fixture key), and "state/days to the next call"
create function pg_temp.cl(p_key text) returns setof pg_temp.cl language sql as $$
  select * from pg_temp.cl q where q.parent_id = (select id from fx where k = p_key)
$$;
create function pg_temp.st(p_key text) returns text language sql as $$
  select q.state || '/' || coalesce((q.next_call_on - public.fees_today())::text, '-')
    from pg_temp.cl q where q.parent_id = (select id from fx where k = p_key)
$$;

select is((select state from pg_temp.cl('pB')), 'due', 'a broken promise is back on the call list the day after its deadline');
select ok((select reasons[1] = 'broken_promise' and priority >= 40 from pg_temp.cl('pB')),
  'with "broke a promise" as its main reason, at the top of the list');
select ok((select state = 'due' and 'partial_promise' = any (reasons) from pg_temp.cl('pC')),
  'a partly kept promise is called again too');
select is((select state from pg_temp.cl('pA')), 'paid_recently', 'a family that kept its promise and paid recently is not called');
select is(pg_temp.st('pD'), 'paid_recently/26', 'paid 4 days ago: back on the list 30 days after the payment');
select ok((select state = 'due' and reasons = array['never_paid'] from pg_temp.cl('pE')), 'never paid anything: on the list');
select is((select state from pg_temp.cl('pF')), null, 'owing less than the minimum: not on the list');

select public.log_parent_call((select id from fx where k = 'pE'), 'connected', 'ptm', null, 'mother', null, 'Will come to the PTM');
select is((select state from pg_temp.cl('pE')), 'due', 'a call about something else keeps the family on the fee list');
select public.log_parent_call((select id from fx where k = 'pC'), 'no_answer');
select is(pg_temp.st('pC'), 'called/1', 'after a broken promise, an unanswered follow-up call is tried again the next day');

-- any staff member logs calls through the API role: the principal records a new promise
select set_config('app.user_id', '44444444-4444-4444-4444-444444444444', true);
set local role fees_api_test;
select lives_ok($$ select public.log_parent_call((select id from fx where k = 'pB'), 'connected', 'fees', null, 'mother', 'will_pay',
                     'Will pay on Friday', public.fees_today() + 3, null, null) $$,
  'a principal can log a call with a new promise');
select is((select assigned_to from public.call_assignments where call_date = public.fees_today() and parent_id = (select id from fx where k = 'pB')),
  '44444444-4444-4444-4444-444444444444'::uuid, 'a fee call made today puts the family on the caller''s list');
select throws_ok($$ select public.log_parent_call((select id from fx where k = 'pB'), 'no_answer', 'fees', public.fees_today() + 1) $$,
  'P0001', 'The call date cannot be in the future', 'calls cannot be dated in the future');
select throws_ok($$ select public.log_parent_call((select id from fx where k = 'pB'), 'busy', 'fees', null, null, null, null, public.fees_today() + 2) $$,
  'P0001', null, 'a promise needs a call that got through');
select throws_ok($$ select public.log_parent_call((select id from fx where k = 'pB'), 'connected', 'ptm', null, 'father', null, null, public.fees_today() + 2) $$,
  'P0001', 'What they said about fees and a promise to pay are recorded on fee calls', 'promises are recorded on fee calls');
reset role;
select is(pg_temp.st('pB'), 'called/5', 'called today with a promise for 3 days on: back on the list after the date and one grace day');
update public.parent_calls set call_date = public.fees_today() - 1
 where parent_id = (select id from fx where k = 'pB') and call_date = public.fees_today();
delete from public.call_assignments where parent_id = (select id from fx where k = 'pB');   -- the call now belongs to yesterday
select is(pg_temp.st('pB'), 'promised/5', 'the next day the family waits for its promise');

-- a fee call that got through: the family waits call_gap_days (7); a call-back date brings it back
select set_config('app.user_id', '55555555-5555-5555-5555-555555555555', true);
select public.log_parent_call((select id from fx where k = 'pE'), 'connected', 'fees', null, 'father', 'needs_time');
insert into fx select 'cE', id from public.parent_calls where parent_id = (select id from fx where k = 'pE') and purpose = 'fees';
select is(pg_temp.st('pE'), 'called/7', 'called today: next call in 7 days');
update public.parent_calls set call_date = public.fees_today() - 2 where id = (select id from fx where k = 'cE');
select is(pg_temp.st('pE'), 'waiting/5', 'two days later it is still waiting');
update public.parent_calls set call_date = public.fees_today() - 8 where id = (select id from fx where k = 'cE');
select is((select state from pg_temp.cl('pE')), 'due', 'eight days later it is back on the list');
update public.parent_calls set follow_up_on = public.fees_today() - 1 where id = (select id from fx where k = 'cE');
select is((select reasons[1] from pg_temp.cl('pE')), 'call_back', 'the date they asked to be called on is the main reason');

-- taking families from the day's list -------------------------------------------------------
select public.take_call((select id from fx where k = 'pE'));
select is((select assigned_to from public.call_assignments where call_date = public.fees_today() and parent_id = (select id from fx where k = 'pE')),
  '55555555-5555-5555-5555-555555555555'::uuid, 'a caller takes a family for today');
select set_config('app.user_id', '44444444-4444-4444-4444-444444444444', true);
set local role fees_api_test;
select throws_ok($$ select public.take_call((select id from fx where k = 'pE')) $$, 'P0001', null,
  'another caller cannot take a family someone is calling today');
select is(public.take_calls(3), 3, 'a caller gets the next three families of the list');
select is((public.call_board() -> 'me' ->> 'taken')::int, 3, 'and sees them as their list');
reset role;
select set_config('app.user_id', '55555555-5555-5555-5555-555555555555', true);
select is(public.release_calls((select id from fx where k = 'pE')), 1, 'a family can be given back to the list');
select set_config('app.user_id', '44444444-4444-4444-4444-444444444444', true);
set local role fees_api_test;
select is(public.release_calls(), 3, 'and all families not called yet');
reset role;

-- what brought a receipt in --------------------------------------------------------------
insert into fx select 'cB', id from public.parent_calls where parent_id = (select id from fx where k = 'pB') and call_date = public.fees_today() - 1;
insert into fx select 'cA', id from public.parent_calls where parent_id = (select id from fx where k = 'pA');
insert into public.payments (receipt_no, student_id, session_id, paid_on, amount, mode, source) values
  ('PGTAP4-R5', (select id from fx where k = 'st3'), (select id from fx where k = 's'), public.fees_today(), 20000, 'cash', 'import');
select set_config('app.user_id', '55555555-5555-5555-5555-555555555555', true);
set local role fees_api_test;
select lives_ok($$ select public.set_payment_source((select id from public.payments where receipt_no = 'PGTAP4-R5'), (select id from fx where k = 'cB')) $$,
  'the accountant counts a receipt for the call that brought it in');
select is((public.parent_360((select id from fx where k = 'pB')) -> 'calls' -> 0 ->> 'recovered')::bigint, 20000::bigint,
  'the call shows what came in because of it');
select throws_ok($$ select public.set_payment_source((select id from public.payments where receipt_no = 'PGTAP4-R5'), (select id from fx where k = 'cA')) $$,
  'P0001', 'That call was made to another family', 'a call to another family cannot be credited');
select public.set_payment_source((select id from public.payments where receipt_no = 'PGTAP4-R5'));
select is((select count(*)::int from public.recovery_credits where payment_id = (select id from public.payments where receipt_no = 'PGTAP4-R5')), 0,
  'and the choice can be cleared');
select set_config('app.user_id', '44444444-4444-4444-4444-444444444444', true);
select throws_ok($$ select public.set_payment_source((select id from public.payments where receipt_no = 'PGTAP4-R5'), (select id from fx where k = 'cB')) $$,
  '42501', null, 'a principal cannot change what a receipt is counted for');
reset role;

-- activities and credited receipts -------------------------------------------------------
insert into public.recovery_activities (id, name, start_date)
values ('c4c4c4c4-0000-0000-0000-000000000003', 'PGTAP4 English club', public.fees_today() - 3);
insert into fx values ('a1', 'c4c4c4c4-0000-0000-0000-000000000003');
insert into public.payments (receipt_no, student_id, session_id, paid_on, amount, mode, source) values
  ('PGTAP4-R4', (select id from fx where k = 'st3'), (select id from fx where k = 's'), public.fees_today() - 1, 40000, 'cash', 'import');
select set_config('app.user_id', '55555555-5555-5555-5555-555555555555', true);
set local role fees_api_test;
select is(public.add_activity_participants((select id from fx where k = 'a1'), array[(select id from fx where k = 'st3'), (select id from fx where k = 'st4')]),
  2, 'two students added to the activity');
select lives_ok($$ select public.set_payment_source((select id from public.payments where receipt_no = 'PGTAP4-R4'), null,
                     (select id from public.recovery_participants where activity_id = (select id from fx where k = 'a1') and student_id = (select id from fx where k = 'st3'))) $$,
  'the accountant counts a receipt for the activity');
select is((select response from public.recovery_participants where activity_id = (select id from fx where k = 'a1') and student_id = (select id from fx where k = 'st3')),
  'positive', 'a credited participant counts as a positive response');
select throws_ok($$ select public.set_payment_source((select id from public.payments where receipt_no = 'PGTAP4-R4'), null,
                      (select id from public.recovery_participants where activity_id = (select id from fx where k = 'a1') and student_id = (select id from fx where k = 'st4'))) $$,
  'P0001', null, 'another student''s receipt cannot be credited');
select public.set_payment_source((select id from public.payments where receipt_no = 'PGTAP4-R4'), (select id from fx where k = 'cB'));
select ok((select call_id is not null and participant_id is null from public.recovery_credits
            where payment_id = (select id from public.payments where receipt_no = 'PGTAP4-R4')),
  'a receipt counts for one thing only: choosing the call replaces the activity');
select public.set_payment_source((select id from public.payments where receipt_no = 'PGTAP4-R4'), null,
         (select id from public.recovery_participants where activity_id = (select id from fx where k = 'a1') and student_id = (select id from fx where k = 'st3')));
select throws_ok($$ select public.link_parents_by_phone() $$, '42501', null, 'link_parents_by_phone is not callable through the API');
reset role;
select is((select (public.activity_detail((select id from fx where k = 'a1')) -> 'stats' ->> 'credited')::bigint), 40000::bigint,
  'the activity shows the credited amount');
select is((select a ->> 'paid_since' || '/' || (a ->> 'credited') || '/' || (a ->> 'credited_receipts') || '/' || (a ->> 'participants')
             from jsonb_array_elements(public.student_recovery((select id from fx where k = 'st3')) -> 'activities') a),
  '60000/40000/1/2', 'the student profile shows what was paid since the activity started and what was counted for it');
select is((select a ->> 'paid_since' from jsonb_array_elements(public.student_recovery((select id from fx where k = 'st4')) -> 'activities') a),
  '0', 'a payment before the activity started does not count');
select is((select a ->> 'verdict' from jsonb_array_elements(public.activities_overview() -> 'activities') a where a ->> 'id' = (select id::text from fx where k = 'a1')),
  'good', 'one of the two students who owe was won over by the activity: working well');

-- the recovery dashboard ----------------------------------------------------------------
select is((select (m -> 'by_source' -> 'calls' ->> 'amount')::bigint + (m -> 'by_source' -> 'activities' ->> 'amount')::bigint
                  + (m -> 'by_source' -> 'direct' ->> 'amount')::bigint - (m ->> 'received')::bigint
             from (select public.recovery_dashboard(public.fees_today() - 29, public.fees_today()) -> 'money' as m) x), 0::bigint,
  'money from calls, activities and families on their own adds up to the money received');
select throws_ok($$ select public.recovery_dashboard(public.fees_today(), public.fees_today() - 1) $$, 'P0001', 'Choose a valid period',
  'a period that ends before it starts is refused');

-- merging two profiles of one family -------------------------------------------------------
select is(public.merge_parents((select id from fx where k = 'pD'), (select id from fx where k = 'pB')), 1, 'merge moves the children');
select is((select count(*)::int from public.parent_calls where parent_id = (select id from fx where k = 'pD')), 0, 'and the calls');
insert into public.students (admission_no, full_name, phone) values ('PGTAP4-7', 'Gita Four', '9000044444');
select is((select parent_id from public.students where admission_no = 'PGTAP4-7'), (select id from fx where k = 'pB'),
  'a new admission with the merged number joins the family (alternate phone)');

select * from finish();
rollback;
