// Jira Data Center: users, groups, bulk resolution and every action branch.
const { test, expect } = require('@playwright/test');
const { launchApp, connect, IPC } = require('./helpers/app.cjs');
const { createAtlassianMock } = require('./helpers/atlassian-mock.cjs');

let ctx, mock;
test.beforeEach(async () => {
  mock = await createAtlassianMock();
  ctx = await launchApp();
  await connect(ctx, mock.url('jira.corp.test'));
});
test.afterEach(async () => { await ctx.close(); await mock.close(); });

const run = (action, items, options = {}) => ctx.invoke(IPC.EXECUTE_ACTION, { action, instanceType: 'jira-dc', items, options });

test('load all users via the wildcard search', async () => {
  const users = await ctx.invoke(IPC.LOAD_ALL_USERS);
  expect(users.map(u => [u.username, u.active])).toEqual([['admin', true], ['alice', true], ['bob', false], ['carol', true]]);
  expect(users[1]).toEqual({ key: 'JIRAUSER10001', username: 'alice', displayName: 'Alice Anderson', email: 'alice@corp.test', active: true });
});

test('load all users falls back to per-letter search and de-duplicates', async () => {
  mock.state.jira.crowdWildcard = false;
  const users = await ctx.invoke(IPC.LOAD_ALL_USERS);
  expect(users.map(u => u.username).sort()).toEqual(['admin', 'alice', 'bob', 'carol']);
  expect(mock.requests.filter(q => q.path === '/rest/api/2/user/search').length).toBeGreaterThan(30);
});

test('search, details and groups', async () => {
  const found = await ctx.invoke(IPC.SEARCH_USERS, 'brown');
  expect(found.map(u => u.username)).toEqual(['bob']);
  const details = await ctx.invoke(IPC.GET_USER_DETAILS, 'alice');
  expect(details).toMatchObject({ username: 'alice', groups: ['jira-software-users'] });
  expect((await ctx.invoke(IPC.GET_ALL_GROUPS)).map(g => g.name)).toEqual(['jira-administrators', 'jira-software-users', 'Developers', 'QA']);
  expect(await ctx.invoke(IPC.GET_USER_GROUPS, 'JIRAUSER10002')).toEqual(['Developers']);
  expect(await ctx.invoke(IPC.GET_ALL_APPLICATION_ROLES)).toEqual([]);
});

test('details for an unknown user is an error', async () => {
  const r = await ctx.tryInvoke(IPC.GET_USER_DETAILS, 'nobody');
  expect(r.error).toMatch(/User not found: nobody/);
});

test('bulk resolve by key, username or email, with groups; reports unknown users', async () => {
  const rows = await ctx.invoke(IPC.RESOLVE_BULK_USERS, [
    { rowIndex: 2, userKey: 'JIRAUSER10001', email: '' },
    { rowIndex: 3, userName: 'bob', email: '' },
    { rowIndex: 4, email: 'carol@corp.test' },
    { rowIndex: 5, email: 'ghost@corp.test' },
  ]);
  expect(rows.map(r => r.resolvedUser?.username ?? r.resolveError)).toEqual(['alice', 'bob', 'carol', 'User not found: ghost@corp.test']);
  expect(rows[1].resolvedUser.groups).toEqual(['Developers']);
  expect(rows[1].resolvedUser.active).toBe(false);
});

test('deactivate and activate; already-in-state users are skipped', async () => {
  const progress = [];
  await ctx.window.evaluate(ch => { window.__progress = []; window.electronAPI.on(ch, p => window.__progress.push(p)); }, IPC.ACTION_PROGRESS);
  const r = await run('activate-deactivate', [
    { userKey: 'JIRAUSER10001', email: '', newStatus: 'inactive', displayName: 'Alice' },
    { userKey: 'JIRAUSER10002', email: '', newStatus: 'inactive' },
    { userKey: 'JIRAUSER10002', email: '', newStatus: 'active' },
    { userKey: 'JIRAUSER10003', email: '', newStatus: 'active' },
  ]);
  expect(r.successCount).toBe(4);
  expect(r.results.map(x => x.details)).toEqual([
    ['Deactivated user'], ['User is already Disabled — skipped'], ['Activated user'], ['User is already Active — skipped'],
  ]);
  expect(r.results[0].displayName).toBe('Alice');
  expect(mock.jiraUser('alice').active).toBe(false);
  expect(mock.jiraUser('bob').active).toBe(true);
  progress.push(...await ctx.window.evaluate(() => window.__progress));
  expect(progress.filter(p => p.status === 'processing').map(p => `${p.current}/${p.total}`)).toEqual(['1/4', '2/4', '3/4', '4/4']);
  expect(progress.filter(p => p.status === 'success')).toHaveLength(4);
});

test('deactivate can also remove the user from all groups', async () => {
  const r = await run('activate-deactivate', [{ userKey: 'JIRAUSER10000', email: '', newStatus: 'inactive' }], { removeDisabledFromGroups: true });
  expect(r.results[0].details).toEqual(['Deactivated user', 'Removed from group: jira-administrators', 'Removed from group: jira-software-users']);
  expect(mock.jiraUser('admin').groups).toEqual([]);
});

test('update groups: add/remove, skip already-member/not-member, case-correct and skip unknown groups', async () => {
  const r = await run('update-groups', [{
    userKey: 'JIRAUSER10001', email: '',
    addGroups: ['developers', 'jira-software-users', 'NoSuchGroup'],
    removeGroups: ['JIRA-SOFTWARE-USERS', 'QA'],
  }], { knownGroupNames: ['jira-administrators', 'jira-software-users', 'Developers', 'QA'] });
  expect(r.successCount).toBe(1);
  expect(r.results[0].details).toEqual([
    'Added to group: Developers',
    'Already a member of "jira-software-users" — skipped',
    'Skipped adding to group "NoSuchGroup" — group does not exist in the instance',
    'Removed from group: jira-software-users',
    'Not a member of "QA" — skipped',
  ]);
  expect(mock.jiraUser('alice').groups).toEqual(['Developers']);
  // Jira group APIs were called with the username, not the key
  const add = mock.requests.find(q => q.method === 'POST' && q.path === '/rest/api/2/group/user');
  expect(JSON.parse(add.body.toString())).toEqual({ name: 'alice' });
  expect(add.url).toContain('groupname=Developers');
});

test('update groups: when every attempted change fails the row is a failure with the API reason', async () => {
  const r = await run('update-groups', [{ userKey: 'JIRAUSER10003', email: '', addGroups: ['Ghosts'] }]);
  expect(r.failureCount).toBe(1);
  expect(r.results[0].message).toBe('All 1 group operation(s) failed');
  expect(r.results[0].details).toEqual(['Failed to add to group "Ghosts": Specified group does not exist: Ghosts']);
});

test('update groups on a disabled user re-disables them if the instance reactivated them', async () => {
  mock.state.jira.reactivateOnGroupChange = true;
  const r = await run('update-groups', [{ userKey: 'JIRAUSER10002', email: '', addGroups: ['QA'], wasDisabled: true }]);
  expect(r.results[0].details).toEqual(['Added to group: QA', 'Re-disabled user (instance reactivated user on group change)']);
  expect(mock.jiraUser('bob').active).toBe(false);
});

test('update login data: rename then change email; identical values are skipped', async () => {
  const r = await run('update-login', [
    { userKey: 'JIRAUSER10003', userName: 'carol', email: 'carol@corp.test', newUserName: 'carol.clark', newEmail: 'carol.clark@corp.test' },
    { userKey: 'JIRAUSER10001', email: '', newUserName: 'ALICE', newEmail: 'Alice@Corp.Test' },
    { userKey: 'JIRAUSER10000', email: '' },
  ]);
  expect(r.results.map(x => x.details)).toEqual([
    ['Updated username: carol → carol.clark', 'Updated email: carol@corp.test → carol.clark@corp.test'],
    ['Username already is "ALICE" — skipped', 'Email already is "Alice@Corp.Test" — skipped'],
    ['No changes needed — no new values provided'],
  ]);
  expect(mock.state.jira.users[3]).toMatchObject({ name: 'carol.clark', emailAddress: 'carol.clark@corp.test' });
});

test('update login data: a rejected rename fails that row only', async () => {
  const r = await run('update-login', [
    { userKey: 'JIRAUSER10003', email: '', newUserName: 'alice' },
    { userKey: 'JIRAUSER10000', email: '', newEmail: 'root@corp.test' },
  ]);
  expect(r.failureCount).toBe(1);
  expect(r.results[0].message).toMatch(/Failed to update username: .*A user with that username already exists/);
  expect(r.results[1].success).toBe(true);
});

test('product access is not supported on Jira DC', async () => {
  const r = await run('update-product-access', [{ userKey: 'JIRAUSER10001', email: '', addRoles: ['jira-software'] }]);
  expect(r.failureCount).toBe(1);
  expect(r.results[0].details).toEqual(['Failed to grant "jira-software": Product access management is not available for Jira Data Center']);
});
