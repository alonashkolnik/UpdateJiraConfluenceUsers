import React from 'react';
import { useAppStore } from '../../store/app-store';

const TYPE_LABELS: Record<string, string> = {
  cloud: 'Atlassian Cloud',
  'jira-dc': 'Jira Data Center',
  'confluence-dc': 'Confluence Data Center',
};

export function ConnectionStatus() {
  const { instanceType, currentUser, instanceUrl } = useAppStore();

  if (!instanceType || !currentUser) return null;

  // Derive site name from URL (e.g. "https://payroc.atlassian.net/" → "payroc")
  let siteName = '';
  try {
    const host = new URL(instanceUrl).hostname; // e.g. "payroc.atlassian.net"
    siteName = host.replace('.atlassian.net', '').replace(/\.[^.]+\.[^.]+$/, '');
  } catch {
    siteName = instanceUrl;
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="badge-info">{TYPE_LABELS[instanceType] || instanceType}</span>
        {siteName && (
          <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {siteName}
          </span>
        )}
      </div>
      <div className="text-gray-500">|</div>
      <div className="flex items-center gap-1.5">
        <div className="w-2 h-2 bg-success-500 rounded-full" />
        <span className="text-gray-700 font-medium">{currentUser.displayName}</span>
        <span className="text-gray-400">({currentUser.email || currentUser.username})</span>
      </div>
    </div>
  );
}
