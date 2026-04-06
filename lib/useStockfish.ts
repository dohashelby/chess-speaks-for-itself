// lib/useStockfish.ts
import { useCallback, useEffect, useRef, useState } from 'react';

export interface SFLine {
  moves: string;
  cp: number;      // white's perspective centipawns
  mate: number | null; // white's perspective (positive = white mates)
}

export interface SFResult {
  bestMove: string;
  eval: number;        // white's perspective pawns
  mate: number | null; // white's perspective
  lines: SFLine[];
  depth: number;
  fen: string;         // the FEN this result belongs to
}

interface UseStockfishReturn {
  result: SFResult | null;
  isReady: boolean;
  isAnalyzing: boolean;
  evaluate: (fen: string, depth?: number, movetime?: number) => void;
  stop: () => void;
  rawLogRef: React.RefObject<string[]>;
}

export function useStockfish(): UseStockfishReturn {
  const workerRef = useRef<Worker | null>(null);
  const [result, setResult] = useState<SFResult | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const rawLogRef = useRef<string[]>([]);
  const linesBuffer = useRef<Map<number, SFLine>>(new Map());
  const depthRef = useRef(0);
  const currentFenRef = useRef('');
  // SF가 실행 중일 때 stop이 전송될 때마다 stale bestmove가 1개 발생함
  // 연속으로 수를 두면 stale bestmove가 여러 개 발생하므로 카운터로 관리
  const skipBestmoveCountRef = useRef(0);
  const isAnalyzingRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const worker = new Worker(
      new URL('./stockfish.worker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (e: MessageEvent) => {
      const { type, data } = e.data as { type: string; data: string };
      if (type !== 'sf_output') return;

      const log = rawLogRef.current;
      log.push(data);
      if (log.length > 200) log.splice(0, log.length - 200);

      if (data === 'readyok') {
        setIsReady(true);
        return;
      }

      if (data.startsWith('info') && data.includes('score')) {
        const depthMatch = data.match(/\bdepth (\d+)\b/);
        const pvIndexMatch = data.match(/multipv (\d+)/);
        const cpMatch = data.match(/score cp (-?\d+)/);
        const mateMatch = data.match(/score mate (-?\d+)/);
        const pvMatch = data.match(/ pv (.+)/);
        if (!pvMatch) return;

        const depth = depthMatch ? parseInt(depthMatch[1]) : 0;
        const pvIndex = pvIndexMatch ? parseInt(pvIndexMatch[1]) : 1;
        const rawCp = cpMatch ? parseInt(cpMatch[1]) : 0;
        const rawMate = mateMatch ? parseInt(mateMatch[1]) : null;
        const moves = pvMatch[1].trim();

        // Stockfish reports from side-to-move perspective.
        // Normalize to white's perspective.
        const fenParts = currentFenRef.current.split(' ');
        const turn = (fenParts[1] ?? 'w') as 'w' | 'b';
        const sign = turn === 'w' ? 1 : -1;

        const mate = rawMate !== null ? rawMate * sign : null;
        const cp = mate !== null
          ? (mate > 0 ? 9999 : -9999)
          : rawCp * sign;

        depthRef.current = depth;
        linesBuffer.current.set(pvIndex, { moves, cp, mate });
        return;
      }

      if (data.startsWith('bestmove')) {
        // stop 명령 응답으로 오는 stale bestmove 무시
        if (skipBestmoveCountRef.current > 0) {
          skipBestmoveCountRef.current--;
          linesBuffer.current.clear();
          return;
        }

        const bestMove = data.split(' ')[1] ?? '';
        const lines = [1, 2, 3]
          .map((i) => linesBuffer.current.get(i))
          .filter(Boolean) as SFLine[];

        const topLine = lines[0];
        const evalPawns = topLine?.mate !== null && topLine?.mate !== undefined
          ? (topLine.mate > 0 ? 99 : -99)
          : (topLine?.cp ?? 0) / 100;

        setResult({
          bestMove,
          eval: evalPawns,
          mate: topLine?.mate ?? null,
          lines,
          depth: depthRef.current,
          fen: currentFenRef.current,
        });
        isAnalyzingRef.current = false;
        setIsAnalyzing(false);
        linesBuffer.current.clear();
      }
    };

    worker.postMessage({ type: 'init' });
    workerRef.current = worker;

    return () => {
      worker.postMessage({ type: 'quit' });
      worker.terminate();
    };
  }, []);

  const evaluate = useCallback((fen: string, depth = 20, movetime = 5000) => {
    if (!workerRef.current || !isReady) return;
    // SF가 실행 중이면 stop이 stale bestmove를 하나 발생시킴 → 스킵 카운터 증가
    if (isAnalyzingRef.current) {
      skipBestmoveCountRef.current++;
    }
    isAnalyzingRef.current = true;
    currentFenRef.current = fen;
    linesBuffer.current.clear();
    setResult(null);
    setIsAnalyzing(true);
    workerRef.current.postMessage({ type: 'evaluate', payload: { fen, depth, movetime } });
  }, [isReady]);

  const stop = useCallback(() => {
    if (isAnalyzingRef.current) {
      skipBestmoveCountRef.current++;
    }
    isAnalyzingRef.current = false;
    workerRef.current?.postMessage({ type: 'stop' });
    setIsAnalyzing(false);
  }, []);

  return { result, isReady, isAnalyzing, evaluate, stop, rawLogRef };
}
