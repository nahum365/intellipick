import './styles/main.css';
import './styles/bracket.css';
import './styles/matchup.css';
import './styles/tooltip.css';
import './styles/modal.css';

import { createBracket } from './components/bracket.js';
import { createScorePanel, updateScorePanel } from './components/scorePanel.js';
import { createInsightsBar } from './components/insightsBar.js';
import { startPolling, onScoresUpdate } from './engine/liveScores.js';
import { getMarketData } from './engine/polymarket.js';
const app = document.getElementById('app');

let scorePanelEl = null;
let insightsBarEl = null;
let bracketContainerEl = null;

function renderApp() {
  app.innerHTML = '';

  // Header
  const header = document.createElement('header');
  header.className = 'header';

  const logo = document.createElement('div');
  logo.className = 'header__logo';
  logo.innerHTML = 'Intelli<span>Pick</span>';
  header.appendChild(logo);

  app.appendChild(header);

  // Score panel
  scorePanelEl = createScorePanel();

  // Main content
  const main = document.createElement('div');
  main.className = 'main-content';

  // Bracket
  bracketContainerEl = document.createElement('div');
  bracketContainerEl.className = 'bracket-container';
  const bracket = createBracket();
  bracketContainerEl.appendChild(bracket);
  main.appendChild(bracketContainerEl);

  // Desktop: sidebar is in right column via CSS grid
  // Mobile: sidebar renders as bottom sheet (order:10 in CSS)
  app.appendChild(main);
  app.appendChild(scorePanelEl);

  // Insights bar
  insightsBarEl = createInsightsBar();
  app.appendChild(insightsBarEl);
}

function rerender() {
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
  if (scorePanelEl) {
    updateScorePanel(scorePanelEl);
  }
}

// Initial render
renderApp();

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
