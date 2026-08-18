const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DEFAULT_SETTINGS = {
  enabled: true,
  sessionWindowMinutes: 15,
  focusDurationMinutes: 30
};

const PALETTE = [
  { bg: "#6366f1", letter: "#fff" },
  { bg: "#8b5cf6", letter: "#fff" },
  { bg: "#ec4899", letter: "#fff" },
  { bg: "#f43f5e", letter: "#fff" },
  { bg: "#f97316", letter: "#fff" },
  { bg: "#14b8a6", letter: "#fff" },
  { bg: "#06b6d4", letter: "#fff" },
  { bg: "#3b82f6", letter: "#fff" },
  { bg: "#10b981", letter: "#fff" },
  { bg: "#84cc16", letter: "#fff" }
];

const state = {
  editingId: null,
  rules: [],
  settings: DEFAULT_SETTINGS,
  usage: {},
  sessionStats: {}
};

const form = document.querySelector("#ruleForm");
const domainInput = document.querySelector("#domainInput");
const limitInput = document.querySelector("#limitInput");
const includeSubdomainsInput = document.querySelector("#includeSubdomainsInput");
const masterEnabled = document.querySelector("#masterEnabled");
const sessionWindowInput = document.querySelector("#sessionWindowInput");
const focusDurationInput = document.querySelector("#focusDurationInput");
const rulesList = document.querySelector("#rulesList");
const activeRulesList = document.querySelector("#activeRulesList");
const saveRule = document.querySelector("#saveRule");
const cancelEdit = document.querySelector("#cancelEdit");
const customTimes = document.querySelector("#customTimes");
const resetUsage = document.querySelector("#resetUsage");
const startTime = document.querySelector("#startTime");
const endTime = document.querySelector("#endTime");
const statsSummary = document.querySelector("#statsSummary");
const statsChart = document.querySelector("#statsChart");
const statsRange = document.querySelector("#statsRange");
const permissionBanner = document.querySelector("#permissionBanner");
const grantPermission = document.querySelector("#grantPermission");
const tabPanels = document.querySelectorAll(".tab-panel");
const navItems = document.querySelectorAll(".nav-item");
const addRuleFromRules = document.querySelector("#addRuleFromRules");
const cancelAdd = document.querySelector("#cancelAdd");

init();
checkPermissions();
setupSidebar();
setupFaviconFallback();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  let rulesChanged = false;
  let statsChanged = false;

  if (changes.rules) {
    state.rules = Array.isArray(changes.rules.newValue) ? changes.rules.newValue : [];
    rulesChanged = true;
    statsChanged = true;
  }

  if (changes.usage) {
    state.usage = changes.usage.newValue || {};
    rulesChanged = true;
  }

  if (changes.sessionStats) {
    state.sessionStats = changes.sessionStats.newValue || {};
    statsChanged = true;
  }

  if (changes.settings) {
    state.settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
    masterEnabled.checked = state.settings.enabled;
    sessionWindowInput.value = state.settings.sessionWindowMinutes;
    focusDurationInput.value = state.settings.focusDurationMinutes;
  }

  if (rulesChanged) {
    renderActiveRules();
    renderRules();
  }
  if (statsChanged) renderStats();
});

async function init() {
  const data = await chrome.storage.local.get(["rules", "settings", "usage", "sessionStats"]);
  state.rules = Array.isArray(data.rules) ? data.rules : [];
  state.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  state.usage = data.usage || {};
  state.sessionStats = data.sessionStats || {};
  masterEnabled.checked = state.settings.enabled;
  sessionWindowInput.value = state.settings.sessionWindowMinutes;
  focusDurationInput.value = state.settings.focusDurationMinutes;
  renderActiveRules();
  renderRules();
  renderStats();
}

form.addEventListener("submit", async event => {
  event.preventDefault();

  const domain = normalizeDomain(domainInput.value);
  if (!domain) {
    domainInput.setCustomValidity("Enter a valid domain.");
    domainInput.reportValidity();
    return;
  }
  domainInput.setCustomValidity("");

  const selectedDays = [...form.querySelectorAll("input[name='days']:checked")]
    .map(input => input.value);

  const timeMode = form.querySelector("input[name='timeMode']:checked").value;
  const rule = {
    id: state.editingId || crypto.randomUUID(),
    domain,
    includeSubdomains: includeSubdomainsInput.checked,
    days: selectedDays,
    timeWindow: timeMode === "custom"
      ? { mode: "custom", start: startTime.value, end: endTime.value }
      : { mode: "allDay" },
    dailyLimit: Math.max(0, Number(limitInput.value)),
    enabled: true,
    updatedAt: Date.now()
  };

  if (state.editingId) {
    state.rules = state.rules.map(existing => existing.id === state.editingId ? rule : existing);
  } else {
    state.rules = [rule, ...state.rules];
  }

  await chrome.storage.local.set({ rules: state.rules });
  resetForm();
  renderActiveRules();
  renderRules();
  renderStats();
  setActiveNav("settings");
  showPanel("allRulesPanel");
});

masterEnabled.addEventListener("change", async () => {
  state.settings = { ...state.settings, enabled: masterEnabled.checked };
  await chrome.storage.local.set({ settings: state.settings });
});

sessionWindowInput.addEventListener("change", async () => {
  const minutes = Math.max(1, Math.min(240, Number(sessionWindowInput.value) || 15));
  sessionWindowInput.value = minutes;
  state.settings = { ...state.settings, sessionWindowMinutes: minutes };
  await chrome.storage.local.set({ settings: state.settings });
});

focusDurationInput.addEventListener("change", async () => {
  const inputValue = Number(focusDurationInput.value);
  const minutes = Number.isFinite(inputValue)
    ? Math.max(1, Math.min(480, inputValue))
    : DEFAULT_SETTINGS.focusDurationMinutes;
  focusDurationInput.value = minutes;
  state.settings = { ...state.settings, focusDurationMinutes: minutes };
  await chrome.storage.local.set({ settings: state.settings });
});

cancelEdit.addEventListener("click", () => {
  resetForm();
  setActiveNav("settings");
  showPanel("allRulesPanel");
});

resetUsage.addEventListener("click", async () => {
  const today = localDateKey(new Date());
  state.usage = { ...state.usage, [today]: {} };
  await chrome.storage.local.set({ usage: state.usage });
  renderActiveRules();
  renderRules();
  renderStats();
});

form.addEventListener("change", event => {
  if (event.target.name === "timeMode") {
    customTimes.classList.toggle("hidden", event.target.value !== "custom");
  }
});

rulesList.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const rule = state.rules.find(item => item.id === button.dataset.id);
  if (!rule) return;

  if (button.dataset.action === "edit") {
    populateForm(rule);
    showPanel("addRulesPanel");
    return;
  }

  if (button.dataset.action === "toggle") {
    state.rules = state.rules.map(item => item.id === rule.id
      ? { ...item, enabled: item.enabled === false }
      : item);
    await chrome.storage.local.set({ rules: state.rules });
    renderActiveRules();
    renderRules();
    renderStats();
    return;
  }

  if (button.dataset.action === "delete") {
    state.rules = state.rules.filter(item => item.id !== rule.id);
    await chrome.storage.local.set({ rules: state.rules });
    renderActiveRules();
    renderRules();
    renderStats();
  }
});

function renderActiveRules() {
  if (!activeRulesList) return;
  activeRulesList.replaceChildren();

  const now = new Date();
  const activeRules = state.rules.filter(rule =>
    rule.enabled !== false && ruleAppliesNow(rule, now)
  );

  if (activeRules.length === 0) {
    activeRulesList.innerHTML = `
      <div class="empty">
        <h3>No active rules today</h3>
        <p>None of your rules apply to the current day or time. Go to Settings to check or edit them.</p>
      </div>
    `;
    return;
  }

  const today = localDateKey(now);

  for (const rule of activeRules) {
    const usage = state.usage[today]?.[rule.id]?.count || 0;
    const limit = Number(rule.dailyLimit);
    const timeText = rule.timeWindow?.mode === "custom"
      ? `${rule.timeWindow.start}-${rule.timeWindow.end}`
      : "all day";

    const card = document.createElement("article");
    card.className = "rule-card active-rule";
    card.innerHTML = `
      ${siteIcon(rule.domain)}
      <div class="rule-main">
        <h3>${escapeHtml(rule.domain)}</h3>
        <div class="rule-meta">
          <span class="pill">${escapeHtml(timeText)}</span>
          <span class="pill">${rule.includeSubdomains === false ? "exact domain" : "subdomains included"}</span>
        </div>
      </div>
      <div class="rule-usage">
        ${renderUsage(usage, limit)}
        <div class="rule-status">
          <span class="status-dot"></span>
          Active
        </div>
      </div>
    `;
    activeRulesList.append(card);
  }
}

function renderUsage(usage, limit) {
  if (limit === 0) {
    return `
      <div class="usage-value">
        <span class="usage-count usage-blocked" style="font-size: 18px;">Blocked</span>
      </div>
    `;
  }

  const cls = usageClass(usage, limit);
  const reached = usage >= limit;
  const badge = reached
    ? `<span class="reached-badge">Limit reached</span>`
    : "";

  return `
    <div class="usage-value">
      <span class="usage-count ${cls}">${usage}<span class="usage-total">/${limit}</span></span>
      <span class="usage-label">Visits</span>
    </div>
    ${badge}
  `;
}

function usageClass(usage, limit) {
  if (limit === 0) return "usage-blocked";
  if (usage >= limit) return "usage-reached";
  const ratio = usage / limit;
  if (ratio <= 0.3) return "usage-low";
  if (ratio <= 0.7) return "usage-medium";
  return "usage-high";
}

function renderRules() {
  rulesList.replaceChildren();

  if (state.rules.length === 0) {
    rulesList.append(document.querySelector("#emptyTemplate").content.cloneNode(true));
    return;
  }

  const today = localDateKey(new Date());

  for (const rule of state.rules) {
    const usage = state.usage[today]?.[rule.id]?.count || 0;
    const limitText = Number(rule.dailyLimit) === 0
      ? "full block"
      : `${usage}/${rule.dailyLimit} sessions today`;
    const timeText = rule.timeWindow?.mode === "custom"
      ? `${rule.timeWindow.start}-${rule.timeWindow.end}`
      : "all day";
    const daysText = rule.days?.length ? rule.days.join(", ") : "every day";

    const card = document.createElement("article");
    card.className = "rule-card";
    card.innerHTML = `
      ${siteIcon(rule.domain)}
      <div class="rule-main">
        <h3>${escapeHtml(rule.domain)}</h3>
        <div class="rule-meta">
          <span class="pill">${escapeHtml(daysText)}</span>
          <span class="pill">${escapeHtml(timeText)}</span>
          <span class="pill">${escapeHtml(limitText)}</span>
          <span class="pill">${rule.includeSubdomains === false ? "exact domain" : "subdomains included"}</span>
          <span class="pill">${rule.enabled === false ? "paused" : "active"}</span>
        </div>
      </div>
      <div class="rule-actions">
        <button class="ghost" type="button" data-action="toggle" data-id="${rule.id}">${rule.enabled === false ? "Enable" : "Pause"}</button>
        <button class="ghost" type="button" data-action="edit" data-id="${rule.id}">Edit</button>
        <button class="ghost danger" type="button" data-action="delete" data-id="${rule.id}">Delete</button>
      </div>
    `;
    rulesList.append(card);
  }
}

function renderStats() {
  statsSummary.replaceChildren();
  statsChart.replaceChildren();

  const limitRules = state.rules.filter(rule => Number(rule.dailyLimit) > 0);
  const days = lastDays(30, new Date());
  const todayKey = days[days.length - 1].key;
  statsRange.textContent = `${formatRangeDate(days[0].date)} – ${formatRangeDate(days[days.length - 1].date)}`;

  if (limitRules.length === 0) {
    statsSummary.innerHTML = `
      <div class="empty compact">
        <h3>No limited rules</h3>
        <p>Session stats appear after a rule with daily sessions starts counting.</p>
      </div>
    `;
    return;
  }

  const todayTotal = limitRules.reduce((sum, rule) => sum + sessionCount(todayKey, rule.id), 0);
  const thirtyDayTotal = limitRules.reduce((sum, rule) => (
    sum + days.reduce((daySum, day) => daySum + sessionCount(day.key, rule.id), 0)
  ), 0);

  statsSummary.append(statCard("All limited sites", todayTotal, thirtyDayTotal, true));

  for (const rule of limitRules) {
    const todayCount = sessionCount(todayKey, rule.id);
    const total = days.reduce((sum, day) => sum + sessionCount(day.key, rule.id), 0);
    statsSummary.append(statCard(rule.domain, todayCount, total, false));
  }

  const dailyTotals = days.map(day => ({
    ...day,
    count: limitRules.reduce((sum, rule) => sum + sessionCount(day.key, rule.id), 0)
  }));
  const maxCount = Math.max(1, ...dailyTotals.map(day => day.count));
  const maxNice = niceMax(maxCount);

  const header = document.createElement("div");
  header.className = "chart-header";
  header.innerHTML = `
    <h3>
      Visits to limited sites
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="16" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12.01" y2="8"></line>
      </svg>
    </h3>
    <span class="chart-range">Past 30 days</span>
  `;

  const wrapper = document.createElement("div");
  wrapper.className = "chart-wrapper";

  const yAxis = document.createElement("div");
  yAxis.className = "chart-y-axis";
  for (let i = 4; i >= 0; i--) {
    const label = document.createElement("span");
    label.textContent = Math.round((maxNice / 4) * i);
    yAxis.append(label);
  }

  const grid = document.createElement("div");
  grid.className = "chart-grid";
  for (let i = 0; i < 5; i++) {
    const line = document.createElement("div");
    line.className = "chart-grid-line";
    grid.append(line);
  }

  const bars = document.createElement("div");
  bars.className = "chart-bars";

  dailyTotals.forEach((day, index) => {
    const item = document.createElement("div");
    item.className = "chart-day";
    item.setAttribute("data-count", String(day.count));
    item.title = `${formatFullDate(day.date)}: ${day.count} sessions`;

    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = day.count === 0 ? "2px" : `${Math.max(4, (day.count / maxNice) * 100)}%`;

    if (day.count > 0) {
      const value = document.createElement("span");
      value.textContent = day.count;
      bar.append(value);
    }

    const label = document.createElement("span");
    label.className = "chart-label";
    label.textContent = chartLabel(day, index, dailyTotals);

    item.append(bar, label);
    bars.append(item);
  });

  grid.append(bars);
  wrapper.append(yAxis, grid);

  statsChart.append(header, wrapper);
}

function niceMax(max) {
  if (max <= 5) return 5;
  const step = max <= 20 ? 5 : 10;
  return Math.ceil(max / step) * step;
}

function chartLabel(day, index, days) {
  const isFirst = index === 0;
  const isLast = index === days.length - 1;
  const monthChanged = index > 0 && day.date.getMonth() !== days[index - 1].date.getMonth();
  const showLabel = isFirst || isLast || index % 2 === 0 || monthChanged;
  if (!showLabel) return "";
  if (isFirst || monthChanged) {
    return formatFullMonthDate(day.date);
  }
  return String(day.date.getDate());
}

function statCard(domain, todayCount, totalCount, isTotal) {
  const card = document.createElement("article");
  card.className = "stat-card";
  card.innerHTML = `
    ${isTotal ? globeIcon() : siteIcon(domain)}
    <div class="stat-main">
      <div>
        <h3>${escapeHtml(domain)}</h3>
        <div class="stat-header">
          <span class="stat-count">${todayCount}<span class="stat-unit">today</span></span>
        </div>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-row">
        <strong>${totalCount}</strong>
        <span>in last 30 days</span>
      </div>
    </div>
  `;
  return card;
}

function siteIcon(domain) {
  const letter = escapeHtml(domain.charAt(0));
  const color = colorForDomain(domain);
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
  return `
    <span class="site-icon" data-domain="${escapeHtml(domain)}" aria-hidden="true">
      <img src="${faviconUrl}" alt="" width="24" height="24">
      <span class="site-fallback" style="background: ${color.bg}; color: ${color.letter};">${letter}</span>
    </span>
  `;
}

function setupFaviconFallback() {
  document.addEventListener("error", event => {
    const img = event.target;
    if (!img.matches || !img.matches(".site-icon img")) return;
    const icon = img.closest(".site-icon");
    if (icon) icon.classList.add("site-icon--fallback");
  }, true);
}

function globeIcon() {
  return `
    <span class="site-icon" style="background: #EAF9EE; color: #2E7D4A;" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="2" y1="12" x2="22" y2="12"></line>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
      </svg>
    </span>
  `;
}

function colorForDomain(domain) {
  let hash = 0;
  for (const char of String(domain)) {
    hash = (hash << 5) - hash + char.charCodeAt(0);
    hash |= 0;
  }
  const index = Math.abs(hash) % PALETTE.length;
  return PALETTE[index];
}

function sessionCount(dayKey, ruleId) {
  return Number(state.sessionStats[dayKey]?.[ruleId]?.count || 0);
}

function lastDays(count, endDate) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(endDate);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (count - index - 1));
    return {
      date,
      key: localDateKey(date)
    };
  });
}

function formatChartDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatRangeDate(date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatFullDate(date) {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatFullMonthDate(date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function populateForm(rule) {
  state.editingId = rule.id;
  domainInput.value = rule.domain;
  limitInput.value = rule.dailyLimit;
  includeSubdomainsInput.checked = rule.includeSubdomains !== false;

  for (const input of form.querySelectorAll("input[name='days']")) {
    input.checked = (rule.days || []).includes(input.value);
  }

  const isCustom = rule.timeWindow?.mode === "custom";
  form.querySelector(`input[name='timeMode'][value='${isCustom ? "custom" : "allDay"}']`).checked = true;
  customTimes.classList.toggle("hidden", !isCustom);
  startTime.value = rule.timeWindow?.start || "09:00";
  endTime.value = rule.timeWindow?.end || "17:00";

  saveRule.textContent = "Save rule";
  cancelEdit.classList.remove("hidden");
  document.querySelector("#editorTitle").textContent = "Edit rule";
  domainInput.focus();
}

function resetForm() {
  state.editingId = null;
  form.reset();
  includeSubdomainsInput.checked = true;
  limitInput.value = 5;
  for (const input of form.querySelectorAll("input[name='days']")) {
    input.checked = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(input.value);
  }
  form.querySelector("input[name='timeMode'][value='allDay']").checked = true;
  customTimes.classList.add("hidden");
  saveRule.textContent = "Add rule";
  cancelEdit.classList.add("hidden");
  document.querySelector("#editorTitle").textContent = "Add a rule";
}

function normalizeDomain(value) {
  const raw = value.trim().toLowerCase();
  if (!raw) return "";
  const withProtocol = /^[a-z]+:\/\//.test(raw) ? raw : `https://${raw}`;

  try {
    const url = new URL(withProtocol);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function localDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

async function checkPermissions() {
  if (!permissionBanner || !grantPermission) return;
  if (typeof chrome.permissions === "undefined") return;

  const hasPermission = await chrome.permissions.contains({ origins: ["<all_urls>"] });
  permissionBanner.classList.toggle("hidden", hasPermission);
}

grantPermission?.addEventListener("click", async () => {
  if (typeof chrome.permissions === "undefined") return;

  const granted = await chrome.permissions.request({ origins: ["<all_urls>"] });
  permissionBanner.classList.toggle("hidden", granted);
  if (granted) {
    renderActiveRules();
    renderRules();
    renderStats();
  }
});

function setupSidebar() {
  for (const item of navItems) {
    item.addEventListener("click", () => {
      if (item.classList.contains("disabled")) return;

      const view = item.dataset.view;
      setActiveNav(view);

      if (view === "dashboard") {
        showPanel("activeRulesPanel");
      } else if (view === "settings") {
        showPanel("allRulesPanel");
      }
    });
  }

  addRuleFromRules?.addEventListener("click", () => {
    resetForm();
    showPanel("addRulesPanel");
  });

  cancelAdd?.addEventListener("click", () => {
    resetForm();
    setActiveNav("settings");
    showPanel("allRulesPanel");
  });
}

function setActiveNav(view) {
  for (const nav of navItems) {
    nav.classList.toggle("active", nav.dataset.view === view && !nav.classList.contains("disabled"));
  }
}

function showPanel(panelId) {
  for (const panel of tabPanels) {
    panel.classList.toggle("active", panel.id === panelId);
  }
}
