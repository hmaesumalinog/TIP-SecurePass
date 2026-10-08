// Near-real-time administrator updates without a database subscription.
// A tiny change check runs every 15 seconds while someone is using the page
// (60 seconds when idle) and the full view reloads only when something changed.
// Open tabs share their results, so several tabs cost about the same as one.
// A tab announces each check; a small random offset keeps two tabs from
// reaching their timers at the same moment.
// Checks pause while the page is hidden or offline and back off after failures.
export function createLiveUpdates(options) {
  const {
    check,
    refresh,
    fast = 15000,
    slow = 60000,
    jitter = 2000,
    idleAfter = 120000,
    fullEvery = 300000,
    maxDelay = 300000,
    channelName = "securepass-admin-updates",
  } = options;
  const doc = options.document || document;
  const win = options.window || window;
  const now = options.now || Date.now;
  const random = options.random || Math.random;
  const Channel =
    options.BroadcastChannel === undefined
      ? win.BroadcastChannel
      : options.BroadcastChannel;
  let token = null,
    timer,
    running = false,
    stopped = false,
    failures = 0,
    lastCheck = now(),
    lastFull = now(),
    lastActivity = now(),
    lastChange = 0;
  const channel = Channel ? new Channel(channelName) : null;

  const ready = () => !stopped && !doc.hidden && win.navigator.onLine !== false;
  const cancel = () => win.clearTimeout(timer);
  function delay() {
    const active = now() - Math.max(lastActivity, lastChange) < idleAfter;
    const wait = (active ? fast : slow) * 2 ** failures;
    return Math.min(wait + Math.floor(random() * jitter), maxDelay);
  }
  function plan(wait) {
    cancel();
    if (!ready()) return;
    const due = wait ?? Math.max(0, delay() - (now() - lastCheck));
    timer = win.setTimeout(tick, due);
  }
  async function reload() {
    const ok = await refresh(true);
    if (ok === true) lastChange = now();
    return ok;
  }
  async function tick(force = false) {
    if (!ready() || running) return;
    running = true;
    try {
      if (force || token === null || now() - lastFull >= fullEvery) {
        // Time-based values (such as expired invitations) change without a
        // write, so the full view is also refreshed every few minutes. A page
        // whose first load failed keeps retrying the full load instead.
        const ok = await reload();
        failures = ok === false ? Math.min(failures + 1, 4) : 0;
      } else {
        // Claim this check so other open tabs wait for its answer.
        channel?.postMessage({ type: "checking" });
        const latest = await check();
        failures = 0;
        lastCheck = now();
        channel?.postMessage({ type: "token", token: latest });
        // A skipped or failed reload keeps the old token, so the next check
        // tries again.
        if (latest !== token && (await reload()) === false)
          failures = Math.min(failures + 1, 4);
      }
    } catch {
      failures = Math.min(failures + 1, 4);
      lastCheck = now();
    } finally {
      running = false;
      plan();
    }
  }
  function onMessage(event) {
    const message = event.data || {};
    if (message.type === "changed") return plan(0);
    if (message.type === "checking") {
      lastCheck = now();
      return plan();
    }
    if (message.type !== "token") return;
    // Another tab just checked: reuse its answer instead of asking again.
    lastCheck = now();
    if (token !== null && message.token !== token) {
      cancel();
      tick(true);
    } else plan();
  }
  function onActivity() {
    const wasIdle = now() - Math.max(lastActivity, lastChange) >= idleAfter;
    lastActivity = now();
    if (wasIdle) plan();
  }
  function wake() {
    if (ready() && !running) plan();
  }
  const listeners = [
    [doc, "visibilitychange", wake],
    [doc, "pointerdown", onActivity],
    [doc, "keydown", onActivity],
    [win, "online", wake],
    [win, "offline", cancel],
    [win, "pagehide", cancel],
    [win, "pageshow", wake],
  ];
  listeners.forEach(([target, type, handler]) =>
    target.addEventListener(type, handler, { passive: true }),
  );
  channel?.addEventListener("message", onMessage);
  plan();
  return {
    // Called after every successful full load with that response's token.
    seen(value) {
      if (typeof value === "string") token = value;
      lastFull = lastCheck = now();
      failures = 0;
      if (!running) plan();
    },
    // Called after this tab changes data, so other tabs refresh at once.
    changed() {
      lastChange = now();
      channel?.postMessage({ type: "changed" });
    },
    stop() {
      stopped = true;
      cancel();
      listeners.forEach(([target, type, handler]) =>
        target.removeEventListener(type, handler),
      );
      channel?.removeEventListener("message", onMessage);
      channel?.close();
    },
  };
}
