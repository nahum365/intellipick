const STORAGE_KEY = 'intellipick-picks';

let picks = {};
let listeners = [];

export function loadPicks(validIds) {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) picks = JSON.parse(saved);
  } catch { /* ignore */ }
  // Clean up stale keys (e.g., canonical R32 IDs) if validIds provided
  if (validIds) {
    const validSet = new Set(validIds);
    let cleaned = false;
    for (const key of Object.keys(picks)) {
      if (!validSet.has(key)) {
        delete picks[key];
        cleaned = true;
      }
    }
    if (cleaned) savePicks();
  }
  return picks;
}

function savePicks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(picks));
  } catch { /* ignore */ }
}

export function getPick(matchupId) {
  return picks[matchupId] || null;
}

export function getAllPicks() {
  return { ...picks };
}

export function setPick(matchupId, team) {
  picks[matchupId] = team;
  savePicks();
  notifyListeners();
}

export function clearPick(matchupId) {
  delete picks[matchupId];
  savePicks();
  notifyListeners();
}

export function clearAllPicks() {
  picks = {};
  savePicks();
  notifyListeners();
}

export function onPicksChange(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}

function notifyListeners() {
  listeners.forEach(fn => fn(picks));
}
