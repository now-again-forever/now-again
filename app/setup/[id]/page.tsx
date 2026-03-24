'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface Brief {
  id: string;
  brand: string;
  category: string;
  markets: string[];
  question: string;
}

interface SourceCluster {
  category: string;
  count: number;
  selected: boolean;
  example_urls: string[];
}

interface QueryProposal {
  id: number;
  label: string;
  query: string;
  selected: boolean;
  editable: boolean;
}

const CATEGORY_ICONS: Record<string, string> = {
  'Food, drink & nutrition': '🍽',
  'Health & medicine': '🏥',
  'Lifestyle': '✨',
  'General wellbeing': '💚',
  'Beauty & personal care': '💄',
  'Leisure & entertainment': '🎭',
  'Cultural & trends': '🌍',
  'Finance, investment & business': '💼',
  'Responsible living': '🌱',
  'Home': '🏠',
  'Fashion & style': '👗',
  'Science & Technology': '🔬',
  'Sports & fitness': '⚽',
  'Travel, adventure & outdoors': '✈',
  'Art, architecture & design': '🎨',
  'News & information': '📰',
  'Personal development & education': '📚',
  'Automobiles': '🚗',
};

export default function SetupPage() {
  const params = useParams();
  const id = params.id as string;
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [clusters, setClusters] = useState<SourceCluster[]>([]);
  const [queries, setQueries] = useState<QueryProposal[]>([]);
  const [generating, setGenerating] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [step, setStep] = useState<'sources' | 'queries'>('sources');

  const fetchBrief = useCallback(async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}&select=*`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const data = await res.json();
    if (data[0]) setBrief(data[0]);
    setLoading(false);
  }, [id]);

  function getRecommendedCategories(category: string, question: string): string[] {
    const cat = (category + ' ' + question).toLowerCase();
    const recommended: string[] = [];
    if (cat.includes('food') || cat.includes('drink') || cat.includes('snack') || cat.includes('flavour') || cat.includes('beverage')) recommended.push('Food, drink & nutrition', 'Lifestyle', 'Cultural & trends');
    if (cat.includes('beauty') || cat.includes('skincare')) recommended.push('Beauty & personal care', 'Lifestyle', 'Fashion & style');
    if (cat.includes('health') || cat.includes('wellness')) recommended.push('Health & medicine', 'General wellbeing', 'Lifestyle');
    if (cat.includes('fashion') || cat.includes('style')) recommended.push('Fashion & style', 'Lifestyle', 'Cultural & trends');
    if (cat.includes('sport') || cat.includes('fitness')) recommended.push('Sports & fitness', 'Lifestyle', 'General wellbeing');
    if (cat.includes('alcohol') || cat.includes('beer') || cat.includes('wine') || cat.includes('spirit') || cat.includes('cocktail')) recommended.push('Food, drink & nutrition', 'Lifestyle', 'Leisure & entertainment');
    if (recommended.length === 0) recommended.push('Lifestyle', 'Cultural & trends', 'General wellbeing');
    return [...new Set(recommended)];
  }

  const fetchSources = useCallback(async (b: Brief) => {
    const markets = (b.markets || []);
    if (markets.length === 0) return;

    const marketList = markets.map((m: string) => `"${m}"`).join(',');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sources?country=in.(${marketList})&select=category,url&limit=5000`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const data = await res.json();

    const grouped: Record<string, string[]> = {};
    for (const row of data) {
      if (!grouped[row.category]) grouped[row.category] = [];
      grouped[row.category].push(row.url);
    }

    const recommended = getRecommendedCategories(b.category, b.question);

    const clusterList: SourceCluster[] = Object.entries(grouped)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([category, urls]) => ({
        category,
        count: urls.length,
        selected: recommended.includes(category),
        example_urls: urls.slice(0, 3)
      }));

    setClusters(clusterList);
  }, []);

  async function generateQueries() {
    if (!brief) return;
    setGenerating(true);
    try {
      const selectedCats = clusters.filter(c => c.selected).map(c => c.category).join(', ');
      const res = await fetch('/api/generate-queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, selectedCats })
      });
      const data = await res.json();
      setQueries((data.queries || []).map((q: any, i: number) => ({
        id: i, label: q.label, query: q.query, selected: true, editable: false
      })));
      setStep('queries');
    } catch (e) {
      console.error(e);
    } finally {
      setGenerating(false);
    }
  }

  async function launchCollection() {
    if (!brief) return;
    setLaunching(true);
    const selectedClusters = clusters.filter(c => c.selected).map(c => c.category);
    const selectedQueries = queries.filter(q => q.selected).map(q => ({ label: q.label, query: q.query }));

    await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ status: 'collecting', selected_clusters: selectedClusters, selected_queries: selectedQueries })
    });

    fetch('/api/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ briefId: id })
    }).catch(() => {});

    window.location.href = `/results/${id}`;
  }

  useEffect(() => { fetchBrief(); }, [fetchBrief]);
  useEffect(() => { if (brief) fetchSources(brief); }, [brief, fetchSources]);

  if (loading) return <div style={s.centred}><div style={s.spinner} /></div>;

  const selectedCount = clusters.filter(c => c.selected).length;
  const totalSources = clusters.filter(c => c.selected).reduce((sum, c) => sum + c.count, 0);

  return (
    <div style={s.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;1,400&family=DM+Sans:wght@300;400;500&family=DM+Mono&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <header style={s.header}>
        <div style={s.logo}>now<span style={s.logoAccent}>—</span>again</div>
        <div style={s.headerMeta}>
          <span style={s.headerBrand}>{brief?.brand}</span>
          <span style={s.headerDot}>·</span>
          <span style={s.headerTag}>Source setup</span>
        </div>
        <div style={s.steps}>
          <div style={{ ...s.stepPill, ...(step === 'sources' ? s.stepActive : s.stepDone) }}>1. Sources</div>
          <div style={s.stepLine} />
          <div style={{ ...s.stepPill, ...(step === 'queries' ? s.stepActive : s.stepInactive) }}>2. Queries</div>
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
          <div style={s.summaryBox}>
            {step === 'sources' ? (
              <>
                <div style={s.summaryNum}>{selectedCount}</div>
                <div style={s.summaryLabel}>clusters selected</div>
                <div style={s.summaryNum}>{totalSources.toLocaleString()}</div>
                <div style={s.summaryLabel}>sources available</div>
              </>
            ) : (
              <>
                <div style={s.summaryNum}>{queries.filter(q => q.selected).length}</div>
                <div style={s.summaryLabel}>queries selected</div>
              </>
            )}
          </div>
        </aside>

        <main style={s.main}>
          {step === 'sources' && (
            <>
              <div style={s.mainHeader}>
                <h1 style={s.mainTitle}>Choose your <em style={{ fontStyle: 'italic', color: '#c8b89a' }}>sources</em></h1>
                <p style={s.mainSub}>We've pre-selected the most relevant content clusters. Add or remove as needed.</p>
              </div>
              <div style={s.clusterGrid}>
                {clusters.map((cluster, i) => (
                  <div key={i}
                    style={{ ...s.clusterCard, ...(cluster.selected ? s.clusterSelected : {}) }}
                    onClick={() => { const next = [...clusters]; next[i].selected = !next[i].selected; setClusters(next); }}>
                    <div style={s.clusterTop}>
                      <span style={{ fontSize: '1.25rem' }}>{CATEGORY_ICONS[cluster.category] || '📄'}</span>
                      <div style={{ ...s.clusterCheck, ...(cluster.selected ? s.clusterCheckOn : {}) }}>{cluster.selected ? '✓' : ''}</div>
                    </div>
                    <div style={s.clusterName}>{cluster.category}</div>
                    <div style={s.clusterCount}>{cluster.count.toLocaleString()} sources</div>
                    {cluster.selected && (
                      <div style={{ marginTop: '0.5rem' }}>
                        {cluster.example_urls.map((u, j) => {
                          try { return <div key={j} style={s.clusterUrl}>{new URL(u).hostname.replace('www.','')}</div>; }
                          catch { return null; }
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div style={s.actionRow}>
                <button style={s.btnPrimary} onClick={generateQueries} disabled={generating || selectedCount === 0}>
                  {generating ? 'Generating queries...' : `Continue →`}
                </button>
                <p style={s.actionNote}>{totalSources.toLocaleString()} sources · {selectedCount} clusters selected</p>
              </div>
            </>
          )}

          {step === 'queries' && (
            <>
              <div style={s.mainHeader}>
                <h1 style={s.mainTitle}>Review your <em style={{ fontStyle: 'italic', color: '#c8b89a' }}>queries</em></h1>
                <p style={s.mainSub}>Claude has generated these Boolean search queries. Edit, remove, or add your own.</p>
              </div>
              <div style={s.queryList}>
                {queries.map((q, i) => (
                  <div key={i} style={{ ...s.queryCard, opacity: q.selected ? 1 : 0.4 }}>
                    <div style={s.queryTop}>
                      <div style={s.queryLabel}>{q.label}</div>
                      <button style={s.queryToggle} onClick={() => { const next = [...queries]; next[i].selected = !next[i].selected; setQueries(next); }}>
                        {q.selected ? 'Remove' : 'Add back'}
                      </button>
                    </div>
                    {q.editable
                      ? <textarea style={s.queryEdit} value={q.query} onChange={e => { const next = [...queries]; next[i].query = e.target.value; setQueries(next); }} />
                      : <div style={s.queryText}>{q.query}</div>
                    }
                    <button style={s.queryEditBtn} onClick={() => { const next = [...queries]; next[i].editable = !next[i].editable; setQueries(next); }}>
                      {q.editable ? 'Done' : 'Edit'}
                    </button>
                  </div>
                ))}
              </div>
              <div style={s.actionRow}>
                <button style={s.btnSecondary} onClick={() => setStep('sources')}>← Back</button>
                <button style={s.btnPrimary} onClick={launchCollection} disabled={launching || queries.filter(q => q.selected).length === 0}>
                  {launching ? 'Launching...' : 'Launch collection →'}
                </button>
              </div>
              <p style={s.actionNote}>Collection may take up to 1 hour. We'll notify you when ready.</p>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f5f3ee', fontFamily: "'DM Sans', sans-serif" },
  centred: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' },
  spinner: { width: 36, height: 36, borderRadius: '50%', border: '2px solid #e0ddd5', borderTop: '2px solid #2d4a3e', animation: 'spin 1s linear infinite' },
  header: { display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.5rem 2.5rem', borderBottom: '1px solid #ede9e0', background: '#f5f3ee', position: 'sticky', top: 0, zIndex: 10 },
  logo: { fontFamily: 'Georgia, serif', fontSize: '1.1rem', marginRight: '0.5rem' },
  logoAccent: { color: '#c8b89a' },
  headerMeta: { display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 },
  headerBrand: { fontWeight: 500, fontSize: '0.875rem' },
  headerDot: { color: '#ccc' },
  headerTag: { fontSize: '0.8rem', color: '#999' },
  steps: { display: 'flex', alignItems: 'center', gap: '0.5rem' },
  stepPill: { fontSize: '0.75rem', padding: '4px 12px', borderRadius: '100px', fontWeight: 500 },
  stepActive: { background: '#0e0d0b', color: 'white' },
  stepDone: { background: '#e8f0ec', color: '#2d4a3e' },
  stepInactive: { background: '#f0ede8', color: '#aaa' },
  stepLine: { width: 20, height: 1, background: '#ddd' },
  outer: { display: 'grid', gridTemplateColumns: '260px 1fr', minHeight: 'calc(100vh - 65px)' },
  sidebar: { background: '#0e0d0b', color: '#f5f3ee', padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' },
  sidebarLabel: { fontFamily: 'monospace', fontSize: '0.65rem', letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#c8b89a', marginBottom: '0.4rem' },
  sidebarQuestion: { fontFamily: 'Georgia, serif', fontSize: '0.85rem', lineHeight: 1.6, color: 'rgba(255,255,255,0.7)', fontStyle: 'italic' },
  sidebarValue: { fontSize: '0.82rem', color: 'rgba(255,255,255,0.6)' },
  summaryBox: { marginTop: 'auto', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '1.25rem' },
  summaryNum: { fontFamily: 'Georgia, serif', fontSize: '2rem', color: '#f5f3ee' },
  summaryLabel: { fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', marginBottom: '0.75rem' },
  main: { padding: '3rem' },
  mainHeader: { marginBottom: '2rem' },
  mainTitle: { fontFamily: 'Georgia, serif', fontSize: '2rem', fontWeight: 400, marginBottom: '0.5rem', color: '#0e0d0b' },
  mainSub: { fontSize: '0.9rem', color: '#888', lineHeight: 1.6 },
  clusterGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '2.5rem' },
  clusterCard: { background: 'white', border: '1px solid #ede9e0', borderRadius: '10px', padding: '1rem', cursor: 'pointer', transition: 'all 0.15s' },
  clusterSelected: { background: '#e8f0ec', borderColor: '#2d4a3e' },
  clusterTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' },
  clusterCheck: { width: 20, height: 20, borderRadius: '50%', border: '1.5px solid #ddd', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: 'white' },
  clusterCheckOn: { background: '#2d4a3e', borderColor: '#2d4a3e' },
  clusterName: { fontSize: '0.82rem', fontWeight: 500, color: '#0e0d0b', marginBottom: '0.25rem', lineHeight: 1.3 },
  clusterCount: { fontSize: '0.75rem', color: '#aaa', fontFamily: 'monospace' },
  clusterUrl: { fontSize: '0.7rem', color: '#2d4a3e', fontFamily: 'monospace' },
  actionRow: { display: 'flex', alignItems: 'center', gap: '1rem', paddingTop: '1.5rem', borderTop: '1px solid #ede9e0' },
  actionNote: { fontSize: '0.78rem', color: '#bbb' },
  btnPrimary: { background: '#0e0d0b', color: '#f5f3ee', border: 'none', padding: '0.9rem 2rem', borderRadius: '6px', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' },
  btnSecondary: { background: 'none', border: '1px solid #ddd', color: '#666', padding: '0.9rem 1.5rem', borderRadius: '6px', fontSize: '0.875rem', cursor: 'pointer', fontFamily: 'inherit' },
  queryList: { display: 'flex', flexDirection: 'column' as const, gap: '1rem', marginBottom: '2rem' },
  queryCard: { background: 'white', border: '1px solid #ede9e0', borderRadius: '10px', padding: '1.25rem', transition: 'opacity 0.15s' },
  queryTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' },
  queryLabel: { fontSize: '0.875rem', fontWeight: 500, color: '#0e0d0b' },
  queryToggle: { fontSize: '0.75rem', color: '#888', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' },
  queryText: { fontSize: '0.78rem', color: '#666', fontFamily: 'monospace', lineHeight: 1.6, background: '#f9f8f6', padding: '0.75rem', borderRadius: '6px', wordBreak: 'break-word' as const },
  queryEdit: { width: '100%', fontSize: '0.78rem', fontFamily: 'monospace', lineHeight: 1.6, background: '#f9f8f6', padding: '0.75rem', borderRadius: '6px', border: '1px solid #2d4a3e', minHeight: '80px', resize: 'vertical' as const, boxSizing: 'border-box' as const },
  queryEditBtn: { marginTop: '0.5rem', fontSize: '0.72rem', color: '#2d4a3e', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' },
};
