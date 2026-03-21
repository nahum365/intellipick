import { buildTooltipContent } from './tooltip.js';

let overlayEl = null;
let sheetEl = null;
let touchStartY = 0;

function ensureElements() {
  if (overlayEl) return;

  overlayEl = document.createElement('div');
  overlayEl.className = 'bottom-sheet-overlay';
  overlayEl.addEventListener('click', () => closeBottomSheet());

  sheetEl = document.createElement('div');
  sheetEl.className = 'bottom-sheet';

  const handle = document.createElement('div');
  handle.className = 'bottom-sheet__handle';
  sheetEl.appendChild(handle);

  const content = document.createElement('div');
  content.className = 'bottom-sheet__content';
  sheetEl.appendChild(content);

  // Swipe-to-dismiss
  sheetEl.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  sheetEl.addEventListener('touchmove', (e) => {
    const dy = e.touches[0].clientY - touchStartY;
    // If swiping down and sheet is scrolled to top, allow dismiss gesture
    if (dy > 0 && sheetEl.scrollTop <= 0) {
      sheetEl.style.transform = `translateY(${dy}px)`;
    }
  }, { passive: true });

  sheetEl.addEventListener('touchend', (e) => {
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (dy > 80 && sheetEl.scrollTop <= 0) {
      closeBottomSheet();
    } else {
      sheetEl.style.transform = '';
    }
  });

  document.body.appendChild(overlayEl);
  document.body.appendChild(sheetEl);
}

export function openBottomSheet(team, profile, matchup) {
  ensureElements();

  const content = sheetEl.querySelector('.bottom-sheet__content');
  content.innerHTML = buildTooltipContent(team, profile, matchup);

  // Show with animation
  requestAnimationFrame(() => {
    overlayEl.classList.add('bottom-sheet-overlay--visible');
    sheetEl.classList.add('bottom-sheet--visible');
    sheetEl.style.transform = '';
    document.body.classList.add('body-locked');
  });
}

export function closeBottomSheet() {
  if (!sheetEl) return;

  sheetEl.classList.remove('bottom-sheet--visible');
  overlayEl.classList.remove('bottom-sheet-overlay--visible');
  document.body.classList.remove('body-locked');

  // Clear content after animation
  setTimeout(() => {
    const content = sheetEl.querySelector('.bottom-sheet__content');
    if (content) content.innerHTML = '';
  }, 300);
}
