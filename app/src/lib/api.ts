import { createAccountClient, supabase } from './supabase';
import type { RoleMatrix } from '../components/RolePermissions';
import type { Appointment, AuditEntry, Bootstrap, PlatformUser, Company, CompanyDetail, OverviewRow, PlatformAppointment, PlatformRequest, Slot, TutorDetail, TutorSummary } from './types';

/** Error returned by the database API: message for the user + per-field messages. */
export class ApiError extends Error {
  constructor(message: string, public code: string, public fields: Record<string, string> = {}) {
    super(message);
  }
}

const NETWORK = 'Sem conexão com o servidor. Verifique a internet e tente de novo.';

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  let res;
  try {
    res = await supabase.rpc(fn, args);
  } catch {
    throw new ApiError(NETWORK, 'NETWORK');
  }
  const { data, error } = res;
  if (error) {
    let fields: Record<string, string> = {};
    try { fields = error.details ? JSON.parse(error.details) : {}; } catch { /* not JSON */ }
    if (!error.code && /fetch/i.test(error.message)) throw new ApiError(NETWORK, 'NETWORK');
    if (error.code === 'PGRST301' || error.code === '42501') throw new ApiError('Sua sessão expirou. Entre novamente.', 'VC401');
    throw new ApiError(error.code?.startsWith('VC') ? error.message : 'Não foi possível concluir. Tente de novo.', error.code ?? '', fields);
  }
  return data as T;
}

export interface ListParams {
  from?: string; to?: string; date?: string; status?: string; plan?: string; q?: string; vet?: string;
  order?: 'asc' | 'desc'; limit?: number; cursor?: string | null;
}

export const api = {
  bootstrap: () => rpc<Bootstrap>('app_bootstrap'),
  requestAccess: (p: { name: string; phone: string; company_hint: string; message?: string }) =>
    rpc<Bootstrap>('request_access', { p_name: p.name, p_phone: p.phone, p_company_hint: p.company_hint, p_message: p.message ?? null }),

  listAppointments: (p: ListParams) =>
    rpc<{ data: Appointment[]; next_cursor: string | null }>('list_appointments', {
      p_from: p.from ?? null, p_to: p.to ?? null, p_date: p.date ?? null, p_status: p.status || null,
      p_plan: p.plan || null, p_q: p.q || null, p_vet: p.vet || null, p_order: p.order ?? 'asc',
      p_limit: p.limit ?? 50, p_cursor: p.cursor ?? null
    }),
  getAppointment: (id: string) => rpc<Appointment>('get_appointment', { p_id: id }),
  slots: (date: string, exclude?: string | null, vet?: string | null) =>
    rpc<{ date: string; vet_id: string | null; past_day: boolean; slots: Slot[] }>('get_slots', { p_date: date, p_exclude: exclude ?? null, p_vet: vet || null }),
  markReminderSent: (id: string) => rpc<Appointment>('mark_reminder_sent', { p_id: id }),
  acceptTerms: (version: string) => rpc<Bootstrap>('accept_terms', { p_version: version }),
  saveAppointment: (id: string | null, payload: Record<string, unknown>) =>
    rpc<Appointment>('save_appointment', { p_id: id, p: payload }),
  setStatus: (id: string, status: string) => rpc<Appointment>('set_appointment_status', { p_id: id, p_status: status }),
  setNotes: (id: string, notes: string) => rpc<Appointment>('set_appointment_notes', { p_id: id, p_notes: notes }),
  deleteAppointment: (id: string) => rpc<{ deleted: boolean }>('delete_appointment', { p_id: id }),

  dashboard: () => rpc<any>('dashboard'),

  searchPatients: (q: string, limit = 30) => rpc<TutorSummary[]>('search_patients', { p_q: q, p_limit: limit }),
  getTutor: (id: string) => rpc<TutorDetail>('get_tutor', { p_id: id }),
  updateTutor: (id: string, p: Record<string, unknown>) => rpc<TutorDetail>('update_tutor', { p_id: id, p }),

  updateClinic: (p: Record<string, unknown>) => rpc<Bootstrap>('update_clinic', { p }),
  listPlans: () => rpc<any[]>('list_plans'),
  savePlan: (id: string | null, p: Record<string, unknown>) => rpc<any[]>('save_plan', { p_id: id, p }),

  listTeam: () => rpc<{ members: any[]; invites: any[] }>('list_team'),
  invite: (email: string, name: string, role: string) => rpc<any>('invite_member', { p_email: email, p_name: name, p_role: role }),
  cancelInvite: (id: string) => rpc<any>('cancel_invite', { p_id: id }),
  adminResetPassword: (memberId: string, password: string) =>
    rpc<{ ok: boolean; name: string; email: string }>('admin_reset_password', { p_member_id: memberId, p_new_password: password }),
  // ---- platform owner
  platformCompanies: (q = '') => rpc<Company[]>('platform_list_companies', { p_q: q }),
  platformCompany: (id: string) => rpc<CompanyDetail>('platform_get_company', { p_id: id }),
  platformSaveCompany: (id: string | null, p: Record<string, unknown>) => rpc<CompanyDetail>('platform_save_company', { p_id: id, p }),
  platformSetMember: (memberId: string, role?: string, active?: boolean) =>
    rpc<CompanyDetail>('platform_set_member', { p_member_id: memberId, p_role: role ?? null, p_active: active ?? null }),
  platformRequests: (status: string) => rpc<PlatformRequest[]>('platform_list_requests', { p_status: status }),
  platformDecide: (id: string, approve: boolean, opts: { clinicId?: string; role?: string; reason?: string } = {}) =>
    rpc<PlatformRequest[]>('platform_decide_request', {
      p_id: id, p_approve: approve, p_clinic_id: opts.clinicId ?? null, p_role: opts.role ?? null, p_reason: opts.reason ?? null
    }),

  platformAppointments: (p: ListParams & { clinic?: string | null }) =>
    rpc<{ data: PlatformAppointment[]; next_cursor: string | null }>('platform_list_appointments', {
      p_clinic: p.clinic || null, p_from: p.from ?? null, p_to: p.to ?? null, p_date: p.date ?? null,
      p_status: p.status || null, p_q: p.q || null, p_order: p.order ?? 'asc', p_limit: p.limit ?? 50, p_cursor: p.cursor ?? null
    }),
  platformAppointment: (id: string) => rpc<PlatformAppointment>('platform_get_appointment', { p_id: id }),
  platformOverview: () => rpc<{ companies: OverviewRow[] }>('platform_overview'),
  platformAudit: (before?: number | null, limit = 100) => rpc<AuditEntry[]>('platform_list_audit', { p_limit: limit, p_before: before ?? null }),

  platformUsers: (q = '') => rpc<PlatformUser[]>('platform_list_users', { p_q: q }),
  platformFindUser: (email: string) => rpc<PlatformUser | null>('platform_find_user', { p_email: email }),
  platformSaveUser: (userId: string, p: { name: string; clinic_id: string; role: string; active: boolean }) =>
    rpc<PlatformUser>('platform_save_user', { p_user_id: userId, p }),
  platformRemoveAccess: (userId: string) => rpc<PlatformUser>('platform_remove_access', { p_user_id: userId }),
  platformResetPassword: (userId: string, password: string) =>
    rpc<PlatformUser>('platform_reset_password', { p_user_id: userId, p_new_password: password }),
  platformSetOwner: (userId: string, owner: boolean) => rpc<PlatformUser>('platform_set_owner', { p_user_id: userId, p_owner: owner }),
  /**
   * Creates the login (e-mail + temporary password) without touching the owner's own session,
   * then gives it access to the company. If the e-mail already has an account, it is reused.
   */
  platformCreateUser: async (p: { email: string; name: string; clinic_id: string; role: string; password: string }) => {
    const email = p.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError('Confira os campos destacados.', 'VC422', { email: 'E-mail inválido.' });
    let existing = await rpc<PlatformUser | null>('platform_find_user', { p_email: email });
    let created = false;
    if (!existing) {
      const { error } = await createAccountClient().auth.signUp({ email, password: p.password });
      if (error && !/already registered/i.test(error.message)) {
        throw new ApiError(/password/i.test(error.message) ? 'Senha temporária fraca demais. Gere outra.' : error.message, 'VC422',
          /password/i.test(error.message) ? { password: 'Senha fraca.' } : {});
      }
      existing = await rpc<PlatformUser | null>('platform_find_user', { p_email: email });
      if (!existing) throw new ApiError('Não foi possível criar a conta. Tente de novo.', 'VC500');
      created = !error;
    }
    if (existing.member_id && existing.clinic_id !== p.clinic_id) {
      throw new ApiError(`Este e-mail já tem acesso à empresa ${existing.clinic_name}. Edite a pessoa na lista.`, 'VC409', { email: 'E-mail já cadastrado.' });
    }
    const user = await rpc<PlatformUser>('platform_save_user', { p_user_id: existing.user_id, p: { name: p.name, clinic_id: p.clinic_id, role: p.role, active: true } });
    return { user, created };
  },

  rolePermissions: () => rpc<RoleMatrix>('get_role_permissions'),
  saveRolePermissions: (p: Record<string, Record<string, boolean>>) => rpc<RoleMatrix>('save_role_permissions', { p }),
  platformRolePermissions: (clinicId: string) => rpc<RoleMatrix>('platform_get_role_permissions', { p_clinic: clinicId }),
  platformSaveRolePermissions: (clinicId: string, p: Record<string, Record<string, boolean>>) =>
    rpc<RoleMatrix>('platform_save_role_permissions', { p_clinic: clinicId, p }),

  updateMember: (id: string, role?: string, active?: boolean) =>
    rpc<any>('update_member', { p_id: id, p_role: role ?? null, p_active: active ?? null })
};
