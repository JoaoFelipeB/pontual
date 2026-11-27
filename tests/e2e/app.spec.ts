import { expect, test, type Page } from '@playwright/test';

// Demo data comes from tests/fake-supabase.mjs (SEED=1).
const unique = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 860;

async function login(page: Page, email: string, password: string) {
  await page.goto('./');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).last().click();
}

async function signUp(page: Page, email: string) {
  await page.goto('./');
  await page.getByRole('tab', { name: 'Criar conta' }).click();
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill('senha12345');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Criar conta', exact: true }).last().click();
}

test('senha errada mostra mensagem clara', async ({ page }) => {
  await login(page, 'admin@demo.com', 'errada');
  await expect(page.getByRole('alert')).toHaveText('E-mail ou senha incorretos.');
});

test('criar conta exige aceite dos termos e cai em "Solicitar acesso"', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('tab', { name: 'Criar conta' }).click();
  await page.getByLabel('E-mail').fill(`sem-termos-${unique()}@gmail.com`);
  await page.getByLabel('Senha').fill('senha12345');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).last().click();
  await expect(page.getByRole('alert')).toContainText('aceite os Termos');

  await signUp(page, `pedro-${unique()}@gmail.com`);
  await expect(page.getByRole('heading', { name: 'Solicitar acesso' })).toBeVisible();
});

test('pedido de acesso: dono libera e a pessoa entra', async ({ browser, page }) => {
  const email = `liberar-${unique()}@gmail.com`;
  await signUp(page, email);
  await page.getByLabel('Seu nome completo').fill('Pedro Henrique');
  await page.getByLabel('Telefone (WhatsApp)').fill('83987654321');
  await page.getByLabel('Clínica onde você trabalha').fill('Amigo Fiel');
  await page.getByRole('button', { name: 'Enviar pedido' }).click();
  await expect(page.getByRole('heading', { name: 'Aguardando liberação' })).toBeVisible();

  const owner = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  await login(owner, 'dono@demo.com', 'dono12345');
  await expect(owner.getByRole('heading', { name: 'Plataforma' })).toBeVisible();
  const row = owner.locator('.req', { hasText: email });
  await row.getByRole('button', { name: 'Liberar' }).click();
  await owner.locator('.drawer-foot').getByRole('button', { name: 'Liberar acesso' }).click();
  await expect(owner.getByText('Pedro Henrique liberado.')).toBeVisible();

  await page.getByRole('button', { name: 'Verificar liberação' }).click();
  await expect(page.getByRole('heading', { name: /Boa (tarde|noite)|Bom dia/ })).toBeVisible();
});

test('recepção agenda pelo formulário; vet ocupado some só para ele', async ({ page }) => {
  await login(page, 'rec@demo.com', 'senha12345');
  if (isMobile(page)) await page.locator('.tab-cta').click();
  else await page.getByRole('button', { name: 'Novo agendamento' }).click();

  const form = page.getByRole('dialog');
  await form.getByPlaceholder('Nome completo').fill('Teste E2E');
  await form.getByPlaceholder('(83) 98888-7777').fill(`8399${String(Date.now()).slice(-7)}`);
  await form.getByPlaceholder('Nome do animal').fill('Bob');
  const tomorrow = new Date(Date.now() + 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  await form.locator('input[type=date]').fill(tomorrow);
  await form.getByLabel('Veterinário').selectOption({ label: 'Dr. Paulo Lima' });
  const free = form.locator('.slot:not([disabled])').first();
  const time = (await free.textContent())!.trim();
  await free.click();
  await form.getByRole('button', { name: 'Confirmar agendamento' }).click();
  await expect(page.getByText(new RegExp(`Bob agendado: amanhã às ${time}`))).toBeVisible();

  // same slot for the same vet is now taken
  await page.keyboard.press('Escape');
  if (isMobile(page)) await page.locator('.tab-cta').click();
  else await page.getByRole('button', { name: 'Novo agendamento' }).click();
  await page.getByRole('dialog').locator('input[type=date]').fill(tomorrow);
  await page.getByRole('dialog').getByLabel('Veterinário').selectOption({ label: 'Dr. Paulo Lima' });
  await expect(page.getByRole('dialog').locator('.slot', { hasText: time })).toBeDisabled();
});

test('lembretes de amanhã abrem o WhatsApp com mensagem pronta e marcam enviado', async ({ page }) => {
  await login(page, 'admin@demo.com', 'admin12345');
  await expect(page.getByRole('heading', { name: /Bom dia|Boa (tarde|noite)/ })).toBeVisible();
  await page.goto('./#/agenda');
  await page.getByRole('button', { name: 'Lembretes de amanhã' }).click();
  const send = page.getByRole('dialog').getByRole('link', { name: 'Enviar' }).first();
  await expect(send).toHaveAttribute('href', /wa\.me\/55\d+\?text=.*Lembrete/);
  // click without leaving the app (the real click opens WhatsApp in another app/tab)
  await send.evaluate((a) => { a.addEventListener('click', (e) => e.preventDefault()); (a as HTMLAnchorElement).click(); });
  await expect(page.getByRole('dialog').getByText('Enviado').first()).toBeVisible();
});

test('dono vê atendimentos de todas as empresas, só leitura, e o registro', async ({ page }) => {
  await login(page, 'dono@demo.com', 'dono12345');
  await page.getByRole('tab', { name: 'Atendimentos' }).click();
  await expect(page.getByText('Visualização da plataforma, somente leitura.')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'PetVida Centro Veterinário' }).first()).toBeVisible();
  await page.locator('.list-card tbody tr').first().click();
  await expect(page.getByRole('dialog').getByRole('heading').first()).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: /Concluir|Editar|Cancelar|Excluir|Salvar/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Registro' }).click();
  await expect(page.getByText('Consultou atendimentos').first()).toBeVisible();
});

test('dono cria usuário com senha temporária, edita e a pessoa entra', async ({ browser, page }) => {
  const email = `criado-${unique()}@gmail.com`;
  await login(page, 'dono@demo.com', 'dono12345');
  await page.getByRole('tab', { name: 'Usuários' }).click();
  await page.getByRole('button', { name: 'Novo usuário' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Nome completo').fill('Marina Costa');
  await d.getByLabel('E-mail (login)').fill(email);
  await d.getByLabel('Empresa').selectOption({ label: 'PetVida Centro Veterinário' });
  await d.getByLabel('Perfil').selectOption('veterinario');
  const password = await d.getByLabel('Senha temporária').inputValue();
  await d.getByRole('button', { name: 'Criar usuário' }).click();
  await expect(d.getByText('Conta criada.')).toBeVisible();
  await d.getByRole('button', { name: 'Concluir' }).click();

  // edit: change role
  await page.getByRole('row', { name: new RegExp(email) }).click();
  const edit = page.getByRole('dialog');
  await expect(edit.getByLabel('Nome')).toHaveValue('Marina Costa');
  await expect(edit.getByLabel('Empresa').locator('option:checked')).toHaveText('PetVida Centro Veterinário');
  await edit.getByLabel('Perfil').selectOption('recepcao');
  await edit.getByRole('button', { name: 'Salvar alterações' }).click();
  // show whatever message appeared, so a failure explains itself
  await expect(page.locator('.toast').last()).toHaveText('Alterações salvas.');
  await expect(page.getByRole('row', { name: new RegExp(email) })).toContainText('Recepção');

  // the person signs in with the temporary password and accepts the terms
  const p2 = await (await browser.newContext()).newPage();
  await login(p2, email, password);
  await p2.getByRole('checkbox').check();
  await p2.getByRole('button', { name: 'Aceitar e continuar' }).click();
  await expect(p2.getByRole('heading', { name: /Boa (tarde|noite)|Bom dia/ })).toBeVisible();
});

test('admin libera o veterinário para agendar (clínica sem recepção)', async ({ browser, page }) => {
  await login(page, 'admin@demo.com', 'admin12345');
  await expect(page.getByRole('heading', { name: /Bom dia|Boa (tarde|noite)/ })).toBeVisible(); // signed in
  await page.goto('./#/configuracoes');
  await page.getByRole('tab', { name: 'Permissões' }).click();
  const box = page.getByRole('checkbox', { name: 'Veterinário: Agendar e editar agendamentos' });
  if (!(await box.isChecked())) {
    await box.check();
    await page.getByRole('button', { name: 'Salvar permissões' }).click();
    await expect(page.getByText(/Permissões salvas/)).toBeVisible();
  }

  const v = await (await browser.newContext({ viewport: page.viewportSize()! })).newPage();
  await login(v, 'vet@demo.com', 'senha12345');
  await expect(v.getByRole('heading', { name: /Bom dia|Boa (tarde|noite)/ })).toBeVisible();
  if (isMobile(v)) await expect(v.locator('.tab-cta')).toBeVisible();
  else await expect(v.getByRole('button', { name: 'Novo agendamento' })).toBeVisible();
});
