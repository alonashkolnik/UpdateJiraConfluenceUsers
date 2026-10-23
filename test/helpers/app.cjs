// Launches the real (built) Electron app for a test, with every hostname
// resolving to the local mock server and a throwaway profile so persisted
// sessions never leak between tests.
const { _electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ALLOWLISTED_SPKI = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'allowlisted.spki'), 'utf8').trim();

const IPC = {
  CONNECT: 'connection:connect',
  DISCONNECT: 'connection:disconnect',
  GET_CONNECTION_STATUS: 'connection:status',
  SEARCH_USERS: 'users:search',
  GET_USER_DETAILS: 'users:details',
  LOAD_ALL_USERS: 'users:load-all',
  RESOLVE_BULK_USERS: 'users:resolve-bulk',
  GET_ALL_GROUPS: 'groups:all',
  GET_USER_GROUPS: 'groups:for-user',
  GET_ALL_APPLICATION_ROLES: 'roles:all',
  OPEN_FILE_DIALOG: 'file:open-dialog',
  PARSE_FILE: 'file:parse',
  EXPORT_ALL_USERS: 'users:export-all',
  EXPORT_BULK_SUMMARY: 'export:bulk-summary',
  EXECUTE_ACTION: 'action:execute',
  ACTION_PROGRESS: 'action:progress',
};

async function launchApp() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aum-test-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;

  // ELECTRON_APP_EXE=<path to packaged .exe> runs the suite against a packaged build;
  // ELECTRON_APP_ASAR=<path to resources/app.asar> runs a packaged app under the
  // stock (signed) Electron, e.g. when Smart App Control blocks the unsigned .exe
  const exe = process.env.ELECTRON_APP_EXE;
  const appPath = process.env.ELECTRON_APP_ASAR || '.';
  const app = await _electron.launch({
    cwd: ROOT,
    ...(exe ? { executablePath: exe } : {}),
    args: [
      '--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost',
      `--user-data-dir=${userDataDir}`,
      // Accept only the test/fixtures/allowlisted certificate; self-signed.crt stays untrusted
      `--ignore-certificate-errors-spki-list=${ALLOWLISTED_SPKI}`,
      ...(exe ? [] : [appPath]),
    ],
    env,
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  const ctx = {
    app,
    window,
    userDataDir,
    invoke: (channel, ...args) => window.evaluate(([c, a]) => window.electronAPI.invoke(c, ...a), [channel, args]),
    // Invoke, but return { error } instead of throwing (IPC errors arrive as rejections)
    tryInvoke: (channel, ...args) => window.evaluate(([c, a]) => window.electronAPI.invoke(c, ...a).then(value => ({ value }), e => ({ error: e.message })), [channel, args]),
    async close() {
      // A pending login window can keep a graceful close waiting forever;
      // fall back to killing the process tree so teardown never hangs.
      const closed = app.close().catch(() => {});
      const timedOut = await Promise.race([closed.then(() => false), new Promise(r => setTimeout(() => r(true), 10000))]);
      if (timedOut) {
        const pid = app.process().pid;
        if (process.platform === 'win32') require('child_process').spawnSync('taskkill', ['/pid', String(pid), '/T', '/F']);
        else app.process().kill('SIGKILL');
      }
      try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* temp dir; best effort */ }
    },
  };
  return ctx;
}

// Wait for a login BrowserWindow to finish loading a URL containing
// `urlPart`, then close it the way a user would.
async function completeLoginWindow(app, urlPart, { waitFor = null } = {}) {
  await app.evaluate(async ({ BrowserWindow }, [urlPart, waitFor]) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes(urlPart) && (!waitFor || w.webContents.getURL().includes(waitFor)));
      if (win && !win.webContents.isLoading()) { win.close(); return; }
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error(`login window for ${urlPart} never finished loading`);
  }, [urlPart, waitFor]);
}

// CONNECT, completing the interactive login window if the app opens one.
async function connect(ctx, baseUrl, { freshLogin = false, expectLogin = true } = {}) {
  const pending = ctx.tryInvoke(IPC.CONNECT, baseUrl, freshLogin);
  const host = new URL(/^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`).host;
  if (expectLogin) await completeLoginWindow(ctx.app, host);
  const r = await pending;
  if (r.error) throw new Error(r.error);
  return r.value;
}

async function stubSaveDialog(app, filePath) {
  await app.evaluate(({ dialog }, filePath) => {
    global.__saveDialogs = [];
    dialog.showSaveDialog = async (...args) => {
      global.__saveDialogs.push(args[args.length - 1]);
      return filePath ? { canceled: false, filePath } : { canceled: true };
    };
  }, filePath);
}

async function stubOpenDialog(app, filePath) {
  await app.evaluate(({ dialog }, filePath) => {
    global.__openDialogs = [];
    dialog.showOpenDialog = async (...args) => {
      global.__openDialogs.push(args[args.length - 1]);
      return filePath ? { canceled: false, filePaths: [filePath] } : { canceled: true, filePaths: [] };
    };
  }, filePath);
}

async function stubMessageBox(app, response) {
  await app.evaluate(({ dialog }, response) => {
    global.__messageBoxes = [];
    dialog.showMessageBox = async (...args) => {
      const opts = args.find(a => a && typeof a === 'object' && 'message' in a);
      global.__messageBoxes.push(opts);
      return { response, checkboxChecked: false };
    };
  }, response);
}

module.exports = { launchApp, connect, completeLoginWindow, stubSaveDialog, stubOpenDialog, stubMessageBox, IPC, ROOT };
