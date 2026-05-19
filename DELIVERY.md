# AI 股票分析面板交付说明

本文件用于作业/面试题提交，集中说明 Prompt 设计、Debug 记录、完整技术栈与验收结果。

## 提交 URL

- 在线访问 URL：`https://ai-stock-analysis-panel-lsmq.onrender.com`
- 交付说明 URL：`https://github.com/xueyy-999/ai-stock-analysis-panel/blob/main/DELIVERY.md`
- GitHub 仓库 URL：`https://github.com/xueyy-999/ai-stock-analysis-panel`

## 完整技术栈

- 前端：原生 HTML、CSS、JavaScript，无构建工具，静态资源放在 `public/`。
- 后端：Node.js 原生 `http` 服务，入口文件为 `server.js`，无第三方运行依赖。
- 行情数据：Yahoo Finance chart 免费接口优先；Yahoo Finance search 用于公司名/全球代码解析；东方财富用于 A 股兜底；Stooq 用于最终兜底。
- AI 分析：OpenAI-compatible Chat Completions API；本地开发可接 CPAMC，Render 部署需使用公网可访问的 LLM API。
- JSON 约束：Prompt 要求只返回裸 JSON；请求体使用 `response_format: { "type": "json_object" }`；后端再次校验字段和枚举值。
- 数据库存储：Supabase Postgres，通过 Supabase REST API 写入 `stock_analyses` 表。
- 部署平台：Render.com Web Service，Build Command 为 `npm install`，Start Command 为 `npm start`。
- 版本控制：Git + GitHub。

## 核心功能验收

- 数据获取：用户输入 `AAPL`、`601138`、`0700.HK`、`7203.T`、`Toyota` 等代码/名称，后端实时调用免费行情 API。
- AI 分析：点击 AI Analyze 后，后端调用 LLM，返回 `summary`、`sentiment`、`risk_level`。
- 严格 JSON：后端拒绝 Markdown、解释文字、缺字段、额外字段和错误枚举。
- Supabase 存储：已创建 `stock_analyses` 表，真实写入 `AAPL` 分析记录成功，返回 `saved_ok: true`。
- 历史记录：`GET /api/history` 能从 Supabase 读取最新分析记录。

## Prompt 代码

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

LLM 请求体追加 JSON 模式：

```js
requestBody.response_format = { type: "json_object" };
```

后端硬校验逻辑：

- 返回内容必须以 `{` 开头并以 `}` 结尾。
- 必须能被 `JSON.parse()` 解析。
- 只能包含 `summary`、`sentiment`、`risk_level` 三个 key。
- `sentiment` 只能是 `Bullish`、`Neutral`、`Bearish`。
- `risk_level` 只能是 `Low`、`Medium`、`High`。

## Prompt 截图说明

前端页面底部有 `Prompt Payload` 区域，数据来自 `GET /api/prompt`，可直接截图作为 Prompt 证据。该区域展示：

- system prompt
- user prompt
- `response_format`
- 后端 validators

## 严格 JSON 示例

```json
{
  "summary": "AAPL收涨1.76%至297.84，量能3446万股，短线偏强但盘中波动明显。",
  "sentiment": "Bullish",
  "risk_level": "Medium"
}
```

## Debug 记录

问题：输入 A 股代码 `601138` 时，前端提示 `Unable to fetch market data`，后端日志显示 Yahoo Finance 返回 404，Stooq 也没有对应数据。

定位过程：用 AI 工具检查 `fetchStockData()` 调用链后发现，裸 6 位 A 股代码被当成美股代码直接请求 Yahoo Finance，例如 `601138`。但 Yahoo Finance 对 A 股需要交易所后缀：上海为 `.SS`，深圳为 `.SZ`。

修复方案：

- 对 6 位 A 股代码自动补 `.SS` 或 `.SZ`。
- 对港股数字代码自动补零并追加 `.HK`。
- 增加 Yahoo Finance search，用于 `Toyota` 这类公司名解析。
- 增加东方财富 A 股兜底。
- 保留 Stooq 作为最终免费接口兜底。

验证结果：

```text
AAPL    -> AAPL / USD / Yahoo Finance chart
601138  -> 601138.SS / CNY / Yahoo Finance chart
700     -> 0700.HK / HKD / Yahoo Finance chart
7203.T  -> 7203.T / JPY / Yahoo Finance chart
Toyota  -> TM / USD / Yahoo Finance search + chart
```

## 部署说明

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

注意：Render 不能使用本机地址 `http://127.0.0.1:8317/...`，因为这是本机 CPAMC，只能在本机访问。

