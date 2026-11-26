import { useEffect, useState } from 'react';
import { CalendarCheck, CalendarClock, PawPrint, UserX } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { fmtLong, fmtMonth, fmtWeekday, fmtShort } from '../lib/format';
import type { Appointment } from '../lib/types';
import { PlanBadge, SpeciesIcon, Spinner, StatusBadge, toast } from '../components/ui';
import { useWorkspace } from '../components/Layout';

export function DashboardPage() {
  const { boot } = useSession();
  const ws = useWorkspace();
  const [d, setD] = useState<any>(null);
  const [today, setToday] = useState<Appointment[]>([]);

  useEffect(() => {
    Promise.all([api.dashboard(), api.listAppointments({ date: boot!.today, limit: 100 })])
      .then(([x, l]) => { setD(x); setToday(l.data.filter((a) => a.status !== 'cancelado')); })
      .catch((e) => toast.error(e.message));
  }, [ws.version, boot]);

  if (!d) return <div className="page"><Spinner /></div>;
  const t = d.totals;
  const maxDay = Math.max(1, ...d.next_days.map((x: any) => x.n));
  const totalPlan = d.by_plan.reduce((s: number, x: any) => s + x.n, 0);
  const next = today.find((a) => a.status === 'agendado' && a.time >= boot!.now);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{greet(boot!.now)}{boot!.member ? `, ${boot!.member.name.split(' ')[0]}` : ''}</h1>
          <p className="muted">{fmtLong(boot!.today)}. {next ? `Próximo atendimento às ${next.time}: ${next.animal.name}.` : 'Nenhum atendimento pendente para hoje.'}</p>
        </div>
      </div>

      <div className="kpis">
        <Kpi icon={<CalendarClock size={18} />} label="Atendimentos hoje" value={t.today} sub={`${t.today_done} concluído${t.today_done === 1 ? '' : 's'}`} />
        <Kpi icon={<CalendarCheck size={18} />} label="Agendados à frente" value={t.upcoming} sub="a partir de amanhã" />
        <Kpi icon={<UserX size={18} />} label="Faltas e cancelamentos" value={t.month_cancelled} sub={`no mês, ${t.month_noshow} por falta`} />
        <Kpi icon={<PawPrint size={18} />} label="Pacientes" value={t.patients} sub="animais cadastrados" />
      </div>

      <div className="dash-grid">
        <section className="card">
          <header className="card-head"><h2>Hoje</h2><span className="muted">{today.length} atendimento{today.length === 1 ? '' : 's'}</span></header>
          {!today.length ? <p className="muted pad">Nenhum atendimento marcado para hoje.</p> : (
            <ul className="agenda-mini">
              {today.map((a) => (
                <li key={a.id}>
                  <button onClick={() => ws.openDetail(a.id)} className={a === next ? 'is-next' : ''}>
                    <span className="num time">{a.time}</span>
                    <SpeciesIcon species={a.animal.species} size={16} />
                    <span className="grow"><b>{a.animal.name}</b><small>{a.tutor.name}</small></span>
                    <span className="hide-sm"><PlanBadge plan={a.plan} /></span>
                    <StatusBadge status={a.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="dash-col">
          <section className="card">
            <header className="card-head"><h2>Próximos 7 dias</h2></header>
            <div className="bars">
              {d.next_days.map((x: any) => (
                <div key={x.date} className="bar-col" title={`${fmtShort(x.date)}: ${x.n}`}>
                  <span className="bar-n num">{x.n || ''}</span>
                  <div className="bar-v"><i style={{ height: `${(x.n / maxDay) * 100}%` }} /></div>
                  <small>{fmtWeekday(x.date)}</small>
                </div>
              ))}
            </div>
          </section>
          <section className="card">
            <header className="card-head"><h2>Por forma de atendimento</h2><span className="muted">{fmtMonth(boot!.today)}</span></header>
            {!totalPlan ? <p className="muted pad">Sem atendimentos neste mês.</p> : (
              <ul className="hbars">
                {d.by_plan.map((x: any) => (
                  <li key={x.plan}>
                    <span>{x.plan}</span>
                    <div className="hbar"><i style={{ width: `${(x.n / totalPlan) * 100}%` }} /></div>
                    <b className="num">{x.n}</b>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number; sub: string }) {
  return (
    <div className="kpi card">
      <span className="kpi-icon">{icon}</span>
      <span className="kpi-label">{label}</span>
      <b className="kpi-value num">{value}</b>
      <small className="muted">{sub}</small>
    </div>
  );
}

const greet = (hm: string) => (hm < '12:00' ? 'Bom dia' : hm < '18:00' ? 'Boa tarde' : 'Boa noite');
