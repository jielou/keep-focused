const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_SETTINGS = {
  enabled: true,
  sessionWindowMinutes: 15,
  focusDurationMinutes: 30
};

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(["settings", "rules", "usage", "sessionStats", "focus"]);
  const updates = {};

  if (!data.settings || !Number.isFinite(Number(data.settings.focusDurationMinutes))) {
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
        availableAt: nextAvailableTime(rule, now, nextReset)
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
  const dayName = DAY_NAMES[now.getDay()];
  const days = Array.isArray(rule.days) ? rule.days : [];
  if (days.length > 0 && !days.includes(dayName)) return false;
  if (!rule.timeWindow || rule.timeWindow.mode !== "custom") return true;

  const current = now.getHours() * 60 + now.getMinutes();
  const start = minutesFromTime(rule.timeWindow.start);
  const end = minutesFromTime(rule.timeWindow.end);

  if (start === null || end === null || start === end) return true;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

function minutesFromTime(value) {
  if (!/^\d{2}:\d{2}$/.test(value || "")) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nextAvailableTime(rule, now, fallback) {
  if (!rule.timeWindow || rule.timeWindow.mode !== "custom") {
    return fallback.toISOString();
  }

  const end = minutesFromTime(rule.timeWindow.end);
  if (end === null) return fallback.toISOString();

  const current = now.getHours() * 60 + now.getMinutes();
  const endDate = new Date(now);

  if (end <= current) {
    endDate.setDate(endDate.getDate() + 1);
  }

  endDate.setHours(Math.floor(end / 60), end % 60, 0, 0);
  return endDate.toISOString();
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

syncFocusAlarm();
