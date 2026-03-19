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

    // Extract odds
    let odds = null;
    const oddsData = comp.odds?.[0];
    if (oddsData) {
      odds = {
        spreadText: oddsData.details || '',
        overUnder: oddsData.overUnder ? String(oddsData.overUnder) : '',
        moneyline1: null,
        moneyline2: null,
      };
      // Try to extract moneylines from the odds data
      if (oddsData.homeTeamOdds && oddsData.awayTeamOdds) {
        // Figure out which is team1 vs team2
        const homeTeamId = findTeamId({ team: comp.competitors?.find(c => c.homeAway === 'home')?.team || {} });
        if (homeTeamId === team1Id) {
          odds.moneyline1 = formatMoneyline(oddsData.homeTeamOdds?.moneyLine);
          odds.moneyline2 = formatMoneyline(oddsData.awayTeamOdds?.moneyLine);
        } else {
          odds.moneyline1 = formatMoneyline(oddsData.awayTeamOdds?.moneyLine);
          odds.moneyline2 = formatMoneyline(oddsData.homeTeamOdds?.moneyLine);
        }
      }
    }

    const period = event.status?.period || 0;
    const clock = event.status?.displayClock || '';

    scoreMap.set(matchupId, {
      status,
      clock,
      period,
      team1Score,
      team2Score,
      odds,
    });
  }
}

function formatMoneyline(ml) {
  if (ml == null) return null;
  return ml > 0 ? `+${ml}` : String(ml);
}

async function fetchScores() {
  // Fetch today's scores; also fetch yesterday and tomorrow to catch games near midnight
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');

  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}&groups=50&limit=365`;

  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    processEvents(data.events || []);
    for (const cb of listeners) {
      try { cb(); } catch {}
    }
  } catch {
    // Silent failure — bracket works without scores
  }
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

export function onScoresUpdate(callback) {
  listeners.push(callback);
  return () => {
    const idx = listeners.indexOf(callback);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}
