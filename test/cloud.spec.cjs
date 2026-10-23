// Atlassian Cloud: human-user filtering, paging, groups, product access via
// the admin hub, lifecycle (activate/deactivate) and email updates.
const { test, expect } = require('@playwright/test');
const { launchApp, connect, IPC } = require('./helpers/app.cjs');
const { createAtlassianMock } = require('./helpers/atlassian-mock.cjs');

let ctx, mock;
test.beforeEach(async () => {
  mock = await createAtlassianMock();
  ctx = await launchApp();
  await connect(ctx, mock.url('acme.atlassian.net'));
});
test.afterEach(async () => { await ctx.close(); await mock.close(); });

const run = (action, items, options = {}) => ctx.invoke(IPC.EXECUTE_ACTION, { action, instanceType: 'cloud', items, options });

test('load all users pages through results and keeps only human accounts', async () => {
  for (let i = 0; i < 120; i++) mock.state.cloud.users.push({ accountId: `acc-${i}`, displayName: `User ${i}`, emailAddress: `u${i}@acme.test`, active: true, accountType: i % 10 === 0 ? 'customer' : 'atlassian', groups: [], products: [] });
  const users = await ctx.invoke(IPC.LOAD_ALL_USERS);
  expect(users.find(u => u.accountId === 'acc-bot')).toBeUndefined();
  expect(users).toHaveLength(3 + 108);
  expect(mock.requests.filter(q => q.path === '/rest/api/3/users/search').map(q => new URL(q.url, 'https://x').searchParams.get('startAt'))).toEqual(['0', '100']);
});

test('search excludes app accounts; groups page until isLast', async () => {
  expect((await ctx.invoke(IPC.SEARCH_USERS, 'a')).map(u => u.accountId)).toEqual(['acc-admin', 'acc-alice', 'acc-erin']);
  for (let i = 0; i < 150; i++) mock.state.cloud.groups.push(`team-${i}`);
  expect(await ctx.invoke(IPC.GET_ALL_GROUPS)).toHaveLength(153);
});

test('product catalogue merges admin hub products with Jira application roles', async () => {
  const roles = await ctx.invoke(IPC.GET_ALL_APPLICATION_ROLES);
  expect(roles).toEqual([
    { key: 'jira-software', name: 'Jira Software', userCount: 2, availableRoles: ['product/member', 'product/admin'], workspaceName: 'acme', workspaceId: 'cloud-123' },
    { key: 'confluence', name: 'Confluence', userCount: 1, availableRoles: ['product/member', 'product/admin'], workspaceName: 'acme', workspaceId: 'cloud-123' },
    { key: 'jira-servicedesk', name: 'Jira Service Management', userCount: 5 },
  ]);
});

test('details include groups and per-role product access', async () => {
  const d = await ctx.invoke(IPC.GET_USER_DETAILS, 'acc-admin');
  expect(d).toMatchObject({ accountId: 'acc-admin', groups: ['site-admins'], applicationRoles: ['Jira Software (Admin) [jira-software|product/admin]'] });
});

test('grant and revoke product access; existing/missing access is skipped', async () => {
  const r = await run('update-product-access', [
    { accountId: 'acc-alice', email: '', addRoles: ['jira-software|product/member', 'confluence|product/member'], removeRoles: ['jira-software|product/admin'] },
  ]);
  expect(r.results[0].details).toEqual([
    'Granted product access: jira-software|product/member',
    'Already has access "confluence|product/member" — skipped',
    'Does not have access "jira-software|product/admin" — skipped',
  ]);
  expect(mock.cloudUser('acc-alice').products).toEqual([{ productKey: 'confluence', roles: ['product/member'] }, { productKey: 'jira-software', roles: ['product/member'] }]);

  const r2 = await run('update-product-access', [{ accountId: 'acc-alice', email: '', removeRoles: ['confluence|product/member'] }]);
  expect(r2.results[0].details).toEqual(['Revoked product access: confluence|product/member']);
  expect(mock.cloudUser('acc-alice').products.map(p => p.productKey)).toEqual(['jira-software']);
});

test('bulk resolve on Cloud also fetches product access', async () => {
  const rows = await ctx.invoke(IPC.RESOLVE_BULK_USERS, [{ rowIndex: 2, email: 'alice@acme.test' }]);
  expect(rows[0].resolvedUser).toMatchObject({ accountId: 'acc-alice', groups: ['jira-users'], applicationRoles: ['Confluence (Member) [confluence|product/member]'] });
});

test('deactivate/activate through the lifecycle API and verify the new state', async () => {
  const r = await run('activate-deactivate', [
    { accountId: 'acc-alice', email: '', newStatus: 'inactive' },
    { accountId: 'acc-erin', email: '', newStatus: 'active' },
  ]);
  expect(r.successCount).toBe(2);
  expect(mock.cloudUser('acc-alice').active).toBe(false);
  expect(mock.cloudUser('acc-erin').active).toBe(true);
});

test('lifecycle falls through to the next endpoint when one returns an HTML page', async () => {
  mock.state.cloud.lifecycleEndpointWorks = false;
  const r = await run('activate-deactivate', [{ accountId: 'acc-alice', email: '', newStatus: 'inactive' }]);
  expect(r.successCount).toBe(1);
  expect(mock.requests.some(q => q.path === '/gateway/api/directory/v1/user/acc-alice/lifecycle/disable')).toBe(true);
  expect(mock.cloudUser('acc-alice').active).toBe(false);
});

test('groups: add/remove by accountId', async () => {
  const r = await run('update-groups', [{ accountId: 'acc-alice', email: '', addGroups: ['confluence-users'], removeGroups: ['jira-users'] }]);
  expect(r.results[0].details).toEqual(['Added to group: confluence-users', 'Removed from group: jira-users']);
  expect(mock.cloudUser('acc-alice').groups).toEqual(['confluence-users']);
});

test('email update works; username change is rejected for Cloud', async () => {
  const r = await run('update-login', [
    { accountId: 'acc-alice', email: 'alice@acme.test', newEmail: 'alice.a@acme.test' },
    { accountId: 'acc-erin', email: '', newUserName: 'erin' },
  ]);
  expect(r.results[0].details).toEqual(['Updated email: alice@acme.test → alice.a@acme.test']);
  expect(mock.cloudUser('acc-alice').emailAddress).toBe('alice.a@acme.test');
  expect(r.results[1].success).toBe(false);
  expect(r.results[1].message).toMatch(/Username changes are not supported for Cloud/);
});
