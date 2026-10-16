/**
 * 讲者视图的跨窗口同步通道。
 *
 * 场景：教师在自己屏幕上开「讲者视图」（幻灯片 + 备注 + 计时），另开一个「观众窗口」投到投影屏，
 * 需要把「当前第几页」实时同步过去 —— 且观众窗口里**不能有任何讲稿**。
 *
 * 为什么不用 `postMessage`：观众窗口是 `window.open` 出来的**独立窗口**（不是 iframe），
 * 刷新一次引用就失效；`BroadcastChannel` 是现成的同源广播，且**不需要安全上下文**
 * （实测本站 HTTP 下 `BroadcastChannel` 可用，而 `getScreenDetails` / `documentPictureInPicture`
 * 这类需要 HTTPS 的 API 全部不可用 —— 所以自动投屏做不到，只能手动把观众窗口拖到投影屏）。
 *
 * 降级：没有 `BroadcastChannel` 的老浏览器走 localStorage + `storage` 事件
 * （`storage` 只在**其它**窗口触发，正好天然互斥）。
 */

export type PresentMessage =
  /** 讲者换页了 */
  | { kind: 'index'; index: number; total: number; from: string }
  /** 观众窗口刚打开，请讲者把当前页发过来 */
  | { kind: 'hello'; from: string };

/**
 * 分配式 Omit：直接对联合类型用 `Omit<Msg, 'from'>` 会把联合**塌成一个**（只剩公共字段），
 * 于是 `send({ kind: 'index', index })` 这种写法会被判成"多了 index 字段"。
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export interface PresentChannel {
  /** 本窗口的实例 id（用于丢弃自己发出的消息） */
  readonly id: string;
  /** 是否走了 localStorage 降级实现 */
  readonly fallback: boolean;
  send: (message: DistributiveOmit<PresentMessage, 'from'>) => void;
  onMessage: (handler: (message: PresentMessage) => void) => () => void;
  close: () => void;
}

const STORAGE_PREFIX = 'nju-lab-present:';

export function createPresentChannel(room: string): PresentChannel {
  const id = `w${Math.random().toString(36).slice(2, 8)}`;
  const listeners = new Set<(message: PresentMessage) => void>();
  const emit = (message: PresentMessage) => {
    if (message.from === id) return; // 自己的消息不处理（本地实现会自触发）
    for (const listener of listeners) listener(message);
  };

  let bc: BroadcastChannel | null = null;
  let onStorage: ((event: StorageEvent) => void) | null = null;

  if (typeof BroadcastChannel === 'function') {
    bc = new BroadcastChannel(`${STORAGE_PREFIX}${room}`);
    bc.onmessage = (event) => {
      const data = event.data as PresentMessage | undefined;
      if (data && typeof data.kind === 'string') emit(data);
    };
  } else {
    // 降级：写一个随机后缀，确保内容每次都不同（相同值不触发 storage 事件）
    onStorage = (event) => {
      if (event.key !== `${STORAGE_PREFIX}${room}` || !event.newValue) return;
      const payload = JSON.parse(event.newValue) as { message: PresentMessage };
      emit(payload.message);
    };
    window.addEventListener('storage', onStorage);
  }

  return {
    id,
    fallback: bc === null,
    send: (message) => {
      const payload: PresentMessage = { ...message, from: id } as PresentMessage;
      if (bc) {
        bc.postMessage(payload);
        return;
      }
      try {
        localStorage.setItem(
          `${STORAGE_PREFIX}${room}`,
          JSON.stringify({ message: payload, nonce: Math.random() }),
        );
      } catch {
        /* 隐私模式下 localStorage 可能抛错：同步失败不影响放映本身 */
      }
    },
    onMessage: (handler) => {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    close: () => {
      listeners.clear();
      bc?.close();
      if (onStorage) window.removeEventListener('storage', onStorage);
    },
  };
}
