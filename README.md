# AI 股票分析面板（精简版）

一个可部署到 Render.com 的全栈小应用：用户输入股票代码，后端调用免费行情接口获取数据，再调用 LLM 生成严格 JSON 分析，并把结果写入 Supabase。

## 在线访问 URL

- Render URL：`https://<your-render-service>.onrender.com`
- 本地开发 URL：`http://localhost:3000`

当前仓库不包含 Render、GitHub、Supabase、LLM 的账号凭据；部署后把上面的 Render URL 替换为真实线上地址。

## 功能

- 行情数据：优先使用 Yahoo Finance chart 免费接口，失败后回退到 Stooq 免费接口。
- AI 分析：调用 OpenAI-compatible Chat Completions API，要求返回严格 JSON。
- 存储：后端通过 Supabase REST API 写入 `stock_analyses` 表。
- 前端：原生 HTML/CSS/JS，无构建步骤。
- 后端：原生 Node.js HTTP 服务，无第三方依赖。

## 本地运行

```bash
cp .env.example .env
npm start
```

本地只看 UI 可把 `.env` 中 `LLM_MOCK=true`。真实验收请配置 `LLM_API_KEY`、`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`。

## Supabase 建表

在 Supabase SQL Editor 执行 [supabase-schema.sql](./supabase-schema.sql)。

关键字段：

- `summary`
- `sentiment`：`Bullish` / `Neutral` / `Bearish`
- `risk_level`：`Low` / `Medium` / `High`
- `raw_stock_data`：完整行情 JSON

## Prompt 代码

后端在 [server.js](./server.js) 的 `buildAnalysisMessages()` 中强制 LLM 只输出 JSON：

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

请求体同时设置：

```js
response_format: { type: "json_object" }
```

后端还会校验 JSON 必须是裸对象，且 `sentiment` 和 `risk_level` 只能使用指定枚举值。

## API

```http
GET /api/stock?symbol=AAPL
POST /api/analyze
GET /api/history
GET /api/health
```

`POST /api/analyze` 请求：

```json
{
  "symbol": "AAPL"
}
```

LLM 返回并保存的 JSON：

```json
{
  "summary": "AAPL 价格保持强势，但需关注短期波动。",
  "sentiment": "Bullish",
  "risk_level": "Medium"
}
```

## Render.com 部署

1. 把代码推到 GitHub。
2. 在 Render 新建 Web Service，连接该 GitHub 仓库。
3. Build Command：`npm install`
4. Start Command：`npm start`
5. 配置环境变量：

```text
LLM_API_URL=https://api.openai.com/v1/chat/completions
LLM_API_KEY=<your-llm-api-key>
LLM_MODEL=gpt-4o-mini
SUPABASE_URL=<your-supabase-url>
SUPABASE_SERVICE_ROLE_KEY=<your-supabase-service-role-key>
```

仓库也提供了 [render.yaml](./render.yaml)，可以用 Render Blueprint 部署。

## GitHub 提交

```bash
git init
git add .
git commit -m "Build AI stock analysis panel"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

## Debug 记录

问题：第一次调 LLM 时，模型可能返回 Markdown 代码块，例如 ```json 包裹的内容，导致 `JSON.parse()` 报错。

定位：后端日志显示 `LLM did not return a bare JSON object`，说明模型输出包含 JSON 之外的字符。

解决：在 system prompt 中加入 `Return exactly one valid JSON object and nothing else`、禁止 markdown/code fences/extra keys，并在请求体增加 `response_format: { type: "json_object" }`。随后后端继续用 `parseStrictAnalysisJson()` 做硬校验，避免脏数据写入 Supabase。
