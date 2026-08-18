const DEFAULT_SETTINGS = {
  enabled: true,
  sessionWindowMinutes: 15,
  focusDurationMinutes: 30
};

const enabled = document.querySelector("#enabled");
const statusText = document.querySelector("#statusText");
const ruleCount = document.querySelector("#ruleCount");
const sessionWindow = document.querySelector("#sessionWindow");
const openOptions = document.querySelector("#openOptions");
const focusCurrent = document.querySelector("#focusCurrent");
const exitFocus = document.querySelector("#exitFocus");
const focusPanel = document.querySelector("#focusPanel");
const focusDomain = document.querySelector("#focusDomain");
const focusDuration = document.querySelector("#focusDuration");
const focusDurationField = document.querySelector("#focusDurationField");
const focusRemaining = document.querySelector("#focusRemaining");

let countdownTimer = null;

init();

async function init() {
  const data = await chrome.storage.local.get(["settings", "rules", "focus"]);
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  const rules = Array.isArray(data.rules) ? data.rules : [];

  enabled.checked = settings.enabled;
  statusText.textContent = settings.enabled ? "Blocking is on" : "Blocking is off";
  ruleCount.textContent = `${rules.length} ${rules.length === 1 ? "rule" : "rules"}`;
  sessionWindow.textContent = `${settings.sessionWindowMinutes} min sessions`;
  focusDuration.value = sanitizeFocusDuration(settings.focusDurationMinutes);
  renderFocus(data.focus || null);
}

enabled.addEventListener("change", async () => {
  const data = await chrome.storage.local.get(["settings"]);
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}), enabled: enabled.checked };
  await chrome.storage.local.set({ settings });
  statusText.textContent = settings.enabled ? "Blocking is on" : "Blocking is off";
});

openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

focusDuration.addEventListener("change", async () => {
  const duration = sanitizeFocusDuration(focusDuration.value);
  focusDuration.value = duration;
  const data = await chrome.storage.local.get(["settings"]);
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}), focusDurationMinutes: duration };
  await chrome.storage.local.set({ settings });
});

focusCurrent.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  const url = safeUrl(tab.url);
  const domain = url ? url.hostname.replace(/^www\./, "") : (tab.title || "Current page");
  const durationMinutes = sanitizeFocusDuration(focusDuration.value);
  const startedAt = Date.now();
  const data = await chrome.storage.local.get(["settings"]);
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}), focusDurationMinutes: durationMinutes };

  const focus = {
    active: true,
    tabId: tab.id,
    windowId: tab.windowId,
    domain,
    url: tab.url || "",
    startedAt,
    endsAt: startedAt + durationMinutes * 60 * 1000
  };

  await chrome.storage.local.set({ settings, focus });
  renderFocus(focus);
});

exitFocus.addEventListener("click", async () => {
  await chrome.storage.local.set({ focus: { active: false } });
  renderFocus(null);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.focus) {
    renderFocus(changes.focus.newValue || null);
  }
  if (changes.settings) {
    const settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
    focusDuration.value = sanitizeFocusDuration(settings.focusDurationMinutes);
  }
});

function renderFocus(focus) {
  const isActive = focus && focus.active && focus.tabId && (!focus.endsAt || Number(focus.endsAt) > Date.now());
  focusPanel.classList.toggle("hidden", !isActive);
  focusCurrent.classList.toggle("hidden", isActive);
  focusDurationField.classList.toggle("hidden", isActive);

  clearInterval(countdownTimer);
  countdownTimer = null;

  if (isActive) {
    focusDomain.textContent = focus.domain || "Current page";
    updateCountdown(focus);
    countdownTimer = window.setInterval(() => updateCountdown(focus), 1000);
  }
}

function updateCountdown(focus) {
  const remainingMs = Math.max(0, Number(focus.endsAt) - Date.now());
  if (!Number.isFinite(remainingMs)) {
    focusRemaining.textContent = "Focus mode is active";
    return;
  }

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  focusRemaining.textContent = `${minutes}:${seconds} remaining`;
}

function sanitizeFocusDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration)) return DEFAULT_SETTINGS.focusDurationMinutes;
  return Math.max(1, Math.min(480, duration));
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
