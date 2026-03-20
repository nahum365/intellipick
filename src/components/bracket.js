import { createRegion } from './region.js';
import { createFinalFour } from './finalFour.js';

const REGIONS = [
  { name: 'East', dir: 'ltr' },
  { name: 'South', dir: 'ltr' },
  { name: 'West', dir: 'rtl' },
  { name: 'Midwest', dir: 'rtl' },
];

export function createBracket(onPickMade) {
  const wrapper = document.createElement('div');
  wrapper.className = 'bracket-wrapper';

  const bracket = document.createElement('div');
  bracket.className = 'bracket';

  for (const r of REGIONS) {
    const regionEl = createRegion(r.name, r.dir, onPickMade);
    regionEl.dataset.region = r.name;
    bracket.appendChild(regionEl);

    // Insert Final Four center after East (grid position handled by CSS)
    if (r.name === 'East') {
      bracket.appendChild(createFinalFour(onPickMade));
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
