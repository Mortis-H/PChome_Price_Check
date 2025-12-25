# PChome Price Check (Community Data Edition)

這是一個強大的 PChome 24h 購物歷史價格查詢工具，結合 Chrome 擴充功能與 Cloudflare Workers 社群資料庫，為使用者提供精準的歷史低價資訊。

## 🚀 重點功能

- **歷史低價查詢**: 自動查詢並顯示商品的歷史最低價格。
- **即時比價**: 結合本地快取 (Local Cache) 技術，比價 **0 延遲** 且不佔用伺服器資源。
- **社群回報系統**: 自動將查詢到的低價回報至社群資料庫，造福所有使用者。
- **安全性驗證**: 伺服器端具備嚴格的價格驗證機制，防止惡意資料污染。
- **浮動通知 (Floating Toast)**: 不干擾瀏覽的右下角浮動視窗設計。
- **支援頁面**: 支援一般商品頁與「整點特賣 (OnSale)」頁面。

## 📂 專案結構

- **`extension/`**: Chrome 擴充功能 (Frontend)
  - 使用 Manifest V3
  - 包含 Content Scripts (商品頁/特賣頁) 與 Background Service Worker。
  - 具備本地與 Cloudflare 快照快取機制。

- **`cloudflare_worker/`**: 後端 API (Backend)
  - 使用 Cloudflare Workers + D1 (SQLite) 資料庫。
  - 提供 `/lowest` (查詢)、`/ingest` (回報)、`/snapshot` (快照) 等 API。
    
## 🛠️ 安裝與部署

### Chrome Extension (使用者)
1. 下載並解壓縮最新 release zip 檔。
2. 開啟 Chrome 擴充功能頁面 (`chrome://extensions/`)。
3. 開啟右上角「開發人員模式」。
4. 點擊「載入未封裝項目」，選擇 `extension` 資料夾。

### Cloudflare Worker (開發者)
```bash
cd cloudflare_worker
npm install
npx wrangler login

# 初始化資料庫
npx wrangler d1 create pchome-community-low
npx wrangler d1 execute pchome-community-low --remote --file=./schema.sql

# 部署
npx wrangler deploy
```

## 📝 版本紀錄
- **v0.4.1**: 優化回報延遲 (5s -> 1s)，提升資料採集靈敏度。
- **v0.4.0**: 全新後端架構 (伺服器驗證 + 安全性 + 歷史表) 與新版浮動 UI。
- **v0.3.7**: 基礎社群比價功能。

## 📜 隱私權政策
請參閱 [privacy-policy.md](privacy-policy.md)
