# chess-explainer — 셋업 가이드

## 파일 구조
```
chess-explainer/
├── lib/
│   ├── stockfish.worker.ts   ← SF Web Worker
│   └── useStockfish.ts       ← React Hook
├── components/
│   ├── ChessBoard.tsx        ← 메인 컴포넌트
│   └── ChessBoard.module.css ← 스타일
└── app/api/analyze/
    └── route.ts              ← Claude 스트리밍 API
```

---

## 1. 프로젝트 생성

```bash
npx create-next-app@latest chess-explainer \
  --typescript --tailwind --app

cd chess-explainer

npm install chess.js @anthropic-ai/sdk
npm install --save-dev @types/chess.js
```

---

## 2. Stockfish WASM 파일 세팅

```bash
# Stockfish WASM 다운로드 (lichess 버전 권장)
curl -L https://github.com/lichess-org/stockfish.wasm/releases/latest/download/stockfish.js \
  -o public/stockfish.js

curl -L https://github.com/lichess-org/stockfish.wasm/releases/latest/download/stockfish.wasm \
  -o public/stockfish.wasm
```

**next.config.ts** — WASM MIME type 설정 필요:
```ts
const nextConfig = {
  webpack: (config) => {
    config.resolve.fallback = { fs: false };
    return config;
  },
  async headers() {
    return [
      {
        source: '/stockfish.wasm',
        headers: [
          { key: 'Content-Type', value: 'application/wasm' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
```

**COOP/COEP 헤더** — SharedArrayBuffer(Stockfish 멀티스레드) 사용 시 필요.  
싱글스레드 버전(`stockfish-single.js`)을 쓰면 이 설정 불필요.

---

## 3. 환경 변수

```bash
# .env.local
ANTHROPIC_API_KEY=sk-ant-...
```

`.env.local`은 절대 git에 커밋하지 마세요. `.gitignore`에 포함되어 있습니다.

---

## 4. 파일 복사

이 레포의 파일들을 Next.js 프로젝트에 복사:

```bash
cp lib/stockfish.worker.ts  ./lib/
cp lib/useStockfish.ts      ./lib/
cp components/ChessBoard.tsx          ./components/
cp components/ChessBoard.module.css   ./components/
cp app/api/analyze/route.ts ./app/api/analyze/
```

---

## 5. 페이지에 컴포넌트 사용

```tsx
// app/analyze/page.tsx
import ChessBoard from '@/components/ChessBoard';

export default function AnalyzePage() {
  return (
    <main>
      <ChessBoard level="intermediate" />
    </main>
  );
}
```

**Props:**
| prop | type | default | 설명 |
|------|------|---------|------|
| `initialFen` | string | 초기 배치 | 시작 FEN |
| `initialPgn` | string | — | 시작 PGN |
| `level` | `'beginner' \| 'intermediate'` | `'intermediate'` | AI 해설 수준 |
| `flipped` | boolean | `false` | 보드 뒤집기 |

---

## 6. 실행

```bash
npm run dev
# http://localhost:3000/analyze
```

---

## API 비용 추정

| 구분 | 수치 |
|------|------|
| 분석 1회 input | ~400 tokens |
| 분석 1회 output | ~200 tokens |
| 1회 비용 (Claude Sonnet) | ~$0.003 |
| 무료 유저 5회/일 × 700명 × 30일 | ~$315/월 |
| 유료 전환 60명 × $10 | $600 수익 → 손익분기 |

---

## 다음 단계

1. **Blunder 감지** — PGN 전체를 순회하며 eval 급변 구간 마킹
2. **Clerk 인증** — `npm install @clerk/nextjs`, 하루 5회 제한 미들웨어
3. **Supabase** — 분석 히스토리 저장 (`analysis_sessions` 테이블)
4. **Vercel 배포** — `vercel --prod`
