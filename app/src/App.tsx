import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { isConfigured } from './lib/supabase';
import { SessionProvider, useSession } from './lib/session';
import { Layout } from './components/Layout';
import { Spinner, Toaster } from './components/ui';
import { LoginPage, NewPasswordPage, NotConfiguredPage, OnboardingPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { AgendaPage } from './pages/Agenda';
import { PatientDetailPage, PatientsPage } from './pages/Patients';
import { SettingsPage } from './pages/Settings';

function Gate() {
  const { session, boot, loading, error, can, refresh, recovery } = useSession();
  if (loading) return <div className="boot"><Spinner /></div>;
  if (!session) return <LoginPage />;
  if (recovery) return <NewPasswordPage />;
  if (!boot) return (
    <div className="boot"><div className="auth-card"><h2>Não foi possível carregar</h2><p className="muted">{error}</p>
      <button className="btn btn-primary btn-md block" onClick={refresh}>Tentar de novo</button></div></div>
  );
  if (!boot.member) return <OnboardingPage />;
  const home = can('reports.read') ? '/painel' : '/agenda';
  return (
    <Layout>
      <Routes>
        <Route path="/painel" element={<DashboardPage />} />
        <Route path="/agenda" element={<AgendaPage />} />
        <Route path="/pacientes" element={<PatientsPage />} />
        <Route path="/pacientes/:id" element={<PatientDetailPage />} />
        {can('settings.manage') && <Route path="/configuracoes" element={<SettingsPage />} />}
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  if (!isConfigured) return <NotConfiguredPage />;
  return (
    <SessionProvider>
      <HashRouter><Gate /></HashRouter>
      <Toaster />
    </SessionProvider>
  );
}
