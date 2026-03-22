import matchupsData from '../data/matchups.json';
import { getWinner, getScoreForMatchup } from './liveScores.js';

// Bracket structure: matchups pair up in order within each region
// R64 matchups 0,1 -> R32 slot 0; matchups 2,3 -> R32 slot 1; etc.
// Then R32 slots 0,1 -> S16 slot 0; etc.

const ROUNDS = ['First Round', 'Second Round', 'Sweet 16', 'Elite Eight', 'Final Four', 'National Championship'];
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
    // East vs South = ff-0, West vs Midwest = ff-1
    if (region === 'East' || region === 'South') return 'ff-0';
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

// Get the winner of a later-round generated matchup from live scores.
// For R64 matchups, delegates to liveScores.getWinner().
// For later rounds, we need both teams resolved AND a final score.
function getGeneratedWinner(matchupId) {
  const roundIdx = getRoundIndex(matchupId);
  if (roundIdx === 0) return getWinner(matchupId);
  // For later rounds, only return a winner if we have final score data
  const score = getScoreForMatchup(matchupId);
  if (!score || score.status !== 'final') return null;
  const gen = getGeneratedMatchup(matchupId);
  if (!gen || !gen.team1 || !gen.team2) return null;
  return score.team1Score > score.team2Score ? gen.team1 : gen.team2;
}

// Get the "expected" winner — actual winner if final, else the recommendedPick.
// This propagates IntelliPick's predicted bracket path through all rounds.
function getExpectedWinnerR64(matchupId) {
  // Actual winner takes priority
  const actual = getWinner(matchupId);
  if (actual) return actual;
  // Fall back to recommended pick from prediction data
  const matchup = matchupsData.matchups.find(m => m.id === matchupId);
  if (!matchup || !matchup.recommendedPick) return null;
  const pick = matchup.recommendedPick;
  if (matchup.team1 && matchup.team1.id === pick) return matchup.team1;
  if (matchup.team2 && matchup.team2.id === pick) return matchup.team2;
  return null;
}

function getExpectedGeneratedWinner(matchupId) {
  const roundIdx = getRoundIndex(matchupId);
  if (roundIdx === 0) return getExpectedWinnerR64(matchupId);
  // Actual winner if final
  const score = getScoreForMatchup(matchupId);
  if (score && score.status === 'final') {
    const gen = getExpectedMatchup(matchupId);
    if (gen && gen.team1 && gen.team2) {
      return score.team1Score > score.team2Score ? gen.team1 : gen.team2;
    }
  }
  // Fall back to recommended pick from expected matchup
  const gen = getExpectedMatchup(matchupId);
  if (!gen || !gen.recommendedPick) return null;
  if (gen.team1 && gen.team1.id === gen.recommendedPick) return gen.team1;
  if (gen.team2 && gen.team2.id === gen.recommendedPick) return gen.team2;
  return null;
}

// Build an "expected" matchup using predicted winners (not just actual results).
// Uses the same logic as getGeneratedMatchup but with expected winners.
export function getExpectedMatchup(matchupId) {
  const roundIdx = getRoundIndex(matchupId);
  let team1 = null;
  let team2 = null;

  if (matchupId === 'championship') {
    team1 = getExpectedGeneratedWinner('ff-0');
    team2 = getExpectedGeneratedWinner('ff-1');
  } else if (matchupId.startsWith('ff-')) {
    const ffIdx = parseInt(matchupId.split('-')[1]);
    if (ffIdx === 0) {
      team1 = getExpectedGeneratedWinner(laterRoundId('east', 4, 0));
      team2 = getExpectedGeneratedWinner(laterRoundId('south', 4, 0));
    } else {
      team1 = getExpectedGeneratedWinner(laterRoundId('west', 4, 0));
      team2 = getExpectedGeneratedWinner(laterRoundId('midwest', 4, 0));
    }
  } else {
    const region = getMatchupRegion(matchupId);
    const pos = parseInt(matchupId.split('-').pop());

    if (roundIdx === 1) {
      const r64s = getRegionR64Matchups(region);
      team1 = getExpectedWinnerR64(r64s[pos * 2]);
      team2 = getExpectedWinnerR64(r64s[pos * 2 + 1]);
    } else if (roundIdx === 2) {
      team1 = getExpectedGeneratedWinner(laterRoundId(region, 2, pos * 2));
      team2 = getExpectedGeneratedWinner(laterRoundId(region, 2, pos * 2 + 1));
    } else if (roundIdx === 3) {
      team1 = getExpectedGeneratedWinner(laterRoundId(region, 3, 0));
      team2 = getExpectedGeneratedWinner(laterRoundId(region, 3, 1));
    }
  }

  // Check if there's prediction data for this specific matchup in the JSON
  const region = getMatchupRegion(matchupId);
  const data = findMatchupData(matchupId, region, team1, team2);

  return {
    id: matchupId,
    round: ROUNDS[roundIdx],
    team1: team1 ? { id: team1.id, name: team1.name, seed: team1.seed } : null,
    team2: team2 ? { id: team2.id, name: team2.name, seed: team2.seed } : null,
    recommendedPick: data ? data.recommendedPick : null,
    category: data ? data.category : null,
    confidence: data ? data.confidence : null,
    confidencePercentage: data ? data.confidencePercentage : null,
    tacticalAdvantage: data ? data.tacticalAdvantage : null,
    expected: true, // flag so UI can style these differently if desired
  };
}

// Get the purely predicted winner for an R64 matchup (ignores actual results).
function getPredictedWinnerR64(matchupId) {
  const matchup = matchupsData.matchups.find(m => m.id === matchupId);
  if (!matchup || !matchup.recommendedPick) return null;
  const pick = matchup.recommendedPick;
  if (matchup.team1 && matchup.team1.id === pick) return matchup.team1;
  if (matchup.team2 && matchup.team2.id === pick) return matchup.team2;
  return null;
}

// Get the purely predicted winner for a generated matchup (ignores actual results).
function getPredictedGeneratedWinner(matchupId) {
  const roundIdx = getRoundIndex(matchupId);
  if (roundIdx === 0) return getPredictedWinnerR64(matchupId);
  const gen = getPredictedMatchup(matchupId);
  if (!gen || !gen.recommendedPick) return null;
  if (gen.team1 && gen.team1.id === gen.recommendedPick) return gen.team1;
  if (gen.team2 && gen.team2.id === gen.recommendedPick) return gen.team2;
  return null;
}

// Build a matchup using only IntelliPick predictions (no actual results).
// Used to compute ghost picks — what IntelliPick predicted vs what actually happened.
function getPredictedMatchup(matchupId) {
  const roundIdx = getRoundIndex(matchupId);
  let team1 = null;
  let team2 = null;

  if (matchupId === 'championship') {
    team1 = getPredictedGeneratedWinner('ff-0');
    team2 = getPredictedGeneratedWinner('ff-1');
  } else if (matchupId.startsWith('ff-')) {
    const ffIdx = parseInt(matchupId.split('-')[1]);
    if (ffIdx === 0) {
      team1 = getPredictedGeneratedWinner(laterRoundId('east', 4, 0));
      team2 = getPredictedGeneratedWinner(laterRoundId('south', 4, 0));
    } else {
      team1 = getPredictedGeneratedWinner(laterRoundId('west', 4, 0));
      team2 = getPredictedGeneratedWinner(laterRoundId('midwest', 4, 0));
    }
  } else {
    const region = getMatchupRegion(matchupId);
    const pos = parseInt(matchupId.split('-').pop());

    if (roundIdx === 1) {
      const r64s = getRegionR64Matchups(region);
      team1 = getPredictedWinnerR64(r64s[pos * 2]);
      team2 = getPredictedWinnerR64(r64s[pos * 2 + 1]);
    } else if (roundIdx === 2) {
      team1 = getPredictedGeneratedWinner(laterRoundId(region, 2, pos * 2));
      team2 = getPredictedGeneratedWinner(laterRoundId(region, 2, pos * 2 + 1));
    } else if (roundIdx === 3) {
      team1 = getPredictedGeneratedWinner(laterRoundId(region, 3, 0));
      team2 = getPredictedGeneratedWinner(laterRoundId(region, 3, 1));
    }
  }

  const region = getMatchupRegion(matchupId);
  const data = findMatchupData(matchupId, region, team1, team2);

  return {
    id: matchupId,
    team1: team1 ? { id: team1.id, name: team1.name, seed: team1.seed } : null,
    team2: team2 ? { id: team2.id, name: team2.name, seed: team2.seed } : null,
    recommendedPick: data ? data.recommendedPick : null,
  };
}

// Look up a matchup in the JSON data.
// For region matchups: canonical seed ID e.g., "south-3-11"
// For FF/Championship: direct ID lookup
function findMatchupData(matchupId, region, team1, team2) {
  if (matchupId === 'championship' || matchupId.startsWith('ff-')) {
    return matchupsData.matchups.find(m => m.id === matchupId) || null;
  }
  if (!team1 || !team2) return null;
  const lo = Math.min(team1.seed, team2.seed);
  const hi = Math.max(team1.seed, team2.seed);
  const canonicalId = `${region.toLowerCase()}-${lo}-${hi}`;
  return matchupsData.matchups.find(m => m.id === canonicalId) || null;
}

// Build a generated matchup for later rounds based on game results.
// Falls back to expected (predicted) teams when actual winners aren't available.
export function getGeneratedMatchup(matchupId) {
  const roundIdx = getRoundIndex(matchupId);
  let team1 = null;
  let team2 = null;
  let team1Expected = false;
  let team2Expected = false;

  if (matchupId === 'championship') {
    team1 = getGeneratedWinner('ff-0');
    team2 = getGeneratedWinner('ff-1');
  } else if (matchupId.startsWith('ff-')) {
    const ffIdx = parseInt(matchupId.split('-')[1]);
    if (ffIdx === 0) {
      team1 = getGeneratedWinner(laterRoundId('east', 4, 0));
      team2 = getGeneratedWinner(laterRoundId('south', 4, 0));
    } else {
      team1 = getGeneratedWinner(laterRoundId('west', 4, 0));
      team2 = getGeneratedWinner(laterRoundId('midwest', 4, 0));
    }
  } else {
    // Find the two feeder matchups
    const region = getMatchupRegion(matchupId);
    const pos = parseInt(matchupId.split('-').pop());

    if (roundIdx === 1) {
      // R32: fed by R64 game winners
      const r64s = getRegionR64Matchups(region);
      team1 = getWinner(r64s[pos * 2]);
      team2 = getWinner(r64s[pos * 2 + 1]);
    } else if (roundIdx === 2) {
      // S16: fed by R32 winners
      team1 = getGeneratedWinner(laterRoundId(region, 2, pos * 2));
      team2 = getGeneratedWinner(laterRoundId(region, 2, pos * 2 + 1));
    } else if (roundIdx === 3) {
      // E8: fed by S16 winners
      team1 = getGeneratedWinner(laterRoundId(region, 3, 0));
      team2 = getGeneratedWinner(laterRoundId(region, 3, 1));
    }
  }

  // Fall back to expected (predicted) teams when actual winners unavailable
  const expected = getExpectedMatchup(matchupId);
  if (!team1 && expected.team1) {
    team1 = expected.team1;
    team1Expected = true;
  }
  if (!team2 && expected.team2) {
    team2 = expected.team2;
    team2Expected = true;
  }

  // Ghost picks: actual winner known but differs from IntelliPick's prediction.
  // Use getPredictedMatchup (pure prediction, ignoring results) to compare.
  let team1GhostPick = null;
  let team2GhostPick = null;
  if (!team1Expected || !team2Expected) {
    const predicted = getPredictedMatchup(matchupId);
    if (!team1Expected && team1 && predicted.team1 && team1.id !== predicted.team1.id) {
      team1GhostPick = { id: predicted.team1.id, name: predicted.team1.name, seed: predicted.team1.seed };
    }
    if (!team2Expected && team2 && predicted.team2 && team2.id !== predicted.team2.id) {
      team2GhostPick = { id: predicted.team2.id, name: predicted.team2.name, seed: predicted.team2.seed };
    }
  }

  // Check if there's prediction data for this specific matchup in the JSON
  const region = getMatchupRegion(matchupId);
  const data = findMatchupData(matchupId, region, team1, team2);

  return {
    id: matchupId,
    round: ROUNDS[roundIdx],
    team1: team1 ? { id: team1.id, name: team1.name, seed: team1.seed } : null,
    team2: team2 ? { id: team2.id, name: team2.name, seed: team2.seed } : null,
    team1Expected: team1Expected,
    team2Expected: team2Expected,
    team1GhostPick,
    team2GhostPick,
    recommendedPick: data ? data.recommendedPick : null,
    category: data ? data.category : null,
    confidence: data ? data.confidence : null,
    confidencePercentage: data ? data.confidencePercentage : null,
    tacticalAdvantage: data ? data.tacticalAdvantage : null,
  };
}

// Get all matchups for the entire bracket
export function getAllMatchups() {
  const r64 = matchupsData.matchups.filter(m => m.round === 'First Round');
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

// Get all valid bracket slot IDs (63 total)
export function getValidBracketIds() {
  const ids = [...REGION_MATCHUP_ORDER]; // 32 R64
  for (const region of REGIONS) {
    for (let i = 0; i < 4; i++) ids.push(laterRoundId(region, 2, i));  // 16 R32
    for (let i = 0; i < 2; i++) ids.push(laterRoundId(region, 3, i));  // 8 S16
    ids.push(laterRoundId(region, 4, 0));                               // 4 E8
  }
  ids.push('ff-0', 'ff-1', 'championship');                             // 3 FF+Champ
  return ids;
}

export { ROUNDS, REGIONS };
