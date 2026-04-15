import { create } from 'zustand';
import { IPC } from '../../shared/ipc-channels';
import { ipcInvoke, ipcOn } from '../lib/ipc';
import type {
  ActionType,
  ActionPayload,
  ActionResult,
  ActionItem,
  SummaryItem,
  SkippedItem,
  ProgressUpdate,
} from '../../shared/types';

interface ActionState {
  selectedAction: ActionType | null;

  // Activate/Deactivate options
  removeDisabledFromGroups: boolean;

  // Group updates (single user mode)
  groupsToAdd: string[];
  groupsToRemove: string[];

  // Product access (single user mode, Cloud only)
  rolesToAdd: string[];
  rolesToRemove: string[];

  // Login data (single user mode)
  newUsername: string;
  newEmail: string;

  // Execution flow
  summary: SummaryItem[];
  skippedItems: SkippedItem[];
  executionPhase: 'config' | 'reviewing' | 'executing' | 'complete';
  progress: ProgressUpdate | null;
  result: ActionResult | null;
  error: string | null;

  // Actions
  selectAction: (action: ActionType | null) => void;
  setRemoveDisabledFromGroups: (val: boolean) => void;
  setGroupsToAdd: (groups: string[]) => void;
  setGroupsToRemove: (groups: string[]) => void;
  setRolesToAdd: (roles: string[]) => void;
  setRolesToRemove: (roles: string[]) => void;
  setNewUsername: (val: string) => void;
  setNewEmail: (val: string) => void;
  setSummary: (summary: SummaryItem[], skippedItems?: SkippedItem[]) => void;
  setExecutionPhase: (phase: 'config' | 'reviewing' | 'executing' | 'complete') => void;
  execute: (payload: ActionPayload) => Promise<void>;
  reset: () => void;
}

export const useActionStore = create<ActionState>((set) => ({
  selectedAction: null,
  removeDisabledFromGroups: false,
  groupsToAdd: [],
  groupsToRemove: [],
  rolesToAdd: [],
  rolesToRemove: [],
  newUsername: '',
  newEmail: '',
  summary: [],
  skippedItems: [],
  executionPhase: 'config',
  progress: null,
  result: null,
  error: null,

  selectAction: (action) =>
    set({
      selectedAction: action,
      executionPhase: 'config',
      summary: [],
      skippedItems: [],
      result: null,
      error: null,
      groupsToAdd: [],
      groupsToRemove: [],
      rolesToAdd: [],
      rolesToRemove: [],
      newUsername: '',
      newEmail: '',
      removeDisabledFromGroups: false,
    }),

  setRemoveDisabledFromGroups: (val) => set({ removeDisabledFromGroups: val }),
  setGroupsToAdd: (groups) => set({ groupsToAdd: groups }),
  setGroupsToRemove: (groups) => set({ groupsToRemove: groups }),
  setRolesToAdd: (roles) => set({ rolesToAdd: roles }),
  setRolesToRemove: (roles) => set({ rolesToRemove: roles }),
  setNewUsername: (val) => set({ newUsername: val }),
  setNewEmail: (val) => set({ newEmail: val }),
  setSummary: (summary, skippedItems) => set({ summary, skippedItems: skippedItems || [] }),
  setExecutionPhase: (phase) => set({ executionPhase: phase }),

  execute: async (payload: ActionPayload) => {
    set({ executionPhase: 'executing', error: null, progress: null });

    // Listen for progress updates
    const unsub = ipcOn(IPC.ACTION_PROGRESS, (data: unknown) => {
      set({ progress: data as ProgressUpdate });
    });

    try {
      const result = await ipcInvoke<ActionResult>(IPC.EXECUTE_ACTION, payload);
      set({ result, executionPhase: 'complete' });
    } catch (err: any) {
      set({ error: err.message || 'Action failed', executionPhase: 'config' });
    } finally {
      unsub();
    }
  },

  reset: () =>
    set({
      selectedAction: null,
      removeDisabledFromGroups: false,
      groupsToAdd: [],
      groupsToRemove: [],
      rolesToAdd: [],
      rolesToRemove: [],
      newUsername: '',
      newEmail: '',
      summary: [],
      skippedItems: [],
      executionPhase: 'config',
      progress: null,
      result: null,
      error: null,
    }),
}));
