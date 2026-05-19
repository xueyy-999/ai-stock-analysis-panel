const form = document.querySelector("#stockForm");
const symbolInput = document.querySelector("#symbolInput");
const analyzeButton = document.querySelector("#analyzeButton");
const refreshHistoryButton = document.querySelector("#refreshHistoryButton");
const quoteView = document.querySelector("#quoteView");
const analysisView = document.querySelector("#analysisView");
const historyList = document.querySelector("#historyList");
const providerBadge = document.querySelector("#providerBadge");
const analysisBadge = document.querySelector("#analysisBadge");
const configStatusIndicator = document.querySelector("#configStatusIndicator");
const configStatus = document.querySelector("#configStatus");
const llmMeta = document.querySelector("#llmMeta");
const storageMeta = document.querySelector("#storageMeta");
const modeMeta = document.querySelector("#modeMeta");
const rawQuoteView = document.querySelector("#rawQuoteView");
const rawBadge = document.querySelector("#rawBadge");
const promptView = document.querySelector("#promptView");
const toast = document.querySelector("#toast");

let latestStock = null;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await loadStock();
});

analyzeButton.addEventListener("click", async () => {
  await analyzeStock();
});

refreshHistoryButton.addEventListener("click", async () => {
  await loadHistory();
});

document.querySelectorAll("[data-symbol]").forEach((button) => {
  button.addEventListener("click", async () => {
    symbolInput.value = button.dataset.symbol;
    await loadStock();
  });
});

boot();

async function boot() {
  await Promise.all([checkHealth(), loadPrompt(), loadHistory()]);
  await loadStock();
}

async function checkHealth() {
  try {
    const health = await apiGet("/api/health");
    const hasLlm = Boolean(health.llmConfigured);
    const hasSupabase = Boolean(health.supabaseConfigured);
    configStatus.textContent = hasLlm && hasSupabase
      ? "Production Ready"
      : hasLlm
        ? "LLM Ready / DB Missing"
        : "LLM Missing";
    configStatusIndicator.className = hasLlm && hasSupabase
      ? "status-indicator ready"
      : hasLlm
        ? "status-indicator warning"
        : "status-indicator error";
    llmMeta.textContent = hasLlm ? `LLM: ${health.llmModel || "Configured"}` : "LLM: Missing";
    storageMeta.textContent = hasSupabase ? "DB: Supabase" : "DB: Missing";
    if (modeMeta) modeMeta.textContent = health.strictJson ? "Strict JSON" : "Text";
  } catch (error) {
    configStatus.textContent = "Server Offline";
    configStatusIndicator.className = "status-indicator error";
    llmMeta.textContent = "LLM: Offline";
    storageMeta.textContent = "DB: -";
    if (modeMeta) modeMeta.textContent = "-";
  }
}

async function loadPrompt() {
  try {
    const prompt = await apiGet("/api/prompt");
    promptView.textContent = JSON.stringify({
      messages: prompt.messages,
      response_format: prompt.response_format,
      validators: prompt.validators
    }, null, 2);
  } catch (error) {
    promptView.textContent = `Prompt 加载失败：${error.message}`;
  }
}

async function loadStock() {
  setBusy(true);
  analysisBadge.textContent = "未分析";
  analysisView.innerHTML = '<p class="empty">点击 AI 分析后，这里会展示 LLM 返回的严格 JSON。</p>';

  try {
    const symbol = symbolInput.value.trim();
    const data = await apiGet(`/api/stock?symbol=${encodeURIComponent(symbol)}`);
    latestStock = data.stock;
    renderStock(latestStock);
    renderRawStock(latestStock);
    showToast("行情已更新");
  } catch (error) {
    providerBadge.textContent = "Error";
    latestStock = null;
    renderError(quoteView, "行情获取失败", error.message);
    rawBadge.textContent = "Error";
    rawQuoteView.textContent = JSON.stringify({ error: error.message }, null, 2);
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

async function analyzeStock() {
  setBusy(true);
  analysisBadge.textContent = "分析中";

  try {
    const symbol = symbolInput.value.trim();
    const data = await apiPost("/api/analyze", { symbol });
    latestStock = data.stock;
    renderStock(data.stock);
    renderRawStock(data.stock);
    renderAnalysis(data.analysis, data.saved);
    await loadHistory();
    showToast(data.saved && data.saved.ok ? "AI 分析已写入 Supabase" : "AI 分析完成，Supabase 未保存");
  } catch (error) {
    analysisBadge.textContent = "失败";
    renderError(analysisView, "AI 分析失败", error.message);
    showToast(error.message);
  } finally {
    setBusy(false);
  }
}

async function loadHistory() {
  try {
    const data = await apiGet("/api/history");
    renderHistory(data.history || []);
  } catch {
    renderHistory([]);
  }
}

function renderStock(stock) {
  const changeClass = stock.change > 0 ? "up" : stock.change < 0 ? "down" : "flat";
  providerBadge.textContent = stock.provider;
  quoteView.innerHTML = `
    <div class="quote-metric">
      <div>
        <span class="quote-symbol">${escapeHtml(stock.symbol)}</span>
        ${stock.name ? `<span class="quote-name">${escapeHtml(stock.name)}</span>` : ""}
        <span class="quote-price">${formatNumber(stock.close)}</span>
      </div>
      <div class="change-card">
        <span class="change-label">涨跌幅</span>
        <span class="change ${changeClass}">${formatChange(stock.change)} (${formatPercent(stock.changePercent)})</span>
      </div>
    </div>
    <div class="stats-grid">
      ${stat("开盘", formatNumber(stock.open))}
      ${stat("最高", formatNumber(stock.high))}
      ${stat("最低", formatNumber(stock.low))}
      ${stat("昨收", formatNumber(stock.previousClose))}
      ${stat("成交量", formatNumber(stock.volume, 0))}
      ${stat("市场时间", stock.marketTime || "-")}
      ${stat("交易所", stock.exchange || "-")}
      ${stat("货币", stock.currency || "-")}
    </div>
  `;
}

function renderRawStock(stock) {
  rawBadge.textContent = stock.symbol;
  rawQuoteView.textContent = JSON.stringify(stock, null, 2);
}

function renderAnalysis(analysis, saved) {
  analysisBadge.textContent = saved && saved.ok ? "已保存" : "已分析";
  const saveText = saved && saved.ok
    ? "已写入 Supabase stock_analyses 表。"
    : `未写入 Supabase：${saved && saved.reason ? saved.reason : "Supabase 未配置。"}`;

  analysisView.innerHTML = `
    <div class="analysis-summary">${escapeHtml(analysis.summary)}</div>
    <div class="chips">
      <span class="chip sentiment ${escapeHtml(analysis.sentiment)}">sentiment: ${escapeHtml(analysis.sentiment)}</span>
      <span class="chip">risk_level: ${escapeHtml(analysis.risk_level)}</span>
    </div>
    <div class="save-note">${escapeHtml(saveText)}</div>
    <pre class="analysis-json">${escapeHtml(JSON.stringify(analysis, null, 2))}</pre>
  `;
}

function renderHistory(items) {
  if (!items.length) {
    historyList.innerHTML = '<p class="empty">暂无记录。配置 Supabase 并完成一次 AI 分析后会显示历史记录。</p>';
    return;
  }

  historyList.innerHTML = items.map((item) => `
    <div class="history-item">
      <strong>${escapeHtml(item.symbol || "-")}</strong>
      <span>${formatNumber(item.price)}</span>
      <p>${escapeHtml(item.summary || "-")}</p>
      <span class="sentiment ${escapeHtml(item.sentiment || "Neutral")}">${escapeHtml(item.sentiment || "-")}</span>
      <span>${escapeHtml(item.risk_level || "-")}</span>
    </div>
  `).join("");
}

function renderError(target, title, detail) {
  target.innerHTML = `
    <div class="error-card">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(detail)}</p>
      <span>换一个全球股票代码/公司英文名再试，例如 AAPL、601138、0700.HK、7203.T、Toyota。</span>
    </div>
  `;
}

async function apiGet(url) {
  const response = await fetch(url);
  return parseApiResponse(response);
}

async function apiPost(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return parseApiResponse(response);
}

async function parseApiResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || payload.detail || `HTTP ${response.status}`);
  }
  return payload;
}

function setBusy(isBusy) {
  form.querySelectorAll("button").forEach((button) => {
    button.disabled = isBusy;
  });
}

function stat(label, value) {
  return `<div class="stat"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits === 0 ? 0 : 2
  }).format(number);
}

function formatChange(value) {
  if (value === null || value === undefined) return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number > 0 ? "+" : ""}${formatNumber(number)}`;
}

function formatPercent(value) {
  if (value === null || value === undefined) return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 3200);
}
