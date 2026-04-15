import React, { useState } from 'react';
import { useAppStore } from '../../store/app-store';
import { ipcInvoke } from '../../lib/ipc';
import { IPC } from '../../../shared/ipc-channels';

export function ConnectionPanel() {
  const { instanceUrl, setInstanceUrl, connectionStatus, connect, disconnect, error, clearError, instanceType } =
    useAppStore();
  const [freshLogin, setFreshLogin] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);

  const handleConnect = async () => {
    clearError();
    await connect(freshLogin);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConnect();
  };

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Instance Connection</h2>
        {connectionStatus === 'connected' && (
          <span className="badge-success">Connected</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1">
          <input
            type="text"
            className="input-field"
            placeholder="https://your-instance.atlassian.net or https://jira.yourcompany.com"
            value={instanceUrl}
            onChange={(e) => setInstanceUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={connectionStatus === 'connecting' || connectionStatus === 'connected'}
          />
        </div>

        {connectionStatus === 'connected' ? (
          <button onClick={disconnect} className="btn-secondary" title="Disconnect">
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={connectionStatus === 'connecting' || !instanceUrl.trim()}
            className="btn-primary"
            title="Connect"
          >
            {connectionStatus === 'connecting' ? (
              <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-4.122a4.5 4.5 0 00-6.364-6.364L4.5 6.75" />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Fresh login checkbox */}
      <div className="mt-3 flex items-center gap-2">
        <input
          id="fresh-login"
          type="checkbox"
          checked={freshLogin}
          onChange={(e) => setFreshLogin(e.target.checked)}
          disabled={connectionStatus === 'connected'}
          className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
        />
        <label htmlFor="fresh-login" className="text-sm text-gray-600">
          Fresh login (clear saved session)
        </label>
      </div>

      {/* Cloud info banner */}
      {connectionStatus === 'connected' && instanceType === 'cloud' && (
        <div className="mt-3 p-3 bg-primary-50 border border-primary-200 rounded-lg flex items-start gap-2">
          <svg className="w-5 h-5 text-primary-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
          </svg>
          <p className="text-sm text-primary-700">
            Cloud user management is <strong>organization-wide</strong>. All human users across your Atlassian organization are shown, not just users with access to this specific site.
          </p>
        </div>
      )}

      {/* Export all users */}
      {connectionStatus === 'connected' && (
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={async () => {
              setExporting(true);
              setExportResult(null);
              try {
                const result = await ipcInvoke<{ success: boolean; filePath?: string; userCount?: number; message?: string }>(
                  IPC.EXPORT_ALL_USERS,
                  instanceType
                );
                if (result.success) {
                  setExportResult(`Exported ${result.userCount} users to ${result.filePath}`);
                } else {
                  setExportResult(result.message || 'Export cancelled');
                }
              } catch (err: any) {
                setExportResult(`Export failed: ${err.message}`);
              } finally {
                setExporting(false);
              }
            }}
            disabled={exporting}
            className="btn-secondary"
          >
            {exporting ? (
              <>
                <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Exporting...
              </>
            ) : (
              <>
                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Export All Users
              </>
            )}
          </button>
          {exportResult && (
            <span className={`text-xs ${exportResult.startsWith('Export failed') ? 'text-danger-600' : 'text-success-600'}`}>
              {exportResult}
            </span>
          )}
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="mt-3 p-3 bg-danger-50 border border-danger-200 rounded-lg flex items-start gap-2">
          <svg className="w-5 h-5 text-danger-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <p className="text-sm text-danger-700">{error}</p>
          <button onClick={clearError} className="ml-auto text-danger-500 hover:text-danger-700">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
