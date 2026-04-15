import { create } from 'zustand';
import { IPC } from '../../shared/ipc-channels';
import type { InstanceType, CurrentUser, ConnectionResult } from '../../shared/types';
import { ipcInvoke } from '../lib/ipc';
import { useUserStore } from './user-store';
import { useActionStore } from './action-store';

interface AppState {
  // Connection
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  instanceType: InstanceType | null;
  instanceUrl: string;
  currentUser: CurrentUser | null;
  error: string | null;

  // Actions
  setInstanceUrl: (url: string) => void;
  connect: (freshLogin: boolean) => Promise<void>;
  disconnect: () => void;
  clearError: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  connectionStatus: 'disconnected',
  instanceType: null,
  instanceUrl: '',
  currentUser: null,
  error: null,

  setInstanceUrl: (url: string) => set({ instanceUrl: url }),

  connect: async (freshLogin: boolean) => {
    const { instanceUrl } = get();
    if (!instanceUrl.trim()) {
      set({ error: 'Please enter an instance URL' });
      return;
    }

    // Clear previous instance data before connecting to new one
    useUserStore.getState().reset();
    useActionStore.getState().reset();

    set({ connectionStatus: 'connecting', error: null });

    try {
      const result = await ipcInvoke<ConnectionResult>(
        IPC.CONNECT,
        instanceUrl,
        freshLogin
      );
      set({
        connectionStatus: 'connected',
        instanceType: result.instanceType,
        currentUser: result.currentUser,
        instanceUrl: result.baseUrl,
        error: null,
      });
      // Load users and groups immediately after successful connection
      useUserStore.getState().loadAllUsers().catch(console.error);
      useUserStore.getState().loadAllGroups().catch(console.error);
      // Load application roles for Cloud instances
      if (result.instanceType === 'cloud') {
        useUserStore.getState().loadAllApplicationRoles().catch(console.error);
      }
    } catch (err: any) {
      set({
        connectionStatus: 'error',
        error: err.message || 'Connection failed',
      });
    }
  },

  disconnect: () => {
    ipcInvoke(IPC.DISCONNECT).catch(console.error);
    // Clear all stores
    useUserStore.getState().reset();
    useActionStore.getState().reset();
    set({
      connectionStatus: 'disconnected',
      instanceType: null,
      currentUser: null,
      error: null,
    });
  },

  clearError: () => set({ error: null }),
}));
