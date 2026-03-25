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
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    },
    body: JSON.stringify(patch)
  });
}

// ── FETCH RSS FROM A SINGLE URL ──
async function fetchRSS(url: string, country: string, category: string): Promise<Post[]> {
  const posts: Post[] = [];
  try {
    // Try common RSS paths
    const rssUrls = [
      url.endsWith('/') ? `${url}feed` : `${url}/feed`,
      url.endsWith('/') ? `${url}rss` : `${url}/rss`,
      url.endsWith('/') ? `${url}feed.xml` : `${url}/feed.xml`,
      url.endsWith('/') ? `${url}rss.xml` : `${url}/rss.xml`,
    ];

    for (const rssUrl of rssUrls) {
      try {
        const res = await fetch(rssUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NowAgain/1.0; +https://now-again-xi.vercel.app)' },
          signal: AbortSignal.timeout(6000)
        });
        if (!res.ok) continue;
        const xml = await res.text();
        if (!xml.includes('<item') && !xml.includes('<entry')) continue;

        // Parse RSS items
        const items = xml.match(/<item[^>]*>[\s\S]*?<\/item>/gi) ||
                      xml.match(/<entry[^>]*>[\s\S]*?<\/entry>/gi) || [];

        for (const item of items.slice(0, 5)) {
          const title = item.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]><\/title>|<title[^>]*>(.*?)<\/title>/i);
          const desc = item.match(/<description[^>]*><!\[CDATA\[(.*?)\]\]><\/description>|<description[^>]*>(.*?)<\/description>|<summary[^>]*>(.*?)<\/summary>/i);
          const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>|<published>(.*?)<\/published>|<updated>(.*?)<\/updated>/i);
          const link = item.match(/<link[^>]*href="([^"]+)"|<link[^>]*>(.*?)<\/link>/i);

          const titleText = (title?.[1] || title?.[2] || '').replace(/<[^>]+>/g, '').trim();
          const descText = (desc?.[1] || desc?.[2] || desc?.[3] || '').replace(/<[^>]+>/g, '').trim().slice(0, 400);
          const dateText = pubDate?.[1] || pubDate?.[2] || pubDate?.[3] || new Date().toISOString();
          const linkText = link?.[1] || link?.[2] || rssUrl;

          if (titleText.length > 10) {
            posts.push({
              text: descText ? `${titleText}. ${descText}` : titleText,
              source: new URL(url).hostname.replace('www.', ''),
              url: linkText,
              country,
              category,
              timestamp: dateText,
              type: 'rss'
            });
          }
        }

        if (posts.length > 0) break; // Found RSS, stop trying other paths
      } catch { continue; }
    }
  } catch (e) {
    console.error(`RSS error for ${url}:`, e);
  }
  return posts;
}

// ── FETCH FROM HACKER NEWS ──
async function fetchHN(query: string): Promise<Post[]> {
  const posts: Post[] = [];
  try {
    const res = await fetch(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=20`,
      { signal: AbortSignal.timeout(6000) }
    );
    const data = await res.json();
    for (const hit of data.hits || []) {
      if (hit.title) {
        posts.push({
          text: hit.story_text ? `${hit.title}. ${hit.story_text.slice(0, 300)}` : hit.title,
          source: 'Hacker News',
          url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          country: 'Global',
          category: 'Technology & culture',
          timestamp: hit.created_at || new Date().toISOString(),
          type: 'hn'
        });
      }
    }
  } catch (e) { console.error('HN:', e); }
  return posts;
}

// ── FETCH FROM BLUESKY ──
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
      if (post.record?.text?.length > 20) {
        posts.push({
          text: post.record.text,
          source: 'Bluesky',
          url: `https://bsky.app/profile/${post.author?.handle}`,
          country: 'Global',
          category: 'Social media',
          timestamp: post.indexedAt || new Date().toISOString(),
          type: 'bluesky'
        });
      }
    }
  } catch (e) { console.error('Bluesky:', e); }
  return posts;
}

// ── FETCH GOOGLE TRENDS ──
async function fetchGoogleTrends(keyword: string, country: string): Promise<Post[]> {
  const posts: Post[] = [];
  try {
    const geo = country === 'UK' ? 'GB' : country === 'USA' ? 'US' : country.slice(0, 2).toUpperCase();
    const res = await fetch(
      `https://trends.google.com/trends/api/explore?hl=en-US&tz=-60&req={"comparisonItem":[{"keyword":"${encodeURIComponent(keyword)}","geo":"${geo}","time":"today 3-m"}],"category":0,"property":""}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const text = await res.text();
    const clean = text.replace(/^\)\]\}'/, '');
    const data = JSON.parse(clean);
    const value = data?.default?.widgets?.[0]?.request?.restriction?.complexKeywordsRestriction?.keyword?.[0]?.value;
    if (value) {
      posts.push({
        text: `Google Trends signal: "${value}" is trending in ${country} — search interest has been rising over the past 3 months`,
        source: 'Google Trends',
        url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(keyword)}&geo=${geo}`,
        country,
        category: 'Search trends',
        timestamp: new Date().toISOString(),
        type: 'trends'
      });
    }
  } catch (e) { console.error('Trends:', e); }
  return posts;
}

// ── SEND EMAIL ──
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
          <h1 style="font-size:28px;font-weight:400;color:#0e0d0b">Data collection complete.</h1>
          <p style="color:#666;line-height:1.7">NOW-AGAIN has finished collecting conversations for your <strong>${brief.brand}</strong> brief.</p>
          <p style="color:#999;font-style:italic;line-height:1.7">"${brief.question}"</p>
          <ul style="color:#666;line-height:2">
            <li>${postCount} conversations collected</li>
            <li>${(brief.selected_clusters||[]).length} source clusters scanned</li>
            <li>${(brief.markets||[]).join(', ')} markets</li>
          </ul>
          <a href="https://now-again-xi.vercel.app/collecting/${brief.id}"
             style="display:inline-block;background:#0e0d0b;color:#f5f3ee;padding:14px 28px;border-radius:6px;text-decoration:none;font-family:sans-serif;font-size:14px;margin-top:16px">
            View results →
          </a>
        </div>`
      })
    });
  } catch (e) { console.error('Email:', e); }
}

// ── MAIN HANDLER ──
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

    // Initialise progress
    await updateBrief(briefId, {
      status: 'collecting',
      collection_progress: {
        total_posts: 0, sources_scraped: 0, sources_total: 0,
        log: [`Starting collection for ${brief.brand}...`]
      }
    });

    let allPosts: Post[] = [];
    let log: string[] = [`Starting collection for ${brief.brand}...`];
    let sourcesScraped = 0;

    // ── STEP 1: RSS from curated sources ──
    if (clusters.length > 0 && dbMarkets.length > 0) {
      const catList = clusters.map((c: string) => `"${c}"`).join(',');
      const mktList = dbMarkets.map((m: string) => `"${m}"`).join(',');

      const sourcesRes = await fetch(
        `${SUPABASE_URL}/rest/v1/sources?country=in.(${mktList})&category=in.(${catList})&select=url,country,category&limit=200`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
      );
      const sources = await sourcesRes.json();

      log = [...log, `Found ${sources.length} curated sources to scan`];
      await updateBrief(briefId, {
        collection_progress: { total_posts: 0, sources_scraped: 0, sources_total: sources.length + queries.length * 2, log }
      });

      // Fetch RSS in batches of 10 concurrently
      for (let i = 0; i < Math.min(sources.length, 100); i += 10) {
        const batch = sources.slice(i, i + 10);
        const results = await Promise.all(
          batch.map((s: any) => fetchRSS(s.url, s.country, s.category))
        );
        const batchPosts = results.flat();
        allPosts = [...allPosts, ...batchPosts];
        sourcesScraped += batch.length;

        if (batchPosts.length > 0) {
          log = [...log, `RSS batch ${Math.floor(i/10)+1}: +${batchPosts.length} posts from ${batch.map((s:any) => new URL(s.url).hostname.replace('www.','')).slice(0,3).join(', ')}`];
        }

        await updateBrief(briefId, {
          collection_progress: {
            total_posts: allPosts.length,
            sources_scraped: sourcesScraped,
            sources_total: sources.length + queries.length * 2,
            log: log.slice(-20)
          }
        });
      }
    }

    // ── STEP 2: HN + Bluesky for each query ──
    for (const q of queries) {
      log = [...log, `Searching HN + Bluesky: "${q.label}"`];
      const [hnPosts, bskyPosts] = await Promise.all([
        fetchHN(q.query),
        fetchBluesky(q.query)
      ]);
      allPosts = [...allPosts, ...hnPosts, ...bskyPosts];
      sourcesScraped += 2;

      await updateBrief(briefId, {
        collection_progress: {
          total_posts: allPosts.length,
          sources_scraped: sourcesScraped,
          sources_total: sourcesScraped,
          log: [...log, `+${hnPosts.length + bskyPosts.length} posts`].slice(-20)
        }
      });
    }

    // ── STEP 3: Google Trends for top keywords ──
    const mainKeyword = (brief.category || '').split(' ').slice(0, 2).join(' ');
    for (const market of markets.slice(0, 2)) {
      const trendPosts = await fetchGoogleTrends(mainKeyword, market);
      allPosts = [...allPosts, ...trendPosts];
    }

    // Deduplicate
    const seen = new Set<string>();
    const uniquePosts = allPosts.filter(p => {
      const key = p.text.slice(0, 100);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    log = [...log, `Collection complete — ${uniquePosts.length} unique posts from ${new Set(uniquePosts.map(p => p.source)).size} sources`];

    // Save as structured JSON array
    await updateBrief(briefId, {
      status: 'collected',
      post_count: uniquePosts.length,
      collected_posts: uniquePosts.map(p => p.text),
      collected_posts_full: uniquePosts,
      collection_progress: {
        total_posts: uniquePosts.length,
        sources_scraped: sourcesScraped,
        sources_total: sourcesScraped,
        log: log.slice(-30)
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
