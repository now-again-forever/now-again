'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface Brief {
  id: string;
  brand: string;
  category: string;
  markets: string[];
  question: string;
  status: string;
  selected_clusters: string[];
  selected_queries: { label: string; query: string }[];
  collection_progress: {
    total_posts: number;
    sources_scraped: number;
    sources_total: number;
    log: string[];
  };
  post_count: number;
}

import React from 'react';

const ANALYSIS_STEPS = [
  'Reading your collected conversations...',
  'Identifying cultural signals...',
  'Clustering themes and patterns...',
  'Scoring human drivers...',
  'Writing strategic implications...',
  'Almost there...',
];

function GeneratingSteps() {
  const [step, setStep] = React.useState(0);
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => setStep(s => Math.min(s + 1, ANALYSIS_STEPS.length - 1)), 6000);
    const ticker = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => { clearInterval(timer); clearInterval(ticker); };
  }, []);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '2rem', maxWidth: '420px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <svg width="44" height="44" viewBox="0 0 44 44" style={{ animation: 'spin 2s linear infinite', flexShrink: 0 }}>
          <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2"/>
          <circle cx="22" cy="22" r="18" fill="none" stroke="#2d4a3e" strokeWidth="2" strokeDasharray="28 90" strokeLinecap="round"/>
        </svg>
        <div>
          <div style={{ fontSize: '0.875rem', color: '#f5f3ee', fontWeight: 500, marginBottom: '3px' }}>{ANALYSIS_STEPS[step]}</div>
          <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>{elapsed}s — usually 20–40 seconds</div>
        </div>
      </div>
      <div style={{ height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 1 }}>
        <div style={{ height: '100%', background: '#2d4a3e', borderRadius: 1, width: `${Math.min((step / (ANALYSIS_STEPS.length - 1)) * 100, 95)}%`, transition: 'width 1s ease' }}/>
      </div>
    </div>
  );
}

export default function CollectingPage() {
  const params = useParams();
  const id = params.id as string;
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [triggered, setTriggered] = useState(false);
  const [generating, setGenerating] = useState(false);
  const startTime = useRef(Date.now());
  const timerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const pollRef = useRef<NodeJS.Timeout | undefined>(undefined);

  const fetchBrief = useCallback(async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}&select=*`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const data = await res.json();
    if (data[0]) setBrief(data[0]);
    setLoading(false);
    return data[0]?.status;
  }, [id]);

  const triggerCollection = useCallback(async () => {
    if (triggered) return;
    setTriggered(true);
    try {
      fetch('/api/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefId: id })
      }).catch(() => {});
    } catch (e) { console.error(e); }
  }, [id, triggered]);

  useEffect(() => {
    if (!id) return;
    const init = async () => {
      const status = await fetchBrief();
      if (status === 'collected' || status === 'complete') return;

      startTime.current = Date.now();
      triggerCollection();

      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
      }, 1000);

      pollRef.current = setInterval(async () => {
        const s = await fetchBrief();
        if (s === 'collected' || s === 'complete') {
          clearInterval(timerRef.current);
          clearInterval(pollRef.current);
        }
      }, 5000);
    };
    init();
    return () => {
      clearInterval(timerRef.current);
      clearInterval(pollRef.current);
    };
  }, [id, fetchBrief, triggerCollection]);

  const formatTime = (secs: number) => {
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  };

  if (loading) return (
    <div style={s.centred}>
      <div style={s.spinner} />
    </div>
  );

  const isComplete = brief?.status === 'collected' || brief?.status === 'complete';
  const progress = brief?.collection_progress;
  const pct = progress?.sources_total
    ? Math.round((progress.sources_scraped / progress.sources_total) * 100)
    : 0;

  return (
    <div style={s.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;1,400&family=DM+Sans:wght@300;400;500&family=DM+Mono&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:.4} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)} }
      `}</style>

      <header style={s.header}>
        <div style={s.logo}>now<span style={s.logoAccent}>—</span>again</div>
        <div style={s.headerMeta}>
          <span style={s.headerBrand}>{brief?.brand}</span>
          <span style={s.headerDot}>·</span>
          <span style={s.headerTag}>{isComplete ? 'Collection complete' : 'Collecting data'}</span>
        </div>
      </header>

      <div style={s.outer}>
        <aside style={s.sidebar}>
          <div>
            <div style={s.sidebarLabel}>Brief</div>
            <p style={s.sidebarQuestion}>"{brief?.question}"</p>
          </div>
          <div>
            <div style={s.sidebarLabel}>Markets</div>
            <p style={s.sidebarValue}>{(brief?.markets || []).join(', ')}</p>
          </div>
          <div>
            <div style={s.sidebarLabel}>Sources</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {(brief?.selected_clusters || []).map((c, i) => (
                <div key={i} style={s.clusterTag}>{c}</div>
              ))}
            </div>
          </div>
          <div>
            <div style={s.sidebarLabel}>Queries</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {(brief?.selected_queries || []).map((q, i) => (
                <div key={i} style={s.queryTag}>{q.label}</div>
              ))}
            </div>
          </div>
        </aside>

        <main style={s.main}>
          {isComplete ? (
            <div style={s.completeSection}>
              <div style={s.completeIcon}>✓</div>
              <h1 style={s.completeTitle}>Collection <em style={{ fontStyle: 'italic', color: '#c8b89a' }}>complete</em></h1>
              <p style={s.completeSub}>
                {progress?.total_posts || brief?.post_count || 0} conversations collected across {(brief?.selected_clusters || []).length} source clusters.
                Ready for AI analysis.
              </p>
              <button style={s.btnPrimary} disabled={generating} onClick={async () => {
                setGenerating(true);
                try {
                  const res = await fetch('/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ briefId: id })
                  });
                  const data = await res.json();
                  if (data.success) {
                    window.location.href = `/results/${id}`;
                  } else {
                    alert('Generation failed — please try again');
                    setGenerating(false);
                  }
                } catch (e) {
                  alert('Something went wrong — please try again');
                  setGenerating(false);
                }
              }}>
                {generating ? 'Analysing...' : 'Generate insights →'}
              </button>
            </div>
          )}

          {generating && (
            <div style={{ marginTop: '2rem', maxWidth: '400px' }}>
              <GeneratingSteps />
            </div>
          )}

          {!generating && isComplete ? null : (
            <>
              <div style={s.statusSection}>
                <div style={s.bigTimer}>
                  <svg width="120" height="120" viewBox="0 0 120 120" style={{ animation: 'spin 3s linear infinite' }}>
                    <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2" />
                    <circle cx="60" cy="60" r="54" fill="none" stroke="#2d4a3e" strokeWidth="2"
                      strokeDasharray="80 260" strokeLinecap="round" />
                  </svg>
                  <div style={s.timerLabel}>{formatTime(elapsed)}</div>
                </div>

                <h1 style={s.mainTitle}>
                  Collecting <em style={{ fontStyle: 'italic', color: '#c8b89a' }}>conversations...</em>
                </h1>
                <p style={s.mainSub}>
                  Scanning {(brief?.selected_clusters || []).length} source clusters across {(brief?.markets || []).join(', ')} markets.<br />
                  This can take up to an hour. You can close this tab — we'll email you when it's ready.
                </p>

                {progress?.sources_total ? (
                  <div style={s.progressSection}>
                    <div style={s.progressRow}>
                      <span style={s.progressLabel}>Sources scanned</span>
                      <span style={s.progressValue}>{progress.sources_scraped} / {progress.sources_total}</span>
                    </div>
                    <div style={s.progressTrack}>
                      <div style={{ ...s.progressFill, width: `${pct}%` }} />
                    </div>
                    <div style={s.progressRow}>
                      <span style={s.progressLabel}>Conversations collected</span>
                      <span style={s.progressValue}>{progress.total_posts}</span>
                    </div>
                  </div>
                ) : (
                  <div style={s.progressSection}>
                    <div style={s.progressRow}>
                      <span style={s.progressLabel}>Status</span>
                      <span style={{ ...s.progressValue, animation: 'pulse 1.5s ease-in-out infinite' }}>Initialising...</span>
                    </div>
                    <div style={s.progressTrack}>
                      <div style={{ ...s.progressFill, width: '5%', animation: 'pulse 2s ease-in-out infinite' }} />
                    </div>
                  </div>
                )}
              </div>

              {progress?.log && progress.log.length > 0 && (
                <div style={s.logSection}>
                  <div style={s.logLabel}>Activity log</div>
                  <div style={s.logBox}>
                    {[...progress.log].reverse().slice(0, 20).map((entry, i) => (
                      <div key={i} style={{ ...s.logEntry, animation: i === 0 ? 'fadeIn 0.3s ease' : 'none' }}>
                        <span style={s.logDot} />
                        {entry}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={s.queriesSection}>
                <div style={s.queriesLabel}>Active queries</div>
                <div style={s.queriesList}>
                  {(brief?.selected_queries || []).map((q, i) => (
                    <div key={i} style={s.queryChip}>{q.label}</div>
                  ))}
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#0e0d0b', fontFamily: "'DM Sans', sans-serif", color: '#f5f3ee' },
  centred: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' },
  spinner: { width: 36, height: 36, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.1)', borderTop: '2px solid #2d4a3e', animation: 'spin 1s linear infinite' },
  header: { display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.5rem 2.5rem', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, background: '#0e0d0b', zIndex: 10 },
  logo: { fontFamily: 'Georgia, serif', fontSize: '1.1rem', marginRight: '0.5rem' },
  logoAccent: { color: '#c8b89a' },
  headerMeta: { display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 },
  headerBrand: { fontWeight: 500, fontSize: '0.875rem' },
  headerDot: { color: 'rgba(255,255,255,0.2)' },
  headerTag: { fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' },
  outer: { display: 'grid', gridTemplateColumns: '260px 1fr', minHeight: 'calc(100vh - 65px)' },
  sidebar: { borderRight: '1px solid rgba(255,255,255,0.06)', padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' },
  sidebarLabel: { fontFamily: 'monospace', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#c8b89a', marginBottom: '0.4rem' },
  sidebarQuestion: { fontFamily: 'Georgia, serif', fontSize: '0.85rem', lineHeight: 1.6, color: 'rgba(255,255,255,0.6)', fontStyle: 'italic' },
  sidebarValue: { fontSize: '0.82rem', color: 'rgba(255,255,255,0.5)' },
  clusterTag: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' },
  queryTag: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' },
  main: { padding: '4rem 3rem' },
  statusSection: { display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '600px' },
  bigTimer: { position: 'relative', width: 120, height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  timerLabel: { position: 'absolute', fontFamily: 'monospace', fontSize: '0.85rem', color: '#c8b89a' },
  mainTitle: { fontFamily: 'Georgia, serif', fontSize: '2.5rem', fontWeight: 400, lineHeight: 1.2, margin: 0 },
  mainSub: { fontSize: '0.9rem', color: 'rgba(255,255,255,0.5)', lineHeight: 1.7, margin: 0 },
  progressSection: { display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' },
  progressRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  progressLabel: { fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace', textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  progressValue: { fontSize: '0.875rem', color: '#f5f3ee', fontWeight: 500 },
  progressTrack: { height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden', margin: '4px 0 12px' },
  progressFill: { height: '100%', background: '#2d4a3e', borderRadius: 2, transition: 'width 2s ease' },
  logSection: { marginTop: '2.5rem', maxWidth: '600px' },
  logLabel: { fontFamily: 'monospace', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.25)', marginBottom: '0.75rem' },
  logBox: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '1rem', maxHeight: '200px', overflowY: 'auto' as const },
  logEntry: { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(255,255,255,0.03)' },
  logDot: { width: 4, height: 4, borderRadius: '50%', background: '#2d4a3e', flexShrink: 0 },
  queriesSection: { marginTop: '2rem', maxWidth: '600px' },
  queriesLabel: { fontFamily: 'monospace', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'rgba(255,255,255,0.25)', marginBottom: '0.75rem' },
  queriesList: { display: 'flex', flexWrap: 'wrap' as const, gap: '0.5rem' },
  queryChip: { fontSize: '0.75rem', padding: '4px 10px', borderRadius: '100px', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' },
  completeSection: { display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '500px' },
  completeIcon: { width: 56, height: 56, borderRadius: '50%', background: '#2d4a3e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem' },
  completeTitle: { fontFamily: 'Georgia, serif', fontSize: '2.5rem', fontWeight: 400, lineHeight: 1.2, margin: 0 },
  completeSub: { fontSize: '0.9rem', color: 'rgba(255,255,255,0.5)', lineHeight: 1.7, margin: 0 },
  btnPrimary: { alignSelf: 'flex-start', background: '#f5f3ee', color: '#0e0d0b', border: 'none', padding: '0.9rem 2rem', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' },
};
