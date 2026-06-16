/** Electron preload 注入的桥（纯 Web 模式下不存在）。 */
interface DiggoBridge {
  engineOrigin: string;
  platform: string;
  revealInFolder: (path: string) => Promise<void>;
  notify: (title: string, body: string) => void;
}

interface Window {
  diggo?: DiggoBridge;
}
