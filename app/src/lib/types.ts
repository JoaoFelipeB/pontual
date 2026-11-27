export type Role = 'admin' | 'recepcao' | 'veterinario';
export type Status = 'agendado' | 'concluido' | 'cancelado' | 'faltou';
export type Species = 'cao' | 'gato' | 'outro';

export interface Plan { code: string; name: string; species: Species | null; description: string | null }
export interface Clinic { id: string; name: string; timezone: string; phone: string | null; open_time: string; close_time: string; slot_minutes: number }
export interface Member { id: string; name: string; email: string; role: Role }

export interface AccessRequest {
  status: 'pending' | 'approved' | 'rejected'; name: string; phone: string | null;
  company_hint: string | null; reject_reason: string | null; created_at: string;
}

export interface Bootstrap {
  user: { id: string; email: string };
  member: Member | null;
  /** platform owner: manages companies and approves access */
  platform_admin: boolean;
  pending_requests: number | null;
  /** set when the user has a membership that is currently blocked */
  blocked?: 'company_suspended' | 'member_disabled' | null;
  access_request?: AccessRequest | null;
  /** last version of the terms of use accepted by this user */
  terms_version: string | null;
  permissions: string[];
  clinic: Clinic;
  today: string;
  now: string;
  plans: Plan[];
  vets: { id: string; name: string }[];
}

export interface Animal {
  id: string; name: string; species: Species; breed: string | null; sex: 'macho' | 'femea' | null;
  age_value: number | null; age_unit: 'anos' | 'meses';
}

export interface Appointment {
  id: string; number: number; date: string; time: string; status: Status;
  service_type: 'particular' | 'plano'; plan: string | null; plan_name: string | null;
  reason: string | null; notes: string | null; vet_id: string | null; vet_name: string | null;
  tutor: { id: string; name: string; phone: string };
  animal: Animal;
  created_at: string; updated_at: string; created_by_name: string | null;
  reminder_sent_at: string | null;
}

export interface Slot { time: string; available: boolean; reason: 'ocupado' | 'passado' | null; animal_name: string | null; appointment_id: string | null }

export interface TutorSummary { id: string; name: string; phone: string; animals: Animal[]; last_visit: string | null }
export interface TutorDetail extends TutorSummary { email: string | null; notes: string | null; created_at: string; history: Appointment[] }

export interface Company {
  id: string; name: string; document: string | null; contact_name: string | null; contact_phone: string | null;
  notes: string | null; active: boolean; timezone: string; created_at: string; suspended_at: string | null;
  members: number; admins: string[]; appointments_30d: number;
}
export interface CompanyDetail extends Company {
  people: { id: string; name: string; email: string; role: Role; active: boolean; created_at: string }[];
  invites: { id: string; name: string; email: string; role: Role; created_at: string }[];
}
export interface PlatformRequest {
  id: string; email: string; name: string; phone: string | null; company_hint: string | null; message: string | null;
  status: 'pending' | 'approved' | 'rejected'; reject_reason: string | null; created_at: string; decided_at: string | null;
  clinic_name: string | null;
}

export interface PlatformAppointment extends Appointment { clinic: { id: string; name: string } }
export interface OverviewRow { id: string; name: string; active: boolean; today: number; next_7d: number; month_done: number; month_noshow: number }
export interface AuditEntry {
  id: number; created_at: string; action: string; entity: string; entity_id: string | null;
  actor: string | null; company: string | null; data: Record<string, unknown> | null;
}
