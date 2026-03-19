import { getAllPicks } from '../engine/picks.js';
import { getRegionR64Matchups, getR64Matchup, getGeneratedMatchup, REGIONS } from '../engine/propagation.js';

function laterRoundId(region, round, position) {
  return `${region.toLowerCase()}-r${round}-${position}`;
}

function teamLabel(team) {
  if (!team) return 'TBD';
  return `(${team.seed}) ${team.name}`;
}

function padRight(str, len) {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

// Build structured bracket text as a table
export function generateBracketText() {
  const picks = getAllPicks();
  const rows = []; // { matchup, pick }

  for (const region of REGIONS) {
    rows.push({ section: `${region.toUpperCase()} REGION` });

    const r64Ids = getRegionR64Matchups(region);

    // R64
    rows.push({ subsection: 'Round of 64' });
    for (let i = 0; i < 8; i++) {
      const m = getR64Matchup(r64Ids[i]);
      if (!m) continue;
      const winner = picks[r64Ids[i]];
      rows.push({
        matchup: `${teamLabel(m.team1)} vs ${teamLabel(m.team2)}`,
        pick: winner ? teamLabel(winner) : '--',
      });
    }

    // R32
    rows.push({ subsection: 'Round of 32' });
    for (let i = 0; i < 4; i++) {
      const id = laterRoundId(region, 2, i);
      const gen = getGeneratedMatchup(id);
      const winner = picks[id];
      const t1 = gen && gen.team1 ? teamLabel(gen.team1) : 'TBD';
      const t2 = gen && gen.team2 ? teamLabel(gen.team2) : 'TBD';
      rows.push({
        matchup: `${t1} vs ${t2}`,
        pick: winner ? teamLabel(winner) : '--',
      });
    }

    // S16
    rows.push({ subsection: 'Sweet 16' });
    for (let i = 0; i < 2; i++) {
      const id = laterRoundId(region, 3, i);
      const gen = getGeneratedMatchup(id);
      const winner = picks[id];
      const t1 = gen && gen.team1 ? teamLabel(gen.team1) : 'TBD';
      const t2 = gen && gen.team2 ? teamLabel(gen.team2) : 'TBD';
      rows.push({
        matchup: `${t1} vs ${t2}`,
        pick: winner ? teamLabel(winner) : '--',
      });
    }

    // E8
    rows.push({ subsection: 'Elite Eight' });
    const e8Id = laterRoundId(region, 4, 0);
    const e8 = getGeneratedMatchup(e8Id);
    const e8Winner = picks[e8Id];
    const e8t1 = e8 && e8.team1 ? teamLabel(e8.team1) : 'TBD';
    const e8t2 = e8 && e8.team2 ? teamLabel(e8.team2) : 'TBD';
    rows.push({
      matchup: `${e8t1} vs ${e8t2}`,
      pick: e8Winner ? teamLabel(e8Winner) : '--',
    });

    rows.push({ blank: true });
  }

  // Final Four
  rows.push({ section: 'FINAL FOUR' });
  for (let i = 0; i < 2; i++) {
    const id = `ff-${i}`;
    const gen = getGeneratedMatchup(id);
    const winner = picks[id];
    const t1 = gen && gen.team1 ? teamLabel(gen.team1) : 'TBD';
    const t2 = gen && gen.team2 ? teamLabel(gen.team2) : 'TBD';
    rows.push({
      matchup: `${t1} vs ${t2}`,
      pick: winner ? teamLabel(winner) : '--',
    });
  }

  rows.push({ blank: true });

  // Championship
  rows.push({ section: 'CHAMPIONSHIP' });
  const champGen = getGeneratedMatchup('championship');
  const champWinner = picks['championship'];
  const ct1 = champGen && champGen.team1 ? teamLabel(champGen.team1) : 'TBD';
  const ct2 = champGen && champGen.team2 ? teamLabel(champGen.team2) : 'TBD';
  rows.push({
    matchup: `${ct1} vs ${ct2}`,
    pick: champWinner ? teamLabel(champWinner) : '--',
  });

  if (champWinner) {
    rows.push({ blank: true });
    rows.push({ section: `CHAMPION: ${teamLabel(champWinner)}` });
  }

  // Compute column widths
  let matchupWidth = 'Matchup'.length;
  let pickWidth = 'Pick'.length;
  for (const r of rows) {
    if (r.matchup) matchupWidth = Math.max(matchupWidth, r.matchup.length);
    if (r.pick) pickWidth = Math.max(pickWidth, r.pick.length);
  }

  const totalWidth = matchupWidth + pickWidth + 7; // "| " + " | " + " |"
  const sep = '+' + '-'.repeat(matchupWidth + 2) + '+' + '-'.repeat(pickWidth + 2) + '+';

  const lines = [];
  lines.push('INTELLIPICK BRACKET EXPORT');
  lines.push('');

  // Table header
  lines.push(sep);
  lines.push(`| ${padRight('Matchup', matchupWidth)} | ${padRight('Pick', pickWidth)} |`);
  lines.push(sep);

  for (const r of rows) {
    if (r.blank) {
      lines.push(sep);
    } else if (r.section) {
      const label = ` ${r.section} `;
      const pad = totalWidth - label.length;
      const left = Math.floor(pad / 2);
      const right = pad - left;
      lines.push('|' + '-'.repeat(left) + label + '-'.repeat(right) + '|');
      lines.push(sep);
    } else if (r.subsection) {
      lines.push(`| ${padRight(r.subsection, matchupWidth)} | ${padRight('', pickWidth)} |`);
    } else if (r.matchup) {
      lines.push(`| ${padRight(r.matchup, matchupWidth)} | ${padRight(r.pick, pickWidth)} |`);
    }
  }

  lines.push(sep);

  return lines.join('\n');
}

// Copy bracket to clipboard
export function copyBracketToClipboard() {
  const text = generateBracketText();
  return navigator.clipboard.writeText(text).then(() => true).catch(() => {
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
