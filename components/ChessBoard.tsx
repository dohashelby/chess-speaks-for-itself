'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Chess, Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { useStockfish, SFResult, SFLine } from '@/lib/useStockfish';
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
  let whitePct: number;
  if (mate !== null) {
    whitePct = mate > 0 ? 100 : 0;
  } else {
    const clamp = Math.min(45, Math.max(-45, value * 6));
    whitePct = 50 + clamp;
  }
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
  preSfResult,
  label,
  level,
}: {
  fen: string;
  lastMove: string;
  sfResult: SFResult | null;
  preSfResult: SFResult | null;
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
        body: JSON.stringify({ fen, lastMove, sfResult, preSfResult, label: label ?? 'good', level }),
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
  }, [fen, lastMove, sfResult, preSfResult, label, level]);

  const hasMove = !!lastMove;
  const ready = !!sfResult && sfResult.fen === fen && hasMove;
  const analyzing = hasMove && !ready && !loading;

  return (
    <div className={styles.aiBox}>
      <div className={styles.aiHeader}>
        <span className={`${styles.aiDot} ${loading ? styles.aiDotPulse : ''}`} />
        <span className={styles.aiLabel}>AI 해설</span>
        {sfResult && <span className={styles.aiDepth}>depth {sfResult.depth}</span>}
        {hasMove && !loading && (
          <button
            className={styles.explainBtn}
            onClick={fetchExplanation}
            disabled={!ready}
            style={!ready ? { opacity: 0.35, cursor: 'not-allowed' } : undefined}
            title={analyzing ? 'Stockfish 분석 중...' : undefined}
          >
            {text ? '다시 듣기' : '설명 듣기'}
          </button>
        )}
      </div>
      <p className={styles.aiText}>
        {loading && !text
          ? <span className={styles.aiPlaceholder}>해설 생성 중...</span>
          : text || (
            <span className={styles.aiPlaceholder}>
              {analyzing ? 'Stockfish 분석 중...' : ready ? '"설명 듣기"를 눌러 AI 해설을 불러오세요' : '기물을 이동하면 분석합니다'}
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
  variation,
  isInVariation,
  varFenIdx,
  onJumpMain,
  onJumpVariation,
}: {
  history: string[];
  labels: (MoveLabel | null)[];
  currentIdx: number;
  variation: VariationState | null;
  isInVariation: boolean;
  varFenIdx: number;
  onJumpMain: (idx: number) => void;
  onJumpVariation: (varIdx: number) => void;
}) {
  const rows: { n: number; w: string; b: string | null; wl: MoveLabel | null; bl: MoveLabel | null; wIdx: number; bIdx: number }[] = [];
  for (let i = 0; i < history.length; i += 2) {
    rows.push({ n: i / 2 + 1, w: history[i], b: history[i + 1] ?? null, wl: labels[i] ?? null, bl: labels[i + 1] ?? null, wIdx: i, bIdx: i + 1 });
  }

  // variation이 삽입될 row 번호 (1-based). startFenIdx=0이면 0(맨 앞)
  const varAfterRow = variation
    ? (variation.startFenIdx > 0 ? Math.floor((variation.startFenIdx - 1) / 2) + 1 : 0)
    : -1;

  const activeVarIdx = isInVariation ? varFenIdx - 1 : -2; // 0-based in variation.sans

  const renderVariation = () => {
    if (!variation) return null;
    const tokens: { type: 'num' | 'move'; text: string; idx: number }[] = [];
    for (let i = 0; i < variation.sans.length; i++) {
      const fenPos = variation.startFenIdx + i;
      const fullMove = Math.floor(fenPos / 2) + 1;
      if (fenPos % 2 === 0) {
        tokens.push({ type: 'num', text: `${fullMove}.`, idx: i });
      } else if (i === 0) {
        tokens.push({ type: 'num', text: `${fullMove}...`, idx: i });
      }
      tokens.push({ type: 'move', text: variation.sans[i], idx: i });
    }
    return (
      <div className={styles.variationRow}>
        <span className={styles.varEllipsis}>…</span>
        {tokens.map((tok, i) =>
          tok.type === 'num'
            ? <span key={i} className={styles.varNum}>{tok.text}</span>
            : <button
                key={i}
                className={`${styles.varMove} ${tok.idx === activeVarIdx ? styles.varMoveActive : ''}`}
                onClick={() => onJumpVariation(tok.idx)}
              >{tok.text}</button>
        )}
      </div>
    );
  };

  const activeMainIdx = isInVariation ? -2 : currentIdx;

  return (
    <div className={styles.moveTable}>
      {rows.length === 0 && <span className={styles.movePlaceholder}>수순 없음</span>}
      {varAfterRow === 0 && renderVariation()}
      {rows.map(({ n, w, b, wl, bl, wIdx, bIdx }) => (
        <React.Fragment key={n}>
          <div className={styles.moveRow}>
            <span className={styles.moveNum}>{n}</span>
            <button
              className={`${styles.moveCell} ${activeMainIdx === wIdx ? styles.moveActive : ''}`}
              onClick={() => onJumpMain(wIdx)}
            >
              <span className={styles.moveSan}>{w}</span>
              {wl && LABEL_META[wl].symbol && (
                <span className={styles.moveSymbol} style={{ color: LABEL_META[wl].color }}>{LABEL_META[wl].symbol}</span>
              )}
            </button>
            <button
              className={`${styles.moveCell} ${b && activeMainIdx === bIdx ? styles.moveActive : ''} ${!b ? styles.moveCellEmpty : ''}`}
              onClick={() => b && onJumpMain(bIdx)}
              disabled={!b}
            >
              {b && <>
                <span className={styles.moveSan}>{b}</span>
                {bl && LABEL_META[bl].symbol && (
                  <span className={styles.moveSymbol} style={{ color: LABEL_META[bl].color }}>{LABEL_META[bl].symbol}</span>
                )}
              </>}
            </button>
          </div>
          {varAfterRow === n && renderVariation()}
        </React.Fragment>
      ))}
      {variation && varAfterRow > rows.length && renderVariation()}
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

interface VariationState {
  startFenIdx: number;                          // FEN index (main line) where variation branches
  sans: string[];                               // variation SAN moves
  fens: string[];                               // fens[0]=branch point, fens[k]=after k moves
  moves: { from: Square; to: Square }[];        // for lastMove highlight
}

interface PgnMoveInfo {
  uci: string;
  turn: 'w' | 'b';
  isSacrifice: boolean;
  legalMoveCount: number;
}

interface PgnStoredEval {
  eval: number;
  bestEval: number;
  bestUci: string;
  lines: SFLine[];
}

interface PgnQueue {
  fens: string[];
  moveInfos: PgnMoveInfo[];
  storedEvals: (PgnStoredEval | null)[];
  nextIdx: number;  // next fens index to evaluate
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
  const [moveFromToHistory, setMoveFromToHistory] = useState<({ from: Square; to: Square } | null)[]>([]);
  const [sanHistory, setSanHistory] = useState<string[]>([]);
  const [moveLabels, setMoveLabels] = useState<(MoveLabel | null)[]>([]);
  const [currentLabel, setCurrentLabel] = useState<MoveLabel | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [mainLineLength, setMainLineLength] = useState(0);
  const [variation, setVariation] = useState<VariationState | null>(null);
  const [isInVariation, setIsInVariation] = useState(false);
  const [varFenIdx, setVarFenIdx] = useState(0); // index in variation.fens (1 = after first move)
  const [pgnInput, setPgnInput] = useState(initialPgn ?? '');
  const [pgnError, setPgnError] = useState('');
  const [currentLevel, setCurrentLevel] = useState<'beginner' | 'intermediate'>(level);
  const [aiLastMoveSan, setAiLastMoveSan] = useState('');

  const pendingRef = useRef<PendingClassify | null>(null);
  const pgnQueueRef = useRef<PgnQueue | null>(null);
  const evalDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const classifyLogRef = useRef<ClassifyLogEntry[]>([]);
  const { result: sfResult, isReady, isAnalyzing, evaluate, stop, rawLogRef } = useStockfish();
  const { isBookMove, getOpeningName, bookLogRef } = useOpeningBook();
  const [openingName, setOpeningName] = useState<string | null>(null);
  const [displayEval, setDisplayEval] = useState<{ eval: number; mate: number | null }>({ eval: 0, mate: null });
  const [preSfResult, setPreSfResult] = useState<SFResult | null>(null);
  const [pgnProgress, setPgnProgress] = useState<{ done: number; total: number; evals: number[] } | null>(null);

  // Stockfish 준비되면 현재 포지션 즉시 분석 (첫 수 전 baseline 확보)
  useEffect(() => {
    if (isReady) evaluate(gameRef.current.fen());
  // 최초 1회만 실행
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);

  // FEN 바뀔 때마다 오프닝 이름 조회 (이름이 있을 때만 업데이트 — 이론 범위 벗어나도 마지막 이름 유지)
  useEffect(() => {
    getOpeningName(fen).then(name => { if (name) setOpeningName(name); });
  }, [fen, getOpeningName]);

  // sfResult가 현재 FEN과 일치할 때만 eval 업데이트 — 분석 중 이전 값 유지
  // 체크메이트는 Stockfish 결과 없이 chess.js로 직접 감지
  useEffect(() => {
    if (gameRef.current.isCheckmate()) {
      const loser = gameRef.current.turn(); // 움직여야 하는데 못하는 쪽 = 진 쪽
      setDisplayEval({ eval: loser === 'b' ? 99 : -99, mate: loser === 'b' ? 1 : -1 });
    } else if (sfResult && sfResult.fen === fen) {
      setDisplayEval({ eval: sfResult.eval, mate: sfResult.mate ?? null });
    }
  }, [sfResult, fen]);

  // PGN 배치 분류 완료 시 현재 보고 있는 수의 라벨 동기화
  useEffect(() => {
    if (currentIdx > 0) setCurrentLabel(moveLabels[currentIdx - 1] ?? null);
  }, [moveLabels, currentIdx]);

  // SF 결과가 오면 라벨 분류 (book move 체크 포함)
  useEffect(() => {
    if (!sfResult) return;

    // ── 수동 플레이 분류 ──
    const pending = pendingRef.current;
    if (pending) {
      pendingRef.current = null;
      const classify = async () => {
        const book = await isBookMove(pending.fenBefore, pending.playedUci);
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
          fen_before: pending.fenBefore,
        });
        const log = classifyLogRef.current;
        log.push({ moveIdx: pending.moveIdx, played: pending.playedUci, label: result.label, reason: result.reason, debug: result.debug, timestamp: Date.now() });
        if (log.length > 50) log.splice(0, log.length - 50);
        setCurrentLabel(result.label);
        setMoveLabels(prev => { const next = [...prev]; next[pending.moveIdx] = result.label; return next; });
      };
      classify();
      return;
    }

    // ── PGN 배치 분류 ──
    const queue = pgnQueueRef.current;
    if (!queue || sfResult.fen !== queue.fens[queue.nextIdx]) return;

    const idx = queue.nextIdx;
    const bestEval = sfResult.lines[0]?.mate != null
      ? (sfResult.lines[0].mate > 0 ? 99 : -99)
      : (sfResult.lines[0]?.cp ?? 0) / 100;
    queue.storedEvals[idx] = { eval: sfResult.eval, bestEval, bestUci: sfResult.bestMove, lines: sfResult.lines };

    // 이전 수 분류 (idx >= 1이고 이전 eval이 있을 때)
    if (idx >= 1) {
      const beforeEval = queue.storedEvals[idx - 1];
      if (beforeEval) {
        const moveInfo = queue.moveInfos[idx - 1];
        const fenBefore = queue.fens[idx - 1];
        const evalAfter = sfResult.eval;
        const moveIdx = idx - 1;
        isBookMove(fenBefore, moveInfo.uci).then(book => {
          const result = classifyMove({
            eval_before: beforeEval.eval,
            eval_after: evalAfter,
            best_eval: beforeEval.bestEval,
            played_uci: moveInfo.uci,
            best_uci: beforeEval.bestUci,
            turn: moveInfo.turn,
            is_sacrifice: moveInfo.isSacrifice,
            top_lines: beforeEval.lines,
            legal_move_count: moveInfo.legalMoveCount,
            is_book: book,
            fen_before: fenBefore,
          });
          setMoveLabels(prev => { const next = [...prev]; next[moveIdx] = result.label; return next; });
        });
      }
    }

    // 다음 FEN 평가
    const evalForGraph = sfResult.eval;
    queue.nextIdx++;
    if (queue.nextIdx < queue.fens.length) {
      setPgnProgress(prev => prev ? { done: queue.nextIdx, total: queue.fens.length, evals: [...prev.evals, evalForGraph] } : null);
      evaluate(queue.fens[queue.nextIdx], 15, 2000); // 배치 분석: 포지션당 최대 2초
    } else {
      pgnQueueRef.current = null;
      setPgnProgress(null);
    }
  }, [sfResult, isBookMove, evaluate]);

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

    let move;
    try {
      move = g.move({ from, to, promotion: 'q' });
    } catch {
      return false;
    }
    if (!move) return false;

    // 희생수 판별: 기물 점수 기준으로 손해를 보는 수만 희생수로 인정
    const isCapture = move.flags.includes('c') || move.flags.includes('e');
    const movedValue = PIECE_VALUE[move.piece] ?? 0;
    const capturedValue = PIECE_VALUE[move.captured ?? ''] ?? 0;
    // 상대의 최소 가치 공격 기물 계산
    const attackers = g.moves({ verbose: true }).filter(m => m.to === move.to);
    const minAttackerValue = attackers.reduce(
      (min, m) => Math.min(min, PIECE_VALUE[m.piece] ?? 0), Infinity
    );
    const hasAnyAttacker = minAttackerValue < Infinity;

    // 캡처 희생: 비싼 기물로 싼 기물 잡고, 상대가 되잡을 수 있음 → 기물 손해 확정
    const captureSacrifice = isCapture && movedValue > capturedValue && hasAnyAttacker;
    // Non-capture 희생: 상대 최소 공격 기물보다 내 기물이 비쌀 때만 (기물 점수 손해)
    const nonCaptureSacrifice = !isCapture && hasAnyAttacker && minAttackerValue < movedValue;

    const isSacrifice = captureSacrifice || nonCaptureSacrifice;

    pgnQueueRef.current = null; // 수동 플레이 시 배치 분류 중단
    const newFen = g.fen();
    // ── PGN 로드 상태: variation으로 처리 (메인 라인 보존) ──
    if (mainLineLength > 0) {
      const varStart = isInVariation ? variation!.startFenIdx : currentIdx;
      const prevSans  = isInVariation ? variation!.sans.slice(0, varFenIdx)      : [];
      const prevFens  = isInVariation ? variation!.fens.slice(0, varFenIdx + 1)  : [fenHistory[currentIdx]];
      const prevMoves = isInVariation ? variation!.moves.slice(0, varFenIdx)     : [];

      const newVar: VariationState = {
        startFenIdx: varStart,
        sans:  [...prevSans,  move.san],
        fens:  [...prevFens,  newFen],
        moves: [...prevMoves, { from, to }],
      };
      const newVarIdx = newVar.fens.length - 1;

      pendingRef.current = null;
      setVariation(newVar);
      setIsInVariation(true);
      setVarFenIdx(newVarIdx);
      setFen(newFen);
      setLastMove({ from, to });
      setSelected(null);
      setLegalDests([]);
      setCurrentLabel(null);
      setPreSfResult(sfForPos);
      setAiLastMoveSan(move.san);
      evaluate(newFen);
      return true;
    }

    // ── 일반 플레이 (PGN 없음): 메인 라인에 수 추가 ──
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
    setMoveFromToHistory(prev => [...prev.slice(0, moveIdx), { from, to }]);
    setMoveLabels(prev => [...prev.slice(0, moveIdx), null]);
    setCurrentLabel(null);
    setPreSfResult(sfForPos);
    setCurrentIdx(newFenHist.length - 1);
    setFen(newFen);
    setLastMove({ from, to });
    setSelected(null);
    setLegalDests([]);
    setAiLastMoveSan(move.san);
    evaluate(newFen);
    return true;
  }, [sfResult, fenHistory, currentIdx, sanHistory, mainLineLength, isInVariation, variation, varFenIdx, evaluate]);

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
  const handlePieceDrag = useCallback(({ square }: { isSparePiece: boolean; piece: { pieceType: string }; square: string | null }) => {
    if (!square) return;
    const g = gameRef.current;
    setSelected(square as Square);
    setLegalDests(g.moves({ square: square as Square, verbose: true }).map(m => m.to as Square));
  }, []);

  const handlePieceDrop = useCallback(({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => {
    if (!targetSquare || sourceSquare === targetSquare) {
      setSelected(null);
      setLegalDests([]);
      return false;
    }
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
    console.log('[PGN] loadPgn called');
    const g = new Chess();
    try { g.loadPgn(pgnInput.trim()); }
    catch (err) { console.log('[PGN] parse error', err); setPgnError('PGN 형식이 올바르지 않습니다'); return; }
    setPgnError('');
    gameRef.current = g;
    const history = g.history({ verbose: true });
    const fenHist = [new Chess().fen()];
    const tempG = new Chess();
    for (const move of history) { tempG.move(move); fenHist.push(tempG.fen()); }

    // PGN 분류 큐 구성: 각 수의 메타 정보 수집
    const moveInfos: PgnMoveInfo[] = [];
    const tempG2 = new Chess();
    for (const move of history) {
      const turn = tempG2.turn();
      const legalMoveCount = tempG2.moves().length;
      const m = tempG2.move(move);
      const isCapture = m.flags.includes('c') || m.flags.includes('e');
      const movedValue = PIECE_VALUE[m.piece] ?? 0;
      const capturedValue = PIECE_VALUE[m.captured ?? ''] ?? 0;
      const pgnAttackers = tempG2.moves({ verbose: true }).filter(mv => mv.to === m.to);
      const pgnMinAttacker = pgnAttackers.reduce((min, mv) => Math.min(min, PIECE_VALUE[mv.piece] ?? 0), Infinity);
      const pgnHasAttacker = pgnMinAttacker < Infinity;
      const isSacrifice = (isCapture && movedValue > capturedValue && pgnHasAttacker) ||
                          (!isCapture && pgnHasAttacker && pgnMinAttacker < movedValue);
      moveInfos.push({ uci: `${m.from}${m.to}${m.promotion ?? ''}`, turn, isSacrifice, legalMoveCount });
    }
    pgnQueueRef.current = {
      fens: fenHist,
      moveInfos,
      storedEvals: new Array(fenHist.length).fill(null),
      nextIdx: 0,
    };

    setFenHistory(fenHist);
    setMoveFromToHistory(history.map(m => ({ from: m.from as Square, to: m.to as Square })));
    setSanHistory(g.history());
    setMainLineLength(history.length);
    setVariation(null);
    setIsInVariation(false);
    setVarFenIdx(0);
    setMoveLabels(new Array(history.length).fill(null));
    setCurrentLabel(null);
    setOpeningName(null);
    setPreSfResult(null);
    setCurrentIdx(fenHist.length - 1);
    setFen(g.fen());
    setSelected(null);
    setLegalDests([]);
    setLastMove(history.length > 0
      ? { from: history.at(-1)!.from as Square, to: history.at(-1)!.to as Square }
      : null);
    setAiLastMoveSan(g.history().at(-1) ?? '');
    // 큐 첫 번째 FEN부터 순차 평가 시작
    console.log('[PGN] starting eval, total fens:', fenHist.length);
    setPgnProgress({ done: 0, total: fenHist.length, evals: [] });
    evaluate(fenHist[0], 15, 2000);
  }, [pgnInput, evaluate]);

  // 수순 이동 (메인 라인)
  const jumpTo = useCallback((idx: number) => {
    const f = fenHistory[idx];
    if (!f) return;
    pgnQueueRef.current = null;
    gameRef.current = new Chess(f);
    setCurrentIdx(idx);
    setFen(f);
    setSelected(null);
    setLegalDests([]);
    setCurrentLabel(moveLabels[idx - 1] ?? null);
    setLastMove(idx > 0 ? (moveFromToHistory[idx - 1] ?? null) : null);
    setIsInVariation(false);
    setPreSfResult(null);
    setAiLastMoveSan(sanHistory[idx - 1] ?? '');
    if (evalDebounceRef.current) clearTimeout(evalDebounceRef.current);
    evalDebounceRef.current = setTimeout(() => { evaluate(f, 15); }, 300);
  }, [fenHistory, moveFromToHistory, moveLabels, sanHistory, evaluate]);

  // 수순 이동 (variation)
  const jumpToVariation = useCallback((varIdx: number) => {
    if (!variation) return;
    const f = variation.fens[varIdx + 1];
    if (!f) return;
    gameRef.current = new Chess(f);
    setIsInVariation(true);
    setVarFenIdx(varIdx + 1);
    setFen(f);
    setLastMove(variation.moves[varIdx] ?? null);
    setSelected(null);
    setLegalDests([]);
    setCurrentLabel(null);
    setPreSfResult(null);
    if (evalDebounceRef.current) clearTimeout(evalDebounceRef.current);
    evalDebounceRef.current = setTimeout(() => { evaluate(f, 15); }, 300);
  }, [variation, evaluate]);

  // 리셋
  const reset = useCallback(() => {
    const g = new Chess();
    gameRef.current = g;
    pendingRef.current = null;
    pgnQueueRef.current = null;
    setFen(g.fen());
    setSelected(null);
    setLegalDests([]);
    setLastMove(null);
    setFenHistory([g.fen()]);
    setMoveFromToHistory([]);
    setSanHistory([]);
    setMainLineLength(0);
    setVariation(null);
    setIsInVariation(false);
    setVarFenIdx(0);
    setMoveLabels([]);
    setCurrentLabel(null);
    setPreSfResult(null);
    setCurrentIdx(0);
    setPgnInput('');
    setPgnError('');
    // setAiLastMoveSan('');
    setOpeningName(null);
    setPgnProgress(null);
    setDisplayEval({ eval: 0, mate: null });
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
          <EvalBar value={displayEval.eval} mate={displayEval.mate} />
          {/* data-square 속성 이벤트 델리게이션으로 dnd-kit 우회 */}
          <div
            className={styles.boardWrap}
            onClick={(e) => {
              const el = (e.target as HTMLElement).closest('[data-square]');
              if (el) handleSquareClick(el.getAttribute('data-square') as Square);
            }}
            onTouchEnd={(e) => {
              const el = (e.target as HTMLElement).closest('[data-square]');
              if (el) {
                e.preventDefault();
                handleSquareClick(el.getAttribute('data-square') as Square);
              }
            }}
          >
            <Chessboard
              options={{
                position: fen,
                onPieceDrop: handlePieceDrop,
                onPieceDrag: handlePieceDrag,
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
                squareRenderer: ({ square, children }: { square: string; children?: React.ReactNode }) => {
                  const meta = (square === lastMove?.to && currentLabel) ? LABEL_META[currentLabel] : null;
                  const showBadge = meta && meta.symbol && meta.symbol !== '📖';
                  return (
                    <div style={{ position: 'relative', width: '100%', height: '100%', ...squareStyles[square] }}>
                      {children}
                      {showBadge && (
                        <div className={styles.moveLabelBadge} style={{ background: meta.color }}>
                          {meta.symbol}
                        </div>
                      )}
                    </div>
                  );
                },
              }}
            />
            {pgnProgress && (() => {
              const W = 500, H = 100, mid = H / 2;
              const { evals, total } = pgnProgress;
              const clamp = (v: number) => Math.max(-6, Math.min(6, v));
              const pts: [number, number][] = evals.map((ev, i) => [
                (i / Math.max(total - 1, 1)) * W,
                mid - (clamp(ev) / 6) * mid,
              ]);

              // smooth cubic bezier (control points at horizontal midpoint)
              let fill = '', stroke = '';
              if (pts.length === 1) {
                fill = `M ${pts[0][0]} ${H} L ${pts[0][0]} ${pts[0][1]} L ${pts[0][0]} ${H} Z`;
              } else if (pts.length >= 2) {
                const seg = pts.map(([x, y], i) => {
                  if (i === 0) return `M ${x} ${y}`;
                  const [px, py] = pts[i - 1];
                  const cx = (px + x) / 2;
                  return `C ${cx} ${py} ${cx} ${y} ${x} ${y}`;
                }).join(' ');
                fill = `M ${pts[0][0]} ${H} L ${pts[0][0]} ${pts[0][1]} ${seg.slice(seg.indexOf('C'))} L ${pts[pts.length-1][0]} ${H} Z`;
                stroke = seg;
              }

              const lastX = pts.length > 0 ? pts[pts.length - 1][0] : 0;

              return (
                <div style={{
                  position: 'absolute', inset: 0, zIndex: 9999,
                  background: 'rgba(10,10,10,0.88)',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  gap: '16px', borderRadius: '4px',
                }}>
                  <span style={{ fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#555' }}>
                    Evaluating
                  </span>
                  <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '78%', height: '90px' }} preserveAspectRatio="none">
                    {/* 배경 */}
                    <rect x={0} y={0} width={W} height={H} fill="#1a1a1a" rx={6} />
                    {/* 미평가 구간 - flat center */}
                    {evals.length < total && (
                      <line x1={lastX} y1={mid} x2={W} y2={mid} stroke="#2a2a2a" strokeWidth={1.5} strokeDasharray="3 3" />
                    )}
                    {/* 흰 fill (백 유리 = 위, 흑 유리 = 아래) */}
                    {fill && <path d={fill} fill="rgba(255,255,255,0.92)" />}
                    {/* 중심선 */}
                    <line x1={0} y1={mid} x2={lastX || W} y2={mid} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
                    {/* 커브 stroke */}
                    {stroke && <path d={stroke} fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={1.5} />}
                    {/* 현재 평가 중인 위치 표시 */}
                    {pts.length > 0 && (
                      <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r={3} fill="#1D9E75" />
                    )}
                  </svg>
                  <span style={{ fontSize: '10px', color: '#444', letterSpacing: '0.1em' }}>
                    {pgnProgress.done} / {pgnProgress.total}
                  </span>
                </div>
              );
            })()}
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

        <div className={styles.card}>
          <div className={styles.cardLabel}>
            수순
            {openingName && <span className={styles.openingName}>{openingName}</span>}
          </div>
          <MoveList
            history={sanHistory}
            labels={moveLabels}
            currentIdx={currentIdx - 1}
            variation={variation}
            isInVariation={isInVariation}
            varFenIdx={varFenIdx}
            onJumpMain={(idx) => jumpTo(idx + 1)}
            onJumpVariation={jumpToVariation}
          />
        </div>

        <AIExplanation
          fen={fen}
          lastMove={aiLastMoveSan}
          sfResult={sfResult}
          preSfResult={preSfResult}
          label={currentLabel}
          level={currentLevel}
        />
      </div>

    </div>
  );
}
