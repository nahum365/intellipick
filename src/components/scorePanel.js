import { getUpsetAlerts } from '../engine/scoring.js';
import { getR64Matchup, getRegionR64Matchups } from '../engine/propagation.js';
import { getFetchStatus, getScoreForMatchup } from '../engine/liveScores.js';
import { openModal } from './modal.js';
import { showTooltip, hideTooltip } from './tooltip.js';
import teamsData from '../data/teams.json';
import matchupsData from '../data/matchups.json';

function getTeamProfile(teamId) {
  return teamsData.teams.find(t => t.id === teamId) || null;
}

// Resolve a canonical R32 ID (e.g., east-1-9) to its generated matchup ID (east-r2-0)
function resolveR32GeneratedId(canonicalId, region) {
  const r64s = getRegionR64Matchups(region);
  const entry = getR64Matchup(canonicalId);
  if (!entry) return null;
  const seed1 = entry.team1.seed;
  for (let i = 0; i < r64s.length; i++) {
    const r64 = getR64Matchup(r64s[i]);
    if (r64 && (r64.team1.seed === seed1 || r64.team2.seed === seed1)) {
      return `${region.toLowerCase()}-r2-${Math.floor(i / 2)}`;
    }
  }
  return null;
}

function timeAgo(ts) {
  if (!ts) return null;
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 10) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function buildFetchStatusHtml() {
  const s = getFetchStatus();
  if (s.espnLoading) {
    const spinner = '<span class="fetch-status__spinner"></span>';
    return `<div class="fetch-status">${spinner}<span class="fetch-status__text">Loading ESPN info&hellip;</span></div>`;
  }

  const parts = [];
  if (s.espnLastLoaded) parts.push(`ESPN ${timeAgo(s.espnLastLoaded)}`);
  if (parts.length === 0) return '';

  return `<div class="fetch-status fetch-status--done"><span class="fetch-status__text">${parts.join(', ')}</span></div>`;
}

// Compute IntelliPick performance across all matchups with predictions
function computeIntelliPickPerformance() {
  const results = { correct: 0, incorrect: 0, pending: 0, live: 0, total: 0, weightedScore: 0, weightedTotal: 0 };

  for (const m of matchupsData.matchups) {
    if (!m.recommendedPick || !m.team1 || !m.team2) continue;
    results.total++;

    const liveScore = getScoreForMatchup(m.id);
    if (!liveScore) { results.pending++; continue; }

    if (liveScore.status === 'live' || liveScore.status === 'halftime') {
      results.live++;
      continue;
    }

    if (liveScore.status !== 'final') { results.pending++; continue; }

    const recIsTeam1 = m.recommendedPick === m.team1.id;
    const recWon = recIsTeam1
      ? liveScore.team1Score > liveScore.team2Score
      : liveScore.team2Score > liveScore.team1Score;

    if (recWon) {
      results.correct++;
      results.weightedScore += m.confidencePercentage || 50;
    } else {
      results.incorrect++;
    }
    results.weightedTotal += m.confidencePercentage || 50;
  }

  return results;
}

export function createScorePanel() {
  const panel = document.createElement('div');
  panel.className = 'score-sidebar';
  updateScorePanel(panel);
  return panel;
}

export function updateScorePanel(panel) {
  const upsets = getUpsetAlerts();
  const perf = computeIntelliPickPerformance();
  const decided = perf.correct + perf.incorrect;
  const winPct = decided > 0 ? Math.round((perf.correct / decided) * 100) : null;

  panel.innerHTML = '';

  const body = document.createElement('div');
  body.className = 'score-sidebar__body';

  // Fetch status
  const statusContainer = document.createElement('div');
  statusContainer.className = 'fetch-status-container';
  statusContainer.innerHTML = buildFetchStatusHtml();
  body.appendChild(statusContainer);

  // IntelliPick Performance section
  const perfSection = document.createElement('div');
  const recordText = decided > 0 ? `${perf.correct}-${perf.incorrect}` : '--';
  const pctDisplay = winPct !== null ? `${winPct}%` : '--';
  const pctColor = winPct !== null
    ? (winPct >= 70 ? 'var(--confidence-very-high)' : winPct >= 50 ? 'var(--primary)' : 'var(--upset)')
    : 'var(--text-muted)';
  const barWidth = winPct !== null ? winPct : 0;

  let statusLine = '';
  if (perf.live > 0) statusLine += `<span style="color:var(--upset)">${perf.live} live</span>`;
  if (perf.pending > 0) statusLine += `${statusLine ? ' &middot; ' : ''}${perf.pending} upcoming`;

  perfSection.innerHTML = `
    <div style="margin-bottom:20px">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-muted);margin-bottom:6px">IntelliPick Performance</div>
      <div style="display:flex;align-items:baseline;gap:10px">
        <div style="font-size:32px;font-weight:800;color:${pctColor}">${recordText}</div>
        ${winPct !== null ? `<div style="font-size:18px;font-weight:700;color:${pctColor}">${pctDisplay}</div>` : ''}
      </div>
      <div style="margin-top:6px">
        <div style="height:6px;background:var(--border-light);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${barWidth}%;background:${pctColor};border-radius:3px;transition:width 0.3s"></div>
        </div>
      </div>
      ${decided > 0 ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:4px">${perf.correct} correct, ${perf.incorrect} wrong out of ${perf.total} picks</div>` : `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">No games finalized yet</div>`}
      ${statusLine ? `<div style="font-size:11px;margin-top:2px">${statusLine}</div>` : ''}
    </div>
  `;
  body.appendChild(perfSection);

  // Intelliupsets section
  const r64Upsets = upsets.filter(u => u.round === 'First Round');
  const r32Upsets = upsets.filter(u => u.round === 'Second Round');

  function buildUpsetRow(u, pickId, matchup) {
    const row = document.createElement('div');
    row.className = 'upset-row';
    row.style.cssText = 'font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-light);display:flex;align-items:center;gap:6px';

    const label = document.createElement('span');
    label.style.cssText = 'flex:1;min-width:0';

    const teamSpan = document.createElement('span');
    teamSpan.style.cssText = 'cursor:default';
    teamSpan.innerHTML = `<strong>${u.team.seed}</strong> ${u.team.name}`;
    const teamProfile = getTeamProfile(u.team.id);
    if (teamProfile) {
      teamSpan.style.cursor = 'pointer';
      teamSpan.addEventListener('mouseenter', () => showTooltip(u.team, teamProfile, matchup, teamSpan));
      teamSpan.addEventListener('mouseleave', () => hideTooltip());
    }

    const overSpan = document.createElement('span');
    overSpan.textContent = ' over ';

    const oppSpan = document.createElement('span');
    oppSpan.style.cssText = 'cursor:default';
    oppSpan.innerHTML = `<strong>${u.opponent.seed}</strong> ${u.opponent.name}`;
    const oppProfile = getTeamProfile(u.opponent.id);
    if (oppProfile) {
      oppSpan.style.cursor = 'pointer';
      oppSpan.addEventListener('mouseenter', () => showTooltip(u.opponent, oppProfile, matchup, oppSpan));
      oppSpan.addEventListener('mouseleave', () => hideTooltip());
    }

    label.appendChild(teamSpan);
    label.appendChild(overSpan);
    label.appendChild(oppSpan);
    row.appendChild(label);

    // Confidence percentage
    const confSpan = document.createElement('span');
    confSpan.style.cssText = 'font-size:9px;font-weight:700;color:var(--upset);flex-shrink:0';
    confSpan.textContent = `${u.confidencePercentage}%`;
    row.appendChild(confSpan);

    // Outcome indicator for final games
    const liveScore = getScoreForMatchup(pickId);
    if (liveScore && liveScore.status === 'final' && matchup) {
      const upsetTeamIsTeam1 = u.team.id === matchup.team1?.id;
      const upsetTeamScore = upsetTeamIsTeam1 ? liveScore.team1Score : liveScore.team2Score;
      const otherScore = upsetTeamIsTeam1 ? liveScore.team2Score : liveScore.team1Score;
      const upsetHit = upsetTeamScore > otherScore;

      const outcomeIcon = document.createElement('span');
      outcomeIcon.style.cssText = `font-size:12px;font-weight:800;flex-shrink:0;line-height:1;${upsetHit ? 'color:var(--confidence-very-high)' : 'color:var(--upset)'}`;
      outcomeIcon.textContent = upsetHit ? '\u2713' : '\u2717';
      outcomeIcon.title = upsetHit ? 'Upset hit!' : 'Upset missed';
      row.appendChild(outcomeIcon);
    }

    // Info button
    if (matchup) {
      const infoBtn = document.createElement('button');
      infoBtn.className = 'upset-row__info-btn';
      infoBtn.style.cssText = 'background:none;border:1px solid var(--border);border-radius:4px;cursor:pointer;font-size:10px;color:var(--text-muted);padding:1px 5px;flex-shrink:0;line-height:1.2';
      infoBtn.textContent = 'i';
      infoBtn.title = 'View matchup details';
      infoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openModal(matchup);
      });
      row.appendChild(infoBtn);
    }

    return row;
  }

  // Count upset results
  let upsetHits = 0, upsetMisses = 0;
  for (const u of upsets) {
    const pickId = u.round === 'Second Round'
      ? (resolveR32GeneratedId(u.matchupId, u.region) || u.matchupId)
      : u.matchupId;
    const matchup = getR64Matchup(u.matchupId);
    const liveScore = getScoreForMatchup(pickId);
    if (liveScore && liveScore.status === 'final' && matchup) {
      const upsetTeamIsTeam1 = u.team.id === matchup.team1?.id;
      const upsetTeamScore = upsetTeamIsTeam1 ? liveScore.team1Score : liveScore.team2Score;
      const otherScore = upsetTeamIsTeam1 ? liveScore.team2Score : liveScore.team1Score;
      if (upsetTeamScore > otherScore) upsetHits++;
      else upsetMisses++;
    }
  }
  const upsetDecided = upsetHits + upsetMisses;

  // Intelliupsets header
  const upsetHeader = document.createElement('div');
  upsetHeader.innerHTML = `
    <div style="margin-bottom:16px">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-muted);margin-bottom:6px">Intelliupsets</div>
      <div style="font-size:24px;font-weight:800;color:var(--upset)">${upsets.length}</div>
      <div style="font-size:11px;color:var(--text-secondary)">${upsetDecided > 0 ? `${upsetHits} hit, ${upsetMisses} missed` : `${upsets.length} upset calls`}</div>
    </div>
  `;
  body.appendChild(upsetHeader);

  // Round of 64 upsets
  if (r64Upsets.length > 0) {
    const r64Section = document.createElement('div');
    r64Section.style.cssText = 'margin-bottom:16px';
    const r64Title = document.createElement('div');
    r64Title.style.cssText = 'font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-muted);margin-bottom:6px';
    r64Title.textContent = 'Round of 64';
    r64Section.appendChild(r64Title);
    for (const u of r64Upsets) {
      const matchup = getR64Matchup(u.matchupId);
      r64Section.appendChild(buildUpsetRow(u, u.matchupId, matchup));
    }
    body.appendChild(r64Section);
  }

  // Round of 32 upsets
  if (r32Upsets.length > 0) {
    const r32Section = document.createElement('div');
    r32Section.style.cssText = 'margin-bottom:16px';
    const r32Title = document.createElement('div');
    r32Title.style.cssText = 'font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-muted);margin-bottom:6px';
    r32Title.textContent = 'Round of 32';
    r32Section.appendChild(r32Title);
    for (const u of r32Upsets) {
      const matchup = getR64Matchup(u.matchupId);
      const pickId = resolveR32GeneratedId(u.matchupId, u.region) || u.matchupId;
      r32Section.appendChild(buildUpsetRow(u, pickId, matchup));
    }
    body.appendChild(r32Section);
  }

  panel.appendChild(body);
}
