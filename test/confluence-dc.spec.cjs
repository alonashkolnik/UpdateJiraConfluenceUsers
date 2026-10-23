// Confluence Data Center: user listing, email recovery, JSON-RPC operations
// and their REST fallbacks.
const { test, expect } = require('@playwright/test');
const { launchApp, connect, IPC, stubSaveDialog } = require('./helpers/app.cjs');
const { createAtlassianMock } = require('./helpers/atlassian-mock.cjs');
const fs = require('fs');
const os = require('os');
const path = require('path');

let ctx, mock;
test.beforeEach(async () => {
  mock = await createAtlassianMock();
  ctx = await launchApp();
  await connect(ctx, mock.url('confluence.corp.test'));
});
test.afterEach(async () => { await ctx.close(); await mock.close(); });

const run = (action, items, options = {}) => ctx.invoke(IPC.EXECUTE_ACTION, { action, instanceType: 'confluence-dc', items, options });
const rpcCalls = () => mock.requests.filter(q => q.path.startsWith('/rpc/json-rpc/')).map(q => [q.path.split('/').pop(), JSON.parse(q.body.toString())]);

test('users: list with status mapping; search via CQL', async () => {
  const users = await ctx.invoke(IPC.LOAD_ALL_USERS);
  expect(users.map(u => [u.key, u.username, u.active])).toEqual([['ck-admin', 'admin', true], ['ck-alice', 'alice', true], ['ck-dave', 'dave', false]]);
  expect((await ctx.invoke(IPC.SEARCH_USERS, 'anderson')).map(u => u.username)).toEqual(['alice']);
});

test('search falls back to filtering the user list when CQL user search is unavailable', async () => {
  mock.state.confluence.searchUserEnabled = false;
  expect((await ctx.invoke(IPC.SEARCH_USERS, 'dav')).map(u => u.username)).toEqual(['dave']);
});

test('details recover the email the REST API hides (mobile profile) and include groups', async () => {
  const d = await ctx.invoke(IPC.GET_USER_DETAILS, 'ck-alice');
  expect(d).toMatchObject({ username: 'alice', email: 'alice@corp.test', groups: ['confluence-users'] });
  expect(mock.requests.some(q => q.path === '/rest/mobile/1.0/profile/alice')).toBe(true);
});

test('groups are listed', async () => {
  expect((await ctx.invoke(IPC.GET_ALL_GROUPS)).map(g => g.name)).toEqual(['confluence-administrators', 'confluence-users', 'Writers']);
  expect(await ctx.invoke(IPC.GET_USER_GROUPS, 'ck-admin')).toEqual(['confluence-administrators', 'confluence-users']);
});

test('activate/deactivate use JSON-RPC with the username', async () => {
  const r = await run('activate-deactivate', [
    { userKey: 'ck-alice', email: '', newStatus: 'inactive' },
    { userKey: 'ck-dave', email: '', newStatus: 'active' },
  ]);
  expect(r.successCount).toBe(2);
  expect(mock.confUser('alice').status).toBe('deactivated');
  expect(mock.confUser('dave').status).toBe('current');
  expect(rpcCalls()).toEqual([['deactivateUser', ['alice']], ['reactivateUser', ['dave']]]);
});

test('with JSON-RPC disabled, status and group changes fall back to REST', async () => {
  mock.state.confluence.rpcEnabled = false;
  const r1 = await run('activate-deactivate', [{ userKey: 'ck-alice', email: '', newStatus: 'inactive' }]);
  expect(r1.successCount).toBe(1);
  expect(mock.confUser('alice').status).toBe('deactivated');
  expect(mock.requests.some(q => q.method === 'PUT' && q.url === '/rest/api/admin/user/disable?key=ck-alice')).toBe(true);

  const r2 = await run('update-groups', [{ userKey: 'ck-alice', email: '', addGroups: ['Writers'], removeGroups: ['confluence-users'] }]);
  expect(r2.results[0].details).toEqual(['Added to group: Writers', 'Removed from group: confluence-users']);
  expect(mock.confUser('alice').groups).toEqual(['Writers']);
});

test('update groups via JSON-RPC; a JSON-RPC error envelope counts as a failure', async () => {
  const r = await run('update-groups', [
    { userKey: 'ck-alice', email: '', addGroups: ['Writers'] },
    { userKey: 'ck-alice', email: '', addGroups: ['Ghosts'] },
  ]);
  expect(r.results[0].details).toEqual(['Added to group: Writers']);
  // RPC error -> REST fallback -> 404 -> failure
  expect(r.results[1].success).toBe(false);
  expect(r.results[1].details).toEqual(['Failed to add to group "Ghosts": Failed to add user to group Ghosts']);
});

test('update login data: rename and email via JSON-RPC', async () => {
  const r = await run('update-login', [{ userKey: 'ck-alice', email: '', newUserName: 'alice2', newEmail: 'alice2@corp.test' }]);
  expect(r.results[0].details).toEqual(['Updated username: alice → alice2', 'Updated email: ? → alice2@corp.test']);
  expect(mock.state.confluence.users[1]).toMatchObject({ username: 'alice2', hiddenEmail: 'alice2@corp.test' });
  expect(rpcCalls()).toEqual([
    ['renameUser', ['alice', 'alice2']],
    ['editUser', [{ name: 'alice2', fullname: 'Alice Anderson', email: 'alice2@corp.test' }]],
  ]);
});

test('export all users recovers emails per user and writes an xlsx', async () => {
  const out = path.join(os.tmpdir(), `conf-export-${Date.now()}.xlsx`);
  await stubSaveDialog(ctx.app, out);
  const r = await ctx.invoke(IPC.EXPORT_ALL_USERS, 'confluence-dc');
  expect(r).toEqual({ success: true, filePath: out, userCount: 3 });
  const XLSX = require('xlsx');
  const rows = XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync(out)).Sheets.Users);
  fs.unlinkSync(out);
  expect(rows).toEqual([
    { UserKey: 'ck-admin', 'Full Name': 'Conf Admin', UserName: 'admin', Email: 'cadmin@corp.test', Groups: 'confluence-administrators, confluence-users', Status: 'Active' },
    { UserKey: 'ck-alice', 'Full Name': 'Alice Anderson', UserName: 'alice', Email: 'alice@corp.test', Groups: 'confluence-users', Status: 'Active' },
    { UserKey: 'ck-dave', 'Full Name': 'Dave Davis', UserName: 'dave', Email: 'dave@corp.test', Groups: '', Status: 'Disabled' },
  ]);
});
