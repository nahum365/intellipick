import { getAllPicks } from '../engine/picks.js';
import { computeScore, computeChalkScore, computeRecommendedScore, getUpsetAlerts } from '../engine/scoring.js';

export function createScorePanel() {
  const panel = document.createElement('div');
  panel.className = 'score-sidebar';
  updateScorePanel(panel);
  return panel;
}

export function updateScorePanel(panel) {
  const picks = getAllPicks();
  const score = computeScore(picks);
  const chalk = computeChalkScore();
  const recommended = computeRecommendedScore();
  const upsets = getUpsetAlerts();
  const totalGames = 32; // R64 only for now

  const pickedCount = Object.keys(picks).length;
  const pct = pickedCount > 0 ? score.overall.toFixed(1) : '--';
  const delta = pickedCount > 0 ? (score.overall - chalk.overall).toFixed(1) : '--';

  panel.innerHTML = `
    <div style="margin-bottom:20px">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-muted);margin-bottom:6px">Bracket Score</div>
      <div style="font-size:32px;font-weight:800;color:var(--primary)">${pct}${pickedCount > 0 ? '%' : ''}</div>
      <div style="margin-top:6px">
        <div style="height:6px;background:var(--border-light);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${pickedCount > 0 ? score.overall : 0}%;background:var(--primary);border-radius:3px;transition:width 0.3s"></div>
        </div>
      </div>
    </div>

    <div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-muted);margin-bottom:6px">Progress</div>
      <div style="font-size:13px;color:var(--text)"><strong>${pickedCount}</strong> / ${totalGames} games picked</div>
      <div style="height:4px;background:var(--border-light);border-radius:2px;overflow:hidden;margin-top:4px">
        <div style="height:100%;width:${(pickedCount / totalGames) * 100}%;background:var(--confidence-very-high);border-radius:2px;transition:width 0.3s"></div>
      </div>
    </div>

    <div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-muted);margin-bottom:6px">Comparison</div>
      <div style="font-size:12px;display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-light)">
        <span style="color:var(--text-secondary)">All Chalk</span>
        <span style="font-weight:600">${chalk.overall.toFixed(1)}%</span>
      </div>
      <div style="font-size:12px;display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border-light)">
        <span style="color:var(--text-secondary)">Recommended</span>
        <span style="font-weight:600">${recommended.overall.toFixed(1)}%</span>
      </div>
      <div style="font-size:12px;display:flex;justify-content:space-between;padding:4px 0">
        <span style="color:var(--text-secondary)">Your Bracket</span>
        <span style="font-weight:700;color:var(--primary)">${pct}${pickedCount > 0 ? '%' : ''}</span>
      </div>
      ${pickedCount > 0 ? `<div style="font-size:11px;margin-top:6px;color:${parseFloat(delta) >= 0 ? 'var(--confidence-very-high)' : 'var(--upset)'}">
        ${parseFloat(delta) >= 0 ? '\u25B2' : '\u25BC'} ${Math.abs(parseFloat(delta)).toFixed(1)}% vs chalk
      </div>` : ''}
    </div>

    <div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-muted);margin-bottom:6px">Upset Picks</div>
      <div style="font-size:24px;font-weight:800;color:var(--upset)">${score.upsetCount}</div>
      <div style="font-size:11px;color:var(--text-secondary)">${upsets.length} upsets recommended</div>
    </div>

    <div>
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-muted);margin-bottom:6px">Recommended Upsets</div>
      ${upsets.map(u => `
        <div style="font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-light);display:flex;justify-content:space-between;align-items:center">
          <span><strong>${u.team.seed}</strong> ${u.team.name} over <strong>${u.opponent.seed}</strong> ${u.opponent.name}</span>
          <span style="font-size:9px;font-weight:700;color:var(--upset)">${u.confidencePercentage}%</span>
        </div>
      `).join('')}
    </div>
  `;
}
