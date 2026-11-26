import { useState } from 'react';
import { CalendarCheck, ShieldCheck, Smartphone } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Field, Input, Segmented, toast } from '../components/ui';

const AUTH_MSG: Record<string, string> = {
  'Invalid login credentials': 'E-mail ou senha incorretos.',
  'Email not confirmed': 'Confirme seu e-mail pelo link que enviamos antes de entrar.',
  'User already registered': 'Este e-mail já tem conta. Use Entrar.',
  'Password should be at least 6 characters.': 'A senha precisa de pelo menos 6 caracteres.'
};
const authMsg = (m: string) => AUTH_MSG[m] ?? (/fetch|network/i.test(m) ? 'Sem conexão com o servidor.' : m);

export function LoginPage() {
  const [mode, setMode] = useState<'entrar' | 'criar'>('entrar');
  const [forgot, setForgot] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (mode === 'entrar') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) setError(authMsg(error.message));
      } else {
        if (password.length < 8) { setError('Use uma senha com pelo menos 8 caracteres.'); return; }
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) setError(authMsg(error.message));
        else if (!data.session) setSent(true);
      }
    } catch { setError('Sem conexão com o servidor.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="auth">
      <aside className="auth-side">
        <div className="auth-brand"><img src="logo.svg" alt="" width={40} height={40} /><b>Pontual</b></div>
        <h1>Agenda e prontuário da sua clínica veterinária, no celular e no computador.</h1>
        <ul>
          <li><CalendarCheck size={18} />Agenda por horário, sem conflito, com confirmação por WhatsApp.</li>
          <li><ShieldCheck size={18} />Cada pessoa da equipe com o seu acesso: recepção, veterinário e administração.</li>
          <li><Smartphone size={18} />Os dados ficam na nuvem: acesse de qualquer lugar.</li>
        </ul>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-brand mobile-only"><img src="logo.svg" alt="" width={36} height={36} /><b>Pontual</b></div>
          {forgot ? <ForgotPassword initialEmail={email} onBack={() => setForgot(false)} /> : sent ? (
            <>
              <h2>Confirme seu e-mail</h2>
              <p className="muted">Enviamos um link para <b>{email}</b>. Abra o e-mail, toque no link e depois volte aqui para entrar.</p>
              <Button variant="primary" className="block" onClick={() => { setSent(false); setMode('entrar'); }}>Já confirmei, entrar</Button>
            </>
          ) : (
            <form onSubmit={submit} noValidate>
              <h2>{mode === 'entrar' ? 'Entrar' : 'Criar conta'}</h2>
              <p className="muted">{mode === 'entrar' ? 'Use o e-mail e a senha da sua conta.' : 'Recebeu um convite da clínica? Crie a conta com o mesmo e-mail do convite.'}</p>
              <Segmented label="Acesso" value={mode} onChange={(v) => { setMode(v); setError(null); }}
                options={[{ value: 'entrar', label: 'Entrar' }, { value: 'criar', label: 'Criar conta' }]} />
              <Field label="E-mail"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
              <Field label="Senha" hint={mode === 'criar' ? 'Mínimo de 8 caracteres.' : undefined}>
                <Input type="password" autoComplete={mode === 'entrar' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
              </Field>
              {error && <div className="alert" role="alert">{error}</div>}
              <Button variant="primary" type="submit" loading={busy} className="block">{mode === 'entrar' ? 'Entrar' : 'Criar conta'}</Button>
              {mode === 'entrar' && <button type="button" className="link center" onClick={() => setForgot(true)}>Esqueci minha senha</button>}
            </form>
          )}
        </div>
      </main>
    </div>
  );
}

/** Signed in, but not linked to any clinic yet. */
export function OnboardingPage() {
  const { boot, setBoot, signOut } = useSession();
  const [step, setStep] = useState<'choice' | 'create'>('choice');
  const [f, setF] = useState({ clinic: '', name: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { setBoot(await api.createClinic(f.clinic, f.name)); toast.ok('Clínica criada. Bem-vindo!'); }
    catch (x) { if (x instanceof ApiError) { setErr(x.fields); toast.error(x.message); } }
    finally { setBusy(false); }
  }

  return (
    <div className="auth auth-single">
      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-brand"><img src="logo.svg" alt="" width={36} height={36} /><b>Pontual</b></div>
          {step === 'choice' ? (
            <>
              <h2>Quase lá</h2>
              <p className="muted">A conta <b>{boot?.user.email}</b> ainda não está ligada a nenhuma clínica.</p>
              <div className="choice">
                <button onClick={() => setStep('create')}><b>Sou o responsável pela clínica</b><small>Cadastrar a clínica e virar administrador.</small></button>
                <div className="choice-info"><b>Faço parte de uma equipe</b><small>Peça ao administrador para convidar <b>{boot?.user.email}</b> em Configurações &gt; Equipe e entre de novo.</small></div>
              </div>
              <Button variant="ghost" className="block" onClick={signOut}>Sair</Button>
            </>
          ) : (
            <form onSubmit={create} noValidate>
              <h2>Cadastrar clínica</h2>
              <Field label="Nome da clínica" required error={err.clinic_name}><Input value={f.clinic} onChange={(e) => setF({ ...f, clinic: e.target.value })} /></Field>
              <Field label="Seu nome" required error={err.your_name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Button variant="primary" type="submit" loading={busy} className="block">Criar clínica</Button>
              <Button variant="ghost" type="button" className="block" onClick={() => setStep('choice')}>Voltar</Button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}

export function NotConfiguredPage() {
  return (
    <div className="auth auth-single">
      <main className="auth-main">
        <div className="auth-card">
          <h2>Configuração pendente</h2>
          <p className="muted">O app ainda não sabe qual banco de dados usar. Preencha <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> no arquivo <code>app/.env</code> e gere o app de novo. O passo a passo está no COMECE-AQUI.md.</p>
        </div>
      </main>
    </div>
  );
}

/** Password recovery is done by the clinic administrator (no e-mail needed). */
function ForgotPassword({ onBack }: { initialEmail: string; onBack: () => void }) {
  return (
    <div className="auth-card-inner">
      <h2>Esqueceu a senha?</h2>
      <p className="muted">Peça ao administrador da clínica para criar uma senha temporária para você em
        <b> Configurações &gt; Equipe &gt; Redefinir senha</b>. Depois de entrar, troque pela sua no ícone de chave ao lado do seu nome.</p>
      <p className="muted">Se você é o administrador e esqueceu a sua, fale com quem configurou o sistema.</p>
      <Button variant="primary" className="block" onClick={onBack}>Voltar para entrar</Button>
    </div>
  );
}

/** Shown after a valid reset code: the user is signed in and must choose a new password. */
export function NewPasswordPage() {
  const { setRecovery, refresh, signOut } = useSession();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) { setError('Use pelo menos 8 caracteres.'); return; }
    if (pw !== pw2) { setError('As duas senhas não são iguais.'); return; }
    setBusy(true); setError(null);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { setError(authMsg(error.message)); return; }
    setRecovery(false);
    toast.ok('Senha alterada.');
    await refresh();
  }
  return (
    <div className="auth auth-single">
      <main className="auth-main">
        <form className="auth-card" onSubmit={save} noValidate>
          <div className="auth-brand"><img src="logo.svg" alt="" width={36} height={36} /><b>Pontual</b></div>
          <h2>Nova senha</h2>
          <Field label="Nova senha" hint="Mínimo de 8 caracteres."><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field label="Repita a nova senha"><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
          {error && <div className="alert" role="alert">{error}</div>}
          <Button variant="primary" type="submit" loading={busy} className="block">Salvar e entrar</Button>
          <Button variant="ghost" type="button" className="block" onClick={signOut}>Cancelar</Button>
        </form>
      </main>
    </div>
  );
}
