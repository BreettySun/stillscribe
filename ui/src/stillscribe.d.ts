/** Electron preload 注入的桥（纯 Web 模式下不存在）。 */
interface StillscribeBridge {
  engineOrigin: string;
  platform: string;
  revealInFolder: (path: string) => Promise<void>;
  notify: (title: string, body: string) => void;
  refreshCookies: (browser: string) => Promise<{ kept: number }>;
  setAIKey: (baseUrl: string, apiKey: string | null) => Promise<{ persisted: boolean }>;
}

interface Window {
  stillscribe?: StillscribeBridge;
}
