// Local stand-in for Supabase (Auth + PostgREST RPC) on top of PGlite, used to
// test the real app and the real SQL without a Supabase account.
//   node tests/fake-supabase.mjs [port] [distDir]
import http from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = Number(process.argv[2] ?? 54321);
const DIST = process.argv[3];
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(readFileSync(join(ROOT, 'tests/supabase-stub.sql'), 'utf8'));
for (const f of readdirSync(join(ROOT, 'supabase/migrations')).sort()) await db.exec(readFileSync(join(ROOT, 'supabase/migrations', f), 'utf8'));

const passwords = new Map();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const userJson = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
const session = (u) => ({ access_token: token(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r-' + u.id, user: userJson(u) });

async function signUp(email, password) {
  await db.exec('reset role');
  const { rows } = await db.query('insert into auth.users (email) values ($1) returning id, email', [email.toLowerCase()]);
  passwords.set(email.toLowerCase(), password);
  return rows[0];
}
async function rpc(userId, fn, args) {
  const names = Object.keys(args);
  const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`;
  const vals = names.map((n) => (args[n] !== null && typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n]));
  await db.exec(`reset role; set request.jwt.claim.sub = '${userId ?? ''}'; set role ${userId ? 'authenticated' : 'anon'};`);
  try { return (await db.query(sql, vals)).rows[0].r; } finally { await db.exec('reset role'); }
}
const userFromAuth = (req) => {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()); } catch { return null; }
};

// ---------------------------------------------------------------- demo data
export async function seed() {
  const today = (await db.query(`select (now() at time zone 'America/Sao_Paulo')::date::text d`)).rows[0].d;
  const add = (n) => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  // platform owner + one client company; the clinic admin is approved like any new user
  const owner = await signUp('dono@demo.com', 'dono12345');
  await db.query('insert into public.platform_admins (user_id) values ($1)', [owner.id]);
  const company = await rpc(owner.id, 'platform_save_company', { p_id: null, p: { name: 'Clínica Veterinária Amigo Fiel', document: '12345678000190', contact_name: 'Ana Souza', contact_phone: '83988880000' } });
  await rpc(owner.id, 'platform_save_company', { p_id: null, p: { name: 'PetVida Centro Veterinário', contact_name: 'Roberto Nunes' } });
  const admin = await signUp('admin@demo.com', 'admin12345');
  await rpc(admin.id, 'request_access', { p_name: 'Ana Souza', p_phone: '83988880000', p_company_hint: 'Amigo Fiel' });
  const req = (await rpc(owner.id, 'platform_list_requests', { p_status: 'pending' }))[0];
  await rpc(owner.id, 'platform_decide_request', { p_id: req.id, p_approve: true, p_clinic_id: company.id, p_role: 'admin' });
  await rpc(admin.id, 'invite_member', { p_email: 'vet@demo.com', p_name: 'Dr. Paulo Lima', p_role: 'veterinario' });
  await rpc(admin.id, 'invite_member', { p_email: 'rec@demo.com', p_name: 'Carla Mendes', p_role: 'recepcao' });
  await rpc(admin.id, 'invite_member', { p_email: 'joana.vet@demo.com', p_name: 'Dra. Joana Prado', p_role: 'veterinario' });
  const vet = await signUp('vet@demo.com', 'senha12345');
  await signUp('rec@demo.com', 'senha12345');
  const vetId = (await rpc(vet.id, 'app_bootstrap', {})).member.id;
  const A = (tn, ph, an, sp, br, sex, age, d, t, st, pl, reason, vetOn) => ({ tutor_name: tn, tutor_phone: ph, animal_name: an, species: sp, breed: br, sex, age_value: age, date: d, time: t, service_type: pl ? 'plano' : 'particular', plan: pl, reason, vet_id: vetOn ? vetId : null, _st: st });
  const list = [
    A('Joana Ribeiro', '83912345678', 'Bidu', 'cao', 'Shih-tzu', 'macho', 5, add(0), '08:00', 'concluido', 'PETLOVE', 'Consulta de rotina', true),
    A('Marcos Tavares', '83987651234', 'Mel', 'cao', 'Golden Retriever', 'femea', 8, add(0), '09:30', 'faltou', null, 'Dor na pata traseira', true),
    A('Maria Oliveira', '83988887777', 'Thor', 'cao', 'SRD', 'macho', 3, add(0), '17:00', 'agendado', 'DOGLIFE', 'Vacinação anual (V10)', true),
    A('Carlos Pereira', '83955554444', 'Luna', 'gato', 'Siamês', 'femea', 1, add(0), '18:30', 'agendado', 'CATLIFE', 'Castração: avaliação pré-cirúrgica', false),
    A('Fernanda Alves', '83933332222', 'Pipoca', 'outro', 'Coelho mini lop', 'femea', 2, add(1), '09:00', 'agendado', null, 'Avaliação dentária', false),
    A('Rafael Costa', '83944441111', 'Nino', 'gato', 'Persa', 'macho', 6, add(1), '10:30', 'agendado', 'PETLIFE', 'Exames de rotina', true),
    A('Joana Ribeiro', '83912345678', 'Bidu', 'cao', 'Shih-tzu', 'macho', 5, add(2), '14:00', 'agendado', 'PETLOVE', 'Retorno', true),
    A('Lucas Martins', '83977776666', 'Nina', 'gato', null, 'femea', 2, add(3), '11:00', 'agendado', 'PETLOVE', 'Vacina antirrábica', false),
    A('Patrícia Gomes', '83922223333', 'Zeus', 'cao', 'Pastor Alemão', 'macho', 4, add(3), '15:30', 'agendado', null, 'Dermatite', true),
    A('Bruno Farias', '83966665555', 'Amora', 'cao', 'Poodle', 'femea', 10, add(5), '08:30', 'agendado', 'PETLIFE', 'Check-up geriátrico', true)
  ];
  for (const x of list) {
    const { _st, ...p } = x;
    const realDate = p.date;
    const r = await rpc(admin.id, 'save_appointment', { p_id: null, p: { ...p, date: add(1), time: p.time } }).catch(async () => null)
      ?? await rpc(admin.id, 'save_appointment', { p_id: null, p: { ...p, date: add(7), time: p.time } });
    await db.query('update public.appointments set starts_on = $1 where id = $2', [realDate, r.id]);
    if (_st !== 'agendado') await db.query('update public.appointments set status = $1 where id = $2', [_st, r.id]);
  }
  // some history
  const hist = [[-12, '10:00', 'Bidu', 'Vermifugação'], [-40, '09:00', 'Bidu', 'Vacina V10'], [-20, '16:00', 'Thor', 'Consulta']];
  for (const [n, t, an, reason] of hist) {
    const tutor = an === 'Bidu' ? ['Joana Ribeiro', '83912345678'] : ['Maria Oliveira', '83988887777'];
    const r = await rpc(admin.id, 'save_appointment', { p_id: null, p: { tutor_name: tutor[0], tutor_phone: tutor[1], animal_name: an, species: 'cao', date: add(6), time: '07:00', service_type: 'particular', reason } });
    await db.query(`update public.appointments set starts_on = $1, starts_at = $2, status = 'concluido', notes = $3 where id = $4`, [add(n), t, an === 'Bidu' ? 'Peso 7,2 kg. Sem alterações.' : null, r.id]);
  }
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
http.createServer(async (req, res) => {
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' });
    res.end(body === undefined ? '' : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') return send(204);
  let raw = '';
  for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/auth/v1/token') {
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const id = String(body.refresh_token).slice(2);
        const u = (await db.query('select id, email from auth.users where id = $1', [id])).rows[0];
        return u ? send(200, session(u)) : send(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
      }
      const u = (await db.query('select id, email from auth.users where lower(email) = lower($1)', [body.email])).rows[0];
      const viaHash = u && (await db.query('select encrypted_password is not null and encrypted_password = extensions.crypt($1, encrypted_password) ok from auth.users where id = $2', [body.password, u.id])).rows[0]?.ok;
      if (!u || (passwords.get(u.email) !== body.password && !viaHash)) return send(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return send(200, session(u));
    }
    if (url.pathname === '/auth/v1/signup') {
      if ((await db.query('select 1 from auth.users where lower(email) = lower($1)', [body.email])).rows.length) return send(422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
      return send(200, session(await signUp(body.email, body.password)));
    }
    if (url.pathname === '/auth/v1/recover') {
      // the real Supabase e-mails the code; here it is always 123456
      return send(200, {});
    }
    if (url.pathname === '/auth/v1/verify') {
      const u = (await db.query('select id, email from auth.users where lower(email) = lower($1)', [body.email])).rows[0];
      if (!u || body.token !== '123456') return send(403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
      return send(200, session(u));
    }
    if (url.pathname === '/auth/v1/user' && req.method === 'PUT') {
      const c = userFromAuth(req);
      if (!c) return send(401, { msg: 'invalid JWT' });
      if (body.password) passwords.set(c.email.toLowerCase(), body.password);
      return send(200, userJson({ id: c.sub, email: c.email }));
    }
    if (url.pathname === '/auth/v1/user') {
      const c = userFromAuth(req);
      return c ? send(200, userJson({ id: c.sub, email: c.email })) : send(401, { msg: 'invalid JWT' });
    }
    if (url.pathname === '/auth/v1/logout') return send(204);
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const c = userFromAuth(req);
      try { return send(200, await rpc(c?.sub ?? null, url.pathname.split('/').pop(), body)); }
      catch (e) { return send(e.code === '42501' ? 401 : 400, { code: e.code, message: e.message, details: e.detail ?? null, hint: null }); }
    }
    if (DIST) {
      const p = url.pathname === '/' ? '/index.html' : url.pathname;
      const f = join(DIST, p);
      if (existsSync(f)) return send(200, readFileSync(f), TYPES[extname(f)] ?? 'application/octet-stream');
    }
    send(404, { message: 'not found' });
  } catch (e) { console.error(e); send(500, { message: String(e) }); }
}).listen(PORT, async () => {
  if (process.env.SEED) await seed();
  console.log('fake supabase on', PORT);
});
