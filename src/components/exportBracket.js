import { getRegionR64Matchups, getR64Matchup, getGeneratedMatchup, REGIONS } from '../engine/propagation.js';
import { getWinner } from '../engine/liveScores.js';

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

// Collect matchup data into a row with two team lines + pick
function matchupRow(team1Label, team2Label, pick) {
  return { team1: team1Label, team2: 'vs ' + team2Label, pick: pick || '--' };
}

// Build structured bracket text as a table
export function generateBracketText() {
  const rows = []; // { team1, team2, pick } or { section } or { subsection }

  for (const region of REGIONS) {
    rows.push({ section: `${region.toUpperCase()} REGION` });

    const r64Ids = getRegionR64Matchups(region);

    // R64
    rows.push({ subsection: 'Round of 64' });
    for (let i = 0; i < 8; i++) {
      const m = getR64Matchup(r64Ids[i]);
      if (!m) continue;
      const winner = getWinner(r64Ids[i]);
      rows.push(matchupRow(teamLabel(m.team1), teamLabel(m.team2), winner ? teamLabel(winner) : null));
    }

    // R32
    rows.push({ subsection: 'Round of 32' });
    for (let i = 0; i < 4; i++) {
      const id = laterRoundId(region, 2, i);
      const gen = getGeneratedMatchup(id);
      const t1 = gen && gen.team1 ? teamLabel(gen.team1) : 'TBD';
      const t2 = gen && gen.team2 ? teamLabel(gen.team2) : 'TBD';
      rows.push(matchupRow(t1, t2, null));
    }

    // S16
    rows.push({ subsection: 'Sweet 16' });
    for (let i = 0; i < 2; i++) {
      const id = laterRoundId(region, 3, i);
      const gen = getGeneratedMatchup(id);
      const t1 = gen && gen.team1 ? teamLabel(gen.team1) : 'TBD';
      const t2 = gen && gen.team2 ? teamLabel(gen.team2) : 'TBD';
      rows.push(matchupRow(t1, t2, null));
    }

    // E8
    rows.push({ subsection: 'Elite Eight' });
    const e8Id = laterRoundId(region, 4, 0);
    const e8 = getGeneratedMatchup(e8Id);
    const e8t1 = e8 && e8.team1 ? teamLabel(e8.team1) : 'TBD';
    const e8t2 = e8 && e8.team2 ? teamLabel(e8.team2) : 'TBD';
    rows.push(matchupRow(e8t1, e8t2, null));
  }

  // Final Four
  rows.push({ section: 'FINAL FOUR' });
  for (let i = 0; i < 2; i++) {
    const id = `ff-${i}`;
    const gen = getGeneratedMatchup(id);
    const t1 = gen && gen.team1 ? teamLabel(gen.team1) : 'TBD';
    const t2 = gen && gen.team2 ? teamLabel(gen.team2) : 'TBD';
    rows.push(matchupRow(t1, t2, null));
  }

  // Championship
  rows.push({ section: 'CHAMPIONSHIP' });
  const champGen = getGeneratedMatchup('championship');
  const ct1 = champGen && champGen.team1 ? teamLabel(champGen.team1) : 'TBD';
  const ct2 = champGen && champGen.team2 ? teamLabel(champGen.team2) : 'TBD';
  rows.push(matchupRow(ct1, ct2, null));

  // Compute column widths from individual lines, not combined matchup strings
  let col1Width = 'Matchup'.length;
  let col2Width = 'Pick'.length;
  for (const r of rows) {
    if (r.team1) {
      col1Width = Math.max(col1Width, r.team1.length, r.team2.length);
      col2Width = Math.max(col2Width, r.pick.length);
    }
    if (r.subsection) col1Width = Math.max(col1Width, r.subsection.length);
  }

  const totalWidth = col1Width + col2Width + 7; // "| " + " | " + " |"
  const sep = '+' + '-'.repeat(col1Width + 2) + '+' + '-'.repeat(col2Width + 2) + '+';

  const lines = [];
  lines.push('INTELLIPICK BRACKET EXPORT');
  lines.push('');
  lines.push(sep);
  lines.push(`| ${padRight('Matchup', col1Width)} | ${padRight('Pick', col2Width)} |`);
  lines.push(sep);

  for (const r of rows) {
    if (r.section) {
      const label = ` ${r.section} `;
      const pad = totalWidth - label.length;
      const left = Math.floor(pad / 2);
      const right = pad - left;
      lines.push('|' + '-'.repeat(left) + label + '-'.repeat(right) + '|');
      lines.push(sep);
    } else if (r.subsection) {
      lines.push(`| ${padRight(r.subsection, col1Width)} | ${padRight('', col2Width)} |`);
      lines.push(sep);
    } else if (r.team1) {
      lines.push(`| ${padRight(r.team1, col1Width)} | ${padRight(r.pick, col2Width)} |`);
      lines.push(`| ${padRight(r.team2, col1Width)} | ${padRight('', col2Width)} |`);
      lines.push(sep);
    }
  }

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
