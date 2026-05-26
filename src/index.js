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

// Fetches a single page and returns { pageCount, totalEntries }
// Riot returns a leagueId that's shared across a division — we use page 1
// to get a sample count, then use the queue endpoint to get the total
async function fetchLeaguePage(host, tier, division, apiKey, errors) {
  const url = `https://${host}/lol/league/v4/entries/RANKED_SOLO_5x5/${tier}/${division}?page=1&api_key=${apiKey}`;

  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    errors.push(`Fetch error ${tier} ${division}: ${e.message}`);
    return 0;
  }

  if (res.status === 429) {
    const wait = parseInt(res.headers.get("Retry-After") || "2", 10) * 1000;
    await sleep(wait);
    return fetchLeaguePage(host, tier, division, apiKey, errors);
  }

  if (!res.ok) {
    errors.push(`${tier} ${division}: HTTP ${res.status}`);
    return 0;
  }

  const data = await res.json();
  if (!Array.isArray(data)) return 0;

  // If page 1 is full (205 entries), we need to estimate the total.
  // We do this by binary-searching for the last non-empty page.
  if (data.length < 205) {
    return data.length;
  }

  // Binary search for last page — costs log2(n) requests instead of n
  let lo = 1, hi = 500, lastKnownCount = data.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    let midRes;
    try {
      midRes = await fetch(
        `https://${host}/lol/league/v4/entries/RANKED_SOLO_5x5/${tier}/${division}?page=${mid}&api_key=${apiKey}`
      );
    } catch (e) {
      errors.push(`Binary search error ${tier} ${division} p${mid}: ${e.message}`);
      break;
    }

    if (midRes.status === 429) {
      const wait = parseInt(midRes.headers.get("Retry-After") || "2", 10) * 1000;
      await sleep(wait);
      continue;
    }

    if (!midRes.ok) break;

    const midData = await midRes.json();
    if (!Array.isArray(midData) || midData.length === 0) {
      hi = mid - 1;
    } else {
      lastKnownCount = midData.length;
      lo = mid + 1;
    }
    await sleep(55); // stay under 20 req/s
  }

  // Total = full pages * 205 + last page count
  // lo - 1 = last non-empty page index
  const lastPage = lo - 1;
  return (lastPage - 1) * 205 + lastKnownCount;
}

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
    errors.push(`Fetch error ${tier}: ${e.message}`);
    return 0;
  }

  if (res.status === 429) {
    const wait = parseInt(res.headers.get("Retry-After") || "2", 10) * 1000;
    await sleep(wait);
    return fetchApexTier(host, tier, apiKey, errors);
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

    const url    = new URL(request.url);
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

    // Iron–Diamond: fetch all divisions per tier sequentially to respect subrequest limit
    for (const tier of TIERS) {
      let tierTotal = 0;
      for (const division of DIVISIONS) {
        const count = await fetchLeaguePage(host, tier, division, apiKey, errors);
        tierTotal += count;
        await sleep(55); // ~18 req/s, safely under the 20/s dev key limit
      }
      divisionCounts[tier] = tierTotal;
    }

    // Apex tiers — one request each
    divisionCounts["MASTER"]      = await fetchApexTier(host, "MASTER",      apiKey, errors);
    divisionCounts["GRANDMASTER"] = await fetchApexTier(host, "GRANDMASTER", apiKey, errors);
    divisionCounts["CHALLENGER"]  = await fetchApexTier(host, "CHALLENGER",  apiKey, errors);

    const ALL_TIERS    = [...TIERS, "MASTER", "GRANDMASTER", "CHALLENGER"];
    const totalPlayers = ALL_TIERS.reduce((sum, t) => sum + (divisionCounts[t] || 0), 0);

    if (totalPlayers === 0) {
      return new Response(
        JSON.stringify({ error: "No player data — API key may be expired", errors }),
        { status: 502, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    const ORDERED_TOP_DOWN = ["CHALLENGER", "GRANDMASTER", "MASTER", "DIAMOND", "EMERALD", "PLATINUM", "GOLD", "SILVER", "BRONZE", "IRON"];
    let cumulative = 0;
    const tiers = {};

    for (const tier of ORDERED_TOP_DOWN) {
      const count = divisionCounts[tier] || 0;
      const pct   = (count / totalPlayers) * 100;
      const start = cumulative;
      cumulative += pct;
      tiers[tier] = {
        count,
        pct:       Math.round(pct * 10) / 10,
        topPctMin: Math.round(start      * 100) / 100,
        topPctMax: Math.round(cumulative * 100) / 100,
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
