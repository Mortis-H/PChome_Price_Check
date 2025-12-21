const bannerId = "pchome-low-price-banner";
const CHECKING_TEXT = "價格查詢中...";
const ERROR_TEXT = "價格查詢失敗，請重新整理";
const COMMUNITY_NOTE = "社群低於官方最低價，官方可能未更新";

function formatPrice(value) {
  if (value === null || value === undefined) return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function extractProdIdFromPath() {
  const match = window.location.pathname.match(/\/prod\/([A-Z0-9-]+)/i);
  return match ? match[1].toUpperCase() : null;
}

function showBanner(message, color, title) {
  const existing = document.getElementById(bannerId);
  if (existing) {
    existing.textContent = message;
    existing.style.background = color;
    if (title) {
      existing.title = title;
    } else {
      existing.removeAttribute("title");
    }
    return;
  }
  const banner = document.createElement("div");
  banner.id = bannerId;
  banner.textContent = message;
  banner.style.position = "sticky";
  banner.style.top = "0";
  banner.style.zIndex = "99999";
  banner.style.padding = "12px 16px";
  banner.style.background = color;
  banner.style.color = "#fff";
  banner.style.fontSize = "14px";
  banner.style.fontWeight = "700";
  banner.style.textAlign = "center";
  banner.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
  if (title) {
    banner.title = title;
  }
  document.body.prepend(banner);
}

let lastProdId = null;

function checkProduct() {
  const prodId = extractProdIdFromPath();
  if (!prodId) return;
  if (prodId === lastProdId) return;
  lastProdId = prodId;

  showBanner(CHECKING_TEXT, "#6b7280");
  let responded = false;
  const timeoutId = setTimeout(() => {
    if (!responded) {
      showBanner(ERROR_TEXT, "#dc2626");
    }
  }, 5000);

  chrome.runtime.sendMessage(
    { type: "getPrice", prodId, pageType: "product", forceRefresh: true },
    (resp) => {
      responded = true;
      clearTimeout(timeoutId);
      if (!resp || !resp.ok) {
        showBanner("歷史最低價：API ERROR", "#dc2626");
        return;
      }
      const effectiveLow = resp.effectiveLow != null ? resp.effectiveLow : resp.low;
      if (effectiveLow == null) {
        showBanner("產品價格資料建置中", "#6b7280");
        return;
      }
      const source =
        resp.source || (resp.low != null ? "official" : resp.communityLow != null ? "community" : "official");
      const sourceLabel = source === "official" ? "官方" : source === "community" ? "社群" : "官方";
      const communityLower = resp.communityLow != null && resp.low != null && resp.communityLow < resp.low;
      const suffix = communityLower ? "*" : "";
      const note = communityLower ? ` ${COMMUNITY_NOTE}` : "";
      showBanner(
        `歷史最低價：${formatPrice(effectiveLow)}${suffix} (${sourceLabel})${note}`,
        "#1c9f5f",
        communityLower ? COMMUNITY_NOTE : ""
      );
    }
  );
}

function startWatch() {
  checkProduct();
  setInterval(checkProduct, 2000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startWatch, { once: true });
} else {
  startWatch();
}
