import React, { useState } from 'react';
import { useUserStore } from '../../store/user-store';
import { useAppStore } from '../../store/app-store';
import { BulkDataTable } from './BulkDataTable';

export function BulkFileUpload() {
  const {
    bulkFileName,
    bulkData,
    bulkErrors,
    bulkDetectedColumns,
    bulkLoading,
    bulkResolved,
    uploadFile,
    resolveUsers,
    allGroups,
    allApplicationRoles,
  } = useUserStore();
  const instanceType = useAppStore((s) => s.instanceType);
  const isCloud = instanceType === 'cloud';

  const [showGroups, setShowGroups] = useState(false);
  const [showProducts, setShowProducts] = useState(false);

  const fileErrors = bulkErrors.filter((e) => e.rowIndex === 0);
  const rowErrors = bulkErrors.filter((e) => e.rowIndex > 0);

  return (
    <div>
      {/* File format guidelines */}
      <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
        <h4 className="font-semibold mb-2">File Format Guide</h4>
        <p className="mb-2 text-blue-700">
          Upload a <strong>.xlsx</strong> or <strong>.csv</strong> file with a header row. The tool will auto-detect columns by name.
        </p>
        <div className="space-y-1.5 text-xs text-blue-800">
          <div>
            <span className="font-semibold">Required (to identify users):</span>{' '}
            <code className="bg-blue-100 px-1 rounded">Email</code> or{' '}
            <code className="bg-blue-100 px-1 rounded">UserName</code> or{' '}
            <code className="bg-blue-100 px-1 rounded">UserKey</code>
          </div>
          <div>
            <span className="font-semibold">Activate / Deactivate:</span>{' '}
            <code className="bg-blue-100 px-1 rounded">NewStatus</code>{' '}
            <span className="text-blue-600">(values: active, inactive, enable, disable, true, false)</span>
          </div>
          <div>
            <span className="font-semibold">Update Groups:</span>{' '}
            <code className="bg-blue-100 px-1 rounded">AddGroups</code> and/or{' '}
            <code className="bg-blue-100 px-1 rounded">RemoveGroups</code>{' '}
            <span className="text-blue-600">(comma-separated group names)</span>
            {allGroups.length > 0 && (
              <>
                {' — '}
                <button
                  onClick={() => setShowGroups(!showGroups)}
                  className="text-blue-600 underline hover:text-blue-800"
                >
                  {showGroups ? 'hide' : 'show'} {allGroups.length} available groups
                </button>
              </>
            )}
          </div>
          {showGroups && allGroups.length > 0 && (
            <div className="ml-4 p-2 bg-blue-100 rounded max-h-32 overflow-auto">
              <div className="flex flex-wrap gap-1">
                {allGroups.map((g) => (
                  <span key={g.name} className="bg-white px-1.5 py-0.5 rounded text-[11px] text-blue-800 border border-blue-200">
                    {g.name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {!isCloud && (
            <div>
              <span className="font-semibold">Update Login Data (DC only):</span>{' '}
              <code className="bg-blue-100 px-1 rounded">NewEmail</code>{' '}
              and optionally <code className="bg-blue-100 px-1 rounded">NewUserName</code>
            </div>
          )}
          {isCloud && (
            <>
              <div>
                <span className="font-semibold">Update Product Access (Cloud only):</span>{' '}
                <code className="bg-blue-100 px-1 rounded">AddProduct</code> and/or{' '}
                <code className="bg-blue-100 px-1 rounded">RemoveProduct</code>{' '}
                <span className="text-blue-600">(comma-separated; use <code>ProductName|role</code> for specific role, e.g. <code>Jira|product/admin</code> or <code>Statuspage|product/member</code>)</span>
                {allApplicationRoles.length > 0 && (
                  <>
                    {' — '}
                    <button
                      onClick={() => setShowProducts(!showProducts)}
                      className="text-blue-600 underline hover:text-blue-800"
                    >
                      {showProducts ? 'hide' : 'show'} {allApplicationRoles.length} available products
                    </button>
                  </>
                )}
              </div>
              {showProducts && allApplicationRoles.length > 0 && (
                <div className="ml-4 p-2 bg-blue-100 rounded max-h-48 overflow-auto space-y-1.5">
                  {allApplicationRoles.map((r) => (
                    <div key={`${r.key}:${r.workspaceId || ''}`}>
                      <div className="text-[11px] font-semibold text-blue-900 mb-0.5">{r.name}</div>
                      <div className="flex flex-wrap gap-1">
                        {r.availableRoles && r.availableRoles.length > 0 ? (
                          r.availableRoles.map((role) => {
                            const shortRole = role.includes('/') ? role.split('/').pop()! : role;
                            return (
                              <span key={`${r.key}|${role}`} className="bg-white px-1.5 py-0.5 rounded text-[10px] text-blue-700 border border-blue-200">
                                {r.name}/{shortRole}
                              </span>
                            );
                          })
                        ) : (
                          <span className="bg-white px-1.5 py-0.5 rounded text-[10px] text-blue-700 border border-blue-200">
                            {r.name}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <p className="mt-2 text-[11px] text-blue-500">
          Column names are flexible — e.g. "email_address", "Email", "e-mail" all work. Only include columns relevant to the action you want to perform.
        </p>
      </div>

      {/* Upload area */}
      <div className="flex items-center gap-3">
        <button onClick={uploadFile} disabled={bulkLoading} className="btn-secondary">
          <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          {bulkFileName ? 'Upload Different File' : 'Upload File'}
        </button>

        {bulkFileName && (
          <div className="flex items-center gap-2 text-sm">
            <svg className="w-4 h-4 text-success-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-gray-700 font-medium">{bulkFileName}</span>
            <span className="text-gray-400">({bulkData.length} rows)</span>
          </div>
        )}

        {bulkLoading && (
          <svg className="w-5 h-5 animate-spin text-primary-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
      </div>

      {/* Detected columns */}
      {Object.keys(bulkDetectedColumns).length > 0 && (
        <div className="mt-3 p-3 bg-primary-50 border border-primary-200 rounded-lg">
          <h4 className="text-xs font-medium text-primary-700 uppercase tracking-wide mb-1">Detected Columns</h4>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(bulkDetectedColumns).map(([canonical, actual]) => (
              <span key={canonical} className="badge-info">
                {canonical}: "{actual}"
              </span>
            ))}
          </div>
        </div>
      )}

      {/* File-level errors */}
      {fileErrors.length > 0 && (
        <div className="mt-3 p-3 bg-danger-50 border border-danger-200 rounded-lg">
          <h4 className="text-xs font-medium text-danger-700 uppercase tracking-wide mb-1">File Errors</h4>
          {fileErrors.map((err, i) => (
            <p key={i} className="text-sm text-danger-700">{err.message}</p>
          ))}
        </div>
      )}

      {/* Resolve users button */}
      {bulkData.length > 0 && !bulkResolved && (
        <div className="mt-3">
          <button onClick={resolveUsers} disabled={bulkLoading} className="btn-primary">
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            Resolve Users in Instance
          </button>
          <p className="text-xs text-gray-500 mt-1">
            This will look up each user in the file against the instance to verify they exist.
          </p>
        </div>
      )}

      {/* Data table */}
      {bulkData.length > 0 && <BulkDataTable />}
    </div>
  );
}
