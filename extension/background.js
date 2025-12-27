const FLUSH_INTERVAL_MS = 1000;
const MAX_BATCH = 100;
const SETTINGS = {
  useCommunity: true,
  communityBase: "https://pchome-community-low.brad0315.workers.dev",
};
let flushTimer = null;
const pendingIngest = [];
let ingestBase = "";

// Client-side cache
let communityCache = new Map();
let isCacheReady = false;
const SNAPSHOT_KEY = "community_snapshot";

// Initialize cache
(async function init() {
  await loadCache();
  updateSnapshot(); // Refresh in background
})();

async function loadCache() {
  try {
    const data = await chrome.storage.local.get(SNAPSHOT_KEY);
    if (data && data[SNAPSHOT_KEY]) {
      const prices = data[SNAPSHOT_KEY].prices;
      if (prices) {
        communityCache = new Map(Object.entries(prices));
        isCacheReady = true;
        console.log(`[PChomePrice] Loaded ${communityCache.size} items from local cache.`);
      }
    }
  } catch (e) {
    console.error("Failed to load cache", e);
  }
}

async function updateSnapshot() {
  try {
    if (!SETTINGS.useCommunity) return;
    const resp = await fetch(`${SETTINGS.communityBase}/snapshot`);
    if (!resp.ok) return;
    const data = await resp.json();
    if (data && data.prices) {
      // Save to storage
      await chrome.storage.local.set({ [SNAPSHOT_KEY]: data });
      // Update in-memory
      communityCache = new Map(Object.entries(data.prices));
      isCacheReady = true;
      console.log(`[PChomePrice] Updated snapshot with ${communityCache.size} items.`);
    }
  } catch (e) {
    console.error("Snapshot update failed", e);
  }
}

function normalizePrice(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function fetchPrice(prodId) {
  const url = `https://ecapi-cdn.pchome.com.tw/ecshop/prodapi/v2/prod/button&id=${encodeURIComponent(prodId)}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const data = await resp.json();
  const entry = Array.isArray(data) ? data[0] : null;
  const price = entry && entry.Price ? entry.Price : {};
  return {
    promo: normalizePrice(price.P),
    low: normalizePrice(price.Low),
  };
}

async function fetchCommunityLow(prodId, baseUrl) {
  // 1. Try Local Cache First (0ms latency, 0 cost)
  if (isCacheReady) {
    const price = communityCache.get(prodId);
    return price != null ? normalizePrice(price) : null;
  }

  // 2. Fallback to API only if cache is not ready (e.g. first install)
  try {
    if (!baseUrl) {
      return null;
    }
    const url = `${baseUrl}/lowest?prodId=${encodeURIComponent(prodId)}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    return normalizePrice(data.minPrice ?? data.min);
  } catch (err) {
    return null;
  }
}

function shouldEnqueue(promoValue, officialLow, communityLow) {
  const promo = normalizePrice(promoValue);
  const official = normalizePrice(officialLow);
  const community = normalizePrice(communityLow);
  if (promo === null) {
    return false;
  }
  if (official === null && community === null) {
    return true;
  }
  if (community === null) {
    return official === null ? true : promo < official;
  }
  const finalLow = official !== null ? Math.min(official, community) : community;
  return promo < finalLow;
}

function enqueueIngest(item, baseUrl) {
  if (!baseUrl) return;

  // Optimistic update: Update local cache immediately so we don't try to ingest again
  // for the same session.
  if (item.prodId && item.price != null) {
    communityCache.set(item.prodId, item.price);
    console.log(`[PChomePrice] Optimistically updated cache for ${item.prodId} to ${item.price}`);
  }

  ingestBase = baseUrl;
  pendingIngest.push(item);
  if (pendingIngest.length >= MAX_BATCH) {
    flushIngest();
    return;
  }
  if (!flushTimer) {
    flushTimer = setTimeout(flushIngest, FLUSH_INTERVAL_MS);
  }
}

async function flushIngest() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pendingIngest.length === 0) return;
  if (!ingestBase) {
    pendingIngest.length = 0;
    return;
  }
  const batch = pendingIngest.splice(0, MAX_BATCH);
  try {
    await fetch(`${ingestBase}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: batch }),
    });
  } catch (err) {
    // Best effort; drop on failure for MVP.
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) {
    return false;
  }

  if (message.type !== "getPrice" || !message.prodId) {
    return false;
  }

  fetchPrice(message.prodId)
    .then(async (result) => {
      const settings = SETTINGS;
      const promoValue = message.promoOverride ?? result.promo;
      let communityLow = null;
      if (settings.useCommunity) {
        communityLow = await fetchCommunityLow(message.prodId, settings.communityBase);
      }

      let effectiveLow = result.low;
      let source = result.low != null ? "official" : null;
      if (settings.useCommunity && communityLow != null) {
        if (effectiveLow == null || communityLow < effectiveLow) {
          effectiveLow = communityLow;
          source = "community";
        }
      }

      if (settings.useCommunity && shouldEnqueue(promoValue, result.low, communityLow)) {
        enqueueIngest({
          prodId: message.prodId,
          price: normalizePrice(promoValue),
          pageType: message.pageType || null,
          observedAt: new Date().toISOString(),
        }, settings.communityBase);
      }
      sendResponse({
        ok: true,
        promo: result.promo,
        low: result.low,
        communityLow,
        effectiveLow,
        source,
      });
    })
    .catch((err) => {
      sendResponse({ ok: false, error: String(err) });
    });

  return true;
});
