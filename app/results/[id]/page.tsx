'use client';

import { useEffect, useState, useCallback } from 'react';
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

export default function ResultsPage() {
  const params = useParams();
  const id = params.id as string;
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTheme, setActiveTheme] = useState(0);
  const [pollCount, setPollCount] = useState(0);
  const [triggered, setTriggered] = useState(false);

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

    let interval: NodeJS.Timeout;

    const init = async () => {
      const status = await fetchBrief();
      if (status === 'pending') {
        triggerGeneration();
        interval = setInterval(async () => {
          setPollCount(c => c + 1);
          const s = await fetchBrief();
          if (s === 'complete') clearInterval(interval);
        }, 3000);
      }
    };

    init();
    return () => clearInterval(interval);
  }, [id, fetchBrief, triggerGeneration]);

  if (loading) return <Centred><Spinner /><p style={s.loadingText}>Loading...</p></Centred>;

  if (!brief) return <Centred><p style={{ color: '#c0392b', fontFamily: 'Georgia, serif' }}>Brief not found.</p></Centred>;

  if (brief.status !== 'complete') return (
    <Centred>
      <Spinner />
      <p style={s.loadingTitle}>Listening to culture...</p>
      <p style={s.loadingText}>
        Collecting conversations from Hacker News, Bluesky and Reddit.<br />
        Running them through our insight engine. This takes about 30–60 seconds.
      </p>
      <div style={s.loadingSteps}>
        {['Extracting keywords from your brief', 'Pulling real conversations', 'Identifying cultural themes', `Writing implications for ${brief.brand}`].map((step, i) => (
          <div key={i} style={s.loadingStep}><div style={s.loadingDot} /><span>{step}</span></div>
        ))}
      </div>
      <p style={{ fontSize: '0.75rem', color: '#ccc', marginTop: '1rem' }}>Checking for results... ({pollCount})</p>
    </Centred>
  );

  const themes = brief.results?.themes || [];

  return (
    <div style={s.page}>
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
            <p style={s.sidebarQuestion}>"{brief.question}"</p>
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
                      <div style={s.verbatimQuote}>"</div>
                      <p style={s.verbatimText}>{v}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div style={s.sectionLabel}>Implications for {brief.brand}</div>
                <div style={s.implicationsBlock}>
                  {themes[activeTheme].implications.map((imp, i) => (
                    <div key={i} style={s.implicationRow}>
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

function Centred({ children }: { children: React.ReactNode }) {
  return <div style={s.centred}>{children}</div>;
}

function Spinner() {
  return (
    <div style={{ width: 40, height: 40, borderRadius: '50%', border: '2px solid #e0ddd5', borderTop: '2px solid #2d4a3e',
      animation: 'spin 1s linear infinite' }} />
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f5f3ee', fontFamily: "'DM Sans', sans-serif" },
  centred: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: '1rem', padding: '2rem', textAlign: 'center' },
  loadingTitle: { fontFamily: 'Georgia, serif', fontSize: '1.5rem', fontWeight: 400, color: '#0e0d0b', margin: 0 },
  loadingText: { fontSize: '0.875rem', color: '#999', lineHeight: 1.6, margin: 0, maxWidth: 420 },
  loadingSteps: { display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' },
  loadingStep: { display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.8rem', color: '#888' },
  loadingDot: { width: 6, height: 6, borderRadius: '50%', background: '#2d4a3e', flexShrink: 0 },
  header: { display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.5rem 2.5rem', borderBottom: '1px solid #ede9e0', background: '#f5f3ee', position: 'sticky', top: 0, zIndex: 10 },
  logo: { fontFamily: 'Georgia, serif', fontSize: '1.1rem', marginRight: '1rem' },
  logoAccent: { color: '#c8b89a' },
  headerMeta: { display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 },
  headerBrand: { fontWeight: 500, fontSize: '0.875rem' },
  headerDot: { color: '#ccc' },
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
  implicationRow: { display: 'flex', gap: '1rem', padding: '1rem 1.25rem', borderBottom: '1px solid #f5f3ee', alignItems: 'flex-start' },
  implicationArrow: { color: '#2d4a3e', fontWeight: 500, flexShrink: 0, marginTop: '2px' },
  implicationText: { fontSize: '0.9rem', lineHeight: 1.6, color: '#333' },
  themeNav2: { display: 'flex', paddingTop: '1rem', borderTop: '1px solid #ede9e0' },
  navBtn: { background: 'none', border: '1px solid #ede9e0', padding: '0.6rem 1.25rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', fontFamily: 'inherit', color: '#666' },
};
