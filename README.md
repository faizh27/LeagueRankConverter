# League Rank Converter

A Cloudflare Worker that converts any top-percentile into a real League of Legends rank. Powers a frontend widget where you enter a percentage ("I'm top 12% in X") and get back your equivalent LoL rank.

## Architecture

```
Browser → Cloudflare Worker → returns JSON with rank distribution
```

The Worker has hardcoded player count data per tier. It computes cumulative percentiles on the fly and returns them as JSON. No external API calls, no database — instant response.

## Updating the rank data (do this each season)

**When:** Riot typically resets ranks in January (Season start) and July (mid-season split).

**Where:** Open `src/index.js` and find the `TIER_COUNTS` block near the top of the file — it's clearly marked. Update the player counts for each tier, then update `DATA_DATE` to today.

**Sources to pull updated numbers from:**
- https://www.leagueofgraphs.com/rankings/rank-distribution
- https://www.esportstales.com/league-of-legends/rank-distribution-percentage-of-players-by-tier

You only need rough totals — the ratios between tiers are what matter, not exact counts.

**After updating:**
```bash
npm run deploy
```

That's it.

## API

```
GET https://league-rank-converter.league-rank-converter.workers.dev?region=na1
```

**Supported regions:** `na1`, `euw1`, `kr`, `eune1`, `br1`, `jp1`, `la1`, `la2`, `oc1`, `tr1`, `ru`

**Response:**
```json
{
  "region": "na1",
  "totalPlayers": 6108000,
  "dataDate": "2026-05-26",
  "tiers": {
    "CHALLENGER":  { "count": 6000,    "pct": 0.1,  "topPctMin": 0,    "topPctMax": 0.1  },
    "GRANDMASTER": { "count": 24000,   "pct": 0.4,  "topPctMin": 0.1,  "topPctMax": 0.49 },
    "MASTER":      { "count": 134000,  "pct": 2.2,  "topPctMin": 0.49, "topPctMax": 2.69 },
    "DIAMOND":     { "count": 487000,  "pct": 8.0,  "topPctMin": 2.69, "topPctMax": 10.66 },
    ...
  }
}
```

## Deploy

```bash
npm install
npx wrangler login
npm run deploy
```

## Local development

```bash
npm run dev
```
