// app/api/analyze/route.ts  (라벨 인식 버전)
// label 파라미터를 받아 프롬프트 톤을 자동 조정
// LLM_PROVIDER 환경 변수로 anthropic / openai / gemini 선택

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Chess, Square } from 'chess.js';
import { MoveLabel } from '@/lib/moveClassifier';

const PIECE_NAME: Record<string, string> = { p: '폰', n: '나이트', b: '비숍', r: '룩', q: '퀸', k: '킹' };

// FEN에서 기물 위치를 "백: Kg1 Qe2 Bd3 ... / 흑: Ke8 Qd8 Nb3 ..." 형태로 반환
function piecePlacement(fen: string): string {
  const chess = new Chess(fen);
  const board = chess.board();
  const white: string[] = [];
  const black: string[] = [];
  const symbol: Record<string, string> = { p: '', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const sq = `${String.fromCharCode(97 + c)}${8 - r}`;
      const label = `${symbol[piece.type]}${sq}`;
      (piece.color === 'w' ? white : black).push(label);
    }
  }
  return `백: ${white.join(' ')}\n흑: ${black.join(' ')}`;
}

// 마지막 수가 실제로 무엇을 하는지 설명 (체크, 캡처, 폰 공격 대상)

// 현재 포지션에서 즉각적으로 가능한 캡처 목록 (상대가 잡을 수 있는 기물)
function immediateCaptures(fen: string): string {
  try {
    const chess = new Chess(fen);
    const captures = chess.moves({ verbose: true }).filter(m => m.captured);
    if (!captures.length) return '';
    return captures.map(m => `${m.san}(${m.to}의 ${PIECE_NAME[m.captured!]} 잡음)`).join(', ');
  } catch { return ''; }
}

// 마지막 수를 둔 기물이 현재 공격하는 적 기물 목록 (SAN으로 목적지 파싱)
function lastMoveAttackTargets(fen: string, lastMoveSan: string): string {
  if (!lastMoveSan) return '';
  try {
    const chess = new Chess(fen);
    // SAN에서 목적지 칸 추출 (마지막 2글자, +/#/=/? 제거)
    const clean = lastMoveSan.replace(/[+#!=?]/g, '');
    const toSq = clean.slice(-2) as Square;
    const piece = chess.get(toSq);
    if (!piece) return '';

    const oppColor = piece.color === 'w' ? 'b' : 'w';
    const targets: string[] = [];

    if (piece.type === 'p') {
      // 폰: 대각선 두 칸 공격
      const file = toSq.charCodeAt(0);
      const rank = parseInt(toSq[1]);
      const attackRank = piece.color === 'w' ? rank + 1 : rank - 1;
      if (attackRank >= 1 && attackRank <= 8) {
        for (const df of [-1, 1]) {
          const f = String.fromCharCode(file + df);
          if (f >= 'a' && f <= 'h') {
            const sq = `${f}${attackRank}` as Square;
            const target = chess.get(sq);
            if (target && target.color === oppColor) {
              targets.push(`${sq}의 ${PIECE_NAME[target.type]}`);
            }
          }
        }
      }
    } else {
      // 나이트/비숍/룩/퀸/킹: 합법 이동 중 캡처 가능한 칸 (핀 제외)
      // 임시로 반대편 차례로 전환해 이 기물의 공격 범위를 확인
      const opponentMoves = (() => {
        // 현재 차례(상대편)에서 이 기물이 위협받는 기물 파악이 목적
        // 대신 현재 차례의 합법 이동에서 toSq로 이동할 수 있는 기물의 캡처 목록 사용
        return chess.moves({ verbose: true, square: toSq })
          .filter(m => m.captured)
          .map(m => `${m.to}의 ${PIECE_NAME[m.captured!]}`);
      })();
      targets.push(...opponentMoves);
    }

    return targets.length ? targets.join(', ') : '';
  } catch { return ''; }
}

function uciToSan(fen: string, uci: string): string {
  if (!uci) return '';
  try {
    const chess = new Chess(fen);
    const move = chess.move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: uci[4] as 'q' | 'r' | 'b' | 'n' | undefined });
    return move?.san ?? uci;
  } catch { return uci; }
}

// 수 번호 포함 SAN 시퀀스 반환 (예: "14...Bxc6 15.Nd4 Nxd4")
function uciSequenceToSan(fen: string, uciMoves: string): string {
  const chess = new Chess(fen);
  const tokens: string[] = [];
  for (const uci of uciMoves.split(' ')) {
    if (!uci) continue;
    try {
      const moveNum = chess.moveNumber();
      const turn = chess.turn();
      const move = chess.move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: uci[4] as 'q' | 'r' | 'b' | 'n' | undefined });
      if (!move) break;
      if (turn === 'w') {
        tokens.push(`${moveNum}.${move.san}`);
      } else {
        // 흑 수: 앞에 백 수가 없으면 번호 표시
        if (tokens.length === 0) {
          tokens.push(`${moveNum}...${move.san}`);
        } else {
          tokens.push(move.san);
        }
      }
    } catch { break; }
  }
  return tokens.join(' ');
}

// ── Provider 설정 ────────────────────────────────────────────
type Provider = 'anthropic' | 'openai' | 'gemini';

const LLM_PROVIDER = (process.env.LLM_PROVIDER ?? 'anthropic') as Provider;

function getAnthropicClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function getOpenAIClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

function getGeminiModel() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '');
  return genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash',
  });
}

interface SFResult {
  bestMove: string;
  eval: number;
  mate: number | null;
  lines: { moves: string; cp: number; mate: number | null }[];
  depth: number;
  fen: string;
}

// ── 라벨별 해설 초점 ──────────────────────────────────────

// 각 라벨에서 AI가 중점적으로 다뤄야 할 분석 방향
const LABEL_FOCUS: Partial<Record<MoveLabel, string>> = {
  brilliant:
    '탁월한 희생수(Brilliant !!). 왜 이 희생이 성립하는지 — 이후 전술 수순, 상대의 대응 제한, 포지셔널 보상을 설명하세요.',
  only_move:
    '유일한 수(Only move). 이 수를 두지 않았다면 어떤 전술적 재앙이 따르는지, 이 수가 어떤 위협을 차단하는지 설명하세요.',
  good:
    '좋은 수. 이 수의 포지셔널/전술적 의미 — 어떤 이점을 만들거나 유지하는지 설명하세요.',
  blunder:
    '심각한 실수(Blunder ??). 어떤 전술적 약점·허점이 생겼는지, 상대가 어떻게 이득을 취할 수 있는지 구체적으로 설명하세요.',
  miss:
    '결정적 기회를 놓친 수(Miss). 어떤 메이트 또는 전술적 이득이 있었는지, 놓친 수순을 설명하세요.',
  mistake:
    '실수(Mistake ?). 이 수로 인해 어떤 포지셔널/전술적 손실이 생겼는지, 더 나은 방향이 무엇이었는지 설명하세요.',
  inaccuracy:
    '부정확한 수(Inaccuracy ?!). 최선수 대비 어떤 포지셔널 차이가 생겼는지 — 미묘하더라도 구체적으로 설명하세요.',
};

function buildPrompt(params: {
  fen: string;
  lastMove: string;
  sfResult: SFResult;
  preSfResult: SFResult | null;
  label: MoveLabel;
  level: 'beginner' | 'intermediate';
}): string {
  const { fen, lastMove, sfResult, preSfResult, label, level } = params;

  // FEN의 현재 차례는 방금 수를 둔 쪽의 반대
  const currentTurn = fen.split(' ')[1] ?? 'w';
  const movedBy = currentTurn === 'w' ? '흑(Black)' : '백(White)';

  // 현재 포지션 기물 배치
  const placement = piecePlacement(fen);

  // 마지막 수의 실제 효과 (캡처, 체크, 폰 위협 대상)
  // preSfResult.fen이 있으면 그걸로, 없으면 chess.js로 역산 불가 → 빈 문자열
  const moveEffectStr = (() => {
    if (!preSfResult?.fen || !lastMove) return '';
    // lastMove는 SAN이므로 UCI가 필요; preSfResult.fen에서 SAN으로 move 실행
    try {
      const chess = new Chess(preSfResult.fen);
      const move = chess.move(lastMove);
      if (!move) return '';
      const effects: string[] = [];
      if (move.captured) effects.push(`${move.to}의 ${PIECE_NAME[move.captured]} 잡음`);
      if (chess.isCheck()) effects.push('체크');
      if (move.piece === 'p' && !move.captured) {
        const file = move.to.charCodeAt(0);
        const rank = parseInt(move.to[1]);
        const attackRank = move.color === 'w' ? rank + 1 : rank - 1;
        if (attackRank >= 1 && attackRank <= 8) {
          const targets: string[] = [];
          for (const df of [-1, 1]) {
            const f = String.fromCharCode(file + df);
            if (f >= 'a' && f <= 'h') {
              const sq = `${f}${attackRank}` as Square;
              const target = chess.get(sq);
              if (target && target.color !== move.color) targets.push(`${sq}의 ${PIECE_NAME[target.type]}`);
            }
          }
          if (targets.length) effects.push(`${targets.join(', ')} 위협`);
        }
      }
      return effects.length ? `이 수의 즉각적 효과: ${effects.join(', ')}` : '';
    } catch { return ''; }
  })();

  const evalStr =
    sfResult.mate !== null
      ? `메이트 ${sfResult.mate > 0 ? '+' : ''}${sfResult.mate}`
      : `${sfResult.eval > 0 ? '+' : ''}${sfResult.eval.toFixed(2)}`;

  const bestReadable = sfResult.bestMove
    ? uciToSan(fen, sfResult.bestMove)
    : '없음';

  const topLines = sfResult.lines
    .slice(0, 3)
    .map((l, i) => {
      const score =
        l.mate !== null
          ? `M${Math.abs(l.mate)}`
          : `${l.cp > 0 ? '+' : ''}${(l.cp / 100).toFixed(1)}`;
      const sanMoves = uciSequenceToSan(fen, l.moves.split(' ').slice(0, 8).join(' '));
      return `  라인${i + 1} (${score}): ${sanMoves}`;
    })
    .join('\n');

  const labelInstruction =
    LABEL_FOCUS[label] ?? '이 수의 전략적/전술적 의미를 설명하세요.';

  const levelInstruction =
    level === 'beginner'
      ? `
대상: 체스 입문자 (ELO ~1000)
- 전문 용어는 반드시 괄호로 쉽게 설명 예) 포크(한 기물로 두 개를 동시에 공격)
- 비유를 적극 활용해 직관적으로 전달
- 3~4문장 이내, "~해요" 체로 따뜻하게`
      : `
대상: 중급 플레이어 (ELO 1000~1800)
- 전술/전략 용어 자유롭게 사용 (포크, 핀, 스큐어, 오픈 파일, 아웃포스트 등)
- 변화수 근거 1~2개 언급, 포지셔널·전술 이유 병행
- 4~5문장, "~합니다" 체로 전문적으로`;

  const opponent = currentTurn === 'w' ? '백(White)' : '흑(Black)';

  // 수 두기 전 포지션의 Stockfish 라인 (movedBy가 뒀어야 할 수)
  const preLines = preSfResult
    ? preSfResult.lines
        .slice(0, 3)
        .map((l, i) => {
          const score = l.mate !== null
            ? `M${Math.abs(l.mate)}`
            : `${l.cp > 0 ? '+' : ''}${(l.cp / 100).toFixed(1)}`;
          const sanMoves = uciSequenceToSan(preSfResult.fen, l.moves.split(' ').slice(0, 8).join(' '));
          return `  라인${i + 1} (${score}): ${sanMoves}`;
        })
        .join('\n')
    : null;

  const preBestReadable = preSfResult?.bestMove
    ? uciToSan(preSfResult.fen, preSfResult.bestMove)
    : null;

  return `당신은 체스 코치입니다.
${levelInstruction}

바로 해설 내용만 출력하세요. "코치로서", "설명해 드리겠습니다" 같은 도입 멘트는 생략하세요.

[SAN 표기 안내] 소문자로 시작하는 수(b5, e4 등)는 폰(Pawn) 이동입니다. 대문자로 시작하는 수(Nf3, Bc4, Qh5 등)는 해당 기물의 이동입니다. 절대 기물을 혼동하지 마세요.

현재 포지션 기물 배치:
${placement}
${(() => {
  const attacks = lastMoveAttackTargets(fen, lastMove);
  const captures = immediateCaptures(fen);
  const lines: string[] = [];
  if (attacks) lines.push(`→ ${lastMove}이 현재 공격하는 기물: ${attacks}`);
  if (moveEffectStr) lines.push(`→ ${moveEffectStr}`);
  if (captures) lines.push(`→ ${opponent}의 즉각적 캡처 선택지: ${captures}`);
  return lines.length ? '\n' + lines.join('\n') : '';
})()}
현재 포지션 FEN: ${fen}
방금 둔 수: ${lastMove} — ${movedBy}이 방금 이 수를 뒀습니다
Stockfish 평가: ${evalStr} (depth ${sfResult.depth})
${preBestReadable ? `${movedBy}의 최선수 (뒀어야 할 수): ${preBestReadable}` : ''}

${preLines ? `Stockfish 라인 — ${movedBy}의 선택지 (${lastMove}을 두기 전 기준):
${preLines}

` : ''}Stockfish 라인 — ${lastMove} 이후 ${opponent}의 대응 (현재 포지션 기준):
${topLines}

규칙:
- 위의 기물 배치를 기준으로 판단하세요. "기물 배치에 없는 기물"이 어딘가에 있다고 주장하지 마세요.
- Stockfish 라인에 실제로 등장하는 수만 근거로 사용하세요. 없는 수를 임의로 주장하지 마세요.
- 전술적 주장(포크, 핀, 위협 등)은 반드시 기물 배치로 확인 가능해야 합니다.
- 구체적인 수는 반드시 SAN 표기로 언급하세요.
- 수치(+1.5 등)를 그대로 읽지 말고 의미로 설명하세요.
- 메이트가 있다면 라인1의 수순을 정확히 언급하세요.

해설 방향 (라벨 초점 우선, 포지션에서 실제로 중요한 요소 중심으로 자유롭게):
- 전술적 위협/기회: 포크, 핀, 스큐어, 발견된 공격, 메이트 위협 등 구체적으로
- 포지셔널 이점/불리: 기물 활성화, 폰 구조 변화, 오픈 파일·대각선, 아웃포스트, 킹 안전
- 이 수 이후 상대의 최선 대응과 그 결과
- 라벨이 blunder/mistake/miss/inaccuracy라면: 더 나은 수와 그 이유도 포함

${labelInstruction}

모든 항목을 나열하지 말고, 이 포지션에서 실제로 핵심인 1~3가지에 집중하세요.`;
}

// ── Handler ───────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      fen: string;
      lastMove: string;
      sfResult: SFResult;
      preSfResult?: SFResult | null;
      label?: MoveLabel;
      level?: 'beginner' | 'intermediate';
    };

    const { fen, lastMove, sfResult, preSfResult = null, label = 'good', level = 'intermediate' } = body;

    if (!fen || !sfResult) {
      return new Response(
        JSON.stringify({ error: 'fen과 sfResult가 필요합니다' }),
        { status: 400 },
      );
    }

    const prompt = buildPrompt({ fen, lastMove, sfResult, preSfResult, label, level });

    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          switch (LLM_PROVIDER) {
            case 'anthropic': {
              const client = getAnthropicClient();
              const stream = client.messages.stream({
                model: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001',
                max_tokens: 600,
                messages: [{ role: 'user', content: prompt }],
              });
              for await (const event of stream) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              }
              break;
            }

            case 'openai': {
              const client = getOpenAIClient();
              const stream = await client.chat.completions.create({
                model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
                max_tokens: 600,
                messages: [{ role: 'user', content: prompt }],
                stream: true,
              });
              for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta?.content;
                if (delta) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: delta } })}\n\n`,
                    ),
                  );
                }
              }
              break;
            }

            case 'gemini': {
              const model = getGeminiModel();
              const result = await model.generateContentStream(prompt);
              for await (const chunk of result.stream) {
                const text = chunk.text();
                if (text) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n`,
                    ),
                  );
                }
              }
              break;
            }
          }
        } catch (err) {
          console.error('[stream error]', err);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: String(err) })}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    console.error('[/api/analyze]', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
