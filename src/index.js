const TIERS = ["IRON", "BRONZE", "SILVER", "GOLD", "PLATINUM", "EMERALD", "DIAMOND"];
const DIVISIONS = ["IV", "III", "II", "I"];

const REGION_HOSTS = {
  na1:   "na1.api.riotgames.com",
  euw1:  "euw1.api.riotgames.com",
  kr:    "kr.api.riotgames.com",
  eune1: "eun1.api.riotgames.com",
  br1:   "br1.api.riotgames.com",
  jp1:   "jp1.api.riotgames.com",
  la1:   "la1.api.riotgames.com",
  la2:   "la2.api.riotgames.com",
  oc1:   "oc1.api.riotgames.com",
  tr1:   "tr1.api.riotgames.com",
  ru:    "ru.api.riotgames.com",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetches all pages for one tier+division, respects rate limits
async function fetchDivisionTotal(host, tier, division, apiKey, errors) {
  let page = 1;
  let total = 0;

  while (true) {
    const url = `https://${host}/lol/league/v4/entries/RANKED_SOLO_5x5/${tier}/${division}?page=${page}&api_key=${apiKey}`;
    let res;

    try {
      res = await fetch(url);
    } catch (e) {
      errors.push(`Network error ${tier} ${division} p${page}: ${e.message}`);
      break;
    }

    if (res.status === 429) {
      // Rate limited — back off and retry once
      const retryAfter = parseInt(res.headers.get("Retry-After") || "2", 10);
      await sleep(retryAfter * 1000);
      continue;
    }

    if (!res.ok) {
      errors.push(`${tier} ${division} p${page}: HTTP ${res.status}`);
      break;
    }

    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) break;

    total += data.length;

    // Riot returns max 205 per page — if less, we're done
    if (data.length < 205) break;

    page++;
    // Small delay between pages to stay within 20 req/s dev key limit
    await sleep(60);
  }

  return total;
}

// Apex tiers (Master, Grandmaster, Challenger) — single endpoint, all entries at once
async function fetchApexTier(host, tier, apiKey, errors) {
  const endpoint =
    tier === "MASTER"      ? "masterleagues" :
    tier === "GRANDMASTER" ? "grandmasterleagues" :
                             "challengerleagues";

  const url = `https://${host}/lol/league/v4/${endpoint}/by-queue/RANKED_SOLO_5x5?api_key=${apiKey}`;

  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    errors.push(`Network error ${tier}: ${e.message}`);
    return 0;
  }

  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get("Retry-After") || "2", 10);
    await sleep(retryAfter * 1000);
    return fetchApexTier(host, tier, apiKey, errors); // retry once
  }

  if (!res.ok) {
    errors.push(`${tier}: HTTP ${res.status}`);
    return 0;
  }

  const data = await res.json();
  return data.entries ? data.entries.length : 0;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const region = url.searchParams.get("region") || "na1";
    const debug  = url.searchParams.get("debug") === "1";
    const host   = REGION_HOSTS[region];

    if (!host) {
      return new Response(
        JSON.stringify({ error: `Unknown region: ${region}` }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    const apiKey = env.RIOT_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "RIOT_API_KEY secret not configured" }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    const errors = [];
    const divisionCounts = {};

    // Iron–Diamond: fetch each tier sequentially, divisions within a tier in parallel
    // Sequential tiers avoids bursting all 28 requests at once and hitting 429s
    for (const tier of TIERS) {
      const counts = await Promise.all(
        DIVISIONS.map((div) => fetchDivisionTotal(host, tier, div, apiKey, errors))
      );
      divisionCounts[tier] = counts.reduce((a, b) => a + b, 0);
      // Brief pause between tiers to stay comfortably within rate limits
      await sleep(200);
    }

    // Apex tiers — these are single requests each, fast
    divisionCounts["MASTER"]      = await fetchApexTier(host, "MASTER",      apiKey, errors);
    divisionCounts["GRANDMASTER"] = await fetchApexTier(host, "GRANDMASTER", apiKey, errors);
    divisionCounts["CHALLENGER"]  = await fetchApexTier(host, "CHALLENGER",  apiKey, errors);

    const ALL_TIERS = [...TIERS, "MASTER", "GRANDMASTER", "CHALLENGER"];
    const totalPlayers = ALL_TIERS.reduce((sum, t) => sum + (divisionCounts[t] || 0), 0);

    if (totalPlayers === 0) {
      return new Response(
        JSON.stringify({ error: "No player data returned — API key may be expired", errors }),
        { status: 502, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    // Build cumulative top-% from rarest (Challenger) down to most common (Iron)
    const ORDERED_TOP_DOWN = ["CHALLENGER", "GRANDMASTER", "MASTER", "DIAMOND", "EMERALD", "PLATINUM", "GOLD", "SILVER", "BRONZE", "IRON"];
    let cumulativeFromTop = 0;
    const tiers = {};

    for (const tier of ORDERED_TOP_DOWN) {
      const count = divisionCounts[tier] || 0;
      const pct   = (count / totalPlayers) * 100;
      const topPctStart = cumulativeFromTop;
      cumulativeFromTop += pct;
      tiers[tier] = {
        count,
        pct:       Math.round(pct * 10) / 10,
        topPctMin: Math.round(topPctStart    * 100) / 100,
        topPctMax: Math.round(cumulativeFromTop * 100) / 100,
      };
    }

    const payload = {
      region,
      totalPlayers,
      updated: new Date().toISOString(),
      tiers,
      ...(debug && { errors, rawCounts: divisionCounts }),
    };

    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
        ...CORS_HEADERS,
      },
    });
  },
};