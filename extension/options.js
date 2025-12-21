const DEFAULT_SETTINGS = {
  useCommunity: true,
  communityBase: "https://pchome-community-low.brad0315.workers.dev",
};

function normalizeBase(value) {
  if (!value) return "";
  return value.replace(/\/+$/, "");
}

function loadSettings() {
  chrome.storage.local.get("settings", (items) => {
    const settings = { ...DEFAULT_SETTINGS, ...(items.settings || {}) };
    document.getElementById("useCommunity").checked = !!settings.useCommunity;
    document.getElementById("communityBase").value = settings.communityBase || "";
  });
}

function saveSettings() {
  const useCommunity = document.getElementById("useCommunity").checked;
  const communityBase = normalizeBase(document.getElementById("communityBase").value.trim());
  const settings = { useCommunity, communityBase };
  chrome.storage.local.set({ settings }, () => {
    const status = document.getElementById("status");
    status.textContent = "設定已儲存";
    setTimeout(() => {
      status.textContent = "";
    }, 1500);
  });
}

document.getElementById("save").addEventListener("click", saveSettings);
loadSettings();
