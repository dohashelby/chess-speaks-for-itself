'use client';

import dynamic from 'next/dynamic';

const ChessBoard = dynamic(() => import('@/components/ChessBoard'), { ssr: false });

export default function AnalyzePage() {
  return (
    <main style={{ minHeight: '100vh', background: '#0f0f0f' }}>
      <header style={{
        padding: '18px 28px',
        borderBottom: '0.5px solid #2a2a2a',
        display: 'flex',
        alignItems: 'baseline',
        gap: '14px',
      }}>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontWeight: 800,
          fontSize: '22px',
          color: '#e8e8e8',
          letterSpacing: '0.06em',
        }}>
          CSFI :
        </span>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: '13px',
          color: '#888',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}>
          Chess Speaks For Itself
        </span>
      </header>
      <ChessBoard level="intermediate" />
    </main>
  );
}
