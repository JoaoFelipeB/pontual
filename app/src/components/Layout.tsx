import { createContext, useContext, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { CalendarDays, CalendarPlus, KeyRound, LayoutDashboard, LogOut, PawPrint, Settings, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { initials, ROLE_LABEL } from '../lib/format';
import { Button, Drawer, Field, Input, toast } from './ui';
import { AppointmentForm } from '../features/AppointmentForm';
import { AppointmentDetail } from '../features/AppointmentDetail';
import { UpdateBanner } from './UpdateBanner';
import type { Appointment } from '../lib/types';

/** Global actions any page can trigger: new/edit appointment, open details. `version` bumps after every change. */
interface Workspace {
  openNew: (preset?: { date?: string; time?: string; tutorId?: string }) => void;
  openEdit: (a: Appointment) => void;
  openDetail: (id: string) => void;
  version: number;
  changed: () => void;
}
const WorkspaceCtx = createContext<Workspace>(null as unknown as Workspace);
export const useWorkspace = () => useContext(WorkspaceCtx);

const NAV = [
  { to: '/painel', label: 'Painel', icon: LayoutDashboard, perm: 'reports.read' },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays, perm: 'agenda.read' },
  { to: '/pacientes', label: 'Pacientes', icon: PawPrint, perm: 'patients.read' },
  { to: '/configuracoes', label: 'Configurações', icon: Settings, perm: 'settings.manage' },
  { to: '/plataforma', label: 'Plataforma', icon: ShieldCheck, perm: 'platform' }
];

export function Layout({ children }: { children: ReactNode }) {
  const { boot, can, signOut } = useSession();
  const [form, setForm] = useState<{ open: boolean; edit?: Appointment; preset?: { date?: string; time?: string; tutorId?: string } }>({ open: false });
  const [detail, setDetail] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [pwOpen, setPwOpen] = useState(false);
  const loc = useLocation();
  const nav = NAV.filter((n) => (n.perm === 'platform' ? !!boot?.platform_admin : can(n.perm)));
  const pending = boot?.pending_requests ?? 0;
  const member = boot?.member ?? null;
  const current = NAV.find((n) => loc.pathname.startsWith(n.to));

  const ws: Workspace = {
    openNew: (preset) => setForm({ open: true, preset }),
    openEdit: (a) => { setDetail(null); setForm({ open: true, edit: a }); },
    openDetail: (id) => setDetail(id),
    version,
    changed: () => setVersion((v) => v + 1)
  };

  if (!boot || (!boot.member && !boot.platform_admin)) return null;
  return (
    <WorkspaceCtx.Provider value={ws}>
      <div className="shell">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <img src="logo.svg" alt="" width={34} height={34} />
            <div><b>Pontual</b><small>{member ? boot.clinic.name : 'Administração da plataforma'}</small></div>
          </div>
          {member && can('agenda.write') && (
            <Button variant="primary" className="sidebar-cta" icon={<CalendarPlus size={17} />} onClick={() => ws.openNew()}>
              Novo agendamento
            </Button>
          )}
          <nav className="sidebar-nav" aria-label="Menu principal">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>
                <n.icon size={18} strokeWidth={1.8} /><span>{n.label}</span>
                {n.perm === 'platform' && pending > 0 && <span className="nav-badge" aria-label={`${pending} pedidos pendentes`}>{pending}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-user">
            <span className="avatar">{initials(member?.name ?? boot.user.email)}</span>
            <div className="sidebar-user-text"><b>{member?.name ?? boot.user.email}</b><small>{member ? ROLE_LABEL[member.role] : 'Dono da plataforma'}</small></div>
            <button className="icon-btn" onClick={() => setPwOpen(true)} aria-label="Trocar senha" title="Trocar senha"><KeyRound size={17} /></button>
            <button className="icon-btn" onClick={signOut} aria-label="Sair" title="Sair"><LogOut size={17} /></button>
          </div>
        </aside>

        <div className="main">
          <header className="mobile-top">
            <img src="logo.svg" alt="" width={28} height={28} />
            <b>{current?.label ?? 'Pontual'}</b>
            <button className="icon-btn" onClick={() => setPwOpen(true)} aria-label="Trocar senha"><KeyRound size={17} /></button>
            <button className="icon-btn" onClick={signOut} aria-label="Sair"><LogOut size={17} /></button>
          </header>
          <main className="content"><UpdateBanner />{children}</main>
        </div>

        <nav className="tabbar" aria-label="Menu">
          {nav.slice(0, 2).map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `tab ${isActive ? 'is-active' : ''}`}>
              <n.icon size={21} strokeWidth={1.8} /><span>{n.label}</span>
            </NavLink>
          ))}
          {member && can('agenda.write') && (
            <button className="tab tab-cta" onClick={() => ws.openNew()} aria-label="Novo agendamento">
              <span className="tab-cta-icon"><CalendarPlus size={21} /></span><span>Agendar</span>
            </button>
          )}
          {nav.slice(2).map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `tab ${isActive ? 'is-active' : ''}`}>
              <span className="tab-icon"><n.icon size={21} strokeWidth={1.8} />{n.perm === 'platform' && pending > 0 && <span className="nav-badge dot">{pending}</span>}</span>
              <span>{n.label === 'Configurações' ? 'Ajustes' : n.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      {member && <AppointmentForm
        open={form.open} edit={form.edit} preset={form.preset}
        onClose={() => setForm({ open: false })}
        onSaved={(a) => { setForm({ open: false }); ws.changed(); setDetail(a.id); }}
      />}
      {member && <AppointmentDetail id={detail} onClose={() => setDetail(null)} />}
      <ChangePassword open={pwOpen} onClose={() => setPwOpen(false)} />
    </WorkspaceCtx.Provider>
  );
}

function ChangePassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (pw.length < 8) return setErr('Use pelo menos 8 caracteres.');
    if (pw !== pw2) return setErr('As duas senhas não são iguais.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setErr(/different from the old/i.test(error.message) ? 'A nova senha precisa ser diferente da atual.' : error.message);
    toast.ok('Senha alterada.');
    setPw(''); setPw2(''); setErr(null); onClose();
  }
  return (
    <Drawer open={open} onClose={onClose} title={<h2>Trocar senha</h2>}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={save}>Salvar</Button></>}>
      <div className="form-section">
        <Field label="Nova senha" hint="Mínimo de 8 caracteres."><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(null); }} /></Field>
        <Field label="Repita a nova senha" error={err ?? undefined}><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => { setPw2(e.target.value); setErr(null); }} /></Field>
      </div>
    </Drawer>
  );
}
