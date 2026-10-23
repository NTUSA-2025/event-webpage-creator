# 臺大學生會活動網頁設計台

供授權成員用對話製作活動頁設計稿，並由工程師檢視後整合進官網。產出為單一 HTML，CSS 與 JS 內嵌；活動頁不提供資料庫、登入或訪客資料收集功能。分享連結是設計預覽，**不可當作正式活動宣傳網址**。

## 架構與流程

- Vite/React 前端部署於 Cloudflare Pages；`functions/api/[[path]].ts` 是 Pages Functions API。`public/_routes.json` 只讓 `/api/*` 進入 Functions。
- Google OAuth 登入後，以 Google Workspace Directory API 即時核對管理員、工程師及建立者群組。建立者也可由管理後台的信箱或網域規則授權。
- D1 保存專案、權限、對話、版本索引和分享資訊；私有 R2 保存每版 HTML 與官網版位快照。編輯草稿不影響分享版；「更新分享版」後，同一 magic link 才顯示新內容。作者可撤銷或重建連結。
- 右側預覽將生成程式碼放在無同源權限的 sandbox iframe；有 `data-editor-id` 的元素可點選、拖拉、調整尺寸及就地改字。原始碼為最終依據，複雜元素可直接在程式碼區修改。
- 工程師須屬 `ENGINEER_GROUP_EMAIL` 才可下載分享版 HTML。下載檔不含平台 nav/footer，會註明 Google Drive 素材需在整合官網時下載成正式 asset。

## Cloudflare Pages 設定

1. 建立 Pages 專案，建置指令設為 `npm run build`，輸出目錄設為 `dist`。Functions 目錄維持 repo 根目錄的 `functions/`。
2. 在 Pages 專案設定中，將 D1 database 綁定為 `DB`，私有 R2 bucket 綁定為 `FILES`；設定兼容日期 `2026-10-01`，並啟用 `nodejs_compat`。本 repo 不放 `wrangler.toml`，由 Pages dashboard 管理綁定，避免部署時覆蓋 dashboard 設定。[Cloudflare Pages 設定文件](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)。
3. 在 D1 執行 `migrations/0001_init.sql`。部署前須先完成 migration；專案不會自動修改正式資料庫。
4. 依 `.dev.vars.example` 在 Pages 的 Variables and Secrets 建立環境變數。`GOOGLE_CLIENT_SECRET`、`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`、`GOOGLE_DRIVE_API_KEY`、`LLM_API_KEY`、`SESSION_SECRET` 須設為加密 secret；`SESSION_SECRET` 至少 32 字元。`PUBLIC_ORIGIN` 必須是實際部署來源，例如 `https://your-project.pages.dev`，不加尾端 `/`。
5. Google OAuth Web application 的授權重新導向 URI 設為 `<PUBLIC_ORIGIN>/api/auth/callback`，登入範圍為 `openid email profile`。授權建立者可來自任何 Google 帳號，但實際建立資格由平台規則控制。
6. 啟用 Google Admin SDK Directory API，讓 Workspace 超級管理員替服務帳號開啟網域委派，授予 `https://www.googleapis.com/auth/admin.directory.group.member.readonly`。`GOOGLE_WORKSPACE_ADMIN_EMAIL` 是被委派的管理員信箱；`ADMIN_GROUP_EMAIL` 與 `ENGINEER_GROUP_EMAIL` 分別設定兩個 Google Group。群組驗證失敗時，受保護操作會拒絕存取。[Google 群組成員查詢](https://developers.google.com/workspace/admin/directory/reference/rest/v1/members/hasMember)。
7. 啟用 Google Drive API，建立受 API 範圍限制的 key。素材須是 Drive 的 PNG、JPEG、WebP 或 GIF，設為「知道連結的任何人可檢視」，單檔不超過 8 MB；若連結含 resource key，平台會帶入 Drive API 請求。[Drive 公開檔案憑證](https://developers.google.com/workspace/guides/create-credentials)、[resource key](https://developers.google.com/workspace/drive/api/guides/resource-keys)。
8. 第一次以管理員群組帳號登入後，在後台設定 LLM HTTPS base URL 與支援圖片輸入的模型。`LLM_API_KEY` 保持在 Cloudflare secret；平台以相容 OpenAI Chat Completions 的 `POST /chat/completions` 呼叫模型。管理員也可加入建立者信箱、網域或 Google Group，並按「更新共用元件」從官網同步中英文公開 nav/footer。

## 驗證與限制

本地靜態檢查：`npm run build`、`npm test`。Pages Functions 可用 `npx wrangler pages functions build --compatibility-flags nodejs_compat` 檢查打包；不需要啟動開發伺服器。正式 OAuth、D1、R2、Drive、Google Groups 和 LLM 串接需在完成上述綁定後驗收。

公開 magic link 的 HTML 必須送到檢視者瀏覽器才能呈現，因此持連結者可透過瀏覽器開發工具檢視頁面原始內容；平台只限制「下載交付檔」功能給工程師。分享頁的外部 iframe 由第三方服務提供，能否顯示仍受該服務自己的嵌入政策影響。Google Drive 分享網址不是穩定的官網 asset URL，因此交付檔保留原始連結並附工程整合註解。

共用版位同步以 [官網](https://ntusa.ntu.edu.tw/)實際輸出的 HTML/CSS 為來源，僅擷取公開 nav/footer、手機選單及中英文版本；官網管理選單不會帶入本平台。若官網改版導致必要結構消失，同步操作失敗且保留前一版。
