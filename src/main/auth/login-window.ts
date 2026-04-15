import { BrowserWindow, Session } from 'electron';
import { getMainWindow } from '../index';
import { logger } from '../logger';

export interface LoginResult {
  success: boolean;
  error?: string;
}

/**
 * Opens a BrowserWindow pointing to the instance's login page.
 *
 * The user logs in manually and then closes the window.
 * After the window is closed, the caller verifies login by calling the API.
 * This approach is more reliable than trying to detect login via URL changes.
 */
export function openLoginWindow(baseUrl: string, ses: Session, isCloud: boolean): Promise<LoginResult> {
  return new Promise((resolve) => {
    const parent = getMainWindow();

    const loginWin = new BrowserWindow({
      width: 900,
      height: 750,
      parent: parent ?? undefined,
      modal: true,
      title: 'Login to ' + baseUrl + ' — close this window after logging in',
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    loginWin.setMenuBarVisibility(false);

    // Determine the login URL
    // Jira DC uses /login.jsp, Confluence DC uses /login.action
    // Cloud redirects to id.atlassian.com automatically
    let loginUrl: string;
    if (isCloud) {
      loginUrl = baseUrl;
    } else {
      // Try to detect Jira vs Confluence from the URL or just load the base URL
      // which will redirect to the appropriate login page
      loginUrl = baseUrl;
    }
    logger.info('AUTH', `Opening login window: ${loginUrl}`);

    // Log navigation for debugging
    loginWin.webContents.on('did-navigate', (_event, url) => {
      logger.debug('AUTH', `Login window navigated to: ${url}`);
    });

    loginWin.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      logger.error('AUTH', `Login page failed to load: ${errorCode} ${errorDescription} (${validatedURL})`);
    });

    // When user closes the window, we consider it a "done" action.
    // The caller (ipc-handlers) will then check if login was successful by calling the API.
    loginWin.on('closed', () => {
      logger.info('AUTH', 'Login window closed by user, will verify session...');
      resolve({ success: true });
    });

    loginWin.loadURL(loginUrl).catch((err) => {
      logger.error('AUTH', `Failed to load login page: ${err.message}`);
      resolve({ success: false, error: `Failed to load login page: ${err.message}` });
    });
  });
}
