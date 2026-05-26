// ─────────────────────────────────────────────────────────────────────────────
// RANK DISTRIBUTION DATA
// Source: https://www.leagueofgraphs.com/rankings/rank-distribution
//         https://www.esportstales.com/league-of-legends/rank-distribution-percentage-of-players-by-tier
//
// HOW TO UPDATE (do this once per season, usually January and July):
//   1. Visit the sources above
//   2. Update the player counts in TIER_COUNTS below for each region
//   3. Update DATA_DATE to today's date
//   4. Run: npm run deploy
//
// Last updated: May 2026 — Season 16 (2026), Split 1
// ─────────────────────────────────────────────────────────────────────────────

const DATA_DATE = "2026-05-26";

// Player counts per tier per region.
// These are approximate totals sourced from the sites above.
// Exact numbers don't matter — the ratios are what drive the percentile output.
const TIER_COUNTS = {
  na1: {
    IRON:        162000,
    BRONZE:      852000,
    SILVER:     1278000,
    GOLD:       1491000,
    PLATINUM:    913000,
    EMERALD:     761000,
    DIAMOND:     487000,
    MASTER:      134000,
    GRANDMASTER:  24000,
    CHALLENGER:    6000,
  },
  euw1: {
    IRON:        210000,
    BRONZE:     1100000,
    SILVER:     1650000,
    GOLD:       1925000,
    PLATINUM:   1178000,
    EMERALD:     982000,
    DIAMOND:     629000,
    MASTER:      173000,
    GRANDMASTER:  31000,
    CHALLENGER:    8000,
  },
  kr: {
    IRON:         95000,
    BRONZE:       498000,
    SILVER:       747000,
    GOLD:         872000,
    PLATINUM:     534000,
    EMERALD:      445000,
    DIAMOND:      285000,
    MASTER:        78000,
    GRANDMASTER:   14000,
    CHALLENGER:     3500,
  },
};

// All other regions fall back to NA ratios
const FALLBACK_REGION = "na1";

// ─────────────────────────────────────────────────────────────────────────────

const REGION_HOSTS = {
  na1: "NA", euw1: "EUW", kr: "KR",
  eune1: "EUNE", br1: "BR", jp1: "JP",
  la1: "LAN", la2: "LAS", oc1: "OCE",
  tr1: "TR", ru: "RU",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const TOP_DOWN = [
  "CHALLENGER", "GRANDMASTER", "MASTER",
  "DIAMOND", "EMERALD", "PLATINUM",
  "GOLD", "SILVER", "BRONZE", "IRON",
];

function computeDistribution(region) {
  const counts = TIER_COUNTS[region] || TIER_COUNTS[FALLBACK_REGION];
  const totalPlayers = TOP_DOWN.reduce((sum, t) => sum + (counts[t] || 0), 0);

  let cumulative = 0;
  const tiers = {};

  for (const tier of TOP_DOWN) {
    const count = counts[tier] || 0;
    const pct   = (count / totalPlayers) * 100;
    const start = cumulative;
    cumulative += pct;
    tiers[tier] = {
      count,
      pct:       Math.round(pct   * 10)  / 10,
      topPctMin: Math.round(start * 100) / 100,
      topPctMax: Math.round(cumulative * 100) / 100,
    };
  }

  return { region, totalPlayers, dataDate: DATA_DATE, tiers };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url    = new URL(request.url);
    const region = url.searchParams.get("region") || "na1";

    if (!REGION_HOSTS[region]) {
      return new Response(
        JSON.stringify({ error: `Unknown region: ${region}. Valid: ${Object.keys(REGION_HOSTS).join(", ")}` }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    const payload = computeDistribution(region);

    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type":  "application/json",
        "Cache-Control": "public, max-age=86400", // cache for 24h, data only changes per season
        ...CORS_HEADERS,
      },
    });
  },
};
