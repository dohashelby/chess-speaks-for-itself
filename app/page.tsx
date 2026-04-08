import Link from 'next/link';

export default function Home() {
  return (
    <main style={{
      minHeight: '100vh',
      background: '#0f0f0f',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '0',
      fontFamily: "'Pretendard', sans-serif",
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        marginBottom: '56px',
      }}>
        {['CHESS', 'SPEAKS', 'FOR', 'ITSELF'].map((word) => (
          <span key={word} style={{
            fontSize: 'clamp(52px, 12vw, 112px)',
            fontWeight: 800,
            color: '#e8e8e8',
            lineHeight: 1.0,
            letterSpacing: '-0.03em',
            display: 'block',
          }}>
            {word}
          </span>
        ))}
      </div>

      <Link
        href="/analyze"
        style={{
          padding: '14px 36px',
          background: '#e8e8e8',
          color: '#0f0f0f',
          borderRadius: '4px',
          fontSize: '16px',
          fontWeight: 700,
          letterSpacing: '0.06em',
          textDecoration: 'none',
          fontFamily: "'Pretendard', sans-serif",
        }}
      >
        분석 시작하기
      </Link>
    </main>
  );
}
