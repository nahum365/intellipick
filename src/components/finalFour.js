import { getGeneratedMatchup } from '../engine/propagation.js';
import { getPick } from '../engine/picks.js';
import { createMatchupCard } from './matchup.js';

export function createFinalFour(onPickMade) {
  const container = document.createElement('div');
  container.className = 'bracket__center';

  const ff = document.createElement('div');
  ff.className = 'final-four';

  const title = document.createElement('div');
  title.className = 'final-four__title';
  title.textContent = 'Final Four';
  ff.appendChild(title);

  const semis = document.createElement('div');
  semis.className = 'final-four__semis';

  // Semi 1: East vs South
  const semi1Label = document.createElement('div');
  semi1Label.className = 'final-four__label';
  semi1Label.textContent = 'East vs South';
  semis.appendChild(semi1Label);
  const semi1 = getGeneratedMatchup('ff-0');
  semis.appendChild(createMatchupCard(semi1, onPickMade));

  // Semi 2: West vs Midwest
  const semi2Label = document.createElement('div');
  semi2Label.className = 'final-four__label';
  semi2Label.textContent = 'West vs Midwest';
  semis.appendChild(semi2Label);
  const semi2 = getGeneratedMatchup('ff-1');
  semis.appendChild(createMatchupCard(semi2, onPickMade));

  ff.appendChild(semis);

  // Championship
  const champSection = document.createElement('div');
  champSection.className = 'final-four__championship';

  const champLabel = document.createElement('div');
  champLabel.className = 'final-four__champion-label';
  champLabel.textContent = 'Championship';
  champSection.appendChild(champLabel);

  const champMatchup = getGeneratedMatchup('championship');
  champSection.appendChild(createMatchupCard(champMatchup, onPickMade));

  // Champion display
  const championPick = getPick('championship');
  const championDisplay = document.createElement('div');
  if (championPick) {
    championDisplay.className = 'final-four__champion';
    championDisplay.textContent = `\uD83C\uDFC6 ${championPick.name}`;
  } else {
    championDisplay.className = 'final-four__champion final-four__champion--empty';
    championDisplay.textContent = 'Pick your champion';
  }
  champSection.appendChild(championDisplay);

  ff.appendChild(champSection);
  container.appendChild(ff);
  return container;
}
