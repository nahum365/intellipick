import matchupsData from '../data/matchups.json';
import { getAllPicks } from './picks.js';
import { getR64Matchup } from './propagation.js';

// Compute bracket score as geometric mean of confidence percentages for picked games
export function computeScore(picks) {
  const pickedMatchups = [];

  for (const [matchupId, team] of Object.entries(picks)) {
    const r64 = getR64Matchup(matchupId);
    if (r64) {
      // For R64 matchups, use the confidence percentage
      const isRecommended = r64.recommendedPick === team.id;
      const conf = isRecommended ? r64.confidencePercentage : (100 - r64.confidencePercentage);
      pickedMatchups.push({ matchupId, confidence: conf, round: 'First Round' });
    } else {
      // Later rounds: use a default confidence of 50% (no prediction data)
      pickedMatchups.push({ matchupId, confidence: 50, round: 'Later' });
    }
  }

  if (pickedMatchups.length === 0) return { overall: 0, count: 0, breakdown: {}, upsetCount: 0 };

  // Geometric mean
  const logSum = pickedMatchups.reduce((sum, m) => sum + Math.log(m.confidence / 100), 0);
  const overall = Math.exp(logSum / pickedMatchups.length) * 100;

  // Round breakdown
  const breakdown = {};
  for (const m of pickedMatchups) {
    if (!breakdown[m.round]) breakdown[m.round] = [];
    breakdown[m.round].push(m.confidence);
  }
  for (const [round, confs] of Object.entries(breakdown)) {
    const roundLogSum = confs.reduce((s, c) => s + Math.log(c / 100), 0);
    breakdown[round] = {
      score: Math.exp(roundLogSum / confs.length) * 100,
      count: confs.length,
    };
  }

  // Count upsets (picked team is the lower seed)
  let upsetCount = 0;
  for (const [matchupId, team] of Object.entries(picks)) {
    const r64 = getR64Matchup(matchupId);
    if (r64) {
      const opponent = r64.team1.id === team.id ? r64.team2 : r64.team1;
      if (team.seed > opponent.seed) upsetCount++;
    }
  }

  return { overall, count: pickedMatchups.length, breakdown, upsetCount };
}

// Compute "all chalk" score (picking higher seed always)
export function computeChalkScore() {
  const chalkPicks = {};
  for (const m of matchupsData.matchups) {
    const higherSeed = m.team1.seed <= m.team2.seed ? m.team1 : m.team2;
    chalkPicks[m.id] = higherSeed;
  }
  return computeScore(chalkPicks);
}

// Compute "all recommended" score
export function computeRecommendedScore() {
  const recPicks = {};
  for (const m of matchupsData.matchups) {
    const team = m.recommendedPick === m.team1.id ? m.team1 : m.team2;
    recPicks[m.id] = team;
  }
  return computeScore(recPicks);
}

// Smart fill: return picks following all recommendations
export function getSmartFillPicks() {
  const picks = {};
  for (const m of matchupsData.matchups) {
    const team = m.recommendedPick === m.team1.id ? m.team1 : m.team2;
    picks[m.id] = team;
  }
  return picks;
}

// Get upset info for insights bar
export function getUpsetAlerts() {
  return matchupsData.matchups
    .filter(m => {
      const rec = m.recommendedPick === m.team1.id ? m.team1 : m.team2;
      const other = m.recommendedPick === m.team1.id ? m.team2 : m.team1;
      return rec.seed > other.seed;
    })
    .map(m => ({
      matchupId: m.id,
      region: m.region,
      team: m.recommendedPick === m.team1.id ? m.team1 : m.team2,
      opponent: m.recommendedPick === m.team1.id ? m.team2 : m.team1,
      confidence: m.confidence,
      confidencePercentage: m.confidencePercentage,
      category: m.category,
    }));
}
