export {};

declare global {
  interface Window {
    electronAPI: {
      invoke: <T = any>(channel: string, ...args: unknown[]) => Promise<T>;
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
    };
  }
}
