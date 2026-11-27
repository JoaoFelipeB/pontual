import { useState } from 'react';
import { CalendarCheck, ShieldCheck, Smartphone } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Field, Input, Segmented, Textarea, toast } from '../components/ui';
import { maskPhone } from '../lib/format';
import { markTermsTicked, TermsLink } from './Legal';

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
  const [terms, setTerms] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (mode === 'entrar') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) setError(authMsg(error.message));
      } else {
        if (password.length < 8) { setError('Use uma senha com pelo menos 8 caracteres.'); return; }
        if (!terms) { setError('Para criar a conta, aceite os Termos de Uso e a Política de Privacidade.'); return; }
        markTermsTicked();
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
              <p className="muted">{mode === 'entrar' ? 'Use o e-mail e a senha da sua conta.' : 'Depois de criar a conta, o acesso é liberado pela administração. Recebeu convite da clínica? Use o mesmo e-mail do convite e entre direto.'}</p>
              <Segmented label="Acesso" value={mode} onChange={(v) => { setMode(v); setError(null); }}
                options={[{ value: 'entrar', label: 'Entrar' }, { value: 'criar', label: 'Criar conta' }]} />
              <Field label="E-mail"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
              <Field label="Senha" hint={mode === 'criar' ? 'Mínimo de 8 caracteres.' : undefined}>
                <Input type="password" autoComplete={mode === 'entrar' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />
              </Field>
              {mode === 'criar' && (
                <label className="check">
                  <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
                  <span>Li e aceito os <TermsLink />.</span>
                </label>
              )}
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

/**
 * Signed in, but without access: request access, wait for approval, or see why it was refused/blocked.
 * Access is granted only by the platform owner (or by a company admin's invite).
 */
export function AccessPage() {
  const { boot, setBoot, refresh, signOut } = useSession();
  const req = boot?.access_request ?? null;
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ name: req?.name ?? '', phone: req?.phone ?? '', company_hint: req?.company_hint ?? '', message: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { setBoot(await api.requestAccess(f)); setEditing(false); setErr({}); toast.ok('Pedido enviado.'); }
    catch (x) { if (x instanceof ApiError) { setErr(x.fields); toast.error(x.message); } }
    finally { setBusy(false); }
  }
  async function check() {
    setChecking(true);
    await refresh();
    setChecking(false);
  }

  const blocked = boot?.blocked;
  const showForm = !blocked && (editing || !req);
  return (
    <div className="auth auth-single">
      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-brand"><img src="logo.svg" alt="" width={36} height={36} /><b>Pontual</b></div>
          {blocked === 'company_suspended' ? (
            <>
              <h2>Acesso suspenso</h2>
              <p className="muted">O acesso da sua empresa está suspenso no momento. Fale com o responsável pela clínica.</p>
            </>
          ) : blocked === 'member_disabled' ? (
            <>
              <h2>Acesso desativado</h2>
              <p className="muted">Seu usuário foi desativado. Fale com o administrador da clínica.</p>
            </>
          ) : showForm ? (
            <form onSubmit={send} noValidate>
              <h2>Solicitar acesso</h2>
              <p className="muted">A conta <b>{boot?.user.email}</b> foi criada, mas o acesso precisa ser liberado. Preencha os dados abaixo para pedir a liberação.</p>
              <Field label="Seu nome completo" required error={err.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></Field>
              <Field label="Telefone (WhatsApp)" required error={err.phone}><Input value={f.phone} onChange={(e) => setF({ ...f, phone: maskPhone(e.target.value) })} inputMode="tel" autoComplete="tel" /></Field>
              <Field label="Clínica onde você trabalha" required error={err.company_hint}><Input value={f.company_hint} onChange={(e) => setF({ ...f, company_hint: e.target.value })} /></Field>
              <Field label="Mensagem (opcional)" error={err.message}><Textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} rows={2} placeholder="Ex.: sou da recepção, entrei este mês" /></Field>
              <Button variant="primary" type="submit" loading={busy} className="block">Enviar pedido</Button>
              {req && <Button variant="ghost" type="button" className="block" onClick={() => setEditing(false)}>Voltar</Button>}
            </form>
          ) : req!.status === 'rejected' ? (
            <>
              <h2>Pedido não aprovado</h2>
              <p className="muted">Seu pedido de acesso não foi aprovado.{req!.reject_reason ? ` Motivo: ${req!.reject_reason}` : ''}</p>
              <Button variant="primary" className="block" onClick={() => setEditing(true)}>Corrigir e pedir de novo</Button>
            </>
          ) : (
            <>
              <h2>Aguardando liberação</h2>
              <p className="muted">Recebemos seu pedido em {new Date(req!.created_at).toLocaleDateString('pt-BR')}. Assim que for liberado, você entra direto. Não precisa criar outra conta.</p>
              <dl className="dl">
                <dt>Nome</dt><dd>{req!.name}</dd>
                <dt>Clínica</dt><dd>{req!.company_hint}</dd>
                <dt>Telefone</dt><dd>{req!.phone}</dd>
              </dl>
              <Button variant="primary" className="block" loading={checking} onClick={check}>Verificar liberação</Button>
              <Button variant="ghost" className="block" onClick={() => setEditing(true)}>Corrigir meus dados</Button>
            </>
          )}
          <Button variant="ghost" className="block" onClick={signOut}>Sair</Button>
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
