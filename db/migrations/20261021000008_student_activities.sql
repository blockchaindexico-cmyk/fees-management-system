-- =============================================================================
-- Student profile: recovery activities in detail
--
-- student_recovery() now also gives, for each activity the student takes part in: what the student paid
-- since it started (to its end, or today), the receipts counted for it, the target, how many students take
-- part and who recorded the response last. Activities for one student are created from the student's profile
-- (a campaign of kind 'activity' with that student as its only participant).
-- =============================================================================

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

  -- activities with what the student paid since each started (to its end, or today) and what was counted for it
  with pay as (
    select p.id, p.paid_on, p.amount
      from public.payments p
     where p.student_id = p_student and p.amount > 0
       and not exists (select 1 from public.payments r where r.reverses_payment_id = p.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'participant_id', rp.id, 'campaign_id', c.id, 'name', c.name, 'description', c.description, 'status', c.status,
           'start_date', c.start_date, 'end_date', c.end_date, 'target_amount', c.target_amount,
           'participants', (select count(*) from public.recovery_participants x where x.campaign_id = c.id),
           'added_on', rp.added_on, 'response', rp.response, 'note', rp.note, 'updated_at', rp.updated_at,
           'updated_by_name', (select coalesce(nullif(pr.full_name, ''), pr.email) from public.profiles pr where pr.id = rp.updated_by),
           'paid_during', coalesce((select sum(y.amount) from pay y
                                     where y.paid_on between c.start_date and least(coalesce(c.end_date, v_today), v_today)), 0),
           'credited', coalesce((select sum(y.amount) from pay y join public.recovery_credits rc on rc.payment_id = y.id
                                  where rc.participant_id = rp.id), 0),
           'credited_receipts', (select count(*) from pay y join public.recovery_credits rc on rc.payment_id = y.id
                                  where rc.participant_id = rp.id)
         ) order by (c.status = 'active') desc, c.start_date desc, c.created_at desc), '[]'::jsonb)
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
    'activities', v_acts,
    'today', v_today
  );
end $$;
