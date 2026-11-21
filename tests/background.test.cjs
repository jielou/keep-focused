const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function worker({ rules = [], settings = {}, tabs = [], windows = [{ id: 1, type: 'normal' }], now = '2026-11-23T08:00:00' } = {}) {
  const data = { rules, settings, usage: {}, sessionStats: {} };
  const updates = [];
  const removed = [];
  const notifications = [];
  const alarms = new Map();
  const listeners = {};
  const event = name => ({ addListener: fn => (listeners[name] ||= []).push(fn) });
  const chrome = {
    runtime: { onInstalled: event('installed'), onStartup: event('startup'), getURL: p => `chrome-extension://test/${p}` },
    storage: { local: { get: async () => structuredClone(data), set: async value => Object.assign(data, value) }, onChanged: event('changed') },
    alarms: { onAlarm: event('alarm'), create: async (name, value) => alarms.set(name, value), clear: async name => alarms.delete(name), get: async name => alarms.get(name) },
    tabs: { query: async () => tabs, get: async id => tabs.find(tab => tab.id === id), update: async (id, value) => updates.push({ id, ...value }), remove: async id => { removed.push(id); const index = tabs.findIndex(tab => tab.id === id); if (index >= 0) tabs.splice(index, 1); }, onActivated: event('activated'), onRemoved: event('removed'), onCreated: event('created') },
    windows: { onFocusChanged: event('windowFocus'), get: async id => windows.find(window => window.id === id), getAll: async () => windows.filter(window => window.type === 'normal').map(window => ({ ...window, tabs: tabs.filter(tab => tab.windowId === window.id) })) },
    notifications: { create: async (id, value) => notifications.push({ id, ...value }) },
    webNavigation: { onCommitted: event('navigation') }
  };
  const fixed = new Date(now).getTime();
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed; }
  }
  const context = vm.createContext({ chrome, Date: Clock, URL, console: { log() {}, error() {} }, setTimeout });
  context.importScripts = path => vm.runInContext(fs.readFileSync(`src/${path}`, 'utf8'), context);
  vm.runInContext(fs.readFileSync('src/background.js', 'utf8'), context);
  await vm.runInContext('scheduleQueue', context);
  return { context, data, updates, removed, notifications, alarms, listeners };
}
const block = { id: 'work', domain: 'reddit.com', dailyLimit: 0, days: ['Mon'], timeWindow: { mode: 'custom', start: '08:00', end: '18:00' } };

test('startup blocks already-open matching tabs without consuming sessions', async () => {
  const w = await worker({ rules: [block], tabs: [{ id: 1, url: 'https://www.reddit.com/r/test' }, { id: 2, url: 'https://other.com' }] });
  assert.equal(w.updates.length, 1);
  const redirected = new URL(w.updates[0].url);
  assert.equal(redirected.searchParams.get('reason'), 'schedule');
  assert.equal(redirected.searchParams.get('availableAt'), new Date('2026-11-23T18:00:00').toISOString());
  assert.deepEqual(w.data.usage, {});
  assert.ok(w.alarms.has('keep-focused-schedule'));
});

test('before the window schedules an exact start boundary and leaves tabs open', async () => {
  const w = await worker({ rules: [block], now: '2026-11-23T07:59:00', tabs: [{ id: 1, url: 'https://reddit.com' }] });
  assert.equal(w.updates.length, 0);
  assert.equal(w.alarms.get('keep-focused-schedule').when, new Date('2026-11-23T08:00:00').getTime());
});

test('disabled rules and master switch stop enforcement and clear schedule alarms', async () => {
  for (const input of [{ rules: [{ ...block, enabled: false }] }, { rules: [block], settings: { enabled: false } }]) {
    const w = await worker({ ...input, tabs: [{ id: 1, url: 'https://reddit.com' }] });
    assert.equal(w.updates.length, 0);
    assert.equal(w.alarms.size, 0);
  }
});

test('full block wins over a session allowance, with exact-domain matching respected', async () => {
  const w = await worker({ rules: [{ ...block, id: 'allow', dailyLimit: 5 }, { ...block, includeSubdomains: false }] });
  assert.equal((await vm.runInContext('evaluateNavigation(new URL("https://reddit.com"))', w.context)).reason, 'schedule');
  assert.equal((await vm.runInContext('evaluateNavigation(new URL("https://forum.reddit.com"))', w.context)).block, false);
  assert.equal(w.data.usage['2026-11-23'].allow.count, 1);
});

test('schedule alarms and rule edits trigger enforcement without counting sessions', async () => {
  const tabs = [];
  const w = await worker({ rules: [block], tabs });
  tabs.push({ id: 3, url: 'https://reddit.com' });
  for (const fn of w.listeners.alarm) await fn({ name: 'keep-focused-schedule' });
  assert.equal(w.updates.length, 1);
  tabs.push({ id: 4, url: 'https://reddit.com' });
  for (const fn of w.listeners.changed) await fn({ rules: {} }, 'local');
  await vm.runInContext('scheduleQueue', w.context);
  assert.ok(w.updates.some(tab => tab.id === 4));
  assert.deepEqual(w.data.usage, {});
});


test('tab limit allows the last available tab, then closes excess tabs', async () => {
  const tabs = [{ id: 1, windowId: 1 }, { id: 2, windowId: 1 }];
  const w = await worker({ tabs, settings: { maxOpenTabs: 2 } });
  await vm.runInContext('enforceTabLimit({ id: 2, windowId: 1 })', w.context);
  assert.deepEqual(w.removed, []);
  assert.match(w.notifications[0].message, /reached your tab limit/);
  tabs.push({ id: 3, windowId: 1 });
  await vm.runInContext('enforceTabLimit({ id: 3, windowId: 1 })', w.context);
  assert.deepEqual(w.removed, [3]);
  assert.equal(tabs.length, 2);
});

test('unset tab limits, incognito tabs and popup windows are exempt', async () => {
  for (const input of [
    { settings: {}, tab: { id: 2, windowId: 1 } },
    { settings: { maxOpenTabs: 1 }, tab: { id: 2, windowId: 1, incognito: true } },
    { settings: { maxOpenTabs: 1 }, tab: { id: 2, windowId: 1 }, windows: [{ id: 1, type: 'popup' }] }
  ]) {
    const w = await worker({ ...input, tabs: [{ id: 1, windowId: 1 }, input.tab] });
    w.context.newTab = input.tab;
    await vm.runInContext('enforceTabLimit(newTab)', w.context);
    assert.deepEqual(w.removed, []);
  }
});

test('rapid tab creations are processed in order without exceeding the limit', async () => {
  const tabs = [1, 2, 3, 4].map(id => ({ id, windowId: 1 }));
  const w = await worker({ tabs, settings: { maxOpenTabs: 2 } });
  for (const tab of tabs.slice(2)) for (const fn of w.listeners.created) fn(tab);
  await vm.runInContext('tabLimitQueue', w.context);
  assert.deepEqual(w.removed, [3, 4]);
  assert.equal(tabs.length, 2);
});
