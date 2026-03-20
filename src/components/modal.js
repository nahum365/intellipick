import teamsData from '../data/teams.json';
import { getPick } from '../engine/picks.js';
import { cascadePick } from '../engine/propagation.js';
import { getScoreForMatchup, onScoresUpdate } from '../engine/liveScores.js';
import { getMarketData, onPolymarketUpdate } from '../engine/polymarket.js';

let overlayEl = null;
let currentOnPickChange = null;
let currentMatchup = null;
let currentOptions = null;
let unsubScoreUpdate = null;
let unsubPolymarket = null;

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

function buildScoreboardHtml(matchup, liveScore) {
  if (!liveScore) return '';

  // For scheduled games, only show odds if available
  if (liveScore.status === 'scheduled') {
    if (!liveScore.odds) return '';
    const t1Name = matchup.team1?.name || 'TBD';
    const t2Name = matchup.team2?.name || 'TBD';
    const o = liveScore.odds;
    return `<div class="modal__scoreboard">
      <div class="modal__scoreboard-status modal__scoreboard-status--final">Pre-Game</div>
      <div class="modal__odds">
        <div class="modal__odds-source">${o.source || 'Market'} Odds</div>
        <div class="modal__odds-items">
          <span class="modal__odds-item"><span class="modal__odds-label">${t1Name}:</span> ${o.team1Prob}% (${o.moneyline1})</span>
          <span class="modal__odds-item"><span class="modal__odds-label">${t2Name}:</span> ${o.team2Prob}% (${o.moneyline2})</span>
        </div>
      </div>
    </div>`;
  }

  let statusLabel, statusClass;
  if (liveScore.status === 'live') {
    const periodLabel = liveScore.period > 2 ? 'OT' : liveScore.period === 1 ? '1st Half' : '2nd Half';
    statusLabel = `${liveScore.clock} - ${periodLabel}`;
    statusClass = 'live';
  } else if (liveScore.status === 'halftime') {
    statusLabel = 'Halftime';
    statusClass = 'halftime';
  } else {
    statusLabel = 'Final';
    statusClass = 'final';
  }

  const t1Leading = liveScore.team1Score > liveScore.team2Score;
  const t2Leading = liveScore.team2Score > liveScore.team1Score;
  const t1Name = matchup.team1?.name || 'TBD';
  const t2Name = matchup.team2?.name || 'TBD';
  const t1Seed = matchup.team1?.seed || '';
  const t2Seed = matchup.team2?.seed || '';

  let oddsHtml = '';
  if (liveScore.odds) {
    const o = liveScore.odds;
    const items = [];
    if (o.team1Prob && o.team2Prob) {
      items.push(`<span class="modal__odds-item"><span class="modal__odds-label">${t1Name}:</span> ${o.team1Prob}% (${o.moneyline1})</span>`);
      items.push(`<span class="modal__odds-item"><span class="modal__odds-label">${t2Name}:</span> ${o.team2Prob}% (${o.moneyline2})</span>`);
    }
    if (items.length) {
      oddsHtml = `<div class="modal__odds">
        <div class="modal__odds-source">${o.source || 'Market'} Odds</div>
        <div class="modal__odds-items">${items.join('')}</div>
      </div>`;
    }
  }

  let predictionHtml = '';
  if (matchup.recommendedPick) {
    const recIsTeam1 = matchup.recommendedPick === matchup.team1?.id;
    const recScore = recIsTeam1 ? liveScore.team1Score : liveScore.team2Score;
    const oppScore = recIsTeam1 ? liveScore.team2Score : liveScore.team1Score;
    const recName = recIsTeam1 ? t1Name : t2Name;

    if (liveScore.status === 'final') {
      const correct = recScore > oppScore;
      predictionHtml = `<div class="modal__prediction-result modal__prediction-result--${correct ? 'correct' : 'incorrect'}">
        IntelliPick picked ${recName} — ${correct ? 'Correct!' : 'Incorrect'}
      </div>`;
    } else {
      const status = recScore > oppScore ? 'winning' : recScore < oppScore ? 'losing' : 'tied';
      const label = recScore > oppScore ? 'currently winning' : recScore < oppScore ? 'currently losing' : 'currently tied';
      predictionHtml = `<div class="modal__prediction-result modal__prediction-result--${status}">
        IntelliPick's pick (${recName}) is ${label}
      </div>`;
    }
  }

  return `<div class="modal__scoreboard">
    <div class="modal__scoreboard-status modal__scoreboard-status--${statusClass}">
      ${statusClass === 'live' ? '<span class="modal__live-dot"></span>' : ''}
      ${statusLabel}
    </div>
    <div class="modal__scoreboard-scores">
      <div class="modal__scoreboard-team ${t1Leading ? 'modal__scoreboard-team--leading' : ''}">
        <span class="modal__scoreboard-seed">${t1Seed}</span>
        <span class="modal__scoreboard-name">${t1Name}</span>
        <span class="modal__scoreboard-pts">${liveScore.team1Score}</span>
      </div>
      <div class="modal__scoreboard-team ${t2Leading ? 'modal__scoreboard-team--leading' : ''}">
        <span class="modal__scoreboard-seed">${t2Seed}</span>
        <span class="modal__scoreboard-name">${t2Name}</span>
        <span class="modal__scoreboard-pts">${liveScore.team2Score}</span>
      </div>
    </div>
    ${oddsHtml}
    ${predictionHtml}
  </div>`;
}

function buildPolymarketPanel(matchup) {
  const mkt = getMarketData(matchup.id);
  if (!mkt) return '';

  const t1Name = matchup.team1?.name || 'TBD';
  const t2Name = matchup.team2?.name || 'TBD';
  const t1Pct = Math.round(mkt.team1Prob * 100);
  const t2Pct = Math.round(mkt.team2Prob * 100);
  const t1Fav = t1Pct >= t2Pct;

  // Delta arrows
  const d1 = mkt.team1ProbDelta || 0;
  const d2 = mkt.team2ProbDelta || 0;
  const arrow1 = d1 > 0.005 ? '<span class="pm-delta pm-delta--up">\u25B2</span>' : d1 < -0.005 ? '<span class="pm-delta pm-delta--down">\u25BC</span>' : '';
  const arrow2 = d2 > 0.005 ? '<span class="pm-delta pm-delta--up">\u25B2</span>' : d2 < -0.005 ? '<span class="pm-delta pm-delta--down">\u25BC</span>' : '';

  // Volume / liquidity formatting
  const fmtK = (n) => {
    if (!n || n <= 0) return '--';
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
    return '$' + Math.round(n);
  };

  // Buy price (bestAsk) as cents
  const buyPrice1 = mkt.bestAsk ? Math.round(mkt.bestAsk * 100) + '\u00A2' : '--';
  const buyPrice2 = mkt.bestAsk ? Math.round((1 - mkt.bestAsk) * 100) + '\u00A2' : '--';

  // Live game state from Sports WS
  let liveGameHtml = '';
  if (mkt.live && mkt.gameScore) {
    liveGameHtml = `
      <div class="pm-live-game">
        <div class="pm-live-game__header">
          <span class="pm-live-game__dot"></span>
          <span class="pm-live-game__label">LIVE</span>
          ${mkt.gamePeriod ? `<span class="pm-live-game__period">${mkt.gamePeriod}</span>` : ''}
          ${mkt.gameElapsed ? `<span class="pm-live-game__clock">${mkt.gameElapsed}</span>` : ''}
        </div>
        <div class="pm-live-game__score">${mkt.gameScore}</div>
      </div>`;
  }

  // Sentiment
  let sentimentHtml = '';
  if (mkt.sentiment) {
    sentimentHtml = `
      <div class="pm-sentiment">
        <div class="pm-sentiment__title">\uD83D\uDCAC Trader Sentiment</div>
        <div class="pm-sentiment__text">${mkt.sentiment}</div>
      </div>`;
  }

  return `<div class="pm-panel" data-matchup-id="${matchup.id}">
    <div class="pm-panel__header">
      <span class="pm-panel__logo">\u26A1</span>
      <span class="pm-panel__title">Polymarket Live Odds</span>
      ${mkt.live ? '<span class="pm-panel__live-badge">LIVE</span>' : ''}
    </div>

    ${liveGameHtml}

    <div class="pm-odds">
      <div class="pm-odds__team ${t1Fav ? 'pm-odds__team--fav' : ''}">
        <div class="pm-odds__team-name">${t1Name}</div>
        <div class="pm-odds__pct">${t1Pct}% ${arrow1}</div>
        <div class="pm-odds__ml">${mkt.moneyline1 || '--'}</div>
        <div class="pm-odds__buy">Buy: ${buyPrice1}</div>
      </div>
      <div class="pm-odds__vs">VS</div>
      <div class="pm-odds__team ${!t1Fav ? 'pm-odds__team--fav' : ''}">
        <div class="pm-odds__team-name">${t2Name}</div>
        <div class="pm-odds__pct">${t2Pct}% ${arrow2}</div>
        <div class="pm-odds__ml">${mkt.moneyline2 || '--'}</div>
        <div class="pm-odds__buy">Buy: ${buyPrice2}</div>
      </div>
    </div>

    <div class="pm-prob-bar">
      <div class="pm-prob-bar__fill pm-prob-bar__fill--t1" style="width:${t1Pct}%">
        <span class="pm-prob-bar__label">${t1Pct}%</span>
      </div>
      <div class="pm-prob-bar__fill pm-prob-bar__fill--t2" style="width:${t2Pct}%">
        <span class="pm-prob-bar__label">${t2Pct}%</span>
      </div>
    </div>

    <div class="pm-stats">
      <div class="pm-stats__item">
        <span class="pm-stats__label">Volume</span>
        <span class="pm-stats__value">${fmtK(mkt.volume)}</span>
      </div>
      <div class="pm-stats__item">
        <span class="pm-stats__label">Liquidity</span>
        <span class="pm-stats__value">${fmtK(mkt.liquidity)}</span>
      </div>
    </div>

    ${sentimentHtml}
  </div>`;
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
  currentMatchup = matchup;
  currentOptions = options;
  const overlay = ensureOverlay();

  // Subscribe to live score updates so the modal refreshes
  if (unsubScoreUpdate) unsubScoreUpdate();
  unsubScoreUpdate = onScoresUpdate(() => {
    if (currentMatchup && overlayEl && overlayEl.classList.contains('modal-overlay--visible')) {
      // Re-render the scoreboard section in-place
      const scoreboardContainer = overlayEl.querySelector('.modal__scoreboard');
      if (scoreboardContainer) {
        const freshScore = getScoreForMatchup(currentMatchup.id);
        const newHtml = buildScoreboardHtml(currentMatchup, freshScore);
        if (newHtml) {
          scoreboardContainer.outerHTML = newHtml;
        } else {
          scoreboardContainer.remove();
        }
      }
      // Also update odds that might not have been present on first open
      if (!overlayEl.querySelector('.modal__scoreboard')) {
        const freshScore = getScoreForMatchup(currentMatchup.id);
        const newHtml = buildScoreboardHtml(currentMatchup, freshScore);
        if (newHtml) {
          const recEl = overlayEl.querySelector('.modal__recommendation');
          const tactEl = overlayEl.querySelector('.modal__tactical');
          const insertBefore = tactEl || overlayEl.querySelector('.modal__teams');
          if (insertBefore) {
            insertBefore.insertAdjacentHTML('beforebegin', newHtml);
          }
        }
      }
    }
  });

  // Subscribe to Polymarket WS updates for live odds refresh
  if (unsubPolymarket) unsubPolymarket();
  unsubPolymarket = onPolymarketUpdate((detail) => {
    if (!currentMatchup || !overlayEl || !overlayEl.classList.contains('modal-overlay--visible')) return;
    if (detail && detail.matchupId && detail.matchupId !== currentMatchup.id) return;

    const pmContainer = overlayEl.querySelector('.pm-panel');
    const newPmHtml = buildPolymarketPanel(currentMatchup);
    if (pmContainer && newPmHtml) {
      pmContainer.outerHTML = newPmHtml;
      // Trigger flash animation on the new element
      const newEl = overlayEl.querySelector('.pm-panel');
      if (newEl) {
        newEl.classList.add('pm-panel--flash');
        setTimeout(() => newEl.classList.remove('pm-panel--flash'), 600);
      }
    } else if (!pmContainer && newPmHtml) {
      // Insert PM panel if it wasn't there before
      const tactEl = overlayEl.querySelector('.modal__tactical');
      const insertBefore = tactEl || overlayEl.querySelector('.modal__teams');
      if (insertBefore) insertBefore.insertAdjacentHTML('beforebegin', newPmHtml);
    }
  });

  const recTeam = matchup.recommendedPick === matchup.team1?.id ? matchup.team1 : matchup.team2;
  const confClass = confidenceClass(matchup.confidence);

  const profile1 = matchup.team1 ? getTeamProfile(matchup.team1.id) : null;
  const profile2 = matchup.team2 ? getTeamProfile(matchup.team2.id) : null;

  let title = '';
  if (matchup.team1 && matchup.team2) {
    title = `(${matchup.team1.seed}) ${matchup.team1.name} vs (${matchup.team2.seed}) ${matchup.team2.name}`;
  }

  const liveScore = getScoreForMatchup(matchup.id);
  const scoreboardHtml = buildScoreboardHtml(matchup, liveScore);
  const polymarketHtml = buildPolymarketPanel(matchup);

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
    ${scoreboardHtml}
    ${polymarketHtml}
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
  currentMatchup = null;
  currentOptions = null;
  if (unsubScoreUpdate) {
    unsubScoreUpdate();
    unsubScoreUpdate = null;
  }
  if (unsubPolymarket) {
    unsubPolymarket();
    unsubPolymarket = null;
  }
}
