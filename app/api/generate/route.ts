import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;

async function fetchHackerNews(keywords: string[]): Promise<string[]> {
  const posts: string[] = [];
  try {
    for (const keyword of keywords.slice(0, 3)) {
      const res = await fetch(
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(keyword)}&tags=story&hitsPerPage=20`
      );
      const data = await res.json();
      for (const hit of data.hits || []) {
        if (hit.title) posts.push(`[HN] ${hit.title}`);
        if (hit.story_text) posts.push(`[HN] ${hit.story_text.slice(0, 300)}`);
      }
    }
  } catch (e) { console.error('HN error:', e); }
  return posts;
}

async function fetchBluesky(keywords: string[]): Promise<string[]> {
  const posts: string[] = [];
  try {
    for (const keyword of keywords.slice(0, 2)) {
      const res = await fetch(
        `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(keyword)}&limit=20`,
        { headers: { 'Accept': 'application/json' } }
      );
      const text = await res.text();
      if (!text.startsWith('{') && !text.startsWith('[')) continue;
      const data = JSON.parse(text);
      for (const post of data.posts || []) {
        if (post.record?.text && post.record.text.length > 20) {
          posts.push(`[Bluesky] ${post.record.text}`);
        }
      }
    }
  } catch (e) { console.error('Bluesky error:', e); }
  return posts;
}

async function fetchReddit(keywords: string[]): Promise<string[]> {
  const posts: string[] = [];
  try {
    for (const keyword of keywords.slice(0, 2)) {
      const res = await fetch(
        `https://www.reddit.com/search.json?q=${encodeURIComponent(keyword)}&sort=relevance&limit=15&t=year`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NowAgain/1.0)', 'Accept': 'application/json' } }
      );
      const text = await res.text();
      if (!text.startsWith('{')) continue;
      const data = JSON.parse(text);
      for (const child of data?.data?.children || []) {
        const p = child.data;
        if (p.title) posts.push(`[Reddit] ${p.title}`);
      }
    }
  } catch (e) { console.error('Reddit error:', e); }
  return posts;
}

function extractKeywords(question: string, category: string): string[] {
  const stopWords = new Set(['what','how','why','when','where','who','the','and','or','but','in','on','at','to','for','of','with','a','an','is','are','was','were','be','been','have','has','do','does','will','would','could','should','may','might','can','that','this','about','us','we','our','you','your','it','its']);
  const words = (question + ' ' + category).toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));
  return [...new Set(words)].slice(0, 4);
}

async function callClaude(brief: any, posts: string[]): Promise<any> {
  const postsText = posts.slice(0, 80).join('\n');
  const prompt = `You are a senior cultural insight analyst at NOW-AGAIN, a premium cultural intelligence platform.

Client: ${brief.brand}
Category: ${brief.category}
Markets: ${(brief.markets || []).join(', ') || 'Global'}
Challenge: ${(brief.challenge_type || []).join(', ')}
Question: "${brief.question}"

Below are ${posts.length} real online posts from Hacker News, Bluesky, and Reddit:

---
${postsText}
---

Analyse these through the lens of the client's question. Identify 4 distinct cultural themes.

For each theme:
1. A compelling 2-4 word name (e.g. "Wholesome Simplicity", "A Polarised World")
2. A 2-sentence cultural summary
3. 2 dominant human drivers from: [Creativity, Experiences, Emotion, Engagement, Relationships, Responsibility, Wellbeing, Simplicity, Resilience, Control, Enhancement, Power, Achievement, Exploration, Individuality, Extremes]
4. 4 verbatim quotes from the posts above (real text, authentic voice)
5. 3 specific implications for ${brief.brand}

Respond ONLY with valid JSON, no preamble:
{
  "themes": [
    {
      "name": "Theme Name",
      "summary": "Two sentence summary.",
      "drivers": ["Driver1", "Driver2"],
      "verbatims": ["quote 1", "quote 2", "quote 3", "quote 4"],
      "implications": ["Implication 1", "Implication 2", "Implication 3"]
    }
  ]
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await res.json();
  const text = data.content?.[0]?.text || '{}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return { themes: [] };
  }
}

async function updateBrief(id: string, results: any, postCount: number) {
  await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    },
    body: JSON.stringify({ status: 'complete', results, post_count: postCount })
  });
}

export async function POST(req: NextRequest) {
  try {
    const { briefId } = await req.json();
    const briefRes = await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${briefId}&select=*`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const briefs = await briefRes.json();
    const brief = briefs[0];
    if (!brief) return NextResponse.json({ error: 'Brief not found' }, { status: 404 });

    const keywords = extractKeywords(brief.question || '', brief.category || '');
    const [hnPosts, bskyPosts, redditPosts] = await Promise.all([
      fetchHackerNews(keywords),
      fetchBluesky(keywords),
      fetchReddit(keywords)
    ]);
    const allPosts = [...hnPosts, ...bskyPosts, ...redditPosts];
    const results = await callClaude(brief, allPosts);
    await updateBrief(briefId, results, allPosts.length);
    return NextResponse.json({ success: true, results, postCount: allPosts.length });
  } catch (error) {
    console.error('Generate error:', error);
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
  }
}
