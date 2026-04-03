// lib/useOpeningBook.ts
// 이론수 판별:
// 1차) lichess ECO DB (로컬, 빠름)
// 2차) Lichess Opening Explorer API — opening 필드로 named opening 확인 (트랜스포지션 대응)

import { useCallback, useRef } from 'react';
import { Chess, Square } from 'chess.js';
import openingFens from './openingFens.json';

export interface BookLogEntry {
  fen: string;
  resultFen: string;
  playedUci: string | null;
  isBook: boolean;
  source: 'eco' | 'api' | 'none';
  openingName?: string;
  timestamp: number;
}

function normalizeFen(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

const OPENING_SET = new Set<string>(openingFens as string[]);
const EXPLORER_URL = '/api/opening';
const cache = new Map<string, { opening: { eco: string; name: string } | null } | null>();

async function fetchOpeningName(fen: string): Promise<string | null> {
  if (cache.has(fen)) {
    return cache.get(fen)?.opening?.name ?? null;
  }

  try {
    const res = await fetch(`${EXPLORER_URL}?${new URLSearchParams({ fen })}`);
    if (!res.ok) { cache.set(fen, null); return null; }
    const data = await res.json();
    cache.set(fen, data);
    return data?.opening?.name ?? null;
  } catch {
    cache.set(fen, null);
    return null;
  }
}

export function useOpeningBook() {
  const logRef = useRef<BookLogEntry[]>([]);

  const isBookMove = useCallback(async (fen: string, uci: string): Promise<boolean> => {
    try {
      const chess = new Chess(fen);
      const move = chess.move({
        from: uci.slice(0, 2) as Square,
        to: uci.slice(2, 4) as Square,
        promotion: uci[4] as 'q' | 'r' | 'b' | 'n' | undefined,
      });
      if (!move) return false;

      const resultFen = normalizeFen(chess.fen());

      // 1차: ECO DB (로컬, 즉시)
      if (OPENING_SET.has(resultFen)) {
        logRef.current.push({ fen, resultFen, playedUci: uci, isBook: true, source: 'eco', timestamp: Date.now() });
        if (logRef.current.length > 50) logRef.current.splice(0, logRef.current.length - 50);
        return true;
      }

      // 2차: Lichess API — 결과 포지션에 opening 이름이 있으면 이론수
      const openingName = await fetchOpeningName(chess.fen());
      const isBook = openingName !== null;

      logRef.current.push({
        fen, resultFen, playedUci: uci, isBook,
        source: isBook ? 'api' : 'none',
        openingName: openingName ?? undefined,
        timestamp: Date.now(),
      });
      if (logRef.current.length > 50) logRef.current.splice(0, logRef.current.length - 50);

      return isBook;
    } catch {
      return false;
    }
  }, []);

  const getOpeningName = useCallback(async (fen: string): Promise<string | null> => {
    return fetchOpeningName(fen);
  }, []);

  return { isBookMove, getOpeningName, bookLogRef: logRef };
}
