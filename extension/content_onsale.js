const LOW_BADGE_CLASS = "pchome-low-price-badge";
const NEUTRAL_OUTLINE = "2px dashed #9aa0a6";
const ALERT_OUTLINE = "4px solid #dc2626";
const EQUAL_OUTLINE = "4px solid #16a34a";
const HOT_CLASS = "pchome-promo-hot";
const COMMUNITY_NOTE = "社群低於官方最低價，官方可能未更新";
const processedAnchors = new WeakSet();
const anchorMapByProd = new Map();
const inflight = new Set();
const retryCounts = new Map();
const retryTimers = new Map();
const RETRY_DELAYS_MS = [1200, 3000, 6000, 10000, 15000];
let scanScheduled = false;
let initialScanDone = false;

function formatPrice(value) {
  if (value === null || value === undefined) return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function extractNumbers(text) {
  if (!text) return [];
  const matches = text.match(/(\d{1,3}(?:,\d{3})+|\d+)/g);
  if (!matches) return [];
  return matches
    .map((value) => Number(value.replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0 && value < 10000000);
}

function ensureStyles() {
  if (document.getElementById("pchome-promo-style")) {
    return;
  }
  const style = document.createElement("style");
  style.id = "pchome-promo-style";
  style.textContent = `
    @keyframes pchomePulse {
      0% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.5); }
      70% { box-shadow: 0 0 0 10px rgba(220, 38, 38, 0); }
      100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0); }
    }
    .${HOT_CLASS} {
      animation: pchomePulse 1.4s ease-out infinite;
      box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.5);
    }
  `;
  document.head.appendChild(style);
}

function extractPromoFromAnchor(anchor) {
  const container = anchor.closest("li, div, a") || anchor;
  const priceNode = container.querySelector(".c-prodInfoV2__priceValue--m");
  if (priceNode) {
    const values = extractNumbers(priceNode.textContent);
    if (values.length > 0) {
      return values[0];
    }
  }
  return null;
}

function extractProdIdFromHref(href) {
  if (!href) return null;
  const match = href.match(/\/prod\/([A-Z0-9-]+)/i);
  return match ? match[1].toUpperCase() : null;
}

function ensureBadge(container) {
  let badge = container.querySelector(`.${LOW_BADGE_CLASS}`);
  if (!badge) {
    badge = document.createElement("span");
    badge.className = LOW_BADGE_CLASS;
    badge.style.position = "absolute";
    badge.style.top = "8px";
    badge.style.left = "8px";
    badge.style.padding = "4px 6px";
    badge.style.color = "#fff";
    badge.style.fontSize = "12px";
    badge.style.fontWeight = "700";
    badge.style.borderRadius = "4px";
    badge.style.zIndex = "9999";
    badge.style.pointerEvents = "none";
    badge.style.userSelect = "none";
    container.appendChild(badge);
  }
  return badge;
}

function updateBadge(anchor, payload) {
  ensureStyles();
  const container = anchor;
  const style = window.getComputedStyle(container);
  if (style.position === "static") {
    container.style.position = "relative";
  }
  const badge = ensureBadge(container);

  badge.textContent = payload.text;
  if (!payload.text) {
    badge.style.display = "none";
  } else {
    badge.style.display = "";
    badge.style.background = payload.color;
  }
  if (payload.title) {
    badge.title = payload.title;
  } else {
    badge.removeAttribute("title");
  }
  anchor.style.outline = payload.outline;
  anchor.style.outlineOffset = "2px";
  if (payload.opacity != null) {
    anchor.style.opacity = payload.opacity;
  } else {
    anchor.style.opacity = "";
  }
  anchor.classList.toggle(HOT_CLASS, payload.isHot === true);
}

function markAnchor(anchor) {
  if (processedAnchors.has(anchor)) return;
  processedAnchors.add(anchor);
  updateBadge(anchor, {
    text: "CHECKING...",
    color: "#6b7280",
    outline: NEUTRAL_OUTLINE,
  });
}

function scheduleRetry(prodId) {
  const count = retryCounts.get(prodId) || 0;
  if (count >= RETRY_DELAYS_MS.length) return;
  if (retryTimers.has(prodId)) return;
  retryCounts.set(prodId, count + 1);
  const delay = RETRY_DELAYS_MS[count];
  const timer = setTimeout(() => {
    retryTimers.delete(prodId);
    if (!anchorMapByProd.has(prodId)) {
      retryCounts.delete(prodId);
      return;
    }
    requestPrice(prodId);
  }, delay);
  retryTimers.set(prodId, timer);
}

function requestPrice(prodId) {
  if (inflight.has(prodId)) return;

  const anchorMap = anchorMapByProd.get(prodId);
  if (!anchorMap || anchorMap.size === 0) return;

  inflight.add(prodId);

  const promos = Array.from(anchorMap.values())
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  const promoOverride = promos.length > 0 ? Math.min(...promos) : null;

  chrome.runtime.sendMessage(
    { type: "getPrice", prodId, pageType: "onsale", promoOverride },
    (resp) => {
      inflight.delete(prodId);

      const currentMap = anchorMapByProd.get(prodId);
      if (!currentMap) return;
      currentMap.forEach((promo, anchor) => {
        applyResult(anchor, resp, promo, prodId);
      });
    }
  );
}

function scanAndCheck() {
  const anchors = Array.from(document.querySelectorAll("a[href*='/prod/']"));

  anchors.forEach((anchor) => {
    const prodId = extractProdIdFromHref(anchor.getAttribute("href"));
    if (!prodId) return;
    markAnchor(anchor);

    const promoOverride = extractPromoFromAnchor(anchor);
    let anchorMap = anchorMapByProd.get(prodId);
    if (!anchorMap) {
      anchorMap = new Map();
      anchorMapByProd.set(prodId, anchorMap);
    }
    anchorMap.set(anchor, promoOverride);
    requestPrice(prodId);
  });
}

function normalizeResponse(resp, promoOverride) {
  if (!resp || !resp.ok) {
    const errorText = resp && resp.error ? `LOW: ${resp.error}` : "LOW: API ERROR";
    return { text: errorText, color: "#dc2626", outline: NEUTRAL_OUTLINE };
  }
  const effectiveLow = resp.effectiveLow != null ? resp.effectiveLow : resp.low;
  if (effectiveLow == null) {
    return { text: "產品價格資料建置中", color: "#6b7280", outline: NEUTRAL_OUTLINE };
  }
  const communityLower = resp.communityLow != null && resp.low != null && resp.communityLow < resp.low;

  const promoSource = promoOverride != null ? promoOverride : resp.promo;
  const promo = promoSource == null ? null : Number(promoSource);

  const hasPromo = Number.isFinite(promo) && effectiveLow !== null;
  const promoNum = hasPromo ? Number(promo) : null;
  const lowNum = effectiveLow !== null ? Number(effectiveLow) : null;

  let outline = NEUTRAL_OUTLINE;
  let opacity = null;
  let isHot = false;
  if (hasPromo) {
    if (promoNum < lowNum) {
      outline = ALERT_OUTLINE;
      isHot = true;
    } else if (promoNum === lowNum) {
      outline = EQUAL_OUTLINE;
    } else {
      opacity = 0.5;
    }
  }

  const suffix = communityLower ? "*" : "";
  const labelText = hasPromo && promoNum === lowNum ? "" : `LOW: ${formatPrice(effectiveLow)}${suffix}`;
  return {
    text: labelText,
    color: "#1c9f5f",
    outline,
    opacity,
    isHot,
    title: communityLower ? COMMUNITY_NOTE : "",
  };
}

function applyResult(anchor, resp, promoOverride, prodId) {
  const result = normalizeResponse(resp, promoOverride);
  updateBadge(anchor, result);
  if (prodId) {
    if (result.text === "產品價格資料建置中") {
      scheduleRetry(prodId);
    } else {
      retryCounts.delete(prodId);
      const timer = retryTimers.get(prodId);
      if (timer) {
        clearTimeout(timer);
        retryTimers.delete(prodId);
      }
    }
  }
}

function scheduleScan() {
  if (scanScheduled) return;
  scanScheduled = true;
  const run = () => {
    scanScheduled = false;
    scanAndCheck();
  };
  if ("requestIdleCallback" in window) {
    requestIdleCallback(run, { timeout: 1500 });
  } else {
    setTimeout(run, 400);
  }
}

const observer = new MutationObserver((mutations) => {
  if (!initialScanDone) return;
  let shouldScan = false;
  for (const m of mutations) {
    // Ignore invalidations caused by our own badges
    if (m.target && m.target.classList && m.target.classList.contains(LOW_BADGE_CLASS)) {
      continue;
    }
    // Also check if addedNodes are purely our badges
    let relevantNodeFound = false;
    if (m.addedNodes.length > 0) {
      for (const node of m.addedNodes) {
        // If it's an element node and NOT our badge
        if (node.nodeType === 1) {
          if (!node.classList.contains(LOW_BADGE_CLASS)) {
            relevantNodeFound = true;
            break;
          }
        } else {
          // text nodes etc might be relevant
          relevantNodeFound = true;
        }
      }
    }

    if (relevantNodeFound) {
      shouldScan = true;
      break;
    }
  }

  if (shouldScan) {
    scheduleScan();
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });
scheduleScan();
initialScanDone = true;
