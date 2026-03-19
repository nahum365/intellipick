import { createRegion } from './region.js';
import { createFinalFour } from './finalFour.js';

export function createBracket(onPickMade) {
  const bracket = document.createElement('div');
  bracket.className = 'bracket';

  // East (top-left, L→R)
  bracket.appendChild(createRegion('East', 'ltr', onPickMade));

  // Center (Final Four)
  bracket.appendChild(createFinalFour(onPickMade));

  // West (top-right, R→L)
  bracket.appendChild(createRegion('West', 'rtl', onPickMade));

  // South (bottom-left, L→R)
  bracket.appendChild(createRegion('South', 'ltr', onPickMade));

  // Empty center spacer for bottom row
  const spacer = document.createElement('div');
  spacer.style.gridColumn = '2';
  spacer.style.gridRow = '2';
  bracket.appendChild(spacer);

  // Midwest (bottom-right, R→L)
  bracket.appendChild(createRegion('Midwest', 'rtl', onPickMade));

  return bracket;
}
