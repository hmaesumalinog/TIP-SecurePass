import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveUpdates } from '../public/assets/js/live-updates.mjs';

// A controllable page, clock and cross-tab channel.
function harness() {
  const doc = new EventTarget(), win = new EventTarget();
  doc.hidden = false; win.navigator = { onLine: true };
  const clock = { time: 0 };
  const timer = { task: null, delay: null };
  win.setTimeout = (fn, ms) => { timer.task = fn; timer.delay = ms; return 1; };
  win.clearTimeout = () => { timer.task = null; timer.delay = null; };
  const channels = [];
  class Channel extends EventTarget {
    constructor() { super(); channels.push(this); this.sent = []; }
    postMessage(data) {
      this.sent.push(data);
      for (const other of channels) if (other !== this) other.dispatchEvent(Object.assign(new Event('message'), { data }));
    }
    close() {}
  }
  return { doc, win, clock, timer, Channel, channels };
}

test('checks quickly while active, slows when idle, and reloads only on change', async () => {
  const h = harness();
  let token = 'a', checks = 0, reloads = 0, live;
  live = createLiveUpdates({ document: h.doc, window: h.win, now: () => h.clock.time, random: () => 0, BroadcastChannel: h.Channel,
    check: async () => { checks++; return token; },
    refresh: async () => { reloads++; live.seen(token); return true; } });
  live.seen('a');
  assert.equal(h.timer.delay, 15000, 'Active pages check every 15 seconds');
  h.clock.time = 15000; await h.timer.task();
  assert.equal(checks, 1); assert.equal(reloads, 0, 'No reload when nothing changed');
  token = 'b'; h.clock.time = 30000; await h.timer.task();
  assert.equal(reloads, 1, 'A changed token reloads the view');
  h.clock.time = 200000; await h.timer.task();
  assert.equal(h.timer.delay, 60000, 'Idle pages check every 60 seconds');
  h.clock.time = 245000;
  h.doc.dispatchEvent(new Event('pointerdown'));
  assert.equal(h.timer.delay, 0, 'Activity after idling checks right away when the last check is older than 15 seconds');
  live.stop();
});

test('pauses while hidden or offline and backs off after failures', async () => {
  const h = harness();
  let fail = true;
  const live = createLiveUpdates({ document: h.doc, window: h.win, now: () => h.clock.time, random: () => 0, BroadcastChannel: null,
    check: async () => { if (fail) throw new Error('offline'); return 'a'; }, refresh: async () => true });
  live.seen('a');
  h.clock.time = 15000; await h.timer.task();
  assert.equal(h.timer.delay, 30000, 'One failure doubles the wait');
  h.clock.time = 45000; await h.timer.task();
  assert.equal(h.timer.delay, 60000);
  h.doc.hidden = true; h.doc.dispatchEvent(new Event('visibilitychange'));
  h.win.dispatchEvent(new Event('offline'));
  assert.equal(h.timer.task, null, 'No checks while hidden or offline');
  h.doc.hidden = false; fail = false; h.doc.dispatchEvent(new Event('visibilitychange'));
  assert.ok(h.timer.task, 'Checks resume when visible');
  live.stop(); assert.equal(h.timer.task, null);
});

test('open tabs share results and a change in one tab refreshes the others', async () => {
  const h = harness();
  let token = 'a';
  const counts = { first: 0, second: 0, checks: 0 };
  const make = (name) => {
    const live = createLiveUpdates({ document: h.doc, window: h.win, now: () => h.clock.time, random: () => 0, BroadcastChannel: h.Channel,
      check: async () => { counts.checks++; return token; },
      refresh: async () => { counts[name]++; live.seen(token); return true; } });
    live.seen('a');
    return live;
  };
  const first = make('first'), second = make('second');
  token = 'b'; h.clock.time = 15000;
  await h.timer.task();
  await new Promise(setImmediate);
  assert.equal(counts.checks, 1, 'Only one tab asked the server');
  assert.equal(counts.first + counts.second, 2, 'Both tabs reloaded the changed view');
  first.changed();
  assert.equal(h.channels[1].sent.length + h.channels[0].sent.length >= 2, true);
  first.stop(); second.stop();
});

test('a skipped reload keeps the old token so the next check retries it', async () => {
  const h = harness();
  let reloads = 0, accept = false, live;
  live = createLiveUpdates({ document: h.doc, window: h.win, now: () => h.clock.time, random: () => 0, BroadcastChannel: null,
    check: async () => 'b',
    refresh: async () => { reloads++; if (!accept) return undefined; live.seen('b'); return true; } });
  live.seen('a');
  h.clock.time = 15000; await h.timer.task();
  accept = true; h.clock.time = 30000; await h.timer.task();
  assert.equal(reloads, 2);
  h.clock.time = 45000; await h.timer.task();
  assert.equal(reloads, 2, 'No further reloads once the change was shown');
  live.stop();
});

test('a tab that sees another tab start a check waits for its answer', async () => {
  const h = harness();
  let checks = 0;
  const make = () => createLiveUpdates({ document: h.doc, window: h.win, now: () => h.clock.time, random: () => 0,
    BroadcastChannel: h.Channel, check: async () => { checks++; return 'a'; }, refresh: async () => true });
  const leader = make(); leader.seen('a');
  const follower = make(); follower.seen('a');
  // Both were due at 15 seconds. The leader announces its check first.
  h.clock.time = 15000;
  h.channels[0].postMessage({ type: 'checking' });
  assert.equal(h.timer.delay, 15000, 'The follower waits a full interval instead of checking now');
  leader.stop(); follower.stop();
  assert.equal(checks, 0);
});
