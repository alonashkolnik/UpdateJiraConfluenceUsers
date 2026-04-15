/**
 * Safe IPC wrapper that checks for electronAPI availability and logs errors.
 */
export async function ipcInvoke<T = any>(channel: string, ...args: unknown[]): Promise<T> {
  if (!window.electronAPI) {
    const msg = `electronAPI not available — app must run inside Electron. Channel: ${channel}`;
    console.error(`[IPC] ${msg}`);
    throw new Error(msg);
  }

  console.log(`[IPC] → ${channel}`, args.length > 0 ? args : '');
  try {
    const result = await window.electronAPI.invoke<T>(channel, ...args);
    console.log(`[IPC] ✓ ${channel}`);
    return result;
  } catch (err: any) {
    console.error(`[IPC] ✗ ${channel}: ${err.message}`);
    throw err;
  }
}

export function ipcOn(channel: string, callback: (...args: unknown[]) => void): () => void {
  if (!window.electronAPI) {
    console.error(`[IPC] electronAPI not available — cannot listen to: ${channel}`);
    return () => {};
  }
  return window.electronAPI.on(channel, callback);
}

export function isElectron(): boolean {
  return !!window.electronAPI;
}
