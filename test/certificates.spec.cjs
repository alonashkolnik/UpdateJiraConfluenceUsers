// TLS certificate handling. The mock serves test/fixtures/self-signed.crt,
// which Chromium cannot verify.
//
// Expected behaviour:
//  - Only the Data Center host being connected to may be trusted despite a
//    verification failure, and only after the user confirms it.
//  - Atlassian Cloud and any other host (e.g. an SSO redirect) always get
//    normal verification — an untrusted certificate is rejected without asking.
const { test, expect } = require('@playwright/test');
const { launchApp, connect, completeLoginWindow, stubMessageBox, IPC } = require('./helpers/app.cjs');
const { createAtlassianMock } = require('./helpers/atlassian-mock.cjs');

let ctx, mock;
const prompts = () => ctx.app.evaluate(() => global.__messageBoxes || []);
const reached = host => mock.requests.filter(r => r.host === host);

test.beforeEach(async () => { ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); await mock.close(); });

async function connectAndCloseLogin(url) {
  const pending = ctx.tryInvoke(IPC.CONNECT, url, false);
  // A login window may or may not open, and may fail to load — close it once it settles
  await ctx.app.evaluate(async ({ BrowserWindow }) => {
    for (let i = 0; i < 150; i++) {
      const w = BrowserWindow.getAllWindows().find(x => x.getParentWindow());
      if (w && !w.webContents.isLoading()) { await new Promise(r => setTimeout(r, 500)); if (!w.isDestroyed()) w.close(); return; }
      await new Promise(r => setTimeout(r, 100));
    }
  });
  return pending;
}

test('Data Center host: user is asked, and declining blocks the connection', async () => {
  mock = await createAtlassianMock({ tls: 'self-signed' });
  await stubMessageBox(ctx.app, 0); // Cancel
  const r = await connectAndCloseLogin(mock.url('jira.corp.test'));
  expect(r.error).toBeTruthy();
  expect(reached('jira.corp.test')).toHaveLength(0);
  const asked = await prompts();
  expect(asked.length).toBeGreaterThanOrEqual(1);
  expect(asked[0].message).toContain('jira.corp.test');
  expect(asked[0].detail).toMatch(/sha256\//);
  // Declining is remembered for this connection attempt: not asked over and over
  expect(asked.length).toBeLessThanOrEqual(2);
});

test('Data Center host: accepting trusts that certificate, asked only once', async () => {
  mock = await createAtlassianMock({ tls: 'self-signed' });
  await stubMessageBox(ctx.app, 1); // Trust
  const r = await connect(ctx, mock.url('jira.corp.test'));
  expect(r.currentUser.username).toBe('admin');
  expect((await ctx.invoke(IPC.LOAD_ALL_USERS)).length).toBe(4);
  expect(await prompts()).toHaveLength(1);
});

test('Atlassian Cloud: an untrusted certificate is rejected without asking', async () => {
  mock = await createAtlassianMock({ tls: 'self-signed' });
  await stubMessageBox(ctx.app, 1); // would trust if asked — must not be asked
  const r = await connectAndCloseLogin(mock.url('acme.atlassian.net'));
  expect(r.error).toBeTruthy();
  expect(reached('acme.atlassian.net')).toHaveLength(0);
  expect(await prompts()).toHaveLength(0);
});

test('an SSO redirect to another host with an untrusted certificate is rejected without asking', async () => {
  mock = await createAtlassianMock({ tls: 'self-signed' });
  await stubMessageBox(ctx.app, 1); // trust the Jira host itself
  mock.failures.push({ host: 'jira.corp.test', pathRe: /^\/login\.jsp/, status: 302, headers: { Location: `${mock.url('sso.corp.test')}/saml/login` }, body: '', times: 1 });
  await connectAndCloseLogin(mock.url('jira.corp.test'));
  expect(reached('sso.corp.test')).toHaveLength(0);
  expect((await prompts()).every(p => !p.message.includes('sso.corp.test'))).toBe(true);
});

test('a certificate Chromium already trusts is used without asking', async () => {
  mock = await createAtlassianMock(); // allowlisted certificate
  await stubMessageBox(ctx.app, 0);
  const r = await connect(ctx, mock.url('confluence.corp.test'));
  expect(r.instanceType).toBe('confluence-dc');
  expect(await prompts()).toHaveLength(0);
});
