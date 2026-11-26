-- =====================================================================
-- VetCare — the clinic administrator sets a temporary password for a
-- team member. Supabase's built-in e-mail only delivers to the project's
-- own team, so "forgot password" e-mails do not reach the clinic staff
-- unless a custom SMTP is configured. This keeps password recovery inside
-- the app: the admin sets a temporary password and the person changes it
-- after signing in (key icon next to their name).
-- =====================================================================

create or replace function public.admin_reset_password(p_member_id uuid, p_new_password text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  m public.members := vc_private.me('team.manage');
  target public.members;
begin
  select * into target from public.members where id = p_member_id and clinic_id = m.clinic_id;
  if target.id is null then perform vc_private.fail('VC404', 'Pessoa não encontrada.'); end if;
  if length(coalesce(p_new_password, '')) < 8 then
    perform vc_private.fail('VC422', 'Confira os campos destacados.', '{"password": "Use pelo menos 8 caracteres."}');
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
         updated_at = now()
   where id = target.user_id;
  perform vc_private.audit(m, 'member', target.id, 'reset_password', null);
  return jsonb_build_object('ok', true, 'name', target.name, 'email', target.email);
end $$;

revoke execute on function public.admin_reset_password(uuid, text) from public, anon;
grant execute on function public.admin_reset_password(uuid, text) to authenticated;
