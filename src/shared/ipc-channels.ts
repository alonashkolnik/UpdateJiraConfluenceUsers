export const IPC = {
  // Connection
  CONNECT: 'connection:connect',
  DISCONNECT: 'connection:disconnect',
  GET_CONNECTION_STATUS: 'connection:status',

  // Users
  SEARCH_USERS: 'users:search',
  GET_USER_DETAILS: 'users:details',
  LOAD_ALL_USERS: 'users:load-all',
  RESOLVE_BULK_USERS: 'users:resolve-bulk',

  // Groups
  GET_ALL_GROUPS: 'groups:all',
  GET_USER_GROUPS: 'groups:for-user',

  // Application Roles / Product Access
  GET_ALL_APPLICATION_ROLES: 'roles:all',

  // File
  OPEN_FILE_DIALOG: 'file:open-dialog',
  PARSE_FILE: 'file:parse',

  // Export
  EXPORT_ALL_USERS: 'users:export-all',
  EXPORT_BULK_SUMMARY: 'export:bulk-summary',

  // Actions
  EXECUTE_ACTION: 'action:execute',
  GENERATE_SUMMARY: 'action:generate-summary',

  // Progress (main → renderer event)
  ACTION_PROGRESS: 'action:progress',
} as const;
