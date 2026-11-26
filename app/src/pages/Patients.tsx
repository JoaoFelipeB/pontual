import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarPlus, MessageCircle, Pencil, PawPrint, Search } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { animalLine, fmtDate, maskPhone, waLink } from '../lib/format';
import type { TutorDetail, TutorSummary } from '../lib/types';
import { Button, Drawer, Empty, Field, Input, PlanBadge, SpeciesIcon, Spinner, StatusBadge, Textarea, toast, useDebounced } from '../components/ui';
import { useWorkspace } from '../components/Layout';

export function PatientsPage() {
  const nav = useNavigate();
  const ws = useWorkspace();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [items, setItems] = useState<TutorSummary[] | null>(null);

  useEffect(() => {
    let live = true;
    api.searchPatients(dq, 60).then((r) => live && setItems(r)).catch((e) => toast.error(e.message));
    return () => { live = false; };
  }, [dq, ws.version]);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Pacientes</h1><p className="muted">Tutores e animais cadastrados a partir dos agendamentos.</p></div>
      </div>
      <div className="card list-card">
        <div className="filters">
          <div className="search-box grow">
            <Search size={16} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por tutor, telefone ou animal" aria-label="Buscar" />
          </div>
        </div>
        {!items ? <Spinner /> : !items.length ? (
          <Empty icon={<PawPrint size={22} />} title={dq ? 'Nenhum paciente encontrado' : 'Nenhum paciente ainda'}
            text={dq ? 'Confira a grafia ou busque pelo telefone.' : 'O cadastro é criado automaticamente no primeiro agendamento.'} />
        ) : (
          <table className="table">
            <thead><tr><th>Tutor</th><th>Animais</th><th className="hide-sm">Último atendimento</th></tr></thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} onClick={() => nav(`/pacientes/${t.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && nav(`/pacientes/${t.id}`)}>
                  <td><span className="cell-two"><b>{t.name}</b><small>{t.phone}</small></span></td>
                  <td>
                    <span className="pets">
                      {t.animals.map((a) => <span key={a.id} className="pet-chip"><SpeciesIcon species={a.species} size={14} />{a.name}</span>)}
                    </span>
                  </td>
                  <td className="hide-sm muted num">{t.last_visit ? fmtDate(t.last_visit) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function PatientDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const ws = useWorkspace();
  const { can } = useSession();
  const [t, setT] = useState<TutorDetail | null>(null);
  const [edit, setEdit] = useState(false);

  useEffect(() => {
    api.getTutor(id!).then(setT).catch((e) => { toast.error(e.message); nav('/pacientes'); });
  }, [id, ws.version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!t) return <div className="page"><Spinner /></div>;
  const done = t.history.filter((a) => a.status === 'concluido').length;
  const missed = t.history.filter((a) => a.status === 'faltou').length;

  return (
    <div className="page">
      <button className="back" onClick={() => nav('/pacientes')}><ArrowLeft size={16} /> Pacientes</button>
      <div className="page-head">
        <div>
          <h1>{t.name}</h1>
          <p className="muted">{t.phone}{t.email ? ` | ${t.email}` : ''} | cliente desde {fmtDate(t.created_at.slice(0, 10))}</p>
        </div>
        <div className="head-actions">
          <a className="btn btn-secondary btn-md" href={waLink(t.phone)} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} /><span>WhatsApp</span></a>
          {can('patients.write') && <Button icon={<Pencil size={16} />} onClick={() => setEdit(true)}>Editar</Button>}
          {can('agenda.write') && <Button variant="primary" icon={<CalendarPlus size={16} />} onClick={() => ws.openNew({ tutorId: t.id })}>Agendar</Button>}
        </div>
      </div>

      <div className="patient-grid">
        <section className="card">
          <header className="card-head"><h2>Animais</h2><span className="muted">{t.animals.length}</span></header>
          <ul className="animal-list">
            {t.animals.map((a) => (
              <li key={a.id}><SpeciesIcon species={a.species} size={20} /><span><b>{a.name}</b><small>{animalLine(a) || '—'}</small></span></li>
            ))}
          </ul>
          {t.notes && <div className="pad"><span className="field-label">Observações do cliente</span><p>{t.notes}</p></div>}
          <dl className="mini-stats">
            <div><dt>Atendimentos</dt><dd className="num">{done}</dd></div>
            <div><dt>Faltas</dt><dd className="num">{missed}</dd></div>
          </dl>
        </section>

        <section className="card">
          <header className="card-head"><h2>Histórico</h2><span className="muted">{t.history.length} registro{t.history.length === 1 ? '' : 's'}</span></header>
          {!t.history.length ? <p className="muted pad">Sem atendimentos.</p> : (
            <ol className="history">
              {t.history.map((a) => (
                <li key={a.id}>
                  <button onClick={() => ws.openDetail(a.id)}>
                    <span className="h-date num"><b>{fmtDate(a.date)}</b><small>{a.time}</small></span>
                    <span className="grow">
                      <b>{a.animal.name}</b>{a.reason ? ` | ${a.reason}` : ''}
                      {a.notes && <small className="h-notes">{a.notes}</small>}
                    </span>
                    <PlanBadge plan={a.plan} />
                    <StatusBadge status={a.status} />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <EditTutor open={edit} tutor={t} onClose={() => setEdit(false)} onSaved={(x) => { setT(x); setEdit(false); }} />
    </div>
  );
}

function EditTutor({ open, tutor, onClose, onSaved }: { open: boolean; tutor: TutorDetail; onClose: () => void; onSaved: (t: TutorDetail) => void }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', notes: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF({ name: tutor.name, phone: tutor.phone, email: tutor.email ?? '', notes: tutor.notes ?? '' }); setErr({}); } }, [open, tutor]);
  async function save() {
    setBusy(true);
    try { onSaved(await api.updateTutor(tutor.id, f)); toast.ok('Cadastro atualizado.'); }
    catch (e) { if (e instanceof ApiError) { setErr(e.fields); toast.error(e.message); } }
    finally { setBusy(false); }
  }
  return (
    <Drawer open={open} onClose={onClose} title={<h2>Editar cliente</h2>}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Salvar</Button></>}>
      <div className="form-section">
        <Field label="Nome" required error={err.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Telefone" required error={err.phone}><Input value={f.phone} onChange={(e) => setF({ ...f, phone: maskPhone(e.target.value) })} inputMode="tel" /></Field>
        <Field label="E-mail" error={err.email}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Observações do cliente" error={err.notes}><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Drawer>
  );
}
