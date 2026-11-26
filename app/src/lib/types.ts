export type Role = 'admin' | 'recepcao' | 'veterinario';
export type Status = 'agendado' | 'concluido' | 'cancelado' | 'faltou';
export type Species = 'cao' | 'gato' | 'outro';

export interface Plan { code: string; name: string; species: Species | null; description: string | null }
export interface Clinic { id: string; name: string; timezone: string; phone: string | null; open_time: string; close_time: string; slot_minutes: number }
export interface Member { id: string; name: string; email: string; role: Role }

export interface Bootstrap {
  user: { id: string; email: string };
  member: Member | null;
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
}

export interface Slot { time: string; available: boolean; reason: 'ocupado' | 'passado' | null; animal_name: string | null; appointment_id: string | null }

export interface TutorSummary { id: string; name: string; phone: string; animals: Animal[]; last_visit: string | null }
export interface TutorDetail extends TutorSummary { email: string | null; notes: string | null; created_at: string; history: Appointment[] }
