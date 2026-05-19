# AI 股票分析面板

一个可部署到 Render.com 的全栈股票分析应用：用户输入股票代码，后端调用免费行情 API 获取报价，再调用 LLM 生成严格 JSON 分析，并把行情与分析结果写入 Supabase。

## 在线访问 URL

- 本地演示 URL：`http://127.0.0.1:3000`
- Render 线上 URL：`https://<your-render-service>.onrender.com`

> 部署到 Render 后，把上面的 Render URL 替换成真实服务地址再提交最终版 README。

## 别人电脑能不能用

可以，但前提是访问 Render 线上 URL，而不是访问你本机的 `127.0.0.1:3000`。

- 本机运行：只有你这台电脑能直接访问 `http://127.0.0.1:3000`。
- Render 部署：任何人打开 `https://<your-render-service>.onrender.com` 都能用。
- Render 环境变量：必须配置公网可访问的 `LLM_API_URL`、`LLM_API_KEY`、`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`。
- 本机 CPAMC：`http://127.0.0.1:8317/...` 只能给本机项目用，Render 不能访问这个本机地址。

## 交付清单

- 数据获取：`GET /api/stock?symbol=AAPL` 优先调用 Yahoo Finance chart 免费接口；A 股 6 位代码会自动转换为 `.SS` / `.SZ`，港股数字代码会自动补 `.HK`，还会调用 Yahoo Finance 搜索接口解析全球股票代码，A 股另有东方财富免费接口兜底，最后回退 Stooq。
- AI 分析：`POST /api/analyze` 调用 OpenAI-compatible LLM，并强制返回 `summary`、`sentiment`、`risk_level` 三个字段。
- 严格 JSON：请求体使用 `response_format: { type: "json_object" }`，后端继续用 `parseStrictAnalysisJson()` 和枚举校验兜底。
- Supabase 存储：配置 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 后，分析结果写入 `stock_analyses` 表。
- 前端页面：展示行情、LLM JSON、Prompt 证据、原始行情 JSON、Supabase 历史记录。
- 部署目标：Render Web Service，配置见 `render.yaml`。
- 部署自检：`GET /api/health` 会返回 `deploymentReady` 和 `deploymentBlockers`，`npm run check:deploy` 会阻止缺 key 或误用 localhost。

## 本地运行

```bash
cp .env.example .env
npm start
```

当前本机可用的 CPAMC 配置示例：

```env
LLM_API_URL=http://127.0.0.1:8317/api/provider/codex/v1/chat/completions
LLM_API_KEY=<your-local-cpamc-key>
LLM_MODEL=gpt-5.4
LLM_MOCK=false
```

如果只想看 UI，不调用真实 LLM：

```env
LLM_MOCK=true
```

部署前检查：

```bash
npm run check:deploy
```

这个命令会检查 Render 部署所需文件、LLM 环境变量、Supabase 环境变量，并阻止把 `127.0.0.1` 这种本机地址误填到 Render。

## Prompt 证据

前端页面有“Prompt 证据”区域，数据来自 `GET /api/prompt`，可直接截图作为作业交付材料。

后端 Prompt 代码在 `server.js` 的 `buildAnalysisMessages()`：

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

LLM 请求体会追加：

```js
response_format: { type: "json_object" }
```

后端硬校验：

- 返回内容必须是裸 JSON 对象，不能有 Markdown 或解释文字。
- `sentiment` 只能是 `Bullish`、`Neutral`、`Bearish`。
- `risk_level` 只能是 `Low`、`Medium`、`High`。

示例返回：

```json
{
  "summary": "AAPL收涨1.76%至297.84，较昨收走强，日内波动适中。",
  "sentiment": "Bullish",
  "risk_level": "Medium"
}
```

## Supabase 建表

在 Supabase SQL Editor 执行 `supabase-schema.sql`：

```sql
create table if not exists public.stock_analyses (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  requested_symbol text,
  provider text,
  price numeric,
  change numeric,
  change_percent numeric,
  volume numeric,
  market_time text,
  raw_stock_data jsonb not null,
  summary text not null,
  sentiment text not null check (sentiment in ('Bullish', 'Neutral', 'Bearish')),
  risk_level text not null check (risk_level in ('Low', 'Medium', 'High')),
  llm_model text,
  created_at timestamptz not null default now()
);
```

本地或 Render 环境变量：

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-secret-or-service-role-key
```

`Secret key` / `service_role` 只能放后端环境变量，不能暴露到前端代码；不要使用 `Publishable key`。

## API

```http
GET /api/health
GET /api/prompt
GET /api/stock?symbol=AAPL
GET /api/stock?symbol=601138
POST /api/analyze
GET /api/history
```

股票代码示例。项目不是固定这些股票，用户输入会实时调用免费接口查询：

- 美股：`AAPL`、`TSLA`、`NVDA`
- A 股：`601138` 会自动尝试 `601138.SS`，`000001` 会自动尝试 `000001.SZ`
- 港股：`0700.HK`，输入 `700` 会自动尝试 `0700.HK`
- 日本：`7203.T`
- 英国：`HSBA.L`
- 英文名搜索：`Toyota` 会通过 Yahoo Finance 搜索接口解析候选股票

免费 API 的覆盖范围取决于 Yahoo Finance、东方财富和 Stooq 是否提供该市场数据；无法保证全球每一只股票都 100% 有数据，但不是项目里写死的固定股票池。

`POST /api/analyze` 请求：

```json
{
  "symbol": "AAPL"
}
```

返回包含：

```json
{
  "stock": {},
  "analysis": {
    "summary": "string",
    "sentiment": "Bullish",
    "risk_level": "Medium"
  },
  "saved": {
    "ok": true
  }
}
```

## Render.com 部署

1. 把代码推到 GitHub。
2. 在 Render 新建 Web Service，连接 GitHub 仓库。
3. Build Command：`npm install`
4. Start Command：`npm start`
5. 配置环境变量：

```env
LLM_API_URL=https://api.openai.com/v1/chat/completions
LLM_API_KEY=<your-llm-api-key>
LLM_MODEL=gpt-4o-mini
SUPABASE_URL=<your-supabase-url>
SUPABASE_SERVICE_ROLE_KEY=<your-supabase-secret-or-service-role-key>
CORS_ORIGIN=*
```

注意：`127.0.0.1:8317` 是本机 CPAMC 地址，只适合本地运行。Render 上线时必须使用 Render 能访问到的 OpenAI-compatible API 地址。

部署后检查：

```bash
curl https://<your-render-service>.onrender.com/api/health
curl https://<your-render-service>.onrender.com/api/stock?symbol=AAPL
```

如果 `/api/health` 里 `supabaseConfigured` 是 `false`，说明 Render 环境变量没有正确配置 Supabase，历史记录不会写入数据库。

`/api/health` 会额外返回：

```json
{
  "deploymentReady": false,
  "deploymentBlockers": [
    "LLM_API_URL points to localhost; Render needs a public OpenAI-compatible endpoint.",
    "Supabase credentials are missing."
  ]
}
```

## GitHub 提交

```bash
git init
git add .
git commit -m "Build AI stock analysis panel"
git branch -M main
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

`.env` 已在 `.gitignore` 中，不会提交真实密钥。

## 最终提交前必须替换

- 把 `Render 线上 URL` 从 `https://<your-render-service>.onrender.com` 改成真实地址。
- 在 Supabase 执行 `supabase-schema.sql`。
- 在 Render 配置真实 `LLM_API_URL`、`LLM_API_KEY`、`LLM_MODEL`、`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`。
- 运行 `npm run check:deploy`，确认没有 blocking issues。
- 完成一次线上 `POST /api/analyze`，确认 `saved.ok` 为 `true`。

## Debug 记录

问题：输入 A 股代码 `601138` 时，前端提示 `Unable to fetch market data`，后端错误显示 `Yahoo Finance returned HTTP 404 | Stooq response does not include quote data`。

AI 工具定位过程：让 AI 检查后端 `fetchStockData()` 调用链后发现，用户输入的裸 6 位 A 股代码被当成美股代码直接请求 Yahoo，所以 `601138` 会 404；而 Yahoo Finance 对上海 A 股需要 `601138.SS`，深圳 A 股需要 `.SZ`。

修复方案：在后端增加全球股票解析逻辑：A 股 6 位代码自动补 `.SS` / `.SZ`，港股数字自动补 `.HK`，同时加入 Yahoo Finance 搜索接口解析全球股票候选，并保留东方财富和 Stooq 作为免费接口兜底。

验证结果：

```text
601138  -> 601138.SS / CNY / SHH
700     -> 0700.HK / HKD / HKG
7203.T  -> 7203.T / JPY / JPX
HSBA.L  -> HSBA.L / GBp / LSE
Toyota  -> TM / USD / NYQ
```

同一次修复后，`POST /api/analyze` 对 `7203.T` 已成功返回严格 JSON：

```json
{
  "summary": "7203.T收涨0.6%，高于前收，日内振幅温和，成交活跃，走势偏稳。",
  "sentiment": "Neutral",
  "risk_level": "Medium"
}
```

## 本地验收结果

- `GET /api/health`：服务正常，LLM 已配置，Supabase 未配置时会明确提示。
- `POST /api/analyze`：已用 `AAPL`、`601138`、`7203.T` 验证真实 LLM 调用成功。
- `GET /api/stock?symbol=Toyota`：通过 Yahoo Finance 搜索解析为 `TM`，验证英文名搜索不是固定股票池。
- 严格 JSON：后端会拒绝 Markdown、解释文字、缺字段、枚举错误、额外字段。
- 前端错误提示：行情失败和 AI 失败会直接显示在页面卡片里，不只靠 toast。
- 部署自检：`npm run check:deploy` 会在缺 Supabase 或 Render 误用 localhost LLM 地址时失败。
- Supabase 写入：已创建 `stock_analyses` 表，并用 `AAPL` 完成真实写入验证，返回 `saved_ok: true`。
