'use client';

import Link from 'next/link';
import { Crown, Sparkles, Brain, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

const features = [
  { icon: Zap, label: 'Stockfish 분석', desc: '즉각적인 엔진 평가' },
  { icon: Brain, label: 'AI 해설', desc: '사람 친화적 설명' },
  { icon: Sparkles, label: '수 분류', desc: 'Brilliant부터 Blunder까지' },
];

export default function Home() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#050505',
      color: '#e8e8e8',
      fontFamily: "'Pretendard', sans-serif",
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* bg gradient */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: [
          'radial-gradient(circle at 5% 5%, rgba(16,185,129,0.15) 0%, transparent 32%)',
          'radial-gradient(circle at 95% 8%, rgba(59,130,246,0.12) 0%, transparent 28%)',
          'radial-gradient(circle at 50% 90%, rgba(16,185,129,0.06) 0%, transparent 40%)',
        ].join(','),
        pointerEvents: 'none',
      }} />

      {/* header */}
      <header style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        padding: '20px 32px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
      }}>
        <div style={{
          width: '36px',
          height: '36px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '12px',
          background: 'rgba(255,255,255,0.07)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          <Crown size={16} color="#e8e8e8" />
        </div>
        <span style={{ fontSize: '14px', fontWeight: 600, color: 'rgba(255,255,255,0.7)', letterSpacing: '-0.01em' }}>
          Chess Speaks For Itself
        </span>
      </header>

      {/* main */}
      <main style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '80px 24px 48px',
        gap: '0',
        position: 'relative',
        zIndex: 1,
      }}>

        {/* badge */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          style={{
            marginBottom: '36px',
            padding: '6px 16px',
            background: 'rgba(16,185,129,0.12)',
            border: '1px solid rgba(16,185,129,0.3)',
            borderRadius: '999px',
            fontSize: '12px',
            fontWeight: 600,
            color: '#10b981',
            letterSpacing: '0.04em',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
          AI-Powered Chess Analysis
        </motion.div>

        {/* title */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.05 }}
          style={{ textAlign: 'center', marginBottom: '48px' }}
        >
          {['CHESS', 'SPEAKS', 'FOR', 'ITSELF'].map((word, i) => (
            <motion.span
              key={word}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.08 + i * 0.06 }}
              style={{
                fontSize: 'clamp(52px, 11vw, 108px)',
                fontWeight: 800,
                color: '#e8e8e8',
                lineHeight: 0.98,
                letterSpacing: '-0.04em',
                display: 'block',
              }}
            >
              {word}
            </motion.span>
          ))}
        </motion.div>

        {/* subtitle */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.36 }}
          style={{
            fontSize: '16px',
            color: 'rgba(255,255,255,0.45)',
            marginBottom: '48px',
            textAlign: 'center',
            maxWidth: '380px',
            lineHeight: 1.7,
          }}
        >
          엔진 분석을 인간의 언어로 — Stockfish와 AI가 만나는 체스 해설
        </motion.p>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.44 }}
          style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}
        >
          <Link
            href="/analyze?level=beginner"
            style={{
              padding: '14px 36px',
              background: 'rgba(255,255,255,0.93)',
              color: '#0f0f0f',
              borderRadius: '14px',
              fontSize: '15px',
              fontWeight: 700,
              letterSpacing: '-0.01em',
              textDecoration: 'none',
              transition: 'all 0.15s',
              display: 'inline-flex',
              alignItems: 'center',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#ffffff', e.currentTarget.style.transform = 'translateY(-1px)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.93)', e.currentTarget.style.transform = 'none')}
          >
            입문자
          </Link>
          <Link
            href="/analyze?level=intermediate"
            style={{
              padding: '14px 36px',
              background: 'rgba(255,255,255,0.93)',
              color: '#0f0f0f',
              borderRadius: '14px',
              fontSize: '15px',
              fontWeight: 700,
              letterSpacing: '-0.01em',
              textDecoration: 'none',
              transition: 'all 0.15s',
              display: 'inline-flex',
              alignItems: 'center',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#ffffff', e.currentTarget.style.transform = 'translateY(-1px)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.93)', e.currentTarget.style.transform = 'none')}
          >
            중급자
          </Link>
        </motion.div>

        {/* feature cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.55 }}
          style={{
            display: 'flex',
            gap: '12px',
            marginTop: '80px',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          {features.map(({ icon: Icon, label, desc }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.6 + i * 0.07 }}
              style={{
                padding: '20px 24px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '20px',
                backdropFilter: 'blur(12px)',
                minWidth: '160px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{
                width: '38px',
                height: '38px',
                background: 'rgba(255,255,255,0.08)',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <Icon size={18} color="#e8e8e8" />
              </div>
              <div>
                <p style={{ fontSize: '13px', fontWeight: 600, color: '#e8e8e8', marginBottom: '3px' }}>{label}</p>
                <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>{desc}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </main>
    </div>
  );
}
