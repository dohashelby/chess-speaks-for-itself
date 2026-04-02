// scripts/download-openings.mjs
// lichess-org/chess-openings TSV를 받아서 lib/openingFens.json 생성

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Chess } from 'chess.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FILES = ['a', 'b', 'c', 'd', 'e'];
const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master';

// FEN 정규화: half-move clock, full-move number 제거 (앞 4필드만 사용)
function normalizeFen(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

// PGN 문자열에서 수 목록 파싱 (간단한 파서)
function parsePgnMoves(pgn) {
  // "1. e4 e5 2. Nf3 Nc6" → ["e4", "e5", "Nf3", "Nc6"]
  return pgn
    .replace(/\d+\./g, '')
    .trim()
    .split(/\s+/)
    .filter(t => t && !t.match(/^\d+\.?$/));
}

function pgnToFen(pgn) {
  try {
    const chess = new Chess();
    const moves = parsePgnMoves(pgn);
    for (const san of moves) {
      const result = chess.move(san);
      if (!result) return null;
    }
    return normalizeFen(chess.fen());
  } catch {
    return null;
  }
}

async function main() {
  const fens = new Set();
  let errors = 0;

  for (const file of FILES) {
    const url = `${BASE}/${file}.tsv`;
    console.log(`Fetching ${url}...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    const text = await res.text();

    const lines = text.trim().split('\n');
    // 헤더: eco\tname\tpgn
    for (const line of lines.slice(1)) {
      const cols = line.split('\t');
      const pgn = cols[2]?.trim();
      if (!pgn) continue;
      const fen = pgnToFen(pgn);
      if (fen) fens.add(fen);
      else errors++;
    }
  }

  const outPath = join(__dirname, '..', 'lib', 'openingFens.json');
  writeFileSync(outPath, JSON.stringify([...fens]));
  console.log(`Done. ${fens.size} opening positions saved. (${errors} parse errors)`);
}

main().catch(e => { console.error(e); process.exit(1); });
