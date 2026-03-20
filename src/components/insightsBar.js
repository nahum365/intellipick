import { getUpsetAlerts } from '../engine/scoring.js';
import { getScoreForMatchup } from '../engine/liveScores.js';
import { getR64Matchup } from '../engine/propagation.js';
import matchupsData from '../data/matchups.json';

function computeBarStats() {
  const upsets = getUpsetAlerts();
  let correct = 0, incorrect = 0, live = 0, pending = 0;
  let upsetHits = 0, upsetMisses = 0;

  // All IntelliPick results
  for (const m of matchupsData.matchups) {
    if (!m.recommendedPick || !m.team1 || !m.team2) continue;
    const liveScore = getScoreForMatchup(m.id);
    if (!liveScore || liveScore.status === 'scheduled') { pending++; continue; }
    if (liveScore.status === 'live' || liveScore.status === 'halftime') { live++; continue; }
    if (liveScore.status !== 'final') { pending++; continue; }

    const recIsTeam1 = m.recommendedPick === m.team1.id;
    const recWon = recIsTeam1
      ? liveScore.team1Score > liveScore.team2Score
      : liveScore.team2Score > liveScore.team1Score;
    if (recWon) correct++;
    else incorrect++;
  }

  // Upset results
  for (const u of upsets) {
    const matchup = getR64Matchup(u.matchupId);
    const liveScore = getScoreForMatchup(u.matchupId);
    if (liveScore && liveScore.status === 'final' && matchup) {
      const upsetTeamIsTeam1 = u.team.id === matchup.team1?.id;
      const upsetTeamScore = upsetTeamIsTeam1 ? liveScore.team1Score : liveScore.team2Score;
      const otherScore = upsetTeamIsTeam1 ? liveScore.team2Score : liveScore.team1Score;
      if (upsetTeamScore > otherScore) upsetHits++;
      else upsetMisses++;
    }
  }

  const decided = correct + incorrect;
  const winPct = decided > 0 ? Math.round((correct / decided) * 100) : null;
  const upsetDecided = upsetHits + upsetMisses;

  return { correct, incorrect, live, pending, decided, winPct, upsets: upsets.length, upsetHits, upsetMisses, upsetDecided };
}

export function createInsightsBar() {
  const bar = document.createElement('div');
  bar.className = 'insights-bar';
  updateInsightsBar(bar);
  return bar;
}

export function updateInsightsBar(bar) {
  const s = computeBarStats();

  let items = '';

  // Overall record
  if (s.decided > 0) {
    const color = s.winPct >= 70 ? 'var(--confidence-very-high)' : s.winPct >= 50 ? 'var(--primary)' : 'var(--upset)';
    items += `
      <div class="insights-bar__item">
        <span class="insights-bar__badge" style="background:${color}20;color:${color}">${s.correct}-${s.incorrect}</span>
        <span>IntelliPick record (${s.winPct}%)</span>
      </div>`;
  }

  // Live games
  if (s.live > 0) {
    items += `
      <div class="insights-bar__item">
        <span class="insights-bar__badge insights-bar__badge--upset">${s.live} LIVE</span>
        <span>games in progress</span>
      </div>`;
  }

  // Intelliupsets
  if (s.upsetDecided > 0) {
    items += `
      <div class="insights-bar__item">
        <span class="insights-bar__badge insights-bar__badge--upset">${s.upsetHits}/${s.upsetDecided}</span>
        <span>Intelliupsets hit</span>
      </div>`;
  } else if (s.upsets > 0) {
    items += `
      <div class="insights-bar__item">
        <span class="insights-bar__badge insights-bar__badge--upset">${s.upsets}</span>
        <span>Intelliupsets called</span>
      </div>`;
  }

  // Upcoming
  if (s.pending > 0) {
    items += `
      <div class="insights-bar__item">
        <span>${s.pending} upcoming</span>
      </div>`;
  }

  bar.innerHTML = items;
}
