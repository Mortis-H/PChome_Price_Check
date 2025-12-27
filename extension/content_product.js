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
    existing.querySelector(".msg-content").textContent = message;
    existing.style.background = color;
    existing.style.borderColor = color;
    if (title) {
      existing.title = title;
    }
    return;
  }

  const toast = document.createElement("div");
  toast.id = bannerId;
  toast.style.position = "fixed";
  toast.style.bottom = "20px";
  toast.style.right = "20px";
  toast.style.zIndex = "2147483647"; // Max z-index
  toast.style.background = color;
  toast.style.color = "#fff";
  toast.style.padding = "12px 16px";
  toast.style.borderRadius = "8px";
  toast.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
  toast.style.fontSize = "14px";
  toast.style.fontWeight = "600";
  toast.style.display = "flex";
  toast.style.alignItems = "center";
  toast.style.fontFamily = "sans-serif";
  toast.style.transition = "transform 0.3s ease, opacity 0.3s ease";
  toast.style.cursor = "default";

  const msgSpan = document.createElement("span");
  msgSpan.className = "msg-content";
  msgSpan.textContent = message;
  toast.appendChild(msgSpan);

  // Close button
  const closeBtn = document.createElement("span");
  closeBtn.textContent = "✕";
  closeBtn.style.marginLeft = "12px";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.opacity = "0.8";
  closeBtn.onclick = () => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => toast.remove(), 300);
  };
  toast.appendChild(closeBtn);

  if (title) {
    toast.title = title;
  }

  document.body.appendChild(toast);
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
        const errorMsg = resp && resp.error ? `API ERROR: ${resp.error}` : "歷史最低價：API ERROR";
        showBanner(errorMsg, "#dc2626");
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
