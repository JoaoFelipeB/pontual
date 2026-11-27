import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { client, freshDb, RpcError, signUp } from './db';

let db: PGlite;
let owner: ReturnType<typeof client>;
let admin: ReturnType<typeof client>;
let vet: ReturnType<typeof client>;
let otherVet: ReturnType<typeof client>;
let clinicA: string;
let clinicB: string;
let today: string;

async function expectError(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) { expect((e as RpcError).code).toBe(code); return e as RpcError; }
  throw new Error(`expected ${code}`);
}
const tomorrow = () => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const appt = (over: Record<string, unknown> = {}) => ({
  tutor_name: 'Maria Oliveira', tutor_phone: '83988887777', animal_name: 'Thor', species: 'cao',
  date: tomorrow(), time: '09:00', service_type: 'particular', reason: 'Consulta', ...over
});

async function person(email: string, name: string, clinic: string, role: string) {
  const uid = await signUp(db, email);
  await owner('platform_save_user', { p_user_id: uid, p: { name, clinic_id: clinic, role } });
  return client(db, uid);
}

beforeAll(async () => {
  db = await freshDb();
  const ownerId = await signUp(db, 'dono@pontual.com');
  await db.query('insert into public.platform_admins (user_id) values ($1)', [ownerId]);
  owner = client(db, ownerId);
  clinicA = (await owner('platform_save_company', { p_id: null, p: { name: 'Clínica sem recepção' } })).id;
  clinicB = (await owner('platform_save_company', { p_id: null, p: { name: 'Outra clínica' } })).id;
  admin = await person('admin@a.com', 'Ana Admin', clinicA, 'admin');
  vet = await person('vet@a.com', 'Paulo Vet', clinicA, 'veterinario');
  otherVet = await person('vet@b.com', 'Bia Vet', clinicB, 'veterinario');
  today = (await admin('app_bootstrap')).today;
});

describe('permissões por perfil, configuráveis por clínica', () => {
  it('padrão: veterinário não agenda', async () => {
    expect((await vet('app_bootstrap')).permissions).not.toContain('agenda.write');
    await expectError(vet('save_appointment', { p_id: null, p: appt() }), 'VC403');
    const m = await admin('get_role_permissions');
    expect(m.roles.veterinario['agenda.write']).toBe(false);
    expect(m.defaults.recepcao['agenda.write']).toBe(true);
  });

  it('admin libera agendar e editar para o veterinário, e passa a valer na hora', async () => {
    const m = await admin('save_role_permissions', { p: { veterinario: { 'agenda.write': true, 'agenda.cancel': true } } });
    expect(m.roles.veterinario['agenda.write']).toBe(true);
    expect((await vet('app_bootstrap')).permissions).toEqual(expect.arrayContaining(['agenda.write', 'agenda.cancel']));
    const a = await vet('save_appointment', { p_id: null, p: appt() });
    await vet('save_appointment', { p_id: a.id, p: appt({ time: '10:00' }) });
    await vet('set_appointment_status', { p_id: a.id, p_status: 'cancelado' });
  });

  it('não afeta outras clínicas', async () => {
    expect((await otherVet('app_bootstrap')).permissions).not.toContain('agenda.write');
    await expectError(otherVet('save_appointment', { p_id: null, p: appt() }), 'VC403');
  });

  it('também pode tirar permissões e voltar ao padrão', async () => {
    await admin('save_role_permissions', { p: { veterinario: { 'agenda.write': false }, recepcao: { 'reports.read': false } } });
    await expectError(vet('save_appointment', { p_id: null, p: appt({ time: '11:00' }) }), 'VC403');
    const back = await admin('save_role_permissions', { p: { veterinario: { 'agenda.write': true } } });
    expect(back.roles.veterinario['agenda.write']).toBe(true);
  });

  it('regras de segurança: admin intocável, configurações e equipe só do admin, só admin altera', async () => {
    await expectError(admin('save_role_permissions', { p: { admin: { 'agenda.write': false } } }), 'VC422');
    await expectError(admin('save_role_permissions', { p: { veterinario: { 'settings.manage': true } } }), 'VC422');
    await expectError(admin('save_role_permissions', { p: { veterinario: { 'team.manage': true } } }), 'VC422');
    await expectError(admin('save_role_permissions', { p: { veterinario: { 'agenda.write': 'sim' } } }), 'VC422');
    await expectError(vet('save_role_permissions', { p: { veterinario: { 'agenda.delete': true } } }), 'VC403');
    await expectError(vet('get_role_permissions'), 'VC403');
  });

  it('dono da plataforma ajusta qualquer empresa; tudo auditado', async () => {
    await owner('platform_save_role_permissions', { p_clinic: clinicB, p: { veterinario: { 'agenda.write': true } } });
    expect((await otherVet('app_bootstrap')).permissions).toContain('agenda.write');
    expect((await owner('platform_get_role_permissions', { p_clinic: clinicB })).roles.veterinario['agenda.write']).toBe(true);
    await expectError(admin('platform_save_role_permissions', { p_clinic: clinicB, p: {} }), 'VC403');
    const a = await db.query(`select 1 from public.audit_log where action = 'permissions'`);
    const p = await db.query(`select 1 from public.platform_audit where action = 'permissions'`);
    expect(a.rows.length).toBeGreaterThan(0);
    expect(p.rows.length).toBe(1);
  });
});
