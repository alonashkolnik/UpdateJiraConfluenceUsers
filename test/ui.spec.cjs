// UI smoke tests: drive the React screens end to end against the mock.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, completeLoginWindow, stubSaveDialog, stubOpenDialog } = require('./helpers/app.cjs');
const { createAtlassianMock } = require('./helpers/atlassian-mock.cjs');

let ctx, mock, w;
test.beforeEach(async () => { mock = await createAtlassianMock(); ctx = await launchApp(); w = ctx.window; });
test.afterEach(async () => { await ctx.close(); await mock.close(); });

async function connectViaUi(url, host) {
  await w.getByPlaceholder(/your-instance\.atlassian\.net/).fill(url);
  await w.getByTitle('Connect').click();
  await completeLoginWindow(ctx.app, host);
  await expect(w.getByText('Connected', { exact: true })).toBeVisible({ timeout: 20000 });
}

test('connect to Jira DC, find a user and see their groups', async () => {
  await connectViaUi(mock.url('jira.corp.test'), 'jira.corp.test');
  const search = w.getByPlaceholder(/Search 4 users/);
  await expect(search).toBeVisible({ timeout: 20000 });
  await search.fill('alice');
  await w.getByRole('button', { name: /Alice Anderson/ }).first().click();
  await expect(w.getByText('jira-software-users').first()).toBeVisible();
});

test('export all users from the UI', async () => {
  await connectViaUi(mock.url('jira.corp.test'), 'jira.corp.test');
  const out = path.join(os.tmpdir(), `ui-export-${Date.now()}.xlsx`);
  await stubSaveDialog(ctx.app, out);
  await w.getByRole('button', { name: 'Export All Users' }).click();
  await expect(w.getByText(`Exported 4 users to ${out}`)).toBeVisible({ timeout: 20000 });
  expect(fs.existsSync(out)).toBe(true);
  fs.unlinkSync(out);
});

test('Cloud shows the organisation-wide banner', async () => {
  await connectViaUi(mock.url('acme.atlassian.net'), 'acme.atlassian.net');
  await expect(w.getByText(/organization-wide/)).toBeVisible();
});

test('a failed login shows the error and allows retry', async () => {
  mock.failures.push({ host: 'jira.corp.test', pathRe: /^\/login\.jsp/, status: 200, body: '<html>login form</html>', times: 1 });
  await w.getByPlaceholder(/your-instance\.atlassian\.net/).fill(mock.url('jira.corp.test'));
  await w.getByTitle('Connect').click();
  await completeLoginWindow(ctx.app, 'jira.corp.test', { waitFor: '/login.jsp' });
  await expect(w.getByText(/Login could not be verified/)).toBeVisible({ timeout: 20000 });
  await w.getByTitle('Connect').click();
  await completeLoginWindow(ctx.app, 'jira.corp.test');
  await expect(w.getByText('Connected', { exact: true })).toBeVisible({ timeout: 20000 });
});

test('disconnect returns to the connection form', async () => {
  await connectViaUi(mock.url('jira.corp.test'), 'jira.corp.test');
  await w.getByTitle('Disconnect').click();
  await expect(w.getByTitle('Connect')).toBeVisible();
  await expect(w.getByPlaceholder(/your-instance\.atlassian\.net/)).toBeEnabled();
});

test('bulk mode: pick a spreadsheet and see its rows', async () => {
  await connectViaUi(mock.url('jira.corp.test'), 'jira.corp.test');
  const csv = path.join(os.tmpdir(), `ui-bulk-${Date.now()}.csv`);
  fs.writeFileSync(csv, 'Email,NewStatus\nalice@corp.test,inactive\nbob@corp.test,active\n');
  await stubOpenDialog(ctx.app, csv);
  await w.getByRole('button', { name: 'Update Users in Bulk' }).click();
  await w.getByRole('button', { name: 'Upload File' }).click();
  await expect(w.getByText('(2 rows)')).toBeVisible({ timeout: 20000 });
  await expect(w.getByText('email: "Email"')).toBeVisible();
  await expect(w.getByText('alice@corp.test').first()).toBeVisible();
  await w.getByRole('button', { name: 'Resolve Users in Instance' }).click();
  await expect(w.getByText('Alice Anderson').first()).toBeVisible({ timeout: 20000 });
  await expect(w.getByText('Bob Brown').first()).toBeVisible();
  fs.unlinkSync(csv);
});
