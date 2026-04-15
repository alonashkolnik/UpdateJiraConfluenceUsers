import React, { useMemo } from 'react';
import { useUserStore } from '../../store/user-store';
import { useActionStore } from '../../store/action-store';
import type { SummaryItem, SkippedItem } from '../../../shared/types';

export function ActivateDeactivatePanel() {
  const { mode, selectedUser, bulkData, skippedRows } = useUserStore();
  const {
    removeDisabledFromGroups,
    setRemoveDisabledFromGroups,
    setSummary,
    setExecutionPhase,
    executionPhase,
  } = useActionStore();

  // Determine which users will be disabled (to show the "remove from groups" checkbox)
  const hasUsersBeingDisabled = useMemo(() => {
    if (mode === 'single' && selectedUser) {
      return selectedUser.active; // if active, action would deactivate
    }
    if (mode === 'bulk') {
      return bulkData.some(
        (r) => !skippedRows.has(r.rowIndex) && r.newStatus === 'inactive'
      );
    }
    return false;
  }, [mode, selectedUser, bulkData, skippedRows]);

  const generateSummary = (): { items: SummaryItem[]; skipped: SkippedItem[] } => {
    const items: SummaryItem[] = [];
    const skipped: SkippedItem[] = [];

    if (mode === 'single' && selectedUser) {
      const newStatus = selectedUser.active ? 'inactive' : 'active';
      items.push({
        userIdentifier: selectedUser.key || selectedUser.accountId || selectedUser.username,
        displayName: selectedUser.displayName,
        fullName: selectedUser.displayName,
        username: selectedUser.username,
        email: selectedUser.email,
        lastLogin: selectedUser.lastLogin,
        lastUpdated: selectedUser.lastUpdated,
        changes: [{
          type: newStatus === 'active' ? 'activate' : 'deactivate',
          label: newStatus === 'active'
            ? `Activate user (currently Disabled)`
            : `Deactivate user (currently Active)`,
        }],
      });
    } else if (mode === 'bulk') {
      for (const row of bulkData) {
        const displayName = row.resolvedUser?.displayName || row.userName || row.email;
        const userId = row.resolvedUser?.key || row.resolvedUser?.accountId || row.userName || row.email;

        if (skippedRows.has(row.rowIndex)) {
          skipped.push({ rowIndex: row.rowIndex, userIdentifier: userId, displayName, reason: 'Manually skipped by user' });
          continue;
        }
        if (row.resolveError) {
          skipped.push({ rowIndex: row.rowIndex, userIdentifier: userId, displayName, reason: `User not found in instance: ${row.resolveError}` });
          continue;
        }
        if (!row.newStatus) {
          skipped.push({ rowIndex: row.rowIndex, userIdentifier: userId, displayName, reason: 'No NewStatus value set for this row' });
          continue;
        }

        // Skip if user is already in the desired state
        if (row.resolvedUser) {
          const isCurrentlyActive = row.resolvedUser.active;
          if (row.newStatus === 'active' && isCurrentlyActive) {
            skipped.push({ rowIndex: row.rowIndex, userIdentifier: userId, displayName, reason: 'User is already Active — no change needed' });
            continue;
          }
          if (row.newStatus === 'inactive' && !isCurrentlyActive) {
            skipped.push({ rowIndex: row.rowIndex, userIdentifier: userId, displayName, reason: 'User is already Disabled — no change needed' });
            continue;
          }
        }

        items.push({
          rowIndex: row.rowIndex,
          userIdentifier: userId,
          displayName,
          fullName: row.resolvedUser?.displayName,
          username: row.resolvedUser?.username || row.userName || '',
          email: row.email,
          lastLogin: row.resolvedUser?.lastLogin,
          lastUpdated: row.resolvedUser?.lastUpdated,
          changes: [{
            type: row.newStatus === 'active' ? 'activate' : 'deactivate',
            label: row.newStatus === 'active'
              ? `Activate user (currently ${row.resolvedUser?.active ? 'Active' : 'Disabled'})`
              : `Deactivate user (currently ${row.resolvedUser?.active ? 'Active' : 'Disabled'})`,
          }],
        });
      }
    }

    return { items, skipped };
  };

  const handleReview = () => {
    // In bulk mode, always remove groups for deactivated users
    if (mode === 'bulk' && hasUsersBeingDisabled) {
      setRemoveDisabledFromGroups(true);
    }
    const { items, skipped } = generateSummary();
    setSummary(items, skipped);
    setExecutionPhase('reviewing');
  };

  if (executionPhase !== 'config') return null;

  return (
    <div className="space-y-4">
      {mode === 'single' && selectedUser && (
        <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
          <p className="text-sm text-gray-700">
            This will{' '}
            <span className={`font-semibold ${selectedUser.active ? 'text-danger-600' : 'text-success-600'}`}>
              {selectedUser.active ? 'deactivate' : 'activate'}
            </span>{' '}
            user <span className="font-semibold">{selectedUser.displayName}</span> ({selectedUser.username})
          </p>
        </div>
      )}

      {mode === 'bulk' && (
        <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
          <p className="text-sm text-gray-700">
            Will process <span className="font-semibold">{bulkData.filter((r) => !skippedRows.has(r.rowIndex) && r.newStatus).length}</span>{' '}
            users from the uploaded file based on their NewStatus column.
          </p>
        </div>
      )}

      {/* Remove from groups: checkbox in single mode, forced in bulk mode */}
      {hasUsersBeingDisabled && mode === 'single' && (
        <div className="flex items-center gap-2 p-3 bg-warning-50 border border-warning-200 rounded-lg">
          <input
            id="remove-groups"
            type="checkbox"
            checked={removeDisabledFromGroups}
            onChange={(e) => setRemoveDisabledFromGroups(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-warning-500 focus:ring-warning-500"
          />
          <label htmlFor="remove-groups" className="text-sm text-warning-700">
            Remove disabled users from all groups
          </label>
        </div>
      )}
      {hasUsersBeingDisabled && mode === 'bulk' && (
        <div className="p-3 bg-warning-50 border border-warning-200 rounded-lg text-sm text-warning-700">
          Users being deactivated will automatically be removed from all their groups before deactivation.
        </div>
      )}

      <button onClick={handleReview} className="btn-primary">
        Review Changes
      </button>
    </div>
  );
}
