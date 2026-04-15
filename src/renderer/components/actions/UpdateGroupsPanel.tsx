import React, { useState, useMemo } from 'react';
import { useUserStore } from '../../store/user-store';
import { useActionStore } from '../../store/action-store';
import { useAppStore } from '../../store/app-store';
import type { SummaryItem, SkippedItem } from '../../../shared/types';
import { GroupMultiSelect } from './GroupMultiSelect';

export function UpdateGroupsPanel() {
  const { mode, selectedUser, bulkData, skippedRows, allGroups } = useUserStore();
  const instanceType = useAppStore((s) => s.instanceType);
  const {
    groupsToAdd,
    setGroupsToAdd,
    groupsToRemove,
    setGroupsToRemove,
    setSummary,
    setExecutionPhase,
    executionPhase,
  } = useActionStore();

  const [showAddGroupsPopup, setShowAddGroupsPopup] = useState(false);

  // Groups available to add = all groups - user's current groups - already added groups
  const availableGroups = useMemo(() => {
    if (mode !== 'single' || !selectedUser) return allGroups.map((g) => g.name);
    const existing = new Set([...selectedUser.groups, ...groupsToAdd]);
    return allGroups.map((g) => g.name).filter((g) => !existing.has(g));
  }, [mode, selectedUser, allGroups, groupsToAdd]);

  const toggleRemoveGroup = (group: string) => {
    if (groupsToRemove.includes(group)) {
      setGroupsToRemove(groupsToRemove.filter((g) => g !== group));
    } else {
      setGroupsToRemove([...groupsToRemove, group]);
    }
  };

  // Build a case-insensitive lookup: lowercase → actual name from instance
  const knownGroupsMap = useMemo(() => new Map(allGroups.map(g => [g.name.toLowerCase(), g.name])), [allGroups]);

  const generateSummary = (): { items: SummaryItem[]; skipped: SkippedItem[] } => {
    const items: SummaryItem[] = [];
    const skipped: SkippedItem[] = [];

    if (mode === 'single' && selectedUser) {
      const userId = selectedUser.key || selectedUser.accountId || selectedUser.username;
      const changes: import('../../../shared/types').ChangeLine[] = [];
      const warnings: string[] = [];

      // Groups that stay (current minus removed)
      const removeSet = new Set(groupsToRemove);
      for (const g of selectedUser.groups) {
        if (removeSet.has(g)) {
          changes.push({ type: 'remove-group', label: g });
        } else {
          changes.push({ type: 'keep-group', label: g });
        }
      }
      // Groups to add
      for (const g of groupsToAdd) {
        changes.push({ type: 'add-group', label: g });
        if (knownGroupsMap.size > 0 && !knownGroupsMap.has(g.toLowerCase())) {
          warnings.push(`Group "${g}" does not exist in the instance`);
        }
      }
      // Warn if user is disabled — will be re-disabled after group changes if needed
      if (!selectedUser.active) {
        warnings.push('User is currently disabled — will be re-disabled after group changes if the instance reactivates them');
      }

      items.push({
        userIdentifier: userId,
        displayName: selectedUser.displayName,
        fullName: selectedUser.displayName,
        username: selectedUser.username,
        email: selectedUser.email,
        lastLogin: selectedUser.lastLogin,
        lastUpdated: selectedUser.lastUpdated,
        changes,
        warnings: warnings.length > 0 ? warnings : undefined,
      });
    } else if (mode === 'bulk') {
      for (const row of bulkData) {
        const userId = row.resolvedUser?.key || row.resolvedUser?.accountId || row.userName || row.email;
        const displayName = row.resolvedUser?.displayName || row.userName || row.email;

        if (skippedRows.has(row.rowIndex)) {
          skipped.push({ rowIndex: row.rowIndex, userIdentifier: userId, displayName, reason: 'Manually skipped by user' });
          continue;
        }
        if (row.resolveError) {
          skipped.push({ rowIndex: row.rowIndex, userIdentifier: userId, displayName, reason: `User not found in instance: ${row.resolveError}` });
          continue;
        }

        const hasAdd = row.addGroups && row.addGroups.length > 0;
        const hasRemove = row.removeGroups && row.removeGroups.length > 0;
        if (!hasAdd && !hasRemove) {
          skipped.push({ rowIndex: row.rowIndex, userIdentifier: userId, displayName, reason: 'No AddGroups or RemoveGroups values set for this row' });
          continue;
        }

        const changes: import('../../../shared/types').ChangeLine[] = [];
        const warnings: string[] = [];

        const removeSet = new Set((row.removeGroups || []).map(g => g.toLowerCase()));

        // Show current groups that stay or are removed
        const resolvedGroups: string[] = row.resolvedUser?.groups || [];
        // Build case-insensitive set of current groups for "already a member" check
        const currentGroupsLower = new Set(resolvedGroups.map(g => g.toLowerCase()));

        if (resolvedGroups.length > 0) {
          for (const g of resolvedGroups) {
            if (removeSet.has(g.toLowerCase())) {
              changes.push({ type: 'remove-group', label: g });
            } else {
              changes.push({ type: 'keep-group', label: g });
            }
          }
        } else {
          for (const g of row.removeGroups || []) {
            changes.push({ type: 'remove-group', label: g });
          }
        }

        // Groups to add — validate existence and "already a member"
        for (const g of row.addGroups || []) {
          if (knownGroupsMap.size > 0 && !knownGroupsMap.has(g.toLowerCase())) {
            warnings.push(`Group "${g}" does not exist in the instance — will be skipped`);
          } else if (currentGroupsLower.has(g.toLowerCase())) {
            warnings.push(`User is already a member of "${g}" — will be skipped`);
          } else {
            changes.push({ type: 'add-group', label: knownGroupsMap.get(g.toLowerCase()) || g });
          }
        }

        // Validate remove groups exist and user is a member
        for (const g of row.removeGroups || []) {
          if (knownGroupsMap.size > 0 && !knownGroupsMap.has(g.toLowerCase())) {
            warnings.push(`Group "${g}" (to remove) does not exist in the instance — will be skipped`);
          } else if (resolvedGroups.length > 0 && !currentGroupsLower.has(g.toLowerCase())) {
            warnings.push(`User is not a member of "${g}" — removal will be skipped`);
          }
        }

        // Warn if user is disabled — will be re-disabled after group changes if needed
        if (row.resolvedUser && !row.resolvedUser.active) {
          warnings.push('User is currently disabled — will be re-disabled after group changes if the instance reactivates them');
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
          changes,
          warnings: warnings.length > 0 ? warnings : undefined,
        });
      }
    }

    return { items, skipped };
  };

  const handleReview = () => {
    const { items, skipped } = generateSummary();
    if (items.length === 0 && skipped.length === 0) {
      alert('No group changes to apply. Please add or remove groups.');
      return;
    }
    setSummary(items, skipped);
    setExecutionPhase('reviewing');
  };

  if (executionPhase !== 'config') return null;

  return (
    <div className="space-y-4">
      {mode === 'single' && selectedUser && (
        <>
          {/* Current groups with remove toggle */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">
              Current Groups ({selectedUser.groups.length})
              <span className="text-xs text-gray-400 ml-1">— click to mark for removal</span>
            </h4>
            <div className="flex flex-wrap gap-2">
              {selectedUser.groups.map((g) => {
                const isMarkedForRemoval = groupsToRemove.includes(g);
                return (
                  <button
                    key={g}
                    onClick={() => toggleRemoveGroup(g)}
                    className={`px-3 py-1 rounded-full text-sm font-medium transition-colors border ${
                      isMarkedForRemoval
                        ? 'bg-danger-100 border-danger-300 text-danger-700 line-through'
                        : 'bg-gray-100 border-gray-200 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {isMarkedForRemoval && (
                      <span className="mr-1">✕</span>
                    )}
                    {g}
                  </button>
                );
              })}
              {selectedUser.groups.length === 0 && (
                <span className="text-sm text-gray-400 italic">No groups assigned</span>
              )}
            </div>
          </div>

          {/* Groups to add */}
          {groupsToAdd.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-success-700 mb-2">Groups to Add</h4>
              <div className="flex flex-wrap gap-2">
                {groupsToAdd.map((g) => (
                  <span
                    key={g}
                    className="px-3 py-1 rounded-full text-sm font-medium bg-success-100 border border-success-300 text-success-700 flex items-center gap-1"
                  >
                    + {g}
                    <button
                      onClick={() => setGroupsToAdd(groupsToAdd.filter((x) => x !== g))}
                      className="ml-1 hover:text-success-900"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Add groups button */}
          <div className="relative">
            <button
              onClick={() => setShowAddGroupsPopup(!showAddGroupsPopup)}
              className="btn-secondary"
            >
              <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add Groups
            </button>

            {showAddGroupsPopup && (
              <GroupMultiSelect
                groups={availableGroups}
                selected={groupsToAdd}
                onSelect={(groups) => {
                  setGroupsToAdd(groups);
                  setShowAddGroupsPopup(false);
                }}
                onClose={() => setShowAddGroupsPopup(false)}
              />
            )}
          </div>
        </>
      )}

      {mode === 'bulk' && (
        <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
          <p className="text-sm text-gray-700">
            Will process group changes for{' '}
            <span className="font-semibold">
              {bulkData.filter((r) => !skippedRows.has(r.rowIndex) && ((r.addGroups && r.addGroups.length > 0) || (r.removeGroups && r.removeGroups.length > 0))).length}
            </span>{' '}
            users from the uploaded file based on AddGroups/RemoveGroups columns.
          </p>
        </div>
      )}

      <button onClick={handleReview} className="btn-primary">
        Review Changes
      </button>
    </div>
  );
}
