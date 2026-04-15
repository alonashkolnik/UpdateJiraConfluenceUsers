import { create } from 'zustand';
import { IPC } from '../../shared/ipc-channels';
import { ipcInvoke } from '../lib/ipc';
import type {
  AtlassianUser,
  UserDetails,
  GroupInfo,
  ApplicationRoleInfo,
  BulkRow,
  BulkError,
  ParseResult,
} from '../../shared/types';

interface UserState {
  mode: 'single' | 'bulk';

  // Single mode
  allUsers: AtlassianUser[];
  usersLoading: boolean;
  searchQuery: string;
  filteredUsers: AtlassianUser[];
  selectedUser: UserDetails | null;
  selectedUserLoading: boolean;

  // Bulk mode
  bulkFilePath: string | null;
  bulkFileName: string | null;
  bulkData: BulkRow[];
  bulkErrors: BulkError[];
  bulkDetectedColumns: Record<string, string>;
  bulkLoading: boolean;
  bulkResolved: boolean;
  skippedRows: Set<number>;

  // Groups (shared)
  allGroups: GroupInfo[];
  groupsLoading: boolean;

  // Application Roles (Cloud only)
  allApplicationRoles: ApplicationRoleInfo[];
  applicationRolesLoading: boolean;

  // Actions
  setMode: (mode: 'single' | 'bulk') => void;
  loadAllUsers: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  selectUser: (identifier: string) => Promise<void>;
  clearSelectedUser: () => void;
  uploadFile: () => Promise<void>;
  resolveUsers: () => Promise<void>;
  toggleSkipRow: (rowIndex: number) => void;
  loadAllGroups: () => Promise<void>;
  loadAllApplicationRoles: () => Promise<void>;
  reset: () => void;
}

export const useUserStore = create<UserState>((set, get) => ({
  mode: 'single',
  allUsers: [],
  usersLoading: false,
  searchQuery: '',
  filteredUsers: [],
  selectedUser: null,
  selectedUserLoading: false,
  bulkFilePath: null,
  bulkFileName: null,
  bulkData: [],
  bulkErrors: [],
  bulkDetectedColumns: {},
  bulkLoading: false,
  bulkResolved: false,
  skippedRows: new Set(),
  allGroups: [],
  groupsLoading: false,
  allApplicationRoles: [],
  applicationRolesLoading: false,

  setMode: (mode) => set({ mode, selectedUser: null, bulkData: [], bulkErrors: [], bulkResolved: false }),

  loadAllUsers: async () => {
    set({ usersLoading: true });
    try {
      const users = await ipcInvoke<AtlassianUser[]>(IPC.LOAD_ALL_USERS);
      set({ allUsers: users, filteredUsers: users, usersLoading: false });
    } catch (err: any) {
      set({ usersLoading: false });
      throw err;
    }
  },

  setSearchQuery: (query: string) => {
    const { allUsers } = get();
    const q = query.toLowerCase();
    const filtered = q
      ? allUsers.filter(
          (u) =>
            u.username.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q) ||
            u.displayName.toLowerCase().includes(q)
        )
      : allUsers;
    set({ searchQuery: query, filteredUsers: filtered });
  },

  selectUser: async (identifier: string) => {
    set({ selectedUserLoading: true });
    try {
      const details = await ipcInvoke<UserDetails>(IPC.GET_USER_DETAILS, identifier);
      set({ selectedUser: details, selectedUserLoading: false });
    } catch (err: any) {
      set({ selectedUserLoading: false });
      throw err;
    }
  },

  clearSelectedUser: () => set({ selectedUser: null }),

  uploadFile: async () => {
    const filePath = await ipcInvoke<string | null>(IPC.OPEN_FILE_DIALOG);
    if (!filePath) return;

    set({ bulkLoading: true, bulkResolved: false, skippedRows: new Set() });
    try {
      const result = await ipcInvoke<ParseResult>(IPC.PARSE_FILE, filePath);
      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      set({
        bulkFilePath: filePath,
        bulkFileName: fileName,
        bulkData: result.rows,
        bulkErrors: result.errors,
        bulkDetectedColumns: result.detectedColumns,
        bulkLoading: false,
      });
    } catch (err: any) {
      set({ bulkLoading: false });
      throw err;
    }
  },

  resolveUsers: async () => {
    const { bulkData } = get();
    set({ bulkLoading: true });
    try {
      const resolved = await ipcInvoke<BulkRow[]>(IPC.RESOLVE_BULK_USERS, bulkData);
      // Add resolve errors to the errors list
      const newErrors: BulkError[] = [];
      for (const row of resolved) {
        if (row.resolveError) {
          newErrors.push({
            rowIndex: row.rowIndex,
            column: 'user',
            message: row.resolveError,
            severity: 'error',
          });
        }
      }
      set((state) => ({
        bulkData: resolved,
        bulkErrors: [...state.bulkErrors, ...newErrors],
        bulkLoading: false,
        bulkResolved: true,
      }));
    } catch (err: any) {
      set({ bulkLoading: false });
      throw err;
    }
  },

  toggleSkipRow: (rowIndex: number) => {
    set((state) => {
      const next = new Set(state.skippedRows);
      if (next.has(rowIndex)) {
        next.delete(rowIndex);
      } else {
        next.add(rowIndex);
      }
      return { skippedRows: next };
    });
  },

  loadAllGroups: async () => {
    set({ groupsLoading: true });
    try {
      const groups = await ipcInvoke<GroupInfo[]>(IPC.GET_ALL_GROUPS);
      set({ allGroups: groups, groupsLoading: false });
    } catch (err: any) {
      set({ groupsLoading: false });
      throw err;
    }
  },

  loadAllApplicationRoles: async () => {
    set({ applicationRolesLoading: true });
    try {
      const roles = await ipcInvoke<ApplicationRoleInfo[]>(IPC.GET_ALL_APPLICATION_ROLES);
      set({ allApplicationRoles: roles, applicationRolesLoading: false });
    } catch (err: any) {
      set({ applicationRolesLoading: false });
      // Don't throw — roles may not be available (DC instances)
    }
  },

  reset: () =>
    set({
      allUsers: [],
      filteredUsers: [],
      searchQuery: '',
      selectedUser: null,
      selectedUserLoading: false,
      allGroups: [],
      bulkFilePath: null,
      bulkFileName: null,
      bulkData: [],
      bulkErrors: [],
      bulkDetectedColumns: {},
      bulkResolved: false,
      skippedRows: new Set(),
    }),
}));
