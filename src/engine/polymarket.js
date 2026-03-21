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
// Status tracking
// ---------------------------------------------------------------------------
const polyStatus = {
  gammaState: 'idle',    // 'idle' | 'loading' | 'success' | 'failed'
  clobState: 'idle',     // 'idle' | 'connected' | 'failed'
};

// ---------------------------------------------------------------------------
// Debouncing — batch CLOB updates, only notify if displayed % changed
// ---------------------------------------------------------------------------
let debouncedMatchups = new Set();
let debounceTimer = null;
const DEBOUNCE_MS = 500;

// Snapshot of last-notified rounded percentages per matchup
const lastNotifiedPcts = new Map();

function scheduleNotify(matchupId) {
  debouncedMatchups.add(matchupId);
  if (debounceTimer) return;
  debounceTimer = setTimeout(flushDebouncedNotify, DEBOUNCE_MS);
}

function flushDebouncedNotify() {
  debounceTimer = null;
  const changed = [];
  for (const mid of debouncedMatchups) {
    const data = state.marketData.get(mid);
    if (!data) continue;
    const r1 = Math.round(data.team1Prob * 100);
    const r2 = Math.round(data.team2Prob * 100);
    const prev = lastNotifiedPcts.get(mid);
    if (!prev || prev.r1 !== r1 || prev.r2 !== r2) {
      lastNotifiedPcts.set(mid, { r1, r2 });
      changed.push(mid);
    }
  }
  debouncedMatchups.clear();
  if (changed.length > 0) {
    notifyListeners({ type: 'odds', matchupIds: changed });
  }
}

// ---------------------------------------------------------------------------
// Gamma REST API — market discovery
// ---------------------------------------------------------------------------
const GAMMA_BASE = 'https://gamma-api.polymarket.com';
const SERIES_ID = '10470'; // NCAA Men's Basketball

async function fetchGammaEvents() {
  const url = `${GAMMA_BASE}/events?series_id=${SERIES_ID}&active=true&closed=false&limit=100`;
  const proxyUrl = 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url);
  try {
    const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(60000) });
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

    // Prefer the moneyline market; fall back to first market if none tagged
    const market = markets.find(m =>
      (m.sportsMarketType || '').toLowerCase() === 'moneyline'
    ) || markets[0];
    const outcomes = safeParse(market.outcomes);
    const prices = safeParse(market.outcomePrices);
    const tokenIds = safeParse(market.clobTokenIds);

    if (outcomes.length < 2 || tokenIds.length < 2) continue;

    // Store initial prices from Gamma (outcomePrices are per-outcome, use as-is)
    for (let i = 0; i < tokenIds.length; i++) {
      const assetId = tokenIds[i];
      const rawProb = parseFloat(prices[i]) || 0;
      state.prices.set(assetId, {
        prob: rawProb,
        gammaProb: rawProb,
        bestBid: 0,
        bestAsk: 0,
        lastTradePrice: 0,
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
      team1AssetId = tokenIds[i] || null;
      const entry = team1AssetId ? state.prices.get(team1AssetId) : null;
      team1Prob = entry ? entry.prob : (parseFloat(prices[i]) || 0);
    } else if (matchesTeam2 && !matchesTeam1) {
      team2AssetId = tokenIds[i] || null;
      const entry = team2AssetId ? state.prices.get(team2AssetId) : null;
      team2Prob = entry ? entry.prob : (parseFloat(prices[i]) || 0);
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
    eventTitle: event.title || '',
    marketQuestion: market.question || market.groupItemTitle || '',
    conditionId: market.conditionId || '',
    sportsMarketType: market.sportsMarketType || 'unknown',
    team1Id,
    team2Id,
    team1Prob,
    team2Prob,
    team1AssetId,
    team2AssetId,
    team1OutcomePrice: parseFloat(prices[outcomes.indexOf(
      outcomes.find((o, i) => tokenIds[i] === team1AssetId)
    )]) || 0,
    team2OutcomePrice: parseFloat(prices[outcomes.indexOf(
      outcomes.find((o, i) => tokenIds[i] === team2AssetId)
    )]) || 0,
    outcomes: [...outcomes],
    volume: parseFloat(market.volume) || 0,
    liquidity: parseFloat(market.liquidity) || 0,
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
    polyStatus.clobState = 'connected';
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
      const msg = JSON.parse(raw);
      if (msg.event_type === 'price_change' && Array.isArray(msg.price_changes)) {
        for (const change of msg.price_changes) {
          handleClobPriceChange(change);
        }
      }
    } catch {
      // Non-JSON message, ignore
    }
  };

  clobWs.onclose = () => {
    console.log('[Polymarket CLOB WS] Disconnected');
    polyStatus.clobState = 'failed';
    clearInterval(clobPingInterval);
    scheduleReconnect('clob', assetIds);
  };

  clobWs.onerror = () => {
    console.warn('[Polymarket CLOB WS] Error');
    polyStatus.clobState = 'failed';
  };
}

/**
 * Compute the displayed probability from CLOB order-book data.
 *  1. Tight spread (≤ 0.10): midpoint of bid/ask
 *  2. One-sided book: use the available side (ask-only or bid-only)
 *  3. No usable book data: return null (caller should fall back to gamma)
 *
 * LTP is intentionally excluded — it can be hours/days stale and produces
 * wildly incoherent results (e.g. 100% / 95% for a two-outcome market).
 */
function computeDisplayProb(entry) {
  const { bestBid, bestAsk } = entry;
  const hasBid = bestBid > 0;
  const hasAsk = bestAsk > 0;

  if (hasBid && hasAsk) {
    const spread = bestAsk - bestBid;
    if (spread <= 0.10) {
      return (bestBid + bestAsk) / 2;
    }
    // Wide spread — not reliable enough
    return null;
  }

  // One-sided book: use what we have as a rough estimate
  if (hasAsk) return bestAsk;
  if (hasBid) return bestBid;

  // No book data at all
  return null;
}

/**
 * Handle a single entry from the price_changes array.
 * Each entry has: { asset_id, price, size, side, hash, best_bid, best_ask }
 */
function handleClobPriceChange(change) {
  if (!change || !change.asset_id) return;

  const assetId = change.asset_id;
  const existing = state.prices.get(assetId) || { prob: 0, gammaProb: 0, bestBid: 0, bestAsk: 0, lastTradePrice: 0, volume: 0, liquidity: 0 };
  const mapping = state.assetToTeam.get(assetId);

  // Update last trade price (kept for debug display, not used for prob)
  const tp = parseFloat(change.price);
  if (tp > 0 && tp < 1) {
    existing.lastTradePrice = tp;
  }

  // Update best bid/ask
  const bid = parseFloat(change.best_bid);
  const ask = parseFloat(change.best_ask);
  if (bid > 0) existing.bestBid = bid;
  else if (change.best_bid === '' || change.best_bid === '0') existing.bestBid = 0;
  if (ask > 0) existing.bestAsk = ask;
  else if (change.best_ask === '' || change.best_ask === '0') existing.bestAsk = 0;

  // Compute CLOB-derived prob (may be null if book is unusable)
  existing.clobProb = computeDisplayProb(existing);
  state.prices.set(assetId, existing);

  if (mapping) {
    updateMarketDataFromWs(mapping.matchupId);
    scheduleNotify(mapping.matchupId);
  }
}

function updateMarketDataFromWs(matchupId) {
  const data = state.marketData.get(matchupId);
  if (!data) return;

  const t1Price = data.team1AssetId ? state.prices.get(data.team1AssetId) : null;
  const t2Price = data.team2AssetId ? state.prices.get(data.team2AssetId) : null;

  const t1Clob = t1Price?.clobProb ?? null;
  const t2Clob = t2Price?.clobProb ?? null;

  let newT1, newT2;

  if (t1Clob != null && t2Clob != null) {
    // Both sides have CLOB data — validate they sum close to 1
    const sum = t1Clob + t2Clob;
    if (sum > 0.85 && sum < 1.15) {
      newT1 = t1Clob;
      newT2 = t2Clob;
    } else {
      // Incoherent — reject this update, keep last valid state
      return;
    }
  } else if (t1Clob != null) {
    // Only team 1 has CLOB data — derive team 2
    newT1 = t1Clob;
    newT2 = 1 - t1Clob;
  } else if (t2Clob != null) {
    // Only team 2 has CLOB data — derive team 1
    newT2 = t2Clob;
    newT1 = 1 - t2Clob;
  } else {
    // No CLOB data yet — keep current state (gamma on first load)
    return;
  }

  let anyChange = false;
  const prevT1 = data.team1Prob;
  const prevT2 = data.team2Prob;

  data.team1Prob = newT1;
  data.team2Prob = newT2;
  data.team1ProbDelta = newT1 - prevT1;
  data.team2ProbDelta = newT2 - prevT2;

  if (Math.abs(data.team1ProbDelta) > 0.001 || Math.abs(data.team2ProbDelta) > 0.001) {
    anyChange = true;
  }

  if (anyChange) {
    data.lastChangeTime = Date.now();
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
 * Get raw per-asset CLOB price state (for diagnostics)
 */
export function getAssetPriceState(assetId) {
  return state.prices.get(assetId) || null;
}

/**
 * Start Polymarket integration: fetch Gamma, connect WebSockets
 */
let lastAssetIds = [];

async function doGammaFetch() {
  polyStatus.gammaState = 'loading';
  notifyListeners({ type: 'status' });

  const events = await fetchGammaEvents();
  if (events.length === 0) {
    // Only mark failed if we never had a successful fetch
    if (state.marketData.size === 0) {
      polyStatus.gammaState = 'failed';
    }
    notifyListeners({ type: 'status' });
    return [];
  }

  polyStatus.gammaState = 'success';
  const assetIds = processGammaEvents(events);
  lastAssetIds = assetIds;
  console.log(`[Polymarket] Matched ${state.marketData.size} events to bracket. ${assetIds.length} asset IDs.`);
  notifyListeners({ type: 'init' });
  return assetIds;
}

export async function startPolymarket() {
  console.log('[Polymarket] Starting integration...');

  const assetIds = await doGammaFetch();

  // Connect CLOB WebSocket for live odds
  if (assetIds.length > 0) {
    connectClobWs(assetIds);
  }

  // Re-fetch Gamma every 60s to pick up new events
  gammaInterval = setInterval(async () => {
    const freshAssetIds = await doGammaFetch();
    if (freshAssetIds.length > 0 && clobWs?.readyState !== WebSocket.OPEN) {
      connectClobWs(freshAssetIds);
    }
  }, 60000);
}

export async function refreshGamma() {
  const assetIds = await doGammaFetch();
  if (assetIds.length > 0) {
    connectClobWs(assetIds);
  }
}

/**
 * Stop all Polymarket connections
 */
export function getPolymarketStatus() {
  return { ...polyStatus };
}

export function stopPolymarket() {
  clearInterval(gammaInterval);
  clearInterval(clobPingInterval);
  clearTimeout(clobReconnectTimer);
  if (clobWs) { try { clobWs.close(); } catch {} }
}
