import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;

async function fetchHackerNews(keywords: string[]): Promise<string[]> {
  const posts: string[] = [];
  try {
    const keyword = keywords.slice(0, 2).join(' ');
    const res = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(keyword)}&tags=story&hitsPerPage=25`);
    const data = await res.json();
    for (const hit of data.hits || []) { if (hit.title) posts.push(`[HN] ${hit.title}`); }
  } catch (e) { console.error('HN error:', e); }
  return posts;
}

async function fetchBluesky(keywords: string[]): Promise<string[]> {
  const posts: string[] = [];
  try {
    const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(keywords[0] || '')}&limit=15`, { headers: { 'Accept': 'application/json' } });
    const text = await res.text();
    if (!text.startsWith('{')) return posts;
    const data = JSON.parse(text);
    for (const post of data.posts || []) { if (post.record?.text?.length > 20) posts.push(`[Bluesky] ${post.record.text.slice(0, 200)}`); }
  } catch (e) { console.error('Bluesky error:', e); }
  return posts;
}

function extractKeywords(question: string, category: string): string[] {
  const stop = new Set(['what','how','why','the','and','or','for','with','that','this','are','was','about','can','from','have','its','not','but','been','they','will','more','also','than']);
  const words = (question + ' ' + category).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !stop.has(w));
  return [...new Set(words)].slice(0, 3);
}

async function updateBrief(id: string, payload: object) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify(payload)
  });
  if (!res.ok) console.error('Supabase error:', await res.text());
}

export async function POST(req: NextRequest) {
  let briefId = '';
  try {
    briefId = (await req.json()).briefId;
    const briefRes = await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${briefId}&select=*`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
    const brief = (await briefRes.json())[0];
    if (!brief) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const keywords = extractKeywords(brief.question || '', brief.category || '');
    const withTimeout = (p: Promise<string[]>) => Promise.race([p, new Promise<string[]>((r) => setTimeout(() => r([]), 5000))]);
    const [hn, bsky] = await Promise.all([withTimeout(fetchHackerNews(keywords)), withTimeout(fetchBluesky(keywords))]);
    const posts = [...hn, ...bsky];
    console.log('Posts fetched:', posts.length);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 1500, messages: [{ role: 'user', content: `Analyse these conversations for ${brief.brand}. Question: "${brief.question}"\n\n${posts.slice(0,35).join('\n')}\n\nReturn ONLY valid JSON, no markdown:\n{"themes":[{"name":"string","summary":"string","drivers":["string","string"],"verbatims":["string","string","string","string"],"implications":["string","string","string"]}]}` }] })
    });

    const claudeData = await claudeRes.json();
    const raw = claudeData.content?.[0]?.text || '';
    console.log('Claude raw:', raw.slice(0, 300));

    const results = JSON.parse(raw.replace(/```json|```/g, '').trim());
    await updateBrief(briefId, { status: 'complete', results, post_count: posts.length });
    console.log('Saved!');
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error:', err);
    if (briefId) await updateBrief(briefId, { status: 'failed' });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
