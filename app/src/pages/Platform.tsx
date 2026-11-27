import { useEffect, useState } from 'react';
import { Building2, CalendarDays, Check, Eye, History, Inbox, MessageCircle, Plus, Search, ShieldAlert, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { PlatformUsers } from './PlatformUsers';
import { addDays, animalLine, fmtDate, fmtShort, initials, maskPhone, ROLE_LABEL, waLink } from '../lib/format';
import type { AuditEntry, Company, CompanyDetail, OverviewRow, PlatformAppointment, PlatformRequest } from '../lib/types';
import { Button, Confirm, Drawer, Empty, Field, Input, PlanBadge, Segmented, Select, SpeciesIcon, Spinner, StatusBadge, Textarea, toast, useDebounced } from '../components/ui';

type Tab = 'liberacoes' | 'usuarios' | 'empresas' | 'atendimentos' | 'registro';

/** Platform owner area: access requests, client companies and read-only view of their appointments. */
export function PlatformPage() {
  const [tab, setTab] = useState<Tab>('liberacoes');
  const [clinic, setClinic] = useState('');
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Plataforma</h1><p className="muted">Empresas clientes, liberação de acesso e atendimentos de todos os clientes.</p></div>
        <Segmented label="Seção" value={tab} onChange={setTab}
          options={[{ value: 'liberacoes', label: 'Liberações' }, { value: 'usuarios', label: 'Usuários' }, { value: 'empresas', label: 'Empresas' }, { value: 'atendimentos', label: 'Atendimentos' }, { value: 'registro', label: 'Registro' }]} />
      </div>
      {tab === 'liberacoes' && <Requests />}
      {tab === 'usuarios' && <PlatformUsers />}
      {tab === 'empresas' && <Companies onSupport={(id) => { setClinic(id); setTab('atendimentos'); }} />}
      {tab === 'atendimentos' && <Appointments clinic={clinic} setClinic={setClinic} />}
      {tab === 'registro' && <AuditLog />}
    </div>
  );
}

// =================================================================== appointments (all companies, read-only)

/** Today in Brazil (the owner may not belong to a clinic with its own time zone). */
const todayBR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

function Appointments({ clinic, setClinic }: { clinic: string; setClinic: (id: string) => void }) {
  const today = todayBR();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [overview, setOverview] = useState<OverviewRow[] | null>(null);
  const [period, setPeriod] = useState<'hoje' | 'proximos' | 'anteriores'>('hoje');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 400);
  const [items, setItems] = useState<PlatformAppointment[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api.platformCompanies().then(setCompanies).catch(() => {});
    api.platformOverview().then((o) => setOverview(o.companies)).catch((e) => toast.error(e.message));
  }, []);

  const params = {
    clinic, status, q: dq, limit: 50,
    ...(period === 'hoje' ? { date: today, order: 'asc' as const }
      : period === 'proximos' ? { from: addDays(today, 1), order: 'asc' as const }
      : { to: addDays(today, -1), order: 'desc' as const })
  };
  useEffect(() => {
    let live = true;
    setItems(null);
    api.platformAppointments(params).then((r) => { if (live) { setItems(r.data); setCursor(r.next_cursor); } })
      .catch((e) => toast.error(e.message));
    return () => { live = false; };
  }, [clinic, period, status, dq]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMore() {
    setMore(true);
    try { const r = await api.platformAppointments({ ...params, cursor }); setItems((x) => [...(x ?? []), ...r.data]); setCursor(r.next_cursor); }
    catch (e: any) { toast.error(e.message); } finally { setMore(false); }
  }

  const selected = companies.find((c) => c.id === clinic);
  return (
    <>
      <div className="notice">
        <ShieldAlert size={18} />
        <span><b>Visualização da plataforma, somente leitura.</b> Nada pode ser alterado por aqui, e cada consulta fica registrada (quem viu, qual empresa e quando).</span>
      </div>

      {!clinic && (
        <section className="card">
          <header className="card-head"><h2>Resumo por empresa</h2><span className="muted">clique para ver os atendimentos</span></header>
          {!overview ? <Spinner /> : !overview.length ? <p className="muted pad">Nenhuma empresa cadastrada.</p> : (
            <table className="table">
              <thead><tr><th>Empresa</th><th>Hoje</th><th className="hide-sm">Próx. 7 dias</th><th className="hide-sm">Concluídos no mês</th><th className="hide-md">Faltas no mês</th></tr></thead>
              <tbody>
                {overview.map((o) => (
                  <tr key={o.id} onClick={() => setClinic(o.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setClinic(o.id)} className={o.active ? '' : 'is-off'}>
                    <td><b>{o.name}</b>{!o.active && <small className="muted"> (suspensa)</small>}</td>
                    <td className="num">{o.today}</td>
                    <td className="hide-sm num">{o.next_7d}</td>
                    <td className="hide-sm num">{o.month_done}</td>
                    <td className="hide-md num">{o.month_noshow}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section className="card list-card">
        <div className="filters">
          <Select value={clinic} onChange={(e) => setClinic(e.target.value)} aria-label="Empresa">
            <option value="">Todas as empresas</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Segmented label="Período" value={period} onChange={setPeriod}
            options={[{ value: 'hoje', label: 'Hoje' }, { value: 'proximos', label: 'Próximos' }, { value: 'anteriores', label: 'Anteriores' }]} />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Todos os status</option>
            <option value="agendado">Agendados</option><option value="concluido">Concluídos</option>
            <option value="faltou">Faltas</option><option value="cancelado">Cancelados</option>
          </Select>
          <div className="search-box">
            <Search size={16} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Animal, tutor ou telefone" aria-label="Buscar" />
          </div>
        </div>
        {selected && <div className="support-bar"><Eye size={16} />Suporte: vendo só <b>{selected.name}</b><button className="link" onClick={() => setClinic('')}>ver todas</button></div>}

        {!items ? <Spinner /> : !items.length ? (
          <Empty icon={<CalendarDays size={22} />} title="Nenhum atendimento encontrado" text="Mude o período, a empresa ou a busca." />
        ) : (
          <>
            <table className="table">
              <thead><tr><th>Data</th>{!clinic && <th>Empresa</th>}<th>Paciente</th><th className="hide-sm">Tutor</th><th>Status</th></tr></thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} onClick={() => setOpen(a.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(a.id)}>
                    <td className="nowrap"><b className="num">{fmtShort(a.date)}</b> <span className="muted num">{a.time}</span></td>
                    {!clinic && <td className="muted">{a.clinic.name}</td>}
                    <td><span className="cell-pet"><SpeciesIcon species={a.animal.species} size={16} />{a.animal.name}</span></td>
                    <td className="hide-sm"><span className="cell-two"><span>{a.tutor.name}</span><small>{a.tutor.phone}</small></span></td>
                    <td><StatusBadge status={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cursor && <div className="table-more"><Button onClick={loadMore} loading={more}>Carregar mais</Button></div>}
          </>
        )}
      </section>
      <ReadOnlyDetail id={open} onClose={() => setOpen(null)} />
    </>
  );
}

function ReadOnlyDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [a, setA] = useState<PlatformAppointment | null>(null);
  useEffect(() => {
    setA(null);
    if (id) api.platformAppointment(id).then(setA).catch((e) => { toast.error(e.message); onClose(); });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Drawer open={!!id} onClose={onClose} title={a ? (
      <div className="detail-title"><SpeciesIcon species={a.animal.species} size={20} /><div><h2>{a.animal.name}</h2><small>{a.clinic.name} | Nº {a.number}</small></div></div>
    ) : <h2>Atendimento</h2>} footer={<Button onClick={onClose}>Fechar</Button>}>
      {!a ? <Spinner /> : (
        <div className="detail">
          <div className="detail-when">
            <div><b>{a.time}</b><span>{fmtDate(a.date)}</span></div>
            <StatusBadge status={a.status} />
          </div>
          <dl className="dl">
            <dt>Empresa</dt><dd>{a.clinic.name}</dd>
            <dt>Animal</dt><dd>{animalLine(a.animal) || '—'}</dd>
            <dt>Tutor</dt><dd>{a.tutor.name}</dd>
            <dt>Telefone</dt><dd>{a.tutor.phone}</dd>
            <dt>Atendimento</dt><dd><PlanBadge plan={a.plan_name} /></dd>
            <dt>Motivo</dt><dd>{a.reason || '—'}</dd>
            <dt>Veterinário</dt><dd>{a.vet_name || 'Sem preferência'}</dd>
            <dt>Agendado por</dt><dd>{a.created_by_name || '—'}</dd>
            <dt>Observações</dt><dd>{a.notes || '—'}</dd>
          </dl>
          <p className="muted small-note">Somente leitura. Alterações são feitas pela própria clínica.</p>
        </div>
      )}
    </Drawer>
  );
}

// =================================================================== requests

const STATUS_FILTER = [
  { value: 'pending', label: 'Pendentes' }, { value: 'approved', label: 'Aprovados' }, { value: 'rejected', label: 'Recusados' }
] as const;

function Requests() {
  const { refresh } = useSession();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [items, setItems] = useState<PlatformRequest[] | null>(null);
  const [approve, setApprove] = useState<PlatformRequest | null>(null);
  const [reject, setReject] = useState<PlatformRequest | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => { setItems(null); api.platformRequests(status).then(setItems).catch((e) => toast.error(e.message)); };
  useEffect(load, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function doReject() {
    if (!reject) return;
    setBusy(true);
    try {
      await api.platformDecide(reject.id, false, { reason });
      toast.ok(`Pedido de ${reject.name} recusado.`);
      setReject(null); setReason('');
      load(); refresh();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  return (
    <section className="card list-card">
      <div className="filters">
        <Segmented label="Status" value={status} onChange={setStatus} options={[...STATUS_FILTER]} />
      </div>
      {!items ? <Spinner /> : !items.length ? (
        <Empty icon={<Inbox size={22} />} title={status === 'pending' ? 'Nenhum pedido aguardando' : 'Nada por aqui'}
          text={status === 'pending' ? 'Quando alguém criar conta no app, o pedido de acesso aparece aqui.' : undefined} />
      ) : (
        <ul className="req-list">
          {items.map((r) => (
            <li key={r.id} className="req">
              <span className="avatar">{initials(r.name)}</span>
              <div className="req-main">
                <b>{r.name}</b>
                <small>{r.email}{r.phone ? ` | ${r.phone}` : ''}</small>
                <span className="req-hint">Diz trabalhar em: <b>{r.company_hint || '—'}</b></span>
                {r.message && <span className="req-msg">“{r.message}”</span>}
                <small className="muted">
                  Pedido em {fmtDate(r.created_at.slice(0, 10))}
                  {r.status === 'approved' && r.clinic_name ? ` | liberado em ${r.clinic_name}` : ''}
                  {r.status === 'rejected' && r.reject_reason ? ` | motivo: ${r.reject_reason}` : ''}
                </small>
              </div>
              {r.status === 'pending' && (
                <div className="req-actions">
                  {r.phone && <a className="btn btn-ghost btn-sm" href={waLink(r.phone)} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} /><span>Conversar</span></a>}
                  <Button size="sm" icon={<X size={15} />} onClick={() => { setReject(r); setReason(''); }}>Recusar</Button>
                  <Button size="sm" variant="primary" icon={<Check size={15} />} onClick={() => setApprove(r)}>Liberar</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <ApproveDrawer request={approve} onClose={() => setApprove(null)} onDone={() => { setApprove(null); load(); refresh(); }} />
      <Confirm open={!!reject} title={`Recusar acesso de ${reject?.name}?`} danger busy={busy} confirmLabel="Recusar"
        text="A pessoa verá que o pedido não foi aprovado e poderá corrigir os dados e pedir de novo."
        onCancel={() => setReject(null)} onConfirm={doReject}>
        <Field label="Motivo (a pessoa verá)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Opcional" /></Field>
      </Confirm>
    </section>
  );
}

function ApproveDrawer({ request, onClose, onDone }: { request: PlatformRequest | null; onClose: () => void; onDone: () => void }) {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [mode, setMode] = useState<'existente' | 'nova'>('existente');
  const [clinicId, setClinicId] = useState('');
  const [newName, setNewName] = useState('');
  const [role, setRole] = useState('admin');
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!request) return;
    setErr({}); setRole('admin'); setNewName(request.company_hint ?? ''); setClinicId('');
    api.platformCompanies().then((cs) => {
      const active = cs.filter((c) => c.active);
      setCompanies(active);
      const guess = active.find((c) => request.company_hint && c.name.toLowerCase().includes(request.company_hint.toLowerCase()));
      setClinicId(guess?.id ?? '');
      setMode(active.length ? 'existente' : 'nova');
      if (guess) setRole('recepcao');
    }).catch((e) => toast.error(e.message));
  }, [request]);

  async function save() {
    if (!request) return;
    setBusy(true);
    try {
      let id = clinicId;
      if (mode === 'nova') {
        if (newName.trim().length < 2) { setErr({ new_name: 'Informe o nome da empresa.' }); setBusy(false); return; }
        id = (await api.platformSaveCompany(null, { name: newName, contact_name: request.name, contact_phone: request.phone })).id;
      }
      await api.platformDecide(request.id, true, { clinicId: id, role });
      toast.ok(`${request.name} liberado.`);
      onDone();
    } catch (e) {
      if (e instanceof ApiError) { setErr(e.fields); toast.error(e.message); }
    } finally { setBusy(false); }
  }

  return (
    <Drawer open={!!request} onClose={onClose} title={<h2>Liberar acesso</h2>}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Liberar acesso</Button></>}>
      {request && (
        <div className="form-section">
          <p><b>{request.name}</b> ({request.email}) disse trabalhar em <b>{request.company_hint}</b>.</p>
          <Segmented label="Empresa" value={mode} onChange={setMode}
            options={[{ value: 'existente', label: 'Empresa já cadastrada' }, { value: 'nova', label: 'Nova empresa' }]} />
          {mode === 'existente' ? (
            <Field label="Empresa" required error={err.clinic_id}>
              {!companies ? <Spinner /> : (
                <Select value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
                  <option value="">Escolha…</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              )}
            </Field>
          ) : (
            <Field label="Nome da nova empresa" required error={err.new_name ?? err.name} hint="Você completa CNPJ e contato depois, em Empresas.">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
            </Field>
          )}
          <Field label="Perfil" required error={err.role}>
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="admin">Administrador da clínica (pode convidar a equipe)</option>
              <option value="recepcao">Recepção</option>
              <option value="veterinario">Veterinário</option>
            </Select>
          </Field>
        </div>
      )}
    </Drawer>
  );
}

// =================================================================== companies

function Companies({ onSupport }: { onSupport: (companyId: string) => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [items, setItems] = useState<Company[] | null>(null);
  const [open, setOpen] = useState<string | 'new' | null>(null);
  const load = () => api.platformCompanies(dq).then(setItems).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="card list-card">
      <div className="filters">
        <div className="search-box">
          <Search size={16} />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome ou CNPJ" aria-label="Buscar empresa" />
        </div>
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => setOpen('new')}>Nova empresa</Button>
      </div>
      {!items ? <Spinner /> : !items.length ? (
        <Empty icon={<Building2 size={22} />} title="Nenhuma empresa" text="Cadastre o primeiro cliente ou libere um pedido como nova empresa." />
      ) : (
        <table className="table">
          <thead><tr><th>Empresa</th><th className="hide-sm">Administradores</th><th className="hide-sm">Pessoas</th><th className="hide-md">Atend. 30 dias</th><th>Situação</th></tr></thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} onClick={() => setOpen(c.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(c.id)} className={c.active ? '' : 'is-off'}>
                <td><span className="cell-two"><b>{c.name}</b><small>{c.document || 'sem CPF/CNPJ'}</small></span></td>
                <td className="hide-sm muted">{c.admins.join(', ') || '—'}</td>
                <td className="hide-sm num">{c.members}</td>
                <td className="hide-md num">{c.appointments_30d}</td>
                <td><span className={`status ${c.active ? 'status-concluido' : 'status-cancelado'}`}><i />{c.active ? 'Ativa' : 'Suspensa'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <CompanyDrawer id={open} onClose={() => setOpen(null)} onChanged={load} onSupport={(cid) => { setOpen(null); onSupport(cid); }} />
    </section>
  );
}

const EMPTY_COMPANY = { name: '', document: '', contact_name: '', contact_phone: '', notes: '', active: true };

function CompanyDrawer({ id, onClose, onChanged, onSupport }: {
  id: string | 'new' | null; onClose: () => void; onChanged: () => void; onSupport: (companyId: string) => void;
}) {
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [f, setF] = useState(EMPTY_COMPANY);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const isNew = id === 'new';

  useEffect(() => {
    setErr({}); setDetail(null);
    if (!id) return;
    if (isNew) { setF(EMPTY_COMPANY); return; }
    api.platformCompany(id).then((d) => {
      setDetail(d);
      setF({ name: d.name, document: d.document ?? '', contact_name: d.contact_name ?? '', contact_phone: d.contact_phone ?? '', notes: d.notes ?? '', active: d.active });
    }).catch((e) => { toast.error(e.message); onClose(); });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(next = f) {
    setBusy(true);
    try {
      const d = await api.platformSaveCompany(isNew ? null : (id as string), next);
      setDetail(d); setF({ ...next }); setErr({});
      toast.ok(isNew ? 'Empresa cadastrada.' : next.active !== detail?.active ? (next.active ? 'Empresa reativada.' : 'Empresa suspensa.') : 'Empresa salva.');
      onChanged();
      if (isNew) onClose();
    } catch (e) { if (e instanceof ApiError) { setErr(e.fields); toast.error(e.message); } }
    finally { setBusy(false); setConfirmSuspend(false); }
  }

  async function setMember(memberId: string, role?: string, active?: boolean) {
    try { setDetail(await api.platformSetMember(memberId, role, active)); toast.ok('Acesso atualizado.'); onChanged(); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <>
      <Drawer open={!!id} onClose={onClose} wide title={<h2>{isNew ? 'Nova empresa' : detail?.name ?? 'Empresa'}</h2>}
        footer={<><Button onClick={onClose}>Fechar</Button><Button variant="primary" loading={busy} onClick={() => save()}>Salvar</Button></>}>
        {!isNew && !detail ? <Spinner /> : (
          <div className="form">
            <section className="form-section">
              <h3>Dados do cliente</h3>
              <div className="grid-2">
                <Field label="Nome da empresa" required error={err.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
                <Field label="CPF ou CNPJ" error={err.document}><Input value={f.document} onChange={(e) => setF({ ...f, document: e.target.value })} inputMode="numeric" /></Field>
                <Field label="Responsável" error={err.contact_name}><Input value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></Field>
                <Field label="Telefone do responsável" error={err.contact_phone}><Input value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: maskPhone(e.target.value) })} inputMode="tel" /></Field>
              </div>
              <Field label="Observações internas" error={err.notes}><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} placeholder="Plano contratado, vencimento, etc." /></Field>
            </section>

            {!isNew && detail && (
              <>
                <section className="form-section">
                  <h3>Atendimentos</h3>
                  <div className="suspend-row">
                    <div>
                      <b>{detail.appointments_30d} agendamento{detail.appointments_30d === 1 ? '' : 's'} criados nos últimos 30 dias</b>
                      <small className="muted">Veja a agenda desta empresa em modo suporte, só leitura.</small>
                    </div>
                    <Button icon={<Eye size={16} />} onClick={() => onSupport(detail.id)}>Ver atendimentos</Button>
                  </div>
                </section>

                <section className="form-section">
                  <h3>Situação</h3>
                  <div className="suspend-row">
                    <div>
                      <b>{detail.active ? 'Empresa ativa' : 'Empresa suspensa'}</b>
                      <small className="muted">{detail.active ? 'Todas as pessoas liberadas usam o app normalmente.' : `Ninguém desta empresa consegue entrar${detail.suspended_at ? ` desde ${fmtDate(detail.suspended_at.slice(0, 10))}` : ''}.`}</small>
                    </div>
                    {detail.active
                      ? <Button variant="danger" onClick={() => setConfirmSuspend(true)}>Suspender acesso</Button>
                      : <Button variant="primary" loading={busy} onClick={() => save({ ...f, active: true })}>Reativar</Button>}
                  </div>
                </section>

                <section className="form-section">
                  <h3>Pessoas com acesso ({detail.people.length})</h3>
                  {!detail.people.length ? <p className="muted">Ninguém ainda. Libere um pedido para esta empresa.</p> : (
                    <table className="table">
                      <tbody>
                        {detail.people.map((m) => (
                          <tr key={m.id} className={`no-hover ${m.active ? '' : 'is-off'}`}>
                            <td><span className="cell-two"><b>{m.name}</b><small>{m.email}</small></span></td>
                            <td>
                              <Select className="input compact" value={m.role} onChange={(e) => setMember(m.id, e.target.value)} aria-label={`Perfil de ${m.name}`}>
                                {Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                              </Select>
                            </td>
                            <td><button className="switch" role="switch" aria-checked={m.active} aria-label={`Acesso de ${m.name}`} onClick={() => setMember(m.id, undefined, !m.active)} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {detail.invites.length > 0 && (
                    <p className="muted">Convites enviados pela clínica, aguardando cadastro: {detail.invites.map((i) => `${i.name} (${ROLE_LABEL[i.role]})`).join(', ')}.</p>
                  )}
                </section>
              </>
            )}
          </div>
        )}
      </Drawer>
      <Confirm open={confirmSuspend} title={`Suspender ${detail?.name}?`} danger busy={busy} confirmLabel="Suspender acesso"
        text="Todas as pessoas desta empresa perdem o acesso na hora, em todos os aparelhos. Os dados ficam guardados e voltam ao reativar."
        onCancel={() => setConfirmSuspend(false)} onConfirm={() => save({ ...f, active: false })} />
    </>
  );
}

// =================================================================== audit log

const ACTION_LABEL: Record<string, string> = {
  view_appointments: 'Consultou atendimentos', view_appointment: 'Abriu um atendimento',
  approve: 'Liberou acesso', reject: 'Recusou acesso', create: 'Cadastrou empresa',
  update: 'Alterou dados', suspend: 'Suspendeu empresa', reactivate: 'Reativou empresa'
};

function describe(e: AuditEntry) {
  const d = (e.data ?? {}) as Record<string, string>;
  if (e.action === 'view_appointments') {
    const parts = [d.scope === 'all_companies' ? 'todas as empresas' : e.company ?? 'uma empresa'];
    if (d.date) parts.push(`dia ${fmtDate(d.date)}`);
    if (d.from) parts.push(`a partir de ${fmtDate(d.from)}`);
    if (d.to) parts.push(`até ${fmtDate(d.to)}`);
    if (d.q) parts.push(`busca "${d.q}"`);
    return parts.join(', ');
  }
  if (e.entity === 'member') return `pessoa${d.role ? `, perfil ${ROLE_LABEL[d.role] ?? d.role}` : ''}${d.active === undefined || d.active === null ? '' : String(d.active) === 'true' ? ', acesso liberado' : ', acesso bloqueado'}`;
  if (e.action === 'reject' && d.reason) return `motivo: ${d.reason}`;
  return e.company ?? '';
}

/** Everything the platform owner did, newest first (read-only). */
function AuditLog() {
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => { api.platformAudit(null, 100).then((r) => { setItems(r); setDone(r.length < 100); }).catch((e) => toast.error(e.message)); }, []);
  async function loadMore() {
    if (!items?.length) return;
    setMore(true);
    try { const r = await api.platformAudit(items[items.length - 1].id, 100); setItems([...items, ...r]); setDone(r.length < 100); }
    catch (e: any) { toast.error(e.message); } finally { setMore(false); }
  }
  return (
    <section className="card list-card">
      <header className="card-head"><h2><History size={18} /> Registro de acessos e ações</h2><span className="muted">mais recentes primeiro</span></header>
      {!items ? <Spinner /> : !items.length ? <Empty icon={<History size={22} />} title="Nada registrado ainda" /> : (
        <>
          <ul className="audit-list">
            {items.map((e) => (
              <li key={e.id}>
                <time>{new Date(e.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</time>
                <span><b>{ACTION_LABEL[e.action] ?? e.action}</b>{describe(e) ? `: ${describe(e)}` : ''}<br /><small>por {e.actor ?? 'sistema'}</small></span>
              </li>
            ))}
          </ul>
          {!done && <div className="table-more"><Button onClick={loadMore} loading={more}>Carregar mais</Button></div>}
        </>
      )}
    </section>
  );
}
