import { createRegion } from './region.js';
import { createFinalFour } from './finalFour.js';

// Track active mobile tab across re-renders
let activeMobileTab = 'East';

const REGIONS = [
  { name: 'East', dir: 'ltr' },
  { name: 'South', dir: 'ltr' },
  { name: 'West', dir: 'rtl' },
  { name: 'Midwest', dir: 'rtl' },
];

export function createBracket(onPickMade) {
  const wrapper = document.createElement('div');
  wrapper.className = 'bracket-wrapper';

  // Mobile tab bar
  const tabBar = document.createElement('div');
  tabBar.className = 'bracket-tabs';
  const regionNames = [...REGIONS.map(r => r.name), 'Final Four'];
  for (const name of regionNames) {
    const tab = document.createElement('button');
    tab.className = 'bracket-tabs__tab' + (name === activeMobileTab ? ' bracket-tabs__tab--active' : '');
    tab.textContent = name === 'Final Four' ? 'F4' : name;
    tab.dataset.region = name;
    tab.addEventListener('click', () => {
      activeMobileTab = name;
      // Update tab active states
      tabBar.querySelectorAll('.bracket-tabs__tab').forEach(t => {
        t.classList.toggle('bracket-tabs__tab--active', t.dataset.region === name);
      });
      // Show/hide region panels
      wrapper.querySelectorAll('.bracket__region, .bracket__center').forEach(el => {
        const isFF = el.classList.contains('bracket__center');
        const regionKey = isFF ? 'Final Four' : el.dataset.region;
        el.classList.toggle('bracket-region--hidden', regionKey !== name);
      });
    });
    tabBar.appendChild(tab);
  }
  wrapper.appendChild(tabBar);

  // Desktop bracket grid
  const bracket = document.createElement('div');
  bracket.className = 'bracket';

  // Build all regions
  for (const r of REGIONS) {
    const regionEl = createRegion(r.name, r.dir, onPickMade);
    regionEl.dataset.region = r.name;
    // On mobile, hide non-active regions
    if (r.name !== activeMobileTab) regionEl.classList.add('bracket-region--hidden');
    bracket.appendChild(regionEl);

    // Insert Final Four center after East (grid position handled by CSS)
    if (r.name === 'East') {
      const ff = createFinalFour(onPickMade);
      if (activeMobileTab !== 'Final Four') ff.classList.add('bracket-region--hidden');
      bracket.appendChild(ff);
    }
  }

  // Empty center spacer for bottom row (desktop grid)
  const spacer = document.createElement('div');
  spacer.className = 'bracket__spacer';
  spacer.style.gridColumn = '2';
  spacer.style.gridRow = '2';
  bracket.appendChild(spacer);

  wrapper.appendChild(bracket);
  return wrapper;
}
