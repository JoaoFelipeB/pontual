import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { Button, Drawer, toast } from '../components/ui';

/**
 * Version of the terms below. Change it whenever the text changes in a meaningful way:
 * every user will be asked to accept the new version on the next login.
 * Format: YYYY-MM.
 */
export const TERMS_VERSION = '2026-11';
export const CONTACT_EMAIL = 'joaofcontabeis@gmail.com';
const PENDING_KEY = 'vc.terms.accepted';

/** Remember that the person ticked the box on the sign-up screen (accepted right after the account exists). */
export const markTermsTicked = () => sessionStorage.setItem(PENDING_KEY, TERMS_VERSION);

export function TermsText() {
  return (
    <div className="terms-box">
      <h3>Termos de Uso do Pontual - Sistema para Clínicas</h3>
      <p>Versão {TERMS_VERSION}. Ao criar uma conta ou usar o Pontual, você concorda com estes termos.</p>

      <h3>1. O que é o Pontual</h3>
      <p>Sistema para clínicas veterinárias organizarem agenda, cadastro de tutores e animais e observações de atendimento. O acesso é liberado pelo fornecedor do Pontual ou pelo administrador da clínica contratante.</p>

      <h3>2. Conta e acesso</h3>
      <ul>
        <li>A conta é pessoal. Não compartilhe sua senha.</li>
        <li>O administrador da clínica e o fornecedor podem liberar, alterar ou bloquear acessos a qualquer momento.</li>
        <li>Você é responsável pelas informações que registra no sistema.</li>
      </ul>

      <h3>3. Uso adequado</h3>
      <p>É proibido usar o sistema para fins ilegais, inserir dados de terceiros sem base legal ou tentar acessar dados de outras clínicas.</p>

      <h3>4. Disponibilidade</h3>
      <p>O fornecedor busca manter o sistema disponível e com cópias de segurança, mas não garante funcionamento ininterrupto.</p>

      <h3>Política de Privacidade (LGPD)</h3>

      <h3>5. Papéis</h3>
      <p>A <b>clínica</b> é a controladora dos dados dos seus clientes (tutores e animais). O <b>fornecedor do Pontual</b> atua como operador, tratando esses dados apenas para prestar o serviço contratado.</p>

      <h3>6. Dados tratados</h3>
      <ul>
        <li>Da equipe: nome, e-mail, telefone, perfil de acesso e registro das ações no sistema.</li>
        <li>Dos clientes da clínica: nome e telefone do tutor; nome, espécie, raça, sexo e idade do animal; datas, motivos e observações dos atendimentos.</li>
      </ul>

      <h3>7. Finalidade</h3>
      <p>Agendamento, histórico de atendimentos, comunicação com tutores (por exemplo, lembretes por WhatsApp enviados pela própria clínica), suporte técnico e melhoria do serviço.</p>

      <h3>8. Acesso pelo fornecedor</h3>
      <p>Para suporte, operação e relatórios, o fornecedor pode consultar os atendimentos das clínicas, somente em modo leitura. <b>Cada consulta fica registrada</b> com data, hora, responsável e empresa consultada.</p>

      <h3>9. Armazenamento e segurança</h3>
      <p>Os dados ficam em servidores na nuvem (Supabase, região São Paulo), com acesso restrito por login e por perfil, separação entre clínicas e cópias de segurança criptografadas.</p>

      <h3>10. Compartilhamento</h3>
      <p>Os dados não são vendidos nem cedidos. Só são compartilhados com os provedores de infraestrutura necessários ao funcionamento ou por obrigação legal.</p>

      <h3>11. Retenção e direitos</h3>
      <p>Os dados ficam guardados enquanto durar o contrato com a clínica ou pelo prazo exigido em lei. Titulares podem pedir acesso, correção ou exclusão à clínica responsável ou pelo e-mail <b>{CONTACT_EMAIL}</b>.</p>

      <h3>12. Alterações</h3>
      <p>Estes termos podem ser atualizados. Quando isso acontecer, você será avisado ao entrar no sistema e precisará aceitar a nova versão para continuar.</p>
    </div>
  );
}

/** Link + drawer to read the terms from anywhere (sign-up screen, menus). */
export function TermsLink({ children = 'Termos de Uso e a Política de Privacidade' }: { children?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="link" onClick={() => setOpen(true)}>{children}</button>
      <Drawer open={open} onClose={() => setOpen(false)} title={<h2>Termos e privacidade</h2>}
        footer={<Button onClick={() => setOpen(false)}>Fechar</Button>}>
        <TermsText />
      </Drawer>
    </>
  );
}

/** Shown after login while the current version of the terms has not been accepted. */
export function TermsAcceptPage() {
  const { setBoot, signOut } = useSession();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    try {
      setBoot(await api.acceptTerms(TERMS_VERSION));
      sessionStorage.removeItem(PENDING_KEY);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Não foi possível registrar o aceite.');
    } finally { setBusy(false); }
  }

  // ticked on the sign-up screen: register it without asking twice
  useEffect(() => {
    if (sessionStorage.getItem(PENDING_KEY) === TERMS_VERSION) accept();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="auth auth-single">
      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-brand"><img src="logo.svg" alt="" width={36} height={36} /><b>Pontual</b></div>
          <h2>Termos de uso e privacidade</h2>
          <p className="muted">Para continuar, leia e aceite os termos (versão {TERMS_VERSION}).</p>
          <TermsText />
          <label className="check">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>Li e aceito os Termos de Uso e a Política de Privacidade.</span>
          </label>
          <Button variant="primary" className="block" disabled={!checked} loading={busy} onClick={accept}>Aceitar e continuar</Button>
          <Button variant="ghost" className="block" onClick={signOut}>Sair</Button>
        </div>
      </main>
    </div>
  );
}
