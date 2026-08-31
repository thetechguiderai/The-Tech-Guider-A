import "dotenv/config";
import type { CapacitorConfig } from "@capacitor/cli";

const url = process.env.TG_PRODUCTION_URL || process.env.APP_URL || "https://theguiderai.netlify.app";
if (!url || !/^https:\/\/(?!localhost|127\.0\.0\.1)/i.test(url)) {
  throw new Error("Set TG_PRODUCTION_URL to your deployed HTTPS application URL before syncing Android.");
}

const config: CapacitorConfig = {
  appId: "com.thetechguider.ai",
  appName: "The Tech Guider AI",
  webDir: "Public",
  server: { url, cleartext: false, androidScheme: "https" },
};

export default config;
