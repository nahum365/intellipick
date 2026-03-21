let tooltipEl = null;
let showTimeout = null;

function ensureTooltip() {
  if (tooltipEl) return tooltipEl;
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'tooltip';
  tooltipEl.addEventListener('mouseleave', () => hideTooltip());
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

function buildSection(title, content) {
  return `<div class="tooltip__section">
    <div class="tooltip__section-title">${title}</div>
    ${content}
  </div>`;
}

function buildTooltipContent(team, profile, matchup) {
  let html = '';

  // Header
  const fullName = profile ? profile.name : team.name;
  const meta = [];
  if (team.seed) meta.push(`${team.seed}-seed`);
  if (matchup && matchup.region) meta.push(matchup.region);
  if (profile) {
    if (profile.record) meta.push(profile.record);
    if (profile.conference) meta.push(profile.conference);
  }

  html += `<div class="tooltip__header">
    <div class="tooltip__team-name">${fullName}</div>
    <div class="tooltip__team-meta">${meta.join(' \u00B7 ')}</div>
  </div>`;

  if (!profile) {
    // Minimal tooltip for teams without profiles
    if (matchup && matchup.tacticalAdvantage) {
      html += buildSection('Matchup Analysis', `<div class="tooltip__text">${matchup.tacticalAdvantage}</div>`);
    }
    return html;
  }

  // Rankings
  const rankings = [];
  if (profile.kenpomRank) rankings.push(`KenPom #${profile.kenpomRank}`);
  if (profile.barttovikRank) rankings.push(`BartTorvik #${profile.barttovikRank}`);
  if (profile.championshipOdds) rankings.push(`Title: ${profile.championshipOdds} (${profile.championshipImpliedPct}%)`);
  if (rankings.length > 0) {
    html += buildSection('Rankings & Odds', rankings.map(r => `<div class="tooltip__row"><span class="tooltip__value">${r}</span></div>`).join(''));
  }

  // Efficiency
  const effRows = [];
  if (profile.offenseEfficiency) effRows.push(`<div class="tooltip__row"><span class="tooltip__label">Offense</span><span class="tooltip__value" style="max-width:200px;font-size:10px">${profile.offenseEfficiency}</span></div>`);
  if (profile.defenseEfficiency) effRows.push(`<div class="tooltip__row"><span class="tooltip__label">Defense</span><span class="tooltip__value" style="max-width:200px;font-size:10px">${profile.defenseEfficiency}</span></div>`);
  if (effRows.length) html += buildSection('Efficiency', effRows.join(''));

  // Momentum
  if (profile.recentMomentum) {
    html += buildSection('Momentum', `<div class="tooltip__text">${profile.recentMomentum}</div>`);
  }

  // Key Players
  if (profile.keyPlayers && profile.keyPlayers.length > 0) {
    const players = profile.keyPlayers.map(p => {
      let playerHtml = `<div class="tooltip__player"><div class="tooltip__player-name">${p.name}</div>`;
      if (p.stats) playerHtml += `<div class="tooltip__player-stats">${p.stats}</div>`;
      if (p.note) playerHtml += `<div class="tooltip__player-note">${p.note}</div>`;
      playerHtml += '</div>';
      return playerHtml;
    }).join('');
    html += buildSection('Key Players', players);
  }

  // Injuries
  if (profile.injuries && profile.injuries.length > 0) {
    const injuries = profile.injuries.map(inj => {
      const statusClass = inj.status === 'OUT' ? 'out' : 'doubtful';
      return `<div class="tooltip__injury">
        <span class="tooltip__injury-status tooltip__injury-status--${statusClass}">${inj.status}</span>
        <span class="tooltip__injury-detail">${inj.player} \u2014 ${inj.detail}</span>
      </div>`;
    }).join('');
    html += buildSection('Injuries', injuries);
  }

  // Strengths/Weaknesses
  const swHtml = [];
  if (profile.strengths) swHtml.push(`<div class="tooltip__text"><span class="tooltip__strength">\u25B2</span> ${profile.strengths}</div>`);
  if (profile.weaknesses) swHtml.push(`<div class="tooltip__text"><span class="tooltip__weakness">\u25BC</span> ${profile.weaknesses}</div>`);
  if (swHtml.length) html += buildSection('Strengths & Weaknesses', swHtml.join(''));

  // Badges
  const badges = [];
  if (profile.deepRunWatch) badges.push('<span class="tooltip__badge tooltip__badge--deep-run">DEEP RUN WATCH</span>');
  if (profile.fadeAlert) badges.push('<span class="tooltip__badge tooltip__badge--fade">FADE ALERT</span>');
  if (badges.length) {
    html += `<div class="tooltip__section"><div class="tooltip__badge-row">${badges.join('')}</div></div>`;
  }

  return html;
}

function positionTooltip(anchor) {
  const tip = ensureTooltip();
  const rect = anchor.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();

  let left = rect.right + 12;
  let top = rect.top;

  // Flip left if near right edge
  if (left + 360 > window.innerWidth) {
    left = rect.left - 360 - 12;
  }

  // Clamp vertical
  if (top + tipRect.height > window.innerHeight - 20) {
    top = window.innerHeight - tipRect.height - 20;
  }
  if (top < 10) top = 10;

  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

export { buildTooltipContent };

export function isMobile() {
  return window.innerWidth < 768;
}

export function showTooltip(team, profile, matchup, anchor) {
  if (isMobile()) return; // No hover tooltips on touch devices
  clearTimeout(showTimeout);
  showTimeout = setTimeout(() => {
    const tip = ensureTooltip();
    tip.innerHTML = buildTooltipContent(team, profile, matchup);
    tip.classList.add('tooltip--visible');
    // Position after render
    requestAnimationFrame(() => positionTooltip(anchor));
  }, 150);
}

export function hideTooltip() {
  clearTimeout(showTimeout);
  if (tooltipEl) {
    tooltipEl.classList.remove('tooltip--visible');
  }
}
