import teamsData from '../data/teams.json';
import { getRoundIndex } from '../engine/propagation.js';
import { showTooltip, hideTooltip } from './tooltip.js';
import { openModal } from './modal.js';
import { getScoreForMatchup } from '../engine/liveScores.js';
import { getMarketData } from '../engine/polymarket.js';

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

function formatGameDate(dateStr) {
  if (!dateStr) return 'TBD';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'TBD';
    const month = d.toLocaleString('en-US', { month: 'short' });
    const day = d.getDate();
    const hours = d.getHours();
    const mins = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h = hours % 12 || 12;
    return `${month} ${day}, ${h}:${mins} ${ampm}`;
  } catch {
    return 'TBD';
  }
}

export function createMatchupCard(matchup) {
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
  const renderTeamRow = (team, isTop) => {
    const row = document.createElement('div');

    if (!team) {
      row.className = 'team-row team-row--empty';
      row.innerHTML = '<span class="team-row__name">TBD</span>';
      return row;
    }

    const profile = getTeamProfile(team.id);
    const isRecommended = matchup.recommendedPick === team.id;

    let rowClasses = 'team-row';
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

    // Live score
    if (hasScore) {
      const scoreEl = document.createElement('span');
      const pts = isTop ? liveScore.team1Score : liveScore.team2Score;
      const otherPts = isTop ? liveScore.team2Score : liveScore.team1Score;
      scoreEl.className = 'team-row__score' + (pts > otherPts ? ' team-row__score--leading' : '');
      scoreEl.textContent = pts;
      row.appendChild(scoreEl);
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

    // Click -> open modal
    row.style.cursor = 'pointer';
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      openModal(matchup, { scrollToTeamId: team.id });
    });

    // Hover for tooltip (desktop only)
    const isMobile = () => window.innerWidth <= 768;
    row.addEventListener('mouseenter', (e) => {
      if (!isMobile()) showTooltip(team, profile, matchup, e.currentTarget);
    });
    row.addEventListener('mouseleave', () => {
      if (!isMobile()) hideTooltip();
    });

    return row;
  };

  card.appendChild(renderTeamRow(matchup.team1, true));
  card.appendChild(renderTeamRow(matchup.team2, false));

  // --- IntelliPick odds (always above Polymarket) ---
  if (hasPrediction && hasTeams) {
    const recIsTeam1 = matchup.recommendedPick === matchup.team1?.id;
    const t1Pct = recIsTeam1 ? matchup.confidencePercentage : (100 - matchup.confidencePercentage);
    const t2Pct = recIsTeam1 ? (100 - matchup.confidencePercentage) : matchup.confidencePercentage;

    const ipBar = document.createElement('div');
    ipBar.className = 'matchup-card__odds-bar';

    const ip1 = document.createElement('span');
    ip1.className = 'matchup-card__odds-pct';
    ip1.textContent = t1Pct + '%';

    const ipSource = document.createElement('span');
    ipSource.className = 'matchup-card__odds-source';
    ipSource.textContent = 'IntelliPick';

    const ip2 = document.createElement('span');
    ip2.className = 'matchup-card__odds-pct';
    ip2.textContent = t2Pct + '%';

    ipBar.appendChild(ip1);
    ipBar.appendChild(ipSource);
    ipBar.appendChild(ip2);
    card.appendChild(ipBar);
  }

  // --- Polymarket odds (below IntelliPick) ---
  const oddsData = liveScore && liveScore.odds;
  if (oddsData) {
    const oddsBar = document.createElement('div');
    oddsBar.className = 'matchup-card__odds-bar' + (oddsData.wsConnected ? ' matchup-card__odds-bar--live' : '');

    const t1Pct = document.createElement('span');
    t1Pct.className = 'matchup-card__odds-pct';
    const d1 = oddsData.team1ProbDelta || 0;
    const arrow1 = d1 > 0.005 ? '\u25B2' : d1 < -0.005 ? '\u25BC' : '';
    const cls1 = d1 > 0.005 ? ' matchup-card__odds-pct--up' : d1 < -0.005 ? ' matchup-card__odds-pct--down' : '';
    t1Pct.className += cls1;
    t1Pct.textContent = oddsData.team1Prob + '%' + (arrow1 ? ' ' + arrow1 : '');

    const source = document.createElement('span');
    source.className = 'matchup-card__odds-source';
    source.textContent = 'Polymarket';

    const t2Pct = document.createElement('span');
    t2Pct.className = 'matchup-card__odds-pct';
    const d2 = oddsData.team2ProbDelta || 0;
    const arrow2 = d2 > 0.005 ? '\u25B2' : d2 < -0.005 ? '\u25BC' : '';
    const cls2 = d2 > 0.005 ? ' matchup-card__odds-pct--up' : d2 < -0.005 ? ' matchup-card__odds-pct--down' : '';
    t2Pct.className += cls2;
    t2Pct.textContent = oddsData.team2Prob + '%' + (arrow2 ? ' ' + arrow2 : '');

    oddsBar.appendChild(t1Pct);
    oddsBar.appendChild(source);
    oddsBar.appendChild(t2Pct);
    card.appendChild(oddsBar);
  }

  // --- Game status footer (always at bottom) ---
  const statusBar = document.createElement('div');
  statusBar.className = 'matchup-card__status-bar';

  const statusLabel = document.createElement('span');
  statusLabel.className = 'matchup-card__status-label';

  if (!hasTeams) {
    statusLabel.textContent = 'TBD';
  } else if (hasScore && (liveScore.status === 'live' || liveScore.status === 'halftime')) {
    statusBar.classList.add('matchup-card__status-bar--live');
    const dot = document.createElement('span');
    dot.className = 'matchup-card__live-dot';
    statusLabel.appendChild(dot);
    const text = document.createElement('span');
    if (liveScore.status === 'halftime') {
      text.textContent = 'HALF';
    } else {
      const periodLabel = liveScore.period > 2 ? 'OT' : liveScore.period === 1 ? '1H' : '2H';
      text.textContent = `${liveScore.clock} ${periodLabel}`;
    }
    statusLabel.appendChild(text);
  } else if (hasScore && liveScore.status === 'final') {
    const finalText = liveScore.period > 2 ? 'Final/OT' : 'Final';
    statusLabel.textContent = finalText;
  } else if (liveScore && liveScore.gameDate) {
    statusLabel.textContent = formatGameDate(liveScore.gameDate);
  } else {
    statusLabel.textContent = 'TBD';
  }

  statusBar.appendChild(statusLabel);

  // Info button
  if (hasTeams) {
    const infoBtn = document.createElement('button');
    infoBtn.className = 'matchup-card__info-btn';
    infoBtn.textContent = 'i';
    infoBtn.title = 'View matchup details';
    infoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openModal(matchup);
    });
    statusBar.appendChild(infoBtn);
  }

  card.appendChild(statusBar);

  return card;
}
