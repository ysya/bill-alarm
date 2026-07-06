# Bill Alarm — 帳號管理獨立頁＋中性語彙 設計

日期：2026-07-06
狀態：已核准（使用者確認「好」）

## 背景與目標

多租戶轉換（`2026-07-06-multi-tenant-design.md`，已合併 `1fde9b3`）後，後端已是徹底的每人隔離。但前端殘留「家庭共享」框架：`UsersCard` 埋在 設定 → 系統管理 區、副標「為**家人**建立獨立帳號」、對話框「把密碼告訴**家人**」、角色叫「**成員**」。使用者要它「更接近多租戶」—— 把帳號管理獨立拉出來，改用中性 SaaS 語彙。

已確認的決策：

1. **admin 角色不變**：維持對稱隱私（admin 也只看自己的帳單），admin 只多「管理帳號」這一項能力。**後端完全不動** —— 無 schema、無遷移、無 API 變更。
2. **擺放**：獨立專屬頁面，從設定頁進入（不新增底部導航 tab，保留 5-tab 對稱）。
3. **語彙**：以「使用者／管理員」為主，去除所有家人／成員／家庭字樣。

**非目標**：任何後端／schema／遷移改動；super-admin 跨租戶檢視（與已定的對稱隔離相反）；底部導航變動；使用者詳情子頁；自助註冊／邀請碼。

## 設計

### 1. 專屬頁面（`apps/web/pages/settings/users.vue`）

新路由 `/settings/users`，admin 的完整帳號管理頁。內容是把現有 `components/settings/UsersCard.vue` 的功能整頁化：

- 頁首：標題「使用者管理」＋副標「建立獨立帳號，每人各自管理自己的帳單。」＋右上「＋ 新增使用者」主按鈕。
- 使用者列表升級為 console 式表格（有整頁空間）：欄位 **使用者名稱｜角色｜信箱｜Telegram｜建立時間｜狀態**，每列右側操作。窄螢幕（<sm）退化為現有的堆疊卡片列（沿用 `UsersCard` 現有的 flex-wrap 列樣式即可，不強做 RWD 表格）。
- 操作：啟用中列 → 重設密碼／停用；已停用列 → 標「已停用」＋還原／永久刪除。管理員自己那列不顯示停用／刪除（沿用現有 `user.role !== 'admin'` 守則）。
- 對話框（新增／重設密碼／停用／永久刪除）全部沿用 `UsersCard` 現有實作，**只換文案**（見 §3）。
- 返回：頁首左上「← 返回設定」連結回 `/settings`（沿用 `pages/bills/[id].vue` 的返回列樣式）。

實作方式：把 `UsersCard.vue` 的 `<script setup>` 邏輯（fetch/create/reset/deactivate/restore/purge handlers ＋ dialog 狀態）整段移到 `pages/settings/users.vue`；`UsersCard.vue` 元件本身刪除（無其他引用者，實作時 grep 確認）。

### 2. 設定頁入口（`apps/web/pages/settings/index.vue`）

「系統管理」區的 `<SettingsUsersCard />` 換成一個**入口列**（可點的 Card）：

```
[Users icon] 使用者管理                              →
            新增、停用、重設使用者帳號
```

點擊 `navigateTo('/settings/users')`。移除後「系統管理」區剩三張全域設定卡（AI 解析器／Telegram Bot／掃描設定），語意更聚焦於「全域基礎設施」。入口列與整個「系統管理」區維持現有的 `v-if="isAdmin"`。

### 3. 語彙替換（去家庭框架）

全站掃描並替換（實作時 grep `家人`、`成員` 確保無遺漏）：

| 位置 | 現有 | 改為 |
|---|---|---|
| 頁面／區塊標題 | 使用者管理（不變） | 使用者管理 |
| 副標 | 為家人建立獨立帳號，各自管理自己的帳單。 | 建立獨立帳號，每人各自管理自己的帳單。 |
| 新增按鈕 | 新增 | ＋ 新增使用者 |
| 新增對話框標題 | 新增成員帳號 | 新增使用者 |
| 新增對話框說明 | 把帳號密碼告訴家人，他們登入後可自行修改密碼。 | 設好帳號密碼交給對方，登入後可自行修改。 |
| 角色 badge | 管理者／成員 | 管理員／使用者 |
| 重設密碼 toast | 已重設 X 的密碼／該成員的所有裝置已被登出。 | 已重設 X 的密碼／該使用者的所有裝置已被登出。 |
| 停用對話框 | …其掃描與通知會暫停… | （文字已中性，維持；確認無「成員」字樣） |

**`UsersCard` 以外也要一併掃掉的殘留**（Codex review 補上 —— 若只改 `UsersCard` 會過不了本 spec 自己的「零殘留」驗收）：

| 檔案 | 現有 | 改為 |
|---|---|---|
| `pages/settings/index.vue` 帳號區身分列 | 管理者／成員 | 管理員／使用者 |
| `components/settings/IntegrationTelegram.vue` | 每位**成員**在「帳號」區各自綁定 | 每位使用者在「帳號」區各自綁定 |
| `components/settings/IntegrationTelegram.vue` | 目前沒有任何**成員**綁定 | 目前沒有任何使用者綁定 |
| `components/settings/ScanConfigCard.vue` | 套用到所有**成員**的信箱／檢查所有**成員**信箱 | 套用到所有使用者的信箱／檢查所有使用者信箱 |

實作時仍以 `grep -rn 家人\|成員 apps/web`（`.vue`／`.ts`）為準，上表為已知清單；發現新的一併中性化。

### 4. 存取控制

`/settings/users` 為 admin-only 雙層防護。**關鍵（Codex review）**：不能只用 `watch(isAdmin, …)` —— `middleware/auth.global.ts` 只抓 `/api/auth/me` 填 `authed`、**不填 `useMe`**，而 `me` 只在 `app.vue` 的 `onMounted` 才抓；member 直接載入 `/settings/users` 時 `me` 為 null、`isAdmin` 起始 false 且維持 false，watcher 可能永不觸發 → 頁面會渲染、甚至觸發 `fetchUsers`（後端 403，不外洩資料，但前端守門失效、導回不會發生）。

正確做法：**具名 route middleware，在元件掛載前把角色確定**。

- 新增 `apps/web/middleware/admin.ts`，頁面以 `definePageMeta({ middleware: 'admin' })` 掛上：
  ```ts
  export default defineNuxtRouteMiddleware(async () => {
    const { me, isAdmin, fetchMe } = useAuth()
    if (!me.value) await fetchMe()          // auth.global 沒填 me，這裡補
    if (!isAdmin.value) return navigateTo('/settings')
  })
  ```
  middleware 在渲染前 await 完成，member 不會看到頁面、也不會觸發 `fetchUsers`（onMounted 在通過 middleware 後才跑）。`fetchMe` 失敗（未登入）時 `me` 仍 null → `isAdmin` false → 導回；`auth.global.ts` 也會先攔未登入者。
- **後端**：`/api/users*` 本就 `ADMIN_ONLY` 回 403（多租戶已實作），為既有第二層。

### 5. 測試與驗收

- 無伺服器改動 → server 測試維持 67/67 不受影響（不需改後端測試）。
- `pnpm --filter @bill-alarm/web generate` 通過（新頁面納入預渲染）。
- 驗收：
  - admin：設定頁「系統管理」區出現「使用者管理」入口列 → 點進 `/settings/users` → 新增／重設密碼／停用／還原／永久刪除全部正常。
  - member：設定頁看不到入口（`v-if="isAdmin"`）；直接打 `/settings/users` 被導回 `/settings`。
  - 全站 grep `家人`、`成員` 零殘留（`.vue`／`.ts`）；角色顯示為 管理員／使用者。
  - 底部 5 tab、其他頁面不受影響。
