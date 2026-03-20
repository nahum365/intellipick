import './styles/main.css';
import './styles/bracket.css';
import './styles/matchup.css';
import './styles/tooltip.css';
import './styles/modal.css';

import { loadPicks } from './engine/picks.js';
import { getValidBracketIds } from './engine/propagation.js';
import { createBracket } from './components/bracket.js';
import { createScorePanel } from './components/scorePanel.js';
import { createInsightsBar } from './components/insightsBar.js';
import { startPolling, onScoresUpdate } from './engine/liveScores.js';
const app = document.getElementById('app');

// Load saved picks (clean up stale canonical IDs)
loadPicks(getValidBracketIds());

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
  scorePanelEl = createScorePanel(() => rerender());

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

// Initial render
renderApp();

// Start live score polling
startPolling();
onScoresUpdate(() => rerender());
