import './styles/main.css';
import './styles/bracket.css';
import './styles/matchup.css';
import './styles/tooltip.css';
import './styles/modal.css';
import './styles/mobile.css';
import './styles/dashboard.css';

import { createBracket } from './components/bracket.js';
import { createScorePanel } from './components/scorePanel.js';
import { createInsightsBar, updateInsightsBar } from './components/insightsBar.js';
import { createMatchupCard } from './components/matchup.js';
import { getRegionR64Matchups, getR64Matchup, getGeneratedMatchup, REGIONS } from './engine/propagation.js';
import { startPolling, onScoresUpdate, getScoreForMatchup } from './engine/liveScores.js';
import { closeModal } from './components/modal.js';
import { getMarketData } from './engine/polymarket.js';
import { showDashboard } from './components/dashboard.js';
const app = document.getElementById('app');

let scorePanelEl = null;
let insightsBarEl = null;
let bracketContainerEl = null;
let mobileRoundsEl = null;
let selectedRound = 'R64';
let userHasSelectedRound = false;

const ROUND_TABS = [
  { key: 'R64', label: 'R64' },
  { key: 'R32', label: 'R32' },
  { key: 'S16', label: 'S16' },
  { key: 'E8', label: 'E8' },
  { key: 'F4', label: 'F4' },
  { key: 'CHAMP', label: 'Final' },
];

function laterRoundId(region, round, position) {
  return `${region.toLowerCase()}-r${round}-${position}`;
}

function getActiveRound() {
  const roundOrder = ['R64', 'R32', 'S16', 'E8', 'F4', 'CHAMP'];

  // 1. Find earliest round with any live/halftime game
  for (const round of roundOrder) {
    const matchups = getMobileMatchupsForRound(round).flatMap(g => g.items);
    if (matchups.some(m => {
      const score = getScoreForMatchup(m.id);
      return score && (score.status === 'live' || score.status === 'halftime');
    })) return round;
  }

  // 2. Find earliest round with any scheduled (not yet finished) game
  for (const round of roundOrder) {
    const matchups = getMobileMatchupsForRound(round).flatMap(g => g.items);
    if (matchups.length > 0 && matchups.some(m => {
      const score = getScoreForMatchup(m.id);
      return !score || score.status === 'scheduled';
    })) return round;
  }

  // 3. All done — return the latest round that has matchup data
  for (let i = roundOrder.length - 1; i >= 0; i--) {
    if (getMobileMatchupsForRound(roundOrder[i]).some(g => g.items.length > 0)) return roundOrder[i];
  }

  return 'R64';
}

function getMobileMatchupsForRound(roundKey) {
  const matchups = [];
  if (roundKey === 'R64') {
    for (const region of REGIONS) {
      const ids = getRegionR64Matchups(region);
      matchups.push({ region, items: ids.map(id => getR64Matchup(id)).filter(Boolean) });
    }
  } else if (roundKey === 'R32') {
    for (const region of REGIONS) {
      const items = [];
      for (let i = 0; i < 4; i++) items.push(getGeneratedMatchup(laterRoundId(region, 2, i)));
      matchups.push({ region, items: items.filter(Boolean) });
    }
  } else if (roundKey === 'S16') {
    for (const region of REGIONS) {
      const items = [];
      for (let i = 0; i < 2; i++) items.push(getGeneratedMatchup(laterRoundId(region, 3, i)));
      matchups.push({ region, items: items.filter(Boolean) });
    }
  } else if (roundKey === 'E8') {
    for (const region of REGIONS) {
      const item = getGeneratedMatchup(laterRoundId(region, 4, 0));
      if (item) matchups.push({ region, items: [item] });
    }
  } else if (roundKey === 'F4') {
    const semi1 = getGeneratedMatchup('ff-0');
    const semi2 = getGeneratedMatchup('ff-1');
    const items = [semi1, semi2].filter(Boolean);
    if (items.length) matchups.push({ region: 'Final Four', items });
  } else if (roundKey === 'CHAMP') {
    const champ = getGeneratedMatchup('championship');
    if (champ) matchups.push({ region: 'Championship', items: [champ] });
  }
  return matchups;
}

function renderMobileRounds() {
  if (!mobileRoundsEl) return;
  mobileRoundsEl.innerHTML = '';
  const groups = getMobileMatchupsForRound(selectedRound);
  for (const group of groups) {
    const header = document.createElement('div');
    header.className = 'mobile-rounds__region-header';
    header.textContent = group.region === 'Final Four' || group.region === 'Championship'
      ? group.region
      : group.region + ' Region';
    mobileRoundsEl.appendChild(header);
    for (const m of group.items) {
      mobileRoundsEl.appendChild(createMatchupCard(m));
    }
  }
}

function toggleDrawer() {
  app.classList.toggle('drawer-open');
  if (app.classList.contains('drawer-open')) {
    document.body.classList.add('body-locked');
  } else {
    document.body.classList.remove('body-locked');
  }
}

function closeDrawer() {
  app.classList.remove('drawer-open');
  document.body.classList.remove('body-locked');
}

function renderApp() {
  app.innerHTML = '';
  app.classList.remove('drawer-open');

  // Header
  const header = document.createElement('header');
  header.className = 'header';

  const logo = document.createElement('div');
  logo.className = 'header__logo';
  logo.innerHTML = 'Intelli<span>Pick</span>';
  logo.addEventListener('click', () => {
    if (window.innerWidth <= 768) closeModal();
  });
  header.appendChild(logo);

  // Hamburger button (visible only on mobile via CSS)
  const hamburger = document.createElement('button');
  hamburger.className = 'hamburger-btn';
  hamburger.innerHTML = '&#9776;';
  hamburger.title = 'Stats & Performance';
  hamburger.addEventListener('click', toggleDrawer);
  header.appendChild(hamburger);

  app.appendChild(header);

  // Round tabs (visible only on mobile via CSS)
  const tabsBar = document.createElement('div');
  tabsBar.className = 'round-tabs';
  for (const rt of ROUND_TABS) {
    const tab = document.createElement('button');
    tab.className = 'round-tab' + (rt.key === selectedRound ? ' round-tab--active' : '');
    tab.textContent = rt.label;
    tab.addEventListener('click', () => {
      userHasSelectedRound = true;
      selectedRound = rt.key;
      // Update active tab
      tabsBar.querySelectorAll('.round-tab').forEach(t => t.classList.remove('round-tab--active'));
      tab.classList.add('round-tab--active');
      renderMobileRounds();
    });
    tabsBar.appendChild(tab);
  }
  app.appendChild(tabsBar);

  // Score panel
  scorePanelEl = createScorePanel();

  // Drawer close button header (inside sidebar, mobile only)
  const drawerHeader = document.createElement('div');
  drawerHeader.className = 'drawer-close-btn';
  const drawerTitle = document.createElement('span');
  drawerTitle.className = 'drawer-close-btn__title';
  drawerTitle.textContent = 'IntelliPick Stats';
  drawerHeader.appendChild(drawerTitle);
  const drawerClose = document.createElement('button');
  drawerClose.className = 'drawer-close-btn__x';
  drawerClose.innerHTML = '&times;';
  drawerClose.addEventListener('click', closeDrawer);
  drawerHeader.appendChild(drawerClose);
  scorePanelEl.insertBefore(drawerHeader, scorePanelEl.firstChild);

  // Main content
  const main = document.createElement('div');
  main.className = 'main-content';

  // Desktop bracket
  bracketContainerEl = document.createElement('div');
  bracketContainerEl.className = 'bracket-container';
  const bracket = createBracket();
  bracketContainerEl.appendChild(bracket);
  main.appendChild(bracketContainerEl);

  // Mobile round list
  mobileRoundsEl = document.createElement('div');
  mobileRoundsEl.className = 'mobile-rounds';
  main.appendChild(mobileRoundsEl);
  renderMobileRounds();

  // Drawer overlay (mobile only)
  const drawerOverlay = document.createElement('div');
  drawerOverlay.className = 'drawer-overlay';
  drawerOverlay.addEventListener('click', closeDrawer);

  app.appendChild(main);
  app.appendChild(drawerOverlay);
  app.appendChild(scorePanelEl);

  // Insights bar
  insightsBarEl = createInsightsBar();
  app.appendChild(insightsBarEl);
}

function rerender() {
  // Auto-advance to the active round (unless user has manually chosen)
  if (!userHasSelectedRound) {
    selectedRound = getActiveRound();
  }

  // Save scroll positions before re-render
  const savedScrolls = {};
  if (bracketContainerEl) {
    savedScrolls.bracketX = bracketContainerEl.scrollLeft;
    savedScrolls.bracketY = bracketContainerEl.scrollTop;
  }
  const sidebar = document.querySelector('.score-sidebar');
  if (sidebar) {
    savedScrolls.sidebarY = sidebar.scrollTop;
  }
  const mainContent = document.querySelector('.main-content');
  if (mainContent) {
    savedScrolls.mainY = mainContent.scrollTop;
  }
  // Preserve selected round tab across re-renders (selectedRound is module-level)

  renderApp();

  // Restore scroll positions after re-render
  if (bracketContainerEl) {
    bracketContainerEl.scrollLeft = savedScrolls.bracketX || 0;
    bracketContainerEl.scrollTop = savedScrolls.bracketY || 0;
  }
  const newSidebar = document.querySelector('.score-sidebar');
  if (newSidebar) {
    newSidebar.scrollTop = savedScrolls.sidebarY || 0;
  }
  const newMain = document.querySelector('.main-content');
  if (newMain) {
    newMain.scrollTop = savedScrolls.mainY || 0;
  }
}

/**
 * Update only the Polymarket odds bar on specific matchup cards in-place.
 * No DOM teardown, no scroll loss.
 */
function updateOddsInPlace(matchupIds) {
  for (const mid of matchupIds) {
    const card = document.querySelector(`.matchup-card[data-matchup-id="${mid}"]`);
    if (!card) continue;

    const polyData = getMarketData(mid);
    // Find existing Polymarket odds bar (the one with source text "Polymarket")
    const oldBar = [...card.querySelectorAll('.matchup-card__odds-bar')]
      .find(bar => {
        const src = bar.querySelector('.matchup-card__odds-source');
        return src && src.textContent === 'Polymarket';
      });

    if (!polyData || !polyData.team1Prob || !polyData.team2Prob) {
      // No data — remove bar if it exists
      if (oldBar) oldBar.remove();
      continue;
    }

    // Build new odds bar content
    const recentTick = polyData.lastChangeTime && (Date.now() - polyData.lastChangeTime < 2000);
    const d1 = polyData.team1ProbDelta || 0;
    const d2 = polyData.team2ProbDelta || 0;
    const arrow1 = d1 > 0.005 ? '\u25B2' : d1 < -0.005 ? '\u25BC' : '';
    const arrow2 = d2 > 0.005 ? '\u25B2' : d2 < -0.005 ? '\u25BC' : '';

    if (oldBar) {
      // Update existing bar in-place
      const pcts = oldBar.querySelectorAll('.matchup-card__odds-pct');
      if (pcts.length >= 2) {
        const newText1 = Math.round(polyData.team1Prob * 100) + '%' + (arrow1 ? ' ' + arrow1 : '');
        const newText2 = Math.round(polyData.team2Prob * 100) + '%' + (arrow2 ? ' ' + arrow2 : '');
        pcts[0].textContent = newText1;
        pcts[1].textContent = newText2;

        // Update classes
        const cls1 = d1 > 0.005 ? ' matchup-card__odds-pct--up' : d1 < -0.005 ? ' matchup-card__odds-pct--down' : '';
        pcts[0].className = 'matchup-card__odds-pct' + cls1;
        pcts[1].className = 'matchup-card__odds-pct' + (d2 > 0.005 ? ' matchup-card__odds-pct--up' : d2 < -0.005 ? ' matchup-card__odds-pct--down' : '');

        // Tick flash
        if (recentTick && Math.abs(d1) > 0.001) {
          pcts[0].classList.remove('tick-up', 'tick-down');
          void pcts[0].offsetWidth; // force reflow for re-animation
          pcts[0].classList.add(d1 > 0 ? 'tick-up' : 'tick-down');
        }
        if (recentTick && Math.abs(d2) > 0.001) {
          pcts[1].classList.remove('tick-up', 'tick-down');
          void pcts[1].offsetWidth;
          pcts[1].classList.add(d2 > 0 ? 'tick-up' : 'tick-down');
        }
      }

      // Update live class
      if (polyData.live) oldBar.classList.add('matchup-card__odds-bar--live');
      else oldBar.classList.remove('matchup-card__odds-bar--live');
    }
    // If no existing bar, we skip — it'll appear on next full re-render
  }
}

/**
 * Update only the status boxes in the sidebar without rebuilding everything.
 */
function updateStatusOnly() {
  if (insightsBarEl) {
    updateInsightsBar(insightsBarEl);
  }
}

// Initial render
renderApp();

// Show dashboard on first visit (skipped if already dismissed this session)
showDashboard();

// Start live score polling
startPolling();
onScoresUpdate((detail) => {
  if (detail && detail.type === 'odds' && detail.matchupIds) {
    // Polymarket odds change — targeted in-place update, no re-render
    updateOddsInPlace(detail.matchupIds);
    return;
  }
  if (detail && detail.type === 'status') {
    // Status-only update (gamma loading state change) — just update sidebar
    updateStatusOnly();
    return;
  }
  // ESPN score update or polymarket init/refresh — full re-render
  rerender();
});
