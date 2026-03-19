import teamsData from '../data/teams.json';
import { getPick } from '../engine/picks.js';
import { cascadePick, getRoundIndex } from '../engine/propagation.js';
import { showTooltip, hideTooltip } from './tooltip.js';
import { openModal } from './modal.js';
import { getScoreForMatchup } from '../engine/liveScores.js';

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
  const hasPrediction = !!matchup.confidencePercentage;
  const hasTeams = matchup.team1 && matchup.team2;
  const hasAnyTeam = matchup.team1 || matchup.team2;
  const confClass = confidenceClass(matchup.confidence);
  const isUpset = isUpsetCategory(matchup.category);

  const liveScore = hasTeams ? getScoreForMatchup(matchup.id) : null;
  const hasScore = liveScore && liveScore.status !== 'scheduled';

  let classes = 'matchup-card';
  if (isLaterRound) classes += ' matchup-card--later-round';
  if (isLaterRound && hasPrediction) classes += ' matchup-card--has-prediction';
  if (!hasAnyTeam) classes += ' matchup-card--empty';
  if (isUpset) classes += ' matchup-card--upset';
  else if (confClass) classes += ` matchup-card--${confClass}`;

  // Live game shimmer
  if (hasScore && (liveScore.status === 'live' || liveScore.status === 'halftime')) {
    classes += ' matchup-card--live';
  }

  // Prediction result styling for final games
  if (hasScore && liveScore.status === 'final' && matchup.recommendedPick) {
    const recIsTeam1 = matchup.recommendedPick === matchup.team1?.id;
    const recWon = recIsTeam1
      ? liveScore.team1Score > liveScore.team2Score
      : liveScore.team2Score > liveScore.team1Score;
    classes += recWon ? ' matchup-card--pick-correct' : ' matchup-card--pick-incorrect';
  }

  card.className = classes;

  // Header (any round with prediction data)
  if (hasPrediction && matchup.category) {
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

    // Live score
    if (hasScore) {
      const scoreEl = document.createElement('span');
      const pts = isTop ? liveScore.team1Score : liveScore.team2Score;
      const otherPts = isTop ? liveScore.team2Score : liveScore.team1Score;
      scoreEl.className = 'team-row__score' + (pts > otherPts ? ' team-row__score--leading' : '');
      scoreEl.textContent = pts;
      row.appendChild(scoreEl);
    }

    // Record (hide when scores are showing to save space)
    if (!hasScore && profile && profile.record) {
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

    // Confidence percentage (hidden when live scores are showing)
    if (hasPrediction && !hasScore) {
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

    // Pick toggle button (mobile only, hidden on desktop via CSS)
    const pickBtn = document.createElement('button');
    pickBtn.className = 'team-row__pick-btn' + (isPicked ? ' team-row__pick-btn--active' : '');
    pickBtn.textContent = isPicked ? '\u2713' : '';
    pickBtn.setAttribute('aria-label', isPicked ? 'Selected' : 'Select');
    pickBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      cascadePick(matchup.id, team);
      if (onPickMade) onPickMade();
    });
    row.appendChild(pickBtn);

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

  // Live game status bar
  if (hasScore && (liveScore.status === 'live' || liveScore.status === 'halftime')) {
    const statusEl = document.createElement('div');
    statusEl.className = 'matchup-card__live-status';
    const dot = document.createElement('span');
    dot.className = 'matchup-card__live-dot';
    statusEl.appendChild(dot);
    const label = document.createElement('span');
    if (liveScore.status === 'halftime') {
      label.textContent = 'HALF';
    } else {
      const periodLabel = liveScore.period > 2 ? 'OT' : liveScore.period === 1 ? '1H' : '2H';
      label.textContent = `${liveScore.clock} ${periodLabel}`;
    }
    statusEl.appendChild(label);
    card.appendChild(statusEl);
  } else if (hasScore && liveScore.status === 'final') {
    const statusEl = document.createElement('div');
    statusEl.className = 'matchup-card__final-status';
    statusEl.textContent = 'FINAL';
    card.appendChild(statusEl);
  }

  // Polymarket odds bar (for scheduled games with odds)
  if (liveScore && liveScore.odds && (!hasScore || liveScore.status === 'scheduled')) {
    const oddsBar = document.createElement('div');
    oddsBar.className = 'matchup-card__odds-bar';
    const o = liveScore.odds;
    oddsBar.innerHTML = `<span class="matchup-card__odds-source">${o.source || 'Market'}</span>`
      + `<span class="matchup-card__odds-team">${o.team1Prob}%</span>`
      + `<span class="matchup-card__odds-sep">\u2013</span>`
      + `<span class="matchup-card__odds-team">${o.team2Prob}%</span>`;
    card.appendChild(oddsBar);
  }

  // Footer with probability bar and info button (any round with prediction data)
  if (hasPrediction) {
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
