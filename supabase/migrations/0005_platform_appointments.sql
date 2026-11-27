-- =====================================================================
-- Pontual — platform owner reads appointments of client companies
--
--   * Support view (one company) and overview (all companies) share the
--     same read-only functions; nothing here can change data.
--   * Every read is written to platform_audit (who, which company, filters),
--     so access to client data is traceable (LGPD accountability).
--     Paging through results does not create extra entries.
-- =====================================================================

-- Appointment JSON plus the company it belongs to.
create or replace function vc_private.platform_appt_json(p_id uuid) returns jsonb
language sql stable as $$
  select vc_private.appt_json(a.id) || jsonb_build_object('clinic', jsonb_build_object('id', c.id, 'name', c.name))
    from public.appointments a join public.clinics c on c.id = a.clinic_id
   where a.id = p_id
$$;

create or replace function public.platform_list_appointments(
  p_clinic uuid default null, p_from date default null, p_to date default null, p_date date default null,
  p_status text default null, p_q text default null, p_order text default 'asc',
  p_limit int default 50, p_cursor text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  desc_order boolean := lower(coalesce(p_order, 'asc')) = 'desc';
  c_date date; c_time time; c_id uuid;
  q text := vc_private.norm(trim(coalesce(p_q, '')));
  qd text := vc_private.digits(p_q);
  ids uuid[];
  has_more boolean;
  last_id uuid;
begin
  perform vc_private.require_platform_admin();
  if p_clinic is not null and not exists (select 1 from public.clinics where id = p_clinic) then
    perform vc_private.fail('VC404', 'Empresa não encontrada.');
  end if;
  if p_cursor is not null then
    begin
      select split_part(x, '|', 1)::date, split_part(x, '|', 2)::time, split_part(x, '|', 3)::uuid
        into c_date, c_time, c_id
        from (select convert_from(decode(p_cursor, 'base64'), 'utf8') as x) s;
    exception when others then
      perform vc_private.fail('VC422', 'Cursor inválido.', '{"cursor": "Cursor inválido."}');
    end;
  else
    -- one audit entry per search (not per page)
    perform vc_private.platform_log('view_appointments', 'company', p_clinic, jsonb_strip_nulls(jsonb_build_object(
      'scope', case when p_clinic is null then 'all_companies' else 'one_company' end,
      'from', p_from, 'to', p_to, 'date', p_date, 'status', nullif(p_status, ''), 'q', nullif(p_q, ''))));
  end if;

  select array_agg(id) into ids from (
    select a.id
      from public.appointments a
      join public.tutors t on t.id = a.tutor_id
      join public.animals an on an.id = a.animal_id
     where (p_clinic is null or a.clinic_id = p_clinic)
       and (p_date is null or a.starts_on = p_date)
       and (p_from is null or a.starts_on >= p_from)
       and (p_to is null or a.starts_on <= p_to)
       and (p_status is null or p_status = '' or a.status = p_status)
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
    'data', coalesce((select jsonb_agg(vc_private.platform_appt_json(x.id) order by x.ord)
                        from unnest(ids) with ordinality as x(id, ord)), '[]'::jsonb),
    'next_cursor', case when has_more then
      (select encode(convert_to(a.starts_on::text || '|' || a.starts_at::text || '|' || a.id::text, 'utf8'), 'base64')
         from public.appointments a where a.id = last_id) end
  );
end $$;

create or replace function public.platform_get_appointment(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform vc_private.require_platform_admin();
  r := vc_private.platform_appt_json(p_id);
  if r is null then perform vc_private.fail('VC404', 'Agendamento não encontrado.'); end if;
  perform vc_private.platform_log('view_appointment', 'appointment', p_id, jsonb_build_object('clinic_id', r->'clinic'->>'id'));
  return r;
end $$;

-- Numbers per company for the overview (no personal data).
create or replace function public.platform_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform vc_private.require_platform_admin();
  return jsonb_build_object(
    'companies', coalesce((select jsonb_agg(row order by row->>'name') from (
      select jsonb_build_object(
        'id', c.id, 'name', c.name, 'active', c.active,
        'today', count(a.id) filter (where a.starts_on = (now() at time zone c.timezone)::date and a.status in ('agendado', 'concluido')),
        'next_7d', count(a.id) filter (where a.status = 'agendado' and a.starts_on > (now() at time zone c.timezone)::date
                                            and a.starts_on <= (now() at time zone c.timezone)::date + 7),
        'month_done', count(a.id) filter (where a.status = 'concluido'
                                               and a.starts_on >= date_trunc('month', now() at time zone c.timezone)::date),
        'month_noshow', count(a.id) filter (where a.status = 'faltou'
                                                 and a.starts_on >= date_trunc('month', now() at time zone c.timezone)::date)
      ) as row
      from public.clinics c left join public.appointments a on a.clinic_id = c.id
      group by c.id) s), '[]'::jsonb)
  );
end $$;

revoke execute on all functions in schema vc_private from public, anon, authenticated;
revoke execute on function
  public.platform_list_appointments(uuid, date, date, date, text, text, text, int, text),
  public.platform_get_appointment(uuid), public.platform_overview()
from public, anon;
grant execute on function
  public.platform_list_appointments(uuid, date, date, date, text, text, text, int, text),
  public.platform_get_appointment(uuid), public.platform_overview()
to authenticated;
