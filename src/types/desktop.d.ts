export {};

declare global {
  interface Window {
    snipaiDesktop?: {
      filePath: (file: File) => string;
      reportUiReady?: (screen: string) => void;
      invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
      on: (event: string, callback: (payload: unknown) => void) => () => void;
      mediaUrl: (path: string) => string;
      openDialog: (options: { title?: string; multiple?: boolean; directory?: boolean; filters?: { name: string; extensions: string[] }[] }) => Promise<string | string[] | null>;
      pickVideo: () => Promise<string | null>;
      pickImage: () => Promise<string | null>;
      openPath: (target: string) => Promise<string>;
      openUrl: (url: string) => Promise<void>;
      runtimeInfo: () => Promise<{ platform: string; arch: string; userData: string }>;
    };
  }
}
