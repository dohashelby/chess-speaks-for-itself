// lib/useOpeningBook.ts
// Lichess Opening Explorer API를 사용한 이론수(book move) 판별

import { useCallback, useRef } from 'react';

interface ExplorerMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
}

interface ExplorerResponse {
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
}

const EXPLORER_URL = 'https://explorer.lichess.ovh/masters';
const MIN_GAMES = 5; // 최소 마스터 게임 수

// 모듈 레벨 캐시 (컴포넌트 리렌더와 무관하게 유지)
const cache = new Map<string, Set<string>>();

export function useOpeningBook() {
  const pendingRef = useRef<Map<string, Promise<Set<string>>>>(new Map());

  const fetchBookMoves = useCallback(async (fen: string): Promise<Set<string>> => {
    // 캐시 히트
    if (cache.has(fen)) return cache.get(fen)!;

    // 중복 요청 방지
    if (pendingRef.current.has(fen)) return pendingRef.current.get(fen)!;

    const promise = (async () => {
      try {
        const params = new URLSearchParams({ fen, moves: '12' });
        const res = await fetch(`${EXPLORER_URL}?${params}`, {
          headers: { 'Accept': 'application/json' },
        });
        if (!res.ok) {
          cache.set(fen, new Set());
          return new Set<string>();
        }
        const data: ExplorerResponse = await res.json();
        const totalGames = data.white + data.draws + data.black;

        // 이 포지션 자체가 마스터 게임에 없으면 빈 Set
        if (totalGames < MIN_GAMES) {
          cache.set(fen, new Set());
          return new Set<string>();
        }

        // 충분한 게임 수를 가진 수만 book move로 인정
        const bookUcis = new Set<string>();
        for (const m of data.moves) {
          const games = m.white + m.draws + m.black;
          if (games >= MIN_GAMES) {
            bookUcis.add(m.uci);
          }
        }
        cache.set(fen, bookUcis);
        return bookUcis;
      } catch {
        cache.set(fen, new Set());
        return new Set<string>();
      } finally {
        pendingRef.current.delete(fen);
      }
    })();

    pendingRef.current.set(fen, promise);
    return promise;
  }, []);

  // 특정 FEN에서 특정 수가 book move인지 확인
  const isBookMove = useCallback(async (fen: string, uci: string): Promise<boolean> => {
    const bookMoves = await fetchBookMoves(fen);
    return bookMoves.has(uci);
  }, [fetchBookMoves]);

  return { isBookMove, fetchBookMoves };
}
