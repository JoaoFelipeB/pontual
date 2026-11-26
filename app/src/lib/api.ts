import { supabase } from './supabase';
import type { Appointment, Bootstrap, Slot, TutorDetail, TutorSummary } from './types';

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
  createClinic: (clinicName: string, yourName: string) =>
    rpc<Bootstrap>('create_clinic', { p_clinic_name: clinicName, p_your_name: yourName }),

  listAppointments: (p: ListParams) =>
    rpc<{ data: Appointment[]; next_cursor: string | null }>('list_appointments', {
      p_from: p.from ?? null, p_to: p.to ?? null, p_date: p.date ?? null, p_status: p.status || null,
      p_plan: p.plan || null, p_q: p.q || null, p_vet: p.vet || null, p_order: p.order ?? 'asc',
      p_limit: p.limit ?? 50, p_cursor: p.cursor ?? null
    }),
  getAppointment: (id: string) => rpc<Appointment>('get_appointment', { p_id: id }),
  slots: (date: string, exclude?: string | null) =>
    rpc<{ date: string; past_day: boolean; slots: Slot[] }>('get_slots', { p_date: date, p_exclude: exclude ?? null }),
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
  updateMember: (id: string, role?: string, active?: boolean) =>
    rpc<any>('update_member', { p_id: id, p_role: role ?? null, p_active: active ?? null })
};
