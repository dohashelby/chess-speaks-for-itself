// lib/moveClassifier.ts
// Chess.com/Lichess 스타일 수 분류기
// Stockfish 분석 결과를 받아 각 수에 라벨을 부여
//
// 모든 eval 값은 "백 시점 폰 단위"로 통일되어 들어옴 (useStockfish에서 정규화)
// 흑에게 유리하면 음수, 백에게 유리하면 양수

import { Chess, Square, PieceSymbol } from 'chess.js';

// ── 타입 ─────────────────────────────────────────────────

export type MoveLabel =
  | 'brilliant'   // 탁월수 ✦
  | 'great'       // 호수   ★ (포지션 전환)
  | 'best'        // 최선수 ✓
  | 'excellent'   // 우수   ○
  | 'good'        // 양호   (무라벨)
  | 'book'        // 이론수 📖
  | 'inaccuracy'  // 부정확 ?!
  | 'mistake'     // 실수   ?
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

// 라인의 승률 계산 (mate 처리 포함)
function lineWinPercent(line: { cp: number; mate: number | null } | undefined, turn: 'w' | 'b'): number {
  if (!line) return 50;
  if (line.mate !== null) {
    const whiteWins = line.mate > 0;
    return turn === 'w' ? (whiteWins ? 100 : 0) : (whiteWins ? 0 : 100);
  }
  return playerWinPercent(line.cp / 100, turn);
}

// ── 정확도 계산 (Lichess 표준) ──────────────────────────────

function moveAccuracy(winDiff: number): number {
  // winDiff: 수를 두기 전 승률 - 수를 둔 후 승률 (현재 플레이어 시점, 양수=나빠짐)
  if (winDiff <= 0) return 100; // 포지션이 좋아졌으면 100%
  return Math.max(0, Math.min(100,
    103.1668 * Math.exp(-0.04354 * winDiff) - 3.1669
  ));
}

// ── Brilliant 판별 (WintrChess 로직) ─────────────────────────

interface BP { square: Square; type: PieceSymbol; color: 'w' | 'b' }

function boardPieces(board: Chess): BP[] {
  return board.board().flat().filter((p): p is BP => p !== null);
}

function fenSetTurn(fen: string, turn: 'w' | 'b'): string {
  const parts = fen.split(' ');
  parts[1] = turn;
  return parts.join(' ');
}

// 해당 기물을 직접 잡을 수 있는 상대 기물 목록
function directAttackers(board: Chess, piece: BP): BP[] {
  try {
    const oppBoard = new Chess(fenSetTurn(board.fen(), piece.color === 'w' ? 'b' : 'w'));
    return oppBoard.moves({ verbose: true })
      .filter(m => m.to === piece.square && m.captured)
      .map(m => ({ square: m.from as Square, type: m.piece as PieceSymbol, color: m.color as 'w' | 'b' }));
  } catch { return []; }
}

const PIECE_VAL_BR: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 99 };

// 기물이 안전한지 판단 (WintrChess pieceSafety 간소화 버전)
function isPieceSafeBR(board: Chess, piece: BP): boolean {
  const attackers = directAttackers(board, piece);
  if (attackers.length === 0) return true;

  // 더 낮은 가치의 공격자가 있으면 안전하지 않음
  if (attackers.some(a => PIECE_VAL_BR[a.type] < PIECE_VAL_BR[piece.type])) return false;

  // 방어자 수 확인
  try {
    const defBoard = new Chess(fenSetTurn(board.fen(), piece.color));
    const defenders = defBoard.moves({ verbose: true }).filter(m => m.to === piece.square);
    if (attackers.length > defenders.length) return false;
  } catch {}

  return true;
}

// 해당 색깔의 안전하지 않은 기물 목록 (폰·킹 제외)
// capturedValue: 방금 잡은 기물의 가치 (이보다 가치가 높은 기물만 대상 — WintrChess 동일 조건)
// 등가교환(나이트↔나이트 등) 후 재잡기는 희생이 아니므로 제외
function getUnsafePiecesBR(board: Chess, color: 'w' | 'b', capturedValue = 0): BP[] {
  return boardPieces(board).filter(p =>
    p.color === color &&
    p.type !== 'p' && p.type !== 'k' &&
    PIECE_VAL_BR[p.type] > capturedValue &&
    !isPieceSafeBR(board, p)
  );
}

// 위험 기물을 잡았을 때 오히려 더 큰 위협이 생기는지 검사
// WintrChess hasDangerLevels(equalityStrategy="leaves") 에 대응
function hasCounterThreatProtection(board: Chess, unsafePiece: BP): boolean {
  const attackers = directAttackers(board, unsafePiece);
  if (attackers.length === 0) return true; // 공격자가 없으면 보호됨

  return attackers.every(attacker => {
    try {
      // 상대가 해당 기물을 잡은 상황 시뮬레이션
      const simBoard = new Chess(fenSetTurn(board.fen(), attacker.color));
      simBoard.move({ from: attacker.square, to: unsafePiece.square });

      // 잡은 후, 공격자의 색 기물 중 위험해진 기물이 있고
      // 그 가치가 잡힌 기물 이상이면 → 역위협 존재
      const newUnsafe = getUnsafePiecesBR(simBoard, attacker.color);
      if (newUnsafe.some(p => PIECE_VAL_BR[p.type] >= PIECE_VAL_BR[unsafePiece.type])) return true;

      // 잡은 후 체크메이트 가능하면 역위협 존재
      if (simBoard.moves().some(m => m.includes('#'))) return true;

      return false;
    } catch { return false; }
  });
}

// 기물이 갇혀 있는지 판단 (모든 도망 경로가 안전하지 않음)
function isPieceTrappedBR(board: Chess, piece: BP): boolean {
  if (isPieceSafeBR(board, piece)) return false;
  try {
    const moveBoard = new Chess(fenSetTurn(board.fen(), piece.color));
    const moves = moveBoard.moves({ square: piece.square, verbose: true });
    if (moves.length === 0) return true;
    return moves.every(m => {
      try {
        const escapeBoard = new Chess(moveBoard.fen());
        const escaped = escapeBoard.move(m);
        return !isPieceSafeBR(escapeBoard, { ...piece, square: escaped.to as Square });
      } catch { return true; }
    });
  } catch { return false; }
}

// WintrChess considerBrilliantClassification 포팅
function considerBrilliant(
  fenBefore: string,
  playedUci: string,
  played_best: boolean,
  wpAfter: number,
  secondLineCp: number | null,
  secondLineMate: number | null,
  turn: 'w' | 'b'
): boolean {
  if (!played_best) return false;

  // 프로모션 수는 brilliant 불가
  if (playedUci.length >= 5) return false;

  // 수를 둔 후 유리해야 함 (Critical candidate: 지고 있으면 안됨)
  if (wpAfter < 50) return false;

  // 2순위 수가 이미 완전히 이기는 수라면 (700cp ≈ 97% 이상) brilliant 불가
  if (secondLineCp !== null || secondLineMate !== null) {
    const secondWp = lineWinPercent(
      { cp: secondLineCp ?? 0, mate: secondLineMate ?? null },
      turn
    );
    if (secondWp >= 97) return false;
  }

  try {
    const beforeBoard = new Chess(fenBefore);

    // 체크를 피하는 수는 brilliant 불가
    if (beforeBoard.isCheck()) return false;

    // 수 실행 및 잡은 기물 가치 추출
    const afterBoard = new Chess(fenBefore);
    const playedMove = afterBoard.move({
      from: playedUci.slice(0, 2) as Square,
      to: playedUci.slice(2, 4) as Square,
    });
    // 잡은 기물과 같은 가치 이하의 기물은 unsafe 대상에서 제외 (등가교환 재잡기)
    const capturedValue = playedMove.captured ? (PIECE_VAL_BR[playedMove.captured] ?? 0) : 0;

    const prevUnsafe = getUnsafePiecesBR(beforeBoard, turn);
    const currUnsafe = getUnsafePiecesBR(afterBoard, turn, capturedValue);

    // 안전한 곳으로 이동(unsafe 기물 감소)하면 brilliant 불가
    if (currUnsafe.length < prevUnsafe.length) return false;

    // 수 후 unsafe 기물이 없으면 brilliant 불가
    if (currUnsafe.length === 0) return false;

    // 모든 unsafe 기물이 역위협으로 보호되면 brilliant 불가
    // (역위협이 있으면 진짜 희생이 아님)
    const dangerLevelsProtected = currUnsafe.every(p => hasCounterThreatProtection(afterBoard, p));
    if (dangerLevelsProtected) return false;

    // Trapped piece 검사
    const prevTrapped = prevUnsafe.filter(p => isPieceTrappedBR(beforeBoard, p));
    const currTrapped = currUnsafe.filter(p => isPieceTrappedBR(afterBoard, p));

    const movedFrom = playedUci.slice(0, 2) as Square;
    const movedPieceWasTrapped = prevTrapped.some(p => p.square === movedFrom);

    // 이미 갇혀 있던 기물을 희생하거나, 모든 unsafe 기물이 갇혀 있으면 brilliant 불가
    if (movedPieceWasTrapped) return false;
    if (currTrapped.length === currUnsafe.length) return false;
    if (currTrapped.length < prevTrapped.length) return false;

    return true;
  } catch {
    return false;
  }
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
  fen_before?: string;        // brilliant 판별용 (수 두기 전 FEN)
}): { label: MoveLabel; eval_loss: number; is_only_move: boolean; reason: string; debug: Record<string, number | string | boolean> } {
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
    fen_before,
  } = params;

  // ── 강제수 (합법수 1개) ───────────────────────────────
  if (legal_move_count === 1) {
    return { label: 'forced', eval_loss: 0, is_only_move: false, reason: '합법수가 1개뿐인 강제수', debug: { legal_move_count } };
  }

  // ── 현재 플레이어 시점 승률 계산 ──────────────────────
  const wpBefore = playerWinPercent(eval_before, turn);
  const wpAfter  = playerWinPercent(eval_after, turn);
  const wpBest   = playerWinPercent(best_eval, turn);

  // 승률 손실 (현재 플레이어 시점, 양수 = 나빠짐)
  const wpDrop = Math.max(0, wpBest - wpAfter);

  // eval_loss: 폰 단위 손실 (참고용)
  const eval_loss_raw = turn === 'w'
    ? best_eval - eval_after
    : eval_after - best_eval;
  const loss = Math.max(0, eval_loss_raw);

  const played_best = played_uci === best_uci;

  // 상위 라인 간 격차 (수 두기 전 포지션 기준)
  // top_lines[0] = 최선수, top_lines[1] = 2순위
  // cp는 백 시점 센티폰
  const bestCp   = top_lines[0]?.cp ?? 0;
  const secondCp = top_lines[1]?.cp ?? bestCp;
  const lineGap = Math.abs(bestCp - secondCp) / 100;

  const isHopeless = wpBefore < 30;

  // 공통 디버그 데이터
  const d = {
    turn,
    played_uci,
    best_uci,
    played_best,
    is_sacrifice,
    eval_before: +eval_before.toFixed(2),
    eval_after: +eval_after.toFixed(2),
    best_eval: +best_eval.toFixed(2),
    wpBefore: +wpBefore.toFixed(1),
    wpAfter: +wpAfter.toFixed(1),
    wpBest: +wpBest.toFixed(1),
    wpDrop: +wpDrop.toFixed(2),
    lineGap: +lineGap.toFixed(2),
    loss: +loss.toFixed(2),
    isHopeless,
  };

  // ── 메이트 기회 놓침 ──────────────────────────────────
  const bestMate = top_lines[0]?.mate ?? null;
  const hadMateForPlayer = bestMate !== null &&
    ((turn === 'w' && bestMate > 0) || (turn === 'b' && bestMate < 0));
  if (hadMateForPlayer && !played_best) {
    return { label: 'miss', eval_loss: loss, is_only_move: false, reason: `메이트(M${Math.abs(bestMate!)}) 기회를 놓침 — 최선수: ${best_uci}`, debug: { ...d, bestMate } };
  }

  // ── 탁월수 판별 (WintrChess 로직) ─────────────────────
  if (played_best && fen_before) {
    const secondLine = top_lines[1];
    const isBrilliant = considerBrilliant(
      fen_before,
      played_uci,
      played_best,
      wpAfter,
      secondLine?.cp ?? null,
      secondLine?.mate ?? null,
      turn
    );
    if (isBrilliant) {
      return { label: 'brilliant', eval_loss: 0, is_only_move: false, reason: `희생수 brilliant: 역위협 없는 unsafe piece 존재 (WintrChess 기준)`, debug: d };
    }
  }

  // ── Great move (포지션 전환) ───────────────────────────
  if (wpDrop <= 1) {
    const crossedFifty =
      (wpBefore < 50 && wpAfter >= 50) ||
      (wpBefore < 40 && wpAfter >= 40);
    const swing = wpAfter - wpBefore;
    if (crossedFifty && swing >= 10) {
      return { label: 'great', eval_loss: 0, is_only_move: false, reason: `포지션 전환: 승률 ${wpBefore.toFixed(0)}% → ${wpAfter.toFixed(0)}% (swing +${swing.toFixed(0)}%)`, debug: d };
    }
  }

  // ── 유일수 판별 ───────────────────────────────────────
  // 이 수만 현재 플레이어의 승률을 50% 이상으로 유지하고,
  // 2순위 수는 상대에게 유리해지는 경우
  const secondLineWp = lineWinPercent(top_lines[1], turn);
  const is_only_move =
    played_best &&
    wpAfter >= 50 &&
    top_lines.length >= 2 &&
    secondLineWp < 50 &&
    lineGap >= 1;

  if (is_only_move) {
    return { label: 'only_move', eval_loss: 0, is_only_move: true, reason: `유일하게 유리함을 유지하는 수 (2순위 승률 ${secondLineWp.toFixed(0)}% < 50%)`, debug: d };
  }

  // ── 최선수 vs 일반수 ─────────────────────────────────
  if (played_best && wpDrop <= 0.5) {
    if (lineGap >= 0.3) {
      return { label: 'best', eval_loss: 0, is_only_move: false, reason: `최선수, 라인격차 ${lineGap.toFixed(2)} ≥ 0.3 (찾기 어려운 수)`, debug: d };
    }
    return bookOrLabel('good', 0, `최선수이지만 라인격차 ${lineGap.toFixed(2)} < 0.3 (뻔한 수)`);
  }

  // ── 승률 drop 기반 분류 ───────────────────────────────
  if (wpDrop < 2) {
    if (lineGap >= 0.2) {
      return { label: 'excellent', eval_loss: loss, is_only_move: false, reason: `wpDrop ${wpDrop.toFixed(2)}% < 2%, 라인격차 ${lineGap.toFixed(2)} ≥ 0.2`, debug: d };
    }
    return bookOrLabel('good', loss, `wpDrop ${wpDrop.toFixed(2)}% < 2%, 라인격차 ${lineGap.toFixed(2)} < 0.2`);
  }
  if (wpDrop < 5)  return bookOrLabel('good',       loss, `wpDrop ${wpDrop.toFixed(2)}% < 5%`);
  if (wpDrop < 10) return { label: 'inaccuracy', eval_loss: loss, is_only_move: false, reason: `wpDrop ${wpDrop.toFixed(2)}% (5~10%)`, debug: d };
  if (wpDrop < 20) return { label: 'mistake',    eval_loss: loss, is_only_move: false, reason: `wpDrop ${wpDrop.toFixed(2)}% (10~20%)`, debug: d };
  if (isHopeless)  return { label: 'mistake',    eval_loss: loss, is_only_move: false, reason: `wpDrop ${wpDrop.toFixed(2)}% ≥ 20%이지만 절망적 포지션(wp ${wpBefore.toFixed(0)}% < 30%)`, debug: d };
  return { label: 'blunder', eval_loss: loss, is_only_move: false, reason: `wpDrop ${wpDrop.toFixed(2)}% ≥ 20%`, debug: d };

  // 이론수 판별: 품질이 good 이상이고 masters DB에 있으면 book으로 표시
  // 나쁜 수는 DB에 있어도 inaccuracy/mistake/blunder 유지
  function bookOrLabel(label: MoveLabel, evalLoss: number, reason: string) {
    if (is_book) {
      return { label: 'book' as MoveLabel, eval_loss: evalLoss, is_only_move: false, reason: `이론수 (${reason})`, debug: { ...d, is_book } };
    }
    return { label, eval_loss: evalLoss, is_only_move: false, reason, debug: d };
  }
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
  inaccuracy: { ko: '부정확', symbol: '?!',  color: '#f0c040', bg: '#3a2d00', priority: 4 },
  mistake:    { ko: '실수',   symbol: '?',   color: '#e07000', bg: '#3a1c00', priority: 3 },
  blunder:    { ko: '블런더', symbol: '??',  color: '#e04040', bg: '#3a0000', priority: 2 },
  miss:       { ko: '見落',   symbol: '✗',   color: '#e04040', bg: '#3a0000', priority: 2 },
};

// 자동 해설을 트리거할 라벨 (priority <= 4)
export const AUTO_EXPLAIN_LABELS = new Set<MoveLabel>([
  'brilliant', 'great', 'only_move', 'blunder', 'mistake', 'miss', 'inaccuracy',
]);
