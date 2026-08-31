# Vercel deployment

The Vercel build copies the Public folder to dist; the api/index.js serverless entry exports the existing Express app. Browser API calls already use same-origin /api paths.

## Required Vercel settings

- Framework preset: Other
- Build command: npm run vercel-build
- Output directory: dist
- Install command: npm install
- Node.js version: 22.x

Add these environment variables in the Vercel project settings: APP_URL, SESSION_SECRET, OPENROUTER_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OWNER_EMAIL, OWNER_PASSWORD, and TG_PRODUCTION_URL. Only configure provider keys for providers you intend to use.

Set both APP_URL and TG_PRODUCTION_URL to the final HTTPS Vercel domain. In Google Cloud Console, add this callback URI:

https://YOUR-VERCEL-DOMAIN/api/auth/google/callback

## Persistent-data requirement

The current backend uses SQLite through node:sqlite. Vercel's filesystem is ephemeral, so it cannot safely persist users, chats, usage, billing, or announcements. A managed SQL database and a storage adapter/migration are required before enabling production signups or persistent chat features on Vercel. Do not set DATABASE_PATH to a Vercel filesystem path as a production workaround.
