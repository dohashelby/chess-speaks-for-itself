// lib/moveClassifier.ts
// Chess.com/Lichess 스타일 수 분류기
// Stockfish 분석 결과를 받아 각 수에 라벨을 부여
//
// 모든 eval 값은 "백 시점 폰 단위"로 통일되어 들어옴 (useStockfish에서 정규화)
// 흑에게 유리하면 음수, 백에게 유리하면 양수

// ── 타입 ─────────────────────────────────────────────────

export type MoveLabel =
  | 'brilliant'   // 탁월수 ✦
  | 'great'       // 호수   ★ (포지션 전환)
  | 'best'        // 최선수 ✓
  | 'excellent'   // 우수   ○
  | 'good'        // 양호   (무라벨)
  | 'book'        // 이론수 📖
  | 'inaccuracy'  // 부정확 ?
  | 'mistake'     // 실수   ?!
  | 'blunder'     // 블런더 ??
  | 'miss'        // 見落   ✗
  | 'forced'      // 강제수 (합법수 1개)
  | 'only_move';  // 유일수 □

export interface MoveAnalysis {
  san: string;
  uci: string;
  fen_before: string;
  fen_after: string;
  label: MoveLabel;
  eval_before: number;   // 백 시점 폰 단위
  eval_after: number;
  eval_loss: number;
  best_move_uci: string;
  best_eval: number;
  top_lines: TopLine[];
  is_sacrifice: boolean;
  only_move_threshold: number;
}

export interface TopLine {
  moves: string;
  cp: number;        // centipawns, 백 시점
  mate: number | null;
}

export interface GameAnalysis {
  moves: MoveAnalysis[];
  accuracy: { white: number; black: number };
  summary: { white: Record<MoveLabel, number>; black: Record<MoveLabel, number> };
}

// ── 승률 변환 (Lichess 표준) ────────────────────────────────
// cp: centipawn, 백 시점. ±1000으로 클램핑
// 반환: 0.0 (흑 완승) ~ 1.0 (백 완승)

function winPercent(cpWhitePerspective: number): number {
  const clamped = Math.max(-1000, Math.min(1000, cpWhitePerspective));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * clamped)) - 1);
}

// 현재 플레이어 시점 승률 (0~100)
// 백이면 그대로, 흑이면 100에서 빼기
function playerWinPercent(evalWhitePawns: number, turn: 'w' | 'b'): number {
  const wp = winPercent(evalWhitePawns * 100);
  return turn === 'w' ? wp : 100 - wp;
}

// ── 정확도 계산 (Lichess 표준) ──────────────────────────────

function moveAccuracy(winDiff: number): number {
  // winDiff: 수를 두기 전 승률 - 수를 둔 후 승률 (현재 플레이어 시점, 양수=나빠짐)
  if (winDiff <= 0) return 100; // 포지션이 좋아졌으면 100%
  return Math.max(0, Math.min(100,
    103.1668 * Math.exp(-0.04354 * winDiff) - 3.1669
  ));
}

// ── 핵심 분류 함수 ────────────────────────────────────────

export function classifyMove(params: {
  eval_before: number;      // 백 시점 폰 단위, 수 두기 전
  eval_after: number;       // 백 시점 폰 단위, 수 둔 후
  best_eval: number;        // 최선수를 뒀을 때 예상 eval (백 시점)
  played_uci: string;
  best_uci: string;
  turn: 'w' | 'b';         // 이 수를 둔 플레이어
  is_sacrifice: boolean;
  top_lines: TopLine[];
  legal_move_count?: number;  // 합법수 개수 (1이면 강제수)
  is_book?: boolean;          // 오프닝 이론수 여부
  only_move_margin?: number;
}): { label: MoveLabel; eval_loss: number; is_only_move: boolean } {
  const {
    eval_before,
    eval_after,
    best_eval,
    played_uci,
    best_uci,
    turn,
    is_sacrifice,
    top_lines,
    legal_move_count,
    is_book = false,
    only_move_margin = 0.5,
  } = params;

  // ── 이론수 ────────────────────────────────────────────
  if (is_book) {
    return { label: 'book', eval_loss: 0, is_only_move: false };
  }

  // ── 강제수 (합법수 1개) ───────────────────────────────
  if (legal_move_count === 1) {
    return { label: 'forced', eval_loss: 0, is_only_move: false };
  }

  // ── 현재 플레이어 시점 승률 계산 ──────────────────────
  const wpBefore = playerWinPercent(eval_before, turn);
  const wpAfter  = playerWinPercent(eval_after, turn);
  const wpBest   = playerWinPercent(best_eval, turn);

  // 승률 손실 (현재 플레이어 시점, 양수 = 나빠짐)
  // "최선수를 뒀을 때의 내 승률" - "실제로 둔 수의 내 승률"
  const wpDrop = Math.max(0, wpBest - wpAfter);

  // eval_loss: 폰 단위 손실 (참고용, 분류에는 wpDrop 사용)
  const eval_loss_raw = turn === 'w'
    ? best_eval - eval_after
    : eval_after - best_eval;
  const loss = Math.max(0, eval_loss_raw);

  const played_best = played_uci === best_uci;

  // 상위 라인 간 격차 (현재 플레이어 시점)
  const bestCp   = top_lines[0]?.cp ?? 0;
  const secondCp = top_lines[1]?.cp ?? bestCp;
  // top_lines cp는 백 시점이므로, 흑이면 부호 반전하여 격차 계산
  const lineGapSigned = turn === 'w'
    ? (bestCp - secondCp)
    : (secondCp - bestCp); // 흑 시점: 2순위가 더 양수(백 유리)면 1순위가 흑에게 더 좋음
  const lineGap = lineGapSigned / 100;

  // ── 절망적 포지션 가드 (Lichess) ──────────────────────
  // 이미 승률 30% 이하면 blunder 불가
  const isHopeless = wpBefore < 30;

  // ── 메이트 기회 놓침 ──────────────────────────────────
  const bestMate = top_lines[0]?.mate ?? null;
  // 현재 플레이어에게 유리한 메이트가 있었는지
  const hadMateForPlayer = bestMate !== null &&
    ((turn === 'w' && bestMate > 0) || (turn === 'b' && bestMate < 0));
  if (hadMateForPlayer && !played_best) {
    return { label: 'miss', eval_loss: loss, is_only_move: false };
  }

  // ── 탁월수 판별 ───────────────────────────────────────
  // 희생 + 최선수 + 승률 유지 + 2순위와 큰 격차
  // + 이미 압승 중이면 불가 (wpBefore < 97)
  // + 이미 지고 있으면 불가 (wpBefore > 15)
  if (played_best && is_sacrifice && wpDrop <= 1) {
    const notAlreadyWinning = wpBefore < 97;
    const notAlreadyLosing  = wpBefore > 15;
    if (notAlreadyWinning && notAlreadyLosing && lineGap >= 0.5) {
      return { label: 'brilliant', eval_loss: 0, is_only_move: false };
    }
  }

  // ── Great move (포지션 전환) ───────────────────────────
  // 열세→균형 또는 균형→우세로 전환 (10%p 이상 스윙, 50% 경계 통과)
  if (wpDrop <= 1) {
    const crossedFifty =
      (wpBefore < 50 && wpAfter >= 50) ||  // 열세→균형/우세
      (wpBefore < 40 && wpAfter >= 40);     // 크게 열세→열세 탈출
    const swing = wpAfter - wpBefore;
    if (crossedFifty && swing >= 10) {
      return { label: 'great', eval_loss: 0, is_only_move: false };
    }
  }

  // ── 유일수 판별 ───────────────────────────────────────
  const is_only_move =
    top_lines.length >= 2 &&
    played_best &&
    lineGap >= only_move_margin;

  if (is_only_move) {
    return { label: 'only_move', eval_loss: 0, is_only_move: true };
  }

  // ── 최선수 vs 일반수 ─────────────────────────────────
  if (played_best && wpDrop <= 0.5) {
    if (lineGap >= 0.3) {
      return { label: 'best', eval_loss: 0, is_only_move: false };
    }
    return { label: 'good', eval_loss: 0, is_only_move: false };
  }

  // ── 승률 drop 기반 분류 ───────────────────────────────
  if (wpDrop < 2) {
    return lineGap >= 0.2
      ? { label: 'excellent', eval_loss: loss, is_only_move: false }
      : { label: 'good',      eval_loss: loss, is_only_move: false };
  }
  if (wpDrop < 5)  return { label: 'good',       eval_loss: loss, is_only_move: false };
  if (wpDrop < 10) return { label: 'inaccuracy', eval_loss: loss, is_only_move: false };
  if (wpDrop < 20) {
    // 절망적 포지션이면 mistake까지만
    return { label: 'mistake', eval_loss: loss, is_only_move: false };
  }
  // 절망적 포지션 가드: 승률 30% 이하면 blunder 대신 mistake
  if (isHopeless) {
    return { label: 'mistake', eval_loss: loss, is_only_move: false };
  }
  return { label: 'blunder', eval_loss: loss, is_only_move: false };
}

// ── 정확도 계산 (Lichess 표준) ──────────────────────────────

export function calcAccuracy(moves: MoveAnalysis[], color: 'w' | 'b'): number {
  const turn = color;
  const colorMoves = moves.filter((_, i) =>
    color === 'w' ? i % 2 === 0 : i % 2 !== 0
  );
  if (colorMoves.length === 0) return 100;

  let total = 0;
  for (const m of colorMoves) {
    const wpBefore = playerWinPercent(m.eval_before, turn);
    const wpAfter  = playerWinPercent(m.eval_after, turn);
    const winDiff = Math.max(0, wpBefore - wpAfter);
    total += moveAccuracy(winDiff);
  }

  return Math.round(total / colorMoves.length);
}

// ── 라벨 메타 (UI 렌더링용) ───────────────────────────────

export const LABEL_META: Record<MoveLabel, {
  ko: string;
  symbol: string;
  color: string;
  bg: string;
  priority: number;
}> = {
  brilliant:  { ko: '탁월수', symbol: '!!',  color: '#1baca6', bg: '#0d3d3b', priority: 1 },
  great:      { ko: '호수',   symbol: '!',   color: '#5c9ee6', bg: '#132a44', priority: 2 },
  only_move:  { ko: '유일수', symbol: '□',   color: '#9040e0', bg: '#2d1a4a', priority: 2 },
  best:       { ko: '최선수', symbol: '✓',   color: '#4caf70', bg: '#0d2b1a', priority: 5 },
  excellent:  { ko: '우수',   symbol: '○',   color: '#7bc96f', bg: '#152a12', priority: 6 },
  good:       { ko: '양호',   symbol: '',    color: '#888',    bg: 'transparent', priority: 7 },
  book:       { ko: '이론수', symbol: '📖',  color: '#a08060', bg: '#2a2010', priority: 8 },
  forced:     { ko: '강제수', symbol: '—',   color: '#666',    bg: 'transparent', priority: 8 },
  inaccuracy: { ko: '부정확', symbol: '?',   color: '#f0c040', bg: '#3a2d00', priority: 4 },
  mistake:    { ko: '실수',   symbol: '?!',  color: '#e07000', bg: '#3a1c00', priority: 3 },
  blunder:    { ko: '블런더', symbol: '??',  color: '#e04040', bg: '#3a0000', priority: 2 },
  miss:       { ko: '見落',   symbol: '✗',   color: '#e04040', bg: '#3a0000', priority: 2 },
};

// 자동 해설을 트리거할 라벨 (priority <= 4)
export const AUTO_EXPLAIN_LABELS = new Set<MoveLabel>([
  'brilliant', 'great', 'only_move', 'blunder', 'mistake', 'miss', 'inaccuracy',
]);
