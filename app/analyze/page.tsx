'use client';

import ChessBoard from '@/components/ChessBoard';

export default function AnalyzePage() {
  return (
    <main className="min-h-screen bg-gray-900 py-8">
      <ChessBoard level="intermediate" />
    </main>
  );
}
