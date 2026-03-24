'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface Theme {
  name: string;
  summary: string;
  drivers: string[];
  verbatims: string[];
  implications: string[];
}

interface Brief {
  id: string;
  brand: string;
  category: string;
  markets: string[];
  time_window: string;
  question: string;
  status: string;
  results: { themes: Theme[] };
  post_count: number;
}

const DRIVER_COLORS: Record<string, string> = {
  Creativity: '#E8D5F5', Experiences: '#FFE4CC', Emotion: '#FFD6D6',
  Engagement: '#FFF3CC', Relationships: '#D6F5E8', Responsibility: '#CCE8FF',
  Wellbeing: '#D6FFD6', Simplicity: '#F5F5D6', Resilience: '#FFD6F0',
  Control: '#D6E8FF', Enhancement: '#F0D6FF', Power: '#FFE8D6',
  Achievement: '#D6FFF5', Exploration: '#E8D6FF', Individuality: '#FFD6E8',
  Extremes: '#FFE8E8'
};

const STEPS = [
  { label: 'Reading your brief', detail: 'Extracting keywords and challenge context' },
  { label: 'Scanning Hacker News', detail: 'Pulling conversations from the last 12 months' },
  { label: 'Scanning Bluesky', detail: 'Listening to real-time public discourse' },
  { label: 'Scanning Reddit', detail: 'Surfacing community voices and debates' },
  { label: 'Clustering conversations', detail: 'Finding patterns across all sources' },
  { label: 'Identifying cultural themes', detail: 'Running insight analysis with Claude' },
  { label: 'Writing implications', detail: `Framing strategic provocations for your brand` },
  { label: 'Finalising report', detail: 'Almost there...' },
];

export default function ResultsPage() {
  const params = useParams();
  const id = params.id as string;
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTheme, setActiveTheme] = useState(0);
  const [pollCount, setPollCount] = useState(0);
  const [triggered, setTriggered] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [failed, setFailed] = useState(false);
  const startTime = useRef(Date.now());
  const timerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const pollRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const fetchBrief = useCallback(async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}&select=*`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      const data = await res.json();
      if (data[0]) {
        setBrief(data[0]);
        return data[0].status;
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
    return 'pending';
  }, [id]);

  const triggerGeneration = useCallback(async () => {
    if (triggered) return;
    setTriggered(true);
    try {
      await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefId: id })
      });
    } catch (e) {
      console.error('Trigger error:', e);
    }
  }, [id, triggered]);

  useEffect(() => {
    if (!id) return;

    const init = async () => {
      const status = await fetchBrief();
      if (status === 'pending') {
        startTime.current = Date.now();
        triggerGeneration();

        timerRef.current = setInterval(() => {
          const secs = Math.floor((Date.now() - startTime.current) / 1000);
          setElapsed(secs);
          const stepIndex = Math.min(Math.floor(secs / 7), STEPS.length - 1);
          setCurrentStep(stepIndex);
          if (secs > 120) setFailed(true);
        }, 1000);

        pollRef.current = setInterval(async () => {
          setPollCount(c => c + 1);
          const s = await fetchBrief();
          if (s === 'complete') {
            clearInterval(timerRef.current);
            clearInterval(pollRef.current);
          }
        }, 3000);
      }
    };

    init();
    return () => {
      clearInterval(timerRef.current);
      clearInterval(pollRef.current);
    };
  }, [id, fetchBrief, triggerGeneration]);

  if (loading) return (
    <div style={s.centred}>
      <div style={s.spinnerWrap}><div style={s.spinner} /></div>
      <p style={s.loadingText}>Loading...</p>
    </div>
  );

  if (!brief) return (
    <div style={s.centred}>
      <p style={{ color: '#c0392b', fontFamily: 'Georgia, serif' }}>Brief not found.</p>
    </div>
  );

  if (brief.status !== 'complete') return (
    <div style={s.loadingPage}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        @keyframes slideIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital@0;1&family=DM+Sans:wght@300;400;500&family=DM+Mono&display=swap');
      `}</style>

      <div style={s.loadingHeader}>
        <div style={s.logo}>now<span style={s.logoAccent}>—</span>again</div>
      </div>

      <div style={s.loadingBody}>
        <div style={s.loadingLeft}>
          <div style={s.bigSpinnerWrap}>
            <svg width="80" height="80" viewBox="0 0 80 80" style={{ animation: 'spin 2s linear infinite' }}>
              <circle cx="40" cy="40" r="36" fill="none" stroke="#ede9e0" strokeWidth="2" />
              <circle cx="40" cy="40" r="36" fill="none" stroke="#2d4a3e" strokeWidth="2"
                strokeDasharray="60 165" strokeLinecap="round" />
            </svg>
            <div style={s.elapsedBadge}>{elapsed}s</div>
          </div>

          <h1 style={s.loadingTitle}>Listening to<br /><em style={{ fontStyle: 'italic', color: '#c8b89a' }}>culture...</em></h1>

          <p style={s.loadingSubtitle}>
            Collecting real conversations for <strong>{brief.brand}</strong> across {(brief.markets || []).join(', ') || 'global'} markets.
          </p>

          {failed ? (
            <div style={s.failedBox}>
              <p style={s.failedText}>This is taking longer than expected.</p>
              <button style={s.retryBtn} onClick={() => window.location.reload()}>Retry →</button>
            </div>
          ) : (
            <div style={s.progressBarWrap}>
              <div style={s.progressBarTrack}>
                <div style={{ ...s.progressBarFill, width: `${Math.min((elapsed / 60) * 100, 95)}%` }} />
              </div>
              <span style={s.progressLabel}>
                {elapsed < 60 ? `~${Math.max(60 - elapsed, 5)}s remaining` : 'Almost done...'}
              </span>
            </div>
          )}
        </div>

        <div style={s.loadingRight}>
          <div style={s.stepsCard}>
            <div style={s.stepsLabel}>What we&apos;re doing</div>
            {STEPS.map((step, i) => {
              const isDone = i < currentStep;
              const isActive = i === currentStep;
              return (
                <div key={i} style={{ ...s.stepRow, opacity: i > currentStep + 1 ? 0.3 : 1 }}>
                  <div style={{ ...s.stepDot, background: isDone ? '#2d4a3e' : isActive ? '#c8b89a' : '#e0ddd5' }}>
                    {isDone && <span style={{ color: 'white', fontSize: '10px' }}>✓</span>}
                  </div>
                  <div>
                    <div style={{ ...s.stepLabel, color: isActive ? '#0e0d0b' : isDone ? '#2d4a3e' : '#aaa' }}>
                      {step.label}
                    </div>
                    {isActive && (
                      <div style={{ ...s.stepDetail, animation: 'slideIn 0.3s ease' }}>
                        {step.detail}
                      </div>
                    )}
                  </div>
                  {isActive && (
                    <div style={s.activeIndicator}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#c8b89a', animation: 'pulse 1s ease-in-out infinite' }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={s.briefPreview}>
            <div style={s.briefPreviewLabel}>Brief</div>
            <p style={s.briefPreviewQ}>&ldquo;{brief.question}&rdquo;</p>
          </div>
        </div>
      </div>
    </div>
  );

  const themes = brief.results?.themes || [];

  return (
    <div style={s.page}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@300;400;500&family=DM+Mono&display=swap');`}</style>

      <header style={s.header}>
        <div style={s.logo}>now<span style={s.logoAccent}>—</span>again</div>
        <div style={s.headerMeta}>
          <span style={s.headerBrand}>{brief.brand}</span>
          <span style={s.headerDot}>·</span>
          <span style={s.headerTag}>{brief.category}</span>
        </div>
        <span style={s.postCount}>{brief.post_count || 0} conversations analysed</span>
      </header>

      <div style={s.outer}>
        <aside style={s.sidebar}>
          <div>
            <div style={s.sidebarLabel}>Brief</div>
            <p style={s.sidebarQuestion}>&ldquo;{brief.question}&rdquo;</p>
          </div>
          <div>
            <div style={s.sidebarLabel}>Markets</div>
            <p style={s.sidebarValue}>{(brief.markets || []).join(', ') || 'Global'}</p>
          </div>
          <div>
            <div style={s.sidebarLabel}>Themes</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {themes.map((t, i) => (
                <div key={i} onClick={() => setActiveTheme(i)}
                  style={{ ...s.themeNavItem, ...(activeTheme === i ? s.themeNavItemActive : {}) }}>
                  <span style={s.themeNavNum}>{String(i + 1).padStart(2, '0')}</span>
                  <span style={s.themeNavName}>{t.name}</span>
                </div>
              ))}
            </div>
          </div>
          <button style={s.newBriefBtn} onClick={() => window.location.href = '/now-again-brief.html'}>+ New brief</button>
        </aside>

        <main style={s.main}>
          <div style={s.themeTabs}>
            {themes.map((t, i) => (
              <button key={i} onClick={() => setActiveTheme(i)}
                style={{ ...s.themeTab, ...(activeTheme === i ? s.themeTabActive : {}) }}>
                {t.name}
              </button>
            ))}
          </div>

          {themes[activeTheme] && (
            <div style={s.themeContent}>
              <div style={s.themeHeader}>
                <div style={s.themeNumber}>Theme {String(activeTheme + 1).padStart(2, '0')}</div>
                <h2 style={s.themeName}>{themes[activeTheme].name}</h2>
                <p style={s.themeSummary}>{themes[activeTheme].summary}</p>
                <div style={s.driversRow}>
                  {themes[activeTheme].drivers.map((d, i) => (
                    <span key={i} style={{ ...s.driverPill, background: DRIVER_COLORS[d] || '#f0f0f0' }}>{d}</span>
                  ))}
                </div>
              </div>

              <div>
                <div style={s.sectionLabel}>What people are saying</div>
                <div style={s.verbatimsGrid}>
                  {themes[activeTheme].verbatims.map((v, i) => (
                    <div key={i} style={s.verbatimCard}>
                      <div style={s.verbatimQuote}>&ldquo;</div>
                      <p style={s.verbatimText}>{v}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div style={s.sectionLabel}>Implications for {brief.brand}</div>
                <div style={s.implicationsBlock}>
                  {themes[activeTheme].implications.map((imp, i) => (
                    <div key={i} style={{ ...s.implicationRow, borderBottom: i < themes[activeTheme].implications.length - 1 ? '1px solid #f5f3ee' : 'none' }}>
                      <div style={s.implicationArrow}>→</div>
                      <p style={s.implicationText}>{imp}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div style={s.themeNav2}>
                {activeTheme > 0 && (
                  <button style={s.navBtn} onClick={() => setActiveTheme(activeTheme - 1)}>
                    ← {themes[activeTheme - 1].name}
                  </button>
                )}
                {activeTheme < themes.length - 1 && (
                  <button style={{ ...s.navBtn, marginLeft: 'auto' }} onClick={() => setActiveTheme(activeTheme + 1)}>
                    {themes[activeTheme + 1].name} →
                  </button>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f5f3ee', fontFamily: "'DM Sans', sans-serif" },
  centred: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: '1rem', padding: '2rem', textAlign: 'center' },
  spinnerWrap: { width: 40, height: 40 },
  spinner: { width: 40, height: 40, borderRadius: '50%', border: '2px solid #e0ddd5', borderTop: '2px solid #2d4a3e', animation: 'spin 1s linear infinite' },
  loadingPage: { minHeight: '100vh', background: '#0e0d0b', fontFamily: "'DM Sans', sans-serif", display: 'flex', flexDirection: 'column' },
  loadingHeader: { padding: '1.5rem 2.5rem', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  logo: { fontFamily: 'Georgia, serif', fontSize: '1.1rem', color: '#f5f3ee' },
  logoAccent: { color: '#c8b89a' },
  loadingBody: { flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4rem', padding: '4rem 4rem', alignItems: 'center', maxWidth: '1100px', margin: '0 auto', width: '100%' },
  loadingLeft: { display: 'flex', flexDirection: 'column', gap: '2rem' },
  bigSpinnerWrap: { position: 'relative', width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  elapsedBadge: { position: 'absolute', fontFamily: 'monospace', fontSize: '0.7rem', color: '#c8b89a', letterSpacing: '0.05em' },
  loadingTitle: { fontFamily: 'Georgia, serif', fontSize: '3rem', fontWeight: 400, color: '#f5f3ee', lineHeight: 1.2, margin: 0 },
  loadingSubtitle: { fontSize: '0.9rem', color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, margin: 0 },
  progressBarWrap: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  progressBarTrack: { height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' },
  progressBarFill: { height: '100%', background: '#2d4a3e', borderRadius: 2, transition: 'width 1s ease' },
  progressLabel: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' },
  failedBox: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  failedText: { fontSize: '0.875rem', color: 'rgba(255,255,255,0.4)', margin: 0 },
  retryBtn: { alignSelf: 'flex-start', background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.7)', padding: '0.6rem 1.25rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', fontFamily: 'inherit' },
  loadingRight: { display: 'flex', flexDirection: 'column', gap: '1.5rem' },
  stepsCard: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  stepsLabel: { fontFamily: 'monospace', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.3)', marginBottom: '0.25rem' },
  stepRow: { display: 'flex', alignItems: 'flex-start', gap: '0.75rem', transition: 'opacity 0.3s' },
  stepDot: { width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepLabel: { fontSize: '0.85rem', fontWeight: 400, lineHeight: 1.3 },
  stepDetail: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.35)', marginTop: '0.2rem' },
  activeIndicator: { marginLeft: 'auto', display: 'flex', alignItems: 'center', paddingTop: 2 },
  briefPreview: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '1.25rem' },
  briefPreviewLabel: { fontFamily: 'monospace', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.25)', marginBottom: '0.5rem' },
  briefPreviewQ: { fontFamily: 'Georgia, serif', fontSize: '0.875rem', lineHeight: 1.6, color: 'rgba(255,255,255,0.5)', fontStyle: 'italic', margin: 0 },
  header: { display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.5rem 2.5rem', borderBottom: '1px solid #ede9e0', background: '#f5f3ee', position: 'sticky', top: 0, zIndex: 10 },
  headerMeta: { display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 },
  headerBrand: { fontWeight: 500, fontSize: '0.875rem', color: '#0e0d0b' },
  headerDot: { color: '#ccc' },
  headerTag: { fontSize: '0.8rem', color: '#999' },
  postCount: { fontFamily: 'monospace', fontSize: '0.72rem', color: '#aaa', letterSpacing: '0.05em' },
  outer: { display: 'grid', gridTemplateColumns: '280px 1fr', minHeight: 'calc(100vh - 65px)' },
  sidebar: { background: '#0e0d0b', color: '#f5f3ee', padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.75rem' },
  sidebarLabel: { fontFamily: 'monospace', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#c8b89a', marginBottom: '0.5rem' },
  sidebarQuestion: { fontFamily: 'Georgia, serif', fontSize: '0.85rem', lineHeight: 1.6, color: 'rgba(255,255,255,0.7)', fontStyle: 'italic' },
  sidebarValue: { fontSize: '0.82rem', color: 'rgba(255,255,255,0.6)' },
  themeNavItem: { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.75rem', borderRadius: '6px', cursor: 'pointer' },
  themeNavItemActive: { background: 'rgba(255,255,255,0.08)' },
  themeNavNum: { fontFamily: 'monospace', fontSize: '0.65rem', color: '#c8b89a', flexShrink: 0 },
  themeNavName: { fontSize: '0.8rem', color: 'rgba(255,255,255,0.75)' },
  newBriefBtn: { marginTop: 'auto', background: 'none', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.5)', padding: '0.75rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontFamily: 'inherit' },
  main: { padding: '2.5rem 3rem' },
  themeTabs: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' as const, marginBottom: '2rem' },
  themeTab: { padding: '0.5rem 1.25rem', borderRadius: '100px', border: '1px solid #ede9e0', background: 'white', fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', color: '#666' },
  themeTabActive: { background: '#0e0d0b', color: 'white', borderColor: '#0e0d0b' },
  themeContent: { display: 'flex', flexDirection: 'column', gap: '2.5rem' },
  themeHeader: { borderBottom: '1px solid #ede9e0', paddingBottom: '2rem' },
  themeNumber: { fontFamily: 'monospace', fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#c8b89a', marginBottom: '0.5rem' },
  themeName: { fontFamily: 'Georgia, serif', fontSize: '2.2rem', fontWeight: 400, lineHeight: 1.2, marginBottom: '1rem', color: '#0e0d0b' },
  themeSummary: { fontSize: '1rem', lineHeight: 1.7, color: '#555', maxWidth: '680px', marginBottom: '1rem' },
  driversRow: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' as const },
  driverPill: { padding: '0.3rem 0.9rem', borderRadius: '100px', fontSize: '0.75rem', fontWeight: 500, color: '#333' },
  sectionLabel: { fontFamily: 'monospace', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#aaa', marginBottom: '1rem' },
  verbatimsGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' },
  verbatimCard: { background: 'white', border: '1px solid #ede9e0', borderRadius: '10px', padding: '1.25rem' },
  verbatimQuote: { fontFamily: 'Georgia, serif', fontSize: '2.5rem', color: '#ede9e0', lineHeight: 1, marginBottom: '0.25rem' },
  verbatimText: { fontSize: '0.875rem', lineHeight: 1.6, color: '#444', fontStyle: 'italic' },
  implicationsBlock: { background: 'white', border: '1px solid #ede9e0', borderRadius: '10px', overflow: 'hidden' },
  implicationRow: { display: 'flex', gap: '1rem', padding: '1rem 1.25rem', alignItems: 'flex-start' },
  implicationArrow: { color: '#2d4a3e', fontWeight: 500, flexShrink: 0, marginTop: '2px' },
  implicationText: { fontSize: '0.9rem', lineHeight: 1.6, color: '#333' },
  themeNav2: { display: 'flex', paddingTop: '1rem', borderTop: '1px solid #ede9e0' },
  navBtn: { background: 'none', border: '1px solid #ede9e0', padding: '0.6rem 1.25rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', fontFamily: 'inherit', color: '#666' },
};
