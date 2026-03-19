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
import { createFilters } from './components/filters.js';

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

  // Filters
  const filters = createFilters((region) => {
    const regions = bracketContainerEl.querySelectorAll('.bracket__region');
    const center = bracketContainerEl.querySelector('.bracket__center');
    regions.forEach(r => {
      if (!region) {
        r.style.display = '';
      } else {
        const isMatch = r.classList.contains('bracket__region--' + region.toLowerCase());
        r.style.display = isMatch ? '' : 'none';
      }
    });
    if (center) center.style.display = region ? 'none' : '';
    // Also handle the spacer
    const spacer = bracketContainerEl.querySelector('[style*="grid-column: 2"]');
    if (spacer) spacer.style.display = region ? 'none' : '';
  });
  app.appendChild(filters);

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
  scorePanelEl = createScorePanel();
  main.appendChild(scorePanelEl);

  app.appendChild(main);

  // Insights bar
  insightsBarEl = createInsightsBar();
  app.appendChild(insightsBarEl);
}

function rerender() {
  renderApp();
}

// Initial render
renderApp();
