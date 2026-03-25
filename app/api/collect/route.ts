import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const RESEND_KEY = process.env.RESEND_API_KEY;

interface Post {
  text: string;
  source: string;
  url: string;
  country: string;
  category: string;
  timestamp: string;
  type: string;
}

async function updateBrief(id: string, patch: object) {
  await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify(patch)
  });
}

// ── RSS via rss2json proxy (free, handles CORS + fetching) ──
async function fetchRSSViaProxy(siteUrl: string, country: string, category: string): Promise<Post[]> {
  const posts: Post[] = [];
  try {
    const feedUrl = siteUrl.endsWith('/') ? `${siteUrl}feed` : `${siteUrl}/feed`;
    const proxyUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}&count=8`;
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return posts;
    const data = await res.json();
    if (data.status !== 'ok' || !data.items?.length) return posts;

    const sourceName = new URL(siteUrl).hostname.replace('www.', '');
    for (const item of data.items.slice(0, 5)) {
      const title = item.title?.trim() || '';
      const desc = (item.description || item.content || '')
        .replace(/<[^>]+>/g, '').trim().slice(0, 400);
      if (title.length > 10) {
        posts.push({
          text: desc ? `${title}. ${desc}` : title,
          source: sourceName,
          url: item.link || siteUrl,
          country,
          category,
          timestamp: item.pubDate || new Date().toISOString(),
          type: 'rss'
        });
      }
    }
  } catch (e) { /* silent fail per source */ }
  return posts;
}

// ── HN ──
async function fetchHN(query: string): Promise<Post[]> {
  const posts: Post[] = [];
  try {
    const res = await fetch(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=25`,
      { signal: AbortSignal.timeout(6000) }
    );
    const data = await res.json();
    for (const hit of data.hits || []) {
      if (hit.title) posts.push({
        text: hit.story_text ? `${hit.title}. ${hit.story_text.slice(0, 300)}` : hit.title,
        source: 'Hacker News',
        url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        country: 'Global',
        category: 'Technology & culture',
        timestamp: hit.created_at || new Date().toISOString(),
        type: 'hn'
      });
    }
  } catch (e) { console.error('HN:', e); }
  return posts;
}

// ── Bluesky ──
async function fetchBluesky(query: string): Promise<Post[]> {
  const posts: Post[] = [];
  try {
    const simple = query.replace(/\(|\)|AND|OR|NOT|NEAR\/\d+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 5).join(' ');
    const res = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(simple)}&limit=20`,
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(6000) }
    );
    const text = await res.text();
    if (!text.startsWith('{')) return posts;
    const data = JSON.parse(text);
    for (const post of data.posts || []) {
      if (post.record?.text?.length > 20) posts.push({
        text: post.record.text,
        source: 'Bluesky',
        url: `https://bsky.app/profile/${post.author?.handle}`,
        country: 'Global',
        category: 'Social media',
        timestamp: post.indexedAt || new Date().toISOString(),
        type: 'bluesky'
      });
    }
  } catch (e) { console.error('Bluesky:', e); }
  return posts;
}

// ── NewsData.io (free tier — 200 requests/day) ──
async function fetchNewsData(query: string, markets: string[]): Promise<Post[]> {
  const posts: Post[] = [];
  try {
    const COUNTRY_MAP: Record<string, string> = {
      'UK': 'gb', 'USA': 'us', 'US': 'us', 'France': 'fr', 'FR': 'fr',
      'Spain': 'es', 'ES': 'es', 'Germany': 'de', 'DE': 'de',
      'Poland': 'pl', 'PL': 'pl', 'Turkey': 'tr', 'TR': 'tr',
      'Italy': 'it', 'Netherlands': 'nl'
    };
    const countryCodes = markets.map(m => COUNTRY_MAP[m]).filter(Boolean).slice(0, 3).join(',');
    const simpleQuery = query.replace(/\(|\)|AND|OR|NOT|NEAR\/\d+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' ');

    const url = `https://newsdata.io/api/1/news?apikey=${process.env.NEWSDATA_API_KEY}&q=${encodeURIComponent(simpleQuery)}&language=en${countryCodes ? `&country=${countryCodes}` : ''}&size=10`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return posts;
    const data = await res.json();

    for (const article of data.results || []) {
      if (article.title) posts.push({
        text: article.description ? `${article.title}. ${article.description.slice(0, 300)}` : article.title,
        source: article.source_id || 'News',
        url: article.link || '',
        country: article.country?.[0]?.toUpperCase() || 'Global',
        category: 'News',
        timestamp: article.pubDate || new Date().toISOString(),
        type: 'news'
      });
    }
  } catch (e) { console.error('NewsData:', e); }
  return posts;
}

// ── Send email ──
async function sendEmail(brief: any, postCount: number) {
  if (!RESEND_KEY || !brief.client_email) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'NOW-AGAIN <noreply@resend.dev>',
        to: brief.client_email,
        subject: `Your ${brief.brand} brief is ready — ${postCount} conversations collected`,
        html: `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:40px 20px">
          <h1 style="font-size:28px;font-weight:400">Data collection complete.</h1>
          <p style="color:#666;line-height:1.7">NOW-AGAIN collected <strong>${postCount} conversations</strong> for your <strong>${brief.brand}</strong> brief.</p>
          <p style="color:#999;font-style:italic">"${brief.question}"</p>
          <a href="https://now-again-xi.vercel.app/collecting/${brief.id}"
             style="display:inline-block;background:#0e0d0b;color:#f5f3ee;padding:14px 28px;border-radius:6px;text-decoration:none;font-family:sans-serif;font-size:14px;margin-top:16px">
            View results →
          </a>
        </div>`
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
    const clusters = brief.selected_clusters || [];
    const markets = brief.markets || [];

    const MARKET_MAP: Record<string, string> = {
      'UK': 'UK', 'FR': 'France', 'ES': 'Spain', 'DE': 'Germany',
      'PL': 'Poland', 'TR': 'Turkey', 'US': 'USA', 'Global': 'Global English'
    };
    const dbMarkets = markets.map((m: string) => MARKET_MAP[m] || m);

    await updateBrief(briefId, {
      status: 'collecting',
      collection_progress: { total_posts: 0, sources_scraped: 0, sources_total: 0, log: [`Starting collection for ${brief.brand}...`] }
    });

    let allPosts: Post[] = [];
    let log: string[] = [`Starting collection for ${brief.brand}...`];
    let sourcesScraped = 0;

    // ── STEP 1: RSS from curated sources via rss2json proxy ──
    if (clusters.length > 0 && dbMarkets.length > 0) {
      const catList = clusters.map((c: string) => `"${c}"`).join(',');
      const mktList = dbMarkets.map((m: string) => `"${m}"`).join(',');

      const sourcesRes = await fetch(
        `${SUPABASE_URL}/rest/v1/sources?country=in.(${mktList})&category=in.(${catList})&select=url,country,category&limit=60`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
      );
      const sources = await sourcesRes.json();
      log = [...log, `Scanning ${sources.length} curated sources...`];

      await updateBrief(briefId, {
        collection_progress: { total_posts: 0, sources_scraped: 0, sources_total: sources.length + queries.length * 2, log }
      });

      // Batch of 5 concurrent RSS fetches
      for (let i = 0; i < Math.min(sources.length, 60); i += 5) {
        const batch = sources.slice(i, i + 5);
        const results = await Promise.all(
          batch.map((s: any) => fetchRSSViaProxy(s.url, s.country, s.category))
        );
        const batchPosts = results.flat();
        allPosts = [...allPosts, ...batchPosts];
        sourcesScraped += batch.length;

        if (batchPosts.length > 0) {
          const sourceNames = batchPosts.slice(0, 3).map(p => p.source).join(', ');
          log = [...log, `+${batchPosts.length} posts from ${sourceNames}`];
        }

        await updateBrief(briefId, {
          collection_progress: {
            total_posts: allPosts.length,
            sources_scraped: sourcesScraped,
            sources_total: sources.length + queries.length * 2,
            log: log.slice(-15)
          }
        });
      }
    }

    // ── STEP 2: HN + Bluesky + NewsData per query ──
    for (const q of queries.slice(0, 3)) {
      log = [...log, `Searching: "${q.label}"`];
      const [hnPosts, bskyPosts, newsPosts] = await Promise.all([
        fetchHN(q.query),
        fetchBluesky(q.query),
        fetchNewsData(q.query, markets)
      ]);
      allPosts = [...allPosts, ...hnPosts, ...bskyPosts, ...newsPosts];
      sourcesScraped += 3;
      log = [...log, `+${hnPosts.length + bskyPosts.length + newsPosts.length} posts (HN + Bluesky + News)`];

      await updateBrief(briefId, {
        collection_progress: {
          total_posts: allPosts.length,
          sources_scraped: sourcesScraped,
          sources_total: sourcesScraped,
          log: log.slice(-15)
        }
      });
    }

    // Deduplicate
    const seen = new Set<string>();
    const uniquePosts = allPosts.filter(p => {
      const key = p.text.slice(0, 80);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const sourceCount = new Set(uniquePosts.map(p => p.source)).size;
    log = [...log, `Done — ${uniquePosts.length} posts from ${sourceCount} sources`];

    await updateBrief(briefId, {
      status: 'collected',
      post_count: uniquePosts.length,
      collected_posts: uniquePosts.map(p => p.text),
      collected_posts_full: uniquePosts,
      collection_progress: {
        total_posts: uniquePosts.length,
        sources_scraped: sourcesScraped,
        sources_total: sourcesScraped,
        log: log.slice(-20)
      }
    });

    await sendEmail(brief, uniquePosts.length);
    return NextResponse.json({ success: true, postCount: uniquePosts.length });

  } catch (err) {
    console.error('Collect error:', err);
    if (briefId) await updateBrief(briefId, { status: 'failed' });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
