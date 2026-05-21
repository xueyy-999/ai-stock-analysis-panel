# AI 股票分析面板（精简版）交付说明

## 1. 提交链接

| 类型 | URL |
| --- | --- |
| 在线访问 URL | `https://ai-stock-analysis-panel-lsmq.onrender.com` |
| 交付说明 URL | `https://github.com/xueyy-999/ai-stock-analysis-panel/blob/main/DELIVERY.md` |
| GitHub 仓库 URL | `https://github.com/xueyy-999/ai-stock-analysis-panel` |

本文件用于集中展示题目要求的 Prompt 代码/截图说明、Debug 记录、完整技术栈和核心功能验收结果。

## 2. 题目要求对照

| 要求 | 实现情况 | 关键文件/接口 |
| --- | --- | --- |
| 用户输入股票代码，调用免费 API 获取行情数据 | 已实现，支持美股、A 股、港股、日股、英股及英文公司名搜索 | `GET /api/stock?symbol=AAPL`、`server.js` |
| 点击按钮调用 LLM API 分析行情 | 已实现，前端按钮 `AI Analyze` 调用后端分析接口 | `POST /api/analyze`、`public/app.js` |
| LLM 必须返回严格 JSON | 已实现 Prompt 约束、`response_format`、后端二次校验 | `buildAnalysisMessages()`、`parseStrictAnalysisJson()` |
| JSON 包含 `summary`、`sentiment`、`risk_level` | 已实现，其中 `risk_level` 对应题目中的 risk level | `normalizeAnalysis()` |
| 存储到 Supabase | 已实现，分析结果写入 `stock_analyses` 表 | `saveAnalysis()`、`supabase-schema.sql` |
| 部署到 Render.com | 已部署 | `https://ai-stock-analysis-panel-lsmq.onrender.com` |
| GitHub 提交 | 已提交 | `https://github.com/xueyy-999/ai-stock-analysis-panel` |
| README 包含在线 URL、Prompt、Debug 记录 | 已包含 | `README.md` |

## 3. 完整技术栈说明

### 前端

- 原生 `HTML` / `CSS` / `JavaScript`，无前端构建步骤。
- 页面位于 `public/index.html`，交互逻辑位于 `public/app.js`，样式位于 `public/styles.css`。
- UI 展示行情卡片、AI 分析结果、历史记录、Prompt Payload 和原始行情 JSON。

### 后端

- `Node.js` 原生 `http` 服务，入口文件为 `server.js`。
- 无第三方运行依赖，降低部署复杂度。
- 暴露接口：
  - `GET /api/health`
  - `GET /api/prompt`
  - `GET /api/stock?symbol=AAPL`
  - `POST /api/analyze`
  - `GET /api/history`

### 行情数据源

- `Yahoo Finance chart`：主行情数据源。
- `Yahoo Finance search`：用于英文公司名和全球股票代码解析，例如 `Toyota -> TM`。
- `Eastmoney`：A 股兜底数据源。
- `Stooq`：最终免费行情兜底。

### LLM 分析

- 使用 OpenAI-compatible Chat Completions API。
- 本地开发可接 CPAMC；Render 部署使用公网可访问的 OpenAI-compatible LLM API 地址。
- LLM 输出由 Prompt、`response_format` 和后端校验共同约束。

### 数据库存储

- 使用 Supabase Postgres。
- 表结构文件：`supabase-schema.sql`。
- 写入方式：后端通过 Supabase REST API 写入 `stock_analyses` 表。
- `service_role` / `secret key` 只保存在服务端环境变量中，不暴露到前端。

### 部署与版本控制

- 部署平台：Render.com Web Service。
- Build Command：`npm install`。
- Start Command：`npm start`。
- 代码托管：GitHub。

## 4. AI 工具使用记录

开发过程中使用 AI 工具辅助完成以下工作：

- 梳理全栈应用结构：前端页面、Node 后端、Supabase 存储和 Render 部署流程。
- 设计 LLM Prompt：要求模型只返回严格 JSON，禁止 Markdown、解释文字和额外字段。
- 调试接口问题：定位 A 股代码 `601138` 查询失败的原因，并补充 `.SS` / `.SZ` / `.HK` 等全球股票代码解析逻辑。
- 完善验收材料：整理 Prompt 代码、Debug 记录、技术栈说明和线上验收结果。

## 5. Prompt 代码与严格 JSON 设计

Prompt 代码位于 `server.js` 的 `buildAnalysisMessages()`。

```js
function buildAnalysisMessages(stock) {
  return [
    {
      role: "system",
      content: [
        "You are a stock-analysis API.",
        "Return exactly one valid JSON object and nothing else.",
        "Do not use markdown, code fences, comments, prose, or extra keys.",
        'The JSON schema is: {"summary":"string","sentiment":"Bullish|Neutral|Bearish","risk_level":"Low|Medium|High"}.',
        "Base the answer only on the supplied market data.",
        "Keep summary under 80 Chinese characters."
      ].join(" ")
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "Analyze this stock quote and return strict JSON only.",
        stock
      })
    }
  ];
}
```

LLM 请求体中同时启用 JSON 模式：

```js
requestBody.response_format = { type: "json_object" };
```

后端二次校验规则：

- 响应必须是裸 JSON 对象，不能有 Markdown、代码块或解释文字。
- JSON 必须能被 `JSON.parse()` 正常解析。
- 只允许三个字段：`summary`、`sentiment`、`risk_level`。
- `sentiment` 只允许 `Bullish`、`Neutral`、`Bearish`。
- `risk_level` 只允许 `Low`、`Medium`、`High`。

示例返回：

```json
{
  "summary": "AAPL收涨1.13%，放量上行并收于日内高位附近，短线偏强。",
  "sentiment": "Bullish",
  "risk_level": "Medium"
}
```

## 6. Prompt 截图说明

在线页面底部提供 `Prompt Payload` 区域，数据来自：

```http
GET /api/prompt
```

该区域可直接作为 Prompt 截图证据，展示内容包括：

- `system` prompt。
- `user` prompt。
- `response_format: { "type": "json_object" }`。
- 后端 validators。

对应页面 URL：

```text
https://ai-stock-analysis-panel-lsmq.onrender.com
```

## 7. Debug 记录：A 股代码查询失败

### 问题现象

输入 A 股代码 `601138` 时，前端提示：

```text
Unable to fetch market data
```

后端错误信息显示 Yahoo Finance 返回 404，Stooq 也没有对应行情数据。

### AI 工具排查过程

使用 AI 工具辅助检查 `server.js` 中的 `fetchStockData()` 调用链后，定位到问题根因：

- 用户输入的 `601138` 是裸 6 位 A 股代码。
- 原实现直接把 `601138` 当作美股代码请求 Yahoo Finance。
- Yahoo Finance 对 A 股要求带交易所后缀：
  - 上海证券交易所：`.SS`
  - 深圳证券交易所：`.SZ`

### 修复方案

- 6 位 A 股代码自动转换为 Yahoo Finance 可识别格式：
  - `601138 -> 601138.SS`
  - `000001 -> 000001.SZ`
- 港股数字代码自动补零并追加 `.HK`：
  - `700 -> 0700.HK`
- 增加 Yahoo Finance search，用于解析英文公司名：
  - `Toyota -> TM`
- 增加东方财富 A 股兜底。
- 保留 Stooq 作为最后一层免费行情兜底。

### 验证结果

```text
AAPL    -> AAPL / USD / Yahoo Finance chart
601138  -> 601138.SS / CNY / Yahoo Finance chart
700     -> 0700.HK / HKD / Yahoo Finance chart
7203.T  -> 7203.T / JPY / Yahoo Finance chart
Toyota  -> TM / USD / Yahoo Finance search + chart
```

该 Debug 记录展示了 AI 工具用于定位接口兼容性问题，并通过补充股票代码解析策略完成修复。

## 8. 本地与线上验收结果

### 本地验收

- `GET /api/health`：LLM 与 Supabase 配置可检测。
- `GET /api/stock?symbol=AAPL`：行情数据返回正常。
- `POST /api/analyze`：LLM 返回严格 JSON。
- `GET /api/history`：可读取 Supabase 历史记录。

### 线上验收

线上访问地址：

```text
https://ai-stock-analysis-panel-lsmq.onrender.com
```

已验证线上 `POST /api/analyze` 返回严格 JSON，并写入 Supabase：

```json
{
  "symbol": "AAPL",
  "summary": "AAPL收涨1.13%，放量上行并收于日内高位附近，短线偏强。",
  "sentiment": "Bullish",
  "risk_level": "Medium",
  "saved_ok": true
}
```

## 9. 环境变量说明

Render 环境变量：

```env
NODE_VERSION=20
LLM_API_URL=https://your-public-openai-compatible-endpoint/v1/chat/completions
LLM_API_KEY=your-llm-api-key
LLM_MODEL=gpt-4o-mini
SUPABASE_URL=https://tczvlvutwilzrnyogppl.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-secret-key
CORS_ORIGIN=*
```

安全说明：

- `.env` 已加入 `.gitignore`，不会提交真实密钥。
- Supabase secret key 只在后端环境变量中使用。
- Render 不能访问 `127.0.0.1`，因此部署环境必须使用公网可访问的 LLM API。
