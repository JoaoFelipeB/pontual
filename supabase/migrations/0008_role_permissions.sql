-- =====================================================================
-- Pontual — permissions per profile, configurable per clinic
--
-- Each clinic can change what "Recepção" and "Veterinário" may do
-- (e.g. a clinic without reception lets vets book and edit appointments).
--   * Only the actions below are configurable. Seeing the agenda and the
--     patients is always allowed; settings and team stay with admins.
--   * The Admin profile always has every permission (nobody locks the
--     clinic out of its own settings).
--   * Without a custom setting, the original defaults apply.
-- Every check in the system goes through vc_private.has_perm, so the new
-- rules apply to the database functions and to the app at the same time.
-- =====================================================================

create table public.clinic_role_permissions (
  clinic_id   uuid        not null references public.clinics(id) on delete cascade,
  role        text        not null check (role in ('recepcao', 'veterinario')),
  perm        text        not null,
  allowed     boolean     not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid        null references auth.users(id) on delete set null,
  primary key (clinic_id, role, perm)
);
alter table public.clinic_role_permissions enable row level security;
revoke all on public.clinic_role_permissions from anon, authenticated;

-- Actions a clinic may turn on/off for recepção and veterinário.
create or replace function vc_private.configurable_perms() returns text[]
language sql immutable as $$
  select array['agenda.write', 'agenda.cancel', 'agenda.conclude', 'agenda.notes', 'agenda.delete',
               'patients.write', 'reports.read']
$$;

-- The original matrix, now the default.
create or replace function vc_private.default_perm(p_role text, p_perm text) returns boolean
language sql immutable as $$
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

-- Permission of a profile in a given clinic (custom setting, else default).
create or replace function vc_private.clinic_perm(p_clinic uuid, p_role text, p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_role = 'admin' or not (p_perm = any (vc_private.configurable_perms())) then vc_private.default_perm(p_role, p_perm)
    else coalesce((select allowed from public.clinic_role_permissions
                    where clinic_id = p_clinic and role = p_role and perm = p_perm),
                  vc_private.default_perm(p_role, p_perm))
  end
$$;

-- Same signature as before (every existing check keeps working); it now
-- applies the settings of the signed-in user's clinic.
create or replace function vc_private.has_perm(p_role text, p_perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select vc_private.clinic_perm((select clinic_id from public.members where user_id = auth.uid()), p_role, p_perm)
$$;

create or replace function vc_private.permissions(p_role text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(p), '[]'::jsonb) from unnest(array[
    'agenda.read', 'agenda.write', 'agenda.conclude', 'agenda.cancel', 'agenda.notes', 'agenda.delete',
    'patients.read', 'patients.write', 'reports.read', 'settings.manage', 'team.manage'
  ]) as p where vc_private.has_perm(p_role, p)
$$;

create or replace function vc_private.role_matrix(p_clinic uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'configurable', to_jsonb(vc_private.configurable_perms()),
    'roles', jsonb_build_object(
      'recepcao', (select jsonb_object_agg(p, vc_private.clinic_perm(p_clinic, 'recepcao', p)) from unnest(vc_private.configurable_perms()) p),
      'veterinario', (select jsonb_object_agg(p, vc_private.clinic_perm(p_clinic, 'veterinario', p)) from unnest(vc_private.configurable_perms()) p)),
    'defaults', jsonb_build_object(
      'recepcao', (select jsonb_object_agg(p, vc_private.default_perm('recepcao', p)) from unnest(vc_private.configurable_perms()) p),
      'veterinario', (select jsonb_object_agg(p, vc_private.default_perm('veterinario', p)) from unnest(vc_private.configurable_perms()) p))
  )
$$;

-- Saves {"recepcao": {"agenda.write": true, ...}, "veterinario": {...}}; unknown keys are rejected.
create or replace function vc_private.save_role_matrix(p_clinic uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r text; k text; v jsonb;
begin
  if jsonb_typeof(p) <> 'object' then perform vc_private.fail('VC422', 'Formato inválido.'); end if;
  for r in select jsonb_object_keys(p) loop
    if r not in ('recepcao', 'veterinario') then
      perform vc_private.fail('VC422', 'Só os perfis Recepção e Veterinário podem ser ajustados. O Administrador tem acesso total.');
    end if;
    for k, v in select * from jsonb_each(p->r) loop
      if not (k = any (vc_private.configurable_perms())) then perform vc_private.fail('VC422', format('Permissão não ajustável: %s', k)); end if;
      if jsonb_typeof(v) <> 'boolean' then perform vc_private.fail('VC422', 'Valor inválido.'); end if;
      insert into public.clinic_role_permissions (clinic_id, role, perm, allowed, updated_by)
      values (p_clinic, r, k, v::boolean, auth.uid())
      on conflict (clinic_id, role, perm) do update set allowed = excluded.allowed, updated_at = now(), updated_by = auth.uid();
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------- clinic admin
create or replace function public.get_role_permissions() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m public.members := vc_private.me('settings.manage');
begin
  return vc_private.role_matrix(m.clinic_id);
end $$;

create or replace function public.save_role_permissions(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m public.members := vc_private.me('settings.manage');
begin
  perform vc_private.save_role_matrix(m.clinic_id, p);
  perform vc_private.audit(m, 'clinic', m.clinic_id, 'permissions', p);
  return vc_private.role_matrix(m.clinic_id);
end $$;

-- ---------------------------------------------------------------- platform owner (any company)
create or replace function public.platform_get_role_permissions(p_clinic uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform vc_private.require_platform_admin();
  if not exists (select 1 from public.clinics where id = p_clinic) then perform vc_private.fail('VC404', 'Empresa não encontrada.'); end if;
  return vc_private.role_matrix(p_clinic);
end $$;

create or replace function public.platform_save_role_permissions(p_clinic uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform vc_private.require_platform_admin();
  if not exists (select 1 from public.clinics where id = p_clinic) then perform vc_private.fail('VC404', 'Empresa não encontrada.'); end if;
  perform vc_private.save_role_matrix(p_clinic, p);
  perform vc_private.platform_log('permissions', 'company', p_clinic, p);
  return vc_private.role_matrix(p_clinic);
end $$;

revoke execute on all functions in schema vc_private from public, anon, authenticated;
revoke execute on function
  public.get_role_permissions(), public.save_role_permissions(jsonb),
  public.platform_get_role_permissions(uuid), public.platform_save_role_permissions(uuid, jsonb)
from public, anon;
grant execute on function
  public.get_role_permissions(), public.save_role_permissions(jsonb),
  public.platform_get_role_permissions(uuid), public.platform_save_role_permissions(uuid, jsonb)
to authenticated;
