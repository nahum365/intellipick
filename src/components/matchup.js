import teamsData from '../data/teams.json';
import { getRoundIndex } from '../engine/propagation.js';
import { showTooltip, hideTooltip, isMobile } from './tooltip.js';
import { openModal } from './modal.js';
import { openBottomSheet } from './bottomSheet.js';
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

  // Three game states: live, final, or default (hasn't started)
  const isLive = hasScore && (liveScore.status === 'live' || liveScore.status === 'halftime');
  const isFinal = hasScore && liveScore.status === 'final';

  // For final games, determine if our recommended pick was correct
  let recWon = null;
  if (isFinal && matchup.recommendedPick) {
    const recIsTeam1 = matchup.recommendedPick === matchup.team1?.id;
    recWon = recIsTeam1
      ? liveScore.team1Score > liveScore.team2Score
      : liveScore.team2Score > liveScore.team1Score;
  }

  if (isLive) classes += ' matchup-card--live';
  else if (isFinal) classes += ' matchup-card--final';
  else if (hasTeams) classes += ' matchup-card--upcoming';

  card.className = classes;
  card.dataset.matchupId = matchup.id;

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
  const renderTeamRow = (team, isTop, isExpected) => {
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
    if (isExpected) rowClasses += ' team-row--expected';
    if (isFinal && hasScore) {
      const pts = isTop ? liveScore.team1Score : liveScore.team2Score;
      const otherPts = isTop ? liveScore.team2Score : liveScore.team1Score;
      if (pts < otherPts) rowClasses += ' team-row--loser';
    }
    row.className = rowClasses;

    // Indicator: star for recommended, check/x for final results
    const indicator = document.createElement('span');
    indicator.className = 'team-row__star';
    if (isFinal && isRecommended && recWon !== null) {
      indicator.textContent = recWon ? '\u2713' : '\u2717';
      indicator.className += recWon ? ' team-row__star--correct' : ' team-row__star--incorrect';
    } else {
      indicator.textContent = isRecommended ? '\u2605' : '';
    }
    row.appendChild(indicator);

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

    // Click -> bottom sheet (mobile) or modal (desktop)
    row.style.cursor = 'pointer';
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isMobile()) {
        openBottomSheet(team, profile, matchup);
      } else {
        openModal(matchup, { scrollToTeamId: team.id });
      }
    });

    // Hover for tooltip
    row.addEventListener('mouseenter', (e) => {
      showTooltip(team, profile, matchup, e.currentTarget);
    });
    row.addEventListener('mouseleave', () => {
      hideTooltip();
    });

    return row;
  };

  const renderGhostRow = (ghostTeam) => {
    const row = document.createElement('div');
    row.className = 'team-row team-row--ghost';
    const label = document.createElement('span');
    label.className = 'team-row__ghost-label';
    label.textContent = `${ghostTeam.seed} ${ghostTeam.name}`;
    row.appendChild(label);
    return row;
  };

  card.appendChild(renderTeamRow(matchup.team1, true, matchup.team1Expected));
  if (matchup.team1GhostPick) card.appendChild(renderGhostRow(matchup.team1GhostPick));
  card.appendChild(renderTeamRow(matchup.team2, false, matchup.team2Expected));
  if (matchup.team2GhostPick) card.appendChild(renderGhostRow(matchup.team2GhostPick));

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

  // --- Polymarket odds (below IntelliPick, read directly from polymarket module) ---
  const polyData = hasTeams ? getMarketData(matchup.id) : null;
  if (polyData && polyData.team1Prob && polyData.team2Prob) {
    const recentTick = polyData.lastChangeTime && (Date.now() - polyData.lastChangeTime < 2000);
    const oddsBar = document.createElement('div');
    oddsBar.className = 'matchup-card__odds-bar' + (polyData.live ? ' matchup-card__odds-bar--live' : '');

    const t1Pct = document.createElement('span');
    t1Pct.className = 'matchup-card__odds-pct';
    const d1 = polyData.team1ProbDelta || 0;
    const arrow1 = d1 > 0.005 ? '\u25B2' : d1 < -0.005 ? '\u25BC' : '';
    const cls1 = d1 > 0.005 ? ' matchup-card__odds-pct--up' : d1 < -0.005 ? ' matchup-card__odds-pct--down' : '';
    t1Pct.className += cls1;
    if (recentTick && Math.abs(d1) > 0.001) {
      t1Pct.classList.add(d1 > 0 ? 'tick-up' : 'tick-down');
    }
    t1Pct.textContent = Math.round(polyData.team1Prob * 100) + '%' + (arrow1 ? ' ' + arrow1 : '');

    const source = document.createElement('span');
    source.className = 'matchup-card__odds-source';
    source.textContent = 'Polymarket';

    const t2Pct = document.createElement('span');
    t2Pct.className = 'matchup-card__odds-pct';
    const d2 = polyData.team2ProbDelta || 0;
    const arrow2 = d2 > 0.005 ? '\u25B2' : d2 < -0.005 ? '\u25BC' : '';
    const cls2 = d2 > 0.005 ? ' matchup-card__odds-pct--up' : d2 < -0.005 ? ' matchup-card__odds-pct--down' : '';
    t2Pct.className += cls2;
    if (recentTick && Math.abs(d2) > 0.001) {
      t2Pct.classList.add(d2 > 0 ? 'tick-up' : 'tick-down');
    }
    t2Pct.textContent = Math.round(polyData.team2Prob * 100) + '%' + (arrow2 ? ' ' + arrow2 : '');

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

  const appendChannel = () => {
    if (liveScore?.broadcastChannel) {
      const ch = document.createElement('span');
      ch.className = 'matchup-card__channel';
      ch.textContent = liveScore.broadcastChannel;
      statusLabel.appendChild(ch);
    }
  };

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
    appendChannel();
  } else if (hasScore && liveScore.status === 'final') {
    const finalText = liveScore.period > 2 ? 'Final/OT' : 'Final';
    statusLabel.textContent = finalText;
  } else if (liveScore && liveScore.gameDate) {
    statusLabel.textContent = formatGameDate(liveScore.gameDate);
    appendChannel();
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
