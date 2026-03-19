import './styles/main.css';
import './styles/bracket.css';
import './styles/matchup.css';
import './styles/tooltip.css';
import './styles/modal.css';

import { loadPicks, onPicksChange, clearAllPicks, setPick } from './engine/picks.js';
import { getSmartFillPicks } from './engine/scoring.js';
import { cascadePick } from './engine/propagation.js';
import { createBracket } from './components/bracket.js';
import { createScorePanel, updateScorePanel } from './components/scorePanel.js';
import { createInsightsBar, updateInsightsBar } from './components/insightsBar.js';
const app = document.getElementById('app');

// Load saved picks
loadPicks();

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

  const controls = document.createElement('div');
  controls.className = 'header__controls';

  const smartFillBtn = document.createElement('button');
  smartFillBtn.className = 'btn btn--primary';
  smartFillBtn.textContent = 'Smart Fill';
  smartFillBtn.addEventListener('click', () => {
    const fills = getSmartFillPicks();
    for (const [id, team] of Object.entries(fills)) {
      cascadePick(id, team);
    }
    rerender();
  });
  controls.appendChild(smartFillBtn);

  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn btn--danger';
  resetBtn.textContent = 'Reset';
  resetBtn.addEventListener('click', () => {
    if (confirm('Clear all picks?')) {
      clearAllPicks();
      rerender();
    }
  });
  controls.appendChild(resetBtn);

  header.appendChild(controls);
  app.appendChild(header);

  // Main content
  const main = document.createElement('div');
  main.className = 'main-content';

  // Bracket
  bracketContainerEl = document.createElement('div');
  bracketContainerEl.className = 'bracket-container';
  const bracket = createBracket(() => rerender());
  bracketContainerEl.appendChild(bracket);
  main.appendChild(bracketContainerEl);

  // Score panel
  scorePanelEl = createScorePanel(() => rerender());
  main.appendChild(scorePanelEl);

  app.appendChild(main);

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
