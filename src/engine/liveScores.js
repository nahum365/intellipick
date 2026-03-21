import matchupsData from '../data/matchups.json';
import { getR64Matchup, getGeneratedMatchup, getRegionR64Matchups, REGIONS } from './propagation.js';
import { startPolymarket, stopPolymarket, onPolymarketUpdate, getPolymarketStatus } from './polymarket.js';

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
ESPN_TO_TEAM_ID['cbu'] = 'california-baptist';
ESPN_TO_TEAM_ID['ca baptist'] = 'california-baptist';

// Score cache: matchupId -> normalized score object
const scoreMap = new Map();
// Listeners notified after each fetch
const listeners = [];
let pollIntervalId = null;

// Fetch status tracking
const fetchStatus = {
  espnLoading: false,
  espnLastLoaded: null,
  espnFailed: false,
  espnHasStaleData: false,
  espnRetryCount: 0,
  espnRetryMax: 5,
  espnRetryInterval: 10000,
  espnNextRetryAt: null,    // timestamp of next retry
  espnExhausted: false,     // true when all retries used up
};
let espnRetryTimer = null;
let espnCountdownInterval = null;

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

    // Extract US broadcast channel(s) from ESPN
    const broadcasts = [];
    const geoBroadcasts = comp.geoBroadcasts || [];
    for (const gb of geoBroadcasts) {
      const name = gb.media?.shortName || gb.media?.name;
      if (name) broadcasts.push(name);
    }
    // Fall back to the simpler broadcasts array if geoBroadcasts is empty
    if (broadcasts.length === 0) {
      for (const b of (comp.broadcasts || [])) {
        for (const n of (b.names || [])) {
          if (n) broadcasts.push(n);
        }
      }
    }
    const broadcastChannel = broadcasts.length > 0 ? broadcasts.join(' / ') : null;

    scoreMap.set(matchupId, {
      status,
      clock,
      period,
      team1Score,
      team2Score,
      gameDate,
      broadcastChannel,
    });
    console.log(`[ESPN] Matched ${teamIdA} vs ${teamIdB} -> ${matchupId} (${status}, ${team1Score}-${team2Score})`);
    matched++;
  }

  console.log(`[ESPN] processEvents: ${matched} matched, ${unmatched} unmatched out of ${events.length} events`);
}




function notifyListeners(detail) {
  for (const cb of listeners) {
    try { cb(detail); } catch {}
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

async function fetchScoresInner() {
  const dates = getTournamentDatesToFetch();

  const fetches = dates.map(date =>
    fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${date}&groups=50&limit=100`)
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
  );
  const results = await Promise.all(fetches);

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

  if (allEvents.length === 0 && results.every(r => r === null)) {
    throw new Error('All ESPN requests failed');
  }

  console.log(`[ESPN] Fetched ${allEvents.length} total events from ${dates.length} date queries`);
  processEvents(allEvents);
  return allEvents.length;
}

function clearEspnRetry() {
  clearTimeout(espnRetryTimer);
  clearInterval(espnCountdownInterval);
  espnRetryTimer = null;
  espnCountdownInterval = null;
}

function scheduleEspnRetry() {
  if (fetchStatus.espnRetryCount >= fetchStatus.espnRetryMax) {
    fetchStatus.espnExhausted = true;
    fetchStatus.espnNextRetryAt = null;
    notifyListeners({ type: 'status' });
    return;
  }
  fetchStatus.espnNextRetryAt = Date.now() + fetchStatus.espnRetryInterval;
  // Tick every second to update countdown display
  espnCountdownInterval = setInterval(() => notifyListeners({ type: 'status' }), 1000);
  espnRetryTimer = setTimeout(() => {
    clearInterval(espnCountdownInterval);
    espnCountdownInterval = null;
    fetchScores();
  }, fetchStatus.espnRetryInterval);
  notifyListeners({ type: 'status' });
}

async function fetchScores() {
  fetchStatus.espnLoading = true;
  fetchStatus.espnFailed = false;
  clearEspnRetry();
  notifyListeners({ type: 'status' });

  try {
    await fetchScoresInner();
    fetchStatus.espnLastLoaded = Date.now();
    fetchStatus.espnFailed = false;
    fetchStatus.espnHasStaleData = true;
    fetchStatus.espnRetryCount = 0;
    fetchStatus.espnExhausted = false;
    fetchStatus.espnNextRetryAt = null;
  } catch (err) {
    console.warn('[ESPN] Fetch error:', err);
    fetchStatus.espnFailed = true;
    fetchStatus.espnHasStaleData = fetchStatus.espnLastLoaded !== null;
    fetchStatus.espnRetryCount++;
    fetchStatus.espnLoading = false;
    scheduleEspnRetry();
    return;
  } finally {
    fetchStatus.espnLoading = false;
  }
  notifyListeners();
}

export function startPolling() {
  fetchScores();
  pollIntervalId = setInterval(fetchScores, 30000);

  // Start Polymarket integration (series_id=10470 + CLOB WebSocket)
  startPolymarket().catch(err => console.warn('[Polymarket] Init error:', err));

  // Pass polymarket update details through so the UI can do targeted updates
  onPolymarketUpdate((detail) => notifyListeners(detail));
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

/**
 * Get the winning team object from a final game.
 * Returns { id, name, seed } of the winner, or null if game isn't final.
 */
export function getWinner(matchupId) {
  const score = scoreMap.get(matchupId);
  if (!score || score.status !== 'final') return null;

  // Look up the matchup to get team objects
  const r64 = getR64Matchup(matchupId);
  if (r64 && r64.team1 && r64.team2) {
    return score.team1Score > score.team2Score ? r64.team1 : r64.team2;
  }
  return null;
}

export function getFetchStatus() {
  return { ...fetchStatus, poly: getPolymarketStatus() };
}

export function onScoresUpdate(callback) {
  listeners.push(callback);
  return () => {
    const idx = listeners.indexOf(callback);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}
