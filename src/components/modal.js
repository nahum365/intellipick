import teamsData from '../data/teams.json';

let overlayEl = null;

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

function buildTeamPanel(team, profile) {
  if (!team) return '<div class="modal__team-panel"><p style="color:var(--text-muted)">TBD</p></div>';

  let html = '<div class="modal__team-panel">';

  // Header
  html += `<div class="modal__team-panel-header">
    <span class="modal__team-panel-seed">${team.seed}</span>
    <span class="modal__team-panel-name">${profile ? profile.name : team.name}</span>
  </div>`;

  // Meta
  const meta = [];
  if (profile) {
    if (profile.record) meta.push(profile.record);
    if (profile.conference) meta.push(profile.conference);
    if (profile.kenpomRank) meta.push(`KenPom #${profile.kenpomRank}`);
  }
  if (meta.length) html += `<div class="modal__team-meta">${meta.join(' \u00B7 ')}</div>`;

  if (profile) {
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

export function openModal(matchup) {
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
      ${buildTeamPanel(matchup.team1, profile1)}
      ${buildTeamPanel(matchup.team2, profile2)}
    </div>
  </div>`;

  // Close button
  overlay.querySelector('.modal__close').addEventListener('click', closeModal);

  // Show
  requestAnimationFrame(() => overlay.classList.add('modal-overlay--visible'));

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
