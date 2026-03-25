import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;

async function updateBrief(id: string, payload: object) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify(payload)
  });
  if (!res.ok) console.error('Supabase error:', await res.text());
}

function cleanText(t: string): string {
  return t
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/"/g, "'")
    .replace(/\\/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 250);
}

async function fetchFreshData(brief: any): Promise<any[]> {
  const posts: any[] = [];
  const query = (brief.category || '').split(' ').slice(0, 3).join(' ');
  try {
    const [hnRes, bskyRes] = await Promise.all([
      fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=25`, { signal: AbortSignal.timeout(5000) }),
      fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(query)}&limit=20`, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(5000) })
    ]);
    const hnData = await hnRes.json();
    for (const hit of hnData.hits || []) {
      if (hit.title) posts.push({ text: hit.title, source: 'Hacker News', country: 'Global', timestamp: hit.created_at });
    }
    const bskyText = await bskyRes.text();
    if (bskyText.startsWith('{')) {
      const bskyData = JSON.parse(bskyText);
      for (const post of bskyData.posts || []) {
        if (post.record?.text?.length > 20) posts.push({ text: post.record.text, source: 'Bluesky', country: 'Global', timestamp: post.indexedAt });
      }
    }
  } catch (e) { console.error('Fresh fetch:', e); }
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
    let rawPosts: any[] = [];
    if (brief.collected_posts_full?.length > 0) {
      rawPosts = brief.collected_posts_full.slice(0, 30);
      console.log(`Using ${rawPosts.length} collected posts`);
    } else if (brief.collected_posts?.length > 0) {
      rawPosts = brief.collected_posts.slice(0, 30).map((t: string) => ({ text: t, source: 'collected', country: 'Global' }));
      console.log(`Using ${rawPosts.length} collected text posts`);
    } else {
      rawPosts = await fetchFreshData(brief);
      console.log(`Using ${rawPosts.length} fresh posts`);
    }

    // Build clean numbered post list
    const numberedPosts = rawPosts.map((p, i) => {
      const text = cleanText(p.text || String(p));
      const source = p.source || 'unknown';
      const country = p.country || 'Global';
      const date = (p.timestamp || '').slice(0, 10);
      return `[${i + 1}] [${source}|${country}${date ? '|' + date : ''}] ${text}`;
    });

    const sourceSummary = rawPosts.length > 0
      ? `\nData from: ${[...new Set(rawPosts.map((p: any) => p.source))].slice(0, 6).join(', ')}.`
      : '';

    // Group posts by source type for diversity tracking
    const sourceTypes = rawPosts.map((p: any) => p.source || 'unknown');
    const uniqueSources = [...new Set(sourceTypes)];

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 2500,
        messages: [{
          role: 'user',
          content: `You are a senior cultural insight analyst at NOW-AGAIN.

Client: ${brief.brand}
Category: ${brief.category}
Markets: ${(brief.markets || []).join(', ') || 'Global'}
Question: "${brief.question}"${sourceSummary}

Sources available: ${uniqueSources.join(', ')}

Here are ${numberedPosts.length} real collected posts tagged [source|country|date]:
${numberedPosts.join('\n')}

Identify 4 distinct cultural themes relevant to the question.

VERBATIM SELECTION — THIS IS THE MOST IMPORTANT PART:

Your top priority is finding quotes where a real person speaks in first person — "I", "me", "my", "we". These are the most valuable.

Priority order for selecting verbatims:
1. FIRST PERSON (highest priority): "I stopped buying...", "My family always...", "We tried this and...", "I can't believe..."
2. SECOND PERSON / DIRECT VOICE: "You should...", "Try this...", direct recommendations from real people
3. FORUM / COMMUNITY VOICE: opinions, debates, questions from real people in comment sections or forums
4. YOUTUBE COMMENTS: reactions, personal experiences from video viewers
5. SOCIAL MEDIA: Bluesky, personal blog posts
6. LAST RESORT ONLY: news articles or Wikipedia — only if nothing better exists

STRICT RULES:
- Maximum 1 quote per source domain
- Never quote journalists writing about people — only quote actual people
- Each verbatim must start with the post number like "[3] actual quote"
- Only use text that genuinely appears in the posts above
- A quote like "I went to McDonald's with friends and had sparkling water to boycott" is perfect
- A quote like "According to analysts, consumers are increasingly..." is NOT acceptable

For each theme provide:
- name: evocative 2-4 words (e.g. "Quiet Local Pride")
- summary: 2 rich sentences connecting to the question and the market context
- drivers: exactly 2 from [Creativity, Experiences, Emotion, Engagement, Relationships, Responsibility, Wellbeing, Simplicity, Resilience, Control, Enhancement, Power, Achievement, Exploration, Individuality, Extremes]
- verbatims: exactly 4 quotes from DIFFERENT sources, each starting with "[N] "
- implications: exactly 3 strategic implications for ${brief.brand}

Return ONLY this JSON with no markdown, no preamble:
{"themes":[{"name":"","summary":"","drivers":["",""],"verbatims":["","","",""],"implications":["","",""]}]}`
        }]
      })
    });

    const claudeData = await claudeRes.json();
    const raw = (claudeData.content?.[0]?.text || '').trim();
    console.log('Claude preview:', raw.slice(0, 150));

    // Extract JSON robustly
    console.log('Full Claude response:', raw.slice(0, 500));
    if (!raw || raw.length === 0) throw new Error('Empty Claude response');

    // Extract JSON and sanitize
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`No JSON found. Got: ${raw.slice(0, 200)}`);

    let jsonStr = match[0];
    // Remove control characters that break JSON parsing
    jsonStr = jsonStr
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
      .replace(/\t/g, ' ')
      .replace(/\r/g, ' ');

    let results;
    try {
      results = JSON.parse(jsonStr);
    } catch (parseErr) {
      // Try to fix common JSON issues - unescaped quotes in strings
      console.log('JSON parse failed, attempting repair...');
      const repaired = jsonStr
        .replace(/([^\\])"([^"]*?)"/g, (m, p1, p2) => p1 + '"' + p2.replace(/"/g, '\\"') + '"')
        .replace(/\n/g, ' ')
        .replace(/\r/g, ' ');
      try {
        results = JSON.parse(repaired);
      } catch {
        throw new Error(`JSON parse failed: ${String(parseErr).slice(0, 100)}`);
      }
    }
    results.data_source = rawPosts.length > 0 ? 'collected' : 'fresh';
    results.post_count = rawPosts.length;

    await updateBrief(briefId, { status: 'complete', results, post_count: rawPosts.length });
    console.log('Done! Posts:', rawPosts.length);
    return NextResponse.json({ success: true });

  } catch (err) {
    console.error('Generate error:', err);
    if (briefId) await updateBrief(briefId, { status: 'failed' });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
