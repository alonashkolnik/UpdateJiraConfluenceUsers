import React from 'react';
import { useUserStore } from '../../store/user-store';
import { useAppStore } from '../../store/app-store';

function formatDate(value: string): string {
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return value;
  }
}

export function SingleUserSearch() {
  const {
    allUsers,
    usersLoading,
    searchQuery,
    setSearchQuery,
    filteredUsers,
    selectedUser,
    selectedUserLoading,
    selectUser,
    clearSelectedUser,
  } = useUserStore();
  const instanceType = useAppStore((s) => s.instanceType);

  return (
    <div>
      {/* Search */}
      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          type="text"
          className="input-field pl-10"
          placeholder={usersLoading ? 'Loading users...' : `Search ${allUsers.length} users by username, email, or display name...`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          disabled={usersLoading}
        />
        {usersLoading && (
          <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
      </div>

      {/* User list (show when searching and no user selected) */}
      {searchQuery && !selectedUser && (
        <div className="mt-2 max-h-60 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
          {filteredUsers.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-500">No users found</div>
          ) : (
            filteredUsers.slice(0, 50).map((user) => (
              <button
                key={user.key || user.accountId || user.username}
                onClick={() => selectUser(user.key || user.accountId || user.email || user.username)}
                className="w-full px-4 py-2.5 text-left hover:bg-gray-50 flex items-center justify-between group transition-colors"
              >
                <div>
                  <div className="text-sm font-medium text-gray-900">{user.displayName}</div>
                  <div className="text-xs text-gray-500">
                    {user.username} {user.email && `· ${user.email}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={user.active ? 'badge-success' : 'badge-danger'}>
                    {user.active ? 'Active' : 'Disabled'}
                  </span>
                  <svg className="w-4 h-4 text-gray-300 group-hover:text-primary-500 transition-colors" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </div>
              </button>
            ))
          )}
          {filteredUsers.length > 50 && (
            <div className="px-4 py-2 text-xs text-gray-400 bg-gray-50">
              Showing 50 of {filteredUsers.length} results. Refine your search to see more.
            </div>
          )}
        </div>
      )}

      {/* Selected user card */}
      {selectedUserLoading && (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/3 mb-2" />
          <div className="h-3 bg-gray-200 rounded w-1/2" />
        </div>
      )}

      {selectedUser && (
        <div className="mt-4 p-4 bg-white border border-gray-200 rounded-lg">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="font-semibold text-gray-900">{selectedUser.displayName}</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                <span className="text-gray-400">User:</span> {selectedUser.username}
              </p>
              <p className="text-sm text-gray-500 mt-0.5">
                <span className="text-gray-400">Email:</span> {selectedUser.email || <span className="italic text-gray-400">not available</span>}
              </p>
              {selectedUser.key && (
                <p className="text-xs text-gray-400 mt-0.5">Key: {selectedUser.key}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${selectedUser.active ? 'bg-success-100 text-success-700 border border-success-300' : 'bg-danger-100 text-danger-700 border border-danger-300'}`}>
                {selectedUser.active ? 'Active' : 'Disabled'}
              </span>
              <button onClick={clearSelectedUser} className="text-gray-400 hover:text-gray-600" title="Clear selection">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Activity info */}
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
            {selectedUser.lastLogin && (
              <span>Last login: <span className="text-gray-700">{formatDate(selectedUser.lastLogin)}</span></span>
            )}
            {selectedUser.lastUpdated && (
              <span>Last updated: <span className="text-gray-700">{formatDate(selectedUser.lastUpdated)}</span></span>
            )}
            {!selectedUser.lastLogin && !selectedUser.lastUpdated && (
              <span className="text-gray-400 italic">Login/update dates not available from this instance</span>
            )}
          </div>

          {/* Groups */}
          <div className="mt-3">
            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Groups ({selectedUser.groups.length})</h4>
            {selectedUser.groups.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No groups assigned</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {selectedUser.groups.map((g) => (
                  <span key={g} className="badge bg-gray-100 text-gray-700">{g}</span>
                ))}
              </div>
            )}
          </div>

          {/* Application Roles / Product Access (Cloud only) */}
          {instanceType === 'cloud' && selectedUser.applicationRoles && (
            <div className="mt-3">
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5">Product Access</h4>
              {selectedUser.applicationRoles.length === 0 ? (
                <p className="text-sm text-gray-400 italic">No product access assigned</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {(() => {
                    // Group roles by product: "Confluence (Member, Admin)"
                    const groups: Record<string, string[]> = {};
                    for (const r of selectedUser.applicationRoles) {
                      const display = r.replace(/\s*\[[^\]]*\]\s*$/, '');
                      const match = display.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
                      const product = match ? match[1].trim() : display;
                      const role = match ? match[2].trim() : '';
                      if (!groups[product]) groups[product] = [];
                      if (role) groups[product].push(role);
                    }
                    return Object.entries(groups).map(([product, roles]) => (
                      <span key={product} className="badge bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {product}{roles.length > 0 ? ` (${roles.join(', ')})` : ''}
                      </span>
                    ));
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
