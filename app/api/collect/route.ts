import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const RESEND_KEY = process.env.RESEND_API_KEY;

async function updateProgress(id: string, patch: object) {
  await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify(patch)
  });
}

async function appendLog(id: string, entry: string, currentLog: string[]) {
  const newLog = [...currentLog, `${new Date().toLocaleTimeString()} — ${entry}`].slice(-50);
  await updateProgress(id, { collection_progress: { log: newLog } });
  return newLog;
}

async function fetchFromHN(query: string): Promise<string[]> {
  const posts: string[] = [];
  try {
    const res = await fetch(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=30`,
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await res.json();
    for (const hit of data.hits || []) {
      if (hit.title) posts.push(`[HN] ${hit.title}`);
      if (hit.story_text) posts.push(`[HN] ${hit.story_text.slice(0, 300)}`);
    }
  } catch (e) { console.error('HN:', e); }
  return posts;
}

async function fetchFromBluesky(query: string): Promise<string[]> {
  const posts: string[] = [];
  try {
    const simple = query.replace(/\(|\)|AND|OR|NOT|NEAR\/\d+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 5).join(' ');
    const res = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(simple)}&limit=25`,
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(8000) }
    );
    const text = await res.text();
    if (!text.startsWith('{')) return posts;
    const data = JSON.parse(text);
    for (const post of data.posts || []) {
      if (post.record?.text?.length > 20) posts.push(`[Bluesky] ${post.record.text.slice(0, 300)}`);
    }
  } catch (e) { console.error('Bluesky:', e); }
  return posts;
}

async function sendCompletionEmail(brief: any, postCount: number) {
  if (!RESEND_KEY || !brief.client_email) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'NOW-AGAIN <noreply@now-again.com>',
        to: brief.client_email,
        subject: `Your ${brief.brand} brief is ready — ${postCount} conversations collected`,
        html: `
          <div style="font-family: Georgia, serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
            <h1 style="font-size: 28px; font-weight: 400; color: #0e0d0b;">Data collection complete.</h1>
            <p style="color: #666; line-height: 1.7;">NOW-AGAIN has finished collecting conversations for your <strong>${brief.brand}</strong> brief.</p>
            <ul style="color: #666; line-height: 2;">
              <li>${postCount} conversations collected</li>
              <li>${(brief.selected_clusters || []).length} source clusters scanned</li>
              <li>${(brief.markets || []).join(', ')} markets</li>
            </ul>
            <p style="color: #666; line-height: 1.7; font-style: italic;">"${brief.question}"</p>
            <a href="https://now-again-xi.vercel.app/results/${brief.id}"
               style="display:inline-block;background:#0e0d0b;color:#f5f3ee;padding:14px 28px;border-radius:6px;text-decoration:none;font-family:sans-serif;font-size:14px;margin-top:16px;">
              Generate insights →
            </a>
          </div>
        `
      })
    });
  } catch (e) { console.error('Email:', e); }
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

    const queries = brief.selected_queries || [];
    if (queries.length === 0) return NextResponse.json({ error: 'no queries' }, { status: 400 });

    let log: string[] = [];
    let allPosts: string[] = [];
    let sourcesScraped = 0;
    const sourcesTotal = queries.length * 2;

    await updateProgress(briefId, {
      status: 'collecting',
      collection_progress: {
        total_posts: 0,
        sources_scraped: 0,
        sources_total: sourcesTotal,
        log: [`Starting collection for ${brief.brand}...`]
      }
    });

    for (const q of queries) {
      log = await appendLog(briefId, `Searching HN: "${q.label}"`, log);
      const hnPosts = await fetchFromHN(q.query);
      allPosts = [...allPosts, ...hnPosts];
      sourcesScraped++;

      await updateProgress(briefId, {
        collection_progress: {
          total_posts: allPosts.length,
          sources_scraped: sourcesScraped,
          sources_total: sourcesTotal,
          log
        }
      });

      log = await appendLog(briefId, `Searching Bluesky: "${q.label}" — ${hnPosts.length} posts`, log);
      const bskyPosts = await fetchFromBluesky(q.query);
      allPosts = [...allPosts, ...bskyPosts];
      sourcesScraped++;

      await updateProgress(briefId, {
        collection_progress: {
          total_posts: allPosts.length,
          sources_scraped: sourcesScraped,
          sources_total: sourcesTotal,
          log
        }
      });
    }

    const uniquePosts = [...new Set(allPosts)];
    log = await appendLog(briefId, `Collection complete — ${uniquePosts.length} unique conversations`, log);

    await updateProgress(briefId, {
      status: 'collected',
      post_count: uniquePosts.length,
      collected_posts: uniquePosts,
      collection_progress: {
        total_posts: uniquePosts.length,
        sources_scraped: sourcesTotal,
        sources_total: sourcesTotal,
        log
      }
    });

    await sendCompletionEmail(brief, uniquePosts.length);

    return NextResponse.json({ success: true, postCount: uniquePosts.length });

  } catch (err) {
    console.error('Collect error:', err);
    if (briefId) await updateProgress(briefId, { status: 'failed' });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
