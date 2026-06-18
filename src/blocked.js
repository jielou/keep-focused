const params = new URLSearchParams(location.search);
const reason = params.get("reason");
const blockedDomain = params.get("domain") || "this domain";
const availableAt = params.get("availableAt");

const domainBadge = document.querySelector("#domain");
domainBadge.append(blockedDomain);

if (reason === "limit") {
  document.querySelector("#title").textContent = "Daily limit reached";
  document.querySelector("#message").textContent = "You have used today's checking sessions for this domain.";
} else if (reason === "focus") {
  document.querySelector("#title").textContent = "Focus mode is on";
  document.querySelector("#message").textContent = "You are focusing on another page. Exit focus mode to browse here.";
} else {
  document.querySelector("#title").textContent = "This domain is blocked";
  document.querySelector("#message").textContent = "A scheduled rule is active right now.";
}

const availableBadge = document.querySelector("#available");
if (availableAt) {
  const date = new Date(availableAt);
  availableBadge.append(`Available ${date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  })}`);
} else {
  availableBadge.remove();
}

const leaveButton = document.querySelector("#leaveButton");

if (reason === "focus") {
  leaveButton.textContent = "Exit focus mode";
  leaveButton.addEventListener("click", async () => {
    await chrome.storage.local.set({ focus: { active: false } });
    if (history.length > 1) {
      history.back();
    } else {
      location.replace("about:blank");
    }
  });
} else {
  leaveButton.addEventListener("click", () => {
    location.replace("about:blank");
  });
}

document.querySelector("#settingsButton").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
