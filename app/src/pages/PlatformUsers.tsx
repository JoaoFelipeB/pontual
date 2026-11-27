import { useEffect, useState } from 'react';
import { Copy, KeyRound, Search, ShieldCheck, UserMinus, UserPlus, Users } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { fmtDate, initials, ROLE_LABEL } from '../lib/format';
import type { Company, PlatformUser } from '../lib/types';
import { Button, Confirm, Drawer, Empty, Field, Input, Select, Spinner, toast, useDebounced } from '../components/ui';

function tempPassword() {
  const words = ['gato', 'cao', 'pata', 'osso', 'bola', 'vacina', 'racao', 'coleira', 'focinho', 'rabo', 'agenda', 'clinica'];
  const n = () => crypto.getRandomValues(new Uint32Array(1))[0];
  return `${words[n() % words.length]}-${words[n() % words.length]}-${1000 + (n() % 9000)}`;
}

function statusOf(u: PlatformUser): { label: string; cls: string } {
  if (u.member_id && u.clinic_active === false) return { label: 'Empresa suspensa', cls: 'status-cancelado' };
  if (u.member_id && !u.active) return { label: 'Bloqueado', cls: 'status-cancelado' };
  if (u.member_id) return { label: 'Ativo', cls: 'status-concluido' };
  if (u.platform_admin) return { label: 'Só plataforma', cls: 'status-agendado' };
  if (u.request_status === 'pending') return { label: 'Aguardando liberação', cls: 'status-faltou' };
  if (u.request_status === 'rejected') return { label: 'Recusado', cls: 'status-cancelado' };
  return { label: 'Sem acesso', cls: 'status-cancelado' };
}

/** Every account in the system: create, edit, move between companies, block, reset password, owners. */
export function PlatformUsers() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [items, setItems] = useState<PlatformUser[] | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [edit, setEdit] = useState<PlatformUser | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () => api.platformUsers(dq).then(setItems).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.platformCompanies().then(setCompanies).catch(() => {}); }, []);

  return (
    <section className="card list-card">
      <div className="filters">
        <div className="search-box">
          <Search size={16} />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, e-mail ou empresa" aria-label="Buscar usuário" />
        </div>
        <Button variant="primary" icon={<UserPlus size={16} />} onClick={() => setCreating(true)}>Novo usuário</Button>
      </div>
      {!items ? <Spinner /> : !items.length ? (
        <Empty icon={<Users size={22} />} title="Nenhum usuário encontrado" />
      ) : (
        <table className="table">
          <thead><tr><th>Pessoa</th><th className="hide-sm">Empresa</th><th className="hide-sm">Perfil</th><th>Situação</th><th className="hide-md">Último acesso</th></tr></thead>
          <tbody>
            {items.map((u) => {
              const st = statusOf(u);
              return (
                <tr key={u.user_id} onClick={() => setEdit(u)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setEdit(u)}>
                  <td>
                    <span className="person">
                      <span className="avatar sm">{initials(u.name ?? u.email)}</span>
                      <span className="cell-two"><b>{u.name ?? '—'}{u.platform_admin && <span className="owner-tag" title="Dono da plataforma"><ShieldCheck size={13} /></span>}</b><small>{u.email}</small></span>
                    </span>
                  </td>
                  <td className="hide-sm">{u.clinic_name ?? <span className="muted">{u.request_company_hint ? `pediu: ${u.request_company_hint}` : '—'}</span>}</td>
                  <td className="hide-sm">{u.role ? ROLE_LABEL[u.role] : '—'}</td>
                  <td><span className={`status ${st.cls}`}><i />{st.label}</span></td>
                  <td className="hide-md muted num">{u.last_sign_in_at ? fmtDate(u.last_sign_in_at.slice(0, 10)) : 'nunca'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <CreateUser open={creating} companies={companies} onClose={() => setCreating(false)} onDone={() => { setCreating(false); load(); }} />
      <EditUser key={edit?.user_id ?? 'none'} user={edit} companies={companies} onClose={() => setEdit(null)} onChanged={(u) => { setEdit(u); load(); }} />
    </section>
  );
}

function Credentials({ email, password }: { email: string; password: string }) {
  const text = `Acesso ao Pontual\nE-mail: ${email}\nSenha temporária: ${password}\nApp: baixe em github.com/JoaoFelipeB/pontual/releases (Android) ou use pelo navegador.\nTroque a senha depois de entrar (ícone de chave ao lado do seu nome).`;
  return (
    <div className="creds">
      <dl className="dl">
        <dt>E-mail</dt><dd><b>{email}</b></dd>
        <dt>Senha temporária</dt><dd><b className="num">{password}</b></dd>
      </dl>
      <Button size="sm" icon={<Copy size={15} />} onClick={() => navigator.clipboard?.writeText(text).then(() => toast.ok('Copiado. Cole no WhatsApp da pessoa.'))}>
        Copiar mensagem para enviar
      </Button>
    </div>
  );
}

function CreateUser({ open, companies, onClose, onDone }: { open: boolean; companies: Company[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', email: '', clinic_id: '', role: 'recepcao', password: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ email: string; password: string; created: boolean } | null>(null);
  useEffect(() => { if (open) { setF({ name: '', email: '', clinic_id: '', role: 'recepcao', password: tempPassword() }); setErr({}); setDone(null); } }, [open]);

  async function save() {
    setBusy(true);
    try {
      const r = await api.platformCreateUser(f);
      setDone({ email: r.user.email, password: f.password, created: r.created });
      toast.ok(r.created ? 'Usuário criado.' : 'Esta pessoa já tinha conta: acesso liberado.');
    } catch (e) { if (e instanceof ApiError) { setErr(e.fields); toast.error(e.message); } }
    finally { setBusy(false); }
  }
  return (
    <Drawer open={open} onClose={done ? onDone : onClose} title={<h2>Novo usuário</h2>}
      footer={done ? <Button variant="primary" onClick={onDone}>Concluir</Button>
        : <><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Criar usuário</Button></>}>
      {done ? (
        <div className="form-section">
          {done.created
            ? <p>Conta criada. Envie os dados abaixo para a pessoa. No primeiro acesso ela aceita os termos e já entra.</p>
            : <p>Este e-mail já tinha conta no Pontual, então só liberamos o acesso. A pessoa entra com a senha que ela já usa; se esqueceu, use <b>Redefinir senha</b> na lista.</p>}
          {done.created && <Credentials email={done.email} password={done.password} />}
        </div>
      ) : (
        <div className="form-section">
          <Field label="Nome completo" required error={err.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="E-mail (login)" required error={err.email}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Empresa" required error={err.clinic_id}>
            <Select value={f.clinic_id} onChange={(e) => setF({ ...f, clinic_id: e.target.value })}>
              <option value="">Escolha…</option>
              {companies.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Perfil" required error={err.role}>
            <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              <option value="admin">Administrador da clínica</option><option value="recepcao">Recepção</option><option value="veterinario">Veterinário</option>
            </Select>
          </Field>
          <Field label="Senha temporária" error={err.password} hint="A pessoa troca depois de entrar.">
            <div className="input-group">
              <Input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="off" />
              <Button type="button" onClick={() => setF({ ...f, password: tempPassword() })}>Gerar</Button>
            </div>
          </Field>
        </div>
      )}
    </Drawer>
  );
}

function EditUser({ user, companies, onClose, onChanged }: {
  user: PlatformUser | null; companies: Company[]; onClose: () => void; onChanged: (u: PlatformUser) => void;
}) {
  const { boot, refresh } = useSession();
  // filled from the user on the first render (the drawer is re-created per user, see key in PlatformUsers)
  const [f, setF] = useState<{ name: string; clinic_id: string; role: string; active: boolean }>(() => ({ name: user?.name ?? '', clinic_id: user?.clinic_id ?? '', role: user?.role ?? 'recepcao', active: user?.active ?? true }));
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [reset, setReset] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'remove' | 'owner' | null>(null);
  const isMe = user?.user_id === boot?.user.id;

  async function run(key: string, fn: () => Promise<PlatformUser>, ok: string) {
    setBusy(key);
    try { const u = await fn(); onChanged(u); toast.ok(ok); if (isMe) await refresh(); }
    catch (e) { if (e instanceof ApiError) { setErr(e.fields); toast.error(e.message); } }
    finally { setBusy(null); setConfirm(null); }
  }

  if (!user) return null;
  return (
    <>
      <Drawer open={!!user} onClose={onClose} title={<><h2>{user.name ?? user.email}</h2><small>{user.email}</small></>}
        footer={<><Button onClick={onClose}>Fechar</Button>
          <Button variant="primary" loading={busy === 'save'} onClick={() => run('save', () => api.platformSaveUser(user.user_id, f), user.member_id ? 'Alterações salvas.' : 'Acesso liberado.')}>
            {user.member_id ? 'Salvar alterações' : 'Liberar acesso'}
          </Button></>}>
        <div className="form">
          <section className="form-section">
            <h3>Acesso</h3>
            {!user.member_id && <p className="muted">Esta conta ainda não tem empresa{user.request_company_hint ? ` (pediu acesso à "${user.request_company_hint}")` : ''}. Preencha e clique em <b>Liberar acesso</b>.</p>}
            <Field label="Nome" required error={err.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <div className="grid-2">
              <Field label="Empresa" required error={err.clinic_id}>
                <Select value={f.clinic_id} onChange={(e) => setF({ ...f, clinic_id: e.target.value })}>
                  <option value="">Escolha…</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}{c.active ? '' : ' (suspensa)'}</option>)}
                </Select>
              </Field>
              <Field label="Perfil" required error={err.role}>
                <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
                  <option value="admin">Administrador da clínica</option><option value="recepcao">Recepção</option><option value="veterinario">Veterinário</option>
                </Select>
              </Field>
            </div>
            {user.member_id && (
              <label className="check">
                <input type="checkbox" checked={f.active} disabled={isMe} onChange={(e) => setF({ ...f, active: e.target.checked })} />
                <span>Acesso liberado {isMe && <small className="muted">(você não pode se bloquear)</small>}</span>
              </label>
            )}
          </section>

          <section className="form-section">
            <h3>Senha</h3>
            {reset ? <Credentials email={user.email} password={reset} /> : (
              <div className="suspend-row">
                <div><b>Redefinir senha</b><small className="muted">Gera uma senha temporária para você passar à pessoa.</small></div>
                <Button icon={<KeyRound size={16} />} loading={busy === 'reset'} onClick={() => {
                  const pw = tempPassword();
                  run('reset', async () => { const u = await api.platformResetPassword(user.user_id, pw); setReset(pw); return u; }, 'Senha temporária definida.');
                }}>Redefinir</Button>
              </div>
            )}
          </section>

          <section className="form-section">
            <h3>Permissões especiais</h3>
            <div className="suspend-row">
              <div>
                <b>{user.platform_admin ? 'É dono da plataforma' : 'Não é dono da plataforma'}</b>
                <small className="muted">Donos veem todas as empresas, liberam acessos e gerenciam usuários.</small>
              </div>
              <Button disabled={isMe} onClick={() => setConfirm('owner')}>{user.platform_admin ? 'Tirar acesso de dono' : 'Tornar dono'}</Button>
            </div>
            {user.member_id && !isMe && (
              <div className="suspend-row">
                <div><b>Remover acesso à empresa</b><small className="muted">A pessoa volta para a tela de pedido de acesso. O histórico fica guardado.</small></div>
                <Button variant="danger" icon={<UserMinus size={16} />} onClick={() => setConfirm('remove')}>Remover</Button>
              </div>
            )}
          </section>
        </div>
      </Drawer>
      <Confirm open={confirm === 'remove'} danger busy={!!busy} title={`Remover acesso de ${user.name ?? user.email}?`} confirmLabel="Remover acesso"
        text="A pessoa sai da empresa na hora, em todos os aparelhos. Para ela voltar, libere de novo."
        onCancel={() => setConfirm(null)} onConfirm={() => run('remove', () => api.platformRemoveAccess(user.user_id), 'Acesso removido.')} />
      <Confirm open={confirm === 'owner'} danger={user.platform_admin} busy={!!busy}
        title={user.platform_admin ? `Tirar acesso de dono de ${user.name ?? user.email}?` : `Tornar ${user.name ?? user.email} dono da plataforma?`}
        confirmLabel={user.platform_admin ? 'Tirar acesso' : 'Tornar dono'}
        text={user.platform_admin ? 'A pessoa deixa de ver a área Plataforma.' : 'A pessoa poderá ver todas as empresas e atendimentos, liberar acessos e gerenciar usuários, inclusive você.'}
        onCancel={() => setConfirm(null)} onConfirm={() => run('owner', () => api.platformSetOwner(user.user_id, !user.platform_admin), 'Permissão atualizada.')} />
    </>
  );
}
