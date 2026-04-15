import React, { useMemo } from 'react';
import { useUserStore } from '../../store/user-store';
import { useActionStore } from '../../store/action-store';
import { useAppStore } from '../../store/app-store';
import type { ActionType } from '../../../shared/types';
import { ActivateDeactivatePanel } from './ActivateDeactivatePanel';
import { UpdateGroupsPanel } from './UpdateGroupsPanel';
import { UpdateLoginDataPanel } from './UpdateLoginDataPanel';
import { UpdateProductAccessPanel } from './UpdateProductAccessPanel';

export function ActionPanel() {
  const { mode, selectedUser, bulkData, bulkResolved, skippedRows } = useUserStore();
  const { selectedAction, selectAction, executionPhase } = useActionStore();
  const instanceType = useAppStore((s) => s.instanceType);
  const isCloud = instanceType === 'cloud';

  // Dynamic label for activate/deactivate based on user status
  const activateDeactivateLabel = useMemo(() => {
    if (mode === 'single' && selectedUser) {
      return selectedUser.active ? 'Deactivate User' : 'Activate User';
    }
    return 'Activate / Deactivate';
  }, [mode, selectedUser]);

  const ALL_ACTIONS: { key: ActionType; label: string; icon: React.ReactNode; cloudOnly?: boolean; dcOnly?: boolean }[] = [
    {
      key: 'activate-deactivate',
      label: activateDeactivateLabel,
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" />
        </svg>
      ),
    },
    {
      key: 'update-groups',
      label: 'Update User Groups',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772" />
        </svg>
      ),
    },
    {
      key: 'update-login',
      label: 'Update User Login Data',
      dcOnly: true,
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
        </svg>
      ),
    },
    {
      key: 'update-product-access',
      label: 'Update Product Access',
      cloudOnly: true,
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
      ),
    },
  ];

  // Filter actions based on instance type
  const ACTIONS = ALL_ACTIONS.filter((a) => {
    if (a.cloudOnly && !isCloud) return false;
    if (a.dcOnly && isCloud) return false;
    return true;
  });

  // Only show when a user is selected (single) or file is uploaded (bulk)
  const canShowActions =
    (mode === 'single' && selectedUser !== null) ||
    (mode === 'bulk' && bulkData.length > 0);

  if (!canShowActions) return null;

  return (
    <div className="card">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Action</h2>

      {/* Action selector */}
      <div className={`grid gap-2 mb-5 ${ACTIONS.length <= 3 ? 'grid-cols-3' : 'grid-cols-3'}`}>
        {ACTIONS.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => selectAction(key)}
            disabled={executionPhase === 'executing'}
            className={`py-3 px-4 rounded-lg text-sm font-medium transition-colors border text-center ${
              selectedAction === key
                ? 'bg-primary-50 border-primary-300 text-primary-700'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            <div className="flex flex-col items-center gap-1.5">
              {icon}
              {label}
            </div>
          </button>
        ))}
      </div>

      {/* Action-specific panel */}
      {selectedAction === 'activate-deactivate' && <ActivateDeactivatePanel />}
      {selectedAction === 'update-groups' && <UpdateGroupsPanel />}
      {selectedAction === 'update-login' && <UpdateLoginDataPanel />}
      {selectedAction === 'update-product-access' && <UpdateProductAccessPanel />}
    </div>
  );
}
