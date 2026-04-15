import React from 'react';
import { useAppStore } from './store/app-store';
import { ConnectionPanel } from './components/connection/ConnectionPanel';
import { ConnectionStatus } from './components/connection/ConnectionStatus';
import { UserSelectionPanel } from './components/user-selection/UserSelectionPanel';
import { ActionPanel } from './components/actions/ActionPanel';
import { ExecutionPanel } from './components/execution/ExecutionPanel';
import { useActionStore } from './store/action-store';
import { isElectron } from './lib/ipc';

export default function App() {
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const error = useAppStore((s) => s.error);
  const executionPhase = useActionStore((s) => s.executionPhase);

  // Show friendly message if not running inside Electron
  if (!isElectron()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-8">
        <div className="card max-w-lg w-full text-center">
          <div className="text-warning-500 mb-4">
            <svg className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Electron Required</h2>
          <p className="text-sm text-gray-600 mb-4">
            This application must be run inside Electron. It cannot be used in a regular web browser
            because it needs access to Electron APIs for authentication, file handling, and instance connectivity.
          </p>
          <p className="text-xs text-gray-400">
            Start the app with: <code className="bg-gray-100 px-1.5 py-0.5 rounded">start.bat</code> or <code className="bg-gray-100 px-1.5 py-0.5 rounded">npm run dev</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-1.053M18 8.625a3 3 0 11-6 0 3 3 0 016 0zm-13.5 0a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900">Atlassian User Manager</h1>
          </div>
          {connectionStatus === 'connected' && <ConnectionStatus />}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {/* Step 1: Connection */}
        <ConnectionPanel />

        {/* Step 2: User Selection (after connected) */}
        {connectionStatus === 'connected' && <UserSelectionPanel />}

        {/* Step 3: Actions (after user selected or file uploaded) */}
        {connectionStatus === 'connected' && <ActionPanel />}

        {/* Step 4: Execution (after summary generated) */}
        {connectionStatus === 'connected' && executionPhase !== 'config' && <ExecutionPanel />}
      </main>
    </div>
  );
}
