# VetCare: como colocar no ar

Este guia leva de zero até o app instalado nos celulares da equipe e acessível
pelo navegador de qualquer computador. Tudo usa planos gratuitos:

| Peça | Serviço gratuito | Para quê |
|---|---|---|
| Banco de dados e login | **Supabase** | guarda agendamentos, pacientes e usuários na nuvem |
| Geração do APK e site | **GitHub** (Actions + Pages) | monta o APK Android e publica a versão web, sem instalar nada no seu PC |

Tempo estimado: 30 a 40 minutos, uma única vez.

---

## Parte 1: banco de dados (Supabase)

1. Acesse https://supabase.com e crie uma conta (pode entrar com o GitHub ou Google).
2. Clique em **New project**:
   - **Name**: `vetcare`
   - **Database password**: gere uma senha forte e guarde num lugar seguro.
   - **Region**: `South America (São Paulo)`.
   - Clique em **Create new project** e espere uns 2 minutos.
3. No menu da esquerda, abra **SQL Editor** e clique em **New query**.
4. Abra o arquivo `supabase/migrations/0001_schema.sql` (do zip) no Bloco de Notas,
   copie todo o conteúdo, cole no editor e clique em **Run**. Deve aparecer "Success".
5. Faça o mesmo com `supabase/migrations/0002_api.sql` (nova query, colar, **Run**).
6. Vá em **Authentication > Sign In / Providers > Email** e desligue
   **Confirm email** (assim a equipe entra direto depois de criar a conta).
   Se preferir manter ligado, cada pessoa precisa clicar no link do e-mail antes do primeiro acesso.
7. Rode também `supabase/migrations/0003_admin_reset_password.sql` (nova query, colar, **Run**).
8. Vá em **Project Settings > API** (ou **Data API**) e anote dois valores:
   - **Project URL** (algo como `https://abcdxyz.supabase.co`)
   - **anon public key** (um texto longo começando com `eyJ...`)

   A chave *anon* é feita para ficar dentro do app; a segurança vem das regras do banco.
   **Nunca** use a chave `service_role` no app.

## Parte 2: gerar o APK e o site (GitHub)

1. Crie uma conta em https://github.com.
2. Clique em **New repository**: nome `vetcare`, marque **Public** e crie.
   (Público é necessário para o site gratuito no GitHub Pages. Nenhuma senha fica no código.)
3. Envie os arquivos do zip para o repositório. O jeito mais simples:
   - Instale o **GitHub Desktop** (https://desktop.github.com), entre com sua conta.
   - **File > Clone repository**, escolha `vetcare` e uma pasta no PC.
   - Extraia o conteúdo do zip **dentro dessa pasta** (a pasta `.github` precisa ir junto).
   - No GitHub Desktop, escreva um resumo (ex.: "Primeira versão"), clique em
     **Commit to main** e depois em **Push origin**.
4. No site do GitHub, no repositório, vá em **Settings > Secrets and variables > Actions**
   e crie três **New repository secret**:
   - `VITE_SUPABASE_URL` = a Project URL da Parte 1
   - `VITE_SUPABASE_ANON_KEY` = a anon public key da Parte 1
   - `ANDROID_KEY_PASSWORD` = uma senha longa inventada por você (pelo menos 16 caracteres,
     ex.: quatro palavras aleatórias). Ela protege a chave que assina o app.
     **Guarde essa senha fora do GitHub também.** Se ela se perder, os celulares precisarão
     desinstalar e instalar o app de novo na próxima atualização.
5. Ainda em **Settings**, abra **Pages** e em **Source** escolha **GitHub Actions**.
6. Vá na aba **Actions**, abra **Criar chave de assinatura (uma vez)** e clique em
   **Run workflow**. Leva 1 minuto e só precisa ser feito uma vez na vida do projeto.
7. Na mesma aba, abra **Android APK** e clique em **Run workflow**. Faça o mesmo em
   **Web (GitHub Pages)**. Cada um leva de 3 a 6 minutos.
   (Daqui para frente, toda alteração enviada gera APK e site novos sozinha, com número de
   versão maior. Quem já tem o app instala o APK novo por cima, sem perder nada.)

Quando terminar:
- **APK**: na página do repositório, menu **Releases > VetCare (última versão) > VetCare.apk**.
- **Site**: `https://SEU-USUARIO.github.io/vetcare/` (o endereço aparece em **Settings > Pages**).

## Parte 3: primeiro acesso

1. Abra o site ou instale o APK (veja a Parte 4) e toque em **Criar conta**,
   com o seu e-mail e uma senha de pelo menos 8 caracteres.
2. Escolha **Sou o responsável pela clínica**, informe o nome da clínica e o seu.
   Você vira administrador. Os planos PETLOVE, PETLIFE, DOGLIFE e CATLIFE já vêm cadastrados.
3. Em **Configurações > Clínica**, ajuste horário de atendimento e intervalo entre consultas.
4. Em **Configurações > Equipe > Convidar pessoa**, cadastre cada pessoa com nome,
   e-mail e perfil (Recepção, Veterinário ou Administrador).
5. Mande para cada pessoa o link do APK (ou do site) e peça para tocar em **Criar conta**
   usando **o mesmo e-mail do convite**. O acesso é liberado na hora, já com o perfil certo.

## Parte 4: instalar o APK no Android

1. No celular, abra o link do **VetCare.apk** (Releases) e baixe.
2. Toque no arquivo baixado. O Android pede permissão para "instalar apps desta fonte":
   permita para o navegador ou gerenciador de arquivos.
3. Instale e abra o **VetCare**.

O aviso do Play Protect sobre "app desconhecido" é normal para apps fora da Play Store.
Para publicar na Play Store depois, é preciso uma conta de desenvolvedor Google (taxa única) e
um APK assinado; dá para preparar quando chegar a hora.

iPhone: use o site no Safari e toque em **Compartilhar > Adicionar à Tela de Início**.

---

## Perfis de acesso

| Ação | Admin | Recepção | Veterinário |
|---|:-:|:-:|:-:|
| Ver painel, agenda e pacientes | ✓ | ✓ | ✓ |
| Agendar e editar | ✓ | ✓ | |
| Concluir e escrever observações clínicas | ✓ | ✓ | ✓ |
| Cancelar, registrar falta, reabrir | ✓ | ✓ | |
| Excluir agendamento | ✓ | | |
| Equipe, planos e dados da clínica | ✓ | | |

## Perguntas comuns

**Alguém esqueceu a senha.** O administrador abre **Configurações > Equipe > Redefinir senha**,
o app sugere uma senha temporária e mostra para passar à pessoa. Ela entra e troca pela dela no
ícone de chave ao lado do nome. (O e-mail gratuito do Supabase só entrega para a própria conta do
projeto, por isso a recuperação é feita pelo administrador e não por e-mail.)
Se o próprio administrador esquecer: no Supabase, **Authentication > Users**, apague o usuário dele,
crie a conta de novo pelo app e, no **SQL Editor**, rode
`update public.members set user_id = (select id from auth.users where email = 'SEU@EMAIL') where email = 'SEU@EMAIL';`

**Agenda de cada veterinário.** Na Agenda, o seletor de veterinário mostra só os atendimentos
dele. Quem entra com perfil Veterinário já abre na própria agenda.

**Uma pessoa saiu da equipe.** Configurações > Equipe > desligue o acesso. Ela sai de
todos os aparelhos na hora e o histórico do que ela fez continua.

**Backup.** O Supabase faz backup diário automático. Para ter uma cópia sua:
**Table Editor**, escolha a tabela e **Export > CSV**.

**Limites do plano gratuito.** 500 MB de banco (dá para centenas de milhares de agendamentos)
e até 50 mil usuários. Projetos sem nenhum acesso por 7 dias são pausados; basta abrir o painel
do Supabase e clicar em **Restore**. Com uso diário da clínica, isso não acontece.

**Por que não Google Sheets ou Excel online?** Planilha não impede dois atendentes de
marcarem o mesmo horário ao mesmo tempo, não tem login com perfis e qualquer pessoa com o
link vê ou apaga tudo. O Supabase é um banco de dados de verdade (PostgreSQL), também gratuito,
e dá para exportar tudo para planilha quando quiser.
