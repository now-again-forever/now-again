'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const DRIVERS = ['Creativity','Experiences','Emotion','Engagement','Relationships','Responsibility','Wellbeing','Simplicity','Resilience','Control','Enhancement','Power','Achievement','Exploration','Individuality','Extremes'];
const DRIVER_KEYWORDS: Record<string, string[]> = {
  Creativity: ['creative','innovative','unique','original','craft','handmade','artisan','made'],
  Experiences: ['experience','memory','tried','tasted','felt','discovered','visited'],
  Emotion: ['love','hate','feel','emotional','passionate','heart','excited','moved'],
  Engagement: ['community','together','social','share','connect','belong','join'],
  Relationships: ['family','friend','grandmother','mother','father','kids','children','we','our'],
  Responsibility: ['sustainable','ethical','local','support','environment','organic','fair'],
  Wellbeing: ['healthy','health','wellness','natural','fresh','clean','nutrition'],
  Simplicity: ['simple','traditional','classic','pure','honest','straightforward'],
  Resilience: ['boycott','resist','refuse','against','independent','strong','despite'],
  Control: ['choose','choice','decide','prefer','want','control','my decision'],
  Enhancement: ['better','premium','quality','superior','best','excellent','upgrade'],
  Power: ['power','influence','impact','change','force','dominant','authority'],
  Achievement: ['proud','achievement','success','accomplished','earned','deserve'],
  Exploration: ['discover','explore','new','try','experiment','curious','exotic'],
  Individuality: ['I','my','myself','personal','unique','individual','own'],
  Extremes: ['obsessed','always','never','absolutely','completely','totally','extreme'],
};

function scoreDrivers(posts: any[]): Record<string, number> {
  const scores: Record<string, number> = {};
  DRIVERS.forEach(d => scores[d] = 0);
  for (const post of posts) {
    const text = (post.text || '').toLowerCase();
    for (const [driver, keywords] of Object.entries(DRIVER_KEYWORDS)) {
      scores[driver] += keywords.filter(kw => text.includes(kw)).length;
    }
  }
  const max = Math.max(...Object.values(scores), 1);
  const norm: Record<string, number> = {};
  DRIVERS.forEach(d => norm[d] = Math.round((scores[d] / max) * 100));
  return norm;
}

const BUCKET_COLORS = ['#5DCAA5','#AFA9EC','#F0997B','#85B7EB','#FAC775','#ED93B1','#97C459'];

function calcMetrics(posts: any[], brief?: any) {
  if (!posts || posts.length === 0) return { energy: 0, temperature: 0, consumerRatio: 0, opportunity: 0, tension: 0, marketSpread: 0, richness: 0, brandRelevance: 0 };

  const n = posts.length;

  // ENERGY: % of posts with strong emotional language
  const emotionWords = /\b(love|hate|obsessed|amazing|terrible|awful|brilliant|disgusting|incredible|furious|thrilled|devastated|addicted|always|never|absolutely|completely|best|worst|shocked|surprised|disappointed|excited)\b/i;
  const energy = Math.round((posts.filter(p => emotionWords.test(p.text || '')).length / n) * 100);

  // TEMPERATURE: % of posts from last 30 days
  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const temperature = Math.round((posts.filter(p => {
    const ts = p.timestamp ? new Date(p.timestamp).getTime() : 0;
    return ts > 0 && (now - ts) < thirtyDays;
  }).length / n) * 100);

  // CONSUMER VOICE: % from social vs editorial
  const consumerTypes = new Set(['youtube','bluesky','mastodon','web','tavily']);
  const consumerRatio = Math.round((posts.filter(p => consumerTypes.has(p.type || '')).length / n) * 100);

  // TENSION: % of posts with conflicting sentiment signals
  const posWords = /\b(love|great|amazing|brilliant|best|perfect|excellent|fantastic|wonderful|good)\b/i;
  const negWords = /\b(hate|terrible|awful|worst|bad|disappointing|horrible|disgusting|annoying|frustrating)\b/i;
  const tensionPosts = posts.filter(p => {
    const t = p.text || '';
    return posWords.test(t) && negWords.test(t);
  }).length;
  const tension = Math.round((tensionPosts / n) * 100);

  // MARKET SPREAD: how many distinct markets represented (0-100 scaled to selected markets count)
  const markets = new Set(posts.map(p => p.country).filter(c => c && c !== 'Global' && c !== 'unknown'));
  const marketSpread = Math.min(100, Math.round((markets.size / Math.max(1, 5)) * 100));

  // RICHNESS: average post length as proxy for depth of engagement
  const avgLen = posts.reduce((sum, p) => sum + (p.text?.length || 0), 0) / n;
  const richness = Math.min(100, Math.round((avgLen / 300) * 100));

  // BRAND RELEVANCE: how often brief brand/category terms appear
  let brandRelevance = 0;
  if (brief) {
    const brandTerms = [...(brief.brand || '').toLowerCase().split(/\s+/), ...(brief.category || '').toLowerCase().split(/\s+/)].filter(w => w.length > 3);
    if (brandTerms.length > 0) {
      const relevant = posts.filter(p => {
        const t = (p.text || '').toLowerCase();
        return brandTerms.some(term => t.includes(term));
      }).length;
      brandRelevance = Math.round((relevant / n) * 100);
    }
  }

  // OPPORTUNITY: weighted composite
  const opportunity = Math.round((energy * 0.25) + (temperature * 0.2) + (consumerRatio * 0.2) + (tension * 0.2) + (richness * 0.15));

  return { energy, temperature, consumerRatio, opportunity, tension, marketSpread, richness, brandRelevance };
}

interface Cluster { name: string; description: string; count: number; posts: any[]; }
interface Bucket { id: string; name: string; color: string; postIndices: number[]; }
interface WorkspaceState { starred: number[]; binned: number[]; buckets: Bucket[]; postBuckets: Record<number, string>; selectedClusters: string[]; }

export default function WorkspacePage() {
  const params = useParams();
  const id = params.id as string;
  const [brief, setBrief] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [clustering, setClustering] = useState(false);
  const [stage, setStage] = useState<'overview' | 'reading'>('overview');
  const [ws, setWs] = useState<WorkspaceState>({ starred: [], binned: [], buckets: [], postBuckets: {}, selectedClusters: [] });
  const [activeTab, setActiveTab] = useState<'buckets' | 'spider' | 'hints'>('buckets');
  const [search, setSearch] = useState('');
  const [newBucketName, setNewBucketName] = useState('');
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [hints, setHints] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [editingBucket, setEditingBucket] = useState<string | null>(null);
  const [clusterSort, setClusterSort] = useState<'size' | 'energy' | 'temperature' | 'opportunity' | 'tension' | 'marketSpread' | 'richness'>('opportunity');
  const [insightsPanelOpen, setInsightsPanelOpen] = useState(false);
  const [trends, setTrends] = useState<Record<string, { values: number[]; velocity: number }>>({});
  const [trendsLoading, setTrendsLoading] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const saveWs = useCallback(async (newWs: WorkspaceState) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ workspace_state: newWs })
      });
    }, 800);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}&select=*`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      const data = await res.json();
      const b = data[0];
      if (!b) { setLoading(false); return; }
      setBrief(b);
      setPosts(b.collected_posts_full || []);
      if (b.clusters) {
        setClusters(b.clusters);
        // Fetch trends in background
        setTimeout(() => fetchTrends(b.clusters), 500);
      }
      if (b.workspace_state) setWs(b.workspace_state);
      setLoading(false);
    };
    load();
  }, [id]);

  const runClustering = async () => {
    setClustering(true);
    const res = await fetch('/api/cluster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ briefId: id })
    });
    const data = await res.json();
    if (data.success) {
      // Reload brief to get updated clusters
      const bRes = await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}&select=clusters,collected_posts_full`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      const bData = await bRes.json();
      if (bData[0]?.clusters) {
        const newClusters = bData[0].clusters;
        setClusters(newClusters);
        // Fetch trends for top clusters
        fetchTrends(newClusters);
      }
      if (bData[0]?.collected_posts_full) setPosts(bData[0].collected_posts_full);
    }
    setClustering(false);
  };

  const fetchTrends = async (_clustersToFetch?: any[]) => {
    if (!id) return;
    setTrendsLoading(true);
    try {
      const res = await fetch('/api/trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefId: id })
      });
      const data = await res.json();
      if (data.success) setTrends(data.trends);
    } catch (e) { console.error('Trends fetch failed:', e); }
    setTrendsLoading(false);
  };

  const updateWs = (update: Partial<WorkspaceState>) => {
    const newWs = { ...ws, ...update };
    setWs(newWs);
    saveWs(newWs);
  };

  const toggleCluster = (name: string) => {
    const sel = ws.selectedClusters.includes(name)
      ? ws.selectedClusters.filter(n => n !== name)
      : [...ws.selectedClusters, name];
    updateWs({ selectedClusters: sel });
  };

  const toggleStar = (i: number) => {
    const starred = ws.starred.includes(i) ? ws.starred.filter(x => x !== i) : [...ws.starred, i];
    updateWs({ starred });
  };

  const toggleBin = (i: number) => {
    const binned = ws.binned.includes(i) ? ws.binned.filter(x => x !== i) : [...ws.binned, i];
    updateWs({ binned });
  };

  const addBucket = () => {
    if (!newBucketName.trim()) return;
    const bucket: Bucket = { id: Date.now().toString(), name: newBucketName.trim(), color: BUCKET_COLORS[ws.buckets.length % BUCKET_COLORS.length], postIndices: [] };
    updateWs({ buckets: [...ws.buckets, bucket] });
    setNewBucketName('');
  };

  const assignToBucket = (postIdx: number, bucketId: string) => {
    const postBuckets = { ...ws.postBuckets };
    if (postBuckets[postIdx] === bucketId) delete postBuckets[postIdx];
    else postBuckets[postIdx] = bucketId;
    const buckets = ws.buckets.map(b => ({ ...b, postIndices: Object.entries(postBuckets).filter(([,bid]) => bid === b.id).map(([pi]) => parseInt(pi)) }));
    updateWs({ postBuckets, buckets });
    setSelectedCard(null);
  };

  const generateHints = async () => {
    const starredPosts = ws.starred.slice(0, 20).map(i => posts[i]?.text).filter(Boolean);
    if (starredPosts.length < 3) return;
    const res = await fetch('/api/hints', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ posts: starredPosts, brief: { question: brief?.question, brand: brief?.brand } }) });
    const data = await res.json();
    setHints(data.hints || []);
  };

  const generateFromBuckets = async () => {
    if (ws.buckets.length === 0) return;
    setGenerating(true);
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ status: 'collected', workspace_state: ws })
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 55000);
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefId: id, buckets: ws.buckets }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (data.success) window.location.href = `/results/${id}`;
      else { setGenerating(false); alert('Generation failed: ' + (data.error || 'unknown')); }
    } catch (e: any) {
      setGenerating(false);
      if (e.name === 'AbortError') alert('Timed out — try with fewer buckets');
      else alert('Something went wrong: ' + e.message);
    }
  };

  // Posts visible in reading stage — from selected clusters
  const readingPosts = stage === 'reading' ? (() => {
    if (ws.selectedClusters.length === 0) return posts.map((p, i) => ({ ...p, _idx: i }));
    const clusterPostSets = ws.selectedClusters.map(name => clusters.find(c => c.name === name)?.posts || []);
    const allClusterPosts = clusterPostSets.flat();
    return posts.map((p, i) => ({ ...p, _idx: i })).filter(p =>
      allClusterPosts.some(cp => cp.text === p.text) && !ws.binned.includes(p._idx)
    );
  })() : [];

  const filteredReadingPosts = readingPosts.filter(p =>
    !search || p.text?.toLowerCase().includes(search.toLowerCase())
  );

  const driverScores = scoreDrivers(ws.starred.map(i => posts[i]).filter(Boolean));
  const getBucketColor = (idx: number) => { const bid = ws.postBuckets[idx]; return bid ? ws.buckets.find(b => b.id === bid)?.color : null; };

  const COLUMNS = [
    { key: 'youtube', label: 'YouTube', color: '#fca5a5', bg: 'rgba(220,38,38,0.06)' },
    { key: 'bluesky', label: 'Bluesky', color: '#93c5fd', bg: 'rgba(59,130,246,0.06)' },
    { key: 'web', label: 'Web & forums', color: '#c8b89a', bg: 'rgba(200,184,154,0.04)' },
    { key: 'news', label: 'News', color: 'rgba(255,255,255,0.3)', bg: 'rgba(255,255,255,0.02)' },
  ];
  const getCol = (p: any) => p.type === 'youtube' ? 'youtube' : p.type === 'bluesky' || p.type === 'mastodon' ? 'bluesky' : (p.type === 'newsdata' || p.type === 'hn') ? 'news' : 'web';

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0e0d0b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.08)', borderTop: '2px solid #c8b89a', animation: 'spin 1s linear infinite' }} />
    </div>
  );

  return (
    <div style={{ height: '100vh', background: '#0e0d0b', display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans', sans-serif", color: '#f5f3ee', overflow: 'hidden' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&family=DM+Mono&display=swap');@keyframes spin{to{transform:rotate(360deg)}}*{box-sizing:border-box}::-webkit-scrollbar{width:3px;height:3px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:2px}`}</style>

      {/* TOPBAR */}
      <div style={{ height: 52, borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 16, padding: '0 20px', flexShrink: 0 }}>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: 13 }}>now<span style={{ color: '#c8b89a' }}>—</span>again</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>"{brief?.question}"</div>
        <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 2 }}>
          {[['overview','1. Theme overview'],['reading','2. Reading view']].map(([val, label]) => (
            <button key={val} onClick={() => setStage(val as any)}
              style={{ padding: '5px 14px', borderRadius: 6, border: 'none', background: stage === val ? 'rgba(255,255,255,0.1)' : 'transparent', color: stage === val ? '#f5f3ee' : 'rgba(255,255,255,0.35)', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', fontWeight: stage === val ? 500 : 400, whiteSpace: 'nowrap' }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}><span style={{ color: '#f5f3ee' }}>{posts.length}</span> posts · <span style={{ color: '#c8b89a' }}>{ws.starred.length}</span> starred · <span style={{ color: '#f5f3ee' }}>{ws.buckets.length}</span> buckets</div>
        <button onClick={generateFromBuckets} disabled={ws.buckets.length === 0 || generating}
          style={{ background: '#f5f3ee', color: '#0e0d0b', border: 'none', padding: '7px 16px', borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: ws.buckets.length > 0 ? 'pointer' : 'not-allowed', opacity: ws.buckets.length === 0 ? 0.4 : 1, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          {generating ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', border: '1.5px solid rgba(0,0,0,0.2)', borderTop: '1.5px solid #0e0d0b', animation: 'spin 0.8s linear infinite', flexShrink: 0, display: 'inline-block' }} />
              Generating themes...
            </span>
          ) : `Generate insights →`}
        </button>
      </div>

      {/* ═══ STAGE 1: THEME OVERVIEW ═══ */}
      {stage === 'overview' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          <div style={{ maxWidth: 1000, margin: '0 auto' }}>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
              <div>
                <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 400, marginBottom: 4 }}>
                  Theme <em style={{ color: '#c8b89a', fontStyle: 'italic' }}>overview</em>
                </h1>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', lineHeight: 1.6 }}>
                  {clusters.length > 0
                    ? `${clusters.length} themes found. Select the ones you want to explore in the reading view.`
                    : 'Generate semantic clusters from your collected posts. AI will group similar conversations into named themes.'}
                </p>
              </div>
              <button onClick={runClustering} disabled={clustering}
                style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: '#f5f3ee', padding: '8px 20px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {clustering ? 'Clustering...' : clusters.length > 0 ? '↺ Re-cluster' : '✦ Generate themes'}
              </button>
            </div>

            {clustering && (
              <div style={{ textAlign: 'center', padding: '48px 0', color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.08)', borderTop: '2px solid #c8b89a', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
                Claude is reading {posts.length} posts and finding patterns...
              </div>
            )}

            {clusters.length > 0 && !clustering && (
              <>
                {/* DATA OVERVIEW PANEL */}
                {(() => {
                  const sourceBreakdown = posts.reduce((acc: Record<string,number>, p: any) => {
                    const src = p.type === 'youtube' ? 'YouTube' : p.type === 'bluesky' ? 'Bluesky' : p.type === 'newsdata' || p.type === 'hn' ? 'News' : p.type === 'wikipedia' ? 'Wikipedia' : p.type === 'autocomplete' ? 'Search intent' : 'Web';
                    acc[src] = (acc[src] || 0) + 1;
                    return acc;
                  }, {});
                  const marketBreakdown = [...new Set(posts.map((p: any) => p.country).filter((c: string) => c && c !== 'Global' && c !== 'unknown'))];
                  const dates = posts.map((p: any) => p.timestamp ? new Date(p.timestamp).getTime() : 0).filter(Boolean);
                  const oldest = dates.length > 0 ? new Date(Math.min(...dates)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—';
                  const newest = dates.length > 0 ? new Date(Math.max(...dates)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—';
                  const maxSrc = Math.max(...Object.values(sourceBreakdown) as number[], 1);
                  return (
                    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '16px 18px', marginBottom: 20 }}>
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace', textTransform: 'uppercase' as const, letterSpacing: '.08em', marginBottom: 12 }}>Data overview</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                        <div>
                          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace', marginBottom: 8 }}>SOURCE BREAKDOWN</div>
                          {Object.entries(sourceBreakdown).sort((a,b) => (b[1] as number)-(a[1] as number)).map(([src, count]) => (
                            <div key={src} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', width: 72, flexShrink: 0 }}>{src}</div>
                              <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 2 }}>
                                <div style={{ height: '100%', width: `${Math.round(((count as number)/maxSrc)*100)}%`, background: '#c8b89a', borderRadius: 2, opacity: 0.6 }} />
                              </div>
                              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', width: 28, textAlign: 'right' }}>{count as number}</div>
                            </div>
                          ))}
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace', marginBottom: 8 }}>MARKETS</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {marketBreakdown.slice(0, 8).map((m: string) => (
                              <span key={m} style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(200,184,154,0.1)', color: '#c8b89a', fontFamily: 'monospace' }}>{m}</span>
                            ))}
                          </div>
                          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginTop: 8 }}>{marketBreakdown.length} markets · {posts.length} posts</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace', marginBottom: 8 }}>DATE RANGE</div>
                          <div style={{ fontSize: 20, fontFamily: 'Georgia, serif', color: 'rgba(255,255,255,0.5)', lineHeight: 1, marginBottom: 4 }}>{posts.length.toLocaleString()}</div>
                          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>conversations collected</div>
                          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginTop: 6, fontFamily: 'monospace' }}>{oldest} → {newest}</div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>
                    {ws.selectedClusters.length} of {clusters.length} selected
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>Sort by</span>
                    {([['opportunity','✦ opportunity'],['temperature','↑ recent'],['size','# size']] as const).map(([s, label]) => (
                      <button key={s} onClick={() => setClusterSort(s as any)}
                        style={{ padding: '2px 8px', borderRadius: 20, border: `1px solid ${clusterSort === s ? 'rgba(200,184,154,0.4)' : 'rgba(255,255,255,0.07)'}`, background: clusterSort === s ? 'rgba(200,184,154,0.1)' : 'transparent', color: clusterSort === s ? '#c8b89a' : 'rgba(255,255,255,0.25)', fontSize: 9, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {ws.selectedClusters.length > 0 && (
                    <button onClick={() => { updateWs({ selectedClusters: [] }); }}
                      style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                      clear all
                    </button>
                  )}
                  <button onClick={() => updateWs({ selectedClusters: clusters.map(c => c.name) })}
                    style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                    select all
                  </button>
                  <button onClick={() => setStage('reading')} disabled={ws.selectedClusters.length === 0}
                    style={{ marginLeft: 'auto', background: 'rgba(200,184,154,0.1)', border: '1px solid rgba(200,184,154,0.2)', color: '#c8b89a', padding: '5px 14px', borderRadius: 6, fontSize: 10, cursor: ws.selectedClusters.length > 0 ? 'pointer' : 'not-allowed', opacity: ws.selectedClusters.length === 0 ? 0.4 : 1, fontFamily: 'inherit' }}>
                    Explore {ws.selectedClusters.length} theme{ws.selectedClusters.length !== 1 ? 's' : ''} →
                  </button>
                </div>

                {/* DATASET INSIGHTS PANEL — collapsible */}
                {(() => {
                  const allMetrics = clusters.map(c => calcMetrics(c.posts, brief));
                  const avg = (key: string) => Math.round(allMetrics.reduce((s, m) => s + (m as any)[key], 0) / Math.max(1, allMetrics.length));
                  const avgOnBrief = avg('brandRelevance');
                  const mostRelevant = [...clusters].sort((a,b) => calcMetrics(b.posts,brief).brandRelevance - calcMetrics(a.posts,brief).brandRelevance)[0];

                  // Market breakdown — posts per market
                  const marketCounts: Record<string,number> = {};
                  posts.forEach((p: any) => {
                    const m = p.country;
                    if (m && m !== 'Global' && m !== 'unknown') marketCounts[m] = (marketCounts[m] || 0) + 1;
                  });
                  const topMarkets = Object.entries(marketCounts).sort((a,b) => b[1]-a[1]).slice(0, 8);
                  const maxMkt = topMarkets[0]?.[1] || 1;

                  // Tension — find clusters with highest opposing sentiment
                  const tenseClusters = [...clusters]
                    .sort((a,b) => calcMetrics(b.posts,brief).tension - calcMetrics(a.posts,brief).tension)
                    .slice(0, 3);

                  return (
                    <div style={{ background: 'rgba(200,184,154,0.04)', border: '1px solid rgba(200,184,154,0.12)', borderRadius: 10, marginBottom: 20, overflow: 'hidden' }}>
                      {/* Header — always visible */}
                      <button onClick={() => setInsightsPanelOpen(o => !o)}
                        style={{ width: '100%', background: 'none', border: 'none', padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
                        <span style={{ fontSize: 9, color: '#c8b89a', fontFamily: 'monospace', textTransform: 'uppercase' as const, letterSpacing: '.08em' }}>Dataset quick insights</span>
                        {/* Teaser pills — visible when collapsed */}
                        {!insightsPanelOpen && (
                          <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
                            <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 20, background: 'rgba(237,147,177,0.12)', color: '#ED93B1' }}>🎯 {avgOnBrief}% on-brief</span>
                            {topMarkets[0] && <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 20, background: 'rgba(133,183,235,0.12)', color: '#85B7EB' }}>🌐 {topMarkets[0][0]}: {topMarkets[0][1]}</span>}
                            {tenseClusters[0] && <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 20, background: 'rgba(175,169,236,0.12)', color: '#AFA9EC' }}>⚡ {tenseClusters[0].name}</span>}
                          </div>
                        )}
                        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>{insightsPanelOpen ? '▲' : '▼'}</span>
                      </button>

                      {/* Expanded content */}
                      {insightsPanelOpen && (
                        <div style={{ padding: '4px 16px 16px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>

                          {/* ON-BRIEF */}
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 500, color: '#ED93B1', marginBottom: 6 }}>🎯 On-brief relevance</div>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
                              <span style={{ fontSize: 26, fontFamily: 'Georgia, serif', color: '#ED93B1', lineHeight: 1 }}>{avgOnBrief}</span>
                              <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>/ 100 avg across clusters</span>
                            </div>
                            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', lineHeight: 1.5, marginBottom: 8 }}>How often brand and category terms appear. High = data is directly answering your question.</div>
                            {mostRelevant && (
                              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', background: 'rgba(237,147,177,0.06)', border: '1px solid rgba(237,147,177,0.12)', borderRadius: 6, padding: '5px 8px' }}>
                                Most relevant cluster: <span style={{ color: '#ED93B1' }}>{mostRelevant.name}</span>
                              </div>
                            )}
                          </div>

                          {/* MARKET BREAKDOWN */}
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 500, color: '#85B7EB', marginBottom: 6 }}>🌐 Conversations by market</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {topMarkets.map(([market, count]) => (
                                <div key={market} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', width: 60, flexShrink: 0, fontFamily: 'monospace' }}>{market}</span>
                                  <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 2 }}>
                                    <div style={{ height: '100%', width: `${Math.round((count/maxMkt)*100)}%`, background: '#85B7EB', borderRadius: 2, opacity: 0.6 }} />
                                  </div>
                                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', width: 28, textAlign: 'right' }}>{count}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* TENSIONS */}
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 500, color: '#AFA9EC', marginBottom: 6 }}>⚡ Most contested spaces</div>
                            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', lineHeight: 1.5, marginBottom: 8 }}>Clusters where consumers express both strongly positive and negative views — unresolved cultural spaces with the most brand opportunity.</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                              {tenseClusters.map((c, ci) => {
                                const tm = calcMetrics(c.posts, brief);
                                return (
                                  <div key={ci} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <div style={{ flex: 1, fontSize: 9, color: 'rgba(255,255,255,0.5)' }}>{c.name}</div>
                                    <div style={{ width: 40, height: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 2, flexShrink: 0 }}>
                                      <div style={{ height: '100%', width: `${tm.tension}%`, background: '#AFA9EC', borderRadius: 2, opacity: 0.7 }} />
                                    </div>
                                    <span style={{ fontSize: 8, color: '#AFA9EC', fontFamily: 'monospace', width: 16 }}>{tm.tension}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                        </div>
                      )}
                    </div>
                  );
                })()}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 10 }}>
                  {[...clusters].sort((a, b) => {
                    const ma = calcMetrics(a.posts);
                    const mb = calcMetrics(b.posts);
                    if (clusterSort === 'energy') return mb.energy - ma.energy;
                    if (clusterSort === 'temperature') return mb.temperature - ma.temperature;
                    if (clusterSort === 'opportunity') return mb.opportunity - ma.opportunity;
                    return b.count - a.count;
                  }).map((cluster, ci) => {
                    const selected = ws.selectedClusters.includes(cluster.name);
                    const maxCount = clusters[0]?.count || 1;
                    const pct = Math.round((cluster.count / maxCount) * 100);
                    return (
                      <div key={ci} onClick={() => toggleCluster(cluster.name)}
                        style={{ background: selected ? 'rgba(200,184,154,0.07)' : 'rgba(255,255,255,0.02)', border: `1px solid ${selected ? 'rgba(200,184,154,0.4)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 10, padding: '14px 16px', cursor: 'pointer', transition: 'all 0.12s' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 500, color: selected ? '#f5f3ee' : 'rgba(255,255,255,0.75)', marginBottom: 4 }}>{cluster.name}</div>
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5 }}>{cluster.description}</div>
                          </div>
                          <div style={{ flexShrink: 0, textAlign: 'right' }}>
                            <div style={{ fontSize: 18, fontFamily: 'Georgia, serif', color: selected ? '#c8b89a' : 'rgba(255,255,255,0.3)', lineHeight: 1 }}>{cluster.count}</div>
                            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>posts</div>
                          </div>
                        </div>
                        {/* Size bar */}
                        <div style={{ height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 1, marginBottom: 10 }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: selected ? '#c8b89a' : 'rgba(255,255,255,0.15)', borderRadius: 1, transition: 'width 0.3s ease' }} />
                        </div>
                        {/* Metrics */}
                        {(() => {
                          const m = calcMetrics(cluster.posts, brief);
                          return (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                              {[
                                { label: 'opportunity', value: m.opportunity, color: '#c8b89a' },
                                { label: '↑ recent', value: m.temperature, color: '#F0997B' },
                                { label: 'consumer', value: m.consumerRatio, color: '#5DCAA5' },
                              ].map(metric => (
                                <div key={metric.label}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                                    <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace' }}>{metric.label}</span>
                                    <span style={{ fontSize: 8, color: metric.color, fontFamily: 'monospace' }}>{metric.value}</span>
                                  </div>
                                  <div style={{ height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 1 }}>
                                    <div style={{ height: '100%', width: `${metric.value}%`, background: metric.color, borderRadius: 1, opacity: 0.8, transition: 'width 0.4s ease' }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                        {/* Trend sparkline */}
                        {(() => {
                          const t = trends[cluster.name];
                          if (!t || t.values.length === 0) return trendsLoading ? (
                            <div style={{ height: 24, display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                              <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.15)', fontFamily: 'monospace' }}>fetching trend data...</span>
                            </div>
                          ) : null;
                          const max = Math.max(...t.values, 1);
                          const w = 100 / t.values.length;
                          const isRising = t.velocity > 5;
                          const isFalling = t.velocity < -5;
                          const velColor = isRising ? '#5DCAA5' : isFalling ? '#F0997B' : 'rgba(255,255,255,0.3)';
                          const velLabel = isRising ? `+${t.velocity}%` : isFalling ? `${t.velocity}%` : 'stable';
                          return (
                            <div style={{ marginBottom: 10 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>google trends · 12 weeks</span>
                                <span style={{ fontSize: 9, color: velColor, fontFamily: 'monospace', fontWeight: 500 }}>{velLabel} {isRising ? '↑' : isFalling ? '↓' : '→'}</span>
                              </div>
                              <svg width="100%" height="28" viewBox={`0 0 ${t.values.length * 8} 28`} preserveAspectRatio="none" style={{ display: 'block' }}>
                                <polyline
                                  points={t.values.map((v, i) => `${i * 8 + 4},${28 - Math.round((v / max) * 24)}`).join(' ')}
                                  fill="none"
                                  stroke={velColor}
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  opacity="0.7"
                                />
                                {t.values.map((v, i) => (
                                  <circle key={i} cx={i * 8 + 4} cy={28 - Math.round((v / max) * 24)} r="1.5" fill={velColor} opacity="0.5" />
                                ))}
                              </svg>
                            </div>
                          );
                        })()}

                        {/* Example quotes */}
                        {cluster.posts?.slice(0, 2).map((p: any, pi: number) => (
                          <div key={pi} style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic', lineHeight: 1.5, marginBottom: 3, paddingLeft: 6, borderLeft: `2px solid ${selected ? 'rgba(200,184,154,0.3)' : 'rgba(255,255,255,0.06)'}` }}>
                            "{p.text?.slice(0, 80)}..."
                          </div>
                        ))}
                        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 14, height: 14, borderRadius: '50%', border: `1.5px solid ${selected ? '#c8b89a' : 'rgba(255,255,255,0.15)'}`, background: selected ? '#c8b89a' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {selected && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#0e0d0b' }} />}
                          </div>
                          <span style={{ fontSize: 9, color: selected ? '#c8b89a' : 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>{selected ? 'selected for reading' : 'click to select'}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {clusters.length === 0 && !clustering && (
              <div style={{ textAlign: 'center', padding: '64px 0', color: 'rgba(255,255,255,0.2)' }}>
                <div style={{ fontSize: 32, marginBottom: 16, opacity: 0.3 }}>✦</div>
                <div style={{ fontSize: 12 }}>Click "Generate themes" to start</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ STAGE 2: READING VIEW ═══ */}
      {stage === 'reading' && (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '160px 1fr 232px', overflow: 'hidden' }}>

          {/* Left sidebar */}
          <div style={{ borderRight: '1px solid rgba(255,255,255,0.06)', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
            <div>
              <div style={S.slabel}>Search</div>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="keyword..." style={S.input} />
            </div>
            <div>
              <div style={S.slabel}>Active themes ({ws.selectedClusters.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                {ws.selectedClusters.map(name => (
                  <div key={name} style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', padding: '3px 6px', background: 'rgba(200,184,154,0.06)', borderRadius: 4, borderLeft: '2px solid rgba(200,184,154,0.3)', lineHeight: 1.4 }}>
                    {name}
                  </div>
                ))}
                <button onClick={() => setStage('overview')} style={{ marginTop: 4, background: 'none', border: '1px dashed rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.2)', borderRadius: 4, padding: '4px', fontSize: 9, cursor: 'pointer', fontFamily: 'inherit' }}>
                  ← Change themes
                </button>
              </div>
            </div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.15)', fontFamily: 'monospace', marginTop: 'auto' }}>
              {filteredReadingPosts.length} posts shown
            </div>
          </div>

          {/* Column canvas */}
          <div style={{ display: 'flex', overflowX: 'auto', overflowY: 'hidden' }}>
            {COLUMNS.map(col => {
              const colPosts = filteredReadingPosts.filter(p => getCol(p) === col.key);
              return (
                <div key={col.key} style={{ width: 220, minWidth: 220, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.04)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)', background: col.bg, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, fontWeight: 500, color: col.color }}>{col.label}</span>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace', marginLeft: 'auto' }}>{colPosts.length}</span>
                  </div>
                  <div style={{ overflowY: 'auto', flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {colPosts.map(post => {
                      const i = post._idx;
                      const starred = ws.starred.includes(i);
                      const bucketColor = getBucketColor(i);
                      const isSelected = selectedCard === i;
                      return (
                        <div key={i}
                          style={{ borderRadius: 7, padding: '9px 10px', background: isSelected ? 'rgba(200,184,154,0.1)' : starred ? 'rgba(200,184,154,0.04)' : 'rgba(255,255,255,0.02)', border: `1px solid ${isSelected ? 'rgba(200,184,154,0.5)' : starred ? 'rgba(200,184,154,0.25)' : 'rgba(255,255,255,0.05)'}`, borderLeft: bucketColor ? `3px solid ${bucketColor}` : undefined, transition: 'all 0.1s' }}>
                          {/* Header */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                            <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'rgba(255,255,255,0.2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>
                              {post.source?.replace('www.','').slice(0,14)}
                            </span>
                            <div style={{ display: 'flex', gap: 3 }}>
                              <button onClick={e => { e.stopPropagation(); toggleStar(i); }}
                                style={{ width: 16, height: 16, borderRadius: '50%', border: 'none', background: starred ? 'rgba(200,184,154,0.2)' : 'rgba(255,255,255,0.04)', color: starred ? '#c8b89a' : 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: 8, flexShrink: 0 }}>
                                {starred ? '★' : '☆'}
                              </button>
                              <button onClick={e => { e.stopPropagation(); toggleBin(i); }}
                                style={{ width: 16, height: 16, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.15)', cursor: 'pointer', fontSize: 8, flexShrink: 0 }}>
                                ✕
                              </button>
                            </div>
                          </div>
                          {/* Text */}
                          <div style={{ fontSize: 10, color: isSelected ? '#f5f3ee' : 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
                            {post.text?.slice(0, 130)}{post.text?.length > 130 ? '...' : ''}
                          </div>
                          {/* Country */}
                          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.12)', marginTop: 5, fontFamily: 'monospace' }}>{post.country}</div>
                          {/* Bucket label if assigned */}
                          {bucketColor && (
                            <div style={{ marginTop: 3, fontSize: 8, color: bucketColor, fontFamily: 'monospace' }}>
                              {ws.buckets.find(b => b.id === ws.postBuckets[i])?.name}
                            </div>
                          )}
                          {/* Bucket assignment — click card body to select, buckets appear */}
                          <div style={{ marginTop: 6 }}>
                            {ws.buckets.length > 0 ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                {ws.buckets.map(b => (
                                  <button key={b.id} onClick={e => { e.stopPropagation(); assignToBucket(i, b.id); }}
                                    style={{ padding: '2px 7px', borderRadius: 20, border: `1px solid ${ws.postBuckets[i] === b.id ? b.color : 'rgba(255,255,255,0.07)'}`, background: ws.postBuckets[i] === b.id ? `${b.color}22` : 'transparent', color: ws.postBuckets[i] === b.id ? b.color : 'rgba(255,255,255,0.2)', fontSize: 8, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 3 }}>
                                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: b.color, flexShrink: 0 }} />
                                    {b.name.slice(0, 12)}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.1)' }}>Create buckets in the panel →</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {colPosts.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '20px 0', fontSize: 9, color: 'rgba(255,255,255,0.1)' }}>No posts</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right panel */}
          <div style={{ borderLeft: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
              {[['buckets','Buckets'],['spider','Spidergram'],['hints','AI hints']].map(([val, label]) => (
                <button key={val} onClick={() => { setActiveTab(val as any); if (val === 'hints') generateHints(); }}
                  style={{ flex: 1, padding: '10px 4px', background: 'none', border: 'none', borderBottom: `2px solid ${activeTab === val ? '#c8b89a' : 'transparent'}`, color: activeTab === val ? '#f5f3ee' : 'rgba(255,255,255,0.25)', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', fontWeight: activeTab === val ? 500 : 400 }}>
                  {label}
                </button>
              ))}
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>

              {activeTab === 'buckets' && (
                <>
                  {ws.buckets.map(bucket => (
                    <div key={bucket.id} style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, overflow: 'hidden' }}>
                      <div style={{ padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.02)' }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: bucket.color, flexShrink: 0 }} />
                        {editingBucket === bucket.id ? (
                          <input autoFocus defaultValue={bucket.name}
                            onBlur={e => { updateWs({ buckets: ws.buckets.map(b => b.id === bucket.id ? { ...b, name: e.target.value } : b) }); setEditingBucket(null); }}
                            style={{ background: 'transparent', border: 'none', color: '#f5f3ee', fontSize: 11, flex: 1, outline: 'none', fontFamily: 'inherit' }} />
                        ) : (
                          <span onClick={() => setEditingBucket(bucket.id)} style={{ fontSize: 11, fontWeight: 500, flex: 1, cursor: 'text' }}>{bucket.name}</span>
                        )}
                        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace' }}>{bucket.postIndices.length}</span>
                        <button onClick={() => updateWs({ buckets: ws.buckets.filter(b => b.id !== bucket.id), postBuckets: Object.fromEntries(Object.entries(ws.postBuckets).filter(([,v]) => v !== bucket.id)) })}
                          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.15)', cursor: 'pointer', fontSize: 9 }}>✕</button>
                      </div>
                      {bucket.postIndices.slice(0, 2).map(pi => (
                        <div key={pi} style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', padding: '3px 10px', borderTop: '1px solid rgba(255,255,255,0.03)', lineHeight: 1.4 }}>
                          {posts[pi]?.text?.slice(0, 60)}...
                        </div>
                      ))}
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 5 }}>
                    <input value={newBucketName} onChange={e => setNewBucketName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addBucket()} placeholder="New bucket..." style={{ ...S.input, flex: 1 }} />
                    <button onClick={addBucket} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#f5f3ee', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>+</button>
                  </div>
                  {ws.buckets.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '16px 0', color: 'rgba(255,255,255,0.15)', fontSize: 10, lineHeight: 1.7 }}>
                      Create buckets to group posts.<br />Each bucket becomes a theme.
                    </div>
                  )}
                </>
              )}

              {activeTab === 'spider' && (
                <>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginBottom: 4 }}>Based on {ws.starred.length} starred posts</div>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <svg width="160" height="160" viewBox="0 0 160 160">
                      {[18,36,54,72].map(r => <circle key={r} cx="80" cy="80" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />)}
                      {DRIVERS.slice(0,8).map((_,i) => { const a=(i/8)*Math.PI*2-Math.PI/2; return <line key={i} x1="80" y1="80" x2={80+Math.cos(a)*72} y2={80+Math.sin(a)*72} stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />; })}
                      <polygon points={DRIVERS.slice(0,8).map((d,i)=>{ const a=(i/8)*Math.PI*2-Math.PI/2; const r=(driverScores[d]/100)*72; return `${80+Math.cos(a)*r},${80+Math.sin(a)*r}`; }).join(' ')} fill="rgba(200,184,154,0.12)" stroke="#c8b89a" strokeWidth="1" />
                      {DRIVERS.slice(0,8).map((d,i)=>{ const a=(i/8)*Math.PI*2-Math.PI/2; return <text key={d} x={80+Math.cos(a)*86} y={80+Math.sin(a)*86} textAnchor="middle" dominantBaseline="central" style={{fontSize:6,fill:'rgba(255,255,255,0.3)',fontFamily:'monospace'}}>{d.slice(0,5)}</text>; })}
                    </svg>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {DRIVERS.sort((a,b)=>(driverScores[b]||0)-(driverScores[a]||0)).map(d => (
                      <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace', width: 64, flexShrink: 0 }}>{d}</span>
                        <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 1 }}>
                          <div style={{ height: '100%', borderRadius: 1, background: '#c8b89a', width: `${driverScores[d]||0}%`, transition: 'width 0.4s' }} />
                        </div>
                        <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace', width: 20, textAlign: 'right' }}>{driverScores[d]||0}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {activeTab === 'hints' && (
                <>
                  {hints.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '16px 0', color: 'rgba(255,255,255,0.15)', fontSize: 10, lineHeight: 1.7 }}>
                      {ws.starred.length < 3 ? 'Star 3+ posts to get AI hints' : 'Loading hints...'}
                    </div>
                  ) : hints.map((hint, i) => (
                    <div key={i} style={{ background: 'rgba(200,184,154,0.04)', border: '1px solid rgba(200,184,154,0.12)', borderRadius: 7, padding: '9px 10px' }}>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>{hint}</div>
                      <div style={{ display: 'flex', gap: 5, marginTop: 6 }}>
                        <button onClick={() => { setNewBucketName(hint.split(' ').slice(0,3).join(' ')); setActiveTab('buckets'); }}
                          style={{ fontSize: 8, padding: '2px 7px', borderRadius: 4, cursor: 'pointer', background: 'rgba(200,184,154,0.1)', color: '#c8b89a', border: 'none', fontFamily: 'inherit' }}>Create bucket</button>
                        <button onClick={() => setHints(hints.filter((_,j)=>j!==i))}
                          style={{ fontSize: 8, padding: '2px 7px', borderRadius: 4, cursor: 'pointer', background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.2)', border: 'none', fontFamily: 'inherit' }}>Dismiss</button>
                      </div>
                    </div>
                  ))}
                  {ws.starred.length >= 3 && (
                    <button onClick={generateHints} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.3)', borderRadius: 6, padding: '7px', fontSize: 9, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Refresh hints
                    </button>
                  )}
                </>
              )}
            </div>

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '10px 12px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.15)', fontFamily: 'monospace', textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Generate from</div>
              <button onClick={async () => {
                if (ws.starred.length === 0) return;
                setGenerating(true);
                try {
                  await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }, body: JSON.stringify({ status: 'collected', workspace_state: ws }) });
                  const controller = new AbortController();
                  const timeout = setTimeout(() => controller.abort(), 55000);
                  const res = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ briefId: id }), signal: controller.signal });
                  clearTimeout(timeout);
                  const data = await res.json();
                  if (data.success) window.location.href = `/results/${id}`;
                  else { setGenerating(false); alert('Generation failed: ' + (data.error || 'unknown')); }
                } catch (e: any) {
                  setGenerating(false);
                  if (e.name === 'AbortError') alert('Generation timed out — try with fewer posts');
                  else alert('Something went wrong: ' + e.message);
                }
              }} disabled={ws.starred.length === 0 || generating}
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: ws.starred.length > 0 ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.15)', borderRadius: 6, padding: '7px', fontSize: 9, cursor: ws.starred.length > 0 ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                {generating ? '...' : `★ ${ws.starred.length} starred posts`}
              </button>
              <button onClick={generateFromBuckets} disabled={ws.buckets.length === 0 || generating}
                style={{ background: '#f5f3ee', color: '#0e0d0b', border: 'none', borderRadius: 6, padding: '7px', fontSize: 9, fontWeight: 500, cursor: ws.buckets.length > 0 ? 'pointer' : 'not-allowed', opacity: ws.buckets.length === 0 ? 0.4 : 1, fontFamily: 'inherit' }}>
                {generating ? 'Generating...' : `${ws.buckets.length} bucket${ws.buckets.length !== 1 ? 's' : ''} → themes →`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  slabel: { fontSize: 9, color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', letterSpacing: '.1em', fontFamily: 'monospace', marginBottom: 4 },
  input: { width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6, padding: '6px 10px', fontSize: 10, color: 'rgba(255,255,255,0.5)', outline: 'none', fontFamily: 'inherit' },
};
