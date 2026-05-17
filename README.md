# 🏥 SillyTavern-DataDoctor

**SillyTavern 全方位資料健康診斷工具**

掃描酒館 `data/` 目錄下所有類型的資料檔案，偵測損壞、異常或潛在問題，產生結構化的 AI 可讀報告。

## ✨ 功能

- **14 類資料全面掃描**：聊天紀錄、角色卡、世界書、群組、預設檔、模板、主題等
- **三級嚴重度**：🔴 嚴重 / 🟡 警告 / 🔵 資訊
- **酒館錯誤日誌捕捉**：自動攔截 `console.error/warn`，一併納入報告
- **AI 可讀報告**：一鍵複製 Markdown 格式報告，直接貼給 AI 分析
- **安全刪除**：二次確認後刪除損壞檔案
- **零依賴**：不需要額外 npm 套件

## 📋 掃描項目

| 類型 | 檢查項目 |
|------|----------|
| 聊天紀錄 (.jsonl) | 空檔、逐行 JSON 解析、BOM、NULL 字元、異常大小 |
| 角色卡 (.json) | JSON 解析、缺少 `name` 欄位 |
| 世界書 (.json) | JSON 解析、缺少 `entries` 欄位 |
| 群組設定 (.json) | JSON 解析、缺少 `members` 欄位 |
| 預設檔 (.json) | JSON 解析、空檔 |
| 模板 (.json) | JSON 解析、空檔 |
| 主題 (.json) | JSON 解析、空檔 |
| 設定檔 | JSON 解析、檔案過大 |
| config.yaml | 空檔檢查 |

## 📦 安裝

### 方法一：Zeabur / Docker

將此 repo clone 到酒館的 `plugins/` 目錄：

```bash
cd plugins/
git clone https://github.com/Minijinai75/SillyTavern-DataDoctor.git
```

重新啟動酒館即可。插件會自動安裝前端擴充。

### 方法二：手動安裝

1. 下載此 repo
2. 放到 SillyTavern 的 `plugins/SillyTavern-DataDoctor/` 目錄
3. 重新啟動酒館

## 🚀 使用方式

1. 在酒館的擴充選單中點擊 **「資料健檢」**
2. 點擊 **「全面掃描」** 開始檢查
3. 查看掃描結果，展開各分類檢視問題詳情
4. 點擊 **「複製 AI 報告」** 將報告貼給 AI 討論解決方案
5. 可選擇刪除損壞的檔案（需二次確認）

## 📊 AI 報告範例

```markdown
# 🏥 SillyTavern 資料健康檢查報告
> 掃描時間：2026/5/17 下午2:20:00

## 📊 摘要
- 總掃描檔案：1,523
- 🔴 嚴重問題：3
- 🟡 警告：5
- 🔵 資訊：12

## 🔴 嚴重問題（需要立即處理）
### 1. 💬 個人聊天紀錄
- **檔案**：`default-user/chats/任宇成/任宇成 - 2026-03-21.jsonl`
- **錯誤**：第 15 行 JSON 解析失敗
- **建議**：此聊天紀錄在第 15 行損壞。建議刪除或手動修復。
...
```

## 🔧 API 端點

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/plugins/sillytavern-data-doctor/scan` | 全面掃描 |
| GET | `/api/plugins/sillytavern-data-doctor/scan?type=chats` | 指定類型掃描 |
| GET | `/api/plugins/sillytavern-data-doctor/report` | 取得 Markdown 報告 |
| GET | `/api/plugins/sillytavern-data-doctor/logs` | 取得捕捉的錯誤日誌 |
| POST | `/api/plugins/sillytavern-data-doctor/delete` | 刪除指定檔案 |

## 📜 授權

MIT License

## 👤 作者

Minijinai75
