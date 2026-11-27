-- =====================================================================
-- Pontual — platform access control
--
-- Who can use the app is decided by the platform owner:
--   * platform_admins: owners of the platform (you). They see every company.
--   * clinics gain registration data and an "active" switch; a suspended
--     company locks out all of its users immediately.
--   * access_requests: anyone can create an account, but without approval
--     they only see an "awaiting approval" screen. The platform owner
--     approves (choosing company and role) or rejects.
--   * Company admins can still invite their own staff by e-mail (invites
--     created by an approved admin count as pre-approval).
--   * Self-service clinic creation (create_clinic) is removed.
-- =====================================================================

-- ---------------------------------------------------------------- tables
create table public.platform_admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

alter table public.clinics
  add column if not exists active        boolean     not null default true,
  add column if not exists document      text        null,
  add column if not exists contact_name  text        null,
  add column if not exists contact_phone text        null,
  add column if not exists notes         text        null,
  add column if not exists suspended_at  timestamptz null;

create table public.access_requests (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid        not null unique references auth.users(id) on delete cascade,
  email          text        not null,
  name           text        not null check (length(trim(name)) between 3 and 120),
  phone          text        null,
  company_hint   text        null,
  message        text        null,
  status         text        not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by     uuid        null references auth.users(id) on delete set null,
  decided_at     timestamptz null,
  reject_reason  text        null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index access_requests_status_idx on public.access_requests (status, created_at);

-- platform actions are not tied to one clinic, so they get their own trail
create table public.platform_audit (
  id          bigint generated always as identity primary key,
  actor_id    uuid        null references auth.users(id) on delete set null,
  action      text        not null,
  entity      text        not null,
  entity_id   uuid        null,
  data        jsonb       null,
  created_at  timestamptz not null default now()
);

alter table public.platform_admins enable row level security;
alter table public.access_requests enable row level security;
alter table public.platform_audit  enable row level security;
revoke all on public.platform_admins, public.access_requests, public.platform_audit from anon, authenticated;

-- ---------------------------------------------------------------- helpers
create or replace function vc_private.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

create or replace function vc_private.require_platform_admin() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then perform vc_private.fail('VC401', 'Faça login para continuar.'); end if;
  if not vc_private.is_platform_admin() then
    perform vc_private.fail('VC403', 'Somente o dono da plataforma pode fazer isso.');
  end if;
  return auth.uid();
end $$;

create or replace function vc_private.platform_log(p_action text, p_entity text, p_id uuid, p_data jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.platform_audit (actor_id, action, entity, entity_id, data) values (auth.uid(), p_action, p_entity, p_id, p_data)
$$;

-- Same as before, plus: a suspended company locks out all its members.
create or replace function vc_private.me(p_perm text default null) returns public.members
language plpgsql stable security definer set search_path = public as $$
declare
  m public.members;
  clinic_active boolean;
begin
  if auth.uid() is null then perform vc_private.fail('VC401', 'Faça login para continuar.'); end if;
  select * into m from public.members where user_id = auth.uid();
  if m.id is null then perform vc_private.fail('VC401', 'Seu acesso ainda não foi liberado.'); end if;
  if not m.active then perform vc_private.fail('VC401', 'Seu acesso foi desativado. Fale com o administrador.'); end if;
  select active into clinic_active from public.clinics where id = m.clinic_id;
  if not clinic_active then perform vc_private.fail('VC401', 'O acesso desta empresa está suspenso. Fale com o suporte.'); end if;
  if p_perm is not null and not vc_private.has_perm(m.role, p_perm) then
    perform vc_private.fail('VC403', 'Seu perfil não tem permissão para esta ação.');
  end if;
  return m;
end $$;

create or replace function vc_private.company_json(p_id uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'document', c.document, 'contact_name', c.contact_name,
    'contact_phone', c.contact_phone, 'notes', c.notes, 'active', c.active, 'timezone', c.timezone,
    'created_at', c.created_at, 'suspended_at', c.suspended_at,
    'members', (select count(*) from public.members m where m.clinic_id = c.id and m.active),
    'admins', coalesce((select jsonb_agg(m.name order by m.name) from public.members m
                         where m.clinic_id = c.id and m.role = 'admin' and m.active), '[]'::jsonb),
    'appointments_30d', (select count(*) from public.appointments a
                          where a.clinic_id = c.id and a.created_at > now() - interval '30 days')
  )
  from public.clinics c where c.id = p_id
$$;

-- ---------------------------------------------------------------- bootstrap
-- Adds: platform_admin flag, the user's access request, and blocks suspended companies.
create or replace function public.app_bootstrap() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m public.members;
  c public.clinics;
  u record;
  req public.access_requests;
  now_local timestamp;
  is_owner boolean := vc_private.is_platform_admin();
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

-- Self-service clinic creation is no longer allowed.
drop function if exists public.create_clinic(text, text);

-- ---------------------------------------------------------------- requests (any signed-in user)
create or replace function public.request_access(p_name text, p_phone text, p_company_hint text, p_message text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f jsonb := '{}';
  u_email text;
  cur public.access_requests;
begin
  if auth.uid() is null then perform vc_private.fail('VC401', 'Faça login para continuar.'); end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    perform vc_private.fail('VC409', 'Seu acesso já foi liberado. Entre novamente.');
  end if;
  if length(trim(coalesce(p_name, ''))) < 3 then f := f || '{"name": "Informe seu nome completo."}'; end if;
  if length(vc_private.digits(p_phone)) not between 10 and 11 then f := f || '{"phone": "Informe um telefone com DDD."}'; end if;
  if length(trim(coalesce(p_company_hint, ''))) < 2 then f := f || '{"company_hint": "Informe a clínica onde você trabalha."}'; end if;
  if length(coalesce(p_message, '')) > 500 then f := f || '{"message": "Mensagem muito longa (máx. 500)."}'; end if;
  if f <> '{}' then perform vc_private.fail('VC422', 'Confira os campos destacados.', f); end if;

  select * into cur from public.access_requests where user_id = auth.uid();
  if cur.status = 'pending' then
    perform vc_private.fail('VC409', 'Seu pedido já está em análise.');
  end if;
  select email into u_email from auth.users where id = auth.uid();
  insert into public.access_requests (user_id, email, name, phone, company_hint, message)
  values (auth.uid(), lower(u_email), trim(p_name), vc_private.format_phone(p_phone), trim(p_company_hint), nullif(trim(coalesce(p_message, '')), ''))
  on conflict (user_id) do update
     set name = excluded.name, phone = excluded.phone, company_hint = excluded.company_hint, message = excluded.message,
         status = 'pending', reject_reason = null, decided_by = null, decided_at = null, updated_at = now();
  return public.app_bootstrap();
end $$;

-- ---------------------------------------------------------------- platform: companies
create or replace function public.platform_list_companies(p_q text default '') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := vc_private.norm(trim(coalesce(p_q, '')));
begin
  perform vc_private.require_platform_admin();
  return coalesce((select jsonb_agg(vc_private.company_json(c.id) order by c.active desc, c.name)
                     from public.clinics c
                    where q = '' or vc_private.norm(c.name) like '%' || q || '%'
                       or vc_private.digits(c.document) like '%' || vc_private.digits(p_q) || '%' and length(vc_private.digits(p_q)) >= 3),
                  '[]'::jsonb);
end $$;

create or replace function public.platform_get_company(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform vc_private.require_platform_admin();
  if not exists (select 1 from public.clinics where id = p_id) then perform vc_private.fail('VC404', 'Empresa não encontrada.'); end if;
  return vc_private.company_json(p_id) || jsonb_build_object(
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'email', m.email, 'role', m.role,
                         'active', m.active, 'created_at', m.created_at) order by m.active desc, m.name)
                         from public.members m where m.clinic_id = p_id), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'email', i.email, 'role', i.role,
                         'created_at', i.created_at) order by i.created_at desc)
                         from public.invites i where i.clinic_id = p_id and i.accepted_at is null), '[]'::jsonb)
  );
end $$;

create or replace function public.platform_save_company(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f jsonb := '{}';
  v_name text := trim(coalesce(p->>'name', ''));
  v_doc text := nullif(trim(coalesce(p->>'document', '')), '');
  v_active boolean := coalesce((p->>'active')::boolean, true);
  was_active boolean;
begin
  perform vc_private.require_platform_admin();
  if length(v_name) < 2 then f := f || '{"name": "Informe o nome da empresa."}'; end if;
  if v_doc is not null and length(vc_private.digits(v_doc)) not in (11, 14) then
    f := f || '{"document": "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos)."}';
  end if;
  if coalesce(p->>'contact_phone', '') <> '' and length(vc_private.digits(p->>'contact_phone')) not between 10 and 11 then
    f := f || '{"contact_phone": "Informe um telefone com DDD."}';
  end if;
  if f <> '{}' then perform vc_private.fail('VC422', 'Confira os campos destacados.', f); end if;

  if p_id is null then
    insert into public.clinics (name, document, contact_name, contact_phone, notes, active)
    values (v_name, v_doc, nullif(trim(coalesce(p->>'contact_name', '')), ''),
            nullif(vc_private.format_phone(p->>'contact_phone'), ''), nullif(trim(coalesce(p->>'notes', '')), ''), v_active)
    returning id into p_id;
    insert into public.health_plans (clinic_id, code, name, species, description) values
      (p_id, 'PETLOVE', 'Petlove', null, 'Cobertura geral para cães e gatos'),
      (p_id, 'PETLIFE', 'Petlife', null, 'Cobertura geral para cães e gatos'),
      (p_id, 'DOGLIFE', 'Doglife', 'cao', 'Exclusivo para cães'),
      (p_id, 'CATLIFE', 'Catlife', 'gato', 'Exclusivo para gatos');
    perform vc_private.platform_log('create', 'company', p_id, p);
  else
    select active into was_active from public.clinics where id = p_id for update;
    if not found then perform vc_private.fail('VC404', 'Empresa não encontrada.'); end if;
    update public.clinics
       set name = v_name, document = v_doc,
           contact_name = nullif(trim(coalesce(p->>'contact_name', '')), ''),
           contact_phone = nullif(vc_private.format_phone(p->>'contact_phone'), ''),
           notes = nullif(trim(coalesce(p->>'notes', '')), ''),
           active = v_active,
           suspended_at = case when v_active then null when was_active then now() else suspended_at end
     where id = p_id;
    perform vc_private.platform_log(case when was_active and not v_active then 'suspend'
                                         when not was_active and v_active then 'reactivate' else 'update' end,
                                    'company', p_id, p);
  end if;
  return public.platform_get_company(p_id);
end $$;

create or replace function public.platform_set_member(p_member_id uuid, p_role text default null, p_active boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m public.members;
begin
  perform vc_private.require_platform_admin();
  if p_role is not null and p_role not in ('admin', 'recepcao', 'veterinario') then
    perform vc_private.fail('VC422', 'Perfil inválido.', '{"role": "Perfil inválido."}');
  end if;
  update public.members set role = coalesce(p_role, role), active = coalesce(p_active, active)
   where id = p_member_id returning * into m;
  if m.id is null then perform vc_private.fail('VC404', 'Pessoa não encontrada.'); end if;
  perform vc_private.platform_log('update', 'member', m.id, jsonb_build_object('role', p_role, 'active', p_active));
  return public.platform_get_company(m.clinic_id);
end $$;

-- ---------------------------------------------------------------- platform: access requests
create or replace function public.platform_list_requests(p_status text default 'pending') returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform vc_private.require_platform_admin();
  return coalesce((select jsonb_agg(jsonb_build_object(
            'id', r.id, 'email', r.email, 'name', r.name, 'phone', r.phone, 'company_hint', r.company_hint,
            'message', r.message, 'status', r.status, 'reject_reason', r.reject_reason,
            'created_at', r.created_at, 'decided_at', r.decided_at,
            'clinic_name', (select c.name from public.members mm join public.clinics c on c.id = mm.clinic_id where mm.user_id = r.user_id)
          ) order by r.created_at desc)
     from public.access_requests r
    where p_status is null or p_status = '' or r.status = p_status), '[]'::jsonb);
end $$;

create or replace function public.platform_decide_request(
  p_id uuid, p_approve boolean, p_clinic_id uuid default null, p_role text default null, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  owner_id uuid := vc_private.require_platform_admin();
  r public.access_requests;
begin
  select * into r from public.access_requests where id = p_id for update;
  if r.id is null then perform vc_private.fail('VC404', 'Pedido não encontrado.'); end if;
  if r.status <> 'pending' then perform vc_private.fail('VC409', 'Este pedido já foi analisado.'); end if;

  if p_approve then
    if p_clinic_id is null or not exists (select 1 from public.clinics where id = p_clinic_id) then
      perform vc_private.fail('VC422', 'Confira os campos destacados.', '{"clinic_id": "Escolha a empresa."}');
    end if;
    if coalesce(p_role, '') not in ('admin', 'recepcao', 'veterinario') then
      perform vc_private.fail('VC422', 'Confira os campos destacados.', '{"role": "Escolha o perfil."}');
    end if;
    if exists (select 1 from public.members where user_id = r.user_id) then
      perform vc_private.fail('VC409', 'Este usuário já tem acesso a uma empresa.');
    end if;
    insert into public.members (clinic_id, user_id, name, email, role) values (p_clinic_id, r.user_id, r.name, r.email, p_role);
    update public.access_requests set status = 'approved', decided_by = owner_id, decided_at = now(), updated_at = now() where id = p_id;
    perform vc_private.platform_log('approve', 'access_request', p_id, jsonb_build_object('clinic_id', p_clinic_id, 'role', p_role));
  else
    update public.access_requests
       set status = 'rejected', reject_reason = nullif(trim(coalesce(p_reason, '')), ''),
           decided_by = owner_id, decided_at = now(), updated_at = now()
     where id = p_id;
    perform vc_private.platform_log('reject', 'access_request', p_id, jsonb_build_object('reason', p_reason));
  end if;
  return public.platform_list_requests('pending');
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on all functions in schema vc_private from public, anon, authenticated;
revoke execute on function
  public.request_access(text, text, text, text),
  public.platform_list_companies(text), public.platform_get_company(uuid), public.platform_save_company(uuid, jsonb),
  public.platform_set_member(uuid, text, boolean), public.platform_list_requests(text),
  public.platform_decide_request(uuid, boolean, uuid, text, text)
from public, anon;
grant execute on function
  public.request_access(text, text, text, text),
  public.platform_list_companies(text), public.platform_get_company(uuid), public.platform_save_company(uuid, jsonb),
  public.platform_set_member(uuid, text, boolean), public.platform_list_requests(text),
  public.platform_decide_request(uuid, boolean, uuid, text, text)
to authenticated;
