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
  moves: { san: string; uci: string; games: number; white: number; draws: number; black: number; isBook: boolean }[];
  playedUci: string | null;
  isBook: boolean;
  timestamp: number;
  raw: ExplorerResponse | null;
  error: string | null;
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
    let data: ExplorerResponse | null = null;
    let error: string | null = null;
    try {
      data = await fetchExplorer(fen);
    } catch (e) {
      error = String(e);
    }

    const totalGames = data ? data.white + data.draws + data.black : 0;

    const moves = (data?.moves ?? []).map(m => {
      const games = m.white + m.draws + m.black;
      return { san: m.san, uci: m.uci, games, white: m.white, draws: m.draws, black: m.black, isBook: games >= MIN_GAMES };
    });

    const isBook = totalGames >= MIN_GAMES &&
      moves.some(m => m.uci === uci && m.isBook);

    const entry: BookLogEntry = {
      fen,
      totalGames,
      moves: moves.slice(0, 8),
      playedUci: uci,
      isBook,
      timestamp: Date.now(),
      raw: data,
      error,
    };
    const log = logRef.current;
    log.push(entry);
    if (log.length > 50) log.splice(0, log.length - 50);

    return isBook;
  }, [fetchExplorer]);

  return { isBookMove, fetchExplorer, bookLogRef: logRef };
}
