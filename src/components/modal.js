import teamsData from '../data/teams.json';
import { getPick } from '../engine/picks.js';
import { cascadePick } from '../engine/propagation.js';

let overlayEl = null;
let currentOnPickChange = null;

function getTeamProfile(teamId) {
  return teamsData.teams.find(t => t.id === teamId) || null;
}

function confidenceClass(confidence) {
  if (!confidence) return 'medium';
  const c = confidence.toLowerCase().replace(/\s+/g, '-');
  if (c === 'very-high') return 'very-high';
  if (c === 'high') return 'high';
  return 'medium';
}

function buildTeamPanel(team, profile, matchup) {
  if (!team) return '<div class="modal__team-panel"><p style="color:var(--text-muted)">TBD</p></div>';

  const currentPick = getPick(matchup.id);
  const isPicked = currentPick && currentPick.id === team.id;

  let html = `<div class="modal__team-panel" data-team-id="${team.id}">`;

  // Header with pick checkbox
  html += `<div class="modal__team-panel-header">
    <span class="modal__team-panel-seed">${team.seed}</span>
    <span class="modal__team-panel-name">${profile ? profile.name : team.name}</span>
    <label class="modal__pick-toggle">
      <input type="checkbox" class="modal__pick-checkbox" data-matchup-id="${matchup.id}" data-team-id="${team.id}" ${isPicked ? 'checked' : ''}>
      <span class="modal__pick-label">${isPicked ? 'Picked' : 'Pick'}</span>
    </label>
  </div>`;

  // Meta
  const meta = [];
  if (profile) {
    if (profile.record) meta.push(profile.record);
    if (profile.conference) meta.push(profile.conference);
    if (profile.kenpomRank) meta.push(`KenPom #${profile.kenpomRank}`);
    if (profile.barttovikRank) meta.push(`BartTorvik #${profile.barttovikRank}`);
  }
  if (meta.length) html += `<div class="modal__team-meta">${meta.join(' \u00B7 ')}</div>`;

  if (profile) {
    // Championship odds
    if (profile.championshipOdds) {
      html += `<div class="modal__team-section">
        <div class="modal__team-section-title">Championship Odds</div>
        <div class="modal__team-section-text">${profile.championshipOdds} (${profile.championshipImpliedPct}%)</div>
      </div>`;
    }

    // Efficiency
    if (profile.offenseEfficiency) {
      html += `<div class="modal__team-section">
        <div class="modal__team-section-title">Offense</div>
        <div class="modal__team-section-text">${profile.offenseEfficiency}</div>
      </div>`;
    }
    if (profile.defenseEfficiency) {
      html += `<div class="modal__team-section">
        <div class="modal__team-section-title">Defense</div>
        <div class="modal__team-section-text">${profile.defenseEfficiency}</div>
      </div>`;
    }

    // Momentum
    if (profile.recentMomentum) {
      html += `<div class="modal__team-section">
        <div class="modal__team-section-title">Momentum</div>
        <div class="modal__team-section-text">${profile.recentMomentum}</div>
      </div>`;
    }

    // Key Players
    if (profile.keyPlayers && profile.keyPlayers.length > 0) {
      let playersHtml = profile.keyPlayers.map(p => {
        let ph = `<div class="modal__team-player"><span class="modal__team-player-name">${p.name}</span>`;
        if (p.stats) ph += ` \u2014 ${p.stats}`;
        if (p.note) ph += `<div class="modal__team-player-note">${p.note}</div>`;
        ph += '</div>';
        return ph;
      }).join('');
      html += `<div class="modal__team-section">
        <div class="modal__team-section-title">Key Players</div>
        ${playersHtml}
      </div>`;
    }

    // Injuries
    if (profile.injuries && profile.injuries.length > 0) {
      let injHtml = profile.injuries.map(inj => {
        const sc = inj.status === 'OUT' ? 'out' : 'doubtful';
        return `<div class="modal__team-injury">
          <span class="modal__team-injury-status modal__team-injury-status--${sc}">${inj.status}</span>
          <span>${inj.player} \u2014 ${inj.detail}</span>
        </div>`;
      }).join('');
      html += `<div class="modal__team-section">
        <div class="modal__team-section-title">Injuries</div>
        ${injHtml}
      </div>`;
    }

    // Strengths/Weaknesses
    if (profile.strengths) {
      html += `<div class="modal__team-section">
        <div class="modal__team-section-title">Strengths</div>
        <div class="modal__team-section-text" style="color:var(--confidence-very-high)">${profile.strengths}</div>
      </div>`;
    }
    if (profile.weaknesses) {
      html += `<div class="modal__team-section">
        <div class="modal__team-section-title">Weaknesses</div>
        <div class="modal__team-section-text" style="color:var(--upset)">${profile.weaknesses}</div>
      </div>`;
    }

    // Blurb
    if (profile.blurb) {
      html += `<div class="modal__team-section">
        <div class="modal__team-section-title">Scouting Report</div>
        <div class="modal__team-section-text">${profile.blurb}</div>
      </div>`;
    }

    // Badges
    const badges = [];
    if (profile.deepRunWatch) badges.push('<span class="modal__badge modal__badge--deep-run">DEEP RUN WATCH</span>');
    if (profile.fadeAlert) badges.push('<span class="modal__badge modal__badge--fade">FADE ALERT</span>');
    if (badges.length) {
      html += `<div class="modal__team-section"><div class="modal__badge-row">${badges.join('')}</div></div>`;
    }
  } else {
    html += '<div class="modal__team-section"><div class="modal__team-section-text" style="color:var(--text-muted)">No detailed profile available.</div></div>';
  }

  html += '</div>';
  return html;
}

function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement('div');
  overlayEl.className = 'modal-overlay';
  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeModal();
  });
  document.body.appendChild(overlayEl);
  return overlayEl;
}

export function openModal(matchup, options = {}) {
  const { scrollToTeamId, onPickChange } = options;
  currentOnPickChange = onPickChange || null;
  const overlay = ensureOverlay();

  const recTeam = matchup.recommendedPick === matchup.team1?.id ? matchup.team1 : matchup.team2;
  const confClass = confidenceClass(matchup.confidence);

  const profile1 = matchup.team1 ? getTeamProfile(matchup.team1.id) : null;
  const profile2 = matchup.team2 ? getTeamProfile(matchup.team2.id) : null;

  let title = '';
  if (matchup.team1 && matchup.team2) {
    title = `(${matchup.team1.seed}) ${matchup.team1.name} vs (${matchup.team2.seed}) ${matchup.team2.name}`;
  }

  overlay.innerHTML = `<div class="modal">
    <div class="modal__header">
      <span class="modal__title">${title}</span>
      <button class="modal__close" title="Close">\u00D7</button>
    </div>
    ${matchup.recommendedPick ? `<div class="modal__recommendation">
      <span class="modal__rec-pick">\u2605 Pick: ${recTeam ? recTeam.name : ''}</span>
      ${matchup.confidence ? `<span class="modal__rec-badge modal__rec-badge--${confClass}">${matchup.confidence} (${matchup.confidencePercentage}%)</span>` : ''}
      ${matchup.category ? `<span class="modal__rec-category">${matchup.category}</span>` : ''}
    </div>` : ''}
    ${matchup.tacticalAdvantage ? `<div class="modal__tactical">
      <div class="modal__tactical-title">Matchup Analysis</div>
      <div class="modal__tactical-text">${matchup.tacticalAdvantage}</div>
    </div>` : ''}
    <div class="modal__teams">
      ${buildTeamPanel(matchup.team1, profile1, matchup)}
      ${buildTeamPanel(matchup.team2, profile2, matchup)}
    </div>
  </div>`;

  // Close button
  overlay.querySelector('.modal__close').addEventListener('click', closeModal);

  // Wire up pick checkboxes
  const teams = { [matchup.team1?.id]: matchup.team1, [matchup.team2?.id]: matchup.team2 };
  overlay.querySelectorAll('.modal__pick-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const teamId = cb.dataset.teamId;
      const matchupId = cb.dataset.matchupId;
      const team = teams[teamId];
      if (team) {
        cascadePick(matchupId, team);
        // Update both checkboxes and labels
        overlay.querySelectorAll('.modal__pick-checkbox').forEach(otherCb => {
          const isThisTeam = otherCb.dataset.teamId === teamId;
          otherCb.checked = isThisTeam;
          const label = otherCb.nextElementSibling;
          if (label) label.textContent = isThisTeam ? 'Picked' : 'Pick';
        });
        if (currentOnPickChange) currentOnPickChange();
      }
    });
  });

  // Show
  requestAnimationFrame(() => {
    overlay.classList.add('modal-overlay--visible');

    // Scroll to the requested team panel
    if (scrollToTeamId) {
      const panel = overlay.querySelector(`.modal__team-panel[data-team-id="${scrollToTeamId}"]`);
      if (panel) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        panel.classList.add('modal__team-panel--highlighted');
        setTimeout(() => panel.classList.remove('modal__team-panel--highlighted'), 1500);
      }
    }
  });

  // Escape key
  document.addEventListener('keydown', handleEscape);
}

function handleEscape(e) {
  if (e.key === 'Escape') closeModal();
}

export function closeModal() {
  if (overlayEl) {
    overlayEl.classList.remove('modal-overlay--visible');
    document.removeEventListener('keydown', handleEscape);
  }
}
