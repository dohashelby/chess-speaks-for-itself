import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white">
      <h1 className="text-4xl font-bold mb-4">Chess Explainer</h1>
      <p className="text-gray-400 mb-8">AI가 체스 수를 실시간으로 해설해드립니다</p>
      <Link
        href="/analyze"
        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-lg font-medium transition-colors"
      >
        분석 시작하기
      </Link>
    </main>
  );
}
