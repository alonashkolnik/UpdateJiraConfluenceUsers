import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerIpcHandlers } from './ipc-handlers';
import { logger } from './logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Global error handlers ──────────────────────────────────────
process.on('uncaughtException', (error) => {
  logger.error('MAIN', 'Uncaught exception', error);
});
process.on('unhandledRejection', (reason) => {
  logger.error('MAIN', 'Unhandled rejection', reason);
});

// Single instance lock — prevent multiple windows from opening
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  logger.warn('MAIN', 'Another instance is already running, quitting this one');
  app.quit();
  // app.quit() is async — force exit immediately to prevent window creation
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  logger.info('MAIN', 'Creating main window');
  logger.info('MAIN', `__dirname = ${__dirname}`);
  logger.info('MAIN', `preload path = ${path.join(__dirname, '../preload/preload.cjs')}`);

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 900,
    minHeight: 700,
    title: 'Atlassian User Manager',
    show: false, // Don't show until ready
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Show window once content is loaded (avoids white flash)
  mainWindow.once('ready-to-show', () => {
    logger.info('MAIN', 'Window ready-to-show, displaying');
    mainWindow?.show();
  });

  // In dev, load from Vite dev server; in prod, load built files
  if (process.env.VITE_DEV_SERVER_URL) {
    const url = process.env.VITE_DEV_SERVER_URL;
    logger.info('MAIN', `Loading dev server URL: ${url}`);
    mainWindow.loadURL(url);
  } else {
    const indexPath = path.join(__dirname, '../../dist/index.html');
    logger.info('MAIN', `Loading production file: ${indexPath}`);
    mainWindow.loadFile(indexPath).catch((err) => {
      logger.error('MAIN', `Failed to load index.html: ${err.message}`, err);
    });
  }

  // Forward renderer console logs to main process logger
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const source = sourceId ? `${sourceId}:${line}` : 'renderer';
    if (level >= 3) {
      logger.error('RENDERER', `[${source}] ${message}`);
    } else if (level >= 2) {
      logger.warn('RENDERER', `[${source}] ${message}`);
    } else {
      logger.debug('RENDERER', `[${source}] ${message}`);
    }
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    logger.error('MAIN', `Page failed to load: ${errorCode} ${errorDescription}`);
  });

  mainWindow.on('closed', () => {
    logger.info('MAIN', 'Main window closed');
    mainWindow = null;
  });

  logger.info('MAIN', `Log file: ${logger.getLogFilePath()}`);
}

app.whenReady().then(() => {
  logger.info('MAIN', 'App ready, registering IPC handlers');
  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  logger.info('MAIN', 'All windows closed, quitting');
  app.quit();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
