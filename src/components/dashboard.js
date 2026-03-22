import { getUpsetAlerts } from '../engine/scoring.js';
import { getScoreForMatchup } from '../engine/liveScores.js';
import { getR64Matchup, getGeneratedMatchup, getRegionR64Matchups, REGIONS } from '../engine/propagation.js';
import { createMatchupCard } from './matchup.js';
import matchupsData from '../data/matchups.json';

const SESSION_KEY = 'ip_dashboard_dismissed';

const ROUND_TAB_ORDER = ['R64', 'R32', 'S16', 'E8', 'F4', 'CHAMP'];

const ROUND_LABELS = {
  R64: 'Round of 64',
  R32: 'Round of 32',
  S16: 'Sweet 16',
  E8: 'Elite Eight',
  F4: 'Final Four',
  CHAMP: 'National Championship',
};

function laterRoundId(region, round, position) {
  return `${region.toLowerCase()}-r${round}-${position}`;
}

function getAllMatchupsForRound(roundKey) {
  const items = [];
  if (roundKey === 'R64') {
    for (const region of REGIONS) {
      const ids = getRegionR64Matchups(region);
      for (const id of ids) {
        const m = getR64Matchup(id);
        if (m) items.push(m);
      }
    }
  } else if (roundKey === 'R32') {
    for (const region of REGIONS) {
      for (let i = 0; i < 4; i++) {
        const m = getGeneratedMatchup(laterRoundId(region, 2, i));
        if (m) items.push(m);
      }
    }
  } else if (roundKey === 'S16') {
    for (const region of REGIONS) {
      for (let i = 0; i < 2; i++) {
        const m = getGeneratedMatchup(laterRoundId(region, 3, i));
        if (m) items.push(m);
      }
    }
  } else if (roundKey === 'E8') {
    for (const region of REGIONS) {
      const m = getGeneratedMatchup(laterRoundId(region, 4, 0));
      if (m) items.push(m);
    }
  } else if (roundKey === 'F4') {
    const s1 = getGeneratedMatchup('ff-0');
    const s2 = getGeneratedMatchup('ff-1');
    if (s1) items.push(s1);
    if (s2) items.push(s2);
  } else if (roundKey === 'CHAMP') {
    const c = getGeneratedMatchup('championship');
    if (c) items.push(c);
  }
  return items;
}

function getActiveRoundKey() {
  // 1. Earliest round with any live/halftime game
  for (const key of ROUND_TAB_ORDER) {
    const matchups = getAllMatchupsForRound(key);
    if (matchups.some(m => {
      const score = getScoreForMatchup(m.id);
      return score && (score.status === 'live' || score.status === 'halftime');
    })) return key;
  }
  // 2. Earliest round with any scheduled game
  for (const key of ROUND_TAB_ORDER) {
    const matchups = getAllMatchupsForRound(key);
    if (matchups.length > 0 && matchups.some(m => {
      const score = getScoreForMatchup(m.id);
      return !score || score.status === 'scheduled';
    })) return key;
  }
  // 3. Last round with any data
  for (let i = ROUND_TAB_ORDER.length - 1; i >= 0; i--) {
    if (getAllMatchupsForRound(ROUND_TAB_ORDER[i]).length > 0) return ROUND_TAB_ORDER[i];
  }
  return 'R64';
}

function computeStats() {
  const upsets = getUpsetAlerts();
  let correct = 0, incorrect = 0, live = 0, pending = 0;
  let upsetHits = 0, upsetMisses = 0;

  for (const m of matchupsData.matchups) {
    if (!m.recommendedPick || !m.team1 || !m.team2) continue;
    const score = getScoreForMatchup(m.id);
    if (!score || score.status === 'scheduled') { pending++; continue; }
    if (score.status === 'live' || score.status === 'halftime') { live++; continue; }
    if (score.status !== 'final') { pending++; continue; }
    const recIsTeam1 = m.recommendedPick === m.team1.id;
    const recWon = recIsTeam1 ? score.team1Score > score.team2Score : score.team2Score > score.team1Score;
    if (recWon) correct++;
    else incorrect++;
  }

  for (const u of upsets) {
    const matchup = getR64Matchup(u.matchupId);
    const score = getScoreForMatchup(u.matchupId);
    if (score && score.status === 'final' && matchup) {
      const isTeam1 = u.team.id === matchup.team1?.id;
      const uScore = isTeam1 ? score.team1Score : score.team2Score;
      const oScore = isTeam1 ? score.team2Score : score.team1Score;
      if (uScore > oScore) upsetHits++;
      else upsetMisses++;
    }
  }

  const decided = correct + incorrect;
  const winPct = decided > 0 ? Math.round((correct / decided) * 100) : null;
  const upsetDecided = upsetHits + upsetMisses;

  return { correct, incorrect, live, pending, decided, winPct, upsets: upsets.length, upsetHits, upsetMisses, upsetDecided };
}

function generateNarrative(stats, roundKey) {
  const roundLabel = ROUND_LABELS[roundKey] || roundKey;
  const parts = [];

  // Tournament stage
  if (stats.live > 0) {
    parts.push(`The <strong>${roundLabel}</strong> is live right now — ${stats.live} game${stats.live !== 1 ? 's' : ''} in progress.`);
  } else if (stats.pending > 0) {
    parts.push(`The <strong>${roundLabel}</strong> is coming up with ${stats.pending} game${stats.pending !== 1 ? 's' : ''} on the slate.`);
  } else {
    parts.push(`The <strong>${roundLabel}</strong> is complete.`);
  }

  // Performance
  if (stats.decided > 0) {
    const pct = stats.winPct;
    const tone = pct >= 70 ? 'running hot' : pct >= 50 ? 'holding steady' : 'having a rough go';
    parts.push(`IntelliPick is ${tone} at <strong>${stats.correct}-${stats.incorrect}</strong> (${pct}%).`);
  } else {
    parts.push(`IntelliPick has picks ready for every matchup — games haven't tipped off yet.`);
  }

  // Upset tracker
  if (stats.upsets > 0) {
    if (stats.upsetDecided > 0) {
      parts.push(`Of ${stats.upsets} upset calls, <strong>${stats.upsetHits} have hit</strong> and ${stats.upsetMisses} have missed.`);
    } else {
      parts.push(`We've called <strong>${stats.upsets} upsets</strong> this round — keep an eye on those matchups below.`);
    }
  }

  return parts.join(' ');
}

function getInterestingMatchups() {
  const seen = new Set();
  const result = [];

  // Helper to push unique matchups
  function push(m) {
    if (!m || seen.has(m.id)) return;
    seen.add(m.id);
    result.push(m);
  }

  const activeKey = getActiveRoundKey();
  const activeMatchups = getAllMatchupsForRound(activeKey);

  // Priority 1: live/halftime games from active round
  for (const m of activeMatchups) {
    const score = getScoreForMatchup(m.id);
    if (score && (score.status === 'live' || score.status === 'halftime')) push(m);
  }

  // Priority 2: upset picks with high confidence from active round
  const upsets = getUpsetAlerts();
  const upsetIds = new Set(upsets.filter(u => u.confidencePercentage >= 65).map(u => u.matchupId));
  for (const m of activeMatchups) {
    if (upsetIds.has(m.id)) push(m);
  }

  // Priority 3: any high-confidence upcoming games from active round, sorted by confidence desc
  const remaining = activeMatchups
    .filter(m => !seen.has(m.id))
    .sort((a, b) => (b.confidencePercentage || 0) - (a.confidencePercentage || 0));
  for (const m of remaining) push(m);

  return result.slice(0, 8);
}

export function isDashboardDismissed() {
  return !!sessionStorage.getItem(SESSION_KEY);
}

export function showDashboard() {
  if (isDashboardDismissed()) return;

  if (!document.body) return;

  const overlay = document.createElement('div');
  overlay.className = 'dashboard-overlay';

  function dismiss() {
    sessionStorage.setItem(SESSION_KEY, '1');
    overlay.classList.remove('dashboard-overlay--visible');
    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
  }

  // --- Header ---
  const header = document.createElement('div');
  header.className = 'dashboard__header';

  const logo = document.createElement('div');
  logo.className = 'dashboard__logo';
  logo.innerHTML = 'Intelli<span>Pick</span>';
  header.appendChild(logo);

  const viewBtn = document.createElement('button');
  viewBtn.className = 'dashboard__view-btn';
  viewBtn.innerHTML = 'View Bracket &#8594;';
  viewBtn.addEventListener('click', dismiss);
  header.appendChild(viewBtn);

  overlay.appendChild(header);

  // --- Body ---
  const body = document.createElement('div');
  body.className = 'dashboard__body';

  const stats = computeStats();
  const roundKey = getActiveRoundKey();

  // Narrative
  const narrative = document.createElement('div');
  narrative.className = 'dashboard__narrative';
  narrative.innerHTML = generateNarrative(stats, roundKey);
  body.appendChild(narrative);

  // Stats row
  const statsRow = document.createElement('div');
  statsRow.className = 'dashboard__stats-row';

  function makeChip(value, label, color) {
    const chip = document.createElement('div');
    chip.className = 'dashboard__stat-chip';
    const val = document.createElement('div');
    val.className = 'dashboard__stat-chip__value';
    val.style.color = color || 'var(--text)';
    val.textContent = value;
    const lbl = document.createElement('div');
    lbl.className = 'dashboard__stat-chip__label';
    lbl.textContent = label;
    chip.appendChild(val);
    chip.appendChild(lbl);
    return chip;
  }

  const recordColor = stats.decided === 0
    ? 'var(--text-muted)'
    : stats.winPct >= 70 ? 'var(--confidence-very-high)'
    : stats.winPct >= 50 ? 'var(--primary)'
    : 'var(--upset)';

  statsRow.appendChild(makeChip(
    stats.decided > 0 ? `${stats.correct}-${stats.incorrect}` : '--',
    'IntelliPick Record',
    recordColor
  ));
  statsRow.appendChild(makeChip(
    stats.winPct !== null ? `${stats.winPct}%` : '--',
    'Win Rate',
    recordColor
  ));
  const upsetLabel = stats.upsetDecided > 0
    ? `${stats.upsetHits}/${stats.upsetDecided}`
    : stats.upsets > 0 ? `${stats.upsets} called` : '--';
  statsRow.appendChild(makeChip(upsetLabel, 'Intelliupsets', 'var(--upset)'));

  body.appendChild(statsRow);

  // Games to Watch
  const gamesSection = document.createElement('div');
  gamesSection.className = 'dashboard__section';

  const gamesTitle = document.createElement('div');
  gamesTitle.className = 'dashboard__section-title';
  gamesTitle.textContent = 'Games to Watch';
  gamesSection.appendChild(gamesTitle);

  const gamesGrid = document.createElement('div');
  gamesGrid.className = 'dashboard__games-grid';

  const interesting = getInterestingMatchups();
  if (interesting.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'dashboard__empty';
    empty.textContent = 'No upcoming games at the moment.';
    gamesGrid.appendChild(empty);
  } else {
    for (const m of interesting) {
      gamesGrid.appendChild(createMatchupCard(m));
    }
  }

  gamesSection.appendChild(gamesGrid);
  body.appendChild(gamesSection);

  // Intelliupsets section
  const upsets = getUpsetAlerts();
  if (upsets.length > 0) {
    const upsetSection = document.createElement('div');
    upsetSection.className = 'dashboard__section';

    const upsetTitle = document.createElement('div');
    upsetTitle.className = 'dashboard__section-title';
    upsetTitle.textContent = `Intelliupsets (${upsets.length})`;
    upsetSection.appendChild(upsetTitle);

    const upsetList = document.createElement('div');
    upsetList.className = 'dashboard__upset-list';

    for (const u of upsets) {
      const row = document.createElement('div');
      row.className = 'dashboard__upset-row';

      const teams = document.createElement('div');
      teams.className = 'dashboard__upset-row__teams';
      teams.innerHTML = `<strong>${u.team.seed}</strong> ${u.team.name} over <strong>${u.opponent.seed}</strong> ${u.opponent.name}`;
      row.appendChild(teams);

      // Round label
      const roundSpan = document.createElement('span');
      roundSpan.className = 'dashboard__upset-row__round';
      roundSpan.textContent = u.round === 'First Round' ? 'R64' : u.round === 'Second Round' ? 'R32' : u.round;
      row.appendChild(roundSpan);

      // Confidence
      const conf = document.createElement('span');
      conf.className = 'dashboard__upset-row__conf';
      conf.textContent = `${u.confidencePercentage}%`;
      row.appendChild(conf);

      // Outcome if final
      const matchup = getR64Matchup(u.matchupId);
      const score = getScoreForMatchup(u.matchupId);
      if (score && score.status === 'final' && matchup) {
        const isTeam1 = u.team.id === matchup.team1?.id;
        const uScore = isTeam1 ? score.team1Score : score.team2Score;
        const oScore = isTeam1 ? score.team2Score : score.team1Score;
        const hit = uScore > oScore;
        const outcome = document.createElement('span');
        outcome.className = `dashboard__upset-row__outcome dashboard__upset-row__outcome--${hit ? 'hit' : 'miss'}`;
        outcome.textContent = hit ? '\u2713' : '\u2717';
        outcome.title = hit ? 'Upset hit!' : 'Upset missed';
        row.appendChild(outcome);
      }

      upsetList.appendChild(row);
    }

    upsetSection.appendChild(upsetList);
    body.appendChild(upsetSection);
  }

  overlay.appendChild(body);
  document.body.appendChild(overlay);

  // Trigger fade-in after paint
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      overlay.classList.add('dashboard-overlay--visible');
    });
  });
}
