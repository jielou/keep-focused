importScripts("schedule.js");
const DEFAULT_SETTINGS = {
  enabled: true,
  sessionWindowMinutes: 15,
  focusDurationMinutes: 30,
  maxOpenTabs: null
};

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(["settings", "rules", "usage", "sessionStats", "focus"]);
  const updates = {};

  if (
    !data.settings
    || !Number.isFinite(Number(data.settings.focusDurationMinutes))
    || !Object.prototype.hasOwnProperty.call(data.settings, "maxOpenTabs")
  ) {
    updates.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  }
  if (!Array.isArray(data.rules)) updates.rules = [];
  if (!data.usage) updates.usage = {};
  if (!data.sessionStats) updates.sessionStats = {};
  if (!data.focus) updates.focus = { active: false };

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
});

chrome.webNavigation.onCommitted.addListener(async details => {
  try {
    if (details.frameId !== 0) return;

    const url = safeUrl(details.url);
    if (!url || !["http:", "https:"].includes(url.protocol)) return;

    const focusDecision = await evaluateFocusNavigation(details.tabId, url);
    if (focusDecision.block) {
      await redirectToBlocked(details.tabId, {
        domain: focusDecision.domain,
        reason: "focus",
        rule: null,
        availableAt: null
      });
      return;
    }

    const decision = await evaluateNavigation(url);
    if (!decision.block) return;

    await redirectToBlocked(details.tabId, decision);
  } catch (error) {
    console.error("[Keep Focused] onCommitted error", error);
  }
});

async function redirectToBlocked(tabId, decision) {
  const blockedUrl = new URL(chrome.runtime.getURL("src/blocked.html"));
  blockedUrl.searchParams.set("domain", decision.domain);
  blockedUrl.searchParams.set("reason", decision.reason);

  if (decision.rule) {
    blockedUrl.searchParams.set("ruleId", decision.rule.id);
    blockedUrl.searchParams.set("ruleName", decision.rule.domain);
  }

  if (decision.availableAt) {
    blockedUrl.searchParams.set("availableAt", decision.availableAt);
  }

  await chrome.tabs.update(tabId, { url: blockedUrl.toString() });
}

async function evaluateNavigation(url) {
  const { settings, rules, usage, sessionStats } = await chrome.storage.local.get([
    "settings",
    "rules",
    "usage",
    "sessionStats"
  ]);
  const mergedSettings = { ...DEFAULT_SETTINGS, ...(settings || {}) };

  if (!mergedSettings.enabled) return { block: false };

  const hostname = normalizeHostname(url.hostname);
  const now = new Date();
  const activeRules = (rules || [])
    .filter(rule => rule.enabled !== false)
    .filter(rule => domainMatches(rule, hostname))
    .filter(rule => ruleAppliesNow(rule, now));

  if (activeRules.length === 0) return { block: false };

  const todayKey = dateKey(now);
  const nextReset = new Date(now);
  nextReset.setHours(24, 0, 0, 0);

  for (const rule of activeRules) {
    if (Number(rule.dailyLimit) === 0) {
      return {
        block: true,
        domain: hostname,
        reason: "schedule",
        rule,
        availableAt: RuleSchedule.availableAt((rules || []).filter(candidate =>
          candidate.enabled !== false && Number(candidate.dailyLimit) === 0
          && domainMatches(candidate, hostname)), now)
      };
    }
  }

  const limitRule = activeRules.find(rule => Number.isFinite(Number(rule.dailyLimit)));
  if (!limitRule) return { block: false };

  const dailyLimit = Math.max(0, Number(limitRule.dailyLimit));
  const usageRoot = usage || {};
  const ruleUsage = {
    count: 0,
    lastActivityAt: 0,
    ...(usageRoot[todayKey]?.[limitRule.id] || {})
  };
  const nowMs = now.getTime();
  const sessionWindowMs = Math.max(1, Number(mergedSettings.sessionWindowMinutes)) * 60 * 1000;
  const isSameSession = nowMs - Number(ruleUsage.lastActivityAt || 0) <= sessionWindowMs;

  if (!isSameSession && ruleUsage.count >= dailyLimit) {
    return {
      block: true,
      domain: hostname,
      reason: "limit",
      rule: limitRule,
      availableAt: nextReset.toISOString()
    };
  }

  if (!isSameSession) {
    ruleUsage.count += 1;
  }

  ruleUsage.lastActivityAt = nowMs;

  const statsRoot = sessionStats || {};
  const ruleStats = {
    count: 0,
    domain: limitRule.domain,
    updatedAt: nowMs,
    ...(statsRoot[todayKey]?.[limitRule.id] || {})
  };

  if (!isSameSession) {
    ruleStats.count += 1;
  }

  ruleStats.domain = limitRule.domain;
  ruleStats.updatedAt = nowMs;

  await chrome.storage.local.set({
    usage: {
      ...usageRoot,
      [todayKey]: {
        ...(usageRoot[todayKey] || {}),
        [limitRule.id]: ruleUsage
      }
    },
    sessionStats: pruneSessionStats({
      ...statsRoot,
      [todayKey]: {
        ...(statsRoot[todayKey] || {}),
        [limitRule.id]: ruleStats
      }
    }, now)
  });

  return { block: false };
}

function pruneSessionStats(stats, now) {
  const oldest = new Date(now);
  oldest.setDate(oldest.getDate() - 89);
  const oldestKey = dateKey(oldest);

  return Object.fromEntries(
    Object.entries(stats || {}).filter(([key]) => key >= oldestKey)
  );
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function domainMatches(rule, hostname) {
  const domain = normalizeHostname(rule.domain || "");
  if (!domain) return false;
  if (hostname === domain) return true;
  return rule.includeSubdomains !== false && hostname.endsWith(`.${domain}`);
}

function ruleAppliesNow(rule, now) {
  return RuleSchedule.applies(rule, now);
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const FOCUS_END_ALARM_NAME = "keep-focused-end";

async function getFocusState({ clearExpired = true } = {}) {
  const data = await chrome.storage.local.get(["focus"]);
  const focus = data.focus || { active: false };

  if (focus.active && Number.isFinite(Number(focus.endsAt)) && Number(focus.endsAt) <= Date.now()) {
    if (clearExpired) {
      await chrome.storage.local.set({ focus: { active: false } });
      return { active: false };
    }
  }

  return focus;
}

async function syncFocusAlarm() {
  const focus = await getFocusState();
  const endsAt = Number(focus.endsAt);

  if (focus.active && focus.tabId && Number.isFinite(endsAt) && endsAt > Date.now()) {
    await chrome.alarms.create(FOCUS_END_ALARM_NAME, { when: endsAt });
    console.log("[Keep Focused] focus-end alarm scheduled", new Date(endsAt).toISOString());
  } else {
    await chrome.alarms.clear(FOCUS_END_ALARM_NAME).catch(() => {});
    console.log("[Keep Focused] focus-end alarm cleared");
  }
}

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.focus) {
    await syncFocusAlarm();
  }
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === FOCUS_END_ALARM_NAME) {
    await expireFocusFromAlarm();
  }
});

async function expireFocusFromAlarm() {
  const focus = await getFocusState({ clearExpired: false });
  if (!focus.active || !Number.isFinite(Number(focus.endsAt)) || Number(focus.endsAt) > Date.now()) {
    return;
  }

  await chrome.storage.local.set({ focus: { active: false } });
  await chrome.notifications.create("focus-complete", {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/keep_focused_icon_128.png"),
    title: "Keep Focused",
    message: "Focus time is complete. You can switch pages again."
  });
}

async function evaluateFocusNavigation(tabId, url) {
  const focus = await getFocusState();
  if (!focus.active || !focus.tabId) return { block: false };

  if (tabId === focus.tabId) return { block: false };

  const hostname = normalizeHostname(url.hostname);
  return {
    block: true,
    domain: hostname,
    reason: "focus",
    rule: null,
    availableAt: null
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function activateTabWithRetry(tabId, windowId, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (windowId) {
        await chrome.windows.update(windowId, { focused: true });
      }
      await chrome.tabs.update(tabId, { active: true });
      return;
    } catch (error) {
      const isTransient = error?.message?.includes("cannot be edited right now");
      if (isTransient && attempt < maxRetries) {
        console.log("[Keep Focused] tab edit locked, retrying...", attempt);
        await sleep(80 * attempt);
      } else {
        throw error;
      }
    }
  }
}

async function notifyFocusReturn(focus) {
  const title = "Keep Focused";
  const message = `Focus mode is on. Switched back to ${focus.domain || "focused page"}.`;

  try {
    if (typeof chrome.action?.openPopup === "function") {
      await chrome.action.openPopup();
      console.log("[Keep Focused] popup opened");
      return;
    }
  } catch (error) {
    console.log("[Keep Focused] openPopup failed, falling back to notification", error.message);
  }

  try {
    await chrome.notifications.create("focus-return", {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/keep_focused_icon_128.png"),
      title,
      message
    });
  } catch (error) {
    console.error("[Keep Focused] notification failed", error);
  }
}

async function returnToFocusedTab(source) {
  const focus = await getFocusState();
  console.log("[Keep Focused] returnToFocusedTab called", { source, focus });
  if (!focus.active || !focus.tabId) return;

  try {
    const tab = await chrome.tabs.get(focus.tabId).catch(() => null);
    if (!tab) {
      console.log("[Keep Focused] focused tab no longer exists, clearing focus");
      await chrome.storage.local.set({ focus: { active: false } });
      return;
    }

    const needsWindowFocus = tab.windowId !== focus.windowId;
    console.log("[Keep Focused] switching back to focused tab", focus.tabId, "window", tab.windowId);
    await activateTabWithRetry(focus.tabId, needsWindowFocus ? tab.windowId : null);

    if (source === "tabs.onActivated" || source === "windows.onFocusChanged") {
      await notifyFocusReturn(focus);
    }
  } catch (error) {
    console.error("[Keep Focused] returnToFocusedTab error", error);
  }
}

chrome.tabs.onActivated.addListener(async activeInfo => {
  console.log("[Keep Focused] tabs.onActivated", activeInfo);
  const focus = await getFocusState();
  console.log("[Keep Focused] focus state", focus);
  if (!focus.active || !focus.tabId) return;

  if (activeInfo.tabId !== focus.tabId) {
    await returnToFocusedTab("tabs.onActivated");
  }
});

chrome.windows.onFocusChanged.addListener(async windowId => {
  console.log("[Keep Focused] windows.onFocusChanged", windowId);
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;

  const focus = await getFocusState();
  if (!focus.active || !focus.windowId) return;

  if (windowId !== focus.windowId) {
    await returnToFocusedTab("windows.onFocusChanged");
  }
});

chrome.tabs.onRemoved.addListener(async tabId => {
  const focus = await getFocusState();
  if (focus.active && focus.tabId === tabId) {
    await chrome.storage.local.set({ focus: { active: false } });
  }
});

let tabLimitQueue = Promise.resolve();
let tabLimitNotificationId = 0;

chrome.tabs.onCreated.addListener(tab => {
  // Handle tab creations one at a time so rapidly opening several tabs cannot bypass the limit.
  tabLimitQueue = tabLimitQueue
    .then(() => enforceTabLimit(tab))
    .catch(error => console.error("[Keep Focused] tab-limit error", error));
});

function sanitizeMaxOpenTabs(value) {
  if (value === null || value === undefined || value === "") return null;

  const limit = Number(value);
  if (!Number.isFinite(limit)) return null;
  return Math.max(1, Math.min(500, Math.floor(limit)));
}

async function enforceTabLimit(newTab) {
  if (!newTab.id || newTab.incognito) return;

  const window = await chrome.windows.get(newTab.windowId).catch(() => null);
  if (!window || window.type !== "normal" || window.incognito) return;

  const { settings } = await chrome.storage.local.get(["settings"]);
  const maxOpenTabs = sanitizeMaxOpenTabs(settings?.maxOpenTabs);
  if (maxOpenTabs === null) return;

  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const openTabs = windows.flatMap(browserWindow =>
    (browserWindow.tabs || []).filter(tab => !tab.incognito)
  );

  if (!openTabs.some(tab => tab.id === newTab.id)) return;

  if (openTabs.length === maxOpenTabs) {
    await notifyTabLimit(
      `You have reached your tab limit (${maxOpenTabs}). Opening another tab will be blocked.`
    );
    return;
  }

  if (openTabs.length < maxOpenTabs) return;

  try {
    await chrome.tabs.remove(newTab.id);
  } catch {
    return;
  }

  await notifyTabLimit(`Tab limit reached (${maxOpenTabs}). Close a tab before opening another one.`);
}

async function notifyTabLimit(message) {
  await chrome.notifications.create(`tab-limit-${Date.now()}-${++tabLimitNotificationId}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/keep_focused_icon_128.png"),
    title: "Keep Focused",
    message
  });
}

syncFocusAlarm();

// Exact boundaries handle normal operation; the watchdog catches clock/timezone changes
// and missed alarms after sleep. Scanning tabs never consumes checking sessions.
const SCHEDULE_ALARM = "keep-focused-schedule";
const SCHEDULE_WATCHDOG = "keep-focused-schedule-watchdog";
let scheduleQueue = Promise.resolve();

function refreshSchedule() {
  scheduleQueue = scheduleQueue.then(async () => {
    const { rules = [], settings } = await chrome.storage.local.get(["rules", "settings"]);
    const blocks = settings?.enabled === false ? [] : rules.filter(rule =>
      rule.enabled !== false && Number(rule.dailyLimit) === 0
    );
    await chrome.alarms.clear(SCHEDULE_ALARM);
    if (!blocks.length) {
      await chrome.alarms.clear(SCHEDULE_WATCHDOG);
      return;
    }
    if (!await chrome.alarms.get(SCHEDULE_WATCHDOG)) {
      await chrome.alarms.create(SCHEDULE_WATCHDOG, { periodInMinutes: 1 });
    }
    const now = new Date();
    const next = RuleSchedule.boundaries(blocks, now)[0];
    if (next) await chrome.alarms.create(SCHEDULE_ALARM, { when: next });
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      const url = safeUrl(tab.pendingUrl || tab.url);
      if (!url || !["http:", "https:"].includes(url.protocol)) continue;
      const hostname = normalizeHostname(url.hostname);
      const matching = blocks.filter(rule => domainMatches(rule, hostname));
      const rule = matching.find(rule => ruleAppliesNow(rule, now));
      if (!rule) continue;
      try {
        // Avoid replacing a page the user navigated away from during this scan.
        const current = await chrome.tabs.get(tab.id);
        if ((current.pendingUrl || current.url) !== (tab.pendingUrl || tab.url)) continue;
        await redirectToBlocked(tab.id, {
          domain: hostname, reason: "schedule", rule,
          availableAt: RuleSchedule.availableAt(matching, now)
        });
      } catch {
        // A tab may close while it is being checked.
      }
    }
  }).catch(error => console.error("[Keep Focused] schedule error", error));
  return scheduleQueue;
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && (changes.rules || changes.settings)) refreshSchedule();
});
chrome.alarms.onAlarm.addListener(alarm => {
  if ([SCHEDULE_ALARM, SCHEDULE_WATCHDOG].includes(alarm.name)) return refreshSchedule();
});
chrome.runtime.onStartup.addListener(refreshSchedule);
refreshSchedule();
