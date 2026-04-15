import React from 'react';
import { useUserStore } from '../../store/user-store';

export function BulkDataTable() {
  const { bulkData, bulkErrors, skippedRows, toggleSkipRow } = useUserStore();

  const getRowErrors = (rowIndex: number) =>
    bulkErrors.filter((e) => e.rowIndex === rowIndex);

  return (
    <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
      <div className="max-h-80 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-10">Skip</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-10">#</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">User</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Changes</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {bulkData.map((row) => {
              const errors = getRowErrors(row.rowIndex);
              const hasError = errors.some((e) => e.severity === 'error');
              const hasWarning = errors.some((e) => e.severity === 'warning');
              const isSkipped = skippedRows.has(row.rowIndex);

              return (
                <tr
                  key={row.rowIndex}
                  className={`${
                    isSkipped
                      ? 'bg-gray-50 opacity-50'
                      : hasError
                      ? 'bg-danger-50 border-l-4 border-l-danger-500'
                      : hasWarning
                      ? 'bg-warning-50 border-l-4 border-l-warning-500'
                      : row.resolvedUser
                      ? 'bg-white'
                      : 'bg-white'
                  }`}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={isSkipped}
                      onChange={() => toggleSkipRow(row.rowIndex)}
                      className="h-3.5 w-3.5 rounded border-gray-300 text-primary-600"
                      title={isSkipped ? 'Include this row' : 'Skip this row'}
                    />
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-400">{row.rowIndex}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900">
                      {row.resolvedUser?.displayName || row.userName || row.userKey || '—'}
                    </div>
                    {row.resolvedUser && (
                      <div className="text-xs text-gray-400">{row.resolvedUser.username}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{row.email || '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {row.newStatus && (
                        <span className={row.newStatus === 'active' ? 'badge-success' : 'badge-danger'}>
                          → {row.newStatus}
                        </span>
                      )}
                      {row.newEmail && (
                        <span className="badge-info">email → {row.newEmail}</span>
                      )}
                      {row.newUserName && (
                        <span className="badge-info">user → {row.newUserName}</span>
                      )}
                      {row.addGroups && row.addGroups.length > 0 && (
                        <span className="badge-success">+{row.addGroups.length} groups</span>
                      )}
                      {row.removeGroups && row.removeGroups.length > 0 && (
                        <span className="badge-danger">-{row.removeGroups.length} groups</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {errors.length > 0 ? (
                      <div>
                        {errors.map((err, i) => (
                          <div
                            key={i}
                            className={`text-xs ${
                              err.severity === 'error' ? 'text-danger-600' : 'text-warning-600'
                            }`}
                          >
                            {err.message}
                          </div>
                        ))}
                      </div>
                    ) : row.resolvedUser ? (
                      <span className="badge-success">Resolved</span>
                    ) : row.resolveError ? (
                      <span className="badge-danger">Not found</span>
                    ) : (
                      <span className="text-xs text-gray-400">Pending</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
