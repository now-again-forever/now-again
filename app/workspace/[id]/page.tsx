'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const DRIVERS = ['Creativity','Experiences','Emotion','Engagement','Relationships','Responsibility','Wellbeing','Simplicity','Resilience','Control','Enhancement','Power','Achievement','Exploration','Individuality','Extremes'];

const DRIVER_KEYWORDS: Record<string, string[]> = {
  Creativity: ['creative','innovative','unique','original','art','design','craft','made','handmade','artisan'],
  Experiences: ['experience','moment','memory','tried','visited','tasted','felt','discovered','adventure'],
  Emotion: ['love','hate','feel','feeling','emotional','passionate','heart','soul','touched','moved','excited'],
  Engagement: ['community','together','social','share','connect','engage','join','participate','belong'],
  Relationships: ['family','friend','grandmother','grandfather','mother','father','kids','children','together','we','our'],
  Responsibility: ['sustainable','ethical','local','support','community','environment','organic','fair','responsible'],
  Wellbeing: ['healthy','health','wellness','natural','fresh','clean','good for','better','nutrition'],
  Simplicity: ['simple','traditional','classic','basic','pure','clean','honest','straightforward','natural'],
  Resilience: ['despite','boycott','resist','stand','fight','refuse','against','independent','strong'],
  Control: ['choose','choice','decide','prefer','want','need','control','my decision','i pick'],
  Enhancement: ['better','premium','quality','superior','best','excellent','upgrade','improved','enhance'],
  Power: ['power','influence','impact','change','force','strong','dominant','lead','authority'],
  Achievement: ['proud','achievement','success','accomplished','earned','worked','deserve','result'],
  Exploration: ['discover','explore','new','try','experiment','adventure','curious','different','exotic'],
  Individuality: ['i','my','myself','personal','unique','individual','own','specific','particular'],
  Extremes: ['obsessed','addicted','cant stop','always','never','absolutely','completely','totally','extreme'],
};

function scoreDrivers(posts: any[]): Record<string, number> {
  const scores: Record<string, number> = {};
  DRIVERS.forEach(d => scores[d] = 0);
  for (const post of posts) {
    const text = (post.text || '').toLowerCase();
    for (const [driver, keywords] of Object.entries(DRIVER_KEYWORDS)) {
      const matches = keywords.filter(kw => text.includes(kw)).length;
      scores[driver] = (scores[driver] || 0) + matches;
    }
  }
  const max = Math.max(...Object.values(scores), 1);
  const normalized: Record<string, number> = {};
  DRIVERS.forEach(d => normalized[d] = Math.round((scores[d] / max) * 100));
  return normalized;
}

const BUCKET_COLORS = ['#5DCAA5','#AFA9EC','#F0997B','#85B7EB','#FAC775','#ED93B1','#97C459','#5F5E5A'];

interface Post {
  text: string;
  source: string;
  url: string;
  country: string;
  type: string;
  timestamp: string;
  query_label?: string;
}

interface Bucket {
  id: string;
  name: string;
  color: string;
  postIndices: number[];
}

interface WorkspaceState {
  starred: number[];
  binned: number[];
  buckets: Bucket[];
  postBuckets: Record<number, string>;
}

export default function WorkspacePage() {
  const params = useParams();
  const id = params.id as string;
  const [brief, setBrief] = useState<any>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [ws, setWs] = useState<WorkspaceState>({ starred: [], binned: [], buckets: [], postBuckets: {} });
  const [activeTab, setActiveTab] = useState<'buckets' | 'spider' | 'hints'>('buckets');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [showFilter, setShowFilter] = useState('all');
  const [marketFilter, setMarketFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('score');
  const [editingBucket, setEditingBucket] = useState<string | null>(null);
  const [newBucketName, setNewBucketName] = useState('');
  const [hints, setHints] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [selectedForBucket, setSelectedForBucket] = useState<number | null>(null);
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
      if (b.workspace_state) setWs(b.workspace_state);
      setLoading(false);
    };
    load();
  }, [id]);

  const updateWs = (update: Partial<WorkspaceState>) => {
    const newWs = { ...ws, ...update };
    setWs(newWs);
    saveWs(newWs);
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
    const bucket: Bucket = {
      id: Date.now().toString(),
      name: newBucketName.trim(),
      color: BUCKET_COLORS[ws.buckets.length % BUCKET_COLORS.length],
      postIndices: []
    };
    updateWs({ buckets: [...ws.buckets, bucket] });
    setNewBucketName('');
  };

  const assignToBucket = (postIdx: number, bucketId: string) => {
    const postBuckets = { ...ws.postBuckets };
    if (postBuckets[postIdx] === bucketId) {
      delete postBuckets[postIdx];
    } else {
      postBuckets[postIdx] = bucketId;
    }
    const buckets = ws.buckets.map(b => ({
      ...b,
      postIndices: Object.entries(postBuckets).filter(([, bid]) => bid === b.id).map(([pi]) => parseInt(pi))
    }));
    updateWs({ postBuckets, buckets });
    setSelectedForBucket(null);
  };

  const generateFromBuckets = async () => {
    if (ws.buckets.length === 0) return;
    setGenerating(true);
    await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ status: 'collected', workspace_state: ws })
    });
    const res = await fetch('/api/generate-from-workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ briefId: id, buckets: ws.buckets, posts, starred: ws.starred })
    });
    const data = await res.json();
    if (data.success) window.location.href = `/results/${id}`;
    else { setGenerating(false); alert('Generation failed — please try again'); }
  };

  const generateHints = async () => {
    const starredPosts = ws.starred.slice(0, 20).map(i => posts[i]?.text).filter(Boolean);
    if (starredPosts.length < 3) return;
    const res = await fetch('/api/hints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ posts: starredPosts, brief: { question: brief?.question, brand: brief?.brand } })
    });
    const data = await res.json();
    setHints(data.hints || []);
  };

  const scorePost = (p: Post): number => {
    const text = p.text || '';
    let s = 0;
    if (/\bI\b/.test(text)) s += 5;
    if (/\b(my|me|we|our)\b/i.test(text)) s += 2;
    if (/\b(love|hate|feel|believe|prefer|amazing|terrible|tried|bought)\b/i.test(text)) s += 2;
    if (p.type === 'youtube') s += 3;
    if (p.type === 'bluesky') s += 2;
    if (/buy now|subscribe|cookie|privacy/i.test(text)) s -= 4;
    return s;
  };

  const markets = [...new Set(posts.map(p => p.country).filter(Boolean))];
  const sources = [...new Set(posts.map(p => p.source).filter(Boolean))];

  const filteredPosts = posts
    .map((p, i) => ({ ...p, _idx: i, _score: scorePost(p) }))
    .filter(p => {
      if (ws.binned.includes(p._idx) && showFilter !== 'binned') return false;
      if (showFilter === 'starred' && !ws.starred.includes(p._idx)) return false;
      if (showFilter === 'unclustered' && ws.postBuckets[p._idx]) return false;
      if (showFilter === 'firstperson' && !/\bI\b|\bmy\b|\bme\b/i.test(p.text)) return false;
      if (sourceFilter !== 'all' && p.type !== sourceFilter && p.source !== sourceFilter) return false;
      if (marketFilter !== 'all' && p.country !== marketFilter) return false;
      if (search && !p.text.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'score') return b._score - a._score;
      if (sortBy === 'firstperson') {
        const af = /\bI\b/.test(a.text) ? 1 : 0;
        const bf = /\bI\b/.test(b.text) ? 1 : 0;
        return bf - af;
      }
      if (sortBy === 'recent') return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      return 0;
    });

  const driverScores = scoreDrivers(ws.starred.map(i => posts[i]).filter(Boolean));

  const getBucketColor = (idx: number) => {
    const bucketId = ws.postBuckets[idx];
    return bucketId ? ws.buckets.find(b => b.id === bucketId)?.color : null;
  };

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0e0d0b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.1)', borderTop: '2px solid #c8b89a', animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div style={{ height: '100vh', background: '#0e0d0b', display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans', sans-serif", color: '#f5f3ee', overflow: 'hidden' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&family=DM+Mono&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        * { box-sizing: border-box; }
      `}</style>

      {/* TOP BAR */}
      <div style={{ height: 52, borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 16, padding: '0 20px', flexShrink: 0 }}>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: 13 }}>now<span style={{ color: '#c8b89a' }}>—</span>again</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontStyle: 'italic', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          "{brief?.question}"
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
          <span style={{ color: '#f5f3ee' }}>{posts.length}</span> posts
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
          <span style={{ color: '#c8b89a' }}>{ws.starred.length}</span> starred
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
          <span style={{ color: '#f5f3ee' }}>{ws.buckets.length}</span> buckets
        </div>
        <button
          style={{ background: '#f5f3ee', color: '#0e0d0b', border: 'none', padding: '7px 16px', borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: ws.buckets.length === 0 ? 'not-allowed' : 'pointer', opacity: ws.buckets.length === 0 ? 0.4 : 1, whiteSpace: 'nowrap', fontFamily: 'inherit' }}
          onClick={generateFromBuckets}
          disabled={generating || ws.buckets.length === 0}>
          {generating ? 'Generating...' : `Generate from ${ws.buckets.length} bucket${ws.buckets.length !== 1 ? 's' : ''} →`}
        </button>
      </div>

      {/* MAIN LAYOUT */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '172px 1fr 240px', overflow: 'hidden' }}>

        {/* LEFT SIDEBAR */}
        <div style={{ borderRight: '1px solid rgba(255,255,255,0.06)', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>

          <div>
            <div style={s.slabel}>Search</div>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="keyword..." style={s.searchInput} />
          </div>

          <div>
            <div style={s.slabel}>Source type</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
              {['all', 'youtube', 'bluesky', 'web', 'newsdata'].map(src => (
                <span key={src} onClick={() => setSourceFilter(src)}
                  style={{ ...s.chip, ...(sourceFilter === src ? s.chipOn : s.chipOff) }}>
                  {src === 'all' ? 'All' : src === 'youtube' ? 'YouTube' : src === 'bluesky' ? 'Bluesky' : src === 'web' ? 'Web' : 'News'}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div style={s.slabel}>Show</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
              {[['all','All posts'],['starred','Starred only'],['unclustered','Unclustered'],['firstperson','First person']].map(([val, label]) => (
                <span key={val} onClick={() => setShowFilter(val)}
                  style={{ ...s.chip, ...(showFilter === val ? s.chipOn : s.chipOff), display: 'block', textAlign: 'center' }}>
                  {label}
                </span>
              ))}
            </div>
          </div>

          {markets.length > 1 && (
            <div>
              <div style={s.slabel}>Market</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 4 }}>
                <span onClick={() => setMarketFilter('all')} style={{ ...s.chip, ...(marketFilter === 'all' ? s.chipOn : s.chipOff) }}>All</span>
                {markets.slice(0, 6).map(m => (
                  <span key={m} onClick={() => setMarketFilter(m)} style={{ ...s.chip, ...(marketFilter === m ? s.chipOn : s.chipOff) }}>{m}</span>
                ))}
              </div>
            </div>
          )}

          <div>
            <div style={s.slabel}>Sort</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
              {[['score','Quality score'],['firstperson','First person'],['recent','Most recent']].map(([val, label]) => (
                <span key={val} onClick={() => setSortBy(val)}
                  style={{ ...s.chip, ...(sortBy === val ? s.chipOn : s.chipOff), display: 'block', textAlign: 'center' }}>
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 'auto', paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>
            {filteredPosts.length} of {posts.length} shown
          </div>
        </div>

        {/* POST CARDS CANVAS - organised in columns by source type */}
        <div style={{ overflowX: 'auto', overflowY: 'hidden', display: 'flex', gap: 0, flex: 1 }}>
          {(() => {
            const COLUMNS = [
              { key: 'youtube', label: 'YouTube', color: '#fca5a5', bg: 'rgba(220,38,38,0.08)' },
              { key: 'bluesky', label: 'Bluesky', color: '#93c5fd', bg: 'rgba(59,130,246,0.08)' },
              { key: 'web', label: 'Web & forums', color: '#c8b89a', bg: 'rgba(200,184,154,0.06)' },
              { key: 'news', label: 'News & editorial', color: 'rgba(255,255,255,0.3)', bg: 'rgba(255,255,255,0.02)' },
            ];
            const getColKey = (p: any) => {
              if (p.type === 'youtube') return 'youtube';
              if (p.type === 'bluesky' || p.type === 'mastodon') return 'bluesky';
              if (p.type === 'newsdata' || p.type === 'hn') return 'news';
              return 'web';
            };
            return COLUMNS.map(col => {
              const colPosts = filteredPosts.filter(p => getColKey(p) === col.key);
              return (
                <div key={col.key} style={{ width: 220, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  {/* Column header */}
                  <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)', background: col.bg, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, fontWeight: 500, color: col.color }}>{col.label}</span>
                    <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace', marginLeft: 'auto' }}>{colPosts.length}</span>
                  </div>
                  {/* Column posts - scrollable */}
                  <div style={{ overflowY: 'auto', flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {colPosts.map((post) => {
                      const i = post._idx;
                      const starred = ws.starred.includes(i);
                      const binned = ws.binned.includes(i);
                      const bucketColor = getBucketColor(i);
                      const isSelected = selectedForBucket === i;
                      return (
                        <div key={i}
                          onClick={() => setSelectedForBucket(isSelected ? null : i)}
                          style={{
                            borderRadius: 7,
                            padding: '9px 10px',
                            background: isSelected ? 'rgba(200,184,154,0.12)' : starred ? 'rgba(200,184,154,0.05)' : 'rgba(255,255,255,0.02)',
                            border: `1px solid ${isSelected ? 'rgba(200,184,154,0.6)' : starred ? 'rgba(200,184,154,0.35)' : 'rgba(255,255,255,0.05)'}`,
                            borderLeft: bucketColor ? `3px solid ${bucketColor}` : undefined,
                            opacity: binned ? 0.12 : 1,
                            cursor: 'pointer',
                            transition: 'all 0.12s',
                            position: 'relative',
                          }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                            <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'rgba(255,255,255,0.2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>
                              {post.source?.replace('www.', '').slice(0, 14)}
                            </span>
                            <div style={{ display: 'flex', gap: 3 }}>
                              <button onClick={e => { e.stopPropagation(); toggleStar(i); }}
                                style={{ width: 16, height: 16, borderRadius: '50%', border: 'none', background: 'rgba(200,184,154,0.1)', color: starred ? '#c8b89a' : 'rgba(200,184,154,0.25)', cursor: 'pointer', fontSize: 8, flexShrink: 0 }}>
                                {starred ? '★' : '☆'}
                              </button>
                              <button onClick={e => { e.stopPropagation(); toggleBin(i); }}
                                style={{ width: 16, height: 16, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.15)', cursor: 'pointer', fontSize: 8, flexShrink: 0 }}>
                                ✕
                              </button>
                            </div>
                          </div>
                          <div style={{ fontSize: 10, color: isSelected ? '#f5f3ee' : 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
                            {post.text.slice(0, 120)}{post.text.length > 120 ? '...' : ''}
                          </div>
                          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.12)', marginTop: 5, fontFamily: 'monospace' }}>
                            {post.country} · score:{post._score}
                          </div>
                          {bucketColor && (
                            <div style={{ marginTop: 4, fontSize: 8, color: bucketColor, fontFamily: 'monospace' }}>
                              {ws.buckets.find(b => b.id === ws.postBuckets[i])?.name}
                            </div>
                          )}

                          {/* Inline bucket picker when selected */}
                          {isSelected && ws.buckets.length > 0 && (
                            <div style={{ marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 7, display: 'flex', flexDirection: 'column', gap: 3 }}>
                              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.2)', marginBottom: 2, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '.06em' }}>Drop into bucket</div>
                              {ws.buckets.map(b => (
                                <button key={b.id} onClick={e => { e.stopPropagation(); assignToBucket(i, b.id); }}
                                  style={{ display: 'flex', alignItems: 'center', gap: 5, background: ws.postBuckets[i] === b.id ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${ws.postBuckets[i] === b.id ? b.color : 'transparent'}`, color: '#f5f3ee', fontSize: 9, padding: '4px 7px', borderRadius: 4, cursor: 'pointer', textAlign: 'left', width: '100%', fontFamily: 'inherit' }}>
                                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: b.color, flexShrink: 0 }} />
                                  {b.name}
                                  {ws.postBuckets[i] === b.id && <span style={{ marginLeft: 'auto', color: b.color, fontSize: 8 }}>✓ remove</span>}
                                </button>
                              ))}
                            </div>
                          )}

                          {isSelected && ws.buckets.length === 0 && (
                            <div style={{ marginTop: 7, fontSize: 9, color: 'rgba(255,255,255,0.25)', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 6 }}>
                              Create a bucket first →
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {colPosts.length === 0 && (
                      <div style={{ textAlign: 'center', padding: '20px 0', fontSize: 10, color: 'rgba(255,255,255,0.15)' }}>No posts</div>
                    )}
                  </div>
                </div>
              );
            });
          })()}
        </div>

        {/* RIGHT PANEL */}
        <div style={{ borderLeft: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
            {[['buckets','Buckets'],['spider','Spidergram'],['hints','AI hints']].map(([val, label]) => (
              <button key={val} onClick={() => { setActiveTab(val as any); if (val === 'hints') generateHints(); }}
                style={{ flex: 1, padding: '10px 4px', background: 'none', border: 'none', borderBottom: `2px solid ${activeTab === val ? '#c8b89a' : 'transparent'}`, color: activeTab === val ? '#f5f3ee' : 'rgba(255,255,255,0.3)', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', fontWeight: activeTab === val ? 500 : 400 }}>
                {label}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* BUCKETS TAB */}
            {activeTab === 'buckets' && (
              <>
                {ws.buckets.map((bucket) => (
                  <div key={bucket.id} style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, overflow: 'hidden' }}>
                    <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.02)' }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: bucket.color, flexShrink: 0 }} />
                      {editingBucket === bucket.id ? (
                        <input
                          autoFocus
                          defaultValue={bucket.name}
                          onBlur={e => {
                            updateWs({ buckets: ws.buckets.map(b => b.id === bucket.id ? { ...b, name: e.target.value } : b) });
                            setEditingBucket(null);
                          }}
                          style={{ background: 'transparent', border: 'none', color: '#f5f3ee', fontSize: 11, flex: 1, outline: 'none', fontFamily: 'inherit' }}
                        />
                      ) : (
                        <span onClick={() => setEditingBucket(bucket.id)} style={{ fontSize: 11, fontWeight: 500, flex: 1, cursor: 'text' }}>{bucket.name}</span>
                      )}
                      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace' }}>{bucket.postIndices.length}</span>
                      <button onClick={() => updateWs({ buckets: ws.buckets.filter(b => b.id !== bucket.id), postBuckets: Object.fromEntries(Object.entries(ws.postBuckets).filter(([,v]) => v !== bucket.id)) })}
                        style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: 10 }}>✕</button>
                    </div>
                    {bucket.postIndices.length > 0 && (
                      <div style={{ padding: '4px 10px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {bucket.postIndices.slice(0, 3).map(pi => (
                          <div key={pi} style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.02)', borderRadius: 3, padding: '3px 6px', lineHeight: 1.4 }}>
                            {posts[pi]?.text?.slice(0, 70)}...
                          </div>
                        ))}
                        {bucket.postIndices.length > 3 && (
                          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', padding: '2px 6px' }}>+{bucket.postIndices.length - 3} more</div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* Add bucket */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={newBucketName}
                    onChange={e => setNewBucketName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addBucket()}
                    placeholder="New bucket name..."
                    style={{ ...s.searchInput, flex: 1 }}
                  />
                  <button onClick={addBucket} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: '#f5f3ee', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>+</button>
                </div>

                {ws.buckets.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '24px 0', color: 'rgba(255,255,255,0.2)', fontSize: 11, lineHeight: 1.7 }}>
                    Create buckets to group posts into themes.<br />Then generate insights from your curation.
                  </div>
                )}
              </>
            )}

            {/* SPIDERGRAM TAB */}
            {activeTab === 'spider' && (
              <>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>
                  Based on {ws.starred.length} starred posts. Star more to refine.
                </div>

                {/* Spider SVG */}
                <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
                  <svg width="180" height="180" viewBox="0 0 180 180">
                    {[20, 40, 60, 80].map(r => (
                      <circle key={r} cx="90" cy="90" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
                    ))}
                    {DRIVERS.slice(0, 8).map((_, i) => {
                      const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
                      return <line key={i} x1="90" y1="90" x2={90 + Math.cos(angle) * 80} y2={90 + Math.sin(angle) * 80} stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />;
                    })}
                    <polygon
                      points={DRIVERS.slice(0, 8).map((d, i) => {
                        const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
                        const r = (driverScores[d] / 100) * 80;
                        return `${90 + Math.cos(angle) * r},${90 + Math.sin(angle) * r}`;
                      }).join(' ')}
                      fill="rgba(200,184,154,0.15)"
                      stroke="#c8b89a"
                      strokeWidth="1"
                    />
                    {DRIVERS.slice(0, 8).map((d, i) => {
                      const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
                      return (
                        <text key={d} x={90 + Math.cos(angle) * 95} y={90 + Math.sin(angle) * 95}
                          textAnchor="middle" dominantBaseline="central"
                          style={{ fontSize: 7, fill: 'rgba(255,255,255,0.4)', fontFamily: 'monospace' }}>
                          {d.slice(0, 6)}
                        </text>
                      );
                    })}
                  </svg>
                </div>

                {/* Driver bars */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {DRIVERS.sort((a, b) => (driverScores[b] || 0) - (driverScores[a] || 0)).map(d => (
                    <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', width: 70, flexShrink: 0 }}>{d}</span>
                      <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                        <div style={{ height: '100%', borderRadius: 2, background: '#c8b89a', width: `${driverScores[d] || 0}%`, transition: 'width 0.4s ease' }} />
                      </div>
                      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', width: 24, textAlign: 'right' }}>{driverScores[d] || 0}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* HINTS TAB */}
            {activeTab === 'hints' && (
              <>
                {hints.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px 0', color: 'rgba(255,255,255,0.2)', fontSize: 11, lineHeight: 1.7 }}>
                    {ws.starred.length < 3
                      ? 'Star at least 3 posts to generate AI pattern hints'
                      : 'Loading pattern suggestions...'}
                  </div>
                ) : hints.map((hint, i) => (
                  <div key={i} style={{ background: 'rgba(200,184,154,0.05)', border: '1px solid rgba(200,184,154,0.15)', borderRadius: 7, padding: '9px 10px' }}>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>{hint}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
                      <button onClick={() => {
                        const name = hint.split(' ').slice(0, 4).join(' ');
                        setNewBucketName(name);
                        setActiveTab('buckets');
                      }} style={{ fontSize: 9, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', background: 'rgba(200,184,154,0.15)', color: '#c8b89a', border: 'none', fontFamily: 'inherit' }}>
                        Create bucket
                      </button>
                      <button onClick={() => setHints(hints.filter((_, j) => j !== i))}
                        style={{ fontSize: 9, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.25)', border: 'none', fontFamily: 'inherit' }}>
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
                {ws.starred.length >= 3 && (
                  <button onClick={generateHints} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.4)', borderRadius: 6, padding: '8px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Refresh hints
                  </button>
                )}
              </>
            )}
          </div>

          {/* Generate bottom bar */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '10px 12px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace', textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>Generate themes from</div>
            <button
              onClick={async () => {
                if (ws.starred.length === 0) return;
                setGenerating(true);
                await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
                  body: JSON.stringify({ status: 'collected', workspace_state: ws })
                });
                const res = await fetch('/api/generate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ briefId: id, starredIndices: ws.starred })
                });
                const data = await res.json();
                if (data.success) window.location.href = `/results/${id}`;
                else { setGenerating(false); alert('Failed'); }
              }}
              disabled={ws.starred.length === 0 || generating}
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: ws.starred.length > 0 ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.2)', borderRadius: 6, padding: '7px', fontSize: 10, cursor: ws.starred.length > 0 ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
              ★ {ws.starred.length} starred posts
            </button>
            <button
              onClick={generateFromBuckets}
              disabled={ws.buckets.length === 0 || generating}
              style={{ background: '#f5f3ee', color: '#0e0d0b', border: 'none', borderRadius: 6, padding: '7px', fontSize: 10, fontWeight: 500, cursor: ws.buckets.length > 0 ? 'pointer' : 'not-allowed', opacity: ws.buckets.length === 0 ? 0.4 : 1, fontFamily: 'inherit' }}>
              {generating ? 'Generating...' : `${ws.buckets.length} bucket${ws.buckets.length !== 1 ? 's' : ''} → themes →`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  slabel: { fontSize: 9, color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', letterSpacing: '.1em', fontFamily: 'monospace', marginBottom: 6 },
  searchInput: { width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: 'rgba(255,255,255,0.5)', outline: 'none', fontFamily: 'inherit' },
  chip: { padding: '3px 8px', borderRadius: 20, fontSize: 10, cursor: 'pointer' },
  chipOn: { background: 'rgba(255,255,255,0.12)', color: '#f5f3ee' },
  chipOff: { background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.06)' },
};
