const fs = require("fs");
const path = require("path");

const productionUrl = process.env.TG_PRODUCTION_URL;
if (!productionUrl) {
  throw new Error("TG_PRODUCTION_URL is required for a packaged desktop build.");
}

let url;
try { url = new URL(productionUrl); } catch { throw new Error("TG_PRODUCTION_URL must be a valid HTTPS URL."); }
if (url.protocol !== "https:" || /^(localhost|127\\.0\\.0\\.1)$/i.test(url.hostname)) {
  throw new Error("TG_PRODUCTION_URL must be a non-localhost HTTPS URL.");
}

fs.writeFileSync(path.join(__dirname, "production-url.json"), JSON.stringify({ url: url.toString().replace(/\/$/, "") }, null, 2));
