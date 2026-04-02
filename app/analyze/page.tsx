'use client';

import dynamic from 'next/dynamic';

const ChessBoard = dynamic(() => import('@/components/ChessBoard'), { ssr: false });

export default function AnalyzePage() {
  return (
    <main className="min-h-screen bg-gray-900 py-8">
      <ChessBoard level="intermediate" />
    </main>
  );
}
