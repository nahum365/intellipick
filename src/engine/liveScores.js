import matchupsData from '../data/matchups.json';
import { getR64Matchup, getGeneratedMatchup, getRegionR64Matchups, REGIONS } from './propagation.js';
import { startPolymarket, stopPolymarket, getMarketData, getAllMarketData, onPolymarketUpdate } from './polymarket.js';

// Map internal team IDs to ESPN shortDisplayName values
const TEAM_ID_TO_ESPN = {
  'duke': 'Duke',
  'siena': 'Siena',
  'ohio-state': 'Ohio State',
  'tcu': 'TCU',
  'st-johns': "St. John's",
  'northern-iowa': 'N Iowa',
  'kansas': 'Kansas',
  'california-baptist': 'Cal Baptist',
  'louisville': 'Louisville',
  'south-florida': 'South Florida',
  'michigan-state': 'Michigan St',
  'north-dakota-state': 'N Dakota St',
  'ucla': 'UCLA',
  'ucf': 'UCF',
  'uconn': 'UConn',
  'furman': 'Furman',
  'arizona': 'Arizona',
  'liu': 'LIU',
  'villanova': 'Villanova',
  'utah-state': 'Utah State',
  'wisconsin': 'Wisconsin',
  'high-point': 'High Point',
  'arkansas': 'Arkansas',
  'hawaii': "Hawai'i",
  'byu': 'BYU',
  'texas': 'Texas',
  'gonzaga': 'Gonzaga',
  'kennesaw-state': 'Kennesaw St',
  'miami-fl': 'Miami',
  'missouri': 'Missouri',
  'purdue': 'Purdue',
  'queens': 'Queens',
  'michigan': 'Michigan',
  'howard': 'Howard',
  'georgia': 'Georgia',
  'saint-louis': 'Saint Louis',
  'texas-tech': 'Texas Tech',
  'akron': 'Akron',
  'alabama': 'Alabama',
  'hofstra': 'Hofstra',
  'tennessee': 'Tennessee',
  'miami-oh': 'Miami (OH)',
  'virginia': 'Virginia',
  'wright-state': 'Wright State',
  'kentucky': 'Kentucky',
  'santa-clara': 'Santa Clara',
  'iowa-state': 'Iowa State',
  'tennessee-state': 'Tennessee St',
  'florida': 'Florida',
  'prairie-view-am': 'Prairie View',
  'clemson': 'Clemson',
  'iowa': 'Iowa',
  'vanderbilt': 'Vanderbilt',
  'mcneese': 'McNeese',
  'nebraska': 'Nebraska',
  'troy': 'Troy',
  'north-carolina': 'North Carolina',
  'vcu': 'VCU',
  'illinois': 'Illinois',
  'penn': 'Penn',
  'saint-marys': "Saint Mary's",
  'texas-am': 'Texas A&M',
  'houston': 'Houston',
  'idaho': 'Idaho',
};

// Build reverse map: ESPN short name (lowercase) -> internal team ID
const ESPN_TO_TEAM_ID = {};
for (const [id, espnName] of Object.entries(TEAM_ID_TO_ESPN)) {
  ESPN_TO_TEAM_ID[espnName.toLowerCase()] = id;
}
// Extra aliases for ESPN name variants that don't match the canonical map
ESPN_TO_TEAM_ID['miami oh'] = 'miami-oh';
ESPN_TO_TEAM_ID['m-oh'] = 'miami-oh';
ESPN_TO_TEAM_ID['miami (ohio)'] = 'miami-oh';
ESPN_TO_TEAM_ID['miami-oh'] = 'miami-oh';

// Score cache: matchupId -> normalized score object
const scoreMap = new Map();
// Listeners notified after each fetch
const listeners = [];
let pollIntervalId = null;

// Fetch status tracking
const fetchStatus = {
  espnLoading: false,
  polymarketLoading: false,
  espnLastLoaded: null,
  polymarketLastLoaded: null,
};

function normalizeStatus(espnStatus) {
  if (!espnStatus || !espnStatus.type) return 'scheduled';
  const name = espnStatus.type.name || espnStatus.type.state;
  if (name === 'STATUS_FINAL' || espnStatus.type.completed) return 'final';
  if (name === 'STATUS_HALFTIME') return 'halftime';
  if (name === 'STATUS_IN_PROGRESS') return 'live';
  if (name === 'STATUS_SCHEDULED' || name === 'STATUS_PREGAME') return 'scheduled';
  // Fallback based on state
  if (espnStatus.type.state === 'in') return 'live';
  if (espnStatus.type.state === 'post') return 'final';
  return 'scheduled';
}

function findTeamId(espnCompetitor) {
  const team = espnCompetitor.team || {};
  // Gather all available name variants from ESPN
  const rawNames = [
    team.shortDisplayName,
    team.displayName,
    team.name,
    team.abbreviation,
  ].filter(Boolean);

  // Direct exact match (case-insensitive)
  // Sort longest-first so "Miami (OH)" matches before "Miami" (avoids miami-fl/miami-oh confusion)
  const sortedNames = [...rawNames].sort((a, b) => b.length - a.length);
  for (const n of sortedNames) {
    const id = ESPN_TO_TEAM_ID[n.toLowerCase()];
    if (id) return id;
  }

  // Strip parentheticals like "(FL)", "(OH)", "(Fla.)" and retry
  for (const n of rawNames) {
    const stripped = n.replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();
    if (stripped) {
      const id = ESPN_TO_TEAM_ID[stripped];
      if (id) return id;
    }
  }

  // Prefix matching: does ESPN's displayName start with any of our known names?
  const displayLower = (team.displayName || '').toLowerCase();
  for (const [espnLower, teamId] of Object.entries(ESPN_TO_TEAM_ID)) {
    if (espnLower.length >= 4 && displayLower.startsWith(espnLower)) return teamId;
  }

  // Substring matching as last resort (only for longer names to avoid false positives)
  for (const [espnLower, teamId] of Object.entries(ESPN_TO_TEAM_ID)) {
    if (espnLower.length >= 6) {
      for (const n of rawNames) {
        if (n.toLowerCase().includes(espnLower) || espnLower.includes(n.toLowerCase())) {
          return teamId;
        }
      }
    }
  }

  return null;
}

// Build a list of all R64 matchup IDs for lookup
function getAllR64Matchups() {
  const all = [];
  for (const region of REGIONS) {
    const ids = getRegionR64Matchups(region);
    for (const id of ids) {
      const m = getR64Matchup(id);
      if (m) all.push({ id, matchup: m });
    }
  }
  return all;
}

function findMatchupIdForTeams(teamId1, teamId2) {
  // Check R64 matchups first
  const r64s = getAllR64Matchups();
  for (const { id, matchup } of r64s) {
    if (!matchup.team1 || !matchup.team2) continue;
    const ids = [matchup.team1.id, matchup.team2.id];
    if (ids.includes(teamId1) && ids.includes(teamId2)) return id;
  }

  // Check generated later-round matchups
  for (const region of REGIONS) {
    const r = region.toLowerCase();
    for (let round = 2; round <= 4; round++) {
      const maxPos = round === 2 ? 4 : round === 3 ? 2 : 1;
      for (let pos = 0; pos < maxPos; pos++) {
        const id = `${r}-r${round}-${pos}`;
        const gen = getGeneratedMatchup(id);
        if (gen && gen.team1 && gen.team2) {
          const ids = [gen.team1.id, gen.team2.id];
          if (ids.includes(teamId1) && ids.includes(teamId2)) return id;
        }
      }
    }
  }

  // Check Final Four and Championship
  for (const id of ['ff-0', 'ff-1', 'championship']) {
    const gen = getGeneratedMatchup(id);
    if (gen && gen.team1 && gen.team2) {
      const ids = [gen.team1.id, gen.team2.id];
      if (ids.includes(teamId1) && ids.includes(teamId2)) return id;
    }
  }

  return null;
}

function getMatchupTeamOrder(matchupId) {
  // Returns [team1Id, team2Id] for the matchup to align scores correctly
  const r64 = getR64Matchup(matchupId);
  if (r64 && r64.team1 && r64.team2) return [r64.team1.id, r64.team2.id];
  const gen = getGeneratedMatchup(matchupId);
  if (gen && gen.team1 && gen.team2) return [gen.team1.id, gen.team2.id];
  return [null, null];
}

function processEvents(events) {
  // Preserve existing odds across ESPN refreshes
  const prevOdds = new Map();
  const polymarketOnlyEntries = new Map();
  for (const [id, entry] of scoreMap) {
    if (entry.odds) prevOdds.set(id, entry.odds);
    // Keep entries that were created solely for Polymarket odds (no ESPN data)
    if (entry._polymarketOnly) {
      polymarketOnlyEntries.set(id, entry);
    }
  }
  scoreMap.clear();

  let matched = 0, unmatched = 0;

  for (const event of events) {
    const comp = event.competitions?.[0];
    if (!comp) continue;

    const competitors = comp.competitors || [];
    if (competitors.length !== 2) continue;

    const teamIdA = findTeamId(competitors[0]);
    const teamIdB = findTeamId(competitors[1]);
    if (!teamIdA || !teamIdB) {
      const nameA = competitors[0].team?.shortDisplayName || competitors[0].team?.displayName || '?';
      const nameB = competitors[1].team?.shortDisplayName || competitors[1].team?.displayName || '?';
      console.log(`[ESPN] No team ID match: "${nameA}" (${teamIdA || 'unknown'}) vs "${nameB}" (${teamIdB || 'unknown'})`);
      unmatched++;
      continue;
    }

    const matchupId = findMatchupIdForTeams(teamIdA, teamIdB);
    if (!matchupId) {
      console.log(`[ESPN] No matchup found for ${teamIdA} vs ${teamIdB}`);
      unmatched++;
      continue;
    }

    // Determine which ESPN competitor maps to team1/team2 in our matchup
    const [team1Id, team2Id] = getMatchupTeamOrder(matchupId);
    const compForTeam1 = competitors.find(c => findTeamId(c) === team1Id);
    const compForTeam2 = competitors.find(c => findTeamId(c) === team2Id);

    const status = normalizeStatus(event.status);
    const team1Score = parseInt(compForTeam1?.score ?? '0', 10);
    const team2Score = parseInt(compForTeam2?.score ?? '0', 10);

    const period = event.status?.period || 0;
    const clock = event.status?.displayClock || '';
    const gameDate = event.date || comp.date || null;

    scoreMap.set(matchupId, {
      status,
      clock,
      period,
      team1Score,
      team2Score,
      gameDate,
      odds: prevOdds.get(matchupId) || null,
    });
    console.log(`[ESPN] Matched ${teamIdA} vs ${teamIdB} -> ${matchupId} (${status}, ${team1Score}-${team2Score})`);
    matched++;
  }

  console.log(`[ESPN] processEvents: ${matched} matched, ${unmatched} unmatched out of ${events.length} events`);

  // Restore Polymarket-only entries that ESPN didn't cover
  for (const [id, entry] of polymarketOnlyEntries) {
    if (!scoreMap.has(id)) {
      scoreMap.set(id, entry);
    }
  }
}

// Convert Polymarket probability (0-1) to American odds
function probToAmericanOdds(prob) {
  if (prob == null || prob <= 0 || prob >= 1) return null;
  if (prob >= 0.5) {
    return String(Math.round(-100 * prob / (1 - prob)));
  }
  return '+' + Math.round(100 * (1 - prob) / prob);
}

// Normalize team name for fuzzy matching with Polymarket event titles
function normalizeForMatch(name) {
  if (!name || typeof name !== 'string') return '';
  return name.toLowerCase()
    .replace(/['']/g, '')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Build a list of all name variants for each team for Polymarket matching
const TEAM_MATCH_NAMES = {};
for (const [teamId, espnName] of Object.entries(TEAM_ID_TO_ESPN)) {
  const names = new Set();
  names.add(normalizeForMatch(espnName));
  // Add the slug form (e.g. "north-carolina" -> "north carolina")
  names.add(teamId.replace(/-/g, ' '));
  // Common short forms
  if (espnName.includes(' St')) names.add(normalizeForMatch(espnName.replace(' St', ' State')));
  if (espnName.includes('State')) names.add(normalizeForMatch(espnName.replace(' State', ' St')));
  TEAM_MATCH_NAMES[teamId] = [...names].filter(n => n.length >= 3);
}

// Try to match a Polymarket event to an internal matchup by checking if both team
// names appear in the event title
function matchPolymarketEvent(eventTitle) {
  const normalized = normalizeForMatch(eventTitle);
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

  if (matched.length === 2) {
    const matchupId = findMatchupIdForTeams(matched[0], matched[1]);
    if (matchupId) {
      return { matchupId, teamIds: matched };
    }
  }
  return null;
}

// Parse outcome/price pairs from a Polymarket market object.
// The Gamma API may return outcomes as:
//   (a) tokens: [{outcome, price}, ...]
//   (b) outcomes: ["Team A","Team B"] + outcomePrices: '["0.65","0.35"]'
function parseMarketOutcomes(market) {
  // Format (a): tokens array with per-token price
  const tokens = market.tokens;
  if (Array.isArray(tokens) && tokens.length >= 2 && typeof tokens[0] === 'object') {
    return tokens.map(t => ({
      name: t.outcome || t.value || '',
      price: parseFloat(t.price ?? t.lastTradePrice ?? 0),
    }));
  }

  // Format (b): parallel outcomes + outcomePrices arrays
  const outcomes = market.outcomes;
  let prices = market.outcomePrices;
  if (Array.isArray(outcomes) && prices) {
    if (typeof prices === 'string') {
      try { prices = JSON.parse(prices); } catch { return []; }
    }
    if (Array.isArray(prices) && outcomes.length === prices.length) {
      return outcomes.map((name, i) => ({
        name: String(name),
        price: parseFloat(prices[i]) || 0,
      }));
    }
  }

  return [];
}

async function fetchViaProxy(targetUrl) {
  const proxies = [
    'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(targetUrl),
    'https://corsproxy.io/?' + encodeURIComponent(targetUrl),
  ];
  for (const proxyUrl of proxies) {
    try {
      const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
      if (r.ok) return r;
    } catch { continue; }
  }
  return null;
}

// Fetch JSON from Polymarket via proxy, returning parsed array or []
async function fetchPolymarketJson(targetUrl) {
  const res = await fetchViaProxy(targetUrl);
  if (!res) return [];
  try {
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

async function fetchPolymarketOdds() {
  fetchStatus.polymarketLoading = true;
  notifyListeners();
  try {
    const base = 'https://gamma-api.polymarket.com';

    // Strategy: use multiple search approaches in parallel to find NCAA basketball events.
    // The tag-based approach doesn't work (returns unrelated events), so we use:
    // 1. Text search via _q parameter (Strapi convention)
    // 2. Slug-based search
    // 3. Paginated broad search to look beyond the top 100
    const searches = [
      // Text searches for NCAA basketball
      `${base}/events?_q=NCAA&active=true&closed=false&limit=100`,
      `${base}/events?_q=March+Madness&active=true&closed=false&limit=100`,
      `${base}/events?_q=college+basketball&active=true&closed=false&limit=100`,
      // Also try the markets endpoint with text search
      `${base}/markets?_q=NCAA&active=true&closed=false&limit=100`,
      `${base}/markets?_q=March+Madness&active=true&closed=false&limit=100`,
      // Paginated broad event search (basketball events may be low-volume)
      `${base}/events?active=true&closed=false&limit=100&offset=0`,
      `${base}/events?active=true&closed=false&limit=100&offset=100`,
      `${base}/events?active=true&closed=false&limit=100&offset=200`,
      `${base}/events?active=true&closed=false&limit=100&offset=300`,
      // Tag attempts
      `${base}/events?tag=ncaa&active=true&closed=false&limit=100`,
      `${base}/events?tag=march-madness&active=true&closed=false&limit=100`,
      `${base}/events?tag=sports&active=true&closed=false&limit=100`,
      `${base}/events?tag=ncaa-basketball&active=true&closed=false&limit=100`,
    ];

    const results = await Promise.all(searches.map(url => fetchPolymarketJson(url)));

    // Collect all unique events by id.
    // Markets endpoint returns market objects (no sub-markets array), so we normalize.
    const seenIds = new Set();
    const allEvents = [];
    for (const data of results) {
      for (const item of data) {
        const id = item.id;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        // If this came from /markets endpoint, wrap it as a pseudo-event
        if (!item.markets && item.outcomes) {
          allEvents.push({ id, title: item.question || '', markets: [item] });
        } else {
          allEvents.push(item);
        }
      }
    }

    console.log(`[Polymarket] Fetched ${allEvents.length} unique events/markets`);

    // Log a sample of titles to help debug
    const sampleTitles = allEvents.slice(0, 10).map(e => e.title || '(no title)');
    console.log('[Polymarket] Sample titles:', sampleTitles);

    let matchedCount = 0;
    for (const event of allEvents) {
      // Try matching by event title
      const title = event.title || '';
      let result = matchPolymarketEvent(title);

      // Also try matching by individual market questions
      if (!result && event.markets) {
        for (const m of event.markets) {
          result = matchPolymarketEvent(m.question || '');
          if (result) break;
        }
      }

      if (!result) continue;
      matchedCount++;
      console.log(`[Polymarket] Matched: "${title}" -> ${result.matchupId}`);

      const { matchupId, teamIds } = result;
      // Create a scoreMap entry if ESPN hasn't populated one yet
      if (!scoreMap.has(matchupId)) {
        scoreMap.set(matchupId, {
          status: 'scheduled',
          clock: '',
          period: 0,
          team1Score: 0,
          team2Score: 0,
          odds: null,
        });
      }
      const existing = scoreMap.get(matchupId);

      // Extract market prices from the event's markets
      const markets = event.markets || [];
      if (markets.length === 0) continue;

      const market = markets[0];
      const parsed = parseMarketOutcomes(market);
      if (parsed.length < 2) continue;

      // Figure out which outcome corresponds to which team
      const [team1Id, team2Id] = getMatchupTeamOrder(matchupId);
      const team1Names = TEAM_MATCH_NAMES[team1Id] || [];
      const team2Names = TEAM_MATCH_NAMES[team2Id] || [];

      function outcomeMatchesTeam(outcomeName, teamNames) {
        for (const variant of teamNames) {
          if (outcomeName.includes(variant) || variant.includes(outcomeName)) return true;
        }
        return false;
      }

      let team1Prob = null;
      let team2Prob = null;

      for (const { name, price } of parsed) {
        if (price <= 0 || price >= 1) continue;
        const outcomeName = normalizeForMatch(name);
        if (!outcomeName) continue;

        if (outcomeMatchesTeam(outcomeName, team1Names)) {
          team1Prob = price;
        } else if (outcomeMatchesTeam(outcomeName, team2Names)) {
          team2Prob = price;
        }
      }

      // If we only found one, infer the other
      if (team1Prob && !team2Prob) team2Prob = 1 - team1Prob;
      if (team2Prob && !team1Prob) team1Prob = 1 - team2Prob;

      // Only set proxy-based odds if WS-connected odds aren't already present
      if (team1Prob && team2Prob && !(existing.odds && existing.odds.wsConnected)) {
        existing.odds = {
          source: 'Polymarket',
          team1Prob: Math.round(team1Prob * 100),
          team2Prob: Math.round(team2Prob * 100),
          moneyline1: probToAmericanOdds(team1Prob),
          moneyline2: probToAmericanOdds(team2Prob),
        };
      }
    }
    console.log(`[Polymarket] Done. Matched ${matchedCount} events to bracket matchups.`);
    fetchStatus.polymarketLastLoaded = Date.now();
  } catch (err) {
    console.warn('[Polymarket] Fetch error:', err);
  } finally {
    fetchStatus.polymarketLoading = false;
  }
}

function notifyListeners() {
  for (const cb of listeners) {
    try { cb(); } catch {}
  }
}

// Generate tournament dates to query: past 6 days + today + tomorrow.
// Individual-day queries are more reliable than ESPN's date-range format.
function getTournamentDatesToFetch() {
  const today = new Date();
  const dates = [];
  // Past 6 days through tomorrow
  for (let i = -6; i <= 1; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    // Only include dates in tournament window (mid-March through early April)
    const mmdd = d.getMonth() * 100 + d.getDate(); // e.g., 316 for March 16
    if ((d.getMonth() === 2 && d.getDate() >= 14) || // March 14+
        (d.getMonth() === 3 && d.getDate() <= 12)) {  // April 1–12
      dates.push(`${year}${month}${day}`);
    }
  }
  return dates;
}

async function fetchScores() {
  const dates = getTournamentDatesToFetch();

  fetchStatus.espnLoading = true;
  notifyListeners();
  try {
    // Fetch all relevant dates in parallel
    const fetches = dates.map(date =>
      fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${date}&groups=50&limit=100`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    );
    const results = await Promise.all(fetches);

    // Merge events, deduplicating by ESPN event ID
    const seenIds = new Set();
    const allEvents = [];
    for (const data of results) {
      if (!data) continue;
      for (const event of (data.events || [])) {
        if (!seenIds.has(event.id)) {
          seenIds.add(event.id);
          allEvents.push(event);
        }
      }
    }

    console.log(`[ESPN] Fetched ${allEvents.length} total events from ${dates.length} date queries`);
    processEvents(allEvents);
    fetchStatus.espnLastLoaded = Date.now();
  } catch (err) {
    console.warn('[ESPN] Fetch error:', err);
  } finally {
    fetchStatus.espnLoading = false;
    notifyListeners();
  }

  // Fetch Polymarket odds separately — slower, non-blocking
  fetchPolymarketOdds().then(() => notifyListeners());
}

export function startPolling() {
  fetchScores();
  pollIntervalId = setInterval(fetchScores, 30000);

  // Start Polymarket WebSocket integration alongside polling
  startPolymarket().catch(err => console.warn('[Polymarket] Init error:', err));

  // When Polymarket WS sends updates, merge into scoreMap and notify
  onPolymarketUpdate((detail) => {
    if (detail && detail.matchupId) {
      mergePolymarketData(detail.matchupId);
    } else {
      // Bulk update (init/refresh) — merge all
      for (const matchupId of getAllMarketData().keys()) {
        mergePolymarketData(matchupId);
      }
    }
    notifyListeners();
  });
}

function mergePolymarketData(matchupId) {
  const mkt = getMarketData(matchupId);
  if (!mkt) return;

  // Ensure scoreMap entry exists
  if (!scoreMap.has(matchupId)) {
    scoreMap.set(matchupId, {
      status: 'scheduled',
      clock: '',
      period: 0,
      team1Score: 0,
      team2Score: 0,
      odds: null,
      _polymarketOnly: true, // flag so ESPN refresh preserves this entry
    });
  }

  const entry = scoreMap.get(matchupId);

  // Only update odds — never touch ESPN's authoritative score/status/clock data
  entry.odds = {
    source: 'Polymarket',
    team1Prob: Math.round(mkt.team1Prob * 100),
    team2Prob: Math.round(mkt.team2Prob * 100),
    moneyline1: mkt.moneyline1,
    moneyline2: mkt.moneyline2,
    team1ProbDelta: mkt.team1ProbDelta || 0,
    team2ProbDelta: mkt.team2ProbDelta || 0,
    volume: mkt.volume,
    liquidity: mkt.liquidity,
    bestBid: mkt.bestBid,
    bestAsk: mkt.bestAsk,
    sentiment: mkt.sentiment,
    live: mkt.live,
    wsConnected: true,
  };
}

export function stopPolling() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
  stopPolymarket();
}

export function getScoreForMatchup(matchupId) {
  return scoreMap.get(matchupId) || null;
}

export function getFetchStatus() {
  return { ...fetchStatus };
}

export function onScoresUpdate(callback) {
  listeners.push(callback);
  return () => {
    const idx = listeners.indexOf(callback);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}
