import { getAllPicks } from '../engine/picks.js';
import { computeScore, computeChalkScore, computeRecommendedScore, getUpsetAlerts } from '../engine/scoring.js';
import { cascadePick } from '../engine/propagation.js';
import { getR64Matchup } from '../engine/propagation.js';
import { openModal } from './modal.js';
import { showTooltip, hideTooltip } from './tooltip.js';
import teamsData from '../data/teams.json';

function getTeamProfile(teamId) {
  return teamsData.teams.find(t => t.id === teamId) || null;
}

// Track collapsed state across re-renders
let sidebarCollapsed = true;

export function createScorePanel(onPickChange) {
  const panel = document.createElement('div');
  panel.className = 'score-sidebar';
  updateScorePanel(panel, onPickChange);
  return panel;
}

export function updateScorePanel(panel, onPickChange) {
  const picks = getAllPicks();
  const score = computeScore(picks);
  const chalk = computeChalkScore();
  const recommended = computeRecommendedScore();
  const upsets = getUpsetAlerts();
  const totalGames = 63; // Full bracket: 32+16+8+4+2+1

  const pickedCount = Object.keys(picks).length;
  const pct = pickedCount > 0 ? score.overall.toFixed(1) : '--';
  const delta = pickedCount > 0 ? (score.overall - chalk.overall).toFixed(1) : '--';

  panel.innerHTML = '';

  // Mobile anchor bar: compact stats + grabber
  const anchor = document.createElement('div');
  anchor.className = 'score-sidebar__anchor' + (sidebarCollapsed ? '' : ' score-sidebar__anchor--open');

  const anchorStats = document.createElement('div');
  anchorStats.className = 'score-sidebar__anchor-stats';
  anchorStats.innerHTML = `
    <span class="score-sidebar__anchor-stat">
      <span class="score-sidebar__anchor-stat-value">${pickedCount}</span>
      <span class="score-sidebar__anchor-stat-label">/${totalGames}</span>
    </span>
    <span class="score-sidebar__anchor-stat">
      <span class="score-sidebar__anchor-stat-value" style="color:var(--primary)">${pct}${pickedCount > 0 ? '%' : ''}</span>
      <span class="score-sidebar__anchor-stat-label">score</span>
    </span>
    <span class="score-sidebar__anchor-stat">
      <span class="score-sidebar__anchor-stat-value" style="color:var(--upset)">${score.upsetCount}</span>
      <span class="score-sidebar__anchor-stat-label">upsets</span>
    </span>
  `;
  anchor.appendChild(anchorStats);

  const grabber = document.createElement('div');
  grabber.className = 'score-sidebar__grabber';
  grabber.innerHTML = '<span class="score-sidebar__grabber-bar"></span>';
  anchor.appendChild(grabber);

  panel.appendChild(anchor);

  // Body wrapper — JS shelf animation
  const body = document.createElement('div');
  body.className = 'score-sidebar__body';

  // Set initial collapsed state immediately (no animation on first render)
  if (sidebarCollapsed) {
    body.style.height = '0px';
    body.style.overflow = 'hidden';
  }

  // Toggle with slide animation
  anchor.addEventListener('click', () => {
    sidebarCollapsed = !sidebarCollapsed;
    anchor.classList.toggle('score-sidebar__anchor--open', !sidebarCollapsed);

    if (sidebarCollapsed) {
      // Collapse: animate from current height to 0
      const h = body.scrollHeight;
      body.style.height = h + 'px';
      body.offsetHeight; // force reflow
      body.style.transition = 'height 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
      body.style.height = '0px';
      body.style.overflow = 'hidden';
    } else {
      // Expand: animate from 0 to scrollHeight, capped at 60vh
      const maxH = window.innerHeight * 0.6;
      const targetH = Math.min(body.scrollHeight, maxH);
      body.style.transition = 'height 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
      body.style.height = targetH + 'px';
      body.style.overflow = 'hidden';
      const onEnd = () => {
        body.removeEventListener('transitionend', onEnd);
        if (!sidebarCollapsed) {
          body.style.height = targetH + 'px';
          body.style.overflowY = 'auto';
        }
      };
      body.addEventListener('transitionend', onEnd);
    }
  });

  // Score content
  const content = document.createElement('div');
  content.innerHTML = `
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
  `;
  body.appendChild(content);

  // Build recommended upsets list with interactive elements
  const upsetsSection = document.createElement('div');
  const upsetsTitle = document.createElement('div');
  upsetsTitle.style.cssText = 'font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-muted);margin-bottom:6px';
  upsetsTitle.textContent = 'Recommended Upsets';
  upsetsSection.appendChild(upsetsTitle);

  for (const u of upsets) {
    const isSelected = picks[u.matchupId] && picks[u.matchupId].id === u.team.id;
    const matchup = getR64Matchup(u.matchupId);

    const row = document.createElement('div');
    row.className = 'upset-row';
    row.style.cssText = 'font-size:11px;padding:4px 0;border-bottom:1px solid var(--border-light);display:flex;align-items:center;gap:6px';

    // Checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isSelected;
    checkbox.className = 'upset-row__checkbox';
    checkbox.style.cssText = 'cursor:pointer;accent-color:var(--upset);flex-shrink:0';
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        cascadePick(u.matchupId, u.team);
      } else {
        cascadePick(u.matchupId, u.opponent);
      }
      if (onPickChange) onPickChange();
    });
    row.appendChild(checkbox);

    // Team names with blurb tooltips
    const label = document.createElement('span');
    label.style.cssText = 'flex:1;min-width:0';

    const isMobile = () => window.innerWidth <= 768;

    const teamSpan = document.createElement('span');
    teamSpan.style.cssText = 'cursor:default';
    teamSpan.innerHTML = `<strong>${u.team.seed}</strong> ${u.team.name}`;
    const teamProfile = getTeamProfile(u.team.id);
    if (teamProfile) {
      teamSpan.style.cursor = 'pointer';
      teamSpan.addEventListener('mouseenter', () => {
        if (!isMobile()) showTooltip(u.team, teamProfile, matchup, teamSpan);
      });
      teamSpan.addEventListener('mouseleave', () => {
        if (!isMobile()) hideTooltip();
      });
      teamSpan.addEventListener('click', (e) => {
        if (isMobile() && matchup) {
          e.stopPropagation();
          openModal(matchup, { scrollToTeamId: u.team.id, onPickChange: onPickChange });
        }
      });
    }

    const overSpan = document.createElement('span');
    overSpan.textContent = ' over ';

    const oppSpan = document.createElement('span');
    oppSpan.style.cssText = 'cursor:default';
    oppSpan.innerHTML = `<strong>${u.opponent.seed}</strong> ${u.opponent.name}`;
    const oppProfile = getTeamProfile(u.opponent.id);
    if (oppProfile) {
      oppSpan.style.cursor = 'pointer';
      oppSpan.addEventListener('mouseenter', () => {
        if (!isMobile()) showTooltip(u.opponent, oppProfile, matchup, oppSpan);
      });
      oppSpan.addEventListener('mouseleave', () => {
        if (!isMobile()) hideTooltip();
      });
      oppSpan.addEventListener('click', (e) => {
        if (isMobile() && matchup) {
          e.stopPropagation();
          openModal(matchup, { scrollToTeamId: u.opponent.id, onPickChange: onPickChange });
        }
      });
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

    upsetsSection.appendChild(row);
  }

  body.appendChild(upsetsSection);
  panel.appendChild(body);
}
