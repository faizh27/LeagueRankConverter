# League Rank Converter

A Cloudflare Worker that fetches live League of Legends rank distribution data from the Riot API and returns clean percentile breakdowns. Powers a frontend that converts any top-% into a real LoL rank.

## How it works

The Worker calls Riot's `league-v4` endpoints to count players in every tier and division (Iron IV through Challenger), calculates cumulative percentages, and returns a single JSON response. The Riot API key is stored as a Cloudflare secret — never exposed to the frontend.

## API

```
GET https://<your-worker>.workers.dev?region=na1
```

**Supported regions:** `na1`, `euw1`, `kr`, `eune1`, `br1`, `jp1`, `la1`, `la2`, `oc1`, `tr1`, `ru`

**Response:**
```json
{
  "region": "na1",
  "totalPlayers": 3241847,
  "updated": "2026-05-25T12:00:00.000Z",
  "tiers": {
    "CHALLENGER":  { "count": 300,    "pct": 0.01, "topPctMin": 0,    "topPctMax": 0.01 },
    "GRANDMASTER": { "count": 1200,   "pct": 0.04, "topPctMin": 0.01, "topPctMax": 0.05 },
    "MASTER":      { "count": 45000,  "pct": 1.4,  "topPctMin": 0.05, "topPctMax": 1.45 },
    "DIAMOND":     { "count": 258000, "pct": 7.9,  "topPctMin": 1.45, "topPctMax": 9.35 },
    ...
  }
}
```

## Deploy

### 1. Install dependencies
```bash
npm install
```

### 2. Authenticate with Cloudflare
```bash
npx wrangler login
```

### 3. Add your Riot API key as a secret
```bash
npx wrangler secret put RIOT_API_KEY
# paste your key when prompted — it never touches your codebase
```

Get a free dev key at https://developer.riotgames.com  
Note: dev keys expire every 24h. For permanent use, apply for a personal project key on the Riot portal.

### 4. Deploy
```bash
npm run deploy
```

Your Worker URL will be printed — something like `https://league-rank-converter.<your-subdomain>.workers.dev`

### 5. Test it
```bash
curl "https://league-rank-converter.<your-subdomain>.workers.dev?region=na1"
```

### Local development
```bash
npm run dev
```

Add your key to `.dev.vars` for local testing (this file is gitignored):
```
RIOT_API_KEY=RGAPI-your-key-here
```

## GitHub auto-deploy (optional)

Connect your repo in the Cloudflare dashboard under Workers & Pages → your Worker → Settings → Build. Every push to `main` will auto-deploy.
