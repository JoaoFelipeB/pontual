# Pontual - Sistema para Clínicas

Agenda e prontuário para clínicas veterinárias: app Android (APK), versão web e banco de
dados na nuvem com login e perfis de acesso.

> Primeira vez? Siga o **COMECE-AQUI.md**.

## Arquitetura

```
 Celular (APK Android)  ─┐
                         ├──►  Supabase (PostgreSQL + Auth)
 Navegador (GitHub Pages)┘        └ funções SQL = API com as regras de negócio
```

- **Sem servidor próprio.** O app fala direto com o Supabase. Toda regra de negócio
  (conflito de horário, plano por espécie, permissões, auditoria) vive em funções SQL
  no banco, então vale igual para o APK e para o site.
- **Segurança.** As tabelas têm Row Level Security ligado e nenhuma política: ninguém lê
  ou grava tabela diretamente. O app só chama as funções de `0002_api.sql`, que conferem
  usuário, clínica e perfil a cada chamada. Cada clínica só enxerga os próprios dados.
- **Usuários e liberação.** Login do Supabase Auth (e-mail e senha). Criar conta não dá
  acesso: a pessoa pede acesso e o **dono da plataforma** (`platform_admins`) aprova,
  escolhendo empresa e perfil, ou recusa. O administrador de uma clínica liberada pode
  convidar a própria equipe por e-mail (o convite vale como pré-aprovação). Empresas podem
  ser suspensas, o que bloqueia todos os seus usuários na hora. Ações da plataforma ficam em
  `platform_audit`; ações das clínicas, em `audit_log`.

## Pastas

```
supabase/migrations/   0001 tabelas | 0002 funções e permissões | 0003 senha pelo admin | 0004 liberação de acesso
app/                   React + TypeScript + Vite, empacotado como APK com Capacitor
  src/lib/             cliente Supabase, chamadas da API, sessão, formatação
  src/pages/           Painel, Agenda (dia e lista), Pacientes, Configurações, Login
  src/features/        formulário e detalhe do agendamento
  android/             projeto Android gerado pelo Capacitor (ícones e splash da marca)
tests/                 37 testes do banco em PGlite + simulador local do Supabase
.github/workflows/     APK, site (GitHub Pages) e testes, automáticos a cada envio
```

## Desenvolvimento local

```bash
npm install && npm test              # testes do banco (sem precisar de conta no Supabase)

cd app
npm install
cp .env.example .env                 # preencha URL e chave anon do Supabase
npm run dev                          # http://localhost:5173
```

Para testar o app inteiro sem Supabase, há um simulador local com dados de exemplo:

```bash
cd app && echo "VITE_SUPABASE_URL=http://localhost:54321" > .env && echo "VITE_SUPABASE_ANON_KEY=local" >> .env
npm run build && cd ..
SEED=1 node tests/fake-supabase.mjs 54321 app/dist
# abra http://localhost:54321  |  dono@demo.com / dono12345 (plataforma), admin@demo.com / admin12345,
# rec@demo.com e vet@demo.com / senha12345
```

## Erros da API

As funções levantam erros com código próprio e detalhes por campo em JSON:
`VC401` sem login ou sem clínica, `VC403` perfil sem permissão, `VC404` não encontrado,
`VC409` conflito (horário ocupado, e-mail já convidado), `VC422` validação
(`details` = `{"campo": "mensagem"}`).
