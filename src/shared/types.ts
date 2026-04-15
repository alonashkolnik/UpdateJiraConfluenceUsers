// ─── Instance Types ──────────────────────────────────────────────
export type InstanceType = 'cloud' | 'jira-dc' | 'confluence-dc';

export interface ConnectionResult {
  instanceType: InstanceType;
  baseUrl: string;
  currentUser: CurrentUser;
}

export interface CurrentUser {
  key?: string;
  accountId?: string;
  username: string;
  displayName: string;
  email: string;
  active: boolean;
}

// ─── User Types ──────────────────────────────────────────────────
export interface AtlassianUser {
  key?: string;
  accountId?: string;
  username: string;
  displayName: string;
  email: string;
  active: boolean;
  lastLogin?: string;      // ISO date string or descriptive text
  lastUpdated?: string;    // ISO date string or descriptive text
}

export interface UserDetails extends AtlassianUser {
  groups: string[];
  applicationRoles?: string[];
}

export interface ApplicationRoleInfo {
  key: string;
  name: string;
  userCount?: number;
  availableRoles?: string[];    // e.g. ["product/member", "product/admin"]
  workspaceName?: string;       // e.g. "payroc" — site name for multi-site orgs
  workspaceId?: string;         // Cloud site ID
}

export interface GroupInfo {
  name: string;
  memberCount?: number;
}

// ─── File Parsing Types ──────────────────────────────────────────
export interface BulkRow {
  rowIndex: number;
  userKey?: string;
  userName?: string;
  email: string;
  newUserName?: string;
  newEmail?: string;
  addGroups?: string[];
  removeGroups?: string[];
  addProducts?: string[];
  removeProducts?: string[];
  newStatus?: 'active' | 'inactive';
  // Resolved from the instance
  resolvedUser?: AtlassianUser & { groups?: string[]; applicationRoles?: string[] };
  resolveError?: string;
}

export interface BulkError {
  rowIndex: number;
  column: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ParseResult {
  rows: BulkRow[];
  errors: BulkError[];
  detectedColumns: Record<string, string>; // canonical → actual header name
  totalRows: number;
}

// ─── Action Types ────────────────────────────────────────────────
export type ActionType = 'activate-deactivate' | 'update-groups' | 'update-login' | 'update-product-access';

export interface ChangeLine {
  type: 'activate' | 'deactivate' | 'add-group' | 'remove-group' | 'keep-group' | 'add-role' | 'remove-role' | 'keep-role' | 'update-email' | 'update-username';
  label: string;
  oldValue?: string;
  newValue?: string;
}

export interface SummaryItem {
  rowIndex?: number;
  userIdentifier: string;
  displayName: string;
  fullName?: string;
  username: string;
  email: string;
  lastLogin?: string;
  lastUpdated?: string;
  changes: ChangeLine[];
  warnings?: string[];         // pre-validation warnings (e.g. "Group 'foo' does not exist")
}

export interface SkippedItem {
  rowIndex: number;
  userIdentifier: string;
  displayName: string;
  reason: string;
}

export interface ActionPayload {
  action: ActionType;
  instanceType: InstanceType;
  items: ActionItem[];
  options: {
    removeDisabledFromGroups?: boolean;
    knownGroupNames?: string[];     // groups that exist in the instance — skip operations on unknown groups
  };
}

export interface ActionItem {
  userKey?: string;
  userName?: string;
  email: string;
  accountId?: string;
  displayName?: string;          // full name for result display
  // For activate/deactivate
  newStatus?: 'active' | 'inactive';
  // For groups
  addGroups?: string[];
  removeGroups?: string[];
  wasDisabled?: boolean;         // true if user was disabled before group update — re-disable after if needed
  // For login data
  newUserName?: string;
  newEmail?: string;
  // For product access
  addRoles?: string[];
  removeRoles?: string[];
}

export interface ActionResultItem {
  userIdentifier: string;
  displayName?: string;           // full name for result display
  success: boolean;
  message: string;
  details?: string[];
}

export interface ActionResult {
  totalProcessed: number;
  successCount: number;
  failureCount: number;
  results: ActionResultItem[];
}

// ─── Progress ────────────────────────────────────────────────────
export interface ProgressUpdate {
  current: number;
  total: number;
  currentUser: string;
  status: 'processing' | 'success' | 'error';
  message?: string;
}
