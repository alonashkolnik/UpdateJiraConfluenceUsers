import React from 'react';
import { useUserStore } from '../../store/user-store';
import { useActionStore } from '../../store/action-store';
import { useAppStore } from '../../store/app-store';
import type { SummaryItem, SkippedItem } from '../../../shared/types';

export function UpdateLoginDataPanel() {
  const { mode, selectedUser, bulkData, skippedRows } = useUserStore();
  const instanceType = useAppStore((s) => s.instanceType);
  const {
    newUsername,
    setNewUsername,
    newEmail,
    setNewEmail,
    setSummary,
    setExecutionPhase,
    executionPhase,
  } = useActionStore();

  const isCloud = instanceType === 'cloud';

  const generateSummary = (): { items: SummaryItem[]; skipped: SkippedItem[] } => {
    const items: SummaryItem[] = [];
    const skipped: SkippedItem[] = [];

    if (mode === 'single' && selectedUser) {
      const userId = selectedUser.key || selectedUser.accountId || selectedUser.username;
      const effectiveNewUsername = isCloud ? undefined : (newUsername || newEmail);
      const changes: import('../../../shared/types').ChangeLine[] = [];

      if (newEmail) {
        changes.push({
          type: 'update-email',
          label: 'Email',
          oldValue: selectedUser.email,
          newValue: newEmail,
        });
      }
      if (!isCloud && effectiveNewUsername && effectiveNewUsername !== selectedUser.username) {
        changes.push({
          type: 'update-username',
          label: 'Username',
          oldValue: selectedUser.username,
          newValue: effectiveNewUsername,
        });
      }

      if (changes.length > 0) {
        const warnings: string[] = [];
        if (!selectedUser.active) {
          warnings.push('User is currently disabled — will be re-disabled after login data changes if the instance reactivates them');
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
      }
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
        if (!row.newEmail) {
          skipped.push({ rowIndex: row.rowIndex, userIdentifier: userId, displayName, reason: 'No NewEmail value set for this row' });
          continue;
        }

        const effectiveNewUsername = isCloud ? undefined : (row.newUserName || row.newEmail);
        const changes: import('../../../shared/types').ChangeLine[] = [];

        changes.push({
          type: 'update-email',
          label: 'Email',
          oldValue: row.email,
          newValue: row.newEmail!,
        });

        if (!isCloud && effectiveNewUsername) {
          changes.push({
            type: 'update-username',
            label: 'Username',
            oldValue: row.resolvedUser?.username || row.userName || '',
            newValue: effectiveNewUsername,
          });
        }

        const warnings: string[] = [];
        if (row.resolvedUser && !row.resolvedUser.active) {
          warnings.push('User is currently disabled — will be re-disabled after login data changes if the instance reactivates them');
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
    if (mode === 'single' && !newEmail) {
      alert('New Email is required');
      return;
    }
    const { items, skipped } = generateSummary();
    if (items.length === 0 && skipped.length === 0) {
      alert('No login data changes to apply.');
      return;
    }
    setSummary(items, skipped);
    setExecutionPhase('reviewing');
  };

  if (executionPhase !== 'config') return null;

  return (
    <div className="space-y-4">
      {/* Cloud org-wide warning */}
      {isCloud && (
        <div className="p-4 rounded-lg border-2 border-warning-400 bg-warning-50">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-warning-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-warning-800">Organization-wide change</p>
              <p className="text-sm text-warning-700 mt-0.5">
                Changing a user's email will affect their account across <strong>ALL</strong> Atlassian products and sites in your organization, not just this site.
              </p>
            </div>
          </div>
        </div>
      )}

      {mode === 'single' && selectedUser && (
        <div className="space-y-3">
          <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
            <p className="text-sm text-gray-700">
              Current: <span className="font-medium">{selectedUser.username}</span> / {selectedUser.email}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              New Email <span className="text-danger-500">*</span>
            </label>
            <input
              type="email"
              className="input-field"
              placeholder="new-email@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>

          {!isCloud && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                New Username <span className="text-xs text-gray-400">(optional — defaults to new email)</span>
              </label>
              <input
                type="text"
                className="input-field"
                placeholder={newEmail || 'Leave empty to use new email'}
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
              />
            </div>
          )}
        </div>
      )}

      {mode === 'bulk' && (
        <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
          <p className="text-sm text-gray-700">
            Will update {isCloud ? 'email' : 'login data'} for{' '}
            <span className="font-semibold">
              {bulkData.filter((r) => !skippedRows.has(r.rowIndex) && r.newEmail).length}
            </span>{' '}
            users from the uploaded file.
            {!isCloud && ' Username defaults to NewEmail if NewUserName is not provided.'}
          </p>
        </div>
      )}

      <button onClick={handleReview} className="btn-primary">
        Review Changes
      </button>
    </div>
  );
}
