import matchupsData from '../data/matchups.json';
import { getR64Matchup, getGeneratedMatchup, getRegionR64Matchups, REGIONS } from './propagation.js';

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
  // Try shortDisplayName first, then displayName, then name
  const names = [
    espnCompetitor.team?.shortDisplayName,
    espnCompetitor.team?.displayName,
    espnCompetitor.team?.name,
  ].filter(Boolean);

  for (const n of names) {
    const id = ESPN_TO_TEAM_ID[n.toLowerCase()];
    if (id) return id;
  }

  // Try matching by stripping common suffixes from displayName
  const displayName = espnCompetitor.team?.displayName || '';
  for (const [espnLower, teamId] of Object.entries(ESPN_TO_TEAM_ID)) {
    if (displayName.toLowerCase().startsWith(espnLower)) return teamId;
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
  // Preserve existing odds and Polymarket-only entries across ESPN refreshes
  const prevOdds = new Map();
  const polymarketOnlyEntries = new Map();
  for (const [id, entry] of scoreMap) {
    if (entry.odds) prevOdds.set(id, entry.odds);
    // Keep entries that were created solely for Polymarket odds (scheduled, no ESPN data)
    if (entry.odds && entry.status === 'scheduled') {
      polymarketOnlyEntries.set(id, entry);
    }
  }
  scoreMap.clear();

  for (const event of events) {
    const comp = event.competitions?.[0];
    if (!comp) continue;

    const competitors = comp.competitors || [];
    if (competitors.length !== 2) continue;

    const teamIdA = findTeamId(competitors[0]);
    const teamIdB = findTeamId(competitors[1]);
    if (!teamIdA || !teamIdB) continue;

    const matchupId = findMatchupIdForTeams(teamIdA, teamIdB);
    if (!matchupId) continue;

    // Determine which ESPN competitor maps to team1/team2 in our matchup
    const [team1Id, team2Id] = getMatchupTeamOrder(matchupId);
    const compForTeam1 = competitors.find(c => findTeamId(c) === team1Id);
    const compForTeam2 = competitors.find(c => findTeamId(c) === team2Id);

    const status = normalizeStatus(event.status);
    const team1Score = parseInt(compForTeam1?.score ?? '0', 10);
    const team2Score = parseInt(compForTeam2?.score ?? '0', 10);

    const period = event.status?.period || 0;
    const clock = event.status?.displayClock || '';

    scoreMap.set(matchupId, {
      status,
      clock,
      period,
      team1Score,
      team2Score,
      odds: prevOdds.get(matchupId) || null,
    });
  }

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

async function fetchPolymarketOdds() {
  fetchStatus.polymarketLoading = true;
  notifyListeners();
  try {
    // Try multiple tag variations for NCAA basketball on Polymarket Gamma API.
    // The correct tag may vary — try several and also a broad fallback.
    const tagVariants = [
      'ncaa-basketball', 'march-madness', 'ncaa', 'college-basketball', 'cbb', 'basketball',
    ];
    const base = 'https://gamma-api.polymarket.com/events?active=true&closed=false&limit=100';

    // Fire all tag queries in parallel, plus a broad tagless search
    const fetches = [
      ...tagVariants.map(tag => fetchViaProxy(`${base}&tag=${tag}`)),
      fetchViaProxy(`${base}`),  // broad fallback — no tag filter
    ];
    const responses = await Promise.all(fetches);

    // Collect all unique events by id
    const seenIds = new Set();
    const allEvents = [];
    for (const res of responses) {
      if (!res) continue;
      try {
        const data = await res.json();
        if (!Array.isArray(data)) continue;
        for (const event of data) {
          if (!seenIds.has(event.id)) {
            seenIds.add(event.id);
            allEvents.push(event);
          }
        }
      } catch { continue; }
    }
    const events = allEvents;
    console.log(`[Polymarket] Fetched ${events.length} events, checking for NCAA matchups...`);

    let matchedCount = 0;
    for (const event of events) {
      const title = event.title || '';
      const result = matchPolymarketEvent(title);
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

      if (team1Prob && team2Prob) {
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

async function fetchScores() {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');

  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=50&limit=365`;

  // Fetch ESPN scores first, notify immediately so scores appear fast
  fetchStatus.espnLoading = true;
  notifyListeners();
  try {
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      processEvents(data.events || []);
      fetchStatus.espnLastLoaded = Date.now();
    }
  } catch {
    // Silent failure — bracket works without scores
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
}

export function stopPolling() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
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
