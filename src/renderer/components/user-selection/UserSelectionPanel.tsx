import React from 'react';
import { useUserStore } from '../../store/user-store';
import { useActionStore } from '../../store/action-store';
import { SingleUserSearch } from './SingleUserSearch';
import { BulkFileUpload } from './BulkFileUpload';

export function UserSelectionPanel() {
  const { mode, setMode } = useUserStore();
  const resetAction = useActionStore((s) => s.reset);

  const handleModeChange = (newMode: 'single' | 'bulk') => {
    setMode(newMode);
    resetAction();
  };

  return (
    <div className="card">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">User Selection</h2>

      {/* Mode toggle */}
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => handleModeChange('single')}
          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors border ${
            mode === 'single'
              ? 'bg-primary-50 border-primary-300 text-primary-700'
              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
            </svg>
            Update Selected User
          </div>
        </button>
        <button
          onClick={() => handleModeChange('bulk')}
          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-colors border ${
            mode === 'bulk'
              ? 'bg-primary-50 border-primary-300 text-primary-700'
              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197" />
            </svg>
            Update Users in Bulk
          </div>
        </button>
      </div>

      {/* Mode content */}
      {mode === 'single' ? <SingleUserSearch /> : <BulkFileUpload />}
    </div>
  );
}
