import { getRegionR64Matchups, getR64Matchup, getGeneratedMatchup } from '../engine/propagation.js';
import { createMatchupCard } from './matchup.js';

const ROUND_NAMES = ['Round of 64', 'Round of 32', 'Sweet 16', 'Elite Eight'];

function laterRoundId(region, round, position) {
  return `${region.toLowerCase()}-r${round}-${position}`;
}

export function createRegion(regionName, direction) {
  const container = document.createElement('div');
  container.className = 'bracket__region bracket__region--' + regionName.toLowerCase();

  const region = document.createElement('div');
  region.className = 'region';

  const header = document.createElement('div');
  header.className = 'region__header';
  header.textContent = regionName + ' Region';
  region.appendChild(header);

  const rounds = document.createElement('div');
  rounds.className = 'region__rounds' + (direction === 'rtl' ? ' region__rounds--rtl' : '');

  // R64: 8 matchups
  const r64Ids = getRegionR64Matchups(regionName);

  // Round columns: R64 (8), R32 (4), S16 (2), E8 (1)
  const roundConfigs = [
    { name: 'R64', count: 8, getMatchup: (i) => getR64Matchup(r64Ids[i]) },
    { name: 'R32', count: 4, getMatchup: (i) => getGeneratedMatchup(laterRoundId(regionName, 2, i)) },
    { name: 'S16', count: 2, getMatchup: (i) => getGeneratedMatchup(laterRoundId(regionName, 3, i)) },
    { name: 'E8', count: 1, getMatchup: (i) => getGeneratedMatchup(laterRoundId(regionName, 4, i)) },
  ];

  for (const rc of roundConfigs) {
    const roundCol = document.createElement('div');
    roundCol.className = 'round';

    const roundHeader = document.createElement('div');
    roundHeader.className = 'round__header';
    roundHeader.textContent = rc.name;
    roundCol.appendChild(roundHeader);

    const matchups = document.createElement('div');
    matchups.className = 'round__matchups';

    for (let i = 0; i < rc.count; i++) {
      const matchup = rc.getMatchup(i);
      if (matchup) {
        matchups.appendChild(createMatchupCard(matchup));
      }
    }

    roundCol.appendChild(matchups);
    rounds.appendChild(roundCol);
  }

  region.appendChild(rounds);
  container.appendChild(region);
  return container;
}
