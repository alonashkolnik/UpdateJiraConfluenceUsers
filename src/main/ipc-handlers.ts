import { ipcMain, dialog } from 'electron';
import { IPC } from '../shared/ipc-channels';
import type {
  ConnectionResult,
  ActionPayload,
  ActionResult,
  ActionResultItem,
  InstanceType,
  ParseResult,
  BulkRow,
} from '../shared/types';
import {
  getOrCreateSession,
  clearSession,
  normalizeUrl,
  isCloudUrl,
  setInstanceType,
  getInstanceType,
} from './auth/session-manager';
import { openLoginWindow } from './auth/login-window';
import { detectInstanceType } from './auth/instance-detector';
import { createApi, getApi, clearApi } from './api/api-factory';
import { ApiClient } from './api/api-client';
import { parseFile } from './file-parser/file-parser';
import { logger } from './logger';

/** Currently connected base URL */
let currentBaseUrl: string | null = null;

/**
 * Extract a clean error message from Atlassian API error responses.
 * Jira/Confluence often return JSON like:
 *   {"errorMessages":["Cannot add user 'x', user is already a member of 'y'"],"errors":{}}
 * This helper extracts the human-readable part.
 */
function extractApiError(raw: string): string {
  // Try to find JSON in the message (may be prefixed with "Failed to add user to group X: ")
  const jsonMatch = raw.match(/\{[\s\S]*"errorMessages"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.errorMessages && parsed.errorMessages.length > 0) {
        return parsed.errorMessages.join('; ');
      }
      if (parsed.errors && Object.keys(parsed.errors).length > 0) {
        return Object.values(parsed.errors).join('; ');
      }
    } catch { /* not valid JSON, use raw */ }
  }
  return raw;
}

/**
 * Wraps an IPC handler with logging and error handling.
 * Errors are logged AND re-thrown so the renderer also receives them.
 */
function handleWithLogging<T>(
  channel: string,
  handler: (...args: any[]) => Promise<T>
) {
  ipcMain.handle(channel, async (_event, ...args) => {
    logger.info('IPC', `→ ${channel}`, args.length > 0 ? args : undefined);
    try {
      const result = await handler(...args);
      logger.info('IPC', `✓ ${channel} completed`);
      return result;
    } catch (err: any) {
      logger.error('IPC', `✗ ${channel} failed: ${err.message}`, err);
      throw err;
    }
  });
}

export function registerIpcHandlers() {
  logger.info('IPC', 'Registering IPC handlers');

  // ─── Connection ──────────────────────────────────────────────
  handleWithLogging(IPC.CONNECT, async (url: string, freshLogin: boolean): Promise<ConnectionResult> => {
    const baseUrl = normalizeUrl(url);
    const isCloud = isCloudUrl(baseUrl);
    const ses = getOrCreateSession(baseUrl);

    logger.info('AUTH', `Connecting to ${baseUrl} (cloud=${isCloud}, freshLogin=${freshLogin})`);

    if (freshLogin) {
      logger.info('AUTH', 'Clearing existing session for fresh login');
      clearSession(baseUrl);
    }

    // Check if already logged in by trying to get current user
    const client = new ApiClient(baseUrl, ses);
    let instanceType: InstanceType;

    // Try to detect instance type + check session
    try {
      logger.info('AUTH', 'Checking existing session...');
      instanceType = await detectInstanceType(baseUrl, client);
      logger.info('AUTH', `Detected instance type: ${instanceType}`);
      const api = await createApi(instanceType, baseUrl, ses);
      const user = await api.getCurrentUser();
      if (user && user.username) {
        logger.info('AUTH', `Already logged in as: ${user.displayName} (${user.username})`);
        setInstanceType(baseUrl, instanceType);
        currentBaseUrl = baseUrl;
        return { instanceType, baseUrl, currentUser: user };
      }
    } catch (err: any) {
      logger.info('AUTH', `Session not valid, need interactive login: ${err.message}`);
    }

    // Open login window — user logs in and closes the window
    logger.info('AUTH', 'Opening login window...');
    const result = await openLoginWindow(baseUrl, ses, isCloud);
    if (!result.success) {
      logger.warn('AUTH', `Login window error: ${result.error}`);
      throw new Error(result.error || 'Login failed');
    }

    // User closed the login window — now verify if they actually logged in
    logger.info('AUTH', 'Login window closed, verifying session...');

    // Dump all cookies in the session for diagnostics
    try {
      const allCookies = await ses.cookies.get({});
      logger.info('AUTH', `Session has ${allCookies.length} cookies after login:`);
      for (const c of allCookies) {
        logger.info('AUTH', `  Cookie: ${c.name} domain=${c.domain} path=${c.path} secure=${c.secure} httpOnly=${c.httpOnly}`);
      }
    } catch (err: any) {
      logger.warn('AUTH', `Failed to dump cookies: ${err.message}`);
    }

    try {
      instanceType = await detectInstanceType(baseUrl, client);
      logger.info('AUTH', `Detected instance type: ${instanceType}`);
      const api = await createApi(instanceType, baseUrl, ses);
      const user = await api.getCurrentUser();
      if (user && (user.username || user.displayName)) {
        logger.info('AUTH', `Logged in as: ${user.displayName} (${user.username})`);
        setInstanceType(baseUrl, instanceType);
        currentBaseUrl = baseUrl;
        return { instanceType, baseUrl, currentUser: user };
      }
      logger.warn('AUTH', 'getCurrentUser returned empty user after login');
      throw new Error('Login verification failed — could not identify logged-in user. Please try again.');
    } catch (err: any) {
      logger.error('AUTH', `Post-login verification failed: ${err.message}`, err);
      throw new Error(
        `Login could not be verified. Make sure you completed the login before closing the window. Details: ${err.message}`
      );
    }
  });

  handleWithLogging(IPC.DISCONNECT, async () => {
    if (currentBaseUrl) {
      logger.info('AUTH', `Disconnecting from ${currentBaseUrl}`);
      clearApi(currentBaseUrl);
      currentBaseUrl = null;
    }
  });

  handleWithLogging(IPC.GET_CONNECTION_STATUS, async () => {
    if (!currentBaseUrl) return null;
    const api = getApi(currentBaseUrl);
    if (!api) return null;
    const instanceType = getInstanceType(currentBaseUrl);
    try {
      const user = await api.getCurrentUser();
      return { instanceType, baseUrl: currentBaseUrl, currentUser: user };
    } catch {
      return null;
    }
  });

  // ─── Users ───────────────────────────────────────────────────
  handleWithLogging(IPC.LOAD_ALL_USERS, async () => {
    const api = getApi(currentBaseUrl!);
    if (!api) throw new Error('Not connected');
    logger.info('USERS', 'Loading all users...');
    const users = await api.getAllUsers();
    logger.info('USERS', `Loaded ${users.length} users`);
    return users;
  });

  handleWithLogging(IPC.SEARCH_USERS, async (query: string) => {
    const api = getApi(currentBaseUrl!);
    if (!api) throw new Error('Not connected');
    return api.searchUsers(query);
  });

  handleWithLogging(IPC.GET_USER_DETAILS, async (identifier: string) => {
    const api = getApi(currentBaseUrl!);
    if (!api) throw new Error('Not connected');
    logger.info('USERS', `Getting details for: ${identifier}`);
    return api.getUserDetails(identifier);
  });

  ipcMain.handle(IPC.RESOLVE_BULK_USERS, async (_event, rows: BulkRow[]) => {
    logger.info('IPC', `→ ${IPC.RESOLVE_BULK_USERS} (${rows.length} rows)`);
    const api = getApi(currentBaseUrl!);
    if (!api) throw new Error('Not connected');

    const resolved: BulkRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const identifier = row.userKey || row.userName || row.email;
      logger.debug('USERS', `Resolving [${i + 1}/${rows.length}]: ${identifier}`);
      try {
        const user = await api.getUserByKeyOrName(identifier);
        if (user) {
          const userIdent = user.accountId || user.key || user.username;
          // Fetch groups so we can detect "already a member" before execution
          let groups: string[] = [];
          try {
            groups = await api.getUserGroups(userIdent);
          } catch (err: any) {
            logger.debug('USERS', `Failed to get groups for ${userIdent}: ${err.message}`);
          }
          // For Cloud, also fetch application roles for "already has access" checks
          let applicationRoles: string[] = [];
          const instType = getInstanceType(currentBaseUrl!);
          if (instType === 'cloud') {
            try {
              applicationRoles = await api.getUserApplicationRoles(userIdent);
            } catch (err: any) {
              logger.debug('USERS', `Failed to get roles for ${userIdent}: ${err.message}`);
            }
          }
          resolved.push({
            ...row,
            resolvedUser: { ...user, groups, applicationRoles },
          });
        } else {
          logger.warn('USERS', `User not found: ${identifier}`);
          resolved.push({
            ...row,
            resolveError: `User not found: ${identifier}`,
          });
        }
      } catch (err: any) {
        logger.error('USERS', `Failed to resolve user: ${identifier}`, err);
        resolved.push({
          ...row,
          resolveError: err.message || `Failed to resolve user: ${identifier}`,
        });
      }
    }
    logger.info('IPC', `✓ ${IPC.RESOLVE_BULK_USERS} completed: ${resolved.filter(r => r.resolvedUser).length}/${rows.length} resolved`);
    return resolved;
  });

  // ─── Groups ──────────────────────────────────────────────────
  handleWithLogging(IPC.GET_ALL_GROUPS, async () => {
    const api = getApi(currentBaseUrl!);
    if (!api) throw new Error('Not connected');
    logger.info('GROUPS', 'Loading all groups...');
    const groups = await api.getAllGroups();
    logger.info('GROUPS', `Loaded ${groups.length} groups`);
    return groups;
  });

  // ─── Application Roles / Product Access ────────────────────
  handleWithLogging(IPC.GET_ALL_APPLICATION_ROLES, async () => {
    const api = getApi(currentBaseUrl!);
    if (!api) throw new Error('Not connected');
    logger.info('ROLES', 'Loading all application roles...');
    const roles = await api.getAllApplicationRoles();
    logger.info('ROLES', `Loaded ${roles.length} application roles`);
    return roles;
  });

  handleWithLogging(IPC.GET_USER_GROUPS, async (identifier: string) => {
    const api = getApi(currentBaseUrl!);
    if (!api) throw new Error('Not connected');
    return api.getUserGroups(identifier);
  });

  // ─── Export ──────────────────────────────────────────────────
  ipcMain.handle(IPC.EXPORT_ALL_USERS, async (_event, instanceType: InstanceType) => {
    const api = getApi(currentBaseUrl!);
    if (!api) throw new Error('Not connected');

    logger.info('EXPORT', 'Starting user export...');
    const isCloud = instanceType === 'cloud';

    // 1) Load all users
    const users = await api.getAllUsers();
    logger.info('EXPORT', `Loaded ${users.length} users, fetching details...`);

    // 2) For each user, get groups (and product access for Cloud)
    //    For Confluence DC, use getUserDetails() which has email recovery logic
    //    since the bulk user list endpoint doesn't return emails.
    const isConfluenceDc = instanceType === 'confluence-dc';
    const rows: Record<string, any>[] = [];
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const identifier = user.key || user.accountId || user.username;
      if (i % 50 === 0) {
        logger.debug('EXPORT', `Processing user ${i + 1}/${users.length}`);
      }

      let groups: string[] = [];
      let products: string[] = [];
      let email = user.email || '';

      if (isConfluenceDc) {
        // getUserDetails() includes 5-step email recovery + groups in one call
        try {
          const details = await api.getUserDetails(identifier);
          email = details.email || '';
          groups = details.groups || [];
        } catch (err: any) {
          logger.debug('EXPORT', `Failed to get details for ${identifier}: ${err.message}`);
          // Fallback: at least try to get groups
          try {
            groups = await api.getUserGroups(identifier);
          } catch (err2: any) {
            logger.debug('EXPORT', `Failed to get groups for ${identifier}: ${err2.message}`);
          }
        }
      } else {
        try {
          groups = await api.getUserGroups(identifier);
        } catch (err: any) {
          logger.debug('EXPORT', `Failed to get groups for ${identifier}: ${err.message}`);
        }
        if (isCloud) {
          try {
            products = await api.getUserApplicationRoles(identifier);
          } catch (err: any) {
            logger.debug('EXPORT', `Failed to get products for ${identifier}: ${err.message}`);
          }
        }
      }

      const row: Record<string, any> = {
        UserKey: user.key || user.accountId || '',
        'Full Name': user.displayName,
      };
      if (!isCloud) {
        row['UserName'] = user.username;
      }
      row['Email'] = email;
      row['Groups'] = groups.join(', ');
      row['Status'] = user.active ? 'Active' : 'Disabled';
      if (isCloud) {
        row['Product Access'] = products.join(', ');
      }

      rows.push(row);
    }

    logger.info('EXPORT', `All ${rows.length} users processed, writing file...`);

    // 3) Ask user where to save
    const saveResult = await dialog.showSaveDialog({
      defaultPath: `users-export-${new Date().toISOString().slice(0, 10)}.xlsx`,
      filters: [
        { name: 'Excel Workbook', extensions: ['xlsx'] },
      ],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      logger.info('EXPORT', 'Export cancelled by user');
      return { success: false, message: 'Cancelled' };
    }

    // 4) Write XLSX
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');

    // Auto-size columns
    const colWidths = Object.keys(rows[0] || {}).map((key) => {
      const maxLen = Math.max(
        key.length,
        ...rows.map((r) => String(r[key] || '').length)
      );
      return { wch: Math.min(maxLen + 2, 80) };
    });
    ws['!cols'] = colWidths;

    // Use buffer write instead of XLSX.writeFile to handle OneDrive-synced paths
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fs = await import('fs');
    fs.writeFileSync(saveResult.filePath, buf);
    logger.info('EXPORT', `Export complete: ${saveResult.filePath} (${rows.length} users)`);
    return { success: true, filePath: saveResult.filePath, userCount: rows.length };
  });

  // ─── Bulk Summary Export ──────────────────────────────────────
  ipcMain.handle(IPC.EXPORT_BULK_SUMMARY, async (
    _event,
    originalFilePath: string,
    rowResults: Array<{ rowIndex: number; actionStatus: string; actionDetails: string; skipReason: string }>
  ) => {
    logger.info('EXPORT', `Exporting bulk summary for ${originalFilePath} (${rowResults.length} rows)`);

    const XLSX = await import('xlsx');
    const fs = await import('fs');

    // 1) Read the original file to preserve all columns
    let originalRows: Record<string, any>[] = [];
    let originalHeaders: string[] = [];
    try {
      const buf = fs.readFileSync(originalFilePath);
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      originalRows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (originalRows.length > 0) {
        originalHeaders = Object.keys(originalRows[0]);
      }
    } catch (err: any) {
      logger.error('EXPORT', `Failed to read original file: ${err.message}`);
      // Fall back to building rows from results only
    }

    // 2) Build a lookup from rowIndex → result data
    const resultMap = new Map<number, { actionStatus: string; actionDetails: string; skipReason: string }>();
    for (const r of rowResults) {
      resultMap.set(r.rowIndex, r);
    }

    // 3) Merge: for each original row, append our result columns
    //    Row indices in bulkData are 1-based (matching spreadsheet row numbers, header = row 1)
    //    originalRows is 0-based from sheet_to_json
    const mergedRows: Record<string, any>[] = [];
    for (let i = 0; i < originalRows.length; i++) {
      const row = { ...originalRows[i] };
      const dataRowIndex = i + 2; // spreadsheet row number (1=header, 2=first data row)
      const res = resultMap.get(dataRowIndex);
      if (res) {
        row['Action Status'] = res.actionStatus;
        row['Action Details'] = res.actionDetails;
        if (res.skipReason) {
          row['Skip Reason'] = res.skipReason;
        }
      } else {
        row['Action Status'] = '';
        row['Action Details'] = '';
      }
      mergedRows.push(row);
    }

    // If original file couldn't be read, build rows from results alone
    if (originalRows.length === 0) {
      for (const r of rowResults) {
        mergedRows.push({
          'Row': r.rowIndex,
          'Action Status': r.actionStatus,
          'Action Details': r.actionDetails,
          'Skip Reason': r.skipReason || '',
        });
      }
    }

    // 4) Ask user where to save
    const baseName = originalFilePath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') || 'bulk-summary';
    const saveResult = await dialog.showSaveDialog({
      defaultPath: `${baseName}-results-${new Date().toISOString().slice(0, 10)}.xlsx`,
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, message: 'Cancelled' };
    }

    // 5) Write XLSX
    const allHeaders = mergedRows.length > 0 ? Object.keys(mergedRows[0]) : [];
    const ws = XLSX.utils.json_to_sheet(mergedRows, { header: allHeaders });

    // Auto-size columns
    ws['!cols'] = allHeaders.map((key) => {
      const maxLen = Math.max(
        key.length,
        ...mergedRows.map((r) => String(r[key] || '').length)
      );
      return { wch: Math.min(maxLen + 2, 100) };
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Results');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    fs.writeFileSync(saveResult.filePath, buf);

    logger.info('EXPORT', `Bulk summary exported: ${saveResult.filePath} (${mergedRows.length} rows)`);
    return { success: true, filePath: saveResult.filePath };
  });

  // ─── File ────────────────────────────────────────────────────
  handleWithLogging(IPC.OPEN_FILE_DIALOG, async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Spreadsheet Files', extensions: ['csv', 'tsv', 'xlsx', 'xls'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    logger.info('FILE', `File selected: ${result.filePaths[0]}`);
    return result.filePaths[0];
  });

  handleWithLogging(IPC.PARSE_FILE, async (filePath: string): Promise<ParseResult> => {
    logger.info('FILE', `Parsing file: ${filePath}`);
    const result = parseFile(filePath);
    logger.info('FILE', `Parsed ${result.totalRows} rows, ${result.errors.length} errors`);
    if (result.errors.length > 0) {
      logger.warn('FILE', 'Parse errors:', result.errors);
    }
    return result;
  });

  // ─── Actions ─────────────────────────────────────────────────
  ipcMain.handle(
    IPC.EXECUTE_ACTION,
    async (event, payload: ActionPayload): Promise<ActionResult> => {
      logger.info('IPC', `→ ${IPC.EXECUTE_ACTION} (action=${payload.action}, items=${payload.items.length})`);
      const api = getApi(currentBaseUrl!);
      if (!api) throw new Error('Not connected');

      const results: ActionResultItem[] = [];
      let successCount = 0;
      let failureCount = 0;

      const sender = event.sender;

      for (let i = 0; i < payload.items.length; i++) {
        const item = payload.items[i];
        // For Cloud, accountId is the canonical identifier; for DC, userKey is.
        // Prefer accountId when available to ensure Cloud API calls use the right value.
        const userId = item.accountId || item.userKey || item.userName || item.email;

        logger.info('ACTION', `[${i + 1}/${payload.items.length}] Processing ${userId} (${payload.action})`);

        sender.send(IPC.ACTION_PROGRESS, {
          current: i + 1,
          total: payload.items.length,
          currentUser: userId,
          status: 'processing',
        });

        try {
          const details: string[] = [];

          switch (payload.action) {
            case 'activate-deactivate': {
              // Safety net: check current user state before acting to avoid
              // no-op calls that may fail on some instances
              let currentlyActive: boolean | undefined;
              try {
                const freshUser = await api.getUserByKeyOrName(userId);
                if (freshUser) {
                  currentlyActive = freshUser.active;
                }
              } catch (err: any) {
                logger.warn('ACTION', `Could not verify current state for ${userId}, proceeding anyway: ${err.message}`);
              }

              if (item.newStatus === 'active') {
                if (currentlyActive === true) {
                  details.push('User is already Active — skipped');
                  break;
                }
                try {
                  await api.activateUser(userId);
                  details.push('Activated user');
                } catch (err: any) {
                  throw new Error(`Failed to activate user: ${err.message || err}`);
                }
              } else if (item.newStatus === 'inactive') {
                if (currentlyActive === false) {
                  details.push('User is already Disabled — skipped');
                  break;
                }
                try {
                  await api.deactivateUser(userId);
                  details.push('Deactivated user');
                } catch (err: any) {
                  throw new Error(`Failed to deactivate user: ${err.message || err}`);
                }

                if (payload.options.removeDisabledFromGroups) {
                  try {
                    const groups = await api.getUserGroups(userId);
                    for (const group of groups) {
                      await api.removeUserFromGroup(userId, group);
                      details.push(`Removed from group: ${group}`);
                    }
                  } catch (err: any) {
                    details.push(`Warning: Failed to remove from some groups: ${err.message}`);
                    logger.warn('ACTION', `Failed to remove ${userId} from groups`, err);
                  }
                }
              }
              break;
            }

            case 'update-groups': {
              // Build case-insensitive lookup: lowercase → actual group name from instance
              const knownGroupsMap: Map<string, string> | null = payload.options.knownGroupNames
                ? new Map(payload.options.knownGroupNames.map(g => [g.toLowerCase(), g]))
                : null;

              // Resolve a group name from the file to the actual instance name (case-corrected)
              // Returns null if the group doesn't exist in the instance
              const resolveGroupName = (fileGroup: string): string | null => {
                if (!knownGroupsMap) return fileGroup; // no known groups list — pass through
                return knownGroupsMap.get(fileGroup.toLowerCase()) ?? null;
              };

              // Fetch user's current groups for "already a member" checks
              let currentGroups: Set<string> = new Set();
              try {
                const groups = await api.getUserGroups(userId);
                currentGroups = new Set(groups.map(g => g.toLowerCase()));
              } catch (err: any) {
                logger.warn('ACTION', `Could not fetch current groups for ${userId}, will attempt all operations: ${err.message}`);
              }

              let groupErrors = 0;
              let groupsAttempted = 0;
              if (item.addGroups) {
                for (const group of item.addGroups) {
                  const actualName = resolveGroupName(group);
                  if (actualName === null) {
                    details.push(`Skipped adding to group "${group}" — group does not exist in the instance`);
                    continue;
                  }
                  // Skip if user is already a member (case-insensitive)
                  if (currentGroups.has(actualName.toLowerCase())) {
                    details.push(`Already a member of "${actualName}" — skipped`);
                    continue;
                  }
                  groupsAttempted++;
                  try {
                    await api.addUserToGroup(userId, actualName);
                    details.push(`Added to group: ${actualName}`);
                  } catch (err: any) {
                    const cleanMsg = extractApiError(err.message);
                    details.push(`Failed to add to group "${actualName}": ${cleanMsg}`);
                    logger.warn('ACTION', `Failed to add ${userId} to group ${actualName}`, err);
                    groupErrors++;
                  }
                }
              }
              if (item.removeGroups) {
                for (const group of item.removeGroups) {
                  const actualName = resolveGroupName(group);
                  if (actualName === null) {
                    details.push(`Skipped removing from group "${group}" — group does not exist in the instance`);
                    continue;
                  }
                  // Skip if user is not a member (case-insensitive)
                  if (!currentGroups.has(actualName.toLowerCase())) {
                    details.push(`Not a member of "${actualName}" — skipped`);
                    continue;
                  }
                  groupsAttempted++;
                  try {
                    await api.removeUserFromGroup(userId, actualName);
                    details.push(`Removed from group: ${actualName}`);
                  } catch (err: any) {
                    const cleanMsg = extractApiError(err.message);
                    details.push(`Failed to remove from group "${actualName}": ${cleanMsg}`);
                    logger.warn('ACTION', `Failed to remove ${userId} from group ${actualName}`, err);
                    groupErrors++;
                  }
                }
              }
              // If ALL attempted operations failed, mark as failure but keep details
              // (details array will be included in the result for per-line display)
              if (groupsAttempted > 0 && groupErrors >= groupsAttempted) {
                results.push({ userIdentifier: userId, displayName: item.displayName, success: false, message: `All ${groupErrors} group operation(s) failed`, details });
                failureCount++;

                sender.send(IPC.ACTION_PROGRESS, {
                  current: i + 1,
                  total: payload.items.length,
                  currentUser: userId,
                  status: 'error',
                  message: `All ${groupErrors} group operation(s) failed`,
                });
                continue; // skip the success path below
              }

              // If user was disabled before group changes, some instances reactivate
              // the user on group membership changes — verify and re-disable if needed
              if (item.wasDisabled) {
                try {
                  const freshUser = await api.getUserByKeyOrName(userId);
                  if (freshUser && freshUser.active) {
                    logger.info('ACTION', `User ${userId} was reactivated by group change — re-disabling`);
                    await api.deactivateUser(userId);
                    details.push('Re-disabled user (instance reactivated user on group change)');
                  }
                } catch (err: any) {
                  details.push(`Warning: Could not verify/re-disable user status: ${err.message}`);
                  logger.warn('ACTION', `Failed to verify/re-disable ${userId}`, err);
                }
              }
              break;
            }

            case 'update-product-access': {
              // Fetch user's current product access for "already has" checks
              let currentRoleKeys: Set<string> = new Set();
              try {
                const roles = await api.getUserApplicationRoles(userId);
                // Parse each role string to extract the compound key "productKey|role"
                for (const r of roles) {
                  const bracketMatch = r.match(/\[([^\]]*)\]\s*$/);
                  if (bracketMatch) {
                    currentRoleKeys.add(bracketMatch[1].toLowerCase());
                  }
                }
              } catch (err: any) {
                logger.warn('ACTION', `Could not fetch current roles for ${userId}, will attempt all operations: ${err.message}`);
              }

              let roleErrors = 0;
              let rolesAttempted = 0;
              if (item.addRoles) {
                for (const role of item.addRoles) {
                  // Check if user already has this role
                  if (currentRoleKeys.has(role.toLowerCase())) {
                    details.push(`Already has access "${role}" — skipped`);
                    continue;
                  }
                  rolesAttempted++;
                  try {
                    await api.addUserToApplicationRole(userId, role);
                    details.push(`Granted product access: ${role}`);
                  } catch (err: any) {
                    const cleanMsg = extractApiError(err.message);
                    details.push(`Failed to grant "${role}": ${cleanMsg}`);
                    roleErrors++;
                  }
                }
              }
              if (item.removeRoles) {
                for (const role of item.removeRoles) {
                  // Check if user even has this role
                  if (currentRoleKeys.size > 0 && !currentRoleKeys.has(role.toLowerCase())) {
                    details.push(`Does not have access "${role}" — skipped`);
                    continue;
                  }
                  rolesAttempted++;
                  try {
                    await api.removeUserFromApplicationRole(userId, role);
                    details.push(`Revoked product access: ${role}`);
                  } catch (err: any) {
                    const cleanMsg = extractApiError(err.message);
                    details.push(`Failed to revoke "${role}": ${cleanMsg}`);
                    roleErrors++;
                  }
                }
              }
              if (rolesAttempted > 0 && roleErrors >= rolesAttempted) {
                results.push({ userIdentifier: userId, displayName: item.displayName, success: false, message: `All ${roleErrors} product access operation(s) failed`, details });
                failureCount++;
                sender.send(IPC.ACTION_PROGRESS, {
                  current: i + 1,
                  total: payload.items.length,
                  currentUser: userId,
                  status: 'error',
                  message: `All ${roleErrors} product access operation(s) failed`,
                });
                continue;
              }
              break;
            }

            case 'update-login': {
              // Fetch the user's actual current data from the instance for accurate comparison
              // (file data may be stale, missing, or incorrect)
              let currentUsername: string | undefined;
              let currentEmail: string | undefined;
              try {
                const freshUser = await api.getUserByKeyOrName(userId);
                if (freshUser) {
                  currentUsername = freshUser.username;
                  currentEmail = freshUser.email;
                }
              } catch (err: any) {
                logger.warn('ACTION', `Could not fetch current user data for ${userId}, will attempt all updates: ${err.message}`);
              }

              // Rename username first (before email update)
              if (item.newUserName) {
                if (currentUsername && item.newUserName.toLowerCase() === currentUsername.toLowerCase()) {
                  details.push(`Username already is "${item.newUserName}" — skipped`);
                } else {
                  await api.updateUserName(userId, item.newUserName);
                  details.push(`Updated username: ${currentUsername || item.userName || '?'} → ${item.newUserName}`);
                }
              }
              if (item.newEmail) {
                if (currentEmail && item.newEmail.toLowerCase() === currentEmail.toLowerCase()) {
                  details.push(`Email already is "${item.newEmail}" — skipped`);
                } else {
                  // Always use original userId (user key) — it doesn't change on rename
                  await api.updateUserEmail(userId, item.newEmail);
                  details.push(`Updated email: ${currentEmail || item.email || '?'} → ${item.newEmail}`);
                }
              }
              if (details.length === 0) {
                details.push('No changes needed — no new values provided');
              }

              // If user was disabled before login changes, some instances reactivate
              // the user on email/username changes — verify and re-disable if needed
              if (item.wasDisabled) {
                try {
                  const freshUser = await api.getUserByKeyOrName(userId);
                  if (freshUser && freshUser.active) {
                    logger.info('ACTION', `User ${userId} was reactivated by login data change — re-disabling`);
                    await api.deactivateUser(userId);
                    details.push('Re-disabled user (instance reactivated user on login data change)');
                  }
                } catch (err: any) {
                  details.push(`Warning: Could not verify/re-disable user status: ${err.message}`);
                  logger.warn('ACTION', `Failed to verify/re-disable ${userId}`, err);
                }
              }
              break;
            }
          }

          logger.info('ACTION', `✓ ${userId}: ${details.join(', ')}`);
          results.push({ userIdentifier: userId, displayName: item.displayName, success: true, message: 'Success', details });
          successCount++;

          sender.send(IPC.ACTION_PROGRESS, {
            current: i + 1,
            total: payload.items.length,
            currentUser: userId,
            status: 'success',
          });
        } catch (err: any) {
          logger.error('ACTION', `✗ ${userId}: ${err.message}`, err);
          results.push({ userIdentifier: userId, displayName: item.displayName, success: false, message: err.message || 'Unknown error' });
          failureCount++;

          sender.send(IPC.ACTION_PROGRESS, {
            current: i + 1,
            total: payload.items.length,
            currentUser: userId,
            status: 'error',
            message: err.message,
          });
        }
      }

      logger.info('ACTION', `Action complete: ${successCount} success, ${failureCount} failed out of ${payload.items.length}`);
      return { totalProcessed: payload.items.length, successCount, failureCount, results };
    }
  );

  logger.info('IPC', 'All IPC handlers registered');
}
