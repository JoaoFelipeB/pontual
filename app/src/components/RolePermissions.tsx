import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { ApiError } from '../lib/api';
import { Button, Spinner, toast } from './ui';

export interface RoleMatrix {
  configurable: string[];
  roles: Record<'recepcao' | 'veterinario', Record<string, boolean>>;
  defaults: Record<'recepcao' | 'veterinario', Record<string, boolean>>;
}

const LABEL: Record<string, { title: string; hint: string }> = {
  'agenda.write': { title: 'Agendar e editar agendamentos', hint: 'Criar, mudar data/hora e enviar lembretes.' },
  'agenda.cancel': { title: 'Cancelar, registrar falta e reabrir', hint: 'Mudar o status de um agendamento.' },
  'agenda.conclude': { title: 'Concluir atendimento', hint: 'Marcar como concluído.' },
  'agenda.notes': { title: 'Escrever observações clínicas', hint: 'Anotações do atendimento.' },
  'agenda.delete': { title: 'Excluir agendamento', hint: 'Apaga de vez. Prefira cancelar.' },
  'patients.write': { title: 'Editar tutores e pacientes', hint: 'Nome, telefone e dados dos animais.' },
  'reports.read': { title: 'Ver o Painel', hint: 'Números do dia e do mês da clínica.' }
};

/**
 * What each profile may do in one clinic. Admin always has everything; seeing the agenda and patients is
 * always allowed; settings and team stay with admins. Used by the clinic admin and by the platform owner.
 */
export function RolePermissionsEditor({ load, save }: {
  load: () => Promise<RoleMatrix>;
  save: (p: Record<string, Record<string, boolean>>) => Promise<RoleMatrix>;
}) {
  const [m, setM] = useState<RoleMatrix | null>(null);
  const [draft, setDraft] = useState<RoleMatrix['roles'] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    load().then((r) => { setM(r); setDraft(structuredClone(r.roles)); }).catch((e) => toast.error(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!m || !draft) return <Spinner />;
  const changed = JSON.stringify(draft) !== JSON.stringify(m.roles);
  const isDefault = JSON.stringify(draft) === JSON.stringify(m.defaults);
  const toggle = (role: 'recepcao' | 'veterinario', perm: string) =>
    setDraft({ ...draft, [role]: { ...draft[role], [perm]: !draft[role][perm] } });

  async function submit() {
    setBusy(true);
    try { const r = await save(draft!); setM(r); setDraft(structuredClone(r.roles)); toast.ok('Permissões salvas. Valem na próxima vez que cada pessoa abrir o app.'); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="perms">
      <div className="table-wrap">
        <table className="table perm-table">
          <thead>
            <tr><th>O que a pessoa pode fazer</th><th className="c">Administrador</th><th className="c">Recepção</th><th className="c">Veterinário</th></tr>
          </thead>
          <tbody>
            <tr className="no-hover">
              <td><b>Ver agenda e pacientes</b><small>Sempre liberado para todos.</small></td>
              <td className="c"><input type="checkbox" checked disabled aria-label="Administrador: sempre" /></td>
              <td className="c"><input type="checkbox" checked disabled aria-label="Recepção: sempre" /></td>
              <td className="c"><input type="checkbox" checked disabled aria-label="Veterinário: sempre" /></td>
            </tr>
            {m.configurable.map((p) => (
              <tr key={p} className="no-hover">
                <td><b>{LABEL[p]?.title ?? p}</b><small>{LABEL[p]?.hint}</small></td>
                <td className="c"><input type="checkbox" checked disabled aria-label={`Administrador: ${LABEL[p]?.title}`} /></td>
                {(['recepcao', 'veterinario'] as const).map((r) => (
                  <td key={r} className="c">
                    <input type="checkbox" checked={!!draft[r][p]} onChange={() => toggle(r, p)}
                      aria-label={`${r === 'recepcao' ? 'Recepção' : 'Veterinário'}: ${LABEL[p]?.title ?? p}`} />
                  </td>
                ))}
              </tr>
            ))}
            <tr className="no-hover">
              <td><b>Configurações e equipe</b><small>Sempre só do administrador.</small></td>
              <td className="c"><input type="checkbox" checked disabled aria-label="Administrador: configurações" /></td>
              <td className="c"><input type="checkbox" disabled aria-label="Recepção: configurações (não)" /></td>
              <td className="c"><input type="checkbox" disabled aria-label="Veterinário: configurações (não)" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="perm-actions">
        <Button variant="ghost" icon={<RotateCcw size={15} />} disabled={isDefault} onClick={() => setDraft(structuredClone(m.defaults))}>Voltar ao padrão</Button>
        <Button variant="primary" disabled={!changed} loading={busy} onClick={submit}>Salvar permissões</Button>
      </div>
    </div>
  );
}
