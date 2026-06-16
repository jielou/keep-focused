const DEFAULT_SETTINGS = {
  enabled: true,
  sessionWindowMinutes: 15
};

const enabled = document.querySelector("#enabled");
const statusText = document.querySelector("#statusText");
const ruleCount = document.querySelector("#ruleCount");
const sessionWindow = document.querySelector("#sessionWindow");
const openOptions = document.querySelector("#openOptions");

init();

async function init() {
  const data = await chrome.storage.local.get(["settings", "rules"]);
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  const rules = Array.isArray(data.rules) ? data.rules : [];

  enabled.checked = settings.enabled;
  statusText.textContent = settings.enabled ? "Blocking is on" : "Blocking is off";
  ruleCount.textContent = `${rules.length} ${rules.length === 1 ? "rule" : "rules"}`;
  sessionWindow.textContent = `${settings.sessionWindowMinutes} min sessions`;
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
