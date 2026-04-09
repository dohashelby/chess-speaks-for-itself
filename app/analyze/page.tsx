'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Crown } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

const ChessBoard = dynamic(() => import('@/components/ChessBoard'), { ssr: false });

function AnalyzeContent() {
  const searchParams = useSearchParams();
  const level = (searchParams.get('level') === 'beginner' ? 'beginner' : 'intermediate') as 'beginner' | 'intermediate';

  return (
    <div style={{ minHeight: '100vh', background: '#050505', position: 'relative' }}>
      {/* gradient background */}
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        background: [
          'radial-gradient(circle at 0% 0%, rgba(16,185,129,0.12) 0%, transparent 30%)',
          'radial-gradient(circle at 100% 0%, rgba(59,130,246,0.10) 0%, transparent 28%)',
          'linear-gradient(to bottom, rgba(255,255,255,0.03) 0%, transparent 18%)',
        ].join(','),
        pointerEvents: 'none',
      }} />

      {/* sticky header */}
      <header style={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
      }}>
        <div style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: '0 24px',
          height: '64px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          {/* logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '14px',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}>
              <Crown size={18} color="#e8e8e8" />
            </div>
            <div>
              <p style={{
                fontFamily: "'Pretendard', sans-serif",
                fontWeight: 700,
                fontSize: '16px',
                color: '#e8e8e8',
                letterSpacing: '-0.01em',
                lineHeight: 1.2,
              }}>
                Chess Speaks For Itself
              </p>
              <p style={{
                fontFamily: "'Pretendard', sans-serif",
                fontSize: '11px',
                color: 'rgba(255,255,255,0.35)',
                lineHeight: 1,
              }}>
                Engine analysis made human
              </p>
            </div>
          </div>

          {/* nav */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Link href="/" style={{
              padding: '7px 16px',
              fontFamily: "'Pretendard', sans-serif",
              fontSize: '13px',
              color: 'rgba(255,255,255,0.55)',
              textDecoration: 'none',
              borderRadius: '12px',
              transition: 'all 0.15s',
            }}
              onMouseEnter={e => (e.currentTarget.style.color = '#e8e8e8', e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.55)', e.currentTarget.style.background = 'transparent')}
            >
              홈으로
            </Link>
            <div style={{
              padding: '7px 16px',
              fontFamily: "'Pretendard', sans-serif",
              fontSize: '13px',
              fontWeight: 600,
              color: '#0f0f0f',
              background: 'rgba(255,255,255,0.92)',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}>
              <span style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#10b981',
                display: 'inline-block',
              }} />
              Live Analysis
            </div>
          </div>
        </div>
      </header>

      {/* board */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        <ChessBoard level={level} />
      </div>
    </div>
  );
}

export default function AnalyzePage() {
  return (
    <Suspense>
      <AnalyzeContent />
    </Suspense>
  );
}
