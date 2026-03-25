import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;

async function callClaude(prompt: string, maxTokens = 4000): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
  });
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

function cleanText(t: string): string {
  return t.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function scoreRelevance(text: string, question: string, category: string): number {
  const t = text.toLowerCase();
  const q = (question + ' ' + category).toLowerCase();
  const qWords = q.split(/\s+/).filter(w => w.length > 4);
  let score = 0;
  // Keyword overlap with brief
  for (const w of qWords) { if (t.includes(w)) score += 2; }
  // First person voice
  if (/\bI\b|\bmy\b|\bme\b|\bwe\b|\bour\b/.test(text)) score += 2;
  // Opinion signals
  if (/\b(love|hate|feel|think|believe|prefer|tried|bought|always|never)\b/i.test(text)) score += 1;
  // Noise penalties
  if (/cookie|privacy|subscribe|sign up|buy now|free delivery|terms/i.test(t)) score -= 5;
  if (text.length < 30) score -= 3;
  return score;
}

export async function POST(req: NextRequest) {
  let briefId = '';
  try {
    briefId = (await req.json()).briefId;

    const briefRes = await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${briefId}&select=*`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const brief = (await briefRes.json())[0];
    if (!brief) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const allPosts: any[] = brief.collected_posts_full || [];
    if (allPosts.length === 0) return NextResponse.json({ error: 'no posts' }, { status: 400 });

    // Step 1: Quality filter — score every post for relevance
    const scoredPosts = allPosts.map((p, i) => ({
      ...p, _idx: i,
      _relevance: scoreRelevance(p.text || '', brief.question || '', brief.category || '')
    })).filter(p => p._relevance >= 1); // Keep only relevant posts

    console.log(`Quality filter: ${scoredPosts.length}/${allPosts.length} posts passed`);

    // Step 2: Sample up to 200 posts for clustering (best quality)
    const sample = scoredPosts
      .sort((a, b) => b._relevance - a._relevance)
      .slice(0, 200);

    // Step 3: Ask Claude to cluster into 20-30 themes
    const postList = sample.map((p, i) => `[${i + 1}] ${cleanText(p.text)}`).join('\n');

    const clusterPrompt = `You are a cultural insight researcher analysing online conversations.

Brief: "${brief.question}"
Brand: ${brief.brand}
Category: ${brief.category}

Here are ${sample.length} online posts collected for this project:
${postList}

Group these posts into 20-30 distinct semantic themes. Each theme should be:
- Named with 2-4 evocative words (like "Nostalgic Authenticity" or "Political Consumption")
- Grounded in what multiple posts actually say — not invented
- Listed with the post numbers that belong to it
- Given a 1-sentence description

Sort themes from most to least frequent (most posts = top).

Return ONLY valid JSON:
{"clusters":[{"name":"Theme Name","description":"One sentence about what this theme captures","postIndices":[1,4,7,12],"count":4},...]}`;

    const raw = await callClaude(clusterPrompt, 4000);
    console.log('Cluster response preview:', raw.slice(0, 200));

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in cluster response');

    const parsed = JSON.parse(match[0]);
    const rawClusters = parsed.clusters || [];

    // Step 4: Map cluster post indices back to actual posts
    const clusters = rawClusters.map((c: any) => ({
      name: c.name,
      description: c.description,
      count: c.postIndices?.length || 0,
      posts: (c.postIndices || []).map((idx: number) => sample[idx - 1]).filter(Boolean)
    })).sort((a: any, b: any) => b.count - a.count);

    // Save clusters and filtered posts to Supabase
    await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${briefId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({
        clusters,
        collected_posts_full: scoredPosts // replace with quality-filtered posts
      })
    });

    return NextResponse.json({ success: true, clusterCount: clusters.length, postCount: scoredPosts.length });

  } catch (err) {
    console.error('Cluster error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
