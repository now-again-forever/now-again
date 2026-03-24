import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;

// ── FETCH FROM HACKER NEWS ──
async function fetchHackerNews(keywords: string[]): Promise<string[]> {
  const posts: string[] = [];
  try {
    for (const keyword of keywords.slice(0, 2)) {
      const searchRes = await fetch(
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(keyword)}&tags=story&hitsPerPage=15`
      );
      const data = await searchRes.json();
      for (const hit of data.hits || []) {
        if (hit.title) posts.push(`[HN] ${hit.title}`);
        if (hit.story_text) posts.push(`[HN comment] ${hit.story_text.slice(0, 300)}`);
      }
    }
  } catch (e) {
    console.error('HN fetch error:', e);
  }
  return posts;
}

// ── FETCH FROM BLUESKY ──
async function fetchBluesky(keywords: string[]): Promise<string[]> {
  const posts: string[] = [];
  try {
    for (const keyword of keywords.slice(0, 2)) {
      const res = await fetch(
        `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(keyword)}&limit=20`
      );
      const data = await res.json();
      for (const post of data.posts || []) {
        if (post.record?.text) {
          posts.push(`[Bluesky] ${post.record.text}`);
        }
      }
    }
  } catch (e) {
    console.error('Bluesky fetch error:', e);
  }
  return posts;
}

// ── FETCH FROM REDDIT RSS ──
async function fetchReddit(keywords: string[]): Promise<string[]> {
  const posts: string[] = [];
  try {
    for (const keyword of keywords.slice(0, 2)) {
      const res = await fetch(
        `https://www.reddit.com/search.json?q=${encodeURIComponent(keyword)}&sort=relevance&limit=15&t=year`,
        { headers: { 'User-Agent': 'NOW-AGAIN/1.0' } }
      );
      const data = await res.json();
      for (const child of data?.data?.children || []) {
        const p = child.data;
        if (p.title) posts.push(`[Reddit] ${p.title}`);
        if (p.selftext && p.selftext.length > 20) {
          posts.push(`[Reddit post] ${p.selftext.slice(0, 300)}`);
        }
      }
    }
  } catch (e) {
    console.error('Reddit fetch error:', e);
  }
  return posts;
}

// ── EXTRACT KEYWORDS FROM QUESTION ──
function extractKeywords(question: string, category: string, brand: string): string[] {
  const stopWords = new Set(['what', 'how', 'why', 'when', 'where', 'who', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'that', 'this', 'their', 'about', 'us', 'we', 'our', 'you', 'your', 'it', 'its']);
  
  const words = question.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));

  const categoryWords = category.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  
  const allKeywords = [...new Set([...words, ...categoryWords])];
  return allKeywords.slice(0, 4);
}

// ── CALL CLAUDE ──
async function callClaude(brief: any, posts: string[]): Promise<any> {
  const postsText = posts.slice(0, 80).join('\n');

  const prompt = `You are a senior cultural insight analyst at a premium research agency called NOW-AGAIN.

Your client: ${brief.brand}
Category: ${brief.category}
Markets: ${(brief.markets || []).join(', ') || 'Global'}
Challenge type: ${(brief.challenge_type || []).join(', ')}
Time window: ${brief.time_window}

The intractable question:
"${brief.question}"

Below are ${posts.length} real online posts and conversations collected from Hacker News, Bluesky, and Reddit related to this brief. These are real verbatim voices from the internet.

---
${postsText}
---

Your task:
Analyse these conversations through the lens of the client's question and identify 4 distinct cultural themes.

For each theme provide:
1. A compelling 2-4 word theme name (evocative, not generic — think "Wholesome Simplicity" or "A Polarised World")
2. A 2-sentence cultural summary explaining what this theme reveals
3. The 2 dominant human drivers from this list that fuel it: [Creativity, Experiences, Emotion, Engagement, Relationships, Responsibility, Wellbeing, Simplicity, Resilience, Control, Enhancement, Power, Achievement, Exploration, Individuality, Extremes]
4. 4 verbatim quotes selected directly from the posts above (use the actual text, shorten if needed, keep authentic voice)
5. 3 specific "Implications for ${brief.brand}" bullet points — concrete, strategic, actionable

Respond ONLY with a valid JSON object in this exact format, no preamble:
{
  "themes": [
    {
      "name": "Theme Name",
      "summary": "Two sentence cultural summary.",
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
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { themes: [] };
  }
}

// ── UPDATE BRIEF IN SUPABASE ──
async function updateBrief(id: string, results: any, postCount: number) {
  await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    },
    body: JSON.stringify({
      status: 'complete',
      results,
      post_count: postCount
    })
  });
}

// ── MAIN HANDLER ──
export async function POST(req: NextRequest) {
  try {
    const { briefId } = await req.json();

    // Fetch the brief from Supabase
    const briefRes = await fetch(
      `${SUPABASE_URL}/rest/v1/briefs?id=eq.${briefId}&select=*`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    );
    const briefs = await briefRes.json();
    const brief = briefs[0];

    if (!brief) {
      return NextResponse.json({ error: 'Brief not found' }, { status: 404 });
    }

    // Extract keywords
    const keywords = extractKeywords(brief.question || '', brief.category || '', brief.brand || '');

    // Fetch real data from all sources in parallel
    const [hnPosts, bskyPosts, redditPosts] = await Promise.all([
      fetchHackerNews(keywords),
      fetchBluesky(keywords),
      fetchReddit(keywords)
    ]);

    const allPosts = [...hnPosts, ...bskyPosts, ...redditPosts];

    // Call Claude with real data
    const results = await callClaude(brief, allPosts);

    // Save results back to Supabase
    await updateBrief(briefId, results, allPosts.length);

    return NextResponse.json({ success: true, results, postCount: allPosts.length });

  } catch (error) {
    console.error('Generate error:', error);
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
  }
}
