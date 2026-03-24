import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;

// ── STEP 1: Ask Claude to build a Boolean search query from the brief ──
async function buildBooleanQuery(brief: any): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `You are a social listening expert. Convert this research brief into a short Boolean search query for finding relevant online conversations.

Brand: ${brief.brand}
Category: ${brief.category}
Question: "${brief.question}"

Rules:
- Use OR between synonyms/related terms
- Use AND to combine key topic areas
- Keep it under 10 words total
- Focus on the cultural/consumer topic, not the brand name
- Use simple terms people would actually write online

Return ONLY the search query string, nothing else. Example format: (food OR snacks OR crisps) AND (Spain OR Spanish OR local)`
      }]
    })
  });
  const data = await res.json();
  const query = data.content?.[0]?.text?.trim() || brief.category;
  console.log('Boolean query:', query);
  return query;
}

async function fetchHackerNews(query: string): Promise<string[]> {
  const posts: string[] = [];
  try {
    const res = await fetch(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=25`
    );
    const data = await res.json();
    for (const hit of data.hits || []) {
      if (hit.title) posts.push(`[HN] ${hit.title}`);
      if (hit.story_text) posts.push(`[HN] ${hit.story_text.slice(0, 250)}`);
    }
  } catch (e) { console.error('HN error:', e); }
  return posts;
}

async function fetchBluesky(query: string): Promise<string[]> {
  const posts: string[] = [];
  try {
    // Bluesky doesn't support full Boolean so use the core terms only
    const coreQuery = query.replace(/\(|\)|AND|OR/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
    const res = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(coreQuery)}&limit=20`,
      { headers: { 'Accept': 'application/json' } }
    );
    const text = await res.text();
    if (!text.startsWith('{')) return posts;
    const data = JSON.parse(text);
    for (const post of data.posts || []) {
      if (post.record?.text?.length > 20) {
        posts.push(`[Bluesky] ${post.record.text.slice(0, 250)}`);
      }
    }
  } catch (e) { console.error('Bluesky error:', e); }
  return posts;
}

async function updateBrief(id: string, payload: object) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) console.error('Supabase update error:', await res.text());
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

    // Step 1: Build Boolean query using Claude
    const booleanQuery = await buildBooleanQuery(brief);

    // Step 2: Fetch data using that query
    const withTimeout = (p: Promise<string[]>) =>
      Promise.race([p, new Promise<string[]>((r) => setTimeout(() => r([]), 5000))]);

    const [hn, bsky] = await Promise.all([
      withTimeout(fetchHackerNews(booleanQuery)),
      withTimeout(fetchBluesky(booleanQuery)),
    ]);

    const posts = [...hn, ...bsky];
    console.log('Posts fetched:', posts.length);

    // Step 3: Claude analyses the posts
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1800,
        messages: [{
          role: 'user',
          content: `You are a senior cultural insight analyst at NOW-AGAIN, a premium cultural intelligence platform.

Client: ${brief.brand}
Category: ${brief.category}
Markets: ${(brief.markets || []).join(', ') || 'Global'}
Question: "${brief.question}"

Search query used: "${booleanQuery}"

Here are ${posts.length} real online posts collected using that query:
${posts.slice(0, 40).join('\n')}

Analyse these conversations through the lens of the client's question. Identify 4 distinct cultural themes. For each theme:
- Name it evocatively (2-4 words, e.g. "Wholesome Simplicity", "The Authenticity Gap")
- Write a 2-sentence cultural summary
- Tag 2 human drivers from: Creativity, Experiences, Emotion, Engagement, Relationships, Responsibility, Wellbeing, Simplicity, Resilience, Control, Enhancement, Power, Achievement, Exploration, Individuality, Extremes
- Select 4 verbatim quotes from the posts above (real text, shortened if needed)
- Write 3 strategic implications for ${brief.brand}

Return ONLY valid JSON, no markdown, no preamble:
{"themes":[{"name":"string","summary":"string","drivers":["string","string"],"verbatims":["string","string","string","string"],"implications":["string","string","string"]}]}`
        }]
      })
    });

    const claudeData = await claudeRes.json();
    const raw = claudeData.content?.[0]?.text || '';
    console.log('Claude raw preview:', raw.slice(0, 300));

    const results = JSON.parse(raw.replace(/```json|```/g, '').trim());

    // Save search query alongside results for transparency
    results.search_query = booleanQuery;
    results.sources = ['Hacker News', 'Bluesky'];

    await updateBrief(briefId, { status: 'complete', results, post_count: posts.length });
    console.log('Saved successfully!');
    return NextResponse.json({ success: true, postCount: posts.length });

  } catch (err) {
    console.error('Error:', err);
    if (briefId) await updateBrief(briefId, { status: 'failed' });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
