import { Fragment, useEffect, useState } from 'react';
import { Building2, KeyRound, Mail, Plus, ShieldCheck, Stethoscope, Users } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { fmtDate, initials, maskPhone, ROLE_LABEL, SPECIES_LABEL } from '../lib/format';
import { Button, Confirm, Drawer, Field, Input, Segmented, Select, Spinner, toast } from '../components/ui';

type Tab = 'clinica' | 'planos' | 'equipe';

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('equipe');
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Configurações</h1></div>
        <Segmented label="Seção" value={tab} onChange={setTab}
          options={[{ value: 'equipe', label: 'Equipe' }, { value: 'planos', label: 'Planos' }, { value: 'clinica', label: 'Clínica' }]} />
      </div>
      {tab === 'clinica' && <ClinicTab />}
      {tab === 'planos' && <PlansTab />}
      {tab === 'equipe' && <TeamTab />}
    </div>
  );
}

// ------------------------------------------------------------------ clinic
const TIMEZONES = [
  ['America/Sao_Paulo', 'Brasília (SP, RJ, MG, PB, PE…)'], ['America/Fortaleza', 'Fortaleza'], ['America/Recife', 'Recife'],
  ['America/Bahia', 'Salvador'], ['America/Belem', 'Belém'], ['America/Manaus', 'Manaus'], ['America/Cuiaba', 'Cuiabá'],
  ['America/Campo_Grande', 'Campo Grande'], ['America/Porto_Velho', 'Porto Velho'], ['America/Rio_Branco', 'Rio Branco'],
  ['America/Noronha', 'Fernando de Noronha']
];

function ClinicTab() {
  const { boot, setBoot } = useSession();
  const c = boot!.clinic;
  const [f, setF] = useState({ name: c.name, phone: c.phone ?? '', timezone: c.timezone, open_time: c.open_time, close_time: c.close_time, slot_minutes: String(c.slot_minutes) });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      setBoot(await api.updateClinic({ ...f, slot_minutes: Number(f.slot_minutes) }));
      setErr({});
      toast.ok('Dados da clínica salvos.');
    } catch (e) { if (e instanceof ApiError) { setErr(e.fields); toast.error(e.message); } }
    finally { setBusy(false); }
  }
  return (
    <section className="card settings-card">
      <header className="card-head"><h2><Building2 size={18} /> Dados e horário de atendimento</h2></header>
      <div className="form-section">
        <div className="grid-2">
          <Field label="Nome da clínica" required error={err.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Telefone" error={err.phone}><Input value={f.phone} onChange={(e) => setF({ ...f, phone: maskPhone(e.target.value) })} inputMode="tel" /></Field>
          <Field label="Fuso horário" error={err.timezone}>
            <Select value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
              {TIMEZONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Intervalo entre horários" error={err.slot_minutes}>
            <Select value={f.slot_minutes} onChange={(e) => setF({ ...f, slot_minutes: e.target.value })}>
              {[15, 20, 30, 40, 45, 60].map((m) => <option key={m} value={m}>{m} minutos</option>)}
            </Select>
          </Field>
          <Field label="Primeiro horário" error={err.open_time}><Input type="time" value={f.open_time} onChange={(e) => setF({ ...f, open_time: e.target.value })} /></Field>
          <Field label="Último horário" error={err.close_time}><Input type="time" value={f.close_time} onChange={(e) => setF({ ...f, close_time: e.target.value })} /></Field>
        </div>
        <div className="form-actions"><Button variant="primary" loading={busy} onClick={save}>Salvar</Button></div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ plans
function PlansTab() {
  const { refresh } = useSession();
  const [plans, setPlans] = useState<any[] | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  useEffect(() => { api.listPlans().then(setPlans).catch((e) => toast.error(e.message)); }, []);

  async function toggle(p: any) {
    try {
      setPlans(await api.savePlan(p.id, { name: p.name, species: p.species, description: p.description, active: !p.active }));
      await refresh();
      toast.ok(p.active ? 'Plano desativado. O histórico continua com ele.' : 'Plano ativado.');
    } catch (e: any) { toast.error(e.message); }
  }
  return (
    <section className="card">
      <header className="card-head">
        <h2><ShieldCheck size={18} /> Planos de saúde</h2>
        <Button size="sm" icon={<Plus size={16} />} onClick={() => setEdit({})}>Novo plano</Button>
      </header>
      {!plans ? <Spinner /> : (
        <table className="table">
          <thead><tr><th>Plano</th><th className="hide-sm">Atende</th><th className="hide-sm">Uso</th><th>Ativo</th></tr></thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className={p.active ? '' : 'is-off'} onClick={() => setEdit(p)}>
                <td><span className="cell-two"><b>{p.name}</b><small>{p.code}{p.description ? ` | ${p.description}` : ''}</small></span></td>
                <td className="hide-sm">{p.species ? `Só ${SPECIES_LABEL[p.species].toLowerCase()}` : 'Todas as espécies'}</td>
                <td className="hide-sm muted num">{p.uses}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <button className="switch" role="switch" aria-checked={p.active} aria-label={`${p.name} ativo`} onClick={() => toggle(p)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <PlanDrawer plan={edit} onClose={() => setEdit(null)} onSaved={async (list) => { setPlans(list); setEdit(null); await refresh(); }} />
    </section>
  );
}

function PlanDrawer({ plan, onClose, onSaved }: { plan: any | null; onClose: () => void; onSaved: (l: any[]) => void }) {
  const isNew = plan && !plan.id;
  const [f, setF] = useState({ code: '', name: '', species: '', description: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (plan) { setF({ code: plan.code ?? '', name: plan.name ?? '', species: plan.species ?? '', description: plan.description ?? '' }); setErr({}); } }, [plan]);
  async function save() {
    setBusy(true);
    try { onSaved(await api.savePlan(plan.id ?? null, { ...f, species: f.species || null, active: plan.active ?? true })); toast.ok('Plano salvo.'); }
    catch (e) { if (e instanceof ApiError) { setErr(e.fields); toast.error(e.message); } }
    finally { setBusy(false); }
  }
  return (
    <Drawer open={!!plan} onClose={onClose} title={<h2>{isNew ? 'Novo plano' : 'Editar plano'}</h2>}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Salvar</Button></>}>
      <div className="form-section">
        <Field label="Código" required error={err.code} hint={isNew ? 'Sigla curta, sem espaços. Não muda depois.' : undefined}>
          <Input value={f.code} disabled={!isNew} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/\s/g, '') })} placeholder="PETLOVE" />
        </Field>
        <Field label="Nome" required error={err.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Petlove" /></Field>
        <Field label="Atende" error={err.species}>
          <Select value={f.species} onChange={(e) => setF({ ...f, species: e.target.value })}>
            <option value="">Todas as espécies</option><option value="cao">Só cães</option><option value="gato">Só gatos</option><option value="outro">Só outras espécies</option>
          </Select>
        </Field>
        <Field label="Descrição" error={err.description}><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
    </Drawer>
  );
}

// ------------------------------------------------------------------ team
function TeamTab() {
  const { refresh } = useSession();
  const [team, setTeam] = useState<{ members: any[]; invites: any[] } | null>(null);
  const [invite, setInvite] = useState(false);
  const [off, setOff] = useState<any | null>(null);
  const [reset, setReset] = useState<any | null>(null);
  useEffect(() => { api.listTeam().then(setTeam).catch((e) => toast.error(e.message)); }, []);

  async function update(m: any, role?: string, active?: boolean) {
    try { setTeam(await api.updateMember(m.id, role, active)); await refresh(); toast.ok(active === false ? 'Acesso bloqueado.' : active ? 'Acesso liberado.' : 'Perfil alterado.'); }
    catch (e: any) { toast.error(e.message); } finally { setOff(null); }
  }
  if (!team) return <Spinner />;
  return (
    <>
      <section className="card">
        <header className="card-head">
          <h2><Users size={18} /> Equipe</h2>
          <Button size="sm" variant="primary" icon={<Plus size={16} />} onClick={() => setInvite(true)}>Convidar pessoa</Button>
        </header>
        <table className="table">
          <thead><tr><th>Pessoa</th><th>Perfil</th><th>Acesso</th><th className="hide-sm"></th></tr></thead>
          <tbody>
            {team.members.map((m) => (
              <Fragment key={m.id}>
              <tr className={m.active ? 'no-hover' : 'is-off no-hover'}>
                <td><span className="person"><span className="avatar sm">{initials(m.name)}</span><span className="cell-two"><b>{m.name}{m.is_me ? ' (você)' : ''}</b><small>{m.email}</small></span></span></td>
                <td>
                  <Select value={m.role} disabled={m.is_me} onChange={(e) => update(m, e.target.value)} aria-label={`Perfil de ${m.name}`} className="input compact">
                    {Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </Select>
                </td>
                <td><button className="switch" role="switch" aria-checked={m.active} disabled={m.is_me} aria-label={`Acesso de ${m.name}`}
                  onClick={() => (m.active ? setOff(m) : update(m, undefined, true))} /></td>
                <td className="hide-sm">{!m.is_me && <Button size="sm" variant="ghost" icon={<KeyRound size={15} />} onClick={() => setReset(m)}>Redefinir senha</Button>}</td>
              </tr>
              {!m.is_me && <tr className="no-hover show-sm"><td colSpan={3}><Button size="sm" variant="ghost" icon={<KeyRound size={15} />} onClick={() => setReset(m)}>Redefinir senha de {m.name.split(' ')[0]}</Button></td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
      </section>

      {team.invites.length > 0 && (
        <section className="card">
          <header className="card-head"><h2><Mail size={18} /> Convites aguardando cadastro</h2></header>
          <p className="muted pad">Peça para a pessoa baixar o app e tocar em <b>Criar conta</b> usando exatamente este e-mail. O acesso é liberado na hora.</p>
          <table className="table">
            <tbody>
              {team.invites.map((i) => (
                <tr key={i.id} className="no-hover">
                  <td><span className="cell-two"><b>{i.name}</b><small>{i.email}</small></span></td>
                  <td>{ROLE_LABEL[i.role]}</td>
                  <td className="hide-sm muted">{fmtDate(i.created_at.slice(0, 10))}</td>
                  <td><Button size="sm" variant="ghost" onClick={async () => { setTeam(await api.cancelInvite(i.id)); toast.ok('Convite cancelado.'); }}>Cancelar</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card roles">
        <header className="card-head"><h2><Stethoscope size={18} /> O que cada perfil pode fazer</h2></header>
        <table className="table">
          <thead><tr><th>Ação</th><th>Admin</th><th>Recepção</th><th>Veterinário</th></tr></thead>
          <tbody className="matrix">
            {[
              ['Ver agenda, pacientes e painel', 1, 1, 1], ['Agendar e editar', 1, 1, 0], ['Concluir e anotar observações', 1, 1, 1],
              ['Cancelar, registrar falta, reabrir', 1, 1, 0], ['Excluir agendamento', 1, 0, 0], ['Equipe, planos e clínica', 1, 0, 0]
            ].map(([l, ...v]) => (
              <tr key={l as string} className="no-hover"><td>{l}</td>{v.map((x, i) => <td key={i}>{x ? '✓' : '—'}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </section>

      <ResetDrawer member={reset} onClose={() => setReset(null)} />
      <InviteDrawer open={invite} onClose={() => setInvite(false)} onDone={(t) => { setTeam(t); setInvite(false); }} />
      <Confirm open={!!off} title={`Bloquear acesso de ${off?.name}?`} danger confirmLabel="Bloquear acesso"
        text="A pessoa sai do sistema na hora, em todos os aparelhos. O histórico dela continua. Dá para liberar de novo depois."
        onCancel={() => setOff(null)} onConfirm={() => update(off, undefined, false)} />
    </>
  );
}

function InviteDrawer({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (t: any) => void }) {
  const [f, setF] = useState({ name: '', email: '', role: 'recepcao' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF({ name: '', email: '', role: 'recepcao' }); setErr({}); } }, [open]);
  async function save() {
    setBusy(true);
    try { onDone(await api.invite(f.email, f.name, f.role)); toast.ok(`Convite criado para ${f.email}.`); }
    catch (e) { if (e instanceof ApiError) { setErr(e.fields); toast.error(e.message); } }
    finally { setBusy(false); }
  }
  return (
    <Drawer open={open} onClose={onClose} title={<h2>Convidar pessoa</h2>}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Criar convite</Button></>}>
      <div className="form-section">
        <Field label="Nome completo" required error={err.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="E-mail" required error={err.email} hint="A pessoa cria a conta no app com este e-mail.">
          <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Perfil" error={err.role}>
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="recepcao">Recepção</option><option value="veterinario">Veterinário</option><option value="admin">Administrador</option>
          </Select>
        </Field>
      </div>
    </Drawer>
  );
}

function randomPassword() {
  const words = ['gato', 'cao', 'pata', 'osso', 'bola', 'vacina', 'racao', 'coleira', 'focinho', 'rabo'];
  const pick = () => words[crypto.getRandomValues(new Uint32Array(1))[0] % words.length];
  return `${pick()}-${pick()}-${1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000)}`;
}

function ResetDrawer({ member, onClose }: { member: any | null; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => { if (member) { setPw(randomPassword()); setErr(undefined); setDone(false); } }, [member]);
  async function save() {
    setBusy(true);
    try { await api.adminResetPassword(member.id, pw); setDone(true); toast.ok('Senha temporária definida.'); }
    catch (e) { if (e instanceof ApiError) { setErr(e.fields.password ?? e.message); } }
    finally { setBusy(false); }
  }
  return (
    <Drawer open={!!member} onClose={onClose} title={<h2>Redefinir senha</h2>}
      footer={done ? <Button variant="primary" onClick={onClose}>Concluir</Button>
        : <><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Definir senha temporária</Button></>}>
      {member && (
        <div className="form-section">
          {done ? (
            <>
              <p>Passe estes dados para <b>{member.name}</b> e peça para trocar a senha depois de entrar (ícone de chave ao lado do nome):</p>
              <dl className="dl">
                <dt>E-mail</dt><dd><b>{member.email}</b></dd>
                <dt>Senha temporária</dt><dd><b className="num">{pw}</b></dd>
              </dl>
              <Button size="sm" onClick={() => navigator.clipboard?.writeText(`E-mail: ${member.email}\nSenha temporária: ${pw}`).then(() => toast.ok('Copiado.'))}>Copiar</Button>
            </>
          ) : (
            <>
              <p className="muted">Use quando <b>{member.name}</b> esquecer a senha. A senha atual deixa de valer.</p>
              <Field label="Senha temporária" error={err} hint="Mínimo de 8 caracteres. Sugerimos uma; pode trocar.">
                <div className="input-group">
                  <Input value={pw} onChange={(e) => { setPw(e.target.value); setErr(undefined); }} autoComplete="off" />
                  <Button type="button" onClick={() => setPw(randomPassword())}>Gerar outra</Button>
                </div>
              </Field>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}
