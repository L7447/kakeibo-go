# 記帳本 v3 — Go + Vercel 部署說明

## 📁 專案結構

```
kakeibo-go/
├── api/
│   └── index.go          ← Go 後端（Vercel Serverless Function）
├── templates/
│   └── index.html        ← 前端（請將修改後的 index.html 放這裡）
├── icon/                 ← 圖示資料夾（保持原有結構）
├── Guide column/         ← 導覽圖示
├── go.mod
└── vercel.json
```

## 🚀 Vercel 部署步驟

### Go 與 Python 的差異
| 項目 | Python (原版) | Go (新版) |
|------|-------------|---------|
| 入口檔 | `api/index.py` (Flask) | `api/index.go` (net/http) |
| Runtime | `python3.x` | `go` (自動偵測) |
| vercel.json | 需指定 `runtime: "python3.x"` | Go 會自動偵測，只需設 routes |
| 環境變數 | 相同 | 相同 |
| Redis (KV) | 相同 | 相同 |

### 步驟 1：安裝 Vercel CLI（已安裝可跳過）
```bash
npm install -g vercel
```

### 步驟 2：登入並連結專案
```bash
cd kakeibo-go
vercel link      # 連結到現有專案，或建立新專案
```

### 步驟 3：設定環境變數（Redis）
在 Vercel 控制台 → Project → Settings → Environment Variables：
```
REDIS_URL = rediss://...   （或 KV_URL）
```
也可用 CLI：
```bash
vercel env add REDIS_URL
```

### 步驟 4：部署
```bash
vercel --prod
```

## ⚠️ 靜態資源注意事項

Vercel Serverless Function 無法直接 serve 靜態資源目錄。
**有兩種解法：**

### 方法 A（推薦）：將 icon/ 放在 `public/` 資料夾
```
kakeibo-go/
├── public/
│   ├── icon/        ← 移到這裡
│   └── guide/       ← 移到這裡
```
Vercel 會自動 serve `public/` 下的靜態檔案，不需要經過 Go handler。
`vercel.json` 的 icon/guide 路由也可移除。

### 方法 B：透過 Go handler serve（目前設定）
現有 `vercel.json` 已將 `/icon/*` 和 `/guide/*` 路由到 Go，
Go handler 用 `http.ServeFile` 讀取檔案，但在 Vercel 環境下靜態檔
只有在 `public/` 才能被正確打包。

**結論：請使用方法 A，將 icon/ 和 Guide column/ 移到 public/ 下。**
前端 HTML 中的 `/icon/xxx` 路徑不需要改，Vercel 會自動處理。

## 🔧 本機開發測試

```bash
cd kakeibo-go
go run api/index.go        # 直接跑（需在 main.go 加 http.ListenAndServe）
# 或用 vercel dev
vercel dev
```

### 本機測試用 main.go（可選）
在 `api/` 目錄新增 `main.go`：
```go
//go:build ignore

package main

import (
    "net/http"
    handler "kakeibo/api"
)

func main() {
    http.HandleFunc("/", handler.Handler)
    http.ListenAndServe(":5000", nil)
}
```
```bash
go run api/main.go
```

## 📌 Go 版本與 Python 版本功能對照

所有 API 端點完整保留：
- ✅ GET/POST/DELETE/PUT `/api/records`
- ✅ GET `/api/report`
- ✅ GET `/api/settings`
- ✅ CRUD `/api/settings/categories/:type`
- ✅ CRUD `/api/settings/accounts`
- ✅ CRUD `/api/settings/account_groups`
- ✅ CRUD `/api/settings/merchants`
- ✅ CRUD `/api/settings/experts`
- ✅ CRUD `/api/settings/note_tags`
- ✅ GET `/api/icons` + `/api/icon-categories`
- ✅ GET `/api/backup`
- ✅ POST `/api/restore`
- ✅ POST `/api/reset` + `/api/reset-records`
