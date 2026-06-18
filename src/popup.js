const DEFAULT_SETTINGS = {
  enabled: true,
  sessionWindowMinutes: 15
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

init();

async function init() {
  const data = await chrome.storage.local.get(["settings", "rules", "focus"]);
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  const rules = Array.isArray(data.rules) ? data.rules : [];

  enabled.checked = settings.enabled;
  statusText.textContent = settings.enabled ? "Blocking is on" : "Blocking is off";
  ruleCount.textContent = `${rules.length} ${rules.length === 1 ? "rule" : "rules"}`;
  sessionWindow.textContent = `${settings.sessionWindowMinutes} min sessions`;
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

focusCurrent.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  const url = safeUrl(tab.url);
  const domain = url ? url.hostname.replace(/^www\./, "") : (tab.title || "Current page");

  const focus = {
    active: true,
    tabId: tab.id,
    windowId: tab.windowId,
    domain,
    url: tab.url || "",
    startedAt: Date.now()
  };

  await chrome.storage.local.set({ focus });
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
});

function renderFocus(focus) {
  const isActive = focus && focus.active && focus.tabId;
  focusPanel.classList.toggle("hidden", !isActive);
  focusCurrent.classList.toggle("hidden", isActive);

  if (isActive) {
    focusDomain.textContent = focus.domain || "Current page";
  }
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
