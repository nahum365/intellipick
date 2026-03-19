import matchupsData from '../data/matchups.json';
import { getPick, setPick, clearPick, getAllPicks } from './picks.js';

// Bracket structure: matchups pair up in order within each region
// R64 matchups 0,1 -> R32 slot 0; matchups 2,3 -> R32 slot 1; etc.
// Then R32 slots 0,1 -> S16 slot 0; etc.

const ROUNDS = ['First Round', 'Second Round', 'Sweet 16', 'Elite Eight', 'Final Four', 'Championship'];
const REGIONS = ['East', 'West', 'South', 'Midwest'];

// Build the bracket tree from R64 matchups
// Each region has 8 R64 matchups that feed into 4 R32, 2 S16, 1 E8
// Then E8 winners go to Final Four (cross-region)

// Region matchup ordering: seeds paired as 1v16, 8v9, 5v12, 4v13, 6v11, 3v14, 7v10, 2v15
// These pair up: (1v16 winner) vs (8v9 winner), (5v12 winner) vs (4v13 winner), etc.
const REGION_MATCHUP_ORDER = [
  'east-1-16', 'east-8-9', 'east-5-12', 'east-4-13', 'east-6-11', 'east-3-14', 'east-7-10', 'east-2-15',
  'west-1-16', 'west-8-9', 'west-5-12', 'west-4-13', 'west-6-11', 'west-3-14', 'west-7-10', 'west-2-15',
  'midwest-1-16', 'midwest-8-9', 'midwest-5-12', 'midwest-4-13', 'midwest-6-11', 'midwest-3-14', 'midwest-7-10', 'midwest-2-15',
  'south-1-16', 'south-8-9', 'south-5-12', 'south-4-13', 'south-6-11', 'south-3-14', 'south-7-10', 'south-2-15'
];

// Get R64 matchups for a region in bracket order
export function getRegionR64Matchups(region) {
  const prefix = region.toLowerCase();
  return REGION_MATCHUP_ORDER.filter(id => id.startsWith(prefix));
}

// Generate a later-round matchup ID
function laterRoundId(region, round, position) {
  return `${region.toLowerCase()}-r${round}-${position}`;
}

// Get the downstream matchup that a given matchup feeds into
export function getDownstreamMatchupId(matchupId, roundIndex) {
  const region = getMatchupRegion(matchupId);
  const regionR64 = getRegionR64Matchups(region);

  if (roundIndex === 0) {
    // R64 -> R32: pair matchups 0+1, 2+3, 4+5, 6+7
    const idx = regionR64.indexOf(matchupId);
    const r32Pos = Math.floor(idx / 2);
    return laterRoundId(region, 2, r32Pos);
  } else if (roundIndex === 1) {
    // R32 -> S16: pair 0+1, 2+3
    const pos = parseInt(matchupId.split('-').pop());
    return laterRoundId(region, 3, Math.floor(pos / 2));
  } else if (roundIndex === 2) {
    // S16 -> E8: pair 0+1
    return laterRoundId(region, 4, 0);
  } else if (roundIndex === 3) {
    // E8 -> F4: region champions meet
    // East vs West = ff-0, South vs Midwest = ff-1
    if (region === 'East' || region === 'West') return 'ff-0';
    return 'ff-1';
  } else if (roundIndex === 4) {
    // F4 -> Championship
    return 'championship';
  }
  return null;
}

function getMatchupRegion(matchupId) {
  if (matchupId.startsWith('east')) return 'East';
  if (matchupId.startsWith('west')) return 'West';
  if (matchupId.startsWith('midwest')) return 'Midwest';
  if (matchupId.startsWith('south')) return 'South';
  return null;
}

// Get the round index for a matchup ID
export function getRoundIndex(matchupId) {
  if (matchupId === 'championship') return 5;
  if (matchupId.startsWith('ff-')) return 4;
  const r64Ids = REGION_MATCHUP_ORDER;
  if (r64Ids.includes(matchupId)) return 0;
  // Parse later rounds from the ID format: region-rN-pos
  const parts = matchupId.split('-');
  const rPart = parts.find(p => p.startsWith('r'));
  if (rPart) {
    const roundNum = parseInt(rPart.slice(1));
    if (roundNum === 2) return 1;
    if (roundNum === 3) return 2;
    if (roundNum === 4) return 3;
  }
  return 0;
}

// Get all matchup IDs that are downstream of a given matchup
export function getDownstreamChain(matchupId) {
  const chain = [];
  let current = matchupId;
  let roundIdx = getRoundIndex(current);
  while (roundIdx < 5) {
    const next = getDownstreamMatchupId(current, roundIdx);
    if (!next) break;
    chain.push(next);
    current = next;
    roundIdx++;
  }
  return chain;
}

// When a pick is made, check if downstream picks need to be cleared
export function cascadePick(matchupId, pickedTeam) {
  const oldPick = getPick(matchupId);
  setPick(matchupId, pickedTeam);

  // If the pick changed, cascade clear downstream
  if (oldPick && oldPick.id !== pickedTeam.id) {
    const downstream = getDownstreamChain(matchupId);
    for (const dsId of downstream) {
      const dsPick = getPick(dsId);
      if (dsPick && dsPick.id === oldPick.id) {
        clearPick(dsId);
      }
    }
  }
}

// Build a generated matchup for later rounds based on current picks
export function getGeneratedMatchup(matchupId) {
  const roundIdx = getRoundIndex(matchupId);
  let team1 = null;
  let team2 = null;

  if (matchupId === 'championship') {
    team1 = getPick('ff-0');
    team2 = getPick('ff-1');
  } else if (matchupId.startsWith('ff-')) {
    const ffIdx = parseInt(matchupId.split('-')[1]);
    if (ffIdx === 0) {
      team1 = getPick(laterRoundId('east', 4, 0));
      team2 = getPick(laterRoundId('west', 4, 0));
    } else {
      team1 = getPick(laterRoundId('south', 4, 0));
      team2 = getPick(laterRoundId('midwest', 4, 0));
    }
  } else {
    // Find the two feeder matchups
    const region = getMatchupRegion(matchupId);
    const pos = parseInt(matchupId.split('-').pop());

    if (roundIdx === 1) {
      // R32: fed by R64 matchups at positions pos*2 and pos*2+1
      const r64s = getRegionR64Matchups(region);
      team1 = getPick(r64s[pos * 2]);
      team2 = getPick(r64s[pos * 2 + 1]);
    } else if (roundIdx === 2) {
      // S16: fed by R32 at positions pos*2 and pos*2+1
      team1 = getPick(laterRoundId(region, 2, pos * 2));
      team2 = getPick(laterRoundId(region, 2, pos * 2 + 1));
    } else if (roundIdx === 3) {
      // E8: fed by S16 at positions 0 and 1
      team1 = getPick(laterRoundId(region, 3, 0));
      team2 = getPick(laterRoundId(region, 3, 1));
    }
  }

  return {
    id: matchupId,
    round: ROUNDS[roundIdx],
    team1: team1 ? { id: team1.id, name: team1.name, seed: team1.seed } : null,
    team2: team2 ? { id: team2.id, name: team2.name, seed: team2.seed } : null,
    recommendedPick: null,
    category: null,
    confidence: null,
    confidencePercentage: null,
    tacticalAdvantage: null,
  };
}

// Get all matchups for the entire bracket
export function getAllMatchups() {
  const r64 = matchupsData.matchups;
  const all = [...r64];

  // Generate later round matchups
  for (const region of REGIONS) {
    // R32: 4 matchups
    for (let i = 0; i < 4; i++) all.push(getGeneratedMatchup(laterRoundId(region, 2, i)));
    // S16: 2 matchups
    for (let i = 0; i < 2; i++) all.push(getGeneratedMatchup(laterRoundId(region, 3, i)));
    // E8: 1 matchup
    all.push(getGeneratedMatchup(laterRoundId(region, 4, 0)));
  }

  // Final Four
  all.push(getGeneratedMatchup('ff-0'));
  all.push(getGeneratedMatchup('ff-1'));
  // Championship
  all.push(getGeneratedMatchup('championship'));

  return all;
}

// Get R64 matchup data by ID
export function getR64Matchup(id) {
  return matchupsData.matchups.find(m => m.id === id) || null;
}

export { ROUNDS, REGIONS };
