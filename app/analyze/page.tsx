'use client';

import dynamic from 'next/dynamic';

const ChessBoard = dynamic(() => import('@/components/ChessBoard'), { ssr: false });

export default function AnalyzePage() {
  return (
    <main style={{ minHeight: '100vh', background: '#0f0f0f' }}>
      <header style={{
        padding: '12px 20px',
        borderBottom: '0.5px solid #2a2a2a',
        display: 'flex',
        alignItems: 'baseline',
        gap: '10px',
      }}>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontWeight: 700,
          fontSize: '15px',
          color: '#e8e8e8',
          letterSpacing: '0.04em',
        }}>
          CSFI :
        </span>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: '11px',
          color: '#555',
          letterSpacing: '0.08em',
        }}>
          Chess Speaks For Itself
        </span>
      </header>
      <ChessBoard level="intermediate" />
    </main>
  );
}
