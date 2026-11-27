import { useEffect, useMemo, useState } from 'react';
import { BellRing, CalendarDays, Check, ChevronLeft, ChevronRight, MessageCircle, Plus, Search, Stethoscope } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { addDays, fmtDate, fmtLong, fmtShort, fmtWeekday, relDay, waLink } from '../lib/format';
import type { Appointment, Slot } from '../lib/types';
import { Button, Drawer, Empty, PlanBadge, Segmented, Select, SpeciesIcon, Spinner, StatusBadge, toast, useDebounced } from '../components/ui';
import { useWorkspace } from '../components/Layout';

export function AgendaPage() {
  const [view, setView] = useState<'dia' | 'lista'>(() => (localStorage.getItem('vc.agenda.view') as 'dia' | 'lista') || 'dia');
  useEffect(() => { localStorage.setItem('vc.agenda.view', view); }, [view]);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Agenda</h1></div>
        <Segmented label="Visualização" value={view} onChange={setView}
          options={[{ value: 'dia', label: 'Dia' }, { value: 'lista', label: 'Lista' }]} />
      </div>
      {view === 'dia' ? <DayView /> : <ListView />}
    </div>
  );
}

// =================================================================== DAY

function DayView() {
  const { boot, can } = useSession();
  const ws = useWorkspace();
  const [date, setDate] = useState(boot!.today);
  // vets start on their own agenda; everyone else sees the whole clinic
  const [vet, setVet] = useState(() => (boot!.member?.role === 'veterinario' ? boot!.member.id : ''));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [all, setAll] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const items = useMemo(() => (vet ? all.filter((a) => a.vet_id === vet) : all), [all, vet]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([api.slots(date, null, vet), api.listAppointments({ date, limit: 200 })])
      .then(([s, l]) => { if (live && s.date === date) { setSlots(s.slots); setAll(l.data); } })
      .catch((e) => toast.error(e.message))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [date, vet, ws.version]);

  const rows = useMemo(() => {
    const times = new Set([...(slots ?? []).map((s) => s.time), ...items.map((a) => a.time)]);
    return [...times].sort().map((time) => ({
      time,
      slot: slots?.find((s) => s.time === time),
      appts: items.filter((a) => a.time === time).sort((x, y) => (x.status === 'agendado' ? -1 : 1) - (y.status === 'agendado' ? -1 : 1))
    }));
  }, [slots, items]);

  const count = (s: string) => items.filter((a) => a.status === s).length;
  const free = (slots ?? []).filter((s) => s.available).length;
  const isPast = date < boot!.today;
  const [reminders, setReminders] = useState(false);

  return (
    <div className="day">
      <div className="day-bar card">
        <div className="day-nav">
          <button className="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="Dia anterior"><ChevronLeft size={18} /></button>
          <button className="icon-btn" onClick={() => setDate(addDays(date, 1))} aria-label="Próximo dia"><ChevronRight size={18} /></button>
          <Button size="sm" onClick={() => setDate(boot!.today)} disabled={date === boot!.today}>Hoje</Button>
          <label className="date-pick">
            <CalendarDays size={16} />
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Escolher data" />
          </label>
        </div>
        <div className="day-label">
          <b>{relDay(date, boot!.today) === fmtLong(date) ? fmtLong(date) : `${relDay(date, boot!.today)}, ${fmtLong(date).toLowerCase()}`}</b>
        </div>
        <WeekStrip date={date} today={boot!.today} onPick={setDate} />
      </div>
      {boot!.vets.length > 0 && (
        <div className="vet-filter">
          <Stethoscope size={16} />
          <Select value={vet} onChange={(e) => setVet(e.target.value)} aria-label="Veterinário" className="input compact">
            <option value="">Todos os veterinários</option>
            {boot!.vets.map((v) => <option key={v.id} value={v.id}>{v.id === boot!.member?.id ? `Minha agenda (${v.name})` : v.name}</option>)}
          </Select>
          {vet && <span className="muted">Horários livres consideram a clínica toda.</span>}
        </div>
      )}

      <div className="day-grid">
        <div className="card timeline-card">
          {loading && !slots ? <Spinner /> : (
            <ol className="timeline">
              {rows.map((r) => (
                <li key={r.time} className={`tl-row ${r.slot?.reason === 'passado' && !r.appts.length ? 'is-past' : ''}`}>
                  <span className="tl-time">{r.time}</span>
                  <div className="tl-body">
                    {r.appts.map((a) => (
                      <button key={a.id} className={`tl-appt tl-${a.status}`} onClick={() => ws.openDetail(a.id)}>
                        <SpeciesIcon species={a.animal.species} />
                        <span className="tl-main">
                          <b>{a.animal.name}</b>
                          <small>{a.tutor.name}{a.reason ? ` | ${a.reason}` : ''}</small>
                        </span>
                        <span className="tl-side">
                          {a.vet_name && <small className="muted hide-sm">{a.vet_name}</small>}
                          <PlanBadge plan={a.plan} />
                          {a.status !== 'agendado' && <StatusBadge status={a.status} />}
                        </span>
                      </button>
                    ))}
                    {!r.appts.some((a) => a.status === 'agendado') && r.slot?.available && can('agenda.write') && (
                      <button className="tl-free" onClick={() => ws.openNew({ date, time: r.time })}>
                        <Plus size={15} /> Livre
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <aside className="day-side">
          <div className="card stat-list">
            <h3>Resumo do dia</h3>
            <dl>
              <dt>Agendados</dt><dd>{count('agendado')}</dd>
              <dt>Concluídos</dt><dd>{count('concluido')}</dd>
              <dt>Faltas</dt><dd>{count('faltou')}</dd>
              <dt>Cancelados</dt><dd>{count('cancelado')}</dd>
              <dt>Horários livres</dt><dd>{isPast ? '—' : free}</dd>
            </dl>
          </div>
          {can('agenda.write') && !isPast && (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => ws.openNew({ date })} className="block">
              Agendar neste dia
            </Button>
          )}
          {can('agenda.write') && (
            <Button icon={<BellRing size={16} />} onClick={() => setReminders(true)} className="block">
              Lembretes de amanhã
            </Button>
          )}
        </aside>
      </div>
      <RemindersDrawer open={reminders} onClose={() => setReminders(false)} />
    </div>
  );
}

/** Tomorrow's appointments with a one-tap WhatsApp reminder each; marks who already got it. */
function RemindersDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { boot } = useSession();
  const ws = useWorkspace();
  const tomorrow = addDays(boot!.today, 1);
  const [items, setItems] = useState<Appointment[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setItems(null);
    api.listAppointments({ date: tomorrow, status: 'agendado', limit: 200 }).then((r) => setItems(r.data)).catch((e) => toast.error(e.message));
  }, [open, tomorrow]);

  const message = (a: Appointment) =>
    `Olá, ${a.tutor.name.split(' ')[0]}! Lembrete da ${boot!.clinic.name}: ${a.animal.name} tem atendimento amanhã (${fmtDate(a.date)}) às ${a.time}${a.vet_name ? ` com ${a.vet_name}` : ''}. Pode confirmar a presença respondendo esta mensagem?`;

  async function sent(a: Appointment) {
    try {
      const r = await api.markReminderSent(a.id);
      setItems((xs) => xs?.map((x) => (x.id === a.id ? r : x)) ?? null);
      ws.changed();
    } catch (e: any) { toast.error(e.message); }
  }

  const pending = items?.filter((a) => !a.reminder_sent_at).length ?? 0;
  return (
    <Drawer open={open} onClose={onClose} title={<><h2>Lembretes de amanhã</h2><small>{fmtLong(tomorrow)}</small></>}
      footer={<Button onClick={onClose}>Fechar</Button>}>
      {!items ? <Spinner /> : !items.length ? (
        <Empty icon={<BellRing size={22} />} title="Nenhum atendimento amanhã" />
      ) : (
        <div className="form-section">
          <p className="muted">{pending ? `${pending} lembrete${pending === 1 ? '' : 's'} para enviar.` : 'Todos os lembretes foram enviados.'} Toque em <b>Enviar</b>: o WhatsApp abre com a mensagem pronta.</p>
          <ul className="reminders">
            {items.map((a) => (
              <li key={a.id} className={a.reminder_sent_at ? 'is-sent' : ''}>
                <span className="num time">{a.time}</span>
                <span className="grow"><b>{a.animal.name}</b><small>{a.tutor.name} | {a.tutor.phone}</small></span>
                {a.reminder_sent_at
                  ? <span className="sent"><Check size={15} /> Enviado</span>
                  : <a className="btn btn-primary btn-sm" href={`${waLink(a.tutor.phone)}?text=${encodeURIComponent(message(a))}`}
                      target="_blank" rel="noopener noreferrer" onClick={() => sent(a)}><MessageCircle size={15} /><span>Enviar</span></a>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Drawer>
  );
}

function WeekStrip({ date, today, onPick }: { date: string; today: string; onPick: (d: string) => void }) {
  // week starting on Sunday that contains `date`
  const wd = new Date(date + 'T12:00:00Z').getUTCDay();
  const start = addDays(date, -wd);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className="week-strip" role="tablist" aria-label="Semana">
      {days.map((d) => (
        <button key={d} role="tab" aria-selected={d === date} onClick={() => onPick(d)}
          className={`wk ${d === date ? 'is-active' : ''} ${d === today ? 'is-today' : ''}`}>
          <small>{fmtWeekday(d)}</small><b>{d.slice(8)}</b>
        </button>
      ))}
    </div>
  );
}

// =================================================================== LIST

function ListView() {
  const { boot } = useSession();
  const ws = useWorkspace();
  const [period, setPeriod] = useState<'proximos' | 'anteriores'>('proximos');
  const [status, setStatus] = useState('');
  const [plan, setPlan] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);
  const [items, setItems] = useState<Appointment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);

  const params = useMemo(() => ({
    ...(period === 'proximos' ? { from: boot!.today, order: 'asc' as const } : { to: addDays(boot!.today, -1), order: 'desc' as const }),
    status, plan, q: dq, limit: 40
  }), [period, status, plan, dq, boot]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api.listAppointments(params).then((r) => { if (live) { setItems(r.data); setCursor(r.next_cursor); } })
      .catch((e) => toast.error(e.message)).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [params, ws.version]);

  async function loadMore() {
    setMore(true);
    try {
      const r = await api.listAppointments({ ...params, cursor });
      setItems((x) => [...x, ...r.data]);
      setCursor(r.next_cursor);
    } catch (e: any) { toast.error(e.message); } finally { setMore(false); }
  }

  const filtered = status || plan || dq;
  return (
    <div className="card list-card">
      <div className="filters">
        <div className="search-box">
          <Search size={16} />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Animal, tutor ou telefone" aria-label="Buscar" />
        </div>
        <Segmented label="Período" value={period} onChange={setPeriod}
          options={[{ value: 'proximos', label: 'Próximos' }, { value: 'anteriores', label: 'Anteriores' }]} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Todos os status</option>
          <option value="agendado">Agendados</option><option value="concluido">Concluídos</option>
          <option value="faltou">Faltas</option><option value="cancelado">Cancelados</option>
        </Select>
        <Select value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Plano">
          <option value="">Todos os planos</option>
          {boot!.plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
        </Select>
      </div>

      {loading ? <Spinner /> : !items.length ? (
        <Empty icon={<CalendarDays size={22} />}
          title={filtered ? 'Nada encontrado' : period === 'proximos' ? 'Nenhum agendamento futuro' : 'Sem histórico ainda'}
          text={filtered ? 'Ajuste a busca ou os filtros.' : undefined} />
      ) : (
        <>
          <table className="table">
            <thead>
              <tr><th>Data</th><th>Paciente</th><th className="hide-sm">Tutor</th><th className="hide-md">Veterinário</th><th className="hide-sm">Plano</th><th>Status</th></tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} onClick={() => ws.openDetail(a.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && ws.openDetail(a.id)}>
                  <td className="nowrap"><b className="num">{fmtShort(a.date)}</b> <span className="muted num">{a.time}</span></td>
                  <td><span className="cell-pet"><SpeciesIcon species={a.animal.species} size={16} />{a.animal.name}</span></td>
                  <td className="hide-sm"><span className="cell-two"><span>{a.tutor.name}</span><small>{a.tutor.phone}</small></span></td>
                  <td className="hide-md muted">{a.vet_name ?? '—'}</td>
                  <td className="hide-sm"><PlanBadge plan={a.plan} /></td>
                  <td><StatusBadge status={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {cursor && <div className="table-more"><Button onClick={loadMore} loading={more}>Carregar mais</Button></div>}
        </>
      )}
    </div>
  );
}
