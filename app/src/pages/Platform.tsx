import { useEffect, useState } from 'react';
import { Building2, Check, Inbox, MessageCircle, Plus, Search, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { fmtDate, initials, maskPhone, ROLE_LABEL, waLink } from '../lib/format';
import type { Company, CompanyDetail, PlatformRequest } from '../lib/types';
import { Button, Confirm, Drawer, Empty, Field, Input, Segmented, Select, Spinner, Textarea, toast, useDebounced } from '../components/ui';

type Tab = 'liberacoes' | 'empresas';

/** Platform owner area: approve access requests and manage client companies. */
export function PlatformPage() {
  const [tab, setTab] = useState<Tab>('liberacoes');
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Plataforma</h1><p className="muted">Quem pode usar o Pontual: empresas clientes e liberação de acesso.</p></div>
        <Segmented label="Seção" value={tab} onChange={setTab}
          options={[{ value: 'liberacoes', label: 'Liberações' }, { value: 'empresas', label: 'Empresas' }]} />
      </div>
      {tab === 'liberacoes' ? <Requests /> : <Companies />}
    </div>
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

function Companies() {
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
      <CompanyDrawer id={open} onClose={() => setOpen(null)} onChanged={load} />
    </section>
  );
}

const EMPTY_COMPANY = { name: '', document: '', contact_name: '', contact_phone: '', notes: '', active: true };

function CompanyDrawer({ id, onClose, onChanged }: { id: string | 'new' | null; onClose: () => void; onChanged: () => void }) {
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
