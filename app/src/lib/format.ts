import type { Animal, Status } from './types';

export const ROLE_LABEL: Record<string, string> = { admin: 'Administrador', recepcao: 'Recepção', veterinario: 'Veterinário' };
export const STATUS_LABEL: Record<Status, string> = { agendado: 'Agendado', concluido: 'Concluído', cancelado: 'Cancelado', faltou: 'Faltou' };
export const SPECIES_LABEL: Record<string, string> = { cao: 'Cão', gato: 'Gato', outro: 'Outro' };

const d = (iso: string) => new Date(iso + 'T12:00:00Z');
const f = (iso: string, o: Intl.DateTimeFormatOptions) => d(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC', ...o });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function addDays(iso: string, n: number) {
  const x = d(iso);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
export const fmtDate = (iso: string) => f(iso, { day: '2-digit', month: '2-digit', year: 'numeric' });
export const fmtShort = (iso: string) => f(iso, { day: '2-digit', month: '2-digit' });
export const fmtLong = (iso: string) => cap(f(iso, { weekday: 'long', day: 'numeric', month: 'long' }));
export const fmtWeekday = (iso: string) => f(iso, { weekday: 'short' }).replace('.', '');
export const fmtMonth = (iso: string) => cap(f(iso, { month: 'long', year: 'numeric' }));

export function relDay(iso: string, today: string) {
  if (iso === today) return 'Hoje';
  if (iso === addDays(today, 1)) return 'Amanhã';
  if (iso === addDays(today, -1)) return 'Ontem';
  return fmtLong(iso);
}

export function ageText(a: Pick<Animal, 'age_value' | 'age_unit'>) {
  if (a.age_value == null) return null;
  if (a.age_unit === 'meses') return `${a.age_value} ${a.age_value === 1 ? 'mês' : 'meses'}`;
  return `${a.age_value} ${a.age_value === 1 ? 'ano' : 'anos'}`;
}

export function animalLine(a: Animal) {
  return [SPECIES_LABEL[a.species], a.breed, a.sex === 'macho' ? 'Macho' : a.sex === 'femea' ? 'Fêmea' : null, ageText(a)]
    .filter(Boolean).join(', ');
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

export function maskPhone(v: string) {
  const x = v.replace(/\D/g, '').slice(0, 11);
  if (x.length <= 2) return x;
  if (x.length <= 6) return `(${x.slice(0, 2)}) ${x.slice(2)}`;
  const cut = x.length === 11 ? 7 : 6;
  return `(${x.slice(0, 2)}) ${x.slice(2, cut)}-${x.slice(cut)}`;
}

export const waLink = (phone: string) => `https://wa.me/55${phone.replace(/\D/g, '')}`;
