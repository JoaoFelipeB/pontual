import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, CircleCheck, MessageCircle, Pencil, RotateCcw, Trash2, UserX } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { animalLine, fmtDate, relDay, waLink } from '../lib/format';
import type { Appointment, Status } from '../lib/types';
import { Button, Confirm, Drawer, PlanBadge, SpeciesIcon, Spinner, StatusBadge, Textarea, toast } from '../components/ui';
import { useWorkspace } from '../components/Layout';

type Pending = { status?: Status; remove?: boolean } | null;

export function AppointmentDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { boot, can } = useSession();
  const ws = useWorkspace();
  const nav = useNavigate();
  const [a, setA] = useState<Appointment | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Pending>(null);

  useEffect(() => {
    if (!id) { setA(null); return; }
    setA(null);
    api.getAppointment(id).then((x) => { setA(x); setNotes(x.notes ?? ''); })
      .catch((e) => { toast.error(e.message); onClose(); });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(key: string, fn: () => Promise<Appointment | unknown>, ok: string, close = false) {
    setBusy(key);
    try {
      const r = await fn();
      toast.ok(ok);
      ws.changed();
      if (close) onClose();
      else if (r && typeof r === 'object' && 'id' in r) { setA(r as Appointment); setNotes((r as Appointment).notes ?? ''); }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível concluir.');
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  const STATUS_OK: Record<Status, string> = {
    concluido: 'Atendimento concluído.', cancelado: 'Agendamento cancelado.', faltou: 'Falta registrada.', agendado: 'Agendamento reaberto.'
  };
  const setStatus = (s: Status) => run(s, () => api.setStatus(a!.id, s), STATUS_OK[s]);

  const message = a && boot
    ? `Olá, ${a.tutor.name.split(' ')[0]}! Confirmando o atendimento de ${a.animal.name} na ${boot.clinic.name}: ${relDay(a.date, boot.today).toLowerCase()} (${fmtDate(a.date)}) às ${a.time}.`
    : '';

  return (
    <>
      <Drawer
        open={!!id} onClose={onClose}
        title={a ? (
          <div className="detail-title">
            <SpeciesIcon species={a.animal.species} size={20} />
            <div><h2>{a.animal.name}</h2><small>Nº {a.number}</small></div>
          </div>
        ) : <h2>Agendamento</h2>}
        footer={a && (
          <div className="detail-actions">
            {a.status === 'agendado' ? (<>
              {can('agenda.conclude') && <Button variant="primary" icon={<CircleCheck size={16} />} loading={busy === 'concluido'} onClick={() => setStatus('concluido')}>Concluir</Button>}
              {can('agenda.cancel') && <Button icon={<UserX size={16} />} loading={busy === 'faltou'} onClick={() => setConfirm({ status: 'faltou' })}>Faltou</Button>}
              {can('agenda.cancel') && <Button icon={<Ban size={16} />} onClick={() => setConfirm({ status: 'cancelado' })}>Cancelar</Button>}
            </>) : can('agenda.cancel') && (
              <Button icon={<RotateCcw size={16} />} loading={busy === 'agendado'} onClick={() => setStatus('agendado')}>Reabrir</Button>
            )}
            <span className="spacer" />
            {can('agenda.write') && <Button variant="ghost" icon={<Pencil size={16} />} onClick={() => ws.openEdit(a)}>Editar</Button>}
            {can('agenda.delete') && <Button variant="ghost" className="danger-text" icon={<Trash2 size={16} />} onClick={() => setConfirm({ remove: true })} aria-label="Excluir" />}
          </div>
        )}
      >
        {!a ? <Spinner /> : (
          <div className="detail">
            <div className="detail-when">
              <div>
                <b>{a.time}</b>
                <span>{relDay(a.date, boot!.today)}{a.date !== boot!.today ? '' : ''}, {fmtDate(a.date)}</span>
              </div>
              <StatusBadge status={a.status} />
            </div>

            <dl className="dl">
              <dt>Animal</dt><dd>{animalLine(a.animal) || '—'}</dd>
              <dt>Tutor</dt>
              <dd>
                {can('patients.read')
                  ? <button className="link" onClick={() => { onClose(); nav(`/pacientes/${a.tutor.id}`); }}>{a.tutor.name}</button>
                  : a.tutor.name}
              </dd>
              <dt>Telefone</dt>
              <dd className="phone-row">
                <a href={`tel:${a.tutor.phone.replace(/\D/g, '')}`}>{a.tutor.phone}</a>
                <a className="wa" href={`${waLink(a.tutor.phone)}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
                  <MessageCircle size={15} />Enviar confirmação
                </a>
              </dd>
              <dt>Atendimento</dt><dd><PlanBadge plan={a.plan_name} /></dd>
              <dt>Motivo</dt><dd>{a.reason || '—'}</dd>
              <dt>Veterinário</dt><dd>{a.vet_name || 'Sem preferência'}</dd>
              <dt>Agendado por</dt><dd>{a.created_by_name || '—'}</dd>
            </dl>

            <div className="notes">
              <label className="field-label" htmlFor="appt-notes">Observações clínicas</label>
              {can('agenda.notes') ? (<>
                <Textarea id="appt-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Peso, sinais, conduta, medicação…" />
                {notes !== (a.notes ?? '') && (
                  <div className="notes-actions">
                    <Button size="sm" variant="ghost" onClick={() => setNotes(a.notes ?? '')}>Descartar</Button>
                    <Button size="sm" variant="primary" loading={busy === 'notes'}
                      onClick={() => run('notes', () => api.setNotes(a.id, notes), 'Observações salvas.')}>Salvar observações</Button>
                  </div>
                )}
              </>) : <p className="muted">{a.notes || 'Sem observações.'}</p>}
            </div>
          </div>
        )}
      </Drawer>

      <Confirm
        open={!!confirm}
        title={confirm?.remove ? 'Excluir agendamento?' : confirm?.status === 'faltou' ? 'Registrar falta?' : 'Cancelar agendamento?'}
        text={confirm?.remove
          ? 'O registro será apagado de vez. Para manter o histórico do paciente, prefira Cancelar.'
          : confirm?.status === 'faltou'
            ? `${a?.animal.name} não compareceu. O horário fica livre e a falta entra no histórico.`
            : 'O horário fica livre para outro atendimento. Dá para reabrir depois.'}
        confirmLabel={confirm?.remove ? 'Excluir' : confirm?.status === 'faltou' ? 'Registrar falta' : 'Cancelar agendamento'}
        danger busy={!!busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm?.remove
          ? run('delete', () => api.deleteAppointment(a!.id), 'Agendamento excluído.', true)
          : setStatus(confirm!.status!)}
      />
    </>
  );
}
