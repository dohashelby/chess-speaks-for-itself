'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess, Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useStockfish, SFResult } from '@/lib/useStockfish';
import { classifyMove, MoveLabel, LABEL_META } from '@/lib/moveClassifier';
import { useOpeningBook, BookLogEntry } from '@/lib/useOpeningBook';
import styles from './ChessBoard.module.css';

interface ClassifyLogEntry {
  moveIdx: number;
  played: string;
  label: MoveLabel;
  reason: string;
  debug: Record<string, number | string | boolean>;
  timestamp: number;
}

// ── UCI → SAN 변환 헬퍼 ────────────────────────────────────
function uciToSan(fen: string, uci: string): string {
  if (!uci) return '';
  try {
    const chess = new Chess(fen);
    const move = chess.move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: uci[4] as 'q' | 'r' | 'b' | 'n' | undefined });
    return move?.san ?? uci;
  } catch { return uci; }
}

function uciSequenceToSan(fen: string, uciMoves: string): string {
  const chess = new Chess(fen);
  const sans: string[] = [];
  for (const uci of uciMoves.split(' ')) {
    if (!uci) continue;
    try {
      const move = chess.move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: uci[4] as 'q' | 'r' | 'b' | 'n' | undefined });
      if (!move) break;
      sans.push(move.san);
    } catch { break; }
  }
  return sans.join(' ');
}

// ── Eval Bar ──────────────────────────────────────────────
function EvalBar({ value, mate }: { value: number; mate: number | null }) {
  const clamp = Math.min(45, Math.max(-45, value * 6));
  const whitePct = 50 + clamp;
  const label = mate !== null
    ? `M${Math.abs(mate)}`
    : `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
  return (
    <div className={styles.evalWrap}>
      <div className={styles.evalBar}>
        <div className={styles.evalWhite} style={{ height: `${whitePct}%` }} />
      </div>
      <span className={styles.evalLabel}>{label}</span>
    </div>
  );
}

// ── 라벨 뱃지 ─────────────────────────────────────────────
function LabelBadge({ label }: { label: MoveLabel }) {
  const meta = LABEL_META[label];
  if (label === 'good' || label === 'forced') return null;
  return (
    <span
      className={styles.labelBadge}
      style={{ color: meta.color, background: meta.bg, borderColor: meta.color + '88' }}
    >
      {meta.symbol ? `${meta.symbol} ` : ''}{meta.ko}
    </span>
  );
}

// ── AI 해설 (버튼 트리거) ──────────────────────────────────
function AIExplanation({
  fen,
  lastMove,
  sfResult,
  label,
  level,
}: {
  fen: string;
  lastMove: string;
  sfResult: SFResult | null;
  label: MoveLabel | null;
  level: 'beginner' | 'intermediate';
}) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const prevFenRef = useRef('');

  useEffect(() => {
    if (fen !== prevFenRef.current) {
      prevFenRef.current = fen;
      setText('');
      abortRef.current?.abort();
    }
  }, [fen]);

  const fetchExplanation = useCallback(async () => {
    if (!sfResult || !lastMove) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setText('');

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen, lastMove, sfResult, label: label ?? 'good', level }),
        signal: ctrl.signal,
      });
      if (!res.ok) { setText('오류가 발생했습니다.'); return; }
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split('\n').filter(l => l.startsWith('data: '))) {
          try {
            const json = JSON.parse(line.slice(6));
            if (json.type === 'content_block_delta') setText(p => p + (json.delta?.text ?? ''));
            if (json.type === 'error') setText('오류: ' + (json.error ?? '알 수 없는 오류'));
          } catch { /* ignore */ }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') setText('오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, [fen, lastMove, sfResult, label, level]);

  const ready = !!sfResult && sfResult.fen === fen && !!lastMove;

  return (
    <div className={styles.aiBox}>
      <div className={styles.aiHeader}>
        <span className={`${styles.aiDot} ${loading ? styles.aiDotPulse : ''}`} />
        <span className={styles.aiLabel}>AI 해설</span>
        {sfResult && <span className={styles.aiDepth}>depth {sfResult.depth}</span>}
        {ready && !loading && (
          <button className={styles.explainBtn} onClick={fetchExplanation}>
            {text ? '다시 듣기' : '설명 듣기'}
          </button>
        )}
      </div>
      <p className={styles.aiText}>
        {loading && !text
          ? <span className={styles.aiPlaceholder}>해설 생성 중...</span>
          : text || (
            <span className={styles.aiPlaceholder}>
              {ready ? '"설명 듣기"를 눌러 AI 해설을 불러오세요' : '기물을 이동하면 분석합니다'}
            </span>
          )
        }
      </p>
    </div>
  );
}

// ── Move List ─────────────────────────────────────────────
function MoveList({
  history,
  labels,
  currentIdx,
  onJump,
}: {
  history: string[];
  labels: (MoveLabel | null)[];
  currentIdx: number;
  onJump: (idx: number) => void;
}) {
  const rows: { n: number; w: string; b: string | null; wl: MoveLabel | null; bl: MoveLabel | null }[] = [];
  for (let i = 0; i < history.length; i += 2) {
    rows.push({ n: i / 2 + 1, w: history[i], b: history[i + 1] ?? null, wl: labels[i] ?? null, bl: labels[i + 1] ?? null });
  }

  return (
    <div className={styles.moveTable}>
      {rows.length === 0 && <span className={styles.movePlaceholder}>수순 없음</span>}
      {rows.map(({ n, w, b, wl, bl }) => (
        <div key={n} className={styles.moveRow}>
          <span className={styles.moveNum}>{n}</span>
          <button
            className={`${styles.moveCell} ${currentIdx === (n - 1) * 2 ? styles.moveActive : ''}`}
            onClick={() => onJump((n - 1) * 2)}
          >
            <span className={styles.moveSan}>{w}</span>
            {wl && LABEL_META[wl].symbol && (
              <span className={styles.moveSymbol} style={{ color: LABEL_META[wl].color }}>
                {LABEL_META[wl].symbol}
              </span>
            )}
          </button>
          <button
            className={`${styles.moveCell} ${b && currentIdx === (n - 1) * 2 + 1 ? styles.moveActive : ''} ${!b ? styles.moveCellEmpty : ''}`}
            onClick={() => b && onJump((n - 1) * 2 + 1)}
            disabled={!b}
          >
            {b && <>
              <span className={styles.moveSan}>{b}</span>
              {bl && LABEL_META[bl].symbol && (
                <span className={styles.moveSymbol} style={{ color: LABEL_META[bl].color }}>
                  {LABEL_META[bl].symbol}
                </span>
              )}
            </>}
          </button>
        </div>
      ))}
    </div>
  );
}

// ── 디버그 패널 ──────────────────────────────────────────
function DebugPanel({
  sfLogRef,
  bookLogRef,
  classifyLogRef,
}: {
  sfLogRef: React.RefObject<string[]>;
  bookLogRef: React.RefObject<BookLogEntry[]>;
  classifyLogRef: React.RefObject<ClassifyLogEntry[]>;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [sfLog, setSfLog] = useState<string[]>([]);
  const [bookLog, setBookLog] = useState<BookLogEntry[]>([]);
  const [classifyLog, setClassifyLog] = useState<ClassifyLogEntry[]>([]);
  const [tab, setTab] = useState<'sf' | 'classify' | 'book'>('classify');

  useEffect(() => {
    const id = setInterval(() => {
      if (sfLogRef.current) setSfLog([...sfLogRef.current]);
      if (bookLogRef.current) setBookLog([...bookLogRef.current]);
      if (classifyLogRef.current) setClassifyLog([...classifyLogRef.current]);
    }, 200);
    return () => clearInterval(id);
  }, [sfLogRef, bookLogRef, classifyLogRef]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sfLog.length, bookLog.length, tab]);

  return (
    <div className={styles.debugPanel}>
      <div className={styles.debugHeader}>
        <span className={styles.debugDot} />
        <button
          className={`${styles.debugTab} ${tab === 'sf' ? styles.debugTabActive : ''}`}
          onClick={() => setTab('sf')}
        >
          SF LOG <span className={styles.debugCount}>{sfLog.length}</span>
        </button>
        <button
          className={`${styles.debugTab} ${tab === 'book' ? styles.debugTabActive : ''}`}
          onClick={() => setTab('book')}
        >
          BOOK <span className={styles.debugCount}>{bookLog.length}</span>
        </button>
        <button
          className={`${styles.debugTab} ${tab === 'classify' ? styles.debugTabActive : ''}`}
          onClick={() => setTab('classify')}
        >
          CLASSIFY <span className={styles.debugCount}>{classifyLog.length}</span>
        </button>
      </div>
      <div className={styles.debugBody}>
        {tab === 'sf' && sfLog.map((line, i) => (
          <div
            key={i}
            className={`${styles.debugLine} ${
              line.startsWith('bestmove') ? styles.debugBest :
              line.startsWith('info') && line.includes('score') ? styles.debugInfo :
              ''
            }`}
          >
            <span className={styles.debugIdx}>{i}</span>
            {line}
          </div>
        ))}
        {tab === 'book' && bookLog.map((entry, i) => (
          <div key={i} className={styles.debugBookEntry}>
            <div className={styles.debugBookHeader}>
              <span className={entry.isBook ? styles.debugBookMatch : styles.debugBookMiss}>
                {entry.isBook ? '📖 BOOK' : '— NOT BOOK'}
              </span>
            </div>
            <div className={styles.debugBookFen}>{entry.fen.split(' ').slice(0, 2).join(' ')} ...</div>
            <div className={styles.debugBookPlayed}>
              played: <span className={entry.isBook ? styles.debugBest : ''}>{entry.playedUci}</span>
            </div>
            <div className={styles.debugBookFen}>→ {entry.resultFen}</div>
          </div>
        ))}
        {tab === 'classify' && classifyLog.map((entry, i) => (
          <div key={i} className={styles.debugBookEntry}>
            <div className={styles.debugBookHeader}>
              <span className={styles.debugClassifyLabel} style={{ color: LABEL_META[entry.label].color }}>
                {LABEL_META[entry.label].symbol} {LABEL_META[entry.label].ko}
              </span>
              <span className={styles.debugBookGames}>#{entry.moveIdx + 1} {entry.played}</span>
            </div>
            <div className={styles.debugClassifyReason}>{entry.reason}</div>
            <div className={styles.debugClassifyDebug}>
              {Object.entries(entry.debug).map(([k, v]) => (
                <span key={k} className={styles.debugClassifyKV}>
                  <span className={styles.debugClassifyKey}>{k}</span>
                  <span className={styles.debugClassifyVal}>{String(v)}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────────────
export interface ChessBoardProps {
  initialFen?: string;
  initialPgn?: string;
  level?: 'beginner' | 'intermediate';
  flipped?: boolean;
}

interface PendingClassify {
  evalBefore: number;
  bestEval: number;
  bestUci: string;
  playedUci: string;
  fenBefore: string;
  turn: 'w' | 'b';
  isSacrifice: boolean;
  legalMoveCount: number;
  moveIdx: number;
  preLines: { moves: string; cp: number; mate: number | null }[];
}

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export default function ChessBoard({
  initialFen,
  initialPgn,
  level = 'intermediate',
  flipped = false,
}: ChessBoardProps) {
  const gameRef = useRef(new Chess(initialFen));
  const [fen, setFen] = useState(gameRef.current.fen());
  const [selected, setSelected] = useState<Square | null>(null);
  const [legalDests, setLegalDests] = useState<Square[]>([]);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [fenHistory, setFenHistory] = useState<string[]>([gameRef.current.fen()]);
  const [sanHistory, setSanHistory] = useState<string[]>([]);
  const [moveLabels, setMoveLabels] = useState<(MoveLabel | null)[]>([]);
  const [currentLabel, setCurrentLabel] = useState<MoveLabel | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [pgnInput, setPgnInput] = useState(initialPgn ?? '');
  const [pgnError, setPgnError] = useState('');
  const [currentLevel, setCurrentLevel] = useState<'beginner' | 'intermediate'>(level);
  const [aiLastMoveSan, setAiLastMoveSan] = useState('');

  const pendingRef = useRef<PendingClassify | null>(null);
  const classifyLogRef = useRef<ClassifyLogEntry[]>([]);
  const { result: sfResult, isReady, isAnalyzing, evaluate, stop, rawLogRef } = useStockfish();
  const { isBookMove, bookLogRef } = useOpeningBook();

  // Stockfish 준비되면 현재 포지션 즉시 분석 (첫 수 전 baseline 확보)
  useEffect(() => {
    if (isReady) evaluate(gameRef.current.fen());
  // 최초 1회만 실행
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);

  // SF 결과가 오면 라벨 분류 (book move 체크 포함)
  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending || !sfResult) return;
    pendingRef.current = null;

    const classify = () => {
      const book = isBookMove(pending.fenBefore, pending.playedUci);

      const result = classifyMove({
        eval_before: pending.evalBefore,
        eval_after: sfResult.eval,
        best_eval: pending.bestEval,
        played_uci: pending.playedUci,
        best_uci: pending.bestUci,
        turn: pending.turn,
        is_sacrifice: pending.isSacrifice,
        top_lines: pending.preLines,
        legal_move_count: pending.legalMoveCount,
        is_book: book,
      });

      // 분류 로그
      const log = classifyLogRef.current;
      log.push({
        moveIdx: pending.moveIdx,
        played: pending.playedUci,
        label: result.label,
        reason: result.reason,
        debug: result.debug,
        timestamp: Date.now(),
      });
      if (log.length > 50) log.splice(0, log.length - 50);

      setCurrentLabel(result.label);
      setMoveLabels(prev => {
        const next = [...prev];
        next[pending.moveIdx] = result.label;
        return next;
      });
    };

    classify();
  }, [sfResult, isBookMove]);

  // ── 이동 실행 (클릭/드래그 공통) ──
  const makeMove = useCallback((from: Square, to: Square): boolean => {
    const g = gameRef.current;
    // sfResult가 현재 포지션 것인지 검증 — 다른 FEN이면 stale이므로 사용하지 않음
    const sfForPos = sfResult?.fen === g.fen() ? sfResult : null;
    const evalBefore = sfForPos?.eval ?? 0;
    const bestUci = sfForPos?.bestMove ?? '';
    // best_eval: SF 1순위 라인의 eval (백 시점, 폰 단위)
    const bestEval = sfForPos
      ? (sfForPos.lines[0]?.mate != null
          ? (sfForPos.lines[0].mate > 0 ? 99 : -99)
          : (sfForPos.lines[0]?.cp ?? 0) / 100)
      : evalBefore;
    const turn = g.turn();
    const legalMoveCount = g.moves().length;
    const fenBefore = g.fen();

    const move = g.move({ from, to, promotion: 'q' });
    if (!move) return false;

    // 희생수 판별:
    // g는 이미 수를 둔 후 상태 (상대 차례)
    // 상대가 방금 둔 칸을 되잡을 수 있는지 체크 (vulnerability)
    const isCapture = move.flags.includes('c') || move.flags.includes('e');
    const movedValue = PIECE_VALUE[move.piece] ?? 0;
    const capturedValue = PIECE_VALUE[move.captured ?? ''] ?? 0;
    const isVulnerable = movedValue >= 3 &&
      g.moves({ verbose: true }).some(m => m.to === move.to);

    // 캡처 희생: 비싼 기물로 싼 기물을 잡고, 되잡힐 수 있음
    const captureSacrifice = isCapture && movedValue > capturedValue && isVulnerable;
    // Non-capture 희생: 기물을 상대가 잡을 수 있는 칸에 놓음
    const nonCaptureSacrifice = !isCapture && isVulnerable;

    const isSacrifice = captureSacrifice || nonCaptureSacrifice;

    const newFen = g.fen();
    const newFenHist = fenHistory.slice(0, currentIdx + 1).concat(newFen);
    const newSanHist = sanHistory.slice(0, currentIdx).concat(move.san);
    const moveIdx = newSanHist.length - 1;

    pendingRef.current = {
      evalBefore,
      bestEval,
      bestUci,
      playedUci: `${move.from}${move.to}${move.promotion ?? ''}`,
      fenBefore,
      turn,
      isSacrifice,
      legalMoveCount,
      moveIdx,
      preLines: sfForPos?.lines ?? [],
    };

    setFenHistory(newFenHist);
    setSanHistory(newSanHist);
    setMoveLabels(prev => [...prev.slice(0, moveIdx), null]);
    setCurrentLabel(null);
    setCurrentIdx(newFenHist.length - 1);
    setFen(newFen);
    setLastMove({ from, to });
    setSelected(null);
    setLegalDests([]);
    setAiLastMoveSan(move.san);
    evaluate(newFen);
    return true;
  }, [sfResult, fenHistory, currentIdx, sanHistory, evaluate]);

  // 클릭 핸들러
  const handleSquareClick = useCallback((sq: Square) => {
    const g = gameRef.current;
    if (selected) {
      if (legalDests.includes(sq)) {
        makeMove(selected, sq);
        return;
      }
      setSelected(null);
      setLegalDests([]);
    }
    const piece = g.get(sq);
    if (piece && piece.color === g.turn()) {
      setSelected(sq);
      setLegalDests(g.moves({ square: sq, verbose: true }).map(m => m.to as Square));
    }
  }, [selected, legalDests, makeMove]);

  // 드래그 드롭 핸들러
  const handlePieceDrop = useCallback(({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => {
    if (!targetSquare || sourceSquare === targetSquare) return false;
    const success = makeMove(sourceSquare as Square, targetSquare as Square);
    if (!success) {
      setSelected(null);
      setLegalDests([]);
    }
    return success;
  }, [makeMove]);

  // 보드 하이라이트
  const squareStyles: Record<string, React.CSSProperties> = {};
  if (selected) squareStyles[selected] = { background: 'rgba(246,246,105,0.8)' };
  if (lastMove) {
    squareStyles[lastMove.from] = { background: 'rgba(205,210,106,0.7)' };
    squareStyles[lastMove.to] = { background: 'rgba(205,210,106,0.7)' };
  }
  for (const sq of legalDests) {
    const hasPiece = gameRef.current.get(sq);
    squareStyles[sq] = hasPiece
      ? { background: 'radial-gradient(circle, transparent 60%, rgba(0,0,0,0.3) 60%)' }
      : { background: 'radial-gradient(circle, rgba(0,0,0,0.22) 28%, transparent 28%)' };
  }

  // PGN 로드
  const loadPgn = useCallback(() => {
    const g = new Chess();
    try { g.loadPgn(pgnInput.trim()); }
    catch { setPgnError('PGN 형식이 올바르지 않습니다'); return; }
    setPgnError('');
    gameRef.current = g;
    const history = g.history({ verbose: true });
    const fenHist = [new Chess().fen()];
    const tempG = new Chess();
    for (const move of history) { tempG.move(move); fenHist.push(tempG.fen()); }
    setFenHistory(fenHist);
    setSanHistory(g.history());
    setMoveLabels(new Array(history.length).fill(null));
    setCurrentLabel(null);
    setCurrentIdx(fenHist.length - 1);
    setFen(g.fen());
    setSelected(null);
    setLegalDests([]);
    setLastMove(history.length > 0
      ? { from: history.at(-1)!.from as Square, to: history.at(-1)!.to as Square }
      : null);
    setAiLastMoveSan(g.history().at(-1) ?? '');
    evaluate(g.fen());
  }, [pgnInput, evaluate]);

  // 수순 이동
  const jumpTo = useCallback((idx: number) => {
    const f = fenHistory[idx];
    if (!f) return;
    gameRef.current = new Chess(f);
    setCurrentIdx(idx);
    setFen(f);
    setSelected(null);
    setLegalDests([]);
    setCurrentLabel(moveLabels[idx - 1] ?? null);
    setAiLastMoveSan(sanHistory[idx - 1] ?? '');
    evaluate(f);
  }, [fenHistory, moveLabels, sanHistory, evaluate]);

  // 리셋
  const reset = useCallback(() => {
    const g = new Chess();
    gameRef.current = g;
    pendingRef.current = null;
    setFen(g.fen());
    setSelected(null);
    setLegalDests([]);
    setLastMove(null);
    setFenHistory([g.fen()]);
    setSanHistory([]);
    setMoveLabels([]);
    setCurrentLabel(null);
    setCurrentIdx(0);
    setPgnInput('');
    setPgnError('');
    setAiLastMoveSan('');
    stop();
    evaluate(new Chess().fen()); // 초기 포지션 재분석 (sfResult stale 방지)
  }, [stop, evaluate]);

  const game = gameRef.current;
  const statusText = game.isCheckmate()
    ? `체크메이트 — ${game.turn() === 'w' ? '흑' : '백'} 승`
    : game.isCheck() ? `${game.turn() === 'w' ? '백' : '흑'} 체크!`
    : game.isDraw() ? '무승부'
    : `${game.turn() === 'w' ? '백' : '흑'}의 차례`;

  return (
    <div className={styles.root}>
      <div className={styles.boardCol}>
        <div className={styles.boardRow}>
          <EvalBar value={sfResult?.eval ?? 0} mate={sfResult?.mate ?? null} />
          {/* data-square 속성 이벤트 델리게이션으로 dnd-kit 우회 */}
          <div
            className={styles.boardWrap}
            onClick={(e) => {
              const el = (e.target as HTMLElement).closest('[data-square]');
              if (el) handleSquareClick(el.getAttribute('data-square') as Square);
            }}
          >
            <Chessboard
              options={{
                position: fen,
                onPieceDrop: handlePieceDrop,
                squareStyles,
                boardOrientation: flipped ? 'black' : 'white',
                allowDrawingArrows: false,
                boardStyle: {
                  borderRadius: '4px',
                  boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
                  width: '100%',
                  height: '100%',
                },
                lightSquareStyle: { backgroundColor: '#f0d9b5' },
                darkSquareStyle: { backgroundColor: '#b58863' },
              }}
            />
          </div>
        </div>
        <div className={styles.statusBar}>
          <span>
            {isAnalyzing
              ? <span className={styles.analyzing}>분석 중...</span>
              : statusText}
            {!isReady && <span className={styles.sfLoading}> · Stockfish 로딩 중</span>}
          </span>
          {currentLabel && <LabelBadge label={currentLabel} />}
        </div>
      </div>

      <div className={styles.panel}>
        {sfResult && sfResult.fen === fen && (
          <div className={styles.card}>
            <div className={styles.cardLabel}>Stockfish 추천</div>
            <div className={styles.bestMove}>
              {uciToSan(fen, sfResult.bestMove)}
            </div>
            <div className={styles.lines}>
              {sfResult.lines.map((line, i) => (
                <div key={i} className={styles.line}>
                  <span className={styles.lineScore}>
                    {line.mate !== null
                      ? `M${Math.abs(line.mate)}`
                      : `${line.cp > 0 ? '+' : ''}${(line.cp / 100).toFixed(1)}`}
                  </span>
                  <span className={styles.lineMoves}>
                    {uciSequenceToSan(fen, line.moves.split(' ').slice(0, 6).join(' '))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className={styles.card}>
          <div className={styles.cardLabel}>PGN 붙여넣기</div>
          <textarea
            className={styles.pgnInput}
            value={pgnInput}
            onChange={e => setPgnInput(e.target.value)}
            placeholder="1. e4 e5 2. Nf3 Nc6 3. Bb5..."
            rows={4}
          />
          {pgnError && <p className={styles.error}>{pgnError}</p>}
          <div className={styles.btnRow}>
            <button className={styles.btnPrimary} onClick={loadPgn}>불러오기</button>
            <button className={styles.btn} onClick={reset}>초기화</button>
          </div>
        </div>

        {/* AI 해설 비활성화 중 — ANTHROPIC_API_KEY 설정 후 아래 주석 해제
        <div className={styles.levelToggle}>
          <button
            className={`${styles.levelBtn} ${currentLevel === 'beginner' ? styles.levelActive : ''}`}
            onClick={() => setCurrentLevel('beginner')}
          >입문자</button>
          <button
            className={`${styles.levelBtn} ${currentLevel === 'intermediate' ? styles.levelActive : ''}`}
            onClick={() => setCurrentLevel('intermediate')}
          >중급자</button>
        </div>
        */}

        <div className={styles.card}>
          <div className={styles.cardLabel}>수순</div>
          <MoveList
            history={sanHistory}
            labels={moveLabels}
            currentIdx={currentIdx - 1}
            onJump={(idx) => jumpTo(idx + 1)}
          />
        </div>

        {/* AI 해설 비활성화 중 — ANTHROPIC_API_KEY 설정 후 아래 주석 해제
        <AIExplanation
          fen={fen}
          lastMove={aiLastMoveSan}
          sfResult={sfResult}
          label={currentLabel}
          level={currentLevel}
        />
        */}
      </div>

      <DebugPanel sfLogRef={rawLogRef} bookLogRef={bookLogRef} classifyLogRef={classifyLogRef} />
    </div>
  );
}
