// Spreadsheet import (CSV/TSV/XLSX parsing + column aliases + validation),
// the open-file dialog, and the XLSX exports.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { launchApp, connect, IPC, stubSaveDialog, stubOpenDialog } = require('./helpers/app.cjs');
const { createAtlassianMock } = require('./helpers/atlassian-mock.cjs');

let ctx, mock, dir;
test.beforeEach(async () => {
  mock = await createAtlassianMock();
  ctx = await launchApp();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aum-files-'));
});
test.afterEach(async () => { await ctx.close(); await mock.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const write = (name, content) => { const p = path.join(dir, name); fs.writeFileSync(p, content); return p; };
const writeXlsx = (name, aoa) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
  const p = path.join(dir, name);
  fs.writeFileSync(p, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  return p;
};
const readXlsx = (p, sheet) => XLSX.utils.sheet_to_json(XLSX.read(fs.readFileSync(p)).Sheets[sheet]);

test('CSV: header aliases, list splitting, status parsing and validation', async () => {
  const csv = [
    ' User Name ,E-Mail,New_Email,Add Groups,remove-groups,Target Status,Grant Access',
    'alice,alice@corp.test,alice.new@corp.test,"devs; qa|ops",old,disable,jira-software|product/member',
    ',bad-email,,,,,',
    ',,,,,,',
    'carol,carol@corp.test,not-an-email,,,maybe,',
  ].join('\n');
  const r = await ctx.invoke(IPC.PARSE_FILE, write('users.csv', csv));
  expect(r.totalRows).toBe(4);
  expect(r.detectedColumns).toEqual({ userName: 'User Name', email: 'E-Mail', newEmail: 'New_Email', addGroups: 'Add Groups', removeGroups: 'remove-groups', newStatus: 'Target Status', addProducts: 'Grant Access' });
  expect(r.rows[0]).toEqual({
    rowIndex: 2, userName: 'alice', email: 'alice@corp.test', newEmail: 'alice.new@corp.test',
    addGroups: ['devs', 'qa', 'ops'], removeGroups: ['old'], addProducts: ['jira-software', 'product/member'], removeProducts: [], newStatus: 'inactive',
  });
  expect(r.errors).toEqual([
    { rowIndex: 3, column: 'email', message: 'Invalid email format: "bad-email"', severity: 'warning' },
    { rowIndex: 4, column: 'email', message: 'At least one of Email, UserKey, or UserName is required to identify the user', severity: 'error' },
    { rowIndex: 5, column: 'newEmail', message: 'Invalid new email format: "not-an-email"', severity: 'error' },
    { rowIndex: 5, column: 'newStatus', message: 'Invalid status value: "maybe". Expected: active/inactive/enable/disable/true/false', severity: 'error' },
  ]);
});

test('TSV is not split on tabs by extension alone but still parses (PapaParse auto-detects)', async () => {
  const r = await ctx.invoke(IPC.PARSE_FILE, write('users.tsv', 'userkey\temail\nJIRAUSER10001\talice@corp.test\n'));
  expect(r.rows).toEqual([{ rowIndex: 2, userKey: 'JIRAUSER10001', email: 'alice@corp.test', addGroups: [], removeGroups: [], addProducts: [], removeProducts: [] }]);
});

test('XLSX: first sheet, trimmed cells, empty rows skipped', async () => {
  const p = writeXlsx('users.xlsx', [
    ['UserKey', 'Email', 'NewStatus'],
    ['JIRAUSER10001', ' alice@corp.test ', 'Active'],
    [null, null, null],
    ['JIRAUSER10002', 'bob@corp.test', 'false'],
  ]);
  const r = await ctx.invoke(IPC.PARSE_FILE, p);
  expect(r.totalRows).toBe(2);
  expect(r.rows.map(x => [x.rowIndex, x.userKey, x.email, x.newStatus])).toEqual([[2, 'JIRAUSER10001', 'alice@corp.test', 'active'], [3, 'JIRAUSER10002', 'bob@corp.test', 'inactive']]);
  expect(r.errors).toEqual([]);
});

test('unsupported and empty files are reported', async () => {
  const bad = await ctx.invoke(IPC.PARSE_FILE, write('users.json', '[]'));
  expect(bad.errors[0].message).toBe('Unsupported file format: .json. Please use .csv, .tsv, .xlsx, or .xls');
  const empty = await ctx.invoke(IPC.PARSE_FILE, write('empty.csv', ''));
  expect(empty.errors[0].message).toBe('File appears to be empty or has no headers');
});

test('open file dialog returns the chosen path or null', async () => {
  await stubOpenDialog(ctx.app, 'C:\\data\\users.xlsx');
  expect(await ctx.invoke(IPC.OPEN_FILE_DIALOG)).toBe('C:\\data\\users.xlsx');
  const opts = (await ctx.app.evaluate(() => global.__openDialogs))[0];
  expect(opts.filters[0]).toEqual({ name: 'Spreadsheet Files', extensions: ['csv', 'tsv', 'xlsx', 'xls'] });
  await stubOpenDialog(ctx.app, null);
  expect(await ctx.invoke(IPC.OPEN_FILE_DIALOG)).toBeNull();
});

test('Jira DC export: one row per user with groups and status', async () => {
  await connect(ctx, mock.url('jira.corp.test'));
  const out = path.join(dir, 'export.xlsx');
  await stubSaveDialog(ctx.app, out);
  expect(await ctx.invoke(IPC.EXPORT_ALL_USERS, 'jira-dc')).toEqual({ success: true, filePath: out, userCount: 4 });
  expect(readXlsx(out, 'Users')).toEqual([
    { UserKey: 'JIRAUSER10000', 'Full Name': 'Admin', UserName: 'admin', Email: 'admin@corp.test', Groups: 'jira-administrators, jira-software-users', Status: 'Active' },
    { UserKey: 'JIRAUSER10001', 'Full Name': 'Alice Anderson', UserName: 'alice', Email: 'alice@corp.test', Groups: 'jira-software-users', Status: 'Active' },
    { UserKey: 'JIRAUSER10002', 'Full Name': 'Bob Brown', UserName: 'bob', Email: 'bob@corp.test', Groups: 'Developers', Status: 'Disabled' },
    { UserKey: 'JIRAUSER10003', 'Full Name': 'Carol Clark', UserName: 'carol', Email: 'carol@corp.test', Groups: '', Status: 'Active' },
  ]);
  const opts = (await ctx.app.evaluate(() => global.__saveDialogs))[0];
  expect(opts.defaultPath).toMatch(/^users-export-\d{4}-\d{2}-\d{2}\.xlsx$/);
});

test('Cloud export includes product access and no UserName column', async () => {
  await connect(ctx, mock.url('acme.atlassian.net'));
  const out = path.join(dir, 'cloud.xlsx');
  await stubSaveDialog(ctx.app, out);
  await ctx.invoke(IPC.EXPORT_ALL_USERS, 'cloud');
  const rows = readXlsx(out, 'Users');
  expect(rows[0]).toEqual({ UserKey: 'acc-admin', 'Full Name': 'Cloud Admin', Email: 'admin@acme.test', Groups: 'site-admins', Status: 'Active', 'Product Access': 'Jira Software (Admin) [jira-software|product/admin]' });
  expect(rows).toHaveLength(3);
});

test('export can be cancelled', async () => {
  await connect(ctx, mock.url('jira.corp.test'));
  await stubSaveDialog(ctx.app, null);
  expect(await ctx.invoke(IPC.EXPORT_ALL_USERS, 'jira-dc')).toEqual({ success: false, message: 'Cancelled' });
});

test('bulk summary export keeps every original column and appends the results', async () => {
  const src = writeXlsx('input.xlsx', [['Email', 'Note'], ['alice@corp.test', 'first'], ['bob@corp.test', 'second'], ['carol@corp.test', 'third']]);
  const out = path.join(dir, 'summary.xlsx');
  await stubSaveDialog(ctx.app, out);
  const r = await ctx.invoke(IPC.EXPORT_BULK_SUMMARY, src, [
    { rowIndex: 2, actionStatus: 'Success', actionDetails: 'Deactivated user', skipReason: '' },
    { rowIndex: 4, actionStatus: 'Skipped', actionDetails: '', skipReason: 'Already disabled' },
  ]);
  expect(r).toEqual({ success: true, filePath: out });
  expect(readXlsx(out, 'Results')).toEqual([
    { Email: 'alice@corp.test', Note: 'first', 'Action Status': 'Success', 'Action Details': 'Deactivated user' },
    { Email: 'bob@corp.test', Note: 'second', 'Action Status': '', 'Action Details': '' },
    { Email: 'carol@corp.test', Note: 'third', 'Action Status': 'Skipped', 'Action Details': '', 'Skip Reason': 'Already disabled' },
  ]);
  const opts = (await ctx.app.evaluate(() => global.__saveDialogs))[0];
  expect(opts.defaultPath).toMatch(/^input-results-\d{4}-\d{2}-\d{2}\.xlsx$/);
});

test('bulk summary export still works if the original file is gone', async () => {
  const out = path.join(dir, 'summary2.xlsx');
  await stubSaveDialog(ctx.app, out);
  await ctx.invoke(IPC.EXPORT_BULK_SUMMARY, path.join(dir, 'missing.xlsx'), [{ rowIndex: 2, actionStatus: 'Failed', actionDetails: 'x', skipReason: '' }]);
  expect(readXlsx(out, 'Results')).toEqual([{ Row: 2, 'Action Status': 'Failed', 'Action Details': 'x', 'Skip Reason': '' }]);
});
