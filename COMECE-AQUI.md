# Pontual - Sistema para Clínicas: guia de operação

Tudo usa planos gratuitos:

| Peça | Serviço | Para quê |
|---|---|---|
| Banco de dados e login | Supabase (região São Paulo) | agendamentos, pacientes, usuários, liberações |
| Código, testes, site e APK | GitHub (repositório `pontual`) | publica o site e o APK sozinho a cada atualização |

- Site: `https://SEU-USUARIO.github.io/pontual/`
- APK: página **Releases** do repositório, arquivo **Pontual.apk**

---

## 1. Banco de dados (uma vez)

1. Crie o projeto no Supabase (região **South America (São Paulo)**).
2. No **SQL Editor**, rode em ordem os arquivos de `supabase/migrations/` (`0001` a `0006`).
   Cada um: **New query**, colar, **Run**. O aviso "Potential issue detected" é esperado: **Run query**.
3. Em **Authentication > Sign In / Providers**, desligue **Confirm email**.
4. Em **Project Settings > API Keys**, copie a **Publishable key** (`sb_publishable_...`).
   Nunca use as "Secret keys" no app.

## 2. Secrets do GitHub (uma vez)

Em **Settings > Secrets and variables > Actions > New repository secret**:

| Nome | Valor |
|---|---|
| `VITE_SUPABASE_URL` | endereço do projeto (`https://xxxx.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | a Publishable key |
| `ANDROID_KEY_PASSWORD` | senha longa sua (16+ caracteres). Protege a chave que assina o app. **Guarde fora do GitHub.** |
| `SUPABASE_DB_URL` | endereço de conexão do banco, para o backup (seção 6) |
| `BACKUP_PASSWORD` | outra senha longa sua (16+). Criptografa os backups. **Guarde fora do GitHub.** |

Depois: **Settings > Pages > Source: GitHub Actions**, e rode uma vez em **Actions** o workflow
**Criar chave de assinatura (uma vez)**.

## 3. Como atualizar o sistema

1. Receba o novo `vetcare.zip` (não descompacte).
2. No repositório: **Add file > Upload files**, arraste o zip, **Commit changes**.
3. Pronto. Em sequência, sozinhos:
   - **Aplicar atualização (zip)** desempacota (1 min);
   - **Publicar (testes, site e APK)** roda os testes do banco e de tela; **se algum falhar, nada é publicado**;
   - o site é atualizado e o APK novo vai para **Releases**.
4. Mudanças no banco vêm como arquivos novos em `supabase/migrations/` e são rodadas no SQL Editor.

Quem usa o APK vê no app o aviso **"Nova versão disponível"**, com o botão **Atualizar**.
Basta instalar por cima; nada se perde.

## 4. Quem pode entrar

- Criar conta **não** dá acesso. A pessoa aceita os termos, pede acesso e espera.
- **Dono da plataforma** (você): menu **Plataforma**.
  - **Liberações**: aprova (escolhendo empresa e perfil) ou recusa, com motivo.
  - **Empresas**: cadastra clientes, troca perfis, bloqueia pessoas, **suspende** a empresa inteira.
  - **Atendimentos**: vê, só leitura, os atendimentos de todas as empresas ou de uma (suporte).
  - **Registro**: tudo o que foi consultado ou alterado pela plataforma, com data e responsável.
- **Administrador da clínica**: convida a própria equipe em **Configurações > Equipe**; quem cria a conta
  com o e-mail convidado entra direto.

Para tornar outra conta dona da plataforma (SQL Editor):
```sql
insert into public.platform_admins (user_id) select id from auth.users where email = 'email@da.conta';
```

### Perfis

| Ação | Admin | Recepção | Veterinário |
|---|:-:|:-:|:-:|
| Ver painel, agenda e pacientes | ✓ | ✓ | ✓ |
| Agendar, editar, enviar lembretes | ✓ | ✓ | |
| Concluir e escrever observações clínicas | ✓ | ✓ | ✓ |
| Cancelar, registrar falta, reabrir | ✓ | ✓ | |
| Excluir agendamento | ✓ | | |
| Equipe, planos e dados da clínica | ✓ | | |

## 5. No dia a dia

- **Agenda por veterinário:** escolhendo o veterinário, o horário fica ocupado só para ele.
  "Sem preferência" ocupa o horário da clínica toda.
- **Lembretes:** na Agenda, **Lembretes de amanhã** lista os pacientes do dia seguinte; **Enviar** abre o
  WhatsApp com a mensagem pronta e marca como enviado.
- **Senha esquecida:** o administrador da clínica usa **Configurações > Equipe > Redefinir senha**.

## 6. Backup

Todo domingo às 3h o GitHub salva uma cópia do banco, **criptografada**, guardada por 90 dias
(**Actions > Backup semanal do banco > execução > Artifacts**). Para rodar na hora: **Run workflow**.

**Endereço do banco (`SUPABASE_DB_URL`):** no Supabase, botão **Connect** (topo) > **Session pooler**.
Copie o endereço e troque `[YOUR-PASSWORD]` pela senha do banco (se não tiver, **Project Settings >
Database > Reset database password**).

**Restaurar** (só em emergência, num banco novo):
```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 300000 -in pontual-AAAA-MM-DD.sql.gz.enc -pass pass:SUA_BACKUP_PASSWORD | gunzip > backup.sql
psql "ENDERECO_DO_BANCO_NOVO" -f backup.sql
```

## 7. LGPD

- Termos de uso e política de privacidade ficam no app (versão em `app/src/pages/Legal.tsx`, `TERMS_VERSION`).
  Cada pessoa aceita ao criar a conta; o aceite fica registrado com data e versão.
- Mudou o texto? Troque `TERMS_VERSION` (ex.: `2027-01`): todos aceitam de novo no próximo acesso.
- O texto é um modelo: **revise com um advogado** e alinhe com o contrato das clínicas, principalmente
  o acesso de leitura do dono da plataforma (seção 4) e o e-mail de contato (`CONTACT_EMAIL`).

## Problemas comuns

| O que acontece | O que fazer |
|---|---|
| Publicar ficou vermelho em "tests" | Algo quebrou; nada foi publicado. Abra a execução e mande o print. |
| O app não mostra o aviso de versão nova | O aviso confere no máximo a cada 6 horas. Feche e abra o app mais tarde. |
| Backup vermelho | Confira `SUPABASE_DB_URL` (Session pooler, com a senha) e `BACKUP_PASSWORD`. |
| Supabase "paused" | Projeto sem uso por 7 dias. Abra o painel e clique em **Restore**. |
