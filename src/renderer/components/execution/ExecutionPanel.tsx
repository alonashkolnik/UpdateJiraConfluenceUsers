import React, { useState } from 'react';
import { useActionStore } from '../../store/action-store';
import { useUserStore } from '../../store/user-store';
import { useAppStore } from '../../store/app-store';
import { IPC } from '../../../shared/ipc-channels';
import { ipcInvoke } from '../../lib/ipc';
import type { ActionPayload, ActionItem, ChangeLine } from '../../../shared/types';

function formatDate(value?: string): string {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return value;
  }
}

function ChangeLineItem({ change }: { change: ChangeLine }) {
  switch (change.type) {
    case 'activate':
      return (
        <div className="flex items-center gap-2 py-1">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-success-100 text-success-700">
            ● Activate
          </span>
          <span className="text-sm text-gray-600">{change.label}</span>
        </div>
      );
    case 'deactivate':
      return (
        <div className="flex items-center gap-2 py-1">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-danger-100 text-danger-700">
            ● Deactivate
          </span>
          <span className="text-sm text-gray-600">{change.label}</span>
        </div>
      );
    case 'keep-group':
      return (
        <div className="flex items-center gap-1.5 py-0.5">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200">
            {change.label}
          </span>
        </div>
      );
    case 'add-group':
      return (
        <div className="flex items-center gap-1.5 py-0.5">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-success-100 text-success-700 border border-success-300">
            + {change.label}
          </span>
        </div>
      );
    case 'remove-group':
      return (
        <div className="flex items-center gap-1.5 py-0.5">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-danger-100 text-danger-700 border border-danger-300 line-through">
            − {change.label}
          </span>
        </div>
      );
    case 'keep-role':
      return (
        <div className="flex items-center gap-1.5 py-0.5">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-500 border border-indigo-200">
            {change.label}
          </span>
        </div>
      );
    case 'add-role':
      return (
        <div className="flex items-center gap-1.5 py-0.5">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-success-100 text-success-700 border border-success-300">
            + {change.label}
          </span>
        </div>
      );
    case 'remove-role':
      return (
        <div className="flex items-center gap-1.5 py-0.5">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-danger-100 text-danger-700 border border-danger-300 line-through">
            − {change.label}
          </span>
        </div>
      );
    case 'update-email':
    case 'update-username':
      return (
        <div className="flex items-center gap-2 py-1 text-sm">
          <span className="font-medium text-gray-700">{change.label}:</span>
          <span className="text-gray-400 line-through">{change.oldValue || '—'}</span>
          <span className="text-gray-400">→</span>
          <span className="font-medium text-primary-700">{change.newValue}</span>
        </div>
      );
    default:
      return null;
  }
}

export function ExecutionPanel() {
  const {
    summary,
    skippedItems,
    executionPhase,
    setExecutionPhase,
    execute,
    progress,
    result,
    error,
    selectedAction,
    removeDisabledFromGroups,
    groupsToAdd,
    groupsToRemove,
    newUsername,
    newEmail,
    reset,
  } = useActionStore();
  const { mode, selectedUser, bulkData, bulkFilePath, skippedRows } = useUserStore();
  const instanceType = useAppStore((s) => s.instanceType);
  const [exportingBulk, setExportingBulk] = useState(false);

  // When execution completes, reload user data to reflect changes
  React.useEffect(() => {
    if (executionPhase === 'complete' && result) {
      if (mode === 'single' && selectedUser) {
        const identifier = selectedUser.key || selectedUser.accountId || selectedUser.username;
        // Reload this user's details (status, groups, email may have changed)
        useUserStore.getState().selectUser(identifier);
        // Reload the full user list so search results reflect changes
        useUserStore.getState().loadAllUsers();
      } else if (mode === 'bulk') {
        // Re-resolve bulk users so that a subsequent action sees fresh status/groups
        useUserStore.getState().resolveUsers();
      }
    }
  }, [executionPhase, result]);

  const buildPayload = (): ActionPayload => {
    const items: ActionItem[] = [];

    if (mode === 'single' && selectedUser) {
      const item: ActionItem = {
        userKey: selectedUser.key,
        accountId: selectedUser.accountId,
        userName: selectedUser.username,
        email: selectedUser.email,
        displayName: selectedUser.displayName,
      };

      switch (selectedAction) {
        case 'activate-deactivate':
          item.newStatus = selectedUser.active ? 'inactive' : 'active';
          break;
        case 'update-groups':
          item.addGroups = groupsToAdd;
          item.removeGroups = groupsToRemove;
          item.wasDisabled = !selectedUser.active;
          break;
        case 'update-login':
          item.newEmail = newEmail;
          item.wasDisabled = !selectedUser.active;
          // Cloud: only email changes (org-wide, no username concept)
          // DC: username defaults to new email if not explicitly provided
          if (instanceType !== 'cloud') {
            item.newUserName = newUsername || newEmail || undefined;
          }
          break;
        case 'update-product-access': {
          const { rolesToAdd: rAdd, rolesToRemove: rRemove } = useActionStore.getState();
          // rolesToAdd are already in compound "productKey|role" format from the panel
          item.addRoles = rAdd;
          // rolesToRemove are raw API strings with "[productKey|role]" metadata suffix
          // Extract the compound key from the bracket suffix
          item.removeRoles = rRemove.map(rawStr => {
            const bracketMatch = rawStr.match(/\[([^\]]*)\]\s*$/);
            if (bracketMatch) {
              return bracketMatch[1]; // e.g. "project|product/member"
            }
            // Fallback: already a compound key or plain key
            return rawStr;
          });
          break;
        }
      }
      items.push(item);
    } else if (mode === 'bulk') {
      for (const row of bulkData) {
        if (skippedRows.has(row.rowIndex)) continue;
        if (row.resolveError) continue; // user not found in instance

        const item: ActionItem = {
          userKey: row.resolvedUser?.key || row.userKey,
          accountId: row.resolvedUser?.accountId,
          userName: row.resolvedUser?.username || row.userName,
          email: row.email,
          displayName: row.resolvedUser?.displayName || row.userName || row.email,
        };

        switch (selectedAction) {
          case 'activate-deactivate':
            if (!row.newStatus) continue;
            // Skip if user is already in the desired state
            if (row.resolvedUser) {
              if (row.newStatus === 'active' && row.resolvedUser.active) continue;
              if (row.newStatus === 'inactive' && !row.resolvedUser.active) continue;
            }
            item.newStatus = row.newStatus;
            break;
          case 'update-groups':
            item.addGroups = row.addGroups;
            item.removeGroups = row.removeGroups;
            item.wasDisabled = row.resolvedUser ? !row.resolvedUser.active : false;
            if ((!item.addGroups || item.addGroups.length === 0) && (!item.removeGroups || item.removeGroups.length === 0)) continue;
            break;
          case 'update-login':
            if (!row.newEmail) continue;
            item.newEmail = row.newEmail;
            item.wasDisabled = row.resolvedUser ? !row.resolvedUser.active : false;
            // Cloud: only email changes (org-wide, no username concept)
            // DC: username defaults to new email if not explicitly provided
            if (instanceType !== 'cloud') {
              item.newUserName = row.newUserName || row.newEmail;
            }
            break;
          case 'update-product-access': {
            const allRoles = useUserStore.getState().allApplicationRoles;
            const nameToKey: Record<string, string> = {};
            for (const r of allRoles) {
              nameToKey[r.name] = r.key;
              nameToKey[r.key] = r.key;
              // Also map "ProductName — workspace" format
              if (r.workspaceName) {
                nameToKey[`${r.name} — ${r.workspaceName}`] = r.key;
              }
            }
            // Bulk values can be "ProductName|role" or just "ProductName" (maps to key)
            item.addRoles = (row.addProducts || []).map(n => {
              if (n.includes('|')) {
                const [namePart, role] = n.split('|', 2);
                const key = nameToKey[namePart] || namePart;
                return `${key}|${role}`;
              }
              return nameToKey[n] || n;
            });
            item.removeRoles = (row.removeProducts || []).map(n => {
              if (n.includes('|')) {
                const [namePart, role] = n.split('|', 2);
                const key = nameToKey[namePart] || namePart;
                return `${key}|${role}`;
              }
              return nameToKey[n] || n;
            });
            if (item.addRoles.length === 0 && item.removeRoles.length === 0) continue;
            break;
          }
        }
        items.push(item);
      }
    }

    // Pass known group names so backend can skip operations on non-existent groups
    const { allGroups } = useUserStore.getState();
    const knownGroupNames = allGroups.map(g => g.name);

    return {
      action: selectedAction!,
      instanceType: instanceType!,
      items,
      options: { removeDisabledFromGroups, knownGroupNames },
    };
  };

  const handleProceed = async () => {
    const payload = buildPayload();
    await execute(payload);
  };

  const handleBack = () => {
    setExecutionPhase('config');
  };

  const handleDownloadSummary = async () => {
    if (!bulkFilePath || !result) return;
    setExportingBulk(true);
    try {
      // Build a mapping: replay the same skip logic as buildPayload to correlate
      // result items (in order) back to bulkData row indices
      const executedRowIndices: number[] = [];
      for (const row of bulkData) {
        if (skippedRows.has(row.rowIndex)) continue;
        if (row.resolveError) continue;
        switch (selectedAction) {
          case 'activate-deactivate':
            if (!row.newStatus) continue;
            // Must match buildPayload: skip users already in the desired state
            if (row.resolvedUser) {
              if (row.newStatus === 'active' && row.resolvedUser.active) continue;
              if (row.newStatus === 'inactive' && !row.resolvedUser.active) continue;
            }
            break;
          case 'update-groups':
            if ((!row.addGroups || row.addGroups.length === 0) && (!row.removeGroups || row.removeGroups.length === 0)) continue;
            break;
          case 'update-login':
            if (!row.newEmail) continue;
            break;
          case 'update-product-access':
            if ((!row.addProducts || row.addProducts.length === 0) && (!row.removeProducts || row.removeProducts.length === 0)) continue;
            break;
        }
        executedRowIndices.push(row.rowIndex);
      }

      // Build per-row result data
      const rowResults: Array<{ rowIndex: number; actionStatus: string; actionDetails: string; skipReason: string }> = [];

      // Map skipped items by rowIndex
      const skippedMap = new Map<number, string>();
      for (const s of skippedItems) {
        skippedMap.set(s.rowIndex, s.reason);
      }

      for (const row of bulkData) {
        // Check if this row was executed
        const executedIndex = executedRowIndices.indexOf(row.rowIndex);
        if (executedIndex !== -1 && executedIndex < result.results.length) {
          const r = result.results[executedIndex];
          // Detect backend-level skips (success but only "skipped"/"already" details)
          const wasServerSkipped = r.success && r.details && r.details.length > 0 &&
            r.details.every(d => d.toLowerCase().includes('skipped') || d.toLowerCase().includes('already'));
          rowResults.push({
            rowIndex: row.rowIndex,
            actionStatus: !r.success ? 'Error' : wasServerSkipped ? 'Skipped' : 'Updated',
            actionDetails: r.success && r.details ? r.details.join('; ') : r.message,
            skipReason: wasServerSkipped ? (r.details?.join('; ') || '') : '',
          });
        } else {
          // Skipped row
          const reason = skippedMap.get(row.rowIndex) || 'No relevant data for this action';
          rowResults.push({
            rowIndex: row.rowIndex,
            actionStatus: 'Skipped',
            actionDetails: '',
            skipReason: reason,
          });
        }
      }

      const res = await ipcInvoke<{ success: boolean; filePath?: string; message?: string }>(
        IPC.EXPORT_BULK_SUMMARY,
        bulkFilePath,
        rowResults
      );
      if (res.success) {
        alert(`Summary exported to:\n${res.filePath}`);
      }
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setExportingBulk(false);
    }
  };

  return (
    <div className="card">
      {/* ─── Review Phase ─── */}
      {executionPhase === 'reviewing' && (
        <>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Review Planned Changes
          </h2>

          {/* Summary counts */}
          {mode === 'bulk' && (
            <div className="flex gap-4 mb-4 text-sm">
              <span className="text-success-700 font-medium">{summary.length} user{summary.length !== 1 ? 's' : ''} to update</span>
              {skippedItems.length > 0 && (
                <span className="text-gray-500">{skippedItems.length} row{skippedItems.length !== 1 ? 's' : ''} skipped</span>
              )}
            </div>
          )}

          {/* Actual changes */}
          <div className="max-h-[32rem] overflow-auto space-y-3 mb-4">
            {summary.map((item, i) => {
              const hasGroups = item.changes.some(c =>
                c.type === 'add-group' || c.type === 'remove-group' || c.type === 'keep-group'
              );
              const hasRoles = item.changes.some(c =>
                c.type === 'add-role' || c.type === 'remove-role' || c.type === 'keep-role'
              );
              return (
                <div key={i} className={`border rounded-lg overflow-hidden ${item.warnings && item.warnings.length > 0 ? 'border-warning-300' : 'border-gray-200'}`}>
                  <div className="grid grid-cols-[280px_1fr] divide-x divide-gray-200">
                    {/* Left column — user details */}
                    <div className="p-4 bg-gray-50">
                      {mode === 'bulk' && item.rowIndex != null && (
                        <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">Row {item.rowIndex}</div>
                      )}
                      <div className="text-xs text-gray-500 mt-0.5">
                        <span className="text-gray-400">Full Name:</span>{' '}
                        <span className="font-semibold text-gray-900">{item.displayName}</span>
                      </div>
                      {item.username && (
                        <div className="text-xs text-gray-500 mt-0.5">
                          <span className="text-gray-400">Username:</span> {item.username}
                        </div>
                      )}
                      {item.email && (
                        <div className="text-xs text-gray-500 mt-0.5">
                          <span className="text-gray-400">Email:</span> {item.email}
                        </div>
                      )}
                      <div className="text-xs text-gray-400 mt-0.5">
                        <span className="text-gray-400">Key:</span>{' '}
                        <span className="font-mono">{item.userIdentifier}</span>
                      </div>

                      {/* Date info */}
                      <div className="mt-2 pt-2 border-t border-gray-200 space-y-0.5">
                        <div className="text-[11px] text-gray-400">
                          Last login: <span className="text-gray-500">{formatDate(item.lastLogin)}</span>
                        </div>
                        <div className="text-[11px] text-gray-400">
                          Last updated: <span className="text-gray-500">{formatDate(item.lastUpdated)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Right column — changes + warnings */}
                    <div className="p-4">
                      {hasGroups && (
                        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                          Update user groups as follows
                        </div>
                      )}
                      {hasRoles && (
                        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                          Update product access as follows
                        </div>
                      )}
                      <div className={(hasGroups || hasRoles) ? 'flex flex-wrap gap-1.5' : 'space-y-1'}>
                        {item.changes.map((change, j) => (
                          <ChangeLineItem key={j} change={change} />
                        ))}
                      </div>

                      {/* Inline warnings for this user */}
                      {item.warnings && item.warnings.length > 0 && (
                        <div className="mt-3 pt-2 border-t border-warning-200 space-y-1">
                          {item.warnings.map((w, wi) => (
                            <div key={wi} className="flex items-start gap-1.5 text-xs text-warning-700">
                              <span className="text-warning-500 flex-shrink-0">&#x26A0;</span>
                              {w}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Skipped rows section — grouped by reason */}
          {skippedItems.length > 0 && (() => {
            const grouped: Record<string, typeof skippedItems> = {};
            for (const s of skippedItems) {
              // Normalize reason for grouping: strip user-specific suffix for "User not found" reasons
              const groupKey = s.reason.startsWith('User not found in instance')
                ? 'User not found in instance'
                : s.reason.startsWith('No ')
                  ? s.reason
                  : s.reason;
              if (!grouped[groupKey]) grouped[groupKey] = [];
              grouped[groupKey].push(s);
            }
            return (
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-gray-600 mb-2 flex items-center gap-2">
                  <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5-4.5L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
                  </svg>
                  Skipped Rows ({skippedItems.length})
                </h3>
                <div className="space-y-3">
                  {Object.entries(grouped).map(([reason, rows]) => (
                    <div key={reason} className="border border-gray-200 rounded-lg bg-gray-50 p-3">
                      <div className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1.5">
                        {reason.startsWith('User not found') ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-danger-100 text-danger-700 text-[10px] font-semibold">NOT FOUND</span>
                        ) : reason === 'Manually skipped by user' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 text-[10px] font-semibold">SKIPPED</span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-200 text-gray-500 text-[10px] font-semibold">NO DATA</span>
                        )}
                        {reason}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {rows.map((s) => (
                          <span key={s.rowIndex} className="text-xs text-gray-500 bg-white px-2 py-0.5 rounded border border-gray-200">
                            <span className="text-gray-400">Row {s.rowIndex}:</span> {s.displayName}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {removeDisabledFromGroups && (
            <div className="mb-4 p-3 bg-warning-50 border border-warning-200 rounded-lg text-sm text-warning-700">
              Users being deactivated will also be removed from all their groups.
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={handleBack} className="btn-secondary">
              Back
            </button>
            {summary.length > 0 && (
              <button onClick={handleProceed} className="btn-primary bg-success-500 hover:bg-success-700 focus:ring-success-500">
                Proceed with Changes ({summary.length} user{summary.length !== 1 ? 's' : ''})
              </button>
            )}
          </div>
        </>
      )}

      {/* ─── Executing Phase ─── */}
      {executionPhase === 'executing' && (
        <>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Executing Changes...</h2>

          {progress && (
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">
                  Processing: <span className="font-medium">{progress.currentUser}</span>
                </span>
                <span className="text-gray-500">
                  {progress.current} / {progress.total}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-primary-600 h-2.5 rounded-full transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
              {progress.status === 'error' && progress.message && (
                <p className="text-sm text-danger-600">Error: {progress.message}</p>
              )}
            </div>
          )}
        </>
      )}

      {/* ─── Complete Phase ─── */}
      {executionPhase === 'complete' && result && (
        <>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Execution Complete</h2>

          {/* Summary stats */}
          {(() => {
            const skippedCount = result.results.filter(r =>
              r.success && r.details && r.details.length > 0 &&
              r.details.every(d => d.toLowerCase().includes('skipped') || d.toLowerCase().includes('already'))
            ).length;
            const updatedCount = result.successCount - skippedCount;
            return (
              <div className="grid grid-cols-4 gap-4 mb-5">
                <div className="p-4 rounded-lg bg-gray-50 border border-gray-200 text-center">
                  <div className="text-2xl font-bold text-gray-900">{result.totalProcessed}</div>
                  <div className="text-xs text-gray-500 uppercase">Total Processed</div>
                </div>
                <div className="p-4 rounded-lg bg-success-50 border border-success-200 text-center">
                  <div className="text-2xl font-bold text-success-700">{updatedCount}</div>
                  <div className="text-xs text-success-600 uppercase">Updated</div>
                </div>
                {skippedCount > 0 && (
                  <div className="p-4 rounded-lg bg-gray-100 border border-gray-300 text-center">
                    <div className="text-2xl font-bold text-gray-500">{skippedCount}</div>
                    <div className="text-xs text-gray-500 uppercase">Skipped</div>
                  </div>
                )}
                <div className="p-4 rounded-lg bg-danger-50 border border-danger-200 text-center">
                  <div className="text-2xl font-bold text-danger-700">{result.failureCount}</div>
                  <div className="text-xs text-danger-600 uppercase">Failed</div>
                </div>
              </div>
            );
          })()}

          {/* Detailed results */}
          <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {result.results.map((r, i) => {
                    // Determine if this was a no-op skip (success but only "skipped" details)
                    const wasSkipped = r.success && r.details && r.details.length > 0 &&
                      r.details.every(d => d.toLowerCase().includes('skipped') || d.toLowerCase().includes('already'));
                    const rowBg = !r.success
                      ? 'bg-danger-50'
                      : wasSkipped
                        ? 'bg-gray-50'
                        : 'bg-success-50';
                    return (
                      <tr key={i} className={rowBg}>
                        <td className="px-3 py-2">
                          {r.displayName && r.displayName !== r.userIdentifier ? (
                            <>
                              <span className="font-medium text-gray-900">{r.displayName}</span>
                              <span className="block text-xs text-gray-400 font-mono">{r.userIdentifier}</span>
                            </>
                          ) : (
                            <span className="font-medium text-gray-900">{r.userIdentifier}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {!r.success ? (
                            <span className="badge-danger">Failed</span>
                          ) : wasSkipped ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-600">Skipped</span>
                          ) : (
                            <span className="badge-success">Updated</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {r.details && r.details.length > 0 ? (
                            <ul className="space-y-0.5">
                              {r.details.map((d, j) => (
                                <li key={j} className={`text-xs ${
                                  !r.success && d.toLowerCase().startsWith('failed')
                                    ? 'text-danger-600'
                                    : wasSkipped
                                      ? 'text-gray-400'
                                      : ''
                                }`}>{d}</li>
                              ))}
                            </ul>
                          ) : (
                            <span className={r.success ? 'text-success-600' : 'text-danger-600'}>{r.message}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-3">
            {mode === 'bulk' && bulkData.length > 0 && (
              <button onClick={handleDownloadSummary} disabled={exportingBulk} className="btn-primary">
                {exportingBulk ? 'Saving...' : 'Download Summary (Excel)'}
              </button>
            )}
            <button onClick={() => reset()} className="btn-secondary">
              Start New Action
            </button>
          </div>
        </>
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 p-3 bg-danger-50 border border-danger-200 rounded-lg">
          <p className="text-sm text-danger-700">{error}</p>
        </div>
      )}
    </div>
  );
}
