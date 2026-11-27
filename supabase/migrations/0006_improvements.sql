-- =====================================================================
-- Pontual — improvements package
--   1. Schedule conflicts per veterinarian ("no preference" still takes the
--      whole slot). Concurrent bookings of a slot are serialized.
--   2. Reminders: mark which appointments already got the WhatsApp reminder.
--   3. LGPD: acceptance of terms/privacy recorded per user and version;
--      the platform owner can read the access log (platform_audit).
-- =====================================================================

-- ---------------------------------------------------------------- 1. per-vet slots
drop index if exists public.appointments_slot_uq;
create unique index if not exists appointments_slot_vet_uq
  on public.appointments (clinic_id, starts_on, starts_at, vet_id) where status = 'agendado' and vet_id is not null;
create unique index if not exists appointments_slot_novet_uq
  on public.appointments (clinic_id, starts_on, starts_at) where status = 'agendado' and vet_id is null;

-- Transaction-level lock on one slot, so two people booking it at once are handled in order.
create or replace function vc_private.lock_slot(p_clinic uuid, p_date date, p_time time) returns void
language sql as $$
  select pg_advisory_xact_lock(hashtextextended(p_clinic::text || '|' || p_date::text || '|' || p_time::text, 0))
$$;

-- Who is already booked in this slot for this vet. A booking without vet blocks
-- everyone, and a request without vet is blocked by anyone.
create or replace function vc_private.slot_conflict(p_clinic uuid, p_date date, p_time time, p_vet uuid, p_exclude uuid)
returns table (animal text, tutor text, vet text)
language sql stable as $$
  select an.name, t.name, v.name
    from public.appointments a
    join public.animals an on an.id = a.animal_id
    join public.tutors t on t.id = a.tutor_id
    left join public.members v on v.id = a.vet_id
   where a.clinic_id = p_clinic and a.starts_on = p_date and a.starts_at = p_time and a.status = 'agendado'
     and (p_exclude is null or a.id <> p_exclude)
     and (p_vet is null or a.vet_id is null or a.vet_id = p_vet)
   limit 1
$$;

-- ---------------------------------------------------------------- 2. reminders (column first: functions below use it)
alter table public.appointments add column if not exists reminder_sent_at timestamptz null;

create or replace function vc_private.appt_json(p_id uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', a.id, 'number', a.number,
    'date', a.starts_on, 'time', vc_private.hm(a.starts_at),
    'status', a.status, 'service_type', a.service_type,
    'plan', hp.code, 'plan_name', hp.name,
    'reason', a.reason, 'notes', a.notes,
    'vet_id', a.vet_id, 'vet_name', v.name,
    'tutor', jsonb_build_object('id', t.id, 'name', t.name, 'phone', t.phone),
    'animal', jsonb_build_object('id', an.id, 'name', an.name, 'species', an.species, 'breed', an.breed,
                                 'sex', an.sex, 'age_value', an.age_value, 'age_unit', an.age_unit),
    'created_at', a.created_at, 'updated_at', a.updated_at,
    'created_by_name', cb.name,
    'reminder_sent_at', a.reminder_sent_at
  )
  from public.appointments a
  join public.tutors t on t.id = a.tutor_id
  join public.animals an on an.id = a.animal_id
  left join public.health_plans hp on hp.id = a.health_plan_id
  left join public.members v on v.id = a.vet_id
  left join public.members cb on cb.id = a.created_by
  where a.id = p_id
$$;

create or replace function public.save_appointment(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.members := vc_private.me('agenda.write');
  c public.clinics;
  cur public.appointments;
  f jsonb := '{}';
  now_local timestamp;
  v_tutor_name text := trim(coalesce(p->>'tutor_name', ''));
  v_phone text := trim(coalesce(p->>'tutor_phone', ''));
  v_digits text := vc_private.digits(p->>'tutor_phone');
  v_animal_name text := trim(coalesce(p->>'animal_name', ''));
  v_species text := coalesce(nullif(p->>'species', ''), 'cao');
  v_sex text := nullif(p->>'sex', '');
  v_breed text := nullif(trim(coalesce(p->>'breed', '')), '');
  v_age int;
  v_age_unit text := case when p->>'age_unit' = 'meses' then 'meses' else 'anos' end;
  v_date date;
  v_time time;
  v_service text := coalesce(p->>'service_type', '');
  v_plan public.health_plans;
  v_vet uuid := nullif(p->>'vet_id', '')::uuid;
  v_reason text := nullif(trim(coalesce(p->>'reason', '')), '');
  v_notes text := nullif(trim(coalesce(p->>'notes', '')), '');
  v_tutor uuid;
  v_animal uuid;
  v_id uuid;
  changed boolean := true;
  busy record;
begin
  select * into c from public.clinics where id = m.clinic_id;
  now_local := now() at time zone c.timezone;

  if p_id is not null then
    select * into cur from public.appointments where id = p_id and clinic_id = m.clinic_id for update;
    if cur.id is null then perform vc_private.fail('VC404', 'Agendamento não encontrado.'); end if;
  end if;

  -- ---- field validation
  if length(v_tutor_name) < 3 then f := f || '{"tutor_name": "Informe o nome completo do tutor."}'; end if;
  if length(v_digits) not between 10 and 11 then f := f || '{"tutor_phone": "Informe um telefone com DDD."}'; end if;
  if length(v_animal_name) < 2 then f := f || '{"animal_name": "Informe o nome do animal."}'; end if;
  if v_species not in ('cao', 'gato', 'outro') then f := f || '{"species": "Espécie inválida."}'; end if;
  if v_sex is not null and v_sex not in ('macho', 'femea') then f := f || '{"sex": "Sexo inválido."}'; end if;
  begin
    v_age := nullif(p->>'age_value', '')::int;
    if v_age is not null and v_age not between 0 and 40 then f := f || '{"age_value": "Idade inválida."}'; end if;
  exception when others then f := f || '{"age_value": "Idade inválida."}';
  end;
  begin v_date := (p->>'date')::date;
  exception when others then v_date := null; end;
  if v_date is null then f := f || '{"date": "Escolha a data."}'; end if;
  begin v_time := (p->>'time')::time;
  exception when others then v_time := null; end;
  if v_time is null then f := f || '{"time": "Escolha um horário."}'; end if;
  if v_service not in ('particular', 'plano') then f := f || '{"service_type": "Escolha particular ou plano."}'; end if;

  -- ---- business rules
  if cur.id is not null then changed := (v_date, v_time) is distinct from (cur.starts_on, cur.starts_at); end if;
  if v_date is not null and v_time is not null and changed then
    -- the "date in the past" rule only applies when date/time change
    if v_date < now_local::date then f := f || '{"date": "A data não pode estar no passado."}';
    elsif v_date = now_local::date and v_time < now_local::time then f := f || '{"time": "Este horário já passou."}';
    end if;
  end if;
  if v_time is not null and not (f ? 'time')
     and not exists (select 1 from vc_private.slot_grid(c.id) g where g = v_time) then
    f := f || jsonb_build_object('time', format('Atendimentos entre %s e %s, a cada %s min.',
            vc_private.hm(c.open_time), vc_private.hm(c.close_time), c.slot_minutes));
  end if;
  if v_service = 'plano' then
    select * into v_plan from public.health_plans
     where clinic_id = c.id and code = upper(coalesce(p->>'plan', '')) and active;
    if v_plan.id is null then f := f || '{"plan": "Escolha um plano atendido pela clínica."}';
    elsif v_plan.species is not null and v_plan.species <> v_species then
      f := f || jsonb_build_object('plan', format('%s é exclusivo para %s.', v_plan.name,
              case v_plan.species when 'cao' then 'cães' when 'gato' then 'gatos' else 'outras espécies' end));
    end if;
  end if;
  if v_vet is not null and not exists (select 1 from public.members
       where id = v_vet and clinic_id = c.id and role = 'veterinario' and active) then
    f := f || '{"vet_id": "Veterinário não encontrado ou inativo."}';
  end if;
  if f <> '{}' then perform vc_private.fail('VC422', 'Confira os campos destacados.', f); end if;

  if coalesce(cur.status, 'agendado') = 'agendado' then
    -- serialize bookings of the same slot, then check per vet (no vet = whole slot)
    perform vc_private.lock_slot(c.id, v_date, v_time);
    select * into busy from vc_private.slot_conflict(c.id, v_date, v_time, v_vet, p_id);
    if busy.animal is not null then
      perform vc_private.fail('VC409', format('Horário já ocupado por %s (tutor %s)%s.', busy.animal, busy.tutor, coalesce(' com ' || busy.vet, '')),
                              '{"time": "Escolha outro horário."}');
    end if;
  end if;

  -- ---- patient record
  insert into public.tutors (clinic_id, name, phone, phone_digits)
  values (c.id, v_tutor_name, vc_private.format_phone(v_phone), v_digits)
  on conflict (clinic_id, phone_digits)
  do update set name = excluded.name, phone = excluded.phone, updated_at = now()
  returning id into v_tutor;

  insert into public.animals (clinic_id, tutor_id, name, species, breed, sex, age_value, age_unit)
  values (c.id, v_tutor, v_animal_name, v_species, v_breed, v_sex, v_age, v_age_unit)
  on conflict (tutor_id, lower(name))
  do update set name = excluded.name, species = excluded.species,
                breed = coalesce(excluded.breed, animals.breed), sex = coalesce(excluded.sex, animals.sex),
                age_value = coalesce(excluded.age_value, animals.age_value), age_unit = excluded.age_unit,
                updated_at = now()
  returning id into v_animal;

  begin
    if cur.id is null then
      insert into public.appointments (clinic_id, tutor_id, animal_id, vet_id, starts_on, starts_at, service_type,
                                       health_plan_id, reason, notes, created_by, updated_by)
      values (c.id, v_tutor, v_animal, v_vet, v_date, v_time, v_service,
              case when v_service = 'plano' then v_plan.id end, v_reason, v_notes, m.id, m.id)
      returning id into v_id;
      perform vc_private.audit(m, 'appointment', v_id, 'create', p);
    else
      update public.appointments
         set tutor_id = v_tutor, animal_id = v_animal, vet_id = v_vet, starts_on = v_date, starts_at = v_time,
             service_type = v_service, health_plan_id = case when v_service = 'plano' then v_plan.id end,
             reason = v_reason, notes = v_notes, updated_by = m.id, updated_at = now(),
             reminder_sent_at = case when changed then null else reminder_sent_at end
       where id = cur.id;
      v_id := cur.id;
      perform vc_private.audit(m, 'appointment', v_id, 'update', jsonb_build_object('before', vc_private.appt_json(cur.id), 'payload', p));
    end if;
  exception when unique_violation then
    perform vc_private.fail('VC409', 'Este horário acabou de ser ocupado. Escolha outro.', '{"time": "Escolha outro horário."}');
  end;
  return vc_private.appt_json(v_id);
end $$;

create or replace function public.set_appointment_status(p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.members := vc_private.me('agenda.read');
  cur public.appointments;
begin
  if p_status not in ('agendado', 'concluido', 'cancelado', 'faltou') then
    perform vc_private.fail('VC422', 'Status inválido.', '{"status": "Status inválido."}');
  end if;
  if not vc_private.has_perm(m.role, case when p_status = 'concluido' then 'agenda.conclude' else 'agenda.cancel' end) then
    perform vc_private.fail('VC403', 'Seu perfil não tem permissão para esta ação.');
  end if;
  select * into cur from public.appointments where id = p_id and clinic_id = m.clinic_id for update;
  if cur.id is null then perform vc_private.fail('VC404', 'Agendamento não encontrado.'); end if;
  if cur.status = p_status then return vc_private.appt_json(p_id); end if;
  if (cur.status = 'agendado') = (p_status = 'agendado') then
    perform vc_private.fail('VC409', 'Reabra o agendamento antes de mudar para outro status.');
  end if;
  if p_status = 'agendado' then
    perform vc_private.lock_slot(cur.clinic_id, cur.starts_on, cur.starts_at);
    if exists (select 1 from vc_private.slot_conflict(cur.clinic_id, cur.starts_on, cur.starts_at, cur.vet_id, cur.id) x where x.animal is not null) then
      perform vc_private.fail('VC409', 'O horário deste agendamento já foi ocupado por outro. Edite a data/hora antes de reabrir.');
    end if;
  end if;
  begin
    update public.appointments set status = p_status, updated_by = m.id, updated_at = now() where id = p_id;
  exception when unique_violation then
    perform vc_private.fail('VC409', 'O horário deste agendamento já foi ocupado por outro. Edite a data/hora antes de reabrir.');
  end;
  perform vc_private.audit(m, 'appointment', p_id, 'status', jsonb_build_object('from', cur.status, 'to', p_status));
  return vc_private.appt_json(p_id);
end $$;

drop function if exists public.get_slots(date, uuid);
create or replace function public.get_slots(p_date date, p_exclude uuid default null, p_vet uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m public.members := vc_private.me('agenda.read');
  now_local timestamp := vc_private.clinic_now(m.clinic_id);
begin
  return jsonb_build_object(
    'date', p_date,
    'vet_id', p_vet,
    'past_day', p_date < now_local::date,
    'slots', coalesce((
      select jsonb_agg(jsonb_build_object(
               'time', vc_private.hm(g.t),
               'available', b.id is null and not (p_date < now_local::date or (p_date = now_local::date and g.t < now_local::time)),
               'reason', case when b.id is not null then 'ocupado'
                              when p_date < now_local::date or (p_date = now_local::date and g.t < now_local::time) then 'passado' end,
               'animal_name', b.animal_name,
               'appointment_id', b.id
             ) order by g.t)
        from vc_private.slot_grid(m.clinic_id) as g(t)
        left join lateral (
          select a.id, an.name as animal_name
            from public.appointments a join public.animals an on an.id = a.animal_id
           where a.clinic_id = m.clinic_id and a.starts_on = p_date and a.starts_at = g.t
             and a.status = 'agendado' and (p_exclude is null or a.id <> p_exclude)
             and (p_vet is null or a.vet_id is null or a.vet_id = p_vet)
           limit 1
        ) b on true
    ), '[]'::jsonb)
  );
end $$;

create or replace function public.mark_reminder_sent(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.members := vc_private.me('agenda.write');
begin
  update public.appointments set reminder_sent_at = now() where id = p_id and clinic_id = m.clinic_id and status = 'agendado';
  if not found then perform vc_private.fail('VC404', 'Agendamento não encontrado.'); end if;
  perform vc_private.audit(m, 'appointment', p_id, 'reminder', null);
  return vc_private.appt_json(p_id);
end $$;

-- ---------------------------------------------------------------- 3. LGPD
create table if not exists public.user_consents (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  document     text        not null check (document in ('terms', 'privacy')),
  version      text        not null,
  accepted_at  timestamptz not null default now(),
  primary key (user_id, document, version)
);
alter table public.user_consents enable row level security;
revoke all on public.user_consents from anon, authenticated;

create or replace function public.accept_terms(p_version text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then perform vc_private.fail('VC401', 'Faça login para continuar.'); end if;
  if coalesce(p_version, '') !~ '^[0-9]{4}-[0-9]{2}$' then
    perform vc_private.fail('VC422', 'Versão inválida.', '{"version": "Versão inválida."}');
  end if;
  insert into public.user_consents (user_id, document, version) values
    (auth.uid(), 'terms', p_version), (auth.uid(), 'privacy', p_version)
  on conflict do nothing;
  return public.app_bootstrap();
end $$;

create or replace function public.app_bootstrap() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m public.members;
  c public.clinics;
  u record;
  req public.access_requests;
  now_local timestamp;
  is_owner boolean := vc_private.is_platform_admin();
  terms text := (select max(version) from public.user_consents where user_id = auth.uid() and document = 'terms');
begin
  if auth.uid() is null then perform vc_private.fail('VC401', 'Faça login para continuar.'); end if;
  select id, email into u from auth.users where id = auth.uid();
  select * into m from public.members where user_id = auth.uid();
  if m.id is not null then select * into c from public.clinics where id = m.clinic_id; end if;

  if m.id is null or (not c.active and not is_owner) or (not m.active and not is_owner) then
    select * into req from public.access_requests where user_id = auth.uid();
    return jsonb_build_object(
      'user', jsonb_build_object('id', u.id, 'email', u.email),
      'member', null,
      'platform_admin', is_owner,
      'terms_version', terms,
      'blocked', case when m.id is null then null
                      when not c.active then 'company_suspended'
                      else 'member_disabled' end,
      'access_request', case when req.id is null then null else jsonb_build_object(
        'status', req.status, 'name', req.name, 'phone', req.phone, 'company_hint', req.company_hint,
        'reject_reason', req.reject_reason, 'created_at', req.created_at) end,
      'pending_requests', case when is_owner then (select count(*) from public.access_requests where status = 'pending') end
    );
  end if;

  now_local := now() at time zone c.timezone;
  return jsonb_build_object(
    'user', jsonb_build_object('id', u.id, 'email', u.email),
    'member', jsonb_build_object('id', m.id, 'name', m.name, 'email', m.email, 'role', m.role),
    'platform_admin', is_owner,
    'terms_version', terms,
    'pending_requests', case when is_owner then (select count(*) from public.access_requests where status = 'pending') end,
    'permissions', vc_private.permissions(m.role),
    'clinic', jsonb_build_object('id', c.id, 'name', c.name, 'timezone', c.timezone, 'phone', c.phone,
      'open_time', vc_private.hm(c.open_time), 'close_time', vc_private.hm(c.close_time), 'slot_minutes', c.slot_minutes),
    'today', now_local::date,
    'now', to_char(now_local, 'HH24:MI'),
    'plans', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'species', species,
                         'description', description) order by name)
                         from public.health_plans where clinic_id = c.id and active), '[]'::jsonb),
    'vets', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
                        from public.members where clinic_id = c.id and role = 'veterinario' and active), '[]'::jsonb)
  );
end $$;

create or replace function public.platform_list_audit(p_limit int default 100, p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform vc_private.require_platform_admin();
  return coalesce((select jsonb_agg(row order by (row->>'id')::bigint desc) from (
    select jsonb_build_object(
      'id', l.id, 'created_at', l.created_at, 'action', l.action, 'entity', l.entity, 'entity_id', l.entity_id,
      'actor', u.email, 'data', l.data,
      'company', coalesce(
        (select c.name from public.clinics c where l.entity = 'company' and c.id = l.entity_id),
        (select c.name from public.clinics c where c.id = nullif(l.data->>'clinic_id', '')::uuid)))
      as row
      from public.platform_audit l left join auth.users u on u.id = l.actor_id
     where p_before is null or l.id < p_before
     order by l.id desc
     limit least(greatest(coalesce(p_limit, 100), 1), 500)) s), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on all functions in schema vc_private from public, anon, authenticated;
revoke execute on function
  public.get_slots(date, uuid, uuid), public.mark_reminder_sent(uuid), public.accept_terms(text), public.platform_list_audit(int, bigint)
from public, anon;
grant execute on function
  public.get_slots(date, uuid, uuid), public.mark_reminder_sent(uuid), public.accept_terms(text), public.platform_list_audit(int, bigint)
to authenticated;
