// lib/useOpeningBook.ts
// lichess-org/chess-openings ECO DB 기반 이론수 판별
// 수를 둔 후의 포지션이 named opening에 해당하면 이론수

import { useCallback, useRef } from 'react';
import { Chess, Square } from 'chess.js';
import openingFens from './openingFens.json';

export interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
}

export interface ExplorerResponse {
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
}

export interface BookLogEntry {
  fen: string;
  resultFen: string;
  playedUci: string | null;
  isBook: boolean;
  timestamp: number;
}

// FEN 정규화: 앞 4필드만 사용 (half-move clock, full-move number 무시)
function normalizeFen(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

const OPENING_SET = new Set<string>(openingFens as string[]);

export function useOpeningBook() {
  const logRef = useRef<BookLogEntry[]>([]);

  const isBookMove = useCallback((fen: string, uci: string): boolean => {
    try {
      const chess = new Chess(fen);
      const move = chess.move({
        from: uci.slice(0, 2) as Square,
        to: uci.slice(2, 4) as Square,
        promotion: uci[4] as 'q' | 'r' | 'b' | 'n' | undefined,
      });
      if (!move) return false;

      const resultFen = normalizeFen(chess.fen());
      const isBook = OPENING_SET.has(resultFen);

      const log = logRef.current;
      log.push({ fen, resultFen, playedUci: uci, isBook, timestamp: Date.now() });
      if (log.length > 50) log.splice(0, log.length - 50);

      return isBook;
    } catch {
      return false;
    }
  }, []);

  return { isBookMove, bookLogRef: logRef };
}
