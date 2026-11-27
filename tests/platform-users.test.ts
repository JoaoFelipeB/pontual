import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { client, freshDb, RpcError, signUp } from './db';

let db: PGlite;
let owner: ReturnType<typeof client>;
let ownerId: string;
let clinicA: string;
let clinicB: string;

async function expectError(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) { expect((e as RpcError).code).toBe(code); return e as RpcError; }
  throw new Error(`expected ${code}`);
}

beforeAll(async () => {
  db = await freshDb();
  ownerId = await signUp(db, 'dono@pontual.com');
  await db.query('insert into public.platform_admins (user_id) values ($1)', [ownerId]);
  owner = client(db, ownerId);
  clinicA = (await owner('platform_save_company', { p_id: null, p: { name: 'Clínica A' } })).id;
  clinicB = (await owner('platform_save_company', { p_id: null, p: { name: 'Clínica B' } })).id;
});

describe('gestão de usuários pelo dono da plataforma', () => {
  it('cria acesso para uma conta recém-criada e a pessoa já usa o sistema', async () => {
    const uid = await signUp(db, 'carla@gmail.com'); // the app creates the login
    const found = await owner('platform_find_user', { p_email: 'Carla@Gmail.com' });
    expect(found.user_id).toBe(uid);
    const u = await owner('platform_save_user', { p_user_id: uid, p: { name: 'Carla Mendes', clinic_id: clinicA, role: 'recepcao' } });
    expect(u).toMatchObject({ name: 'Carla Mendes', clinic_name: 'Clínica A', role: 'recepcao', active: true });
    expect((await client(db, uid)('app_bootstrap')).member.role).toBe('recepcao');
  });

  it('validação de campos', async () => {
    const uid = await signUp(db, 'semdados@gmail.com');
    const e = await expectError(owner('platform_save_user', { p_user_id: uid, p: {} }), 'VC422');
    expect(Object.keys(e.fields)).toEqual(expect.arrayContaining(['name', 'clinic_id', 'role']));
  });

  it('edita perfil, troca de empresa e bloqueia', async () => {
    const carla = (await owner('platform_find_user', { p_email: 'carla@gmail.com' }));
    const moved = await owner('platform_save_user', { p_user_id: carla.user_id, p: { name: 'Carla M.', clinic_id: clinicB, role: 'admin' } });
    expect(moved).toMatchObject({ clinic_name: 'Clínica B', role: 'admin', name: 'Carla M.' });
    await owner('platform_save_user', { p_user_id: carla.user_id, p: { name: 'Carla M.', clinic_id: clinicB, role: 'admin', active: false } });
    await expectError(client(db, carla.user_id)('list_appointments'), 'VC401');
  });

  it('pedido pendente é resolvido quando o dono dá o acesso', async () => {
    const uid = await signUp(db, 'pedro@gmail.com');
    const pedro = client(db, uid);
    await pedro('request_access', { p_name: 'Pedro Henrique', p_phone: '83987654321', p_company_hint: 'Clínica A' });
    await owner('platform_save_user', { p_user_id: uid, p: { name: 'Pedro Henrique', clinic_id: clinicA, role: 'veterinario' } });
    expect((await owner('platform_list_requests', { p_status: 'pending' }))).toHaveLength(0);
  });

  it('lista todo mundo com status e busca', async () => {
    const all = await owner('platform_list_users');
    expect(all.map((u: any) => u.email)).toEqual(expect.arrayContaining(['dono@pontual.com', 'carla@gmail.com', 'pedro@gmail.com', 'semdados@gmail.com']));
    expect((await owner('platform_list_users', { p_q: 'clínica a' })).every((u: any) => u.clinic_name === 'Clínica A')).toBe(true);
    expect(all.find((u: any) => u.email === 'dono@pontual.com').platform_admin).toBe(true);
  });

  it('redefine senha, remove acesso e gerencia donos (sem se remover)', async () => {
    const pedro = await owner('platform_find_user', { p_email: 'pedro@gmail.com' });
    await expectError(owner('platform_reset_password', { p_user_id: pedro.user_id, p_new_password: '123' }), 'VC422');
    await owner('platform_reset_password', { p_user_id: pedro.user_id, p_new_password: 'temporaria123' });
    const { rows } = await db.query<{ ok: boolean }>(`select encrypted_password = extensions.crypt('temporaria123', encrypted_password) ok from auth.users where id = $1`, [pedro.user_id]);
    expect(rows[0].ok).toBe(true);

    expect((await owner('platform_remove_access', { p_user_id: pedro.user_id })).member_id).toBeNull();
    await expectError(owner('platform_remove_access', { p_user_id: ownerId }), 'VC409');

    expect((await owner('platform_set_owner', { p_user_id: pedro.user_id, p_owner: true })).platform_admin).toBe(true);
    await expectError(owner('platform_set_owner', { p_user_id: ownerId, p_owner: false }), 'VC409');
    expect((await owner('platform_set_owner', { p_user_id: pedro.user_id, p_owner: false })).platform_admin).toBe(false);
  });

  it('só o dono usa essas funções e tudo fica registrado', async () => {
    const carla = await owner('platform_find_user', { p_email: 'carla@gmail.com' });
    await expectError(client(db, carla.user_id)('platform_list_users'), 'VC403');
    const { rows } = await db.query<{ action: string }>(`select distinct action from public.platform_audit where entity = 'user'`);
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['grant', 'update', 'reset_password', 'remove_access', 'grant_owner', 'revoke_owner']));
  });
});
