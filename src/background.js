const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_SETTINGS = {
  enabled: true,
  sessionWindowMinutes: 15
};

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(["settings", "rules", "usage", "sessionStats"]);
  const updates = {};

  if (!data.settings) updates.settings = DEFAULT_SETTINGS;
  if (!Array.isArray(data.rules)) updates.rules = [];
  if (!data.usage) updates.usage = {};
  if (!data.sessionStats) updates.sessionStats = {};

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
});

chrome.webNavigation.onCommitted.addListener(async details => {
  try {
    if (details.frameId !== 0) return;

    const url = safeUrl(details.url);
    if (!url || !["http:", "https:"].includes(url.protocol)) return;

    const decision = await evaluateNavigation(url);
    if (!decision.block) return;

    const blockedUrl = new URL(chrome.runtime.getURL("src/blocked.html"));
    blockedUrl.searchParams.set("domain", decision.domain);
    blockedUrl.searchParams.set("reason", decision.reason);
    blockedUrl.searchParams.set("ruleId", decision.rule.id);
    blockedUrl.searchParams.set("ruleName", decision.rule.domain);

    if (decision.availableAt) {
      blockedUrl.searchParams.set("availableAt", decision.availableAt);
    }

    await chrome.tabs.update(details.tabId, { url: blockedUrl.toString() });
  } catch (error) {
    console.error("[Keep Focused] onCommitted error", error);
  }
});

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
