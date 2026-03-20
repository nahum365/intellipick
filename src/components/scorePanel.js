import { getAllPicks } from '../engine/picks.js';
import { computeScore, getUpsetAlerts } from '../engine/scoring.js';
import { getR64Matchup, getRegionR64Matchups, getValidBracketIds } from '../engine/propagation.js';
import { getFetchStatus, getScoreForMatchup } from '../engine/liveScores.js';
import { openModal } from './modal.js';
import { showTooltip, hideTooltip } from './tooltip.js';
import teamsData from '../data/teams.json';

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
  const loading = s.espnLoading || s.polymarketLoading;

  if (loading) {
    const spinner = '<span class="fetch-status__spinner"></span>';
    const items = [];
    if (s.espnLoading) items.push('ESPN');
    if (s.polymarketLoading) items.push('Polymarket');
    return `<div class="fetch-status">${spinner}<span class="fetch-status__text">Loading ${items.join(' &amp; ')} info&hellip;</span></div>`;
  }

  const parts = [];
  if (s.espnLastLoaded) parts.push(`ESPN ${timeAgo(s.espnLastLoaded)}`);
  if (s.polymarketLastLoaded) parts.push(`Polymarket ${timeAgo(s.polymarketLastLoaded)}`);
  if (parts.length === 0) return '';

  return `<div class="fetch-status fetch-status--done"><span class="fetch-status__text">${parts.join(', ')}</span></div>`;
}

export function createScorePanel(onPickChange) {
  const panel = document.createElement('div');
  panel.className = 'score-sidebar';
  updateScorePanel(panel, onPickChange);
  return panel;
}

export function updateScorePanel(panel, onPickChange) {
  const picks = getAllPicks();
  const score = computeScore(picks);
  const upsets = getUpsetAlerts();
  const validIds = getValidBracketIds();
  const totalGames = validIds.length; // 63: 32+16+8+4+2+1

  const pickedCount = validIds.filter(id => picks[id]).length;
  const pct = pickedCount > 0 ? score.overall.toFixed(1) : '--';

  panel.innerHTML = '';

  const body = document.createElement('div');
  body.className = 'score-sidebar__body';

  // Score content
  const content = document.createElement('div');

  const statusContainer = document.createElement('div');
  statusContainer.className = 'fetch-status-container';
  statusContainer.innerHTML = buildFetchStatusHtml();
  content.appendChild(statusContainer);

  const innerHtml = document.createElement('div');
  innerHtml.innerHTML = `
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
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-muted);margin-bottom:6px">Upset Picks</div>
      <div style="font-size:24px;font-weight:800;color:var(--upset)">${score.upsetCount}</div>
      <div style="font-size:11px;color:var(--text-secondary)">${upsets.length} upsets recommended</div>
    </div>
  `;
  content.appendChild(innerHtml);

  body.appendChild(content);

  // Build recommended upsets list, grouped by round
  const r64Upsets = upsets.filter(u => u.round === 'First Round');
  const r32Upsets = upsets.filter(u => u.round === 'Second Round');

  function buildUpsetRow(u, pickId, matchup) {
    const row = document.createElement('div');
    row.className = 'upset-row';
    row.style.cssText = 'font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-light);display:flex;align-items:center;gap:6px';

    // Team names with blurb tooltips
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

    // Outcome indicator (check or x) for final games
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

  // Round of 64 upsets
  if (r64Upsets.length > 0) {
    const r64Section = document.createElement('div');
    r64Section.style.cssText = 'margin-bottom:16px';
    const r64Title = document.createElement('div');
    r64Title.style.cssText = 'font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-muted);margin-bottom:6px';
    r64Title.textContent = 'Round of 64 Upsets';
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
    r32Title.textContent = 'Round of 32 Upsets';
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
