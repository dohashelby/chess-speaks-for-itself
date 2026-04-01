// app/api/analyze/route.ts  (라벨 인식 버전)
// label 파라미터를 받아 프롬프트 톤을 자동 조정

import Anthropic from '@anthropic-ai/sdk';
import { MoveLabel } from '@/lib/moveClassifier';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
    '이 수는 실수(Mistake ?!)입니다. 최선수 대비 무엇을 놓쳤는지, 어떤 약점이 생겼는지 설명하세요.',
  inaccuracy:
    '이 수는 부정확한 수(Inaccuracy ?)입니다. 최선수 대비 어떤 포지셔널/전술적 차이가 있는지 설명하세요.',
};

function buildPrompt(params: {
  fen: string;
  lastMove: string;
  sfResult: SFResult;
  label: MoveLabel;
  level: 'beginner' | 'intermediate';
}): string {
  const { fen, lastMove, sfResult, label, level } = params;

  const evalStr =
    sfResult.mate !== null
      ? `메이트 ${sfResult.mate > 0 ? '+' : ''}${sfResult.mate}`
      : `${sfResult.eval > 0 ? '+' : ''}${sfResult.eval.toFixed(2)}`;

  const bestReadable = sfResult.bestMove
    ? `${sfResult.bestMove.slice(0, 2).toUpperCase()}→${sfResult.bestMove.slice(2, 4).toUpperCase()}`
    : '없음';

  const topLines = sfResult.lines
    .slice(0, 3)
    .map((l, i) => {
      const score =
        l.mate !== null
          ? `M${Math.abs(l.mate)}`
          : `${l.cp > 0 ? '+' : ''}${(l.cp / 100).toFixed(1)}`;
      return `  ${i + 1}. ${l.moves.split(' ').slice(0, 6).join(' ')} (${score})`;
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

  return `당신은 체스 코치입니다.
${levelInstruction}

현재 포지션 FEN: ${fen}
방금 둔 수: ${lastMove}
수 평가 지시: ${labelInstruction}
Stockfish 평가: ${evalStr} (depth ${sfResult.depth})
추천 최선수: ${bestReadable}

Stockfish 상위 변화수:
${topLines}

설명 구성:
1. 이 수의 핵심 문제 또는 장점 (라벨 근거 명확히)
2. 최선수 ${bestReadable}가 왜 더 좋은지 구체적 이유
3. 이 포지션의 교훈 또는 주목할 아이디어

수치를 그대로 읽지 말고 의미로 설명하세요.`;
}

// ── Handler ───────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      fen: string;
      lastMove: string;
      sfResult: SFResult;
      label?: MoveLabel;
      level?: 'beginner' | 'intermediate';
    };

    const { fen, lastMove, sfResult, label = 'good', level = 'intermediate' } = body;

    if (!fen || !sfResult) {
      return new Response(
        JSON.stringify({ error: 'fen과 sfResult가 필요합니다' }),
        { status: 400 },
      );
    }

    const prompt = buildPrompt({ fen, lastMove, sfResult, label, level });

    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          const stream = client.messages.stream({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 600,
            messages: [{ role: 'user', content: prompt }],
          });
          for await (const event of stream) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
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
