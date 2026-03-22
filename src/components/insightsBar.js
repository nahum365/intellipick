import { getUpsetAlerts } from '../engine/scoring.js';
import { getScoreForMatchup, getFetchStatus } from '../engine/liveScores.js';
import { getR64Matchup } from '../engine/propagation.js';
import { refreshGamma } from '../engine/polymarket.js';
import matchupsData from '../data/matchups.json';

function computeBarStats() {
  const upsets = getUpsetAlerts();
  let correct = 0, incorrect = 0, live = 0, pending = 0;
  let upsetHits = 0, upsetMisses = 0;

  // All IntelliPick results
  for (const m of matchupsData.matchups) {
    if (!m.recommendedPick || !m.team1 || !m.team2) continue;
    const liveScore = getScoreForMatchup(m.id);
    if (!liveScore || liveScore.status === 'scheduled') { pending++; continue; }
    if (liveScore.status === 'live' || liveScore.status === 'halftime') { live++; continue; }
    if (liveScore.status !== 'final') { pending++; continue; }

    const recIsTeam1 = m.recommendedPick === m.team1.id;
    const recWon = recIsTeam1
      ? liveScore.team1Score > liveScore.team2Score
      : liveScore.team2Score > liveScore.team1Score;
    if (recWon) correct++;
    else incorrect++;
  }

  // Upset results
  for (const u of upsets) {
    const matchup = getR64Matchup(u.matchupId);
    const liveScore = getScoreForMatchup(u.matchupId);
    if (liveScore && liveScore.status === 'final' && matchup) {
      const upsetTeamIsTeam1 = u.team.id === matchup.team1?.id;
      const upsetTeamScore = upsetTeamIsTeam1 ? liveScore.team1Score : liveScore.team2Score;
      const otherScore = upsetTeamIsTeam1 ? liveScore.team2Score : liveScore.team1Score;
      if (upsetTeamScore > otherScore) upsetHits++;
      else upsetMisses++;
    }
  }

  const decided = correct + incorrect;
  const winPct = decided > 0 ? Math.round((correct / decided) * 100) : null;
  const upsetDecided = upsetHits + upsetMisses;

  return { correct, incorrect, live, pending, decided, winPct, upsets: upsets.length, upsetHits, upsetMisses, upsetDecided };
}

export function createInsightsBar() {
  const bar = document.createElement('div');
  bar.className = 'insights-bar';
  updateInsightsBar(bar);
  return bar;
}

export function updateInsightsBar(bar) {
  const s = computeBarStats();

  let items = '';

  // Overall record
  if (s.decided > 0) {
    const color = s.winPct >= 70 ? 'var(--confidence-very-high)' : s.winPct >= 50 ? 'var(--primary)' : 'var(--upset)';
    items += `
      <div class="insights-bar__item">
        <span class="insights-bar__badge" style="background:${color}20;color:${color}">${s.correct}-${s.incorrect}</span>
        <span>IntelliPick record (${s.winPct}%)</span>
      </div>`;
  }

  // Live games
  if (s.live > 0) {
    items += `
      <div class="insights-bar__item">
        <span class="insights-bar__badge insights-bar__badge--upset">${s.live} LIVE</span>
        <span>games in progress</span>
      </div>`;
  }

  // Intelliupsets
  if (s.upsetDecided > 0) {
    items += `
      <div class="insights-bar__item">
        <span class="insights-bar__badge insights-bar__badge--upset">${s.upsetHits}/${s.upsetDecided}</span>
        <span>Intelliupsets hit</span>
      </div>`;
  } else if (s.upsets > 0) {
    items += `
      <div class="insights-bar__item">
        <span class="insights-bar__badge insights-bar__badge--upset">${s.upsets}</span>
        <span>Intelliupsets called</span>
      </div>`;
  }

  // Upcoming
  if (s.pending > 0) {
    items += `
      <div class="insights-bar__item">
        <span>${s.pending} upcoming</span>
      </div>`;
  }

  // Build left side (stats items)
  const left = document.createElement('div');
  left.className = 'insights-bar__left';
  left.innerHTML = items;

  bar.innerHTML = '';

  // Top row: stats + status boxes
  const main = document.createElement('div');
  main.className = 'insights-bar__main';
  main.appendChild(left);
  main.appendChild(buildStatusBoxes());
  bar.appendChild(main);

  // Footer row: always below, true-centered
  const footer = document.createElement('div');
  footer.className = 'insights-bar__footer';
  footer.innerHTML = 'Made with Gemini and Claude by <a href="https://github.com/nahum365" class="insights-bar__footer-link" target="_blank" rel="noopener">nahum365</a> &nbsp;&middot;&nbsp; <a href="https://github.com/nahum365/intellipick" class="insights-bar__footer-link" target="_blank" rel="noopener">GitHub \u2197</a>';
  bar.appendChild(footer);
}

function timeAgo(ts) {
  if (!ts) return null;
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 10) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function buildStatusBoxes() {
  const s = getFetchStatus();
  const container = document.createElement('div');
  container.className = 'status-boxes';

  // --- ESPN ---
  const espnBox = document.createElement('div');
  espnBox.className = 'status-box';

  const espnBulb = document.createElement('span');
  const espnLabel = document.createElement('span');
  espnLabel.className = 'status-box__label';
  espnLabel.textContent = 'ESPN';
  const espnDetail = document.createElement('span');
  espnDetail.className = 'status-box__detail';

  if (s.espnLoading) {
    espnBulb.className = 'status-box__bulb status-box__bulb--loading';
    espnDetail.textContent = '';
  } else if (s.espnExhausted) {
    espnBulb.className = 'status-box__bulb status-box__bulb--red';
    espnDetail.textContent = '(unavailable)';
  } else if (s.espnFailed && s.espnNextRetryAt) {
    espnBulb.className = 'status-box__bulb status-box__bulb--yellow';
    const secsLeft = Math.max(0, Math.ceil((s.espnNextRetryAt - Date.now()) / 1000));
    const attemptsLeft = s.espnRetryMax - s.espnRetryCount;
    espnDetail.textContent = `(retry in ${secsLeft}s, ${attemptsLeft} left)`;
  } else if (s.espnLastLoaded) {
    espnBulb.className = 'status-box__bulb status-box__bulb--green';
    espnDetail.textContent = `(${timeAgo(s.espnLastLoaded)})`;
  } else {
    espnBulb.className = 'status-box__bulb status-box__bulb--loading';
    espnDetail.textContent = '';
  }

  espnBox.appendChild(espnBulb);
  espnBox.appendChild(espnLabel);
  espnBox.appendChild(espnDetail);
  container.appendChild(espnBox);

  // --- Polymarket ---
  const polyBox = document.createElement('div');
  polyBox.className = 'status-box';

  const polyBulb = document.createElement('span');
  const polyLabel = document.createElement('span');
  polyLabel.className = 'status-box__label';
  polyLabel.textContent = 'Polymarket';
  const polyDetail = document.createElement('span');
  polyDetail.className = 'status-box__detail';

  const poly = s.poly;
  if (poly.gammaState === 'failed') {
    polyBulb.className = 'status-box__bulb status-box__bulb--red';
    polyDetail.textContent = '(unavailable)';
  } else if (poly.gammaState === 'success' && poly.clobState === 'failed') {
    polyBulb.className = 'status-box__bulb status-box__bulb--yellow';
    polyDetail.textContent = '(no live updates)';
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'status-box__refresh-btn';
    refreshBtn.title = 'Refresh Polymarket data';
    refreshBtn.innerHTML = '&#x21bb;';
    refreshBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      refreshGamma();
    });
    polyBox._refreshBtn = refreshBtn;
  } else if (poly.gammaState === 'success' && poly.clobState === 'connected') {
    polyBulb.className = 'status-box__bulb status-box__bulb--green';
    polyDetail.textContent = '(live streaming)';
  } else {
    polyBulb.className = 'status-box__bulb status-box__bulb--loading';
    polyDetail.textContent = '(finding markets)';
  }

  polyBox.appendChild(polyBulb);
  polyBox.appendChild(polyLabel);
  polyBox.appendChild(polyDetail);
  if (polyBox._refreshBtn) polyBox.appendChild(polyBox._refreshBtn);
  container.appendChild(polyBox);

  return container;
}
