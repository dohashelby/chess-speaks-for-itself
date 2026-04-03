// app/api/analyze/route.ts  (라벨 인식 버전)
// label 파라미터를 받아 프롬프트 톤을 자동 조정
// LLM_PROVIDER 환경 변수로 anthropic / openai / gemini 선택

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Chess, Square } from 'chess.js';
import { MoveLabel } from '@/lib/moveClassifier';

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
}

// ── 라벨별 해설 지시 ──────────────────────────────────────

const LABEL_TONE: Partial<Record<MoveLabel, string>> = {
  brilliant:
    '이 수는 탁월한 희생수(Brilliant move)입니다. 왜 이 희생이 전술적으로 성립하는지 흥미롭게 설명하세요.',
  only_move:
    '이 수는 포지션을 유지할 수 있는 유일한 수(Only move)입니다. 다른 수를 뒀을 때 어떤 재앙이 기다리는지 구체적으로 설명하세요.',
  blunder:
    '이 수는 심각한 실수(Blunder ??)입니다. 어떤 전술적 약점이 생겼는지, 왜 이렇게 나쁜지 명확히 설명하세요.',
  miss:
    '이 수는 메이트 또는 결정적 이득을 놓친 수입니다. 어떤 기회를 놓쳤는지 구체적으로 설명하세요.',
  mistake:
    '이 수는 실수(Mistake ?)입니다. 최선수 대비 무엇을 놓쳤는지, 어떤 약점이 생겼는지 설명하세요.',
  inaccuracy:
    '이 수는 부정확한 수(Inaccuracy ?!)입니다. 최선수 대비 어떤 포지셔널/전술적 차이가 있는지 설명하세요.',
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
    LABEL_TONE[label] ?? '이 수의 전략적 의미를 설명하세요.';

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

현재 포지션 FEN: ${fen}
방금 둔 수: ${lastMove} — ${movedBy}이 방금 이 수를 뒀습니다
수 평가 지시: ${labelInstruction}
Stockfish 평가: ${evalStr} (depth ${sfResult.depth})
${preBestReadable ? `${movedBy}의 최선수 (뒀어야 할 수): ${preBestReadable}` : ''}

${preLines ? `Stockfish 라인 — ${movedBy}의 선택지 (${lastMove}을 두기 전 기준):
${preLines}

` : ''}Stockfish 라인 — ${lastMove} 이후 ${opponent}의 대응 (현재 포지션 기준):
${topLines}

중요 규칙:
- 위 Stockfish 라인에 실제로 등장하는 수만 근거로 사용하세요. 라인에 없는 수를 임의로 주장하지 마세요.
- 구체적인 수를 SAN 표기로 언급하며 설명하세요.
- 메이트가 있다면 라인1의 수순을 따라 정확히 설명하세요.

설명 구성:
1. ${movedBy}이 뒀어야 할 수 — "${preBestReadable ?? '최선수'}을 뒀어야 합니다" 형식으로, 왜 그 수가 좋은지 설명
2. ${lastMove}를 뒀을 때 발생하는 결과 — 이후 라인1 수순을 따라 "상대가 Y를 두면, 이후 Z로 이어집니다" 형식으로 구체적으로
3. 한 줄 교훈

수치를 그대로 읽지 말고 의미로 설명하세요.`;
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
