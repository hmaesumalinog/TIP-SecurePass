// One request at a time; pause while hidden/offline and back off on failures.
export function createRefreshScheduler(refresh, options = {}) {
  const doc = options.document || document;
  const win = options.window || window;
  const now = options.now || Date.now;
  const interval = options.interval || 60000;
  let timer,
    stopped = false,
    running = false,
    failures = 0,
    last = now();
  const ready = () => !stopped && !doc.hidden && win.navigator.onLine !== false;
  const cancel = () => win.clearTimeout(timer);
  function plan(delay = interval) {
    cancel();
    if (ready()) timer = win.setTimeout(tick, delay);
  }
  async function tick() {
    if (!ready() || running) return;
    running = true;
    try {
      const result = await refresh(true);
      failures = result === false ? Math.min(failures + 1, 3) : 0;
      last = now();
    } catch {
      failures = Math.min(failures + 1, 3);
    } finally {
      running = false;
      plan(Math.min(interval * 2 ** failures, 300000));
    }
  }
  function wake() {
    cancel();
    if (ready() && !running)
      plan(now() - last >= interval ? 0 : interval - (now() - last));
  }
  const listeners = [
    [doc, "visibilitychange", wake],
    [win, "online", wake],
    [win, "offline", cancel],
    [win, "pagehide", cancel],
    [win, "pageshow", wake],
  ];
  listeners.forEach(([target, event, handler]) =>
    target.addEventListener(event, handler),
  );
  plan();
  return {
    fresh() {
      last = now();
      failures = 0;
      if (!running) plan();
    },
    stop() {
      stopped = true;
      cancel();
      listeners.forEach(([target, event, handler]) =>
        target.removeEventListener(event, handler),
      );
    },
  };
}
