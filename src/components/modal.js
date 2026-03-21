import teamsData from '../data/teams.json';
import { getScoreForMatchup, onScoresUpdate } from '../engine/liveScores.js';
import { getMarketData, getAssetPriceState, onPolymarketUpdate } from '../engine/polymarket.js';
import { isMobile } from './tooltip.js';

let overlayEl = null;
let currentMatchup = null;
let currentOptions = null;
let unsubScoreUpdate = null;
let unsubPolymarket = null;

function getTeamProfile(teamId) {
  return teamsData.teams.find(t => t.id === teamId) || null;
}

// Canonical display name from teams.json, falling back to the matchup team name
function teamDisplayName(team) {
  if (!team) return 'TBD';
  const profile = getTeamProfile(team.id);
  return profile?.shortName || team.name || team.id;
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

  let html = `<div class="modal__team-panel" data-team-id="${team.id}">`;

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

  // Don't show scoreboard for scheduled games (Polymarket panel handles pre-game odds)
  if (liveScore.status === 'scheduled') return '';

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
  const t1Name = teamDisplayName(matchup.team1);
  const t2Name = teamDisplayName(matchup.team2);
  const t1Seed = matchup.team1?.seed || '';
  const t2Seed = matchup.team2?.seed || '';

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
    ${predictionHtml}
  </div>`;
}

function buildAssetDebugRow(label, assetId) {
  if (!assetId) return `<div class="pm-debug__row"><span class="pm-debug__label">${label}</span><span class="pm-debug__value">--</span></div>`;
  const p = getAssetPriceState(assetId);
  if (!p) return `<div class="pm-debug__row"><span class="pm-debug__label">${label}</span><span class="pm-debug__value">no data</span></div>`;
  const bid = p.bestBid > 0 ? p.bestBid.toFixed(4) : '--';
  const ask = p.bestAsk > 0 ? p.bestAsk.toFixed(4) : '--';
  const ltp = p.lastTradePrice > 0 ? p.lastTradePrice.toFixed(4) : '--';
  const spread = (p.bestBid > 0 && p.bestAsk > 0) ? (p.bestAsk - p.bestBid).toFixed(4) : '--';
  return `<div class="pm-debug__row"><span class="pm-debug__label">${label}</span><span class="pm-debug__value">bid ${bid} / ask ${ask} (spread ${spread}) · ltp ${ltp}</span></div>`;
}

function buildPolymarketPanel(matchup) {
  const mkt = getMarketData(matchup.id);
  if (!mkt) return '';

  const t1Name = teamDisplayName(matchup.team1);
  const t2Name = teamDisplayName(matchup.team2);
  const t1Pct = Math.round(mkt.team1Prob * 100);
  const t2Pct = Math.round(mkt.team2Prob * 100);
  const t1Fav = t1Pct >= t2Pct;

  // Delta arrows + tick flash
  const d1 = mkt.team1ProbDelta || 0;
  const d2 = mkt.team2ProbDelta || 0;
  const recentTick = mkt.lastChangeTime && (Date.now() - mkt.lastChangeTime < 2000);
  const arrow1 = d1 > 0.005 ? '<span class="pm-delta pm-delta--up">\u25B2</span>' : d1 < -0.005 ? '<span class="pm-delta pm-delta--down">\u25BC</span>' : '';
  const arrow2 = d2 > 0.005 ? '<span class="pm-delta pm-delta--up">\u25B2</span>' : d2 < -0.005 ? '<span class="pm-delta pm-delta--down">\u25BC</span>' : '';
  const tick1 = recentTick && Math.abs(d1) > 0.001 ? (d1 > 0 ? ' tick-up' : ' tick-down') : '';
  const tick2 = recentTick && Math.abs(d2) > 0.001 ? (d2 > 0 ? ' tick-up' : ' tick-down') : '';

  // Volume / liquidity formatting
  const fmtK = (n) => {
    if (!n || n <= 0) return '--';
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K';
    return '$' + Math.round(n);
  };

  // Implied probability as cents (matches Polymarket's display)
  const price1 = t1Pct + '\u00A2';
  const price2 = t2Pct + '\u00A2';

  // Live game state from ESPN (authoritative source for scores)
  const espnScore = getScoreForMatchup(matchup.id);
  const isLive = espnScore && (espnScore.status === 'live' || espnScore.status === 'halftime');
  let liveGameHtml = '';
  if (isLive) {
    const periodLabel = espnScore.status === 'halftime' ? 'HT'
      : espnScore.period > 2 ? 'OT'
      : espnScore.period === 1 ? '1H' : '2H';
    const clockStr = espnScore.status === 'halftime' ? '' : espnScore.clock;
    liveGameHtml = `
      <div class="pm-live-game">
        <div class="pm-live-game__header">
          <span class="pm-live-game__dot"></span>
          <span class="pm-live-game__label">LIVE</span>
          <span class="pm-live-game__period">${periodLabel}</span>
          ${clockStr ? `<span class="pm-live-game__clock">${clockStr}</span>` : ''}
        </div>
        <div class="pm-live-game__score">${espnScore.team1Score} - ${espnScore.team2Score}</div>
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
      ${isLive ? '<span class="pm-panel__live-badge">LIVE</span>' : ''}
    </div>

    ${liveGameHtml}

    <div class="pm-odds">
      <div class="pm-odds__side pm-odds__side--t1 ${t1Fav ? 'pm-odds__side--fav' : ''}">
        <div class="pm-odds__team-name">${t1Name}</div>
        <div class="pm-odds__pct${tick1}">${t1Pct}% ${arrow1}</div>
        <div class="pm-odds__detail">${mkt.moneyline1 || '--'} · ${price1}</div>
      </div>
      <div class="pm-odds__side pm-odds__side--t2 ${!t1Fav ? 'pm-odds__side--fav' : ''}">
        <div class="pm-odds__team-name">${t2Name}</div>
        <div class="pm-odds__pct${tick2}">${t2Pct}% ${arrow2}</div>
        <div class="pm-odds__detail">${mkt.moneyline2 || '--'} · ${price2}</div>
      </div>
    </div>
    <div class="pm-prob-bar">
      <div class="pm-prob-bar__fill pm-prob-bar__fill--t1" style="width:${t1Pct}%"></div>
      <div class="pm-prob-bar__fill pm-prob-bar__fill--t2" style="width:${t2Pct}%"></div>
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

    <div class="pm-debug">
      <div class="pm-debug__toggle" onclick="this.parentElement.classList.toggle('pm-debug--open')">
        Market Details \u25BE
      </div>
      <div class="pm-debug__body">
        ${mkt.eventTitle ? `<div class="pm-debug__row"><span class="pm-debug__label">Event</span><span class="pm-debug__value">${mkt.eventTitle}</span></div>` : ''}
        ${mkt.marketQuestion ? `<div class="pm-debug__row"><span class="pm-debug__label">Question</span><span class="pm-debug__value">${mkt.marketQuestion}</span></div>` : ''}
        <div class="pm-debug__row"><span class="pm-debug__label">Market Type</span><span class="pm-debug__value">${mkt.sportsMarketType || 'unknown'}</span></div>
        ${mkt.outcomes ? `<div class="pm-debug__row"><span class="pm-debug__label">Outcomes</span><span class="pm-debug__value">${mkt.outcomes.join(' / ')}</span></div>` : ''}
        <div class="pm-debug__row"><span class="pm-debug__label">Gamma Prices</span><span class="pm-debug__value">${mkt.team1OutcomePrice?.toFixed(4) || '--'} / ${mkt.team2OutcomePrice?.toFixed(4) || '--'}</span></div>
        ${buildAssetDebugRow('Team 1 CLOB', mkt.team1AssetId)}
        ${buildAssetDebugRow('Team 2 CLOB', mkt.team2AssetId)}
        <div class="pm-debug__row"><span class="pm-debug__label">Display Prob</span><span class="pm-debug__value">${mkt.team1Prob?.toFixed(4) || '--'} / ${mkt.team2Prob?.toFixed(4) || '--'}</span></div>
        ${mkt.conditionId ? `<div class="pm-debug__row"><span class="pm-debug__label">Condition ID</span><span class="pm-debug__value pm-debug__value--mono">${mkt.conditionId.slice(0, 12)}...</span></div>` : ''}
        ${mkt.slug ? `<div class="pm-debug__row"><a class="pm-debug__link" href="https://polymarket.com/event/${mkt.slug}" target="_blank" rel="noopener">View on Polymarket \u2197</a></div>` : ''}
      </div>
    </div>
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
  const { scrollToTeamId } = options;
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

  const t1DisplayName = teamDisplayName(matchup.team1);
  const t2DisplayName = teamDisplayName(matchup.team2);

  let title = '';
  if (matchup.team1 && matchup.team2) {
    title = `(${matchup.team1.seed}) ${t1DisplayName} vs (${matchup.team2.seed}) ${t2DisplayName}`;
  }

  const liveScore = getScoreForMatchup(matchup.id);
  const scoreboardHtml = buildScoreboardHtml(matchup, liveScore);
  const polymarketHtml = buildPolymarketPanel(matchup);

  const mobile = isMobile();
  const closeIcon = mobile ? '\u2190' : '\u00D7';
  const closeTitle = mobile ? 'Back' : 'Close';

  overlay.innerHTML = `<div class="modal">
    <div class="modal__header">
      <button class="modal__close" title="${closeTitle}">${closeIcon}</button>
      <span class="modal__title">${title}</span>
    </div>
    ${matchup.recommendedPick ? `<div class="modal__recommendation">
      <span class="modal__rec-pick">\u2605 Pick: ${recTeam ? teamDisplayName(recTeam) : ''}</span>
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
