import teamsData from '../data/teams.json';
import { getPick } from '../engine/picks.js';
import { cascadePick, getRoundIndex } from '../engine/propagation.js';
import { showTooltip, hideTooltip } from './tooltip.js';
import { openModal } from './modal.js';

function getTeamProfile(teamId) {
  return teamsData.teams.find(t => t.id === teamId) || null;
}

function confidenceClass(confidence) {
  if (!confidence) return '';
  const c = confidence.toLowerCase().replace(/\s+/g, '-');
  if (c === 'very-high') return 'very-high';
  if (c === 'high') return 'high';
  return 'medium';
}

function isUpsetCategory(category) {
  if (!category) return false;
  return category.toLowerCase().includes('upset') && !category.toLowerCase().includes('avoid');
}

export function createMatchupCard(matchup, onPickMade) {
  const card = document.createElement('div');
  const isR64 = getRoundIndex(matchup.id) === 0;
  const isLaterRound = !isR64;
  const hasTeams = matchup.team1 && matchup.team2;
  const hasAnyTeam = matchup.team1 || matchup.team2;
  const confClass = confidenceClass(matchup.confidence);
  const isUpset = isUpsetCategory(matchup.category);

  let classes = 'matchup-card';
  if (isLaterRound) classes += ' matchup-card--later-round';
  if (!hasAnyTeam) classes += ' matchup-card--empty';
  if (isUpset) classes += ' matchup-card--upset';
  else if (confClass) classes += ` matchup-card--${confClass}`;
  card.className = classes;

  // Header (R64 only)
  if (isR64 && matchup.category) {
    const header = document.createElement('div');
    header.className = 'matchup-card__header';

    const cat = document.createElement('span');
    cat.className = 'matchup-card__category' + (isUpset ? ' matchup-card__category--upset' : '');
    cat.textContent = matchup.category;
    header.appendChild(cat);

    if (matchup.confidence) {
      const badge = document.createElement('span');
      badge.className = `matchup-card__confidence-badge matchup-card__confidence-badge--${confClass}`;
      badge.textContent = matchup.confidence.toUpperCase();
      header.appendChild(badge);
    }

    card.appendChild(header);
  }

  // Team rows
  const currentPick = getPick(matchup.id);

  const renderTeamRow = (team, isTop) => {
    const row = document.createElement('div');

    if (!team) {
      row.className = 'team-row team-row--empty';
      row.innerHTML = '<span class="team-row__name">TBD</span>';
      return row;
    }

    const profile = getTeamProfile(team.id);
    const isRecommended = matchup.recommendedPick === team.id;
    const isPicked = currentPick && currentPick.id === team.id;

    let rowClasses = 'team-row';
    if (isPicked) rowClasses += ' team-row--picked';
    if (isRecommended) rowClasses += ' team-row--recommended';
    row.className = rowClasses;

    // Star for recommended
    const star = document.createElement('span');
    star.className = 'team-row__star';
    star.textContent = isRecommended ? '\u2605' : '';
    row.appendChild(star);

    // Seed
    const seed = document.createElement('span');
    seed.className = 'team-row__seed';
    seed.textContent = team.seed;
    row.appendChild(seed);

    // Name
    const name = document.createElement('span');
    name.className = 'team-row__name';
    name.textContent = team.name;
    row.appendChild(name);

    // Record
    if (profile && profile.record) {
      const record = document.createElement('span');
      record.className = 'team-row__record';
      record.textContent = profile.record;
      row.appendChild(record);
    }

    // Injury dots
    if (profile && profile.injuries && profile.injuries.length > 0) {
      const injuries = document.createElement('span');
      injuries.className = 'team-row__injuries';
      for (const inj of profile.injuries) {
        const dot = document.createElement('span');
        dot.className = 'injury-dot injury-dot--' + (inj.status === 'OUT' ? 'out' : 'doubtful');
        dot.title = `${inj.player}: ${inj.status} - ${inj.detail}`;
        injuries.appendChild(dot);
      }
      row.appendChild(injuries);
    }

    // Confidence percentage
    if (isR64 && matchup.confidencePercentage) {
      const pct = document.createElement('span');
      pct.className = 'team-row__pct';
      const teamPct = isRecommended ? matchup.confidencePercentage : (100 - matchup.confidencePercentage);
      pct.textContent = `${teamPct}%`;
      row.appendChild(pct);
    }

    // Check mark if picked (desktop only, hidden on mobile via CSS)
    if (isPicked) {
      const check = document.createElement('span');
      check.className = 'team-row__check';
      check.textContent = '\u2713';
      row.appendChild(check);
    }

    // Pick checkbox (mobile only, hidden on desktop via CSS)
    const mobileCheckbox = document.createElement('input');
    mobileCheckbox.type = 'checkbox';
    mobileCheckbox.checked = isPicked;
    mobileCheckbox.className = 'team-row__mobile-checkbox';
    mobileCheckbox.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    mobileCheckbox.addEventListener('change', () => {
      cascadePick(matchup.id, team);
      if (onPickMade) onPickMade();
    });
    row.appendChild(mobileCheckbox);

    // Click behavior: on mobile open modal, on desktop pick
    const isMobile = () => window.innerWidth <= 768;

    row.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isMobile()) {
        openModal(matchup, { scrollToTeamId: team.id, onPickChange: onPickMade });
      } else {
        cascadePick(matchup.id, team);
        if (onPickMade) onPickMade();
      }
    });

    // Hover for tooltip (desktop only)
    row.addEventListener('mouseenter', (e) => {
      if (!isMobile()) {
        showTooltip(team, profile, matchup, e.currentTarget);
      }
    });
    row.addEventListener('mouseleave', () => {
      if (!isMobile()) {
        hideTooltip();
      }
    });

    return row;
  };

  card.appendChild(renderTeamRow(matchup.team1, true));
  card.appendChild(renderTeamRow(matchup.team2, false));

  // Footer with probability bar and info button (R64 only)
  if (isR64 && matchup.confidencePercentage) {
    const footer = document.createElement('div');
    footer.className = 'matchup-card__footer';

    const bar = document.createElement('div');
    bar.className = 'prob-bar';
    const fill = document.createElement('div');
    fill.className = `prob-bar__fill prob-bar__fill--${confClass}`;
    fill.style.width = matchup.confidencePercentage + '%';
    bar.appendChild(fill);
    footer.appendChild(bar);

    const pctLabel = document.createElement('span');
    pctLabel.className = 'matchup-card__pct';
    pctLabel.textContent = matchup.confidencePercentage + '%';
    footer.appendChild(pctLabel);

    const infoBtn = document.createElement('button');
    infoBtn.className = 'matchup-card__info-btn';
    infoBtn.textContent = 'i';
    infoBtn.title = 'View matchup details';
    infoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openModal(matchup);
    });
    footer.appendChild(infoBtn);

    card.appendChild(footer);
  }

  return card;
}
