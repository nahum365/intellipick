import './styles/main.css';
import './styles/bracket.css';
import './styles/matchup.css';
import './styles/tooltip.css';
import './styles/modal.css';

import { loadPicks, onPicksChange, clearAllPicks, setPick } from './engine/picks.js';
import { getSmartFillPicks } from './engine/scoring.js';
import { cascadePick, getValidBracketIds } from './engine/propagation.js';
import { copyBracketToClipboard, downloadBracketText } from './components/exportBracket.js';
import { createBracket } from './components/bracket.js';
import { createScorePanel, updateScorePanel } from './components/scorePanel.js';
import { createInsightsBar, updateInsightsBar } from './components/insightsBar.js';
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

  const exportBtn = document.createElement('button');
  exportBtn.className = 'btn btn--secondary';
  exportBtn.textContent = 'Export';
  exportBtn.addEventListener('click', () => {
    // Show a small dropdown with copy/download options
    const existing = document.querySelector('.export-dropdown');
    if (existing) { existing.remove(); return; }

    const dropdown = document.createElement('div');
    dropdown.className = 'export-dropdown';
    dropdown.style.cssText = 'position:absolute;top:100%;right:0;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:100;display:flex;flex-direction:column;gap:4px;min-width:160px';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn--primary';
    copyBtn.style.cssText = 'font-size:12px;padding:6px 12px;width:100%';
    copyBtn.textContent = 'Copy to Clipboard';
    copyBtn.addEventListener('click', () => {
      copyBracketToClipboard().then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => dropdown.remove(), 1000);
      });
    });

    const dlBtn = document.createElement('button');
    dlBtn.className = 'btn';
    dlBtn.style.cssText = 'font-size:12px;padding:6px 12px;width:100%;background:var(--bg-secondary);color:var(--text);border:1px solid var(--border)';
    dlBtn.textContent = 'Download .txt';
    dlBtn.addEventListener('click', () => {
      downloadBracketText();
      dropdown.remove();
    });

    dropdown.appendChild(copyBtn);
    dropdown.appendChild(dlBtn);

    // Position relative to export button
    exportBtn.style.position = 'relative';
    exportBtn.appendChild(dropdown);

    // Close on outside click
    const close = (e) => {
      if (!dropdown.contains(e.target) && e.target !== exportBtn) {
        dropdown.remove();
        document.removeEventListener('click', close);
      }
    };
    setTimeout(() => document.addEventListener('click', close), 0);
  });
  controls.appendChild(exportBtn);

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

  // Score panel (on mobile renders as a sticky shelf below header)
  scorePanelEl = createScorePanel(() => rerender());

  // Main content
  const main = document.createElement('div');
  main.className = 'main-content';

  // Bracket
  bracketContainerEl = document.createElement('div');
  bracketContainerEl.className = 'bracket-container';
  const bracket = createBracket(() => rerender());
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
