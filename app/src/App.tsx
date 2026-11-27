import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { isConfigured } from './lib/supabase';
import { SessionProvider, useSession } from './lib/session';
import { Layout } from './components/Layout';
import { Spinner, Toaster } from './components/ui';
import { AccessPage, LoginPage, NewPasswordPage, NotConfiguredPage } from './pages/Login';
import { PlatformPage } from './pages/Platform';
import { TERMS_VERSION, TermsAcceptPage } from './pages/Legal';
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
  if (boot.terms_version !== TERMS_VERSION) return <TermsAcceptPage />;
  if (!boot.member && !boot.platform_admin) return <AccessPage />;
  if (!boot.member) {
    // platform owner without a clinic of their own: only the platform area
    return (
      <Layout>
        <Routes>
          <Route path="/plataforma" element={<PlatformPage />} />
          <Route path="*" element={<Navigate to="/plataforma" replace />} />
        </Routes>
      </Layout>
    );
  }
  const home = can('reports.read') ? '/painel' : '/agenda';
  return (
    <Layout>
      <Routes>
        {boot.platform_admin && <Route path="/plataforma" element={<PlatformPage />} />}
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
