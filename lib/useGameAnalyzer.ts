// lib/useGameAnalyzer.ts
// PGN 전체 게임을 수 단위로 Stockfish 분석하고
// 각 수에 Chess.com 스타일 라벨을 붙이는 Hook

import { useCallback, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import {
  MoveAnalysis,
  GameAnalysis,
  TopLine,
  classifyMove,
  calcAccuracy,
  LABEL_META,
} from './moveClassifier';

// ── SF 단일 포지션 분석 (Promise 래퍼) ──────────────────
// useStockfish hook과 별개로, 게임 전체 분석용 직접 통신

interface SFPosition {
  eval: number;       // 백 시점 폰 단위
  best_uci: string;
  top_lines: TopLine[];
  depth: number;
}

function createSFAnalyzer(depth = 18): {
  analyze: (fen: string) => Promise<SFPosition>;
  terminate: () => void;
} {
  // 게임 분석용 전용 Worker 인스턴스
  let worker: Worker | null = null;
  let ready = false;
  const queue: Array<{ fen: string; resolve: (r: SFPosition) => void }> = [];
  let current: { fen: string; resolve: (r: SFPosition) => void } | null = null;
  const linesBuffer = new Map<number, TopLine>();
  let lastDepth = 0;

  function init() {
    if (typeof window === 'undefined') return;
    worker = new Worker('/stockfish.js');
    worker.onmessage = (e: MessageEvent) => {
      const msg: string = e.data;

      if (msg === 'uciok') {
        worker!.postMessage('setoption name MultiPV value 3');
        worker!.postMessage('isready');
        return;
      }

      if (msg === 'readyok') {
        ready = true;
        processNext();
        return;
      }

      if (msg.startsWith('info') && msg.includes('score') && current) {
        const depthMatch = msg.match(/\bdepth (\d+)\b/);
        const pvIdxMatch = msg.match(/multipv (\d+)/);
        const cpMatch    = msg.match(/score cp (-?\d+)/);
        const mateMatch  = msg.match(/score mate (-?\d+)/);
        const pvMatch    = msg.match(/ pv (.+)/);

        if (!pvMatch) return;

        const d  = depthMatch  ? parseInt(depthMatch[1])  : 0;
        const pi = pvIdxMatch  ? parseInt(pvIdxMatch[1])  : 1;
        const cp = cpMatch     ? parseInt(cpMatch[1])     : 0;
        const mt = mateMatch   ? parseInt(mateMatch[1])   : null;

        if (d > lastDepth) lastDepth = d;

        linesBuffer.set(pi, {
          moves: pvMatch[1].trim(),
          cp: mt !== null ? (mt > 0 ? 9999 : -9999) : cp,
          mate: mt,
        });
      }

      if (msg.startsWith('bestmove') && current) {
        const bestUci = msg.split(' ')[1] ?? '';
        const lines   = [1, 2, 3]
          .map(i => linesBuffer.get(i))
          .filter(Boolean) as TopLine[];

        const top = lines[0];
        // 현재 포지션의 turn은 FEN에서 추출 (stockfish는 항상 현재 플레이어 기준)
        const fenTurn = current.fen.split(' ')[1] as 'w' | 'b';
        const evalCp  = top?.mate !== null ? (top?.mate ?? 0) > 0 ? 9900 : -9900 : (top?.cp ?? 0);
        // 백 시점으로 변환
        const evalAbs = fenTurn === 'w' ? evalCp / 100 : -evalCp / 100;

        current.resolve({
          eval: evalAbs,
          best_uci: bestUci,
          top_lines: lines,
          depth: lastDepth,
        });

        linesBuffer.clear();
        lastDepth = 0;
        current = null;
        processNext();
      }
    };

    worker.postMessage('uci');
  }

  function processNext() {
    if (!ready || current || queue.length === 0 || !worker) return;
    current = queue.shift()!;
    linesBuffer.clear();
    lastDepth = 0;
    worker.postMessage('stop');
    worker.postMessage(`position fen ${current.fen}`);
    worker.postMessage(`go depth ${depth}`);
  }

  function analyze(fen: string): Promise<SFPosition> {
    if (!worker) init();
    return new Promise(resolve => {
      queue.push({ fen, resolve });
      if (ready) processNext();
    });
  }

  function terminate() {
    worker?.postMessage('quit');
    worker?.terminate();
    worker = null;
    ready = false;
  }

  return { analyze, terminate };
}

// ── Hook ──────────────────────────────────────────────────

export interface AnalysisProgress {
  current: number;
  total: number;
  phase: 'idle' | 'analyzing' | 'done' | 'error';
}

export interface UseGameAnalyzerReturn {
  analysis: GameAnalysis | null;
  progress: AnalysisProgress;
  analyzePgn: (pgn: string, depth?: number) => Promise<void>;
  cancelAnalysis: () => void;
}

export function useGameAnalyzer(): UseGameAnalyzerReturn {
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [progress, setProgress] = useState<AnalysisProgress>({
    current: 0, total: 0, phase: 'idle',
  });
  const sfRef   = useRef<ReturnType<typeof createSFAnalyzer> | null>(null);
  const cancelRef = useRef(false);

  const cancelAnalysis = useCallback(() => {
    cancelRef.current = true;
    sfRef.current?.terminate();
    sfRef.current = null;
    setProgress(p => ({ ...p, phase: 'idle' }));
  }, []);

  const analyzePgn = useCallback(async (pgn: string, depth = 18) => {
    // 이전 분석 취소
    cancelRef.current = true;
    sfRef.current?.terminate();
    cancelRef.current = false;

    const game = new Chess();
    try { game.loadPgn(pgn); } catch { throw new Error('PGN 파싱 실패'); }

    const verbose = game.history({ verbose: true });
    const total   = verbose.length;

    setProgress({ current: 0, total, phase: 'analyzing' });
    setAnalysis(null);

    sfRef.current = createSFAnalyzer(depth);
    const sf = sfRef.current;

    // ── 수 단위 FEN 목록 구성 ──────────────────────────
    const fens: string[] = [];
    const temp = new Chess();
    fens.push(temp.fen()); // 초기 포지션
    for (const m of verbose) {
      temp.move(m);
      fens.push(temp.fen());
    }

    // ── 각 수 분석 ────────────────────────────────────
    // 각 수 i: fens[i] = 두기 전, fens[i+1] = 두고 난 후
    // SF로 fens[i]를 분석 → best_uci, eval_before (최선수 eval)
    // SF로 fens[i+1]을 분석 → eval_after

    const results: MoveAnalysis[] = [];

    for (let i = 0; i < verbose.length; i++) {
      if (cancelRef.current) return;

      const move  = verbose[i];
      const fenB  = fens[i];
      const fenA  = fens[i + 1];
      const turn  = fenB.split(' ')[1] as 'w' | 'b';

      // 병렬로 두 포지션 분석
      const [sfBefore, sfAfter] = await Promise.all([
        sf.analyze(fenB),
        sf.analyze(fenA),
      ]);

      if (cancelRef.current) return;

      // 희생 판별
      const tempChess = new Chess(fenB);
      const chessMove = tempChess.move(move);
      const sacrifice = chessMove ? isSacrificeMove(chessMove) : false;

      // 분류
      const { label, eval_loss } = classifyMove({
        eval_before:  sfBefore.eval,
        eval_after:   sfAfter.eval,
        best_eval:    sfBefore.eval,  // SF best eval = fens[i] 기준
        played_uci:   move.from + move.to + (move.promotion ?? ''),
        best_uci:     sfBefore.best_uci,
        turn,
        is_sacrifice: sacrifice,
        top_lines:    sfBefore.top_lines,
      });

      results.push({
        san:         move.san,
        uci:         move.from + move.to + (move.promotion ?? ''),
        fen_before:  fenB,
        fen_after:   fenA,
        label,
        eval_before: sfBefore.eval,
        eval_after:  sfAfter.eval,
        eval_loss,
        best_move_uci: sfBefore.best_uci,
        best_eval:     sfBefore.eval,
        top_lines:     sfBefore.top_lines,
        is_sacrifice:  sacrifice,
        only_move_threshold: 0.5,
      });

      setProgress({ current: i + 1, total, phase: 'analyzing' });
    }

    if (cancelRef.current) return;

    // ── 정확도 & 요약 ─────────────────────────────────
    const accuracy = {
      white: calcAccuracy(results, 'w'),
      black: calcAccuracy(results, 'b'),
    };

    const emptyCount = () => Object.fromEntries(
      Object.keys(LABEL_META).map(k => [k, 0])
    ) as Record<string, number>;

    const summary = { white: emptyCount(), black: emptyCount() };
    results.forEach((m, i) => {
      const side = i % 2 === 0 ? 'white' : 'black';
      summary[side][m.label] = (summary[side][m.label] ?? 0) + 1;
    });

    setAnalysis({ moves: results, accuracy, summary: summary as GameAnalysis['summary'] });
    setProgress({ current: total, total, phase: 'done' });
    sfRef.current?.terminate();
    sfRef.current = null;
  }, []);

  return { analysis, progress, analyzePgn, cancelAnalysis };
}

// ── 희생 판별 헬퍼 ───────────────────────────────────────
const PIECE_VALUE: Record<string, number> = {
  p: 1, n: 3, b: 3, r: 5, q: 9, k: 0,
};

function isSacrificeMove(move: { piece: string; captured?: string; flags: string }): boolean {
  if (!move.captured) return false;
  const moved    = PIECE_VALUE[move.piece]    ?? 0;
  const captured = PIECE_VALUE[move.captured] ?? 0;
  return moved > captured;
}
