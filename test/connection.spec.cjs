// Connecting: instance detection, the interactive login window, session reuse,
// fresh login, disconnect/status, and the HTTP client (cookies, headers, 429).
const { test, expect } = require('@playwright/test');
const { launchApp, connect, completeLoginWindow, IPC } = require('./helpers/app.cjs');
const { createAtlassianMock } = require('./helpers/atlassian-mock.cjs');

let ctx, mock;
test.beforeEach(async () => { mock = await createAtlassianMock(); ctx = await launchApp(); });
test.afterEach(async () => { await ctx.close(); await mock.close(); });

test('main window loads the React app', async () => {
  await expect(ctx.window.locator('h1')).toHaveText('Atlassian User Manager');
  await expect(ctx.window.getByText('Instance Connection')).toBeVisible();
});

test('preload exposes only invoke/on and the renderer has no Node.js', async () => {
  expect(await ctx.window.evaluate(() => Object.keys(window.electronAPI).sort())).toEqual(['invoke', 'on']);
  expect(await ctx.window.evaluate(() => [typeof require, typeof process])).toEqual(['undefined', 'undefined']);
});

test('reports the Electron version under test', async () => {
  const v = await ctx.app.evaluate(() => process.versions.electron);
  console.log(`Electron under test: ${v}`);
  expect(v).toMatch(/^\d+\./);
});

test('Jira DC: detects the instance, logs in through the window, returns the user', async () => {
  const jira = mock.url('jira.corp.test');
  const r = await connect(ctx, jira);
  expect(r).toEqual({
    instanceType: 'jira-dc', baseUrl: jira,
    currentUser: { key: 'JIRAUSER10000', username: 'admin', displayName: 'Admin', email: 'admin@corp.test', active: true },
  });
  // The login window went through the real redirect chain
  const paths = mock.requests.filter(q => q.host === 'jira.corp.test' && !q.path.startsWith('/rest/')).map(q => q.path);
  expect(paths.slice(0, 3)).toEqual(['/', '/login.jsp', '/secure/Dashboard.jspa']);

  const status = await ctx.invoke(IPC.GET_CONNECTION_STATUS);
  expect(status.instanceType).toBe('jira-dc');
  expect(status.currentUser.username).toBe('admin');
});

test('login window is modal, isolated and has no node integration', async () => {
  const pending = ctx.tryInvoke(IPC.CONNECT, mock.url('jira.corp.test'), false);
  const info = await ctx.app.evaluate(async ({ BrowserWindow }) => {
    for (let i = 0; i < 100 && BrowserWindow.getAllWindows().length < 2; i++) await new Promise(r => setTimeout(r, 100));
    const login = BrowserWindow.getAllWindows().find(w => w.getParentWindow());
    const p = login.webContents.getLastWebPreferences();
    return { modal: login.isModal(), contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration, menu: login.isMenuBarVisible() };
  });
  expect(info).toEqual({ modal: true, contextIsolation: true, nodeIntegration: false, menu: false });
  await completeLoginWindow(ctx.app, 'jira.corp.test');
  await pending;
});

test('URL is normalised (https:// added, trailing slash removed)', async () => {
  const r = await connect(ctx, `jira.corp.test:${mock.port}///`);
  expect(r.baseUrl).toBe(mock.url('jira.corp.test'));
});

test('an existing session is reused without opening a login window; fresh login asks again', async () => {
  const jira = mock.url('jira.corp.test');
  await connect(ctx, jira);
  await ctx.invoke(IPC.DISCONNECT);
  expect(await ctx.invoke(IPC.GET_CONNECTION_STATUS)).toBeNull();

  const again = await connect(ctx, jira, { expectLogin: false });
  expect(again.currentUser.username).toBe('admin');
  expect(await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

  await ctx.invoke(IPC.DISCONNECT);
  const fresh = await connect(ctx, jira, { freshLogin: true });
  expect(fresh.currentUser.username).toBe('admin');
  expect(mock.requests.filter(q => q.path === '/login.jsp')).toHaveLength(2);
});

test('closing the login window without logging in gives a clear error', async () => {
  const jira = mock.url('jira.corp.test');
  mock.failures.push({ host: 'jira.corp.test', pathRe: /^\/login\.jsp/, status: 200, body: '<html>login form</html>', times: 1 });
  const pending = ctx.tryInvoke(IPC.CONNECT, jira, false);
  await completeLoginWindow(ctx.app, 'jira.corp.test', { waitFor: '/login.jsp' });
  const r = await pending;
  expect(r.error).toMatch(/Login could not be verified\. Make sure you completed the login before closing the window/);
});

test('Confluence DC without a context path', async () => {
  const conf = mock.url('confluence.corp.test');
  const r = await connect(ctx, conf);
  expect(r.instanceType).toBe('confluence-dc');
  expect(r.currentUser).toMatchObject({ key: 'ck-admin', username: 'admin', displayName: 'Conf Admin' });
});

test('Confluence DC under /wiki: the /wiki prefix is detected and used', async () => {
  const wiki = mock.url('wiki.corp.test');
  const r = await connect(ctx, wiki);
  expect(r.instanceType).toBe('confluence-dc');
  expect(r.currentUser.username).toBe('admin');
  const users = await ctx.invoke(IPC.LOAD_ALL_USERS);
  expect(users.map(u => u.username)).toEqual(['admin', 'alice', 'dave']);
  expect(mock.requests.some(q => q.host === 'wiki.corp.test' && q.path === '/wiki/rest/api/user/list')).toBe(true);
});

test('Atlassian Cloud', async () => {
  const cloud = mock.url('acme.atlassian.net');
  const r = await connect(ctx, cloud);
  expect(r).toEqual({ instanceType: 'cloud', baseUrl: cloud, currentUser: { accountId: 'acc-admin', username: 'admin@acme.test', displayName: 'Cloud Admin', email: 'admin@acme.test', active: true } });
});

test('requests carry the session cookie plus Atlassian/CSRF headers', async () => {
  const jira = mock.url('jira.corp.test');
  await connect(ctx, jira);
  await ctx.invoke(IPC.GET_ALL_GROUPS);
  const req = mock.requests.find(q => q.path === '/rest/api/2/groups/picker');
  expect(req.headers.cookie).toContain('JSESSIONID=jira-session-1');
  expect(req.headers.accept).toBe('application/json');
  expect(req.headers['x-atlassian-token']).toBe('no-check');
  expect(req.headers.origin).toBe(jira);
  expect(req.headers.referer).toMatch(new RegExp(`^${jira}/?$`));
});

test('HTTP 429 is retried after Retry-After', async () => {
  await connect(ctx, mock.url('jira.corp.test'));
  mock.failures.push({ pathRe: /groups\/picker/, status: 429, headers: { 'Retry-After': '1' }, times: 1 });
  const started = Date.now();
  const groups = await ctx.invoke(IPC.GET_ALL_GROUPS);
  expect(groups.map(g => g.name)).toContain('QA');
  expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  expect(mock.requests.filter(q => q.path === '/rest/api/2/groups/picker')).toHaveLength(2);
});

// Regression: ApiClient built `new Response('', { status: 204 })`, which the
// Fetch spec forbids, so any "204 No Content" reply hung the action.
test('a 204 No Content reply completes the action', async () => {
  await connect(ctx, mock.url('confluence.corp.test'));
  mock.state.confluence.rpcEnabled = false;
  // the REST fallback answers 204 No Content
  const result = ctx.tryInvoke(IPC.EXECUTE_ACTION, { action: 'activate-deactivate', instanceType: 'confluence-dc', items: [{ userKey: 'ck-alice', email: '', newStatus: 'inactive' }], options: {} });
  const settled = await Promise.race([result, new Promise(r => setTimeout(() => r(null), 8000))]);
  expect(settled?.value).toMatchObject({ successCount: 1, failureCount: 0 });
  expect(mock.confUser('alice').status).toBe('deactivated');
});

test('calls before connecting fail with "Not connected"', async () => {
  const r = await ctx.tryInvoke(IPC.LOAD_ALL_USERS);
  expect(r.error).toMatch(/Not connected/);
});

test('an unreachable host surfaces an error', async () => {
  const pending = ctx.tryInvoke(IPC.CONNECT, 'https://jira.corp.test:1', false);
  await ctx.app.evaluate(async ({ BrowserWindow }) => {
    for (let i = 0; i < 100; i++) {
      const w = BrowserWindow.getAllWindows().find(x => x.getParentWindow());
      if (w && !w.webContents.isLoading()) { w.close(); return; }
      await new Promise(r => setTimeout(r, 100));
    }
  });
  const r = await pending;
  expect(r.error).toBeTruthy();
});
