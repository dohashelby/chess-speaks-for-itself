'use client';

// components/GameReview.tsx
// 전체 게임 분석 결과 패널
// - 수순 목록 + 라벨 배지
// - 라벨 클릭 → 자동 AI 해설 트리거
// - 정확도 / 라벨 요약 통계

import { useState, useEffect, useRef } from 'react';
import { GameAnalysis, MoveAnalysis, LABEL_META, AUTO_EXPLAIN_LABELS, MoveLabel } from '@/lib/moveClassifier';
import { AnalysisProgress } from '@/lib/useGameAnalyzer';
import styles from './GameReview.module.css';

// ── 라벨 배지 ─────────────────────────────────────────────

export function MoveLabelBadge({ label }: { label: MoveLabel }) {
  const meta = LABEL_META[label];
  if (!meta.symbol) return null; // 'good'은 배지 없음

  return (
    <span
      className={styles.badge}
      style={{ color: meta.color, borderColor: meta.color + '55' }}
      title={meta.ko}
    >
      {meta.symbol}
    </span>
  );
}

// ── 정확도 링 ─────────────────────────────────────────────

function AccuracyRing({ value, label }: { value: number; label: string }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - value / 100);

  return (
    <div className={styles.ring}>
      <svg width="60" height="60" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r={r} fill="none" stroke="#222" strokeWidth="5" />
        <circle
          cx="30" cy="30" r={r}
          fill="none"
          stroke={value >= 80 ? '#4caf70' : value >= 60 ? '#f0c040' : '#e04040'}
          strokeWidth="5"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 30 30)"
          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
        <text x="30" y="34" textAnchor="middle" fontSize="13" fontWeight="500"
          fill="#e8e8e8" fontFamily="'IBM Plex Mono', monospace">
          {value}
        </text>
      </svg>
      <span className={styles.ringLabel}>{label}</span>
    </div>
  );
}

// ── 라벨 요약 ─────────────────────────────────────────────

function LabelSummary({ summary }: { summary: Record<MoveLabel, number> }) {
  const order: MoveLabel[] = ['brilliant', 'only_move', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder', 'miss'];

  return (
    <div className={styles.summary}>
      {order.map(label => {
        const count = summary[label] ?? 0;
        if (count === 0 && ['good', 'excellent', 'best'].includes(label)) return null;
        const meta = LABEL_META[label];
        return (
          <div key={label} className={styles.summaryRow}>
            <span className={styles.summarySymbol} style={{ color: meta.color }}>
              {meta.symbol || '·'}
            </span>
            <span className={styles.summaryKo}>{meta.ko}</span>
            <span className={styles.summaryCount} style={{ color: count > 0 ? meta.color : '#333' }}>
              {count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── AI 해설 패널 ──────────────────────────────────────────

function MoveExplanation({
  move,
  level,
}: {
  move: MoveAnalysis;
  level: 'beginner' | 'intermediate';
}) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const prevKey = useRef('');

  useEffect(() => {
    const key = move.uci + move.fen_before;
    if (key === prevKey.current) return;
    prevKey.current = key;

    setText('');
    setLoading(true);

    const ctrl = new AbortController();

    (async () => {
      try {
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fen:      move.fen_before,
            lastMove: move.san,
            sfResult: {
              bestMove: move.best_move_uci,
              eval:     move.best_eval,
              mate:     null,
              lines:    move.top_lines,
              depth:    18,
            },
            label:  move.label,
            level,
          }),
          signal: ctrl.signal,
        });

        if (!res.body) return;
        const reader  = res.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const json = JSON.parse(line.slice(6));
              if (json.type === 'content_block_delta') {
                setText(prev => prev + (json.delta?.text ?? ''));
              }
            } catch { /* skip */ }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setText('해설을 불러오는 중 오류가 발생했습니다.');
        }
      } finally {
        setLoading(false);
      }
    })();

    return () => ctrl.abort();
  }, [move, level]);

  const meta = LABEL_META[move.label];

  return (
    <div className={styles.explainBox} style={{ borderLeftColor: meta.color }}>
      <div className={styles.explainHeader}>
        <span style={{ color: meta.color, fontWeight: 500 }}>
          {meta.symbol} {move.san}
        </span>
        <span className={styles.explainLabel} style={{ color: meta.color, background: meta.bg }}>
          {meta.ko}
        </span>
        {move.eval_loss > 0 && (
          <span className={styles.evalLoss}>
            -{move.eval_loss.toFixed(2)} 폰
          </span>
        )}
        {loading && <span className={styles.dot} />}
      </div>
      <p className={styles.explainText}>
        {text || <span className={styles.explainPlaceholder}>해설 생성 중...</span>}
      </p>
    </div>
  );
}

// ── 메인 GameReview 컴포넌트 ─────────────────────────────

interface GameReviewProps {
  analysis: GameAnalysis | null;
  progress: AnalysisProgress;
  onMoveSelect?: (move: MoveAnalysis, idx: number) => void;
  level?: 'beginner' | 'intermediate';
}

export default function GameReview({
  analysis,
  progress,
  onMoveSelect,
  level = 'intermediate',
}: GameReviewProps) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [autoExplainIdx, setAutoExplainIdx] = useState<number | null>(null);

  // 자동 해설: 주목할 만한 수를 클릭하면 자동으로 해설 트리거
  const handleMoveClick = (move: MoveAnalysis, idx: number) => {
    setSelectedIdx(idx);
    onMoveSelect?.(move, idx);
    if (AUTO_EXPLAIN_LABELS.has(move.label)) {
      setAutoExplainIdx(idx);
    }
  };

  // 로딩 상태
  if (progress.phase === 'analyzing') {
    const pct = progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;
    return (
      <div className={styles.root}>
        <div className={styles.loadingWrap}>
          <div className={styles.loadingBar}>
            <div className={styles.loadingFill} style={{ width: `${pct}%` }} />
          </div>
          <span className={styles.loadingText}>
            {progress.current} / {progress.total} 수 분석 중... ({pct}%)
          </span>
        </div>
      </div>
    );
  }

  if (!analysis) return null;

  // 수 쌍으로 묶기
  const pairs: [MoveAnalysis, MoveAnalysis | null][] = [];
  for (let i = 0; i < analysis.moves.length; i += 2) {
    pairs.push([analysis.moves[i], analysis.moves[i + 1] ?? null]);
  }

  const selectedMove = selectedIdx !== null ? analysis.moves[selectedIdx] : null;
  const autoMove     = autoExplainIdx !== null ? analysis.moves[autoExplainIdx] : null;

  return (
    <div className={styles.root}>
      {/* 정확도 */}
      <div className={styles.accuracyRow}>
        <AccuracyRing value={analysis.accuracy.white} label="백" />
        <div className={styles.accuracyDivider} />
        <AccuracyRing value={analysis.accuracy.black} label="흑" />
      </div>

      {/* 요약 */}
      <div className={styles.summaryRow2}>
        <div>
          <div className={styles.sideLabel}>백</div>
          <LabelSummary summary={analysis.summary.white} />
        </div>
        <div className={styles.summaryDivider} />
        <div>
          <div className={styles.sideLabel}>흑</div>
          <LabelSummary summary={analysis.summary.black} />
        </div>
      </div>

      {/* 수순 목록 */}
      <div className={styles.moveTable}>
        {pairs.map(([white, black], pairIdx) => (
          <div key={pairIdx} className={styles.movePair}>
            <span className={styles.moveNum}>{pairIdx + 1}.</span>

            {/* 백 */}
            <button
              className={[
                styles.moveBtn,
                selectedIdx === pairIdx * 2 ? styles.moveBtnActive : '',
              ].join(' ')}
              style={{
                borderLeftColor: LABEL_META[white.label].color,
                borderLeftWidth: LABEL_META[white.label].symbol ? '2px' : '0',
              }}
              onClick={() => handleMoveClick(white, pairIdx * 2)}
            >
              {white.san}
              <MoveLabelBadge label={white.label} />
            </button>

            {/* 흑 */}
            {black && (
              <button
                className={[
                  styles.moveBtn,
                  selectedIdx === pairIdx * 2 + 1 ? styles.moveBtnActive : '',
                ].join(' ')}
                style={{
                  borderLeftColor: LABEL_META[black.label].color,
                  borderLeftWidth: LABEL_META[black.label].symbol ? '2px' : '0',
                }}
                onClick={() => handleMoveClick(black, pairIdx * 2 + 1)}
              >
                {black.san}
                <MoveLabelBadge label={black.label} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* AI 해설 — 주목할 수 선택 시 자동 표시 */}
      {autoMove && AUTO_EXPLAIN_LABELS.has(autoMove.label) && (
        <MoveExplanation move={autoMove} level={level} />
      )}

      {/* 선택한 수가 일반 수일 때도 간단한 정보 표시 */}
      {selectedMove && !AUTO_EXPLAIN_LABELS.has(selectedMove.label) && (
        <div className={styles.simpleInfo}>
          <span style={{ color: LABEL_META[selectedMove.label].color }}>
            {LABEL_META[selectedMove.label].ko}
          </span>
          {selectedMove.eval_loss > 0.05 && (
            <span className={styles.evalLoss}> · -{selectedMove.eval_loss.toFixed(2)} 폰 손실</span>
          )}
        </div>
      )}
    </div>
  );
}
