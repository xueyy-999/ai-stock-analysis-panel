const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
loadEnvFile(path.join(ROOT, ".env"));

const requiredFiles = [
  "server.js",
  "public/index.html",
  "public/app.js",
  "public/styles.css",
  "supabase-schema.sql",
  "render.yaml",
  "README.md"
];

const requiredEnv = [
  "LLM_API_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY"
];

const errors = [];
const warnings = [];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(ROOT, file))) {
    errors.push(`Missing required file: ${file}`);
  }
}

for (const key of requiredEnv) {
  const value = process.env[key];
  if (!value || isPlaceholder(value)) {
    errors.push(`Missing or placeholder env: ${key}`);
  }
}

const llmApiUrl = process.env.LLM_API_URL || "";
if (/127\.0\.0\.1|localhost/i.test(llmApiUrl)) {
  errors.push("LLM_API_URL points to localhost. Render cannot access your local CPAMC; use a public OpenAI-compatible endpoint for deployment.");
}

if (process.env.LLM_MOCK === "true") {
  errors.push("LLM_MOCK=true. Disable mock mode before final deployment.");
}

if (process.env.SUPABASE_SERVICE_ROLE_KEY && !looksLikeSupabaseSecret(process.env.SUPABASE_SERVICE_ROLE_KEY)) {
  warnings.push("SUPABASE_SERVICE_ROLE_KEY does not look like a Supabase secret/service_role key. Verify it is not the publishable/anon key.");
}

console.log("Deployment readiness check");
console.log("==========================");
console.log(`Files checked: ${requiredFiles.length}`);
console.log(`Environment checked: ${requiredEnv.length}`);

if (warnings.length) {
  console.log("\nWarnings:");
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (errors.length) {
  console.log("\nBlocking issues:");
  for (const error of errors) console.log(`- ${error}`);
  process.exit(1);
}

console.log("\nReady for Render deployment.");

function loadEnvFile(envPath) {
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

function isPlaceholder(value) {
  return /your-|<.*>|sk-your-key|你的|示例|example/i.test(String(value));
}

function looksLikeSupabaseSecret(value) {
  const text = String(value || "");
  return text.startsWith("sb_secret_") || text.startsWith("eyJ");
}
