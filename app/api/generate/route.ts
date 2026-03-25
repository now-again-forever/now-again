import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;

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
  if (!res.ok) console.error('Supabase error:', await res.text());
}

async function fetchFreshData(brief: any): Promise<string[]> {
  const posts: string[] = [];
  const query = (brief.category || '').split(' ').slice(0, 3).join(' ');

  try {
    const [hnRes, bskyRes] = await Promise.all([
      fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=25`, { signal: AbortSignal.timeout(5000) }),
      fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=20`, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(5000) })
    ]);

    const hnData = await hnRes.json();
    for (const hit of hnData.hits || []) {
      if (hit.title) posts.push(`[HN] ${hit.title}`);
    }

    const bskyText = await bskyRes.text();
    if (bskyText.startsWith('{')) {
      const bskyData = JSON.parse(bskyText);
      for (const post of bskyData.posts || []) {
        if (post.record?.text?.length > 20) posts.push(`[Bluesky] ${post.record.text.slice(0, 200)}`);
      }
    }
  } catch (e) { console.error('Fresh fetch error:', e); }

  return posts;
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

    // Use collected posts if available, otherwise fetch fresh
    let posts: string[] = [];
    let dataSource = 'fresh';

    if (brief.collected_posts_full && brief.collected_posts_full.length > 0) {
      posts = brief.collected_posts_full.slice(0, 60);
      dataSource = 'collected';
      console.log(`Using ${posts.length} collected posts (full)`);
    } else if (brief.collected_posts && brief.collected_posts.length > 0) {
      posts = brief.collected_posts.slice(0, 60);
      dataSource = 'collected';
      console.log(`Using ${posts.length} collected posts`);
    } else {
      posts = await fetchFreshData(brief);
      dataSource = 'fresh';
      console.log(`Using ${posts.length} fresh posts`);
    }

    // Build source summary for prompt
    let sourceSummary = '';
    if (brief.collected_posts_full && Array.isArray(brief.collected_posts_full)) {
      const sources = [...new Set(brief.collected_posts_full.map((p: any) => p.source))];
      const countries = [...new Set(brief.collected_posts_full.map((p: any) => p.country).filter((c: string) => c !== 'Global'))];
      sourceSummary = `\nData collected from: ${sources.slice(0, 8).join(', ')}. Markets represented: ${countries.slice(0, 5).join(', ')}.`;
    }

    // Build numbered post list with sources for citation
    const numberedPosts = posts.slice(0, 60).map((p, i) => {
      if (typeof p === 'object' && p !== null) {
        const post = p as any;
        return `[${i+1}] [${post.source}|${post.country}|${post.timestamp?.slice(0,10)||''}] ${post.text}`;
      }
      return `[${i+1}] ${p}`;
    });

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 2500,
        messages: [{
          role: 'user',
          content: `You are a senior cultural insight analyst at NOW-AGAIN, a premium cultural intelligence platform.

Client: ${brief.brand}
Category: ${brief.category}
Markets: ${(brief.markets || []).join(', ') || 'Global'}
Question: "${brief.question}"${sourceSummary}

Here are ${numberedPosts.length} real collected posts, each tagged with [source|country|date]:
${numberedPosts.join('\n')}

Analyse these through the lens of the client's question. Identify 4 distinct cultural themes.

CRITICAL RULES FOR VERBATIMS:
- Verbatims MUST be real text copied exactly from the posts above
- Each verbatim must include the post number in brackets, e.g. "[3] actual text from that post"
- Do NOT invent or paraphrase quotes — only use text that genuinely appears above
- If a post is not relevant enough to quote, skip it

For each theme:
- Evocative 2-4 word name (e.g. "Quiet Local Pride", "The Authenticity Gap")
- 2-sentence cultural summary directly addressing the question
- 2 human drivers from: Creativity, Experiences, Emotion, Engagement, Relationships, Responsibility, Wellbeing, Simplicity, Resilience, Control, Enhancement, Power, Achievement, Exploration, Individuality, Extremes
- 4 verbatim quotes from the posts above (with post number prefix)
- 3 strategic implications for ${brief.brand}

Return ONLY valid JSON, no markdown:
{"themes":[{"name":"string","summary":"string","drivers":["string","string"],"verbatims":["[N] exact quote","[N] exact quote","[N] exact quote","[N] exact quote"],"implications":["string","string","string"]}]}`
        }]
      })
    });

    const claudeData = await claudeRes.json();
    const raw = claudeData.content?.[0]?.text || '';
    console.log('Claude preview:', raw.slice(0, 200));

    const results = JSON.parse(raw.replace(/```json|```/g, '').trim());
    results.data_source = dataSource;
    results.post_count = posts.length;

    await updateBrief(briefId, { status: 'complete', results, post_count: posts.length });
    console.log('Saved! Source:', dataSource, 'Posts:', posts.length);
    return NextResponse.json({ success: true });

  } catch (err) {
    console.error('Generate error:', err);
    if (briefId) await updateBrief(briefId, { status: 'failed' });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
