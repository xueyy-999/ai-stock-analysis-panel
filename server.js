const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { URL } = require("url");

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");

const CONFIG = {
  llmApiUrl: process.env.LLM_API_URL || "https://api.openai.com/v1/chat/completions",
  llmApiKey: process.env.LLM_API_KEY || "",
  llmModel: process.env.LLM_MODEL || "gpt-4o-mini",
  llmMock: process.env.LLM_MOCK === "true",
  disableResponseFormat: process.env.LLM_DISABLE_RESPONSE_FORMAT === "true",
  supabaseUrl: trimSlash(process.env.SUPABASE_URL || ""),
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ""
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/health" && req.method === "GET") {
      const deploymentBlockers = getDeploymentBlockers();
      sendJson(res, 200, {
        ok: true,
        llmConfigured: Boolean(CONFIG.llmApiKey) || CONFIG.llmMock,
        supabaseConfigured: Boolean(CONFIG.supabaseUrl && CONFIG.supabaseKey),
        llmModel: CONFIG.llmMock ? "mock" : CONFIG.llmModel,
        llmApiUrl: CONFIG.llmApiUrl,
        strictJson: true,
        deploymentReady: deploymentBlockers.length === 0,
        deploymentBlockers,
        marketDataProviders: [
          "Yahoo Finance chart",
          "Yahoo Finance search",
          "Eastmoney A-share fallback",
          "Stooq fallback"
        ]
      });
      return;
    }

    if (url.pathname === "/api/prompt" && req.method === "GET") {
      sendJson(res, 200, {
        schema: {
          summary: "string",
          sentiment: "Bullish|Neutral|Bearish",
          risk_level: "Low|Medium|High"
        },
        messages: buildAnalysisMessages(samplePromptStock()),
        response_format: CONFIG.disableResponseFormat ? null : { type: "json_object" },
        validators: [
          "Response must be a bare JSON object.",
          "sentiment must be Bullish, Neutral, or Bearish.",
          "risk_level must be Low, Medium, or High."
        ]
      });
      return;
    }

    if (url.pathname === "/api/stock" && req.method === "GET") {
      const symbol = cleanSymbol(url.searchParams.get("symbol"));
      const stock = await fetchStockData(symbol);
      sendJson(res, 200, { stock });
      return;
    }

    if (url.pathname === "/api/analyze" && req.method === "POST") {
      const body = await readJsonBody(req);
      const symbol = cleanSymbol(body.symbol);
      const stock = await fetchStockData(symbol);
      const analysis = await analyzeStockWithLLM(stock);
      const saved = await saveAnalysis(stock, analysis);
      sendJson(res, 200, { stock, analysis, saved });
      return;
    }

    if (url.pathname === "/api/history" && req.method === "GET") {
      const history = await fetchHistory();
      sendJson(res, 200, { history });
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    const status = error.statusCode || 500;
    sendJson(res, status, {
      error: error.publicMessage || "Server error",
      detail: process.env.NODE_ENV === "production" ? undefined : error.message
    });
  }
});

server.listen(PORT, () => {
  console.log(`AI stock analysis panel running on http://localhost:${PORT}`);
});

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const envText = fs.readFileSync(envPath, "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function serveStatic(requestPath, res) {
  const normalizedPath = decodeURIComponent(requestPath === "/" ? "/index.html" : requestPath);
  const filePath = path.normalize(path.join(PUBLIC_DIR, normalizedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    throw httpError(403, "Forbidden");
  }

  try {
    const data = await fsp.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      const index = await fsp.readFile(path.join(PUBLIC_DIR, "index.html"));
      res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
      res.end(index);
      return;
    }
    throw error;
  }
}

async function fetchStockData(symbol) {
  const errors = [];
  const triedSymbols = new Set();

  for (const candidate of yahooSymbolCandidates(symbol)) {
    triedSymbols.add(candidate.toUpperCase());
    try {
      return await fetchYahooChart(candidate, symbol);
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }

  if (/^\d{6}$/.test(symbol)) {
    try {
      return await fetchEastMoneyQuote(symbol);
    } catch (error) {
      errors.push(`Eastmoney: ${error.message}`);
    }
  }

  try {
    return await fetchYahooSearchQuote(symbol, triedSymbols);
  } catch (error) {
    errors.push(`Yahoo search: ${error.message}`);
  }

  try {
    return await fetchStooqQuote(symbol);
  } catch (error) {
    errors.push(`Stooq: ${error.message}`);
  }

  throw httpError(502, `Unable to fetch market data for ${symbol}: ${errors.join(" | ")}`);
}

function yahooSymbolCandidates(symbol) {
  const candidates = [symbol, toYahooSymbol(symbol), toHongKongSymbol(symbol)].filter(Boolean);
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = candidate.toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toHongKongSymbol(symbol) {
  if (!/^\d{1,5}$/.test(symbol) || /^\d{6}$/.test(symbol)) return null;
  return `${symbol.padStart(4, "0")}.HK`;
}

async function fetchYahooSearchQuote(symbol, triedSymbols) {
  const searchUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=12&newsCount=0&enableFuzzyQuery=true`;
  const response = await fetch(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 ai-stock-analysis-panel/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Yahoo search returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  const quotes = Array.isArray(payload.quotes) ? payload.quotes : [];
  const candidates = quotes
    .filter((quote) => ["EQUITY", "ETF"].includes(quote.quoteType))
    .map((quote) => quote.symbol)
    .filter(Boolean);

  if (!candidates.length) {
    throw new Error("No equity candidates found");
  }

  const errors = [];
  for (const candidate of candidates) {
    const key = candidate.toUpperCase();
    if (triedSymbols.has(key)) continue;
    triedSymbols.add(key);
    try {
      return await fetchYahooChart(candidate, symbol, "Yahoo Finance search + chart");
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }

  throw new Error(errors.length ? errors.join(" | ") : "All search candidates were already tried");
}

function toYahooSymbol(symbol) {
  if (!/^\d{6}$/.test(symbol)) return symbol;
  if (/^(60|68|90)/.test(symbol)) return `${symbol}.SS`;
  if (/^(00|30|20)/.test(symbol)) return `${symbol}.SZ`;
  return symbol;
}

async function fetchYahooChart(symbol, requestedSymbol = symbol, provider = "Yahoo Finance chart") {
  const apiUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const response = await fetch(apiUrl, {
    headers: {
      "User-Agent": "ai-stock-analysis-panel/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  const chart = payload.chart || {};
  if (chart.error) {
    throw new Error(chart.error.description || "Yahoo Finance chart error");
  }

  const result = chart.result && chart.result[0];
  if (!result || !result.meta) {
    throw new Error("Yahoo Finance response is missing chart data");
  }

  const meta = result.meta;
  const quotes = result.indicators && result.indicators.quote && result.indicators.quote[0];
  if (!quotes) {
    throw new Error("Yahoo Finance response is missing quote data");
  }

  const latestIndex = findLatestIndex(quotes.close);
  const price = numberOrNull(meta.regularMarketPrice) ?? numberOrNull(quotes.close[latestIndex]);
  const previousClose = numberOrNull(meta.previousClose) ?? numberOrNull(meta.chartPreviousClose) ?? previousCloseFromSeries(quotes.close, latestIndex);

  if (price === null) {
    throw new Error("Yahoo Finance response does not include a valid price");
  }

  const change = previousClose === null ? null : round(price - previousClose, 4);
  const changePercent = previousClose === null || previousClose === 0 ? null : round((change / previousClose) * 100, 2);
  const marketTime = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null;

  return {
    symbol: String(meta.symbol || symbol).toUpperCase(),
    requestedSymbol,
    provider,
    currency: meta.currency || null,
    exchange: meta.exchangeName || meta.fullExchangeName || null,
    marketTime,
    open: numberOrNull(quotes.open[latestIndex]),
    high: numberOrNull(quotes.high[latestIndex]),
    low: numberOrNull(quotes.low[latestIndex]),
    close: price,
    previousClose,
    change,
    changePercent,
    volume: numberOrNull(quotes.volume[latestIndex]),
    raw: {
      resolvedSymbol: symbol,
      dataGranularity: meta.dataGranularity,
      range: meta.range,
      timezone: meta.timezone
    }
  };
}

async function fetchEastMoneyQuote(symbol) {
  if (!/^\d{6}$/.test(symbol)) {
    throw new Error("Eastmoney only supports 6-digit A-share codes in this app");
  }

  const market = /^(60|68|90)/.test(symbol) ? "1" : "0";
  const secid = `${market}.${symbol}`;
  const fields = [
    "f43",
    "f44",
    "f45",
    "f46",
    "f47",
    "f48",
    "f57",
    "f58",
    "f60",
    "f107",
    "f168",
    "f169",
    "f170"
  ].join(",");
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${encodeURIComponent(secid)}&fields=${encodeURIComponent(fields)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 ai-stock-analysis-panel/1.0",
      "Referer": "https://quote.eastmoney.com/"
    }
  });

  if (!response.ok) {
    throw new Error(`Eastmoney returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  const data = payload.data;
  if (!data || payload.rc !== 0) {
    throw new Error("Eastmoney response does not include quote data");
  }

  const price = scaledEastMoneyPrice(data.f43);
  const previousClose = scaledEastMoneyPrice(data.f60);
  if (price === null) {
    throw new Error("Eastmoney price is invalid");
  }

  const change = numberOrNull(data.f169) !== null ? round(data.f169 / 100, 4) : previousClose === null ? null : round(price - previousClose, 4);
  const changePercent = numberOrNull(data.f170) !== null ? round(data.f170 / 100, 2) : previousClose === null || previousClose === 0 ? null : round((change / previousClose) * 100, 2);

  return {
    symbol: String(data.f57 || symbol).toUpperCase(),
    requestedSymbol: symbol,
    provider: "Eastmoney",
    name: data.f58 || null,
    currency: "CNY",
    exchange: market === "1" ? "SSE" : "SZSE",
    marketTime: new Date().toISOString(),
    open: scaledEastMoneyPrice(data.f46),
    high: scaledEastMoneyPrice(data.f44),
    low: scaledEastMoneyPrice(data.f45),
    close: price,
    previousClose,
    change,
    changePercent,
    volume: numberOrNull(data.f47) === null ? null : Number(data.f47) * 100,
    amount: numberOrNull(data.f48),
    raw: {
      secid,
      market: data.f107,
      sourceName: data.f58
    }
  };
}

async function fetchStooqQuote(symbol) {
  const stooqSymbol = toStooqSymbol(symbol);
  const quoteUrl = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol)}&f=sd2t2ohlcv&h&e=csv`;
  const response = await fetch(quoteUrl, {
    headers: {
      "User-Agent": "ai-stock-analysis-panel/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Stooq returned HTTP ${response.status}`);
  }

  const rows = parseCsv(await response.text());
  const row = rows[0];
  if (!row || row.Close === "N/D") {
    throw new Error("Stooq response does not include quote data");
  }

  const close = numberOrNull(row.Close);
  if (close === null) {
    throw new Error("Stooq close price is invalid");
  }

  const previousClose = await fetchStooqPreviousClose(stooqSymbol);
  const change = previousClose === null ? null : round(close - previousClose, 4);
  const changePercent = previousClose === null || previousClose === 0 ? null : round((change / previousClose) * 100, 2);

  return {
    symbol: String(row.Symbol || symbol).toUpperCase(),
    requestedSymbol: symbol,
    provider: "Stooq",
    currency: null,
    exchange: null,
    marketTime: row.Date && row.Time ? `${row.Date} ${row.Time}` : row.Date || null,
    open: numberOrNull(row.Open),
    high: numberOrNull(row.High),
    low: numberOrNull(row.Low),
    close,
    previousClose,
    change,
    changePercent,
    volume: numberOrNull(row.Volume),
    raw: {
      stooqSymbol
    }
  };
}

async function fetchStooqPreviousClose(stooqSymbol) {
  const today = new Date();
  const from = new Date(today);
  from.setDate(today.getDate() - 14);
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&d1=${formatDate(from)}&d2=${formatDate(today)}&i=d`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "ai-stock-analysis-panel/1.0"
      }
    });
    if (!response.ok) return null;

    const rows = parseCsv(await response.text());
    const closes = rows.map((row) => numberOrNull(row.Close)).filter((value) => value !== null);
    return closes.length >= 2 ? closes[closes.length - 2] : null;
  } catch {
    return null;
  }
}

async function analyzeStockWithLLM(stock) {
  if (CONFIG.llmMock) {
    return mockAnalysis(stock);
  }

  if (!CONFIG.llmApiKey) {
    throw httpError(500, "LLM_API_KEY is not configured. Set it in Render or .env before running AI analysis.");
  }

  const messages = buildAnalysisMessages(stock);
  const requestBody = {
    model: CONFIG.llmModel,
    temperature: 0.2,
    messages
  };

  if (!CONFIG.disableResponseFormat) {
    requestBody.response_format = { type: "json_object" };
  }

  const headers = {
    "Authorization": `Bearer ${CONFIG.llmApiKey}`,
    "Content-Type": "application/json",
    "User-Agent": "ai-stock-analysis-panel/1.0"
  };

  if (/pinggy/i.test(CONFIG.llmApiUrl)) {
    headers["X-Pinggy-No-Screen"] = "true";
  }

  const response = await fetch(CONFIG.llmApiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody)
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw httpError(response.status, `LLM API failed: ${responseText.slice(0, 300)}`);
  }

  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw httpError(502, "LLM API returned non-JSON transport response.");
  }

  const content = extractChatContent(payload);
  if (!content) {
    throw httpError(502, "LLM API response did not include message content.");
  }

  const analysis = parseStrictAnalysisJson(content);
  return normalizeAnalysis(analysis);
}

function extractChatContent(payload) {
  const message = payload.choices && payload.choices[0] && payload.choices[0].message;
  const content = message && message.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        if (part && typeof part.content === "string") return part.content;
        return "";
      })
      .join("")
      .trim();
  }

  if (content && typeof content === "object") {
    return JSON.stringify(content);
  }

  return "";
}

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

function samplePromptStock() {
  return {
    symbol: "AAPL",
    provider: "Yahoo Finance chart",
    currency: "USD",
    exchange: "NMS",
    close: 297.84,
    previousClose: 292.68,
    change: 5.16,
    changePercent: 1.76,
    volume: 34463500,
    marketTime: "2026-05-18T20:00:01Z"
  };
}

function parseStrictAnalysisJson(content) {
  const trimmed = String(content).trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw httpError(502, "LLM did not return a bare JSON object.");
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw httpError(502, `LLM JSON parse failed: ${error.message}`);
  }
}

function normalizeAnalysis(analysis) {
  if (!analysis || Array.isArray(analysis) || typeof analysis !== "object") {
    throw httpError(502, "LLM response must be a JSON object.");
  }

  const allowedKeys = new Set(["summary", "sentiment", "risk_level"]);
  const extraKeys = Object.keys(analysis).filter((key) => !allowedKeys.has(key));
  if (extraKeys.length) {
    throw httpError(502, `LLM returned extra keys: ${extraKeys.join(", ")}.`);
  }

  const normalized = {
    summary: stringField(analysis.summary, "summary"),
    sentiment: stringField(analysis.sentiment, "sentiment"),
    risk_level: stringField(analysis.risk_level, "risk_level")
  };

  const sentiments = new Set(["Bullish", "Neutral", "Bearish"]);
  const risks = new Set(["Low", "Medium", "High"]);

  if (!sentiments.has(normalized.sentiment)) {
    throw httpError(502, "LLM sentiment must be Bullish, Neutral, or Bearish.");
  }
  if (!risks.has(normalized.risk_level)) {
    throw httpError(502, "LLM risk_level must be Low, Medium, or High.");
  }

  return normalized;
}

function getDeploymentBlockers() {
  const blockers = [];

  if (!CONFIG.llmMock && !CONFIG.llmApiKey) {
    blockers.push("LLM_API_KEY is missing.");
  }

  if (!CONFIG.llmMock && isLocalhostUrl(CONFIG.llmApiUrl)) {
    blockers.push("LLM_API_URL points to localhost; Render needs a public OpenAI-compatible endpoint.");
  }

  if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey) {
    blockers.push("Supabase credentials are missing.");
  }

  return blockers;
}

function isLocalhostUrl(value) {
  return /(^|\/\/)(127\.0\.0\.1|localhost)(:|\/|$)/i.test(String(value || ""));
}

async function saveAnalysis(stock, analysis) {
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey) {
    return {
      ok: false,
      skipped: true,
      reason: "Supabase is not configured."
    };
  }

  const response = await fetch(`${CONFIG.supabaseUrl}/rest/v1/stock_analyses`, {
    method: "POST",
    headers: {
      "apikey": CONFIG.supabaseKey,
      "Authorization": `Bearer ${CONFIG.supabaseKey}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    },
    body: JSON.stringify({
      symbol: stock.symbol,
      requested_symbol: stock.requestedSymbol,
      provider: stock.provider,
      price: stock.close,
      change: stock.change,
      change_percent: stock.changePercent,
      volume: stock.volume,
      market_time: stock.marketTime,
      raw_stock_data: stock,
      summary: analysis.summary,
      sentiment: analysis.sentiment,
      risk_level: analysis.risk_level,
      llm_model: CONFIG.llmMock ? "mock" : CONFIG.llmModel
    })
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw httpError(response.status, `Supabase insert failed: ${responseText.slice(0, 300)}`);
  }

  return {
    ok: true,
    row: responseText ? JSON.parse(responseText)[0] : null
  };
}

async function fetchHistory() {
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey) {
    return [];
  }

  const url = `${CONFIG.supabaseUrl}/rest/v1/stock_analyses?select=id,symbol,price,change,change_percent,summary,sentiment,risk_level,created_at&order=created_at.desc&limit=8`;
  const response = await fetch(url, {
    headers: {
      "apikey": CONFIG.supabaseKey,
      "Authorization": `Bearer ${CONFIG.supabaseKey}`
    }
  });

  if (!response.ok) {
    return [];
  }

  return response.json();
}

function cleanSymbol(input) {
  const symbol = String(input || "").trim().replace(/\s+/g, " ").toUpperCase();
  if (!symbol) {
    throw httpError(400, "Stock symbol is required.");
  }
  if (!/^[A-Z0-9 .^=&-]{1,60}$/.test(symbol)) {
    throw httpError(400, "Stock symbol or company name may only contain letters, numbers, spaces, dot, caret, equals, ampersand, or hyphen.");
  }
  return symbol;
}

function toStooqSymbol(symbol) {
  if (symbol.includes(".") || symbol.includes("^") || symbol.includes("=")) {
    return symbol.toLowerCase();
  }
  return `${symbol.toLowerCase()}.us`;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return headers.reduce((row, header, index) => {
      row[header] = values[index] || "";
      return row;
    }, {});
  });
}

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) {
      throw httpError(413, "Request body is too large.");
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw httpError(400, "Request body must be valid JSON.");
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
}

function stringField(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw httpError(502, `LLM field ${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function findLatestIndex(values) {
  if (!Array.isArray(values)) return 0;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (numberOrNull(values[index]) !== null) return index;
  }
  return 0;
}

function previousCloseFromSeries(values, latestIndex) {
  if (!Array.isArray(values)) return null;
  for (let index = latestIndex - 1; index >= 0; index -= 1) {
    const value = numberOrNull(values[index]);
    if (value !== null) return value;
  }
  return null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "" || value === "N/D") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function scaledEastMoneyPrice(value) {
  const number = numberOrNull(value);
  if (number === null || number < 0) return null;
  return round(number / 100, 4);
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function trimSlash(value) {
  return value.replace(/\/+$/, "");
}

function formatDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function mockAnalysis(stock) {
  const percent = stock.changePercent;
  let sentiment = "Neutral";
  if (typeof percent === "number" && percent > 1) sentiment = "Bullish";
  if (typeof percent === "number" && percent < -1) sentiment = "Bearish";

  const riskLevel = Math.abs(percent || 0) > 3 ? "High" : Math.abs(percent || 0) > 1 ? "Medium" : "Low";
  return {
    summary: `${stock.symbol} 当前价格 ${stock.close}，日内变化 ${percent ?? "未知"}%，趋势信号偏${sentiment === "Bullish" ? "强" : sentiment === "Bearish" ? "弱" : "中性"}。`,
    sentiment,
    risk_level: riskLevel
  };
}
