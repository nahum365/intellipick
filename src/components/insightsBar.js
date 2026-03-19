import { getAllPicks } from '../engine/picks.js';
import { getUpsetAlerts } from '../engine/scoring.js';
import matchupsData from '../data/matchups.json';

export function createInsightsBar() {
  const bar = document.createElement('div');
  bar.className = 'insights-bar';
  updateInsightsBar(bar);
  return bar;
}

export function updateInsightsBar(bar) {
  const picks = getAllPicks();
  const upsets = getUpsetAlerts();
  const r64Ids = new Set(matchupsData.matchups.map(m => m.id));
  const pickedCount = Object.keys(picks).filter(id => r64Ids.has(id)).length;
  const total = matchupsData.matchups.length;

  // Count chalk picks
  let chalkCount = 0;
  for (const [id, team] of Object.entries(picks)) {
    const m = matchupsData.matchups.find(mm => mm.id === id);
    if (m) {
      const higherSeed = m.team1.seed <= m.team2.seed ? m.team1 : m.team2;
      if (team.id === higherSeed.id) chalkCount++;
    }
  }

  const chalkPct = pickedCount > 0 ? Math.round((chalkCount / pickedCount) * 100) : 0;

  // High-value picks remaining
  const highValueRemaining = upsets.filter(u => !picks[u.matchupId]).length;

  bar.innerHTML = `
    <div class="insights-bar__item">
      <span class="insights-bar__badge insights-bar__badge--upset">${upsets.length} UPSETS</span>
      <span>${upsets.length} upset picks recommended</span>
    </div>
    <div class="insights-bar__item">
      <span class="insights-bar__badge insights-bar__badge--info">${pickedCount}/${total}</span>
      <span>First round picks made</span>
    </div>
    ${pickedCount > 0 ? `<div class="insights-bar__item">
      <span>${chalkPct}% chalk</span>
    </div>` : ''}
    ${highValueRemaining > 0 ? `<div class="insights-bar__item">
      <span style="color:var(--confidence-medium)">${highValueRemaining} high-value picks remaining</span>
    </div>` : ''}
  `;
}
