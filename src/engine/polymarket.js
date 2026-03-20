/**
 * Polymarket integration — Gamma REST + CLOB WebSocket
 *
 * Two data sources:
 * 1. Gamma REST: market discovery (series_id=10470 for NCAA MBB)
 * 2. CLOB WS:   live odds / order-book streaming
 * ESPN is used for live scores (not Polymarket Sports WS).
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  events: new Map(),
  prices: new Map(),
  assetToTeam: new Map(),
  slugToMatchup: new Map(),
  matchupToSlug: new Map(),
  marketData: new Map(),
};

const listeners = [];
let clobWs = null;
let clobPingInterval = null;
let clobReconnectTimer = null;
let gammaInterval = null;

// ---------------------------------------------------------------------------
// Gamma REST API — market discovery
// ---------------------------------------------------------------------------
const GAMMA_BASE = 'https://gamma-api.polymarket.com';
const SERIES_ID = '10470'; // NCAA Men's Basketball

async function fetchGammaEvents() {
  const url = `${GAMMA_BASE}/events?series_id=${SERIES_ID}&active=true&closed=false&limit=100`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      // Try via proxy as fallback
      return fetchGammaViaProxy(url);
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return fetchGammaViaProxy(url);
  }
}

async function fetchGammaViaProxy(targetUrl) {
  const proxyUrl = 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(targetUrl);
  try {
    const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
    if (r.ok) {
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    }
  } catch {}
  return [];
}

function safeParse(str) {
  if (!str) return [];
  if (Array.isArray(str)) return str;
  try { return JSON.parse(str); } catch { return []; }
}

function processGammaEvents(events) {
  const allAssetIds = [];

  for (const event of events) {
    const slug = event.slug || '';
    state.events.set(slug, event);

    const markets = event.markets || [];
    if (markets.length === 0) continue;

    const market = markets[0];
    const outcomes = safeParse(market.outcomes);
    const prices = safeParse(market.outcomePrices);
    const tokenIds = safeParse(market.clobTokenIds);

    if (outcomes.length < 2 || tokenIds.length < 2) continue;

    // Store initial prices from Gamma
    for (let i = 0; i < tokenIds.length; i++) {
      const assetId = tokenIds[i];
      const prob = parseFloat(prices[i]) || 0;
      state.prices.set(assetId, {
        prob,
        bestBid: parseFloat(market.bestBid) || 0,
        bestAsk: parseFloat(market.bestAsk) || 0,
        volume: parseFloat(market.volume) || 0,
        liquidity: parseFloat(market.liquidity) || 0,
      });
      allAssetIds.push(assetId);
    }

    // Try to match event to our bracket
    const matchResult = matchEventToBracket(event, outcomes, tokenIds, prices, market);
    if (matchResult) {
      state.slugToMatchup.set(slug, matchResult.matchupId);
      state.matchupToSlug.set(matchResult.matchupId, slug);
      state.marketData.set(matchResult.matchupId, matchResult);
    }
  }

  return allAssetIds;
}

// ---------------------------------------------------------------------------
// Team name matching (reuse logic from liveScores)
// ---------------------------------------------------------------------------
import { getR64Matchup, getGeneratedMatchup, getRegionR64Matchups, REGIONS } from './propagation.js';

function normalizeForMatch(name) {
  if (!name || typeof name !== 'string') return '';
  return name.toLowerCase()
    .replace(/['']/g, '')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Build team name variants from teams data
import teamsData from '../data/teams.json';

const TEAM_ID_TO_ESPN = {};
const TEAM_MATCH_NAMES = {};
for (const t of teamsData.teams) {
  TEAM_ID_TO_ESPN[t.id] = t.name;
  const names = new Set();
  names.add(normalizeForMatch(t.name));
  // Add slug form
  names.add(t.id.replace(/-/g, ' '));
  // Short name without university suffixes
  const short = t.name.replace(/ Blue Devils| Wildcats| Bulldogs| Tigers| Gators| Bears| Hoyas| Cavaliers| Volunteers| Crimson Tide| Boilermakers| Jayhawks| Longhorns| Spartans| Bruins| Huskies| Cardinals| Tar Heels| Fighting Illini| Buckeyes| Badgers| Hurricanes| Razorbacks| Mountaineers| Hawkeyes| Commodores| Cowboys| Aggies| Cougars| Gaels| Panthers| Red Raiders| Yellow Jackets| Friars| Bearcats| Cyclones/gi, '');
  if (short.trim().length >= 3) names.add(normalizeForMatch(short));
  TEAM_MATCH_NAMES[t.id] = [...names].filter(n => n.length >= 3);
}

function findMatchupIdForTeams(teamId1, teamId2) {
  // Check R64 matchups
  for (const region of REGIONS) {
    const ids = getRegionR64Matchups(region);
    for (const id of ids) {
      const m = getR64Matchup(id);
      if (!m || !m.team1 || !m.team2) continue;
      const mIds = [m.team1.id, m.team2.id];
      if (mIds.includes(teamId1) && mIds.includes(teamId2)) return id;
    }
  }
  // Check later rounds
  for (const region of REGIONS) {
    const r = region.toLowerCase();
    for (let round = 2; round <= 4; round++) {
      const maxPos = round === 2 ? 4 : round === 3 ? 2 : 1;
      for (let pos = 0; pos < maxPos; pos++) {
        const id = `${r}-r${round}-${pos}`;
        const gen = getGeneratedMatchup(id);
        if (gen && gen.team1 && gen.team2) {
          const gIds = [gen.team1.id, gen.team2.id];
          if (gIds.includes(teamId1) && gIds.includes(teamId2)) return id;
        }
      }
    }
  }
  // Final Four / Championship
  for (const id of ['ff-0', 'ff-1', 'championship']) {
    const gen = getGeneratedMatchup(id);
    if (gen && gen.team1 && gen.team2) {
      const gIds = [gen.team1.id, gen.team2.id];
      if (gIds.includes(teamId1) && gIds.includes(teamId2)) return id;
    }
  }
  return null;
}

function getMatchupTeamOrder(matchupId) {
  const r64 = getR64Matchup(matchupId);
  if (r64 && r64.team1 && r64.team2) return [r64.team1.id, r64.team2.id];
  const gen = getGeneratedMatchup(matchupId);
  if (gen && gen.team1 && gen.team2) return [gen.team1.id, gen.team2.id];
  return [null, null];
}

function matchEventToBracket(event, outcomes, tokenIds, prices, market) {
  const title = event.title || '';
  const normalized = normalizeForMatch(title);
  if (!normalized) return null;

  const matched = [];
  for (const [teamId, nameVariants] of Object.entries(TEAM_MATCH_NAMES)) {
    for (const variant of nameVariants) {
      if (normalized.includes(variant)) {
        matched.push(teamId);
        break;
      }
    }
  }

  // Also try matching outcome names
  if (matched.length < 2) {
    for (const outcomeName of outcomes) {
      const normOutcome = normalizeForMatch(outcomeName);
      for (const [teamId, nameVariants] of Object.entries(TEAM_MATCH_NAMES)) {
        if (matched.includes(teamId)) continue;
        for (const variant of nameVariants) {
          if (normOutcome.includes(variant) || variant.includes(normOutcome)) {
            matched.push(teamId);
            break;
          }
        }
      }
    }
  }

  if (matched.length < 2) return null;

  const matchupId = findMatchupIdForTeams(matched[0], matched[1]);
  if (!matchupId) return null;

  const [team1Id, team2Id] = getMatchupTeamOrder(matchupId);

  // Map outcomes to teams
  let team1Prob = null, team2Prob = null;
  let team1AssetId = null, team2AssetId = null;

  for (let i = 0; i < outcomes.length; i++) {
    const normOutcome = normalizeForMatch(outcomes[i]);
    const team1Names = TEAM_MATCH_NAMES[team1Id] || [];
    const team2Names = TEAM_MATCH_NAMES[team2Id] || [];

    const matchesTeam1 = team1Names.some(v => normOutcome.includes(v) || v.includes(normOutcome));
    const matchesTeam2 = team2Names.some(v => normOutcome.includes(v) || v.includes(normOutcome));

    if (matchesTeam1 && !matchesTeam2) {
      team1Prob = parseFloat(prices[i]) || 0;
      team1AssetId = tokenIds[i] || null;
    } else if (matchesTeam2 && !matchesTeam1) {
      team2Prob = parseFloat(prices[i]) || 0;
      team2AssetId = tokenIds[i] || null;
    }
  }

  // Infer missing
  if (team1Prob && !team2Prob) team2Prob = 1 - team1Prob;
  if (team2Prob && !team1Prob) team1Prob = 1 - team2Prob;

  if (!team1Prob || !team2Prob) return null;

  // Store asset->team mappings
  if (team1AssetId) {
    state.assetToTeam.set(team1AssetId, { teamId: team1Id, matchupId, teamIndex: 1 });
  }
  if (team2AssetId) {
    state.assetToTeam.set(team2AssetId, { teamId: team2Id, matchupId, teamIndex: 2 });
  }

  return {
    matchupId,
    slug: event.slug,
    team1Id,
    team2Id,
    team1Prob,
    team2Prob,
    team1AssetId,
    team2AssetId,
    volume: parseFloat(market.volume) || 0,
    liquidity: parseFloat(market.liquidity) || 0,
    bestBid: parseFloat(market.bestBid) || 0,
    bestAsk: parseFloat(market.bestAsk) || 0,
    moneyline1: probToAmericanOdds(team1Prob),
    moneyline2: probToAmericanOdds(team2Prob),
    sentiment: event.eventMetadata?.context_description || null,
    live: !!event.live,
    ended: !!event.ended,
  };
}

function probToAmericanOdds(prob) {
  if (prob == null || prob <= 0 || prob >= 1) return null;
  if (prob >= 0.5) return String(Math.round(-100 * prob / (1 - prob)));
  return '+' + Math.round(100 * (1 - prob) / prob);
}

// ---------------------------------------------------------------------------
// CLOB WebSocket — live odds streaming
// ---------------------------------------------------------------------------
const CLOB_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

function connectClobWs(assetIds) {
  if (clobWs) {
    try { clobWs.close(); } catch {}
  }
  clearInterval(clobPingInterval);
  clearTimeout(clobReconnectTimer);

  if (!assetIds || assetIds.length === 0) return;

  try {
    clobWs = new WebSocket(CLOB_WS_URL);
  } catch {
    scheduleReconnect('clob', assetIds);
    return;
  }

  clobWs.onopen = () => {
    console.log('[Polymarket CLOB WS] Connected');
    // Subscribe to all asset IDs
    const msg = JSON.stringify({
      action: 'subscribe',
      type: 'market',
      assets_ids: assetIds,
    });
    clobWs.send(msg);

    // Heartbeat: send PING every 10s
    clobPingInterval = setInterval(() => {
      if (clobWs && clobWs.readyState === WebSocket.OPEN) {
        clobWs.send('PING');
      }
    }, 10000);
  };

  clobWs.onmessage = (evt) => {
    const raw = evt.data;
    if (raw === 'PONG' || raw === 'pong') return;

    try {
      const messages = JSON.isArray ? JSON.parse(raw) : JSON.parse(raw);
      const arr = Array.isArray(messages) ? messages : [messages];

      for (const msg of arr) {
        handleClobMessage(msg);
      }
    } catch {
      // Non-JSON message, ignore
    }
  };

  clobWs.onclose = () => {
    console.log('[Polymarket CLOB WS] Disconnected');
    clearInterval(clobPingInterval);
    scheduleReconnect('clob', assetIds);
  };

  clobWs.onerror = () => {
    console.warn('[Polymarket CLOB WS] Error');
  };
}

function handleClobMessage(msg) {
  if (!msg || !msg.asset_id) return;

  const assetId = msg.asset_id;
  const existing = state.prices.get(assetId) || { prob: 0, bestBid: 0, bestAsk: 0, volume: 0, liquidity: 0 };
  const mapping = state.assetToTeam.get(assetId);
  let changed = false;

  if (msg.event === 'price_change' && msg.price) {
    const newProb = parseFloat(msg.price);
    if (newProb > 0 && newProb < 1 && Math.abs(newProb - existing.prob) > 0.001) {
      existing.prob = newProb;
      changed = true;
    }
  }

  if (msg.event === 'book') {
    if (msg.bids && msg.bids.length > 0) {
      existing.bestBid = parseFloat(msg.bids[0].price) || existing.bestBid;
    }
    if (msg.asks && msg.asks.length > 0) {
      existing.bestAsk = parseFloat(msg.asks[0].price) || existing.bestAsk;
    }
    changed = true;
  }

  state.prices.set(assetId, existing);

  if (changed && mapping) {
    updateMarketDataFromWs(mapping.matchupId);
    notifyListeners({ type: 'odds', matchupId: mapping.matchupId });
  }
}

function updateMarketDataFromWs(matchupId) {
  const data = state.marketData.get(matchupId);
  if (!data) return;

  const t1Price = data.team1AssetId ? state.prices.get(data.team1AssetId) : null;
  const t2Price = data.team2AssetId ? state.prices.get(data.team2AssetId) : null;

  if (t1Price) {
    const prevProb = data.team1Prob;
    data.team1Prob = t1Price.prob;
    data.team1ProbDelta = t1Price.prob - prevProb;
    data.bestBid = t1Price.bestBid;
    data.bestAsk = t1Price.bestAsk;
  }
  if (t2Price) {
    const prevProb = data.team2Prob;
    data.team2Prob = t2Price.prob;
    data.team2ProbDelta = t2Price.prob - prevProb;
  }

  data.moneyline1 = probToAmericanOdds(data.team1Prob);
  data.moneyline2 = probToAmericanOdds(data.team2Prob);
}

// ---------------------------------------------------------------------------
// Reconnection
// ---------------------------------------------------------------------------
function scheduleReconnect(type, assetIds) {
  if (type === 'clob') {
    clearTimeout(clobReconnectTimer);
    clobReconnectTimer = setTimeout(() => connectClobWs(assetIds), 5000);
  }
}

// ---------------------------------------------------------------------------
// Listeners
// ---------------------------------------------------------------------------
function notifyListeners(detail) {
  for (const cb of listeners) {
    try { cb(detail); } catch {}
  }
}

export function onPolymarketUpdate(cb) {
  listeners.push(cb);
  return () => {
    const idx = listeners.indexOf(cb);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get full market data for a matchup
 * @returns {{ team1Prob, team2Prob, moneyline1, moneyline2, volume, liquidity,
 *             bestBid, bestAsk, sentiment, live, ended, gameScore, gamePeriod,
 *             gameElapsed, team1ProbDelta, team2ProbDelta } | null}
 */
export function getMarketData(matchupId) {
  return state.marketData.get(matchupId) || null;
}

/**
 * Get all market data entries
 */
export function getAllMarketData() {
  return state.marketData;
}

/**
 * Start Polymarket integration: fetch Gamma, connect WebSockets
 */
export async function startPolymarket() {
  console.log('[Polymarket] Starting integration...');

  // 1. Fetch events via Gamma REST
  const events = await fetchGammaEvents();
  console.log(`[Polymarket] Fetched ${events.length} events from Gamma API`);

  const assetIds = processGammaEvents(events);
  console.log(`[Polymarket] Matched ${state.marketData.size} events to bracket. ${assetIds.length} asset IDs.`);

  // Notify with initial data
  notifyListeners({ type: 'init' });

  // 2. Connect CLOB WebSocket for live odds
  if (assetIds.length > 0) {
    connectClobWs(assetIds);
  }

  // 3. Re-fetch Gamma every 60s to pick up new events
  gammaInterval = setInterval(async () => {
    const freshEvents = await fetchGammaEvents();
    const freshAssetIds = processGammaEvents(freshEvents);
    notifyListeners({ type: 'refresh' });
    // Reconnect CLOB if we have new assets
    if (freshAssetIds.length > 0 && clobWs?.readyState !== WebSocket.OPEN) {
      connectClobWs(freshAssetIds);
    }
  }, 60000);
}

/**
 * Stop all Polymarket connections
 */
export function stopPolymarket() {
  clearInterval(gammaInterval);
  clearInterval(clobPingInterval);
  clearTimeout(clobReconnectTimer);
  if (clobWs) { try { clobWs.close(); } catch {} }
}
