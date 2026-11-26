-- =====================================================================
-- VetCare — API (functions called by the app through supabase.rpc)
--
-- Errors are raised with a custom SQLSTATE and a JSON detail:
--   VC401 not signed in / no clinic      VC403 role not allowed
--   VC404 not found                      VC409 conflict (slot taken…)
--   VC422 validation; DETAIL = {"field": "message", ...}
-- =====================================================================

-- ================================================================ helpers

create or replace function vc_private.fail(p_code text, p_message text, p_fields jsonb default '{}'::jsonb)
returns void language plpgsql as $$
begin
  raise exception using errcode = p_code, message = p_message, detail = coalesce(p_fields, '{}'::jsonb)::text;
end $$;

create or replace function vc_private.norm(p text) returns text
language sql immutable as $$
  select lower(translate(coalesce(p, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'))
$$;

create or replace function vc_private.digits(p text) returns text
language sql immutable as $$
  select regexp_replace(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '^55(?=\d{10,11}$)', '')
$$;

create or replace function vc_private.format_phone(p text) returns text
language plpgsql immutable as $$
declare d text := vc_private.digits(p);
begin
  if length(d) = 11 then return format('(%s) %s-%s', substr(d, 1, 2), substr(d, 3, 5), substr(d, 8)); end if;
  if length(d) = 10 then return format('(%s) %s-%s', substr(d, 1, 2), substr(d, 3, 4), substr(d, 7)); end if;
  return trim(p);
end $$;

create or replace function vc_private.has_perm(p_role text, p_perm text) returns boolean
language sql immutable as $$
  -- Permission matrix: the only place that decides who can do what.
  select case p_perm
    when 'agenda.read'     then p_role in ('admin', 'recepcao', 'veterinario')
    when 'agenda.write'    then p_role in ('admin', 'recepcao')
    when 'agenda.conclude' then p_role in ('admin', 'recepcao', 'veterinario')
    when 'agenda.cancel'   then p_role in ('admin', 'recepcao')
    when 'agenda.notes'    then p_role in ('admin', 'recepcao', 'veterinario')
    when 'agenda.delete'   then p_role = 'admin'
    when 'patients.read'   then p_role in ('admin', 'recepcao', 'veterinario')
    when 'patients.write'  then p_role in ('admin', 'recepcao')
    when 'reports.read'    then p_role in ('admin', 'recepcao', 'veterinario')
    when 'settings.manage' then p_role = 'admin'
    when 'team.manage'     then p_role = 'admin'
    else false
  end
$$;

create or replace function vc_private.permissions(p_role text) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(p), '[]'::jsonb) from unnest(array[
    'agenda.read', 'agenda.write', 'agenda.conclude', 'agenda.cancel', 'agenda.notes', 'agenda.delete',
    'patients.read', 'patients.write', 'reports.read', 'settings.manage', 'team.manage'
  ]) as p where vc_private.has_perm(p_role, p)
$$;

-- Current member (active) of the signed-in user, optionally requiring a permission.
create or replace function vc_private.me(p_perm text default null) returns public.members
language plpgsql stable security definer set search_path = public as $$
declare m public.members;
begin
  if auth.uid() is null then perform vc_private.fail('VC401', 'Faça login para continuar.'); end if;
  select * into m from public.members where user_id = auth.uid();
  if m.id is null then perform vc_private.fail('VC401', 'Seu usuário ainda não está ligado a uma clínica.'); end if;
  if not m.active then perform vc_private.fail('VC401', 'Seu acesso foi desativado. Fale com o administrador.'); end if;
  if p_perm is not null and not vc_private.has_perm(m.role, p_perm) then
    perform vc_private.fail('VC403', 'Seu perfil não tem permissão para esta ação.');
  end if;
  return m;
end $$;

create or replace function vc_private.clinic_now(p_clinic uuid) returns timestamp
language sql stable as $$
  select now() at time zone c.timezone from public.clinics c where c.id = p_clinic
$$;

create or replace function vc_private.audit(p_m public.members, p_entity text, p_id uuid, p_action text, p_data jsonb default null)
returns void language sql as $$
  insert into public.audit_log (clinic_id, member_id, entity, entity_id, action, data)
  values (p_m.clinic_id, p_m.id, p_entity, p_id, p_action, p_data)
$$;

create or replace function vc_private.hm(p time) returns text language sql immutable as $$ select to_char(p, 'HH24:MI') $$;

-- Appointment as JSON (the shape the app uses everywhere).
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
    'created_by_name', cb.name
  )
  from public.appointments a
  join public.tutors t on t.id = a.tutor_id
  join public.animals an on an.id = a.animal_id
  left join public.health_plans hp on hp.id = a.health_plan_id
  left join public.members v on v.id = a.vet_id
  left join public.members cb on cb.id = a.created_by
  where a.id = p_id
$$;

create or replace function vc_private.slot_grid(p_clinic uuid) returns setof time
language sql stable as $$
  select (c.open_time + make_interval(mins => g * c.slot_minutes))::time
    from public.clinics c,
         generate_series(0, (extract(epoch from (c.close_time - c.open_time)) / 60 / c.slot_minutes)::int) g
   where c.id = p_clinic
$$;

-- ================================================================ new users / onboarding

-- When someone signs up with an e-mail that has an open invite, link them to the clinic.
create or replace function vc_private.on_auth_user_created() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv public.invites;
begin
  select * into inv from public.invites
   where lower(email) = lower(new.email) and accepted_at is null
   order by created_at desc limit 1;
  if inv.id is not null then
    insert into public.members (clinic_id, user_id, name, email, role)
    values (inv.clinic_id, new.id, inv.name, lower(new.email), inv.role)
    on conflict (user_id) do nothing;
    update public.invites set accepted_at = now() where id = inv.id;
  end if;
  return new;
end $$;

drop trigger if exists vc_on_auth_user_created on auth.users;
create trigger vc_on_auth_user_created after insert on auth.users
  for each row execute function vc_private.on_auth_user_created();

-- Everything the app needs right after login.
create or replace function public.app_bootstrap() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m public.members;
  c public.clinics;
  u record;
  now_local timestamp;
begin
  if auth.uid() is null then perform vc_private.fail('VC401', 'Faça login para continuar.'); end if;
  select id, email into u from auth.users where id = auth.uid();
  select * into m from public.members where user_id = auth.uid();
  if m.id is null then
    return jsonb_build_object('user', jsonb_build_object('id', u.id, 'email', u.email), 'member', null);
  end if;
  if not m.active then perform vc_private.fail('VC401', 'Seu acesso foi desativado. Fale com o administrador.'); end if;
  select * into c from public.clinics where id = m.clinic_id;
  now_local := now() at time zone c.timezone;
  return jsonb_build_object(
    'user', jsonb_build_object('id', u.id, 'email', u.email),
    'member', jsonb_build_object('id', m.id, 'name', m.name, 'email', m.email, 'role', m.role),
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

-- First access: create a clinic and become its administrator.
create or replace function public.create_clinic(p_clinic_name text, p_your_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c_id uuid;
  m_id uuid;
  u_email text;
  f jsonb := '{}';
begin
  if auth.uid() is null then perform vc_private.fail('VC401', 'Faça login para continuar.'); end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    perform vc_private.fail('VC409', 'Seu usuário já pertence a uma clínica.');
  end if;
  if length(trim(coalesce(p_clinic_name, ''))) < 2 then f := f || '{"clinic_name": "Informe o nome da clínica."}'; end if;
  if length(trim(coalesce(p_your_name, ''))) < 3 then f := f || '{"your_name": "Informe seu nome completo."}'; end if;
  if f <> '{}' then perform vc_private.fail('VC422', 'Confira os campos destacados.', f); end if;

  select email into u_email from auth.users where id = auth.uid();
  insert into public.clinics (name) values (trim(p_clinic_name)) returning id into c_id;
  insert into public.members (clinic_id, user_id, name, email, role)
  values (c_id, auth.uid(), trim(p_your_name), lower(u_email), 'admin') returning id into m_id;
  insert into public.health_plans (clinic_id, code, name, species, description) values
    (c_id, 'PETLOVE', 'Petlove', null, 'Cobertura geral para cães e gatos'),
    (c_id, 'PETLIFE', 'Petlife', null, 'Cobertura geral para cães e gatos'),
    (c_id, 'DOGLIFE', 'Doglife', 'cao', 'Exclusivo para cães'),
    (c_id, 'CATLIFE', 'Catlife', 'gato', 'Exclusivo para gatos');
  return public.app_bootstrap();
end $$;

-- ================================================================ agenda

create or replace function public.list_appointments(
  p_from date default null, p_to date default null, p_date date default null,
  p_status text default null, p_plan text default null, p_q text default null,
  p_vet uuid default null, p_order text default 'asc', p_limit int default 50, p_cursor text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m public.members := vc_private.me('agenda.read');
  lim int := least(greatest(coalesce(p_limit, 50), 1), 500);
  desc_order boolean := lower(coalesce(p_order, 'asc')) = 'desc';
  c_date date; c_time time; c_id uuid;
  q text := vc_private.norm(trim(coalesce(p_q, '')));
  qd text := vc_private.digits(p_q);
  ids uuid[];
  has_more boolean;
  last_id uuid;
begin
  if p_cursor is not null then
    begin
      select split_part(x, '|', 1)::date, split_part(x, '|', 2)::time, split_part(x, '|', 3)::uuid
        into c_date, c_time, c_id
        from (select convert_from(decode(p_cursor, 'base64'), 'utf8') as x) s;
    exception when others then
      perform vc_private.fail('VC422', 'Cursor inválido.', '{"cursor": "Cursor inválido."}');
    end;
  end if;

  select array_agg(id) into ids from (
    select a.id
      from public.appointments a
      join public.tutors t on t.id = a.tutor_id
      join public.animals an on an.id = a.animal_id
      left join public.health_plans hp on hp.id = a.health_plan_id
     where a.clinic_id = m.clinic_id
       and (p_date is null or a.starts_on = p_date)
       and (p_from is null or a.starts_on >= p_from)
       and (p_to is null or a.starts_on <= p_to)
       and (p_status is null or p_status = '' or a.status = p_status)
       and (p_plan is null or p_plan = '' or hp.code = upper(p_plan))
       and (p_vet is null or a.vet_id = p_vet)
       and (q = '' or vc_private.norm(an.name) like '%' || q || '%' or vc_private.norm(t.name) like '%' || q || '%'
            or (length(qd) >= 3 and t.phone_digits like '%' || qd || '%'))
       and (p_cursor is null or
            (not desc_order and (a.starts_on, a.starts_at, a.id) > (c_date, c_time, c_id)) or
            (desc_order and (a.starts_on, a.starts_at, a.id) < (c_date, c_time, c_id)))
     order by
       case when not desc_order then a.starts_on end asc,
       case when not desc_order then a.starts_at end asc,
       case when not desc_order then a.id end asc,
       case when desc_order then a.starts_on end desc,
       case when desc_order then a.starts_at end desc,
       case when desc_order then a.id end desc
     limit lim + 1
  ) s;

  ids := coalesce(ids, '{}');
  has_more := cardinality(ids) > lim;
  if has_more then ids := ids[1:lim]; end if;
  last_id := ids[cardinality(ids)];

  return jsonb_build_object(
    'data', coalesce((select jsonb_agg(vc_private.appt_json(x.id) order by x.ord)
                        from unnest(ids) with ordinality as x(id, ord)), '[]'::jsonb),
    'next_cursor', case when has_more then
      (select encode(convert_to(a.starts_on::text || '|' || a.starts_at::text || '|' || a.id::text, 'utf8'), 'base64')
         from public.appointments a where a.id = last_id) end
  );
end $$;

create or replace function public.get_appointment(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.members := vc_private.me('agenda.read');
begin
  if not exists (select 1 from public.appointments where id = p_id and clinic_id = m.clinic_id) then
    perform vc_private.fail('VC404', 'Agendamento não encontrado.');
  end if;
  return vc_private.appt_json(p_id);
end $$;

-- Slots of a day, computed in the clinic's time zone. The response echoes the date,
-- so the app can discard late responses for another date.
create or replace function public.get_slots(p_date date, p_exclude uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m public.members := vc_private.me('agenda.read');
  now_local timestamp := vc_private.clinic_now(m.clinic_id);
begin
  return jsonb_build_object(
    'date', p_date,
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
           limit 1
        ) b on true
    ), '[]'::jsonb)
  );
end $$;

-- Create (p_id null) or update an appointment. Tutor and animal are created or
-- updated from the same payload, so the patient record builds itself.
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
    select an.name as animal, t.name as tutor into busy
      from public.appointments a join public.animals an on an.id = a.animal_id join public.tutors t on t.id = a.tutor_id
     where a.clinic_id = c.id and a.starts_on = v_date and a.starts_at = v_time and a.status = 'agendado'
       and (p_id is null or a.id <> p_id);
    if found then
      perform vc_private.fail('VC409', format('Horário já ocupado por %s (tutor %s).', busy.animal, busy.tutor),
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
             reason = v_reason, notes = v_notes, updated_by = m.id, updated_at = now()
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
  begin
    update public.appointments set status = p_status, updated_by = m.id, updated_at = now() where id = p_id;
  exception when unique_violation then
    perform vc_private.fail('VC409', 'O horário deste agendamento já foi ocupado por outro. Edite a data/hora antes de reabrir.');
  end;
  perform vc_private.audit(m, 'appointment', p_id, 'status', jsonb_build_object('from', cur.status, 'to', p_status));
  return vc_private.appt_json(p_id);
end $$;

create or replace function public.set_appointment_notes(p_id uuid, p_notes text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.members := vc_private.me('agenda.notes');
begin
  update public.appointments set notes = nullif(trim(coalesce(p_notes, '')), ''), updated_by = m.id, updated_at = now()
   where id = p_id and clinic_id = m.clinic_id;
  if not found then perform vc_private.fail('VC404', 'Agendamento não encontrado.'); end if;
  perform vc_private.audit(m, 'appointment', p_id, 'notes', jsonb_build_object('notes', p_notes));
  return vc_private.appt_json(p_id);
end $$;

create or replace function public.delete_appointment(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.members := vc_private.me('agenda.delete');
  snapshot jsonb := vc_private.appt_json(p_id);
begin
  delete from public.appointments where id = p_id and clinic_id = m.clinic_id;
  if not found then perform vc_private.fail('VC404', 'Agendamento não encontrado.'); end if;
  perform vc_private.audit(m, 'appointment', p_id, 'delete', snapshot);
  return jsonb_build_object('deleted', true);
end $$;

-- ================================================================ dashboard

create or replace function public.dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m public.members := vc_private.me('reports.read');
  today date := vc_private.clinic_now(m.clinic_id)::date;
  month_start date := date_trunc('month', today)::date;
begin
  return jsonb_build_object(
    'today', today,
    'totals', (select jsonb_build_object(
        'today', count(*) filter (where starts_on = today and status in ('agendado', 'concluido')),
        'today_done', count(*) filter (where starts_on = today and status = 'concluido'),
        'upcoming', count(*) filter (where starts_on > today and status = 'agendado'),
        'month', count(*) filter (where starts_on between month_start and today and status = 'concluido'),
        'month_cancelled', count(*) filter (where starts_on between month_start and today and status in ('cancelado', 'faltou')),
        'month_noshow', count(*) filter (where starts_on between month_start and today and status = 'faltou'),
        'patients', (select count(*) from public.animals where clinic_id = m.clinic_id))
      from public.appointments where clinic_id = m.clinic_id),
    'by_plan', coalesce((select jsonb_agg(jsonb_build_object('plan', x.label, 'n', x.n) order by x.n desc, x.label)
       from (select coalesce(hp.name, 'Particular') as label, count(*) as n
               from public.appointments a left join public.health_plans hp on hp.id = a.health_plan_id
              where a.clinic_id = m.clinic_id and a.status <> 'cancelado'
                and a.starts_on between month_start and (month_start + interval '1 month - 1 day')::date
              group by 1) x), '[]'::jsonb),
    'next_days', (select jsonb_agg(jsonb_build_object('date', d::date, 'n',
          (select count(*) from public.appointments a
            where a.clinic_id = m.clinic_id and a.starts_on = d::date and a.status = 'agendado')) order by d)
       from generate_series(today, today + 6, interval '1 day') d)
  );
end $$;

-- ================================================================ patients

create or replace function public.search_patients(p_q text default '', p_limit int default 20) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m public.members := vc_private.me('patients.read');
  q text := vc_private.norm(trim(coalesce(p_q, '')));
  qd text := vc_private.digits(p_q);
begin
  return coalesce((
    select jsonb_agg(row order by row->>'name')
      from (
        select jsonb_build_object(
                 'id', t.id, 'name', t.name, 'phone', t.phone,
                 'animals', coalesce((select jsonb_agg(jsonb_build_object('id', an.id, 'name', an.name, 'species', an.species,
                                       'breed', an.breed, 'sex', an.sex, 'age_value', an.age_value, 'age_unit', an.age_unit) order by an.name)
                                      from public.animals an where an.tutor_id = t.id), '[]'::jsonb),
                 'last_visit', (select max(a.starts_on) from public.appointments a
                                 where a.tutor_id = t.id and a.status = 'concluido')
               ) as row
          from public.tutors t
         where t.clinic_id = m.clinic_id
           and (q = '' or vc_private.norm(t.name) like '%' || q || '%'
                or (length(qd) >= 3 and t.phone_digits like '%' || qd || '%')
                or exists (select 1 from public.animals an where an.tutor_id = t.id and vc_private.norm(an.name) like '%' || q || '%'))
         order by t.name
         limit least(greatest(coalesce(p_limit, 20), 1), 100)
      ) s
  ), '[]'::jsonb);
end $$;

create or replace function public.get_tutor(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m public.members := vc_private.me('patients.read');
  t public.tutors;
begin
  select * into t from public.tutors where id = p_id and clinic_id = m.clinic_id;
  if t.id is null then perform vc_private.fail('VC404', 'Tutor não encontrado.'); end if;
  return jsonb_build_object(
    'id', t.id, 'name', t.name, 'phone', t.phone, 'email', t.email, 'notes', t.notes, 'created_at', t.created_at,
    'animals', coalesce((select jsonb_agg(jsonb_build_object('id', an.id, 'name', an.name, 'species', an.species, 'breed', an.breed,
                  'sex', an.sex, 'age_value', an.age_value, 'age_unit', an.age_unit) order by an.name)
                from public.animals an where an.tutor_id = t.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(vc_private.appt_json(a.id) order by a.starts_on desc, a.starts_at desc)
                from (select id, starts_on, starts_at from public.appointments where tutor_id = t.id
                       order by starts_on desc, starts_at desc limit 100) a), '[]'::jsonb)
  );
end $$;

create or replace function public.update_tutor(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.members := vc_private.me('patients.write');
  f jsonb := '{}';
  d text := vc_private.digits(p->>'phone');
begin
  if length(trim(coalesce(p->>'name', ''))) < 3 then f := f || '{"name": "Informe o nome completo."}'; end if;
  if length(d) not between 10 and 11 then f := f || '{"phone": "Informe um telefone com DDD."}'; end if;
  if coalesce(p->>'email', '') <> '' and p->>'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then f := f || '{"email": "E-mail inválido."}'; end if;
  if f <> '{}' then perform vc_private.fail('VC422', 'Confira os campos destacados.', f); end if;
  begin
    update public.tutors set name = trim(p->>'name'), phone = vc_private.format_phone(p->>'phone'), phone_digits = d,
           email = nullif(trim(coalesce(p->>'email', '')), ''), notes = nullif(trim(coalesce(p->>'notes', '')), ''),
           updated_at = now()
     where id = p_id and clinic_id = m.clinic_id;
  exception when unique_violation then
    perform vc_private.fail('VC409', 'Já existe outro tutor com este telefone.', '{"phone": "Telefone já cadastrado."}');
  end;
  if not found then perform vc_private.fail('VC404', 'Tutor não encontrado.'); end if;
  perform vc_private.audit(m, 'tutor', p_id, 'update', p);
  return public.get_tutor(p_id);
end $$;

-- ================================================================ settings

create or replace function public.update_clinic(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.members := vc_private.me('settings.manage');
  f jsonb := '{}';
  v_open time; v_close time;
begin
  if length(trim(coalesce(p->>'name', ''))) < 2 then f := f || '{"name": "Informe o nome da clínica."}'; end if;
  if not exists (select 1 from pg_timezone_names where name = p->>'timezone') then f := f || '{"timezone": "Fuso horário inválido."}'; end if;
  begin v_open := (p->>'open_time')::time; v_close := (p->>'close_time')::time;
  exception when others then f := f || '{"open_time": "Horário inválido."}'; end;
  if v_open is not null and v_close is not null and v_open >= v_close then
    f := f || '{"close_time": "O último horário precisa ser depois da abertura."}';
  end if;
  if coalesce((p->>'slot_minutes')::int, 0) not between 5 and 240 then f := f || '{"slot_minutes": "Intervalo inválido."}'; end if;
  if f <> '{}' then perform vc_private.fail('VC422', 'Confira os campos destacados.', f); end if;
  update public.clinics set name = trim(p->>'name'), timezone = p->>'timezone', open_time = v_open, close_time = v_close,
         slot_minutes = (p->>'slot_minutes')::int, phone = nullif(trim(coalesce(p->>'phone', '')), '')
   where id = m.clinic_id;
  perform vc_private.audit(m, 'clinic', m.clinic_id, 'update', p);
  return public.app_bootstrap();
end $$;

create or replace function public.list_plans() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.members := vc_private.me('agenda.read');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', hp.id, 'code', hp.code, 'name', hp.name, 'species', hp.species,
            'description', hp.description, 'active', hp.active,
            'uses', (select count(*) from public.appointments a where a.health_plan_id = hp.id)) order by hp.active desc, hp.name)
     from public.health_plans hp where hp.clinic_id = m.clinic_id), '[]'::jsonb);
end $$;

create or replace function public.save_plan(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.members := vc_private.me('settings.manage');
  f jsonb := '{}';
  v_code text := upper(trim(coalesce(p->>'code', '')));
  v_species text := nullif(p->>'species', '');
begin
  if p_id is null and v_code !~ '^[A-Z0-9_-]{2,20}$' then f := f || '{"code": "Código: 2 a 20 letras ou números, sem espaços."}'; end if;
  if length(trim(coalesce(p->>'name', ''))) < 2 then f := f || '{"name": "Informe o nome do plano."}'; end if;
  if v_species is not null and v_species not in ('cao', 'gato', 'outro') then f := f || '{"species": "Espécie inválida."}'; end if;
  if f <> '{}' then perform vc_private.fail('VC422', 'Confira os campos destacados.', f); end if;
  if p_id is null then
    begin
      insert into public.health_plans (clinic_id, code, name, species, description)
      values (m.clinic_id, v_code, trim(p->>'name'), v_species, nullif(trim(coalesce(p->>'description', '')), ''))
      returning id into p_id;
    exception when unique_violation then
      perform vc_private.fail('VC409', 'Já existe um plano com esse código.', '{"code": "Código já usado."}');
    end;
  else
    update public.health_plans
       set name = trim(p->>'name'), species = v_species, description = nullif(trim(coalesce(p->>'description', '')), ''),
           active = coalesce((p->>'active')::boolean, active)
     where id = p_id and clinic_id = m.clinic_id;
    if not found then perform vc_private.fail('VC404', 'Plano não encontrado.'); end if;
  end if;
  perform vc_private.audit(m, 'plan', p_id, 'save', p);
  return public.list_plans();
end $$;

-- ================================================================ team

create or replace function public.list_team() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.members := vc_private.me('team.manage');
begin
  return jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'email', email, 'role', role,
                  'active', active, 'is_me', id = m.id, 'created_at', created_at) order by active desc, name)
                from public.members where clinic_id = m.clinic_id), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'email', email, 'role', role,
                  'created_at', created_at) order by created_at desc)
                from public.invites where clinic_id = m.clinic_id and accepted_at is null), '[]'::jsonb)
  );
end $$;

create or replace function public.invite_member(p_email text, p_name text, p_role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.members := vc_private.me('team.manage');
  f jsonb := '{}';
  v_email text := lower(trim(coalesce(p_email, '')));
  existing_user uuid;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then f := f || '{"email": "E-mail inválido."}'; end if;
  if length(trim(coalesce(p_name, ''))) < 3 then f := f || '{"name": "Informe o nome completo."}'; end if;
  if coalesce(p_role, '') not in ('admin', 'recepcao', 'veterinario') then f := f || '{"role": "Perfil inválido."}'; end if;
  if f <> '{}' then perform vc_private.fail('VC422', 'Confira os campos destacados.', f); end if;
  if exists (select 1 from public.members where lower(email) = v_email) then
    perform vc_private.fail('VC409', 'Este e-mail já tem acesso a uma clínica.', '{"email": "E-mail já cadastrado."}');
  end if;

  -- person already has an account (signed up before being invited): link right away
  select id into existing_user from auth.users where lower(email) = v_email;
  if existing_user is not null then
    insert into public.members (clinic_id, user_id, name, email, role) values (m.clinic_id, existing_user, trim(p_name), v_email, p_role);
  else
    begin
      insert into public.invites (clinic_id, email, name, role, created_by) values (m.clinic_id, v_email, trim(p_name), p_role, m.id);
    exception when unique_violation then
      perform vc_private.fail('VC409', 'Já existe um convite aberto para este e-mail.', '{"email": "Convite já enviado."}');
    end;
  end if;
  perform vc_private.audit(m, 'member', m.id, 'invite', jsonb_build_object('email', v_email, 'role', p_role));
  return public.list_team();
end $$;

create or replace function public.cancel_invite(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.members := vc_private.me('team.manage');
begin
  delete from public.invites where id = p_id and clinic_id = m.clinic_id and accepted_at is null;
  return public.list_team();
end $$;

create or replace function public.update_member(p_id uuid, p_role text default null, p_active boolean default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.members := vc_private.me('team.manage');
begin
  if p_id = m.id and (p_active = false or (p_role is not null and p_role <> 'admin')) then
    perform vc_private.fail('VC409', 'Você não pode desativar nem rebaixar o próprio usuário.');
  end if;
  if p_role is not null and p_role not in ('admin', 'recepcao', 'veterinario') then
    perform vc_private.fail('VC422', 'Perfil inválido.', '{"role": "Perfil inválido."}');
  end if;
  update public.members set role = coalesce(p_role, role), active = coalesce(p_active, active)
   where id = p_id and clinic_id = m.clinic_id;
  if not found then perform vc_private.fail('VC404', 'Pessoa não encontrada.'); end if;
  perform vc_private.audit(m, 'member', p_id, 'update', jsonb_build_object('role', p_role, 'active', p_active));
  return public.list_team();
end $$;

-- ================================================================ grants
-- Only signed-in users can call the API; helper schema is not exposed.
revoke all on schema vc_private from public, anon, authenticated;
revoke execute on all functions in schema vc_private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.app_bootstrap(), public.create_clinic(text, text),
  public.list_appointments(date, date, date, text, text, text, uuid, text, int, text),
  public.get_appointment(uuid), public.get_slots(date, uuid), public.save_appointment(uuid, jsonb),
  public.set_appointment_status(uuid, text), public.set_appointment_notes(uuid, text), public.delete_appointment(uuid),
  public.dashboard(), public.search_patients(text, int), public.get_tutor(uuid), public.update_tutor(uuid, jsonb),
  public.update_clinic(jsonb), public.list_plans(), public.save_plan(uuid, jsonb),
  public.list_team(), public.invite_member(text, text, text), public.cancel_invite(uuid), public.update_member(uuid, text, boolean)
to authenticated;
