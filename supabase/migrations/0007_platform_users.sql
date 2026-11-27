-- =====================================================================
-- Pontual — full user management for the platform owner
--   * list every account (with company, role, status, last sign-in)
--   * create access for an account (the app creates the login first)
--   * edit name, company, role, active; remove access; reset password
--   * grant / revoke platform owner (never the last owner)
-- Every action is written to platform_audit.
-- =====================================================================

create or replace function vc_private.user_json(p_user uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'user_id', u.id, 'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
    'member_id', m.id, 'name', coalesce(m.name, r.name), 'role', m.role, 'active', m.active,
    'clinic_id', c.id, 'clinic_name', c.name, 'clinic_active', c.active,
    'platform_admin', exists (select 1 from public.platform_admins pa where pa.user_id = u.id),
    'request_status', r.status, 'request_company_hint', r.company_hint, 'phone', r.phone
  )
  from auth.users u
  left join public.members m on m.user_id = u.id
  left join public.clinics c on c.id = m.clinic_id
  left join public.access_requests r on r.user_id = u.id
  where u.id = p_user
$$;

create or replace function public.platform_list_users(p_q text default '') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := vc_private.norm(trim(coalesce(p_q, '')));
begin
  perform vc_private.require_platform_admin();
  return coalesce((
    select jsonb_agg(vc_private.user_json(u.id) order by coalesce(m.name, r.name, u.email))
      from auth.users u
      left join public.members m on m.user_id = u.id
      left join public.clinics c on c.id = m.clinic_id
      left join public.access_requests r on r.user_id = u.id
     where q = '' or vc_private.norm(u.email) like '%' || q || '%'
        or vc_private.norm(coalesce(m.name, r.name, '')) like '%' || q || '%'
        or vc_private.norm(coalesce(c.name, '')) like '%' || q || '%'
  ), '[]'::jsonb);
end $$;

-- Gives an existing account access to a company (or changes it). Used after the app
-- creates the login, and to edit anyone. Fields: name, clinic_id, role, active.
create or replace function public.platform_save_user(p_user_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f jsonb := '{}';
  u record;
  m public.members;
  v_name text := trim(coalesce(p->>'name', ''));
  v_clinic uuid := nullif(p->>'clinic_id', '')::uuid;
  v_role text := nullif(p->>'role', '');
  v_active boolean := coalesce((p->>'active')::boolean, true);
begin
  perform vc_private.require_platform_admin();
  select id, email into u from auth.users where id = p_user_id;
  if u.id is null then perform vc_private.fail('VC404', 'Usuário não encontrado.'); end if;
  if length(v_name) < 3 then f := f || '{"name": "Informe o nome completo."}'; end if;
  if v_clinic is null or not exists (select 1 from public.clinics where id = v_clinic) then f := f || '{"clinic_id": "Escolha a empresa."}'; end if;
  if coalesce(v_role, '') not in ('admin', 'recepcao', 'veterinario') then f := f || '{"role": "Escolha o perfil."}'; end if;
  if f <> '{}' then perform vc_private.fail('VC422', 'Confira os campos destacados.', f); end if;

  select * into m from public.members where user_id = p_user_id;
  if m.id is null then
    insert into public.members (clinic_id, user_id, name, email, role, active)
    values (v_clinic, p_user_id, v_name, lower(u.email), v_role, v_active);
  else
    update public.members set name = v_name, clinic_id = v_clinic, role = v_role, active = v_active, email = lower(u.email)
     where id = m.id;
  end if;
  -- an open request is settled by this decision
  update public.access_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(), updated_at = now()
   where user_id = p_user_id and status = 'pending';
  perform vc_private.platform_log(case when m.id is null then 'grant' else 'update' end, 'user', p_user_id,
    jsonb_build_object('name', v_name, 'clinic_id', v_clinic, 'role', v_role, 'active', v_active));
  return vc_private.user_json(p_user_id);
end $$;

-- Looks up an account by e-mail (after the app created it, or if it already existed).
create or replace function public.platform_find_user(p_email text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid;
begin
  perform vc_private.require_platform_admin();
  select id into uid from auth.users where lower(email) = lower(trim(coalesce(p_email, '')));
  return case when uid is null then null else vc_private.user_json(uid) end;
end $$;

create or replace function public.platform_remove_access(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform vc_private.require_platform_admin();
  if p_user_id = auth.uid() then perform vc_private.fail('VC409', 'Você não pode remover o próprio acesso.'); end if;
  delete from public.members where user_id = p_user_id;
  perform vc_private.platform_log('remove_access', 'user', p_user_id, null);
  return vc_private.user_json(p_user_id);
end $$;

create or replace function public.platform_reset_password(p_user_id uuid, p_new_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform vc_private.require_platform_admin();
  if not exists (select 1 from auth.users where id = p_user_id) then perform vc_private.fail('VC404', 'Usuário não encontrado.'); end if;
  if length(coalesce(p_new_password, '')) < 8 then
    perform vc_private.fail('VC422', 'Confira os campos destacados.', '{"password": "Use pelo menos 8 caracteres."}');
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')), updated_at = now()
   where id = p_user_id;
  perform vc_private.platform_log('reset_password', 'user', p_user_id, null);
  return vc_private.user_json(p_user_id);
end $$;

create or replace function public.platform_set_owner(p_user_id uuid, p_owner boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform vc_private.require_platform_admin();
  if not exists (select 1 from auth.users where id = p_user_id) then perform vc_private.fail('VC404', 'Usuário não encontrado.'); end if;
  if p_owner then
    insert into public.platform_admins (user_id) values (p_user_id) on conflict do nothing;
  else
    if p_user_id = auth.uid() then perform vc_private.fail('VC409', 'Você não pode tirar o seu próprio acesso de dono.'); end if;
    delete from public.platform_admins where user_id = p_user_id;
  end if;
  perform vc_private.platform_log(case when p_owner then 'grant_owner' else 'revoke_owner' end, 'user', p_user_id, null);
  return vc_private.user_json(p_user_id);
end $$;

revoke execute on all functions in schema vc_private from public, anon, authenticated;
revoke execute on function
  public.platform_list_users(text), public.platform_save_user(uuid, jsonb), public.platform_find_user(text),
  public.platform_remove_access(uuid), public.platform_reset_password(uuid, text), public.platform_set_owner(uuid, boolean)
from public, anon;
grant execute on function
  public.platform_list_users(text), public.platform_save_user(uuid, jsonb), public.platform_find_user(text),
  public.platform_remove_access(uuid), public.platform_reset_password(uuid, text), public.platform_set_owner(uuid, boolean)
to authenticated;
