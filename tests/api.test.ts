import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { client, freshDb, RpcError, signUp } from './db';

let db: PGlite;
let admin: ReturnType<typeof client>;
let rec: ReturnType<typeof client>;
let vet: ReturnType<typeof client>;
let other: ReturnType<typeof client>;
let owner: ReturnType<typeof client>;
let clinicId: string;
let otherClinicId: string;
let today: string;
let vetId: string;

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const TOMORROW = () => addDays(today, 1);

const appt = (over: Record<string, unknown> = {}) => ({
  tutor_name: 'Maria Oliveira', tutor_phone: '(83) 98888-7777',
  animal_name: 'Thor', species: 'cao', age_value: 3, age_unit: 'anos',
  date: TOMORROW(), time: '09:00', service_type: 'plano', plan: 'DOGLIFE', reason: 'Vacinação anual',
  ...over
});

async function expectError(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) {
    expect(e).toBeInstanceOf(RpcError);
    expect((e as RpcError).code).toBe(code);
    return e as RpcError;
  }
  throw new Error(`expected ${code}`);
}

/** New user asks for access and the platform owner approves it into a company. */
async function onboard(email: string, name: string, companyId: string, role = 'admin') {
  const c = client(db, await signUp(db, email));
  await c('request_access', { p_name: name, p_phone: '83999990000', p_company_hint: 'Clínica' });
  const req = (await owner('platform_list_requests', { p_status: 'pending' })).find((r: any) => r.email === email);
  await owner('platform_decide_request', { p_id: req.id, p_approve: true, p_clinic_id: companyId, p_role: role });
  return c;
}

beforeAll(async () => {
  db = await freshDb();
  const ownerId = await signUp(db, 'dono@pontual.com');
  await db.query('insert into public.platform_admins (user_id) values ($1)', [ownerId]);
  owner = client(db, ownerId);
  clinicId = (await owner('platform_save_company', { p_id: null, p: { name: 'Clínica Amigo Fiel', document: '12.345.678/0001-90' } })).id;
  otherClinicId = (await owner('platform_save_company', { p_id: null, p: { name: 'Outra Clínica' } })).id;

  admin = await onboard('admin@clinica.com', 'Ana Souza', clinicId);
  const boot = await admin('app_bootstrap');
  today = boot.today;

  await admin('invite_member', { p_email: 'rec@clinica.com', p_name: 'Carla Mendes', p_role: 'recepcao' });
  await admin('invite_member', { p_email: 'vet@clinica.com', p_name: 'Paulo Lima', p_role: 'veterinario' });
  rec = client(db, await signUp(db, 'rec@clinica.com'));
  vet = client(db, await signUp(db, 'vet@clinica.com'));

  other = await onboard('outra@clinica.com', 'Bruno Alves', otherClinicId);

  vetId = (await vet('app_bootstrap')).member.id;
});

describe('acesso e onboarding', () => {
  it('anônimo não chama nada', async () => {
    await expectError(client(db, null)('app_bootstrap'), '42501');
  });

  it('tabelas não podem ser lidas direto, nem por usuário logado', async () => {
    await db.exec(`set request.jwt.claim.sub = ''; set role authenticated;`);
    await expect(db.query('select * from public.appointments')).rejects.toThrow(/permission denied/);
    await db.exec('reset role');
  });

  it('empresa criada pelo dono já vem com os 4 planos; aprovado como admin', async () => {
    const b = await admin('app_bootstrap');
    expect(b.member.role).toBe('admin');
    expect(b.plans.map((p: any) => p.code).sort()).toEqual(['CATLIFE', 'DOGLIFE', 'PETLIFE', 'PETLOVE']);
    expect(b.permissions).toContain('team.manage');
  });

  it('convite liga a pessoa à clínica com o perfil certo no cadastro', async () => {
    const b = await rec('app_bootstrap');
    expect(b.member).toMatchObject({ name: 'Carla Mendes', role: 'recepcao' });
    expect(b.clinic.name).toBe('Clínica Amigo Fiel');
    expect(b.permissions).not.toContain('team.manage');
  });

  it('quem se cadastra sem convite fica sem clínica (não vê nada)', async () => {
    const stranger = client(db, await signUp(db, 'curioso@gmail.com'));
    expect((await stranger('app_bootstrap')).member).toBeNull();
    await expectError(stranger('list_appointments'), 'VC401');
  });

  it('não existe mais criar clínica por conta própria', async () => {
    const stranger = client(db, await signUp(db, 'espertinho@gmail.com'));
    await expectError(stranger('create_clinic', { p_clinic_name: 'Minha', p_your_name: 'Fulano' }), '42883');
  });

  it('convidar quem já tem conta liga na hora', async () => {
    const late = client(db, await signUp(db, 'atrasado@clinica.com'));
    await admin('invite_member', { p_email: 'atrasado@clinica.com', p_name: 'Rita Atrasada', p_role: 'recepcao' });
    expect((await late('app_bootstrap')).member.role).toBe('recepcao');
  });

  it('só admin gerencia equipe; admin não se rebaixa', async () => {
    await expectError(rec('list_team'), 'VC403');
    const me = (await admin('app_bootstrap')).member.id;
    await expectError(admin('update_member', { p_id: me, p_role: 'recepcao' }), 'VC409');
  });

  it('usuário desativado perde acesso', async () => {
    const team = await admin('list_team');
    const rita = team.members.find((x: any) => x.email === 'atrasado@clinica.com');
    await admin('update_member', { p_id: rita.id, p_active: false });
    const late = client(db, (await db.query<{ id: string }>(`select id from auth.users where email = 'atrasado@clinica.com'`)).rows[0].id);
    await expectError(late('list_appointments'), 'VC401');
  });
});

describe('agenda', () => {
  it('recepção cria; resposta traz tutor e animal', async () => {
    const a = await rec('save_appointment', { p_id: null, p: appt() });
    expect(a).toMatchObject({ time: '09:00', status: 'agendado', plan: 'DOGLIFE', tutor: { phone: '(83) 98888-7777' }, animal: { name: 'Thor' } });
  });

  it('veterinário não cria', async () => {
    await expectError(vet('save_appointment', { p_id: null, p: appt({ time: '10:00' }) }), 'VC403');
  });

  it('horário ocupado: 409 com nome do animal', async () => {
    const e = await expectError(rec('save_appointment', { p_id: null, p: appt({ animal_name: 'Rex', tutor_phone: '83977776666' }) }), 'VC409');
    expect(e.message).toContain('Thor');
  });

  it('validação devolve erros por campo', async () => {
    const e = await expectError(rec('save_appointment', { p_id: null, p: { service_type: 'plano' } }), 'VC422');
    expect(Object.keys(e.fields)).toEqual(expect.arrayContaining(['tutor_name', 'tutor_phone', 'animal_name', 'date', 'time', 'plan']));
  });

  it('plano exclusivo por espécie', async () => {
    const e = await expectError(rec('save_appointment', { p_id: null, p: appt({ plan: 'CATLIFE', time: '10:00' }) }), 'VC422');
    expect(e.fields.plan).toBe('Catlife é exclusivo para gatos.');
  });

  it('fora da grade e data passada', async () => {
    expect((await expectError(rec('save_appointment', { p_id: null, p: appt({ time: '10:15' }) }), 'VC422')).fields.time).toContain('a cada 30 min');
    expect((await expectError(rec('save_appointment', { p_id: null, p: appt({ date: addDays(today, -1) }) }), 'VC422')).fields.date).toBeTruthy();
  });

  it('mesmo telefone reaproveita tutor e animal (prontuário)', async () => {
    const a = await rec('save_appointment', { p_id: null, p: appt({ tutor_phone: '83988887777', time: '11:00' }) });
    const first = (await rec('list_appointments', { p_q: 'thor' })).data[0];
    expect(a.tutor.id).toBe(first.tutor.id);
    expect(a.animal.id).toBe(first.animal.id);
  });

  it('busca ignora acento e formato do telefone', async () => {
    await rec('save_appointment', { p_id: null, p: appt({ animal_name: 'Pérola', tutor_name: 'João Araújo', tutor_phone: '83911112222', species: 'gato', plan: 'CATLIFE', time: '12:00' }) });
    expect((await rec('list_appointments', { p_q: 'perola' })).data).toHaveLength(1);
    expect((await rec('list_appointments', { p_q: 'joao' })).data).toHaveLength(1);
    expect((await rec('list_appointments', { p_q: '1111-2222' })).data).toHaveLength(1);
  });

  it('horários do dia vêm do servidor, com a data consultada', async () => {
    const s = await rec('get_slots', { p_date: TOMORROW() });
    expect(s.date).toBe(TOMORROW());
    expect(s.slots.find((x: any) => x.time === '09:00')).toMatchObject({ available: false, reason: 'ocupado', animal_name: 'Thor' });
    expect(s.slots.find((x: any) => x.time === '13:00').available).toBe(true);
    expect((await rec('get_slots', { p_date: addDays(today, -1) })).past_day).toBe(true);
  });

  it('editar atendimento antigo sem mudar a data funciona', async () => {
    const a = await rec('save_appointment', { p_id: null, p: appt({ time: '14:00' }) });
    await db.query(`update public.appointments set starts_on = $1 where id = $2`, [addDays(today, -10), a.id]);
    const ed = await rec('save_appointment', { p_id: a.id, p: appt({ date: addDays(today, -10), time: '14:00', notes: 'Retorno em 30 dias' }) });
    expect(ed.notes).toBe('Retorno em 30 dias');
    await expectError(rec('save_appointment', { p_id: a.id, p: appt({ date: addDays(today, -9), time: '14:00' }) }), 'VC422');
  });

  it('paginação por cursor não perde nada', async () => {
    const ids = new Set<string>();
    let cursor: string | null = null;
    do {
      const r: any = await rec('list_appointments', { p_limit: 2, p_cursor: cursor });
      r.data.forEach((a: any) => ids.add(a.id));
      cursor = r.next_cursor;
    } while (cursor);
    const all = (await rec('list_appointments', { p_limit: 500 })).data;
    expect(ids.size).toBe(all.length);
    expect(all.length).toBeGreaterThan(2);
  });

  it('veterinário conclui e anota, não cancela; status "faltou"', async () => {
    const a = await rec('save_appointment', { p_id: null, p: appt({ time: '15:00', vet_id: vetId }) });
    expect(a.vet_name).toBe('Paulo Lima');
    await expectError(vet('set_appointment_status', { p_id: a.id, p_status: 'cancelado' }), 'VC403');
    expect((await vet('set_appointment_notes', { p_id: a.id, p_notes: 'Peso 12 kg' })).notes).toBe('Peso 12 kg');
    expect((await vet('set_appointment_status', { p_id: a.id, p_status: 'concluido' })).status).toBe('concluido');
    const b = await rec('save_appointment', { p_id: null, p: appt({ time: '15:30' }) });
    expect((await rec('set_appointment_status', { p_id: b.id, p_status: 'faltou' })).status).toBe('faltou');
  });

  it('reabrir em horário já ocupado é barrado', async () => {
    const a = await rec('save_appointment', { p_id: null, p: appt({ time: '16:00' }) });
    await rec('set_appointment_status', { p_id: a.id, p_status: 'cancelado' });
    await rec('save_appointment', { p_id: null, p: appt({ animal_name: 'Bob', tutor_phone: '83933334444', time: '16:00' }) });
    await expectError(rec('set_appointment_status', { p_id: a.id, p_status: 'agendado' }), 'VC409');
  });

  it('só admin exclui', async () => {
    const a = await rec('save_appointment', { p_id: null, p: appt({ time: '17:00' }) });
    await expectError(rec('delete_appointment', { p_id: a.id }), 'VC403');
    expect((await admin('delete_appointment', { p_id: a.id })).deleted).toBe(true);
  });
});

describe('liberação de acesso pela plataforma', () => {
  let pedro: ReturnType<typeof client>;

  it('Pedro cria conta: sem liberação não vê nada e pede acesso', async () => {
    pedro = client(db, await signUp(db, 'pedro@gmail.com'));
    const b = await pedro('app_bootstrap');
    expect(b).toMatchObject({ member: null, platform_admin: false, access_request: null });
    expect(Object.keys((await expectError(pedro('request_access', { p_name: 'P', p_phone: '1', p_company_hint: '' }), 'VC422')).fields))
      .toEqual(expect.arrayContaining(['name', 'phone', 'company_hint']));
    const after = await pedro('request_access', { p_name: 'Pedro Henrique', p_phone: '(83) 98765-4321', p_company_hint: 'Amigo Fiel' });
    expect(after.access_request.status).toBe('pending');
    await expectError(pedro('request_access', { p_name: 'Pedro Henrique', p_phone: '83987654321', p_company_hint: 'Amigo Fiel' }), 'VC409');
    await expectError(pedro('list_appointments'), 'VC401');
  });

  it('só o dono da plataforma vê e decide pedidos e empresas', async () => {
    await expectError(admin('platform_list_requests'), 'VC403');
    await expectError(admin('platform_list_companies'), 'VC403');
    await expectError(pedro('platform_save_company', { p_id: null, p: { name: 'Hack' } }), 'VC403');
    expect((await owner('app_bootstrap')).pending_requests).toBe(1);
  });

  it('dono recusa: Pedro vê o motivo e pode pedir de novo', async () => {
    const req = (await owner('platform_list_requests', { p_status: 'pending' }))[0];
    await owner('platform_decide_request', { p_id: req.id, p_approve: false, p_reason: 'Não reconhecemos a clínica' });
    const b = await pedro('app_bootstrap');
    expect(b.access_request).toMatchObject({ status: 'rejected', reject_reason: 'Não reconhecemos a clínica' });
    expect((await pedro('request_access', { p_name: 'Pedro Henrique', p_phone: '83987654321', p_company_hint: 'Amigo Fiel, recepção' })).access_request.status).toBe('pending');
  });

  it('dono aprova na empresa e perfil escolhidos; Pedro passa a usar', async () => {
    const req = (await owner('platform_list_requests', { p_status: 'pending' }))[0];
    await expectError(owner('platform_decide_request', { p_id: req.id, p_approve: true, p_clinic_id: clinicId }), 'VC422');
    await owner('platform_decide_request', { p_id: req.id, p_approve: true, p_clinic_id: clinicId, p_role: 'recepcao' });
    await expectError(owner('platform_decide_request', { p_id: req.id, p_approve: true, p_clinic_id: clinicId, p_role: 'recepcao' }), 'VC409');
    const b = await pedro('app_bootstrap');
    expect(b.member).toMatchObject({ name: 'Pedro Henrique', role: 'recepcao' });
    expect((await pedro('list_appointments')).data.length).toBeGreaterThan(0);
  });

  it('suspender a empresa bloqueia todos dela na hora; reativar devolve', async () => {
    const c = await owner('platform_get_company', { p_id: clinicId });
    await owner('platform_save_company', { p_id: clinicId, p: { ...c, active: false } });
    await expectError(rec('list_appointments'), 'VC401');
    expect((await rec('app_bootstrap')).blocked).toBe('company_suspended');
    expect((await other('list_appointments')).data).toBeDefined(); // outras empresas seguem
    await owner('platform_save_company', { p_id: clinicId, p: { ...c, active: true } });
    expect((await rec('list_appointments')).data).toBeDefined();
  });

  it('dono gerencia pessoas de qualquer empresa e tudo fica auditado', async () => {
    const c = await owner('platform_get_company', { p_id: clinicId });
    const pedroM = c.people.find((x: any) => x.email === 'pedro@gmail.com');
    await owner('platform_set_member', { p_member_id: pedroM.id, p_active: false });
    await expectError(pedro('list_appointments'), 'VC401');
    const { rows } = await db.query<{ action: string }>('select distinct action from public.platform_audit');
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['create', 'approve', 'reject', 'suspend', 'reactivate', 'update']));
  });

  it('validação de empresa: CPF/CNPJ e telefone', async () => {
    const e = await expectError(owner('platform_save_company', { p_id: null, p: { name: 'X', document: '123', contact_phone: '1' } }), 'VC422');
    expect(Object.keys(e.fields)).toEqual(expect.arrayContaining(['name', 'document', 'contact_phone']));
  });
});

describe('dono da plataforma: visão de atendimentos (suporte e geral)', () => {
  it('só o dono acessa', async () => {
    await expectError(admin('platform_list_appointments'), 'VC403');
    await expectError(admin('platform_overview'), 'VC403');
    await expectError(rec('platform_get_appointment', { p_id: (await rec('list_appointments')).data[0].id }), 'VC403');
  });

  it('visão geral: atendimentos de todas as empresas, com o nome da empresa', async () => {
    await other('save_appointment', { p_id: null, p: appt({ animal_name: 'Fred', tutor_phone: '83955556666', time: '10:00' }) });
    const all = await owner('platform_list_appointments', { p_limit: 200 });
    const companies = new Set(all.data.map((a: any) => a.clinic.name));
    expect(companies).toEqual(new Set(['Clínica Amigo Fiel', 'Outra Clínica']));
  });

  it('suporte: filtra uma empresa só, com busca e paginação', async () => {
    const one = await owner('platform_list_appointments', { p_clinic: otherClinicId });
    expect(one.data.every((a: any) => a.clinic.id === otherClinicId)).toBe(true);
    expect((await owner('platform_list_appointments', { p_q: 'fred' })).data).toHaveLength(1);
    const ids = new Set<string>();
    let cursor: string | null = null;
    do {
      const r: any = await owner('platform_list_appointments', { p_clinic: clinicId, p_limit: 2, p_cursor: cursor });
      r.data.forEach((a: any) => ids.add(a.id));
      cursor = r.next_cursor;
    } while (cursor);
    expect(ids.size).toBe((await rec('list_appointments', { p_limit: 500 })).data.length);
  });

  it('detalhe e resumo por empresa', async () => {
    const a = (await owner('platform_list_appointments', { p_clinic: otherClinicId })).data[0];
    expect((await owner('platform_get_appointment', { p_id: a.id })).clinic.name).toBe('Outra Clínica');
    const ov = await owner('platform_overview');
    expect(ov.companies.map((c: any) => c.name)).toEqual(expect.arrayContaining(['Clínica Amigo Fiel', 'Outra Clínica']));
    expect(ov.companies.find((c: any) => c.name === 'Outra Clínica').next_7d).toBeGreaterThan(0);
  });

  it('cada consulta fica registrada (uma por busca, não por página)', async () => {
    const before = (await db.query<{ n: number }>(`select count(*)::int n from public.platform_audit where action = 'view_appointments'`)).rows[0].n;
    const r1 = await owner('platform_list_appointments', { p_clinic: clinicId, p_limit: 1 });
    await owner('platform_list_appointments', { p_clinic: clinicId, p_limit: 1, p_cursor: r1.next_cursor });
    const { rows } = await db.query<{ n: number; scope: string }>(
      `select count(*)::int n, max(data->>'scope') scope from public.platform_audit where action = 'view_appointments'`);
    expect(rows[0].n).toBe(before + 1);
    const views = await db.query(`select 1 from public.platform_audit where action = 'view_appointment'`);
    expect(views.rows.length).toBeGreaterThan(0);
  });
});

describe('pacote de melhorias', () => {
  let vet2Id: string;
  const D = () => addDays(today, 3);

  it('agenda por veterinário: dois vets no mesmo horário; sem preferência ocupa o horário todo', async () => {
    await admin('invite_member', { p_email: 'vet2@clinica.com', p_name: 'Joana Prado', p_role: 'veterinario' });
    const vet2 = client(db, await signUp(db, 'vet2@clinica.com'));
    vet2Id = (await vet2('app_bootstrap')).member.id;

    await rec('save_appointment', { p_id: null, p: appt({ date: D(), time: '13:00', vet_id: vetId }) });
    const b = await rec('save_appointment', { p_id: null, p: appt({ date: D(), time: '13:00', vet_id: vet2Id, animal_name: 'Rex', tutor_phone: '83912121212' }) });
    expect(b.vet_name).toBe('Joana Prado');
    const e = await expectError(rec('save_appointment', { p_id: null, p: appt({ date: D(), time: '13:00', vet_id: vetId, animal_name: 'Nina', tutor_phone: '83913131313' }) }), 'VC409');
    expect(e.message).toContain('com Paulo Lima');
    await expectError(rec('save_appointment', { p_id: null, p: appt({ date: D(), time: '13:00', animal_name: 'Lola', tutor_phone: '83914141414' }) }), 'VC409');

    await rec('save_appointment', { p_id: null, p: appt({ date: D(), time: '14:00', animal_name: 'Max', tutor_phone: '83915151515' }) });
    await expectError(rec('save_appointment', { p_id: null, p: appt({ date: D(), time: '14:00', vet_id: vet2Id, animal_name: 'Kiko', tutor_phone: '83916161616' }) }), 'VC409');
  });

  it('horários livres por veterinário', async () => {
    const slot = async (vet: string | null, t: string) =>
      (await rec('get_slots', { p_date: D(), p_vet: vet })).slots.find((x: any) => x.time === t);
    expect((await slot(vetId, '13:00')).available).toBe(false);
    expect((await slot(null, '13:00')).available).toBe(false);
    expect((await slot(vetId, '14:00')).available).toBe(false);
    expect((await slot(vetId, '15:00')).available).toBe(true);
    const other = (await rec('get_slots', { p_date: D(), p_vet: vet2Id })).slots.find((x: any) => x.time === '13:00');
    expect(other.available).toBe(false);
  });

  it('reserva simultânea do mesmo horário e vet: só uma passa', async () => {
    const [x, y] = await Promise.allSettled([
      rec('save_appointment', { p_id: null, p: appt({ date: D(), time: '16:00', vet_id: vetId, animal_name: 'Zeca', tutor_phone: '83917171717' }) }),
      rec('save_appointment', { p_id: null, p: appt({ date: D(), time: '16:00', vet_id: vetId, animal_name: 'Teco', tutor_phone: '83918181818' }) })
    ]);
    expect([x.status, y.status].sort()).toEqual(['fulfilled', 'rejected']);
  });

  it('lembretes: marca enviado; mudar data/hora zera; veterinário não marca', async () => {
    const a = await rec('save_appointment', { p_id: null, p: appt({ date: D(), time: '17:00', animal_name: 'Biscoito', tutor_phone: '83919191919' }) });
    expect(a.reminder_sent_at).toBeNull();
    expect((await rec('mark_reminder_sent', { p_id: a.id })).reminder_sent_at).not.toBeNull();
    await expectError(vet('mark_reminder_sent', { p_id: a.id }), 'VC403');
    const same = await rec('save_appointment', { p_id: a.id, p: appt({ date: D(), time: '17:00', animal_name: 'Biscoito', tutor_phone: '83919191919', notes: 'x' }) });
    expect(same.reminder_sent_at).not.toBeNull();
    const moved = await rec('save_appointment', { p_id: a.id, p: appt({ date: D(), time: '17:30', animal_name: 'Biscoito', tutor_phone: '83919191919' }) });
    expect(moved.reminder_sent_at).toBeNull();
  });

  it('LGPD: aceite dos termos fica registrado por versão', async () => {
    const u = client(db, await signUp(db, 'novo@gmail.com'));
    expect((await u('app_bootstrap')).terms_version).toBeNull();
    await expectError(u('accept_terms', { p_version: 'qualquer' }), 'VC422');
    expect((await u('accept_terms', { p_version: '2026-11' })).terms_version).toBe('2026-11');
    expect((await u('accept_terms', { p_version: '2026-11' })).terms_version).toBe('2026-11');
    const { rows } = await db.query(`select document from public.user_consents where version = '2026-11' order by document`);
    expect(rows.map((r: any) => r.document)).toEqual(['privacy', 'terms']);
  });

  it('registro de acessos: só o dono vê, com e-mail e empresa', async () => {
    await expectError(admin('platform_list_audit'), 'VC403');
    const log = await owner('platform_list_audit', { p_limit: 500 });
    expect(log.length).toBeGreaterThan(5);
    expect(log[0].actor).toBe('dono@pontual.com');
    expect(log.some((l: any) => l.action === 'view_appointments' && l.company === 'Clínica Amigo Fiel')).toBe(true);
    const older = await owner('platform_list_audit', { p_limit: 5, p_before: log[2].id });
    expect(older.every((l: any) => l.id < log[2].id)).toBe(true);
  });
});

describe('pacientes, painel e isolamento', () => {
  it('ficha do tutor com animais e histórico', async () => {
    const found = await rec('search_patients', { p_q: 'thor' });
    expect(found[0].animals[0].name).toBe('Thor');
    const t = await rec('get_tutor', { p_id: found[0].id });
    expect(t.history.length).toBeGreaterThan(2);
    const up = await rec('update_tutor', { p_id: t.id, p: { name: 'Maria Oliveira Santos', phone: '83988887777', email: 'maria@email.com' } });
    expect(up.name).toBe('Maria Oliveira Santos');
  });

  it('painel traz totais, planos e próximos 7 dias', async () => {
    const d = await vet('dashboard');
    expect(d.next_days).toHaveLength(7);
    expect(d.totals.upcoming).toBeGreaterThan(0);
  });

  it('outra clínica não enxerga nada desta', async () => {
    const mine = new Set((await rec('list_appointments', { p_limit: 500 })).data.map((a: any) => a.id));
    expect((await other('list_appointments', { p_limit: 500 })).data.some((a: any) => mine.has(a.id))).toBe(false);
    expect((await other('search_patients', { p_q: 'thor' }))).toEqual([]);
    const id = (await rec('list_appointments')).data[0].id;
    await expectError(other('get_appointment', { p_id: id }), 'VC404');
  });

  it('configurações: horário da clínica muda a grade', async () => {
    await expectError(rec('update_clinic', { p: {} }), 'VC403');
    const b = await admin('update_clinic', { p: { name: 'Clínica Amigo Fiel', timezone: 'America/Fortaleza', open_time: '08:00', close_time: '18:00', slot_minutes: 20 } });
    expect(b.clinic).toMatchObject({ open_time: '08:00', close_time: '18:00', slot_minutes: 20 });
    expect((await rec('get_slots', { p_date: TOMORROW() })).slots.map((s: any) => s.time).slice(0, 3)).toEqual(['08:00', '08:20', '08:40']);
  });

  it('planos: cria, desativa, e desativado some do agendamento', async () => {
    await admin('save_plan', { p_id: null, p: { code: 'VETSAUDE', name: 'Vet Saúde', species: null } });
    let plans = await admin('list_plans');
    const vs = plans.find((p: any) => p.code === 'VETSAUDE');
    await admin('save_plan', { p_id: vs.id, p: { name: 'Vet Saúde', active: false } });
    await expectError(rec('save_appointment', { p_id: null, p: appt({ plan: 'VETSAUDE', time: '10:00' }) }), 'VC422');
  });

  it('admin redefine a senha de alguém da equipe; outros perfis não', async () => {
    const team = await admin('list_team');
    const carla = team.members.find((x: any) => x.email === 'rec@clinica.com');
    await expectError(rec('admin_reset_password', { p_member_id: carla.id, p_new_password: 'temporaria123' }), 'VC403');
    expect((await expectError(admin('admin_reset_password', { p_member_id: carla.id, p_new_password: '123' }), 'VC422')).fields.password).toBeTruthy();
    expect((await admin('admin_reset_password', { p_member_id: carla.id, p_new_password: 'temporaria123' })).ok).toBe(true);
    const { rows } = await db.query<{ ok: boolean }>(`select encrypted_password = extensions.crypt('temporaria123', encrypted_password) ok from auth.users where email = 'rec@clinica.com'`);
    expect(rows[0].ok).toBe(true);
    const outsider = (await other('app_bootstrap')).member.id;
    await expectError(admin('admin_reset_password', { p_member_id: outsider, p_new_password: 'temporaria123' }), 'VC404');
  });

  it('auditoria registra quem fez', async () => {
    const { rows } = await db.query<{ action: string }>(`select distinct action from public.audit_log where entity = 'appointment'`);
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['create', 'update', 'status', 'notes', 'delete']));
  });
});
