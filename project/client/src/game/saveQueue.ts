// 存档写入队列：最多 1 inflight；写完若 dirty 则再写最新 payload（coalesce）

export type SavePutFn = (payload: unknown) => Promise<void>;

export interface SaveQueue {
  /** 标记 dirty 并尽量异步写出（失败不抛，由 onError 通知） */
  request(): void;
  /** 强制写到干净；失败抛错（不调用 onError，由调用方处理） */
  flush(): Promise<void>;
  /** 是否仍有未写出或进行中的写入 */
  isBusy(): boolean;
  /** 测试/调试：是否 dirty */
  isDirty(): boolean;
}

export function createSaveQueue(opts: {
  getPayload: () => unknown;
  put: SavePutFn;
  onError?: (err: unknown) => void;
}): SaveQueue {
  let inFlight = false;
  let dirty = false;
  let chain: Promise<void> = Promise.resolve();

  const runOnce = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      while (dirty) {
        dirty = false;
        const payload = opts.getPayload();
        try {
          await opts.put(payload);
        } catch (e) {
          dirty = true;
          throw e;
        }
      }
    } finally {
      inFlight = false;
    }
  };

  return {
    request() {
      dirty = true;
      chain = chain.then(() => runOnce().catch((e) => {
        opts.onError?.(e);
      }));
    },
    async flush() {
      dirty = true;
      let flushErr: unknown = null;
      const p = chain.then(() => runOnce().catch((e) => {
        flushErr = e;
      }));
      chain = p.then(() => undefined);
      await p;
      if (flushErr) throw flushErr;
    },
    isBusy() {
      return inFlight || dirty;
    },
    isDirty() {
      return dirty;
    },
  };
}
