// lib/moveClassifier.ts
// Chess.com 스타일 수 분류기
// Stockfish 분석 결과를 받아 각 수에 라벨을 부여

import { Chess, Move } from 'chess.js';

// ── 타입 ─────────────────────────────────────────────────

export type MoveLabel =
  | 'brilliant'   // 탁월수 ✦ 희생을 포함한 최선수
  | 'best'        // 최선수 ✓
  | 'excellent'   // 우수   ○
  | 'good'        // 양호   (무라벨)
  | 'inaccuracy'  // 부정확 ?
  | 'mistake'     // 실수   ?!  (Chess.com은 실제로 ?!)
  | 'blunder'     // 블런더 ??
  | 'miss'        // 見落   — 메이트 기회 놓침
  | 'only_move';  // 유일수 — 이 수만이 포지션을 유지

export interface MoveAnalysis {
  san: string;           // 대수 표기 (예: Nf3)
  uci: string;           // UCI (예: g1f3)
  fen_before: string;    // 이 수 두기 전 FEN
  fen_after: string;     // 이 수 두고 난 후 FEN
  label: MoveLabel;
  eval_before: number;   // 이 수 두기 전 평가 (백 시점, 폰 단위)
  eval_after: number;    // 이 수 두고 난 후 평가
  eval_loss: number;     // eval 손실 (양수 = 나빠짐)
  best_move_uci: string; // SF가 추천한 최선수 UCI
  best_eval: number;     // 최선수를 뒀을 때 예상 평가
  top_lines: TopLine[];  // SF MultiPV 상위 라인
  is_sacrifice: boolean; // 가치 낮은 기물로 가치 높은 기물 잡음
  only_move_threshold: number; // 유일수 판별에 쓴 임계값
}

export interface TopLine {
  moves: string;   // UCI space-separated
  cp: number;      // centipawns (mate = ±9999)
  mate: number | null;
}

export interface GameAnalysis {
  moves: MoveAnalysis[];
  accuracy: {           // Chess.com 스타일 정확도 (0~100)
    white: number;
    black: number;
  };
  summary: {            // 라벨별 카운트
    white: Record<MoveLabel, number>;
    black: Record<MoveLabel, number>;
  };
}

// ── 기물 가치 ─────────────────────────────────────────────

const PIECE_VALUE: Record<string, number> = {
  p: 1, n: 3, b: 3, r: 5, q: 9, k: 0,
};

// ── eval 정규화 (항상 현재 플레이어 시점) ─────────────────
// chess.js turn() === 'w' 이면 양수가 좋음, 'b'이면 음수가 좋음
// 여기서는 "백 시점" 절대값으로 통일

function normalizeEval(cp: number, turn: 'w' | 'b'): number {
  // SF는 항상 현재 플레이어 기준으로 출력
  // 백 차례면 그대로, 흑 차례면 부호 반전
  return turn === 'w' ? cp / 100 : -cp / 100;
}

// ── 희생 판별 ─────────────────────────────────────────────

function isSacrifice(move: Move, chess: Chess): boolean {
  // 잡기 수가 아니면 희생 아님
  if (!move.flags.includes('c') && !move.flags.includes('e')) return false;

  const movedValue = PIECE_VALUE[move.piece] ?? 0;
  const capturedValue = PIECE_VALUE[move.captured ?? ''] ?? 0;

  // 더 비싼 기물로 더 싼 기물을 잡음 = 희생 후보
  return movedValue > capturedValue;
}

// ── 핵심 분류 함수 ────────────────────────────────────────

export function classifyMove(params: {
  eval_before: number;      // 백 시점 폰 단위, 이 수 두기 전
  eval_after: number;       // 백 시점 폰 단위, 이 수 두고 난 후
  best_eval: number;        // 최선수를 뒀을 때 예상 eval (백 시점)
  played_uci: string;
  best_uci: string;
  turn: 'w' | 'b';
  is_sacrifice: boolean;
  top_lines: TopLine[];
  only_move_margin?: number; // 유일수 판별 마진 (기본 0.5)
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
    only_move_margin = 0.5,
  } = params;

  // eval_loss: 최선수 대비 손실 (항상 양수 = 나빠짐)
  // 백이라면 best_eval - eval_after, 흑이라면 eval_after - best_eval
  const eval_loss = turn === 'w'
    ? best_eval - eval_after
    : eval_after - best_eval;

  const loss = Math.max(0, eval_loss);

  // ── 유일수 판별 ───────────────────────────────────────
  // SF MultiPV에서 2순위 이하가 모두 1순위보다 only_move_margin 이상 나쁠 때
  const is_only_move =
    top_lines.length >= 2 &&
    played_uci === best_uci &&
    (() => {
      const best_cp = top_lines[0]?.cp ?? 0;
      const second_cp = top_lines[1]?.cp ?? 0;
      // 현재 플레이어 기준: 1순위가 훨씬 좋음
      return (best_cp - second_cp) / 100 >= only_move_margin;
    })();

  // ── 메이트 기회 놓침 ──────────────────────────────────
  // 이 수 전에 메이트가 있었는데 놓친 경우
  const had_mate_before = top_lines[0]?.mate !== null && (top_lines[0]?.mate ?? 0) > 0;
  const played_best = played_uci === best_uci;
  if (had_mate_before && !played_best) {
    return { label: 'miss', eval_loss: loss, is_only_move: false };
  }

  // ── 탁월수 판별 ───────────────────────────────────────
  // 희생이 포함된 최선수이고, eval이 유지되거나 상승
  if (played_best && is_sacrifice && loss <= 0.1) {
    return { label: 'brilliant', eval_loss: 0, is_only_move };
  }

  // ── 유일수 (탁월수보다 낮은 우선순위) ─────────────────
  if (is_only_move) {
    return { label: 'only_move', eval_loss: 0, is_only_move: true };
  }

  // ── 최선수 ────────────────────────────────────────────
  if (played_best && loss <= 0.05) {
    return { label: 'best', eval_loss: 0, is_only_move: false };
  }

  // ── 이하 loss 기반 분류 ───────────────────────────────
  if (loss < 0.1)  return { label: 'excellent',  eval_loss: loss, is_only_move: false };
  if (loss < 0.3)  return { label: 'good',       eval_loss: loss, is_only_move: false };
  if (loss < 0.9)  return { label: 'inaccuracy', eval_loss: loss, is_only_move: false };
  if (loss < 2.0)  return { label: 'mistake',    eval_loss: loss, is_only_move: false };
  return               { label: 'blunder',    eval_loss: loss, is_only_move: false };
}

// ── 정확도 계산 (Chess.com 방식 근사) ────────────────────
// 각 수의 eval_loss를 승리 확률 변환 후 평균

function winProb(cp: number): number {
  // Logistic 변환: 1 / (1 + 10^(-cp/4))
  return 1 / (1 + Math.pow(10, -cp / 4));
}

export function calcAccuracy(moves: MoveAnalysis[], color: 'w' | 'b'): number {
  const colorMoves = moves.filter((_, i) =>
    color === 'w' ? i % 2 === 0 : i % 2 !== 0
  );
  if (colorMoves.length === 0) return 100;

  let total = 0;
  for (const m of colorMoves) {
    const wp_before = winProb(m.eval_before * 100);
    const wp_after  = winProb(m.eval_after  * 100);
    const wp_best   = winProb(m.best_eval   * 100);

    const accuracy_this =
      wp_best === wp_before
        ? 100
        : Math.max(0, Math.min(100,
            100 * (1 - (wp_best - wp_after) / Math.max(wp_best - wp_before, 0.001))
          ));
    total += accuracy_this;
  }

  return Math.round(total / colorMoves.length);
}

// ── 라벨 메타 (UI 렌더링용) ───────────────────────────────

export const LABEL_META: Record<MoveLabel, {
  ko: string;
  symbol: string;
  color: string;
  bg: string;
  priority: number;  // 1 = 가장 중요 (자동 설명 트리거)
}> = {
  brilliant:  { ko: '탁월수', symbol: '!!',  color: '#1baca6', bg: '#0d3d3b', priority: 1 },
  only_move:  { ko: '유일수', symbol: '□',   color: '#9040e0', bg: '#2d1a4a', priority: 2 },
  best:       { ko: '최선수', symbol: '✓',   color: '#4caf70', bg: '#0d2b1a', priority: 5 },
  excellent:  { ko: '우수',   symbol: '!',   color: '#7bc96f', bg: '#152a12', priority: 6 },
  good:       { ko: '양호',   symbol: '',    color: '#888',    bg: 'transparent', priority: 7 },
  inaccuracy: { ko: '부정확', symbol: '?',   color: '#f0c040', bg: '#3a2d00', priority: 4 },
  mistake:    { ko: '실수',   symbol: '?!',  color: '#e07000', bg: '#3a1c00', priority: 3 },
  blunder:    { ko: '블런더', symbol: '??',  color: '#e04040', bg: '#3a0000', priority: 2 },
  miss:       { ko: '見落',   symbol: '✗',   color: '#e04040', bg: '#3a0000', priority: 2 },
};

// 자동 해설을 트리거할 라벨 (priority <= 4)
export const AUTO_EXPLAIN_LABELS = new Set<MoveLabel>([
  'brilliant', 'only_move', 'blunder', 'mistake', 'miss', 'inaccuracy',
]);
