// lib/useOpeningBook.ts
// Lichess Opening Explorer API를 사용한 이론수(book move) 판별

import { useCallback, useRef } from 'react';

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
  totalGames: number;
  moves: { san: string; uci: string; games: number; isBook: boolean }[];
  playedUci: string | null;
  isBook: boolean;
  timestamp: number;
}

const EXPLORER_URL = '/api/opening';
const MIN_GAMES = 5;

const cache = new Map<string, ExplorerResponse | null>();

export function useOpeningBook() {
  const pendingRef = useRef<Map<string, Promise<ExplorerResponse | null>>>(new Map());
  const logRef = useRef<BookLogEntry[]>([]);

  const fetchExplorer = useCallback(async (fen: string): Promise<ExplorerResponse | null> => {
    if (cache.has(fen)) return cache.get(fen)!;
    if (pendingRef.current.has(fen)) return pendingRef.current.get(fen)!;

    const promise = (async () => {
      try {
        const params = new URLSearchParams({ fen });
        const res = await fetch(`${EXPLORER_URL}?${params}`);
        if (!res.ok) {
          cache.set(fen, null);
          return null;
        }
        const data: ExplorerResponse = await res.json();
        cache.set(fen, data);
        return data;
      } catch {
        cache.set(fen, null);
        return null;
      } finally {
        pendingRef.current.delete(fen);
      }
    })();

    pendingRef.current.set(fen, promise);
    return promise;
  }, []);

  const isBookMove = useCallback(async (fen: string, uci: string): Promise<boolean> => {
    const data = await fetchExplorer(fen);
    const totalGames = data ? data.white + data.draws + data.black : 0;

    const moves = (data?.moves ?? []).map(m => {
      const games = m.white + m.draws + m.black;
      return { san: m.san, uci: m.uci, games, isBook: games >= MIN_GAMES };
    });

    const isBook = totalGames >= MIN_GAMES &&
      moves.some(m => m.uci === uci && m.isBook);

    // 로그 추가
    const entry: BookLogEntry = {
      fen,
      totalGames,
      moves: moves.slice(0, 8), // 상위 8개만
      playedUci: uci,
      isBook,
      timestamp: Date.now(),
    };
    const log = logRef.current;
    log.push(entry);
    if (log.length > 50) log.splice(0, log.length - 50);

    return isBook;
  }, [fetchExplorer]);

  return { isBookMove, fetchExplorer, bookLogRef: logRef };
}
