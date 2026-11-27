-- =====================================================================
-- Pontual — Portuguese names/descriptions for every table and key column
-- (shown by Supabase in Table Editor and in the table list).
-- Metadata only: no data or rule changes.
-- =====================================================================

comment on table public.clinics is 'Empresas (clínicas clientes do Pontual): dados cadastrais, horário de atendimento e se o acesso está ativo ou suspenso.';
comment on table public.members is 'Pessoas com acesso: liga cada login a uma empresa, com perfil (admin, recepção, veterinário) e se está ativo.';
comment on table public.platform_admins is 'Donos da plataforma: logins que veem todas as empresas, liberam acessos e gerenciam usuários.';
comment on table public.access_requests is 'Pedidos de acesso: quem criou conta e pediu para entrar; situação pendente, aprovado ou recusado.';
comment on table public.invites is 'Convites da equipe: e-mails convidados pelo administrador da clínica; viram acesso quando a pessoa cria a conta.';
comment on table public.clinic_role_permissions is 'Permissões por perfil: o que Recepção e Veterinário podem fazer em cada clínica (sem linha = padrão do sistema).';
comment on table public.health_plans is 'Planos de saúde aceitos por cada clínica (ex.: PETLOVE, DOGLIFE), com espécie permitida.';
comment on table public.tutors is 'Tutores: donos dos animais, com nome e telefone, por clínica.';
comment on table public.animals is 'Pacientes: animais de cada tutor (espécie, raça, sexo, idade).';
comment on table public.appointments is 'Agendamentos: data, hora, paciente, veterinário, plano, status (agendado, concluído, faltou, cancelado) e observações.';
comment on table public.audit_log is 'Histórico da clínica: quem fez o quê dentro de cada empresa (criar, editar, cancelar, permissões).';
comment on table public.platform_audit is 'Registro do dono da plataforma: liberações, empresas, usuários e cada consulta aos dados das clínicas (LGPD).';
comment on table public.user_consents is 'Aceites dos termos de uso e da política de privacidade, por pessoa e versão (LGPD).';

comment on column public.clinics.active is 'Empresa ativa? Falso = todos os usuários dela ficam sem acesso.';
comment on column public.members.role is 'Perfil: admin, recepcao ou veterinario.';
comment on column public.members.active is 'Acesso liberado? Falso = pessoa bloqueada.';
comment on column public.appointments.status is 'agendado, concluido, faltou ou cancelado.';
comment on column public.appointments.starts_on is 'Data do atendimento (fuso da clínica).';
comment on column public.appointments.starts_at is 'Hora do atendimento (fuso da clínica).';
comment on column public.appointments.vet_id is 'Veterinário escolhido; vazio = sem preferência (ocupa o horário da clínica).';
comment on column public.appointments.reminder_sent_at is 'Quando o lembrete de WhatsApp foi enviado (vazio = não enviado).';
comment on column public.access_requests.status is 'pending (aguardando), approved (liberado) ou rejected (recusado).';
comment on column public.clinic_role_permissions.allowed is 'Verdadeiro = o perfil pode fazer a ação nesta clínica.';
