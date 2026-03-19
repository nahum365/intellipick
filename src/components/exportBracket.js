import { getAllPicks } from '../engine/picks.js';
import { getRegionR64Matchups, getR64Matchup, getGeneratedMatchup, REGIONS } from '../engine/propagation.js';

function laterRoundId(region, round, position) {
  return `${region.toLowerCase()}-r${round}-${position}`;
}

function teamLabel(team) {
  if (!team) return '???';
  return `(${team.seed}) ${team.name}`;
}

// Build structured bracket text for easy ESPN entry
export function generateBracketText() {
  const picks = getAllPicks();
  const lines = [];

  lines.push('INTELLIPICK BRACKET EXPORT');
  lines.push('='.repeat(50));
  lines.push('');

  for (const region of REGIONS) {
    lines.push(`${region.toUpperCase()} REGION`);
    lines.push('-'.repeat(40));

    const r64Ids = getRegionR64Matchups(region);

    // R64 -> R32 (show matchups and winners)
    lines.push('  Round of 64:');
    for (let i = 0; i < 8; i++) {
      const m = getR64Matchup(r64Ids[i]);
      if (!m) continue;
      const winner = picks[r64Ids[i]];
      const marker = winner ? ` → ${teamLabel(winner)}` : '';
      lines.push(`    ${teamLabel(m.team1)} vs ${teamLabel(m.team2)}${marker}`);
    }

    // R32
    lines.push('  Round of 32:');
    for (let i = 0; i < 4; i++) {
      const id = laterRoundId(region, 2, i);
      const gen = getGeneratedMatchup(id);
      const winner = picks[id];
      const t1 = gen && gen.team1 ? teamLabel(gen.team1) : 'TBD';
      const t2 = gen && gen.team2 ? teamLabel(gen.team2) : 'TBD';
      const marker = winner ? ` → ${teamLabel(winner)}` : '';
      lines.push(`    ${t1} vs ${t2}${marker}`);
    }

    // S16
    lines.push('  Sweet 16:');
    for (let i = 0; i < 2; i++) {
      const id = laterRoundId(region, 3, i);
      const gen = getGeneratedMatchup(id);
      const winner = picks[id];
      const t1 = gen && gen.team1 ? teamLabel(gen.team1) : 'TBD';
      const t2 = gen && gen.team2 ? teamLabel(gen.team2) : 'TBD';
      const marker = winner ? ` → ${teamLabel(winner)}` : '';
      lines.push(`    ${t1} vs ${t2}${marker}`);
    }

    // E8
    lines.push('  Elite Eight:');
    const e8Id = laterRoundId(region, 4, 0);
    const e8 = getGeneratedMatchup(e8Id);
    const e8Winner = picks[e8Id];
    const e8t1 = e8 && e8.team1 ? teamLabel(e8.team1) : 'TBD';
    const e8t2 = e8 && e8.team2 ? teamLabel(e8.team2) : 'TBD';
    const e8Marker = e8Winner ? ` → ${teamLabel(e8Winner)}` : '';
    lines.push(`    ${e8t1} vs ${e8t2}${e8Marker}`);

    lines.push('');
  }

  // Final Four
  lines.push('FINAL FOUR');
  lines.push('-'.repeat(40));

  for (let i = 0; i < 2; i++) {
    const id = `ff-${i}`;
    const gen = getGeneratedMatchup(id);
    const winner = picks[id];
    const t1 = gen && gen.team1 ? teamLabel(gen.team1) : 'TBD';
    const t2 = gen && gen.team2 ? teamLabel(gen.team2) : 'TBD';
    const marker = winner ? ` → ${teamLabel(winner)}` : '';
    lines.push(`  ${t1} vs ${t2}${marker}`);
  }

  lines.push('');
  lines.push('CHAMPIONSHIP');
  lines.push('-'.repeat(40));
  const champGen = getGeneratedMatchup('championship');
  const champWinner = picks['championship'];
  const ct1 = champGen && champGen.team1 ? teamLabel(champGen.team1) : 'TBD';
  const ct2 = champGen && champGen.team2 ? teamLabel(champGen.team2) : 'TBD';
  const champMarker = champWinner ? ` → ${teamLabel(champWinner)}` : '';
  lines.push(`  ${ct1} vs ${ct2}${champMarker}`);

  if (champWinner) {
    lines.push('');
    lines.push(`CHAMPION: ${teamLabel(champWinner)}`);
  }

  lines.push('');
  lines.push('='.repeat(50));

  // Quick pick list for fast ESPN entry
  lines.push('');
  lines.push('QUICK PICK LIST (for ESPN entry)');
  lines.push('='.repeat(50));

  for (const region of REGIONS) {
    lines.push(`\n${region.toUpperCase()} REGION:`);
    const r64Ids = getRegionR64Matchups(region);

    const roundLabels = ['R64', 'R32', 'S16', 'E8'];
    const roundIds = [
      r64Ids,
      Array.from({ length: 4 }, (_, i) => laterRoundId(region, 2, i)),
      Array.from({ length: 2 }, (_, i) => laterRoundId(region, 3, i)),
      [laterRoundId(region, 4, 0)],
    ];

    for (let r = 0; r < roundLabels.length; r++) {
      const winners = roundIds[r].map(id => picks[id]).filter(Boolean);
      if (winners.length > 0) {
        lines.push(`  ${roundLabels[r]}: ${winners.map(w => `${w.name} (${w.seed})`).join(', ')}`);
      }
    }
  }

  const ff0 = picks['ff-0'];
  const ff1 = picks['ff-1'];
  if (ff0 || ff1) {
    lines.push(`\nFINAL FOUR: ${[ff0, ff1].filter(Boolean).map(w => `${w.name} (${w.seed})`).join(', ')}`);
  }
  if (champWinner) {
    lines.push(`CHAMPION: ${champWinner.name} (${champWinner.seed})`);
  }

  return lines.join('\n');
}

// Copy bracket to clipboard
export function copyBracketToClipboard() {
  const text = generateBracketText();
  return navigator.clipboard.writeText(text).then(() => true).catch(() => {
    // Fallback: create a textarea and copy
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  });
}

// Download bracket as text file
export function downloadBracketText() {
  const text = generateBracketText();
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'intellipick-bracket.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
