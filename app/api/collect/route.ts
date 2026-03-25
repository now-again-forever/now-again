import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const RESEND_KEY = process.env.RESEND_API_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY;

interface Post {
  text: string;
  source: string;
  url: string;
  country: string;
  category: string;
  timestamp: string;
  type: string;
  query_label?: string;
}

const MARKET_MAP: Record<string, string> = {
  'UK': 'UK', 'FR': 'France', 'ES': 'Spain', 'DE': 'Germany',
  'PL': 'Poland', 'TR': 'Turkey', 'US': 'USA', 'Global': 'Global English',
  'France': 'France', 'Spain': 'Spain', 'Germany': 'Germany',
  'USA': 'USA', 'Poland': 'Poland', 'Turkey': 'Turkey',
};

const MARKET_TO_ISO: Record<string, string> = {
  'UK': 'gb', 'FR': 'fr', 'ES': 'es', 'DE': 'de',
  'PL': 'pl', 'TR': 'tr', 'US': 'us', 'USA': 'us',
  'France': 'fr', 'Spain': 'es', 'Germany': 'de',
};

const MARKET_TO_LANG: Record<string, string> = {
  'UK': 'en', 'US': 'en', 'USA': 'en', 'FR': 'fr', 'France': 'fr',
  'ES': 'es', 'Spain': 'es', 'DE': 'de', 'Germany': 'de',
  'PL': 'pl', 'TR': 'tr', 'Global': 'en',
};

async function updateBrief(id: string, patch: object) {
  await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify(patch)
  });
}

// ── 1. SCRAPE CURATED SOURCES ──
async function scrapePage(url: string, country: string, category: string): Promise<Post[]> {
  const posts: Post[] = [];
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NowAgain/1.0)' },
      signal: AbortSignal.timeout(7000)
    });
    if (!res.ok) return posts;
    const html = await res.text();
    const clean = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();
    const hostname = (() => { try { return new URL(url).hostname.replace('www.', ''); } catch { return url; } })();

    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const title = titleMatch ? clean(titleMatch[1]) : '';

    const headings = (html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi) || [])
      .map(h => clean(h)).filter(t => t.length > 15 && t.length < 200).slice(0, 4);

    const paras = (html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [])
      .map(p => clean(p))
      .filter(t => t.length > 80 && t.length < 500 && !t.toLowerCase().includes('cookie') && !t.toLowerCase().includes('privacy policy') && !t.toLowerCase().includes('subscribe'))
      .slice(0, 4);

    const combined = [title, ...headings].filter(Boolean).join('. ');
    if (combined.length > 20) {
      posts.push({ text: combined.slice(0, 600), source: hostname, url, country, category, timestamp: new Date().toISOString(), type: 'web' });
    }

    for (const p of paras) {
      posts.push({ text: p, source: hostname, url, country, category, timestamp: new Date().toISOString(), type: 'web' });
    }
  } catch { /* silent fail */ }
  return posts;
}

// ── 2a. HACKER NEWS ──
async function fetchHN(query: string, label: string): Promise<Post[]> {
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
        source: 'Hacker News', url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        country: 'Global', category: 'Technology & culture',
        timestamp: hit.created_at || new Date().toISOString(), type: 'hn', query_label: label
      });
    }
  } catch (e) { console.error('HN:', e); }
  return posts;
}

// ── 2b. BLUESKY ──
async function fetchBluesky(query: string, label: string, lang?: string): Promise<Post[]> {
  const posts: Post[] = [];
  try {
    const simple = query.replace(/\(|\)|AND|OR|NOT|NEAR\/\d+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
    const langParam = lang && lang !== 'en' ? `&lang=${lang}` : '';
    const res = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(simple)}&limit=25${langParam}`,
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(6000) }
    );
    const text = await res.text();
    if (!text.startsWith('{')) return posts;
    const data = JSON.parse(text);
    for (const post of data.posts || []) {
      if (post.record?.text?.length > 20) posts.push({
        text: post.record.text,
        source: 'Bluesky', url: `https://bsky.app/profile/${post.author?.handle}`,
        country: 'Global', category: 'Social media',
        timestamp: post.indexedAt || new Date().toISOString(), type: 'bluesky', query_label: label
      });
    }
  } catch (e) { console.error('Bluesky:', e); }
  return posts;
}

// ── 2c. MASTODON ──
async function fetchMastodon(query: string, label: string): Promise<Post[]> {
  const posts: Post[] = [];
  try {
    const res = await fetch(
      `https://mastodon.social/api/v2/search?q=${encodeURIComponent(query)}&type=statuses&limit=20&resolve=false`,
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(6000) }
    );
    const data = await res.json();
    for (const status of data.statuses || []) {
      const text = status.content?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text && text.length > 20) posts.push({
        text, source: 'Mastodon',
        url: status.url || 'https://mastodon.social',
        country: 'Global', category: 'Social media',
        timestamp: status.created_at || new Date().toISOString(), type: 'mastodon', query_label: label
      });
    }
  } catch (e) { console.error('Mastodon:', e); }
  return posts;
}

// ── 3. GOOGLE AUTOCOMPLETE ──
async function fetchGoogleAutocomplete(keyword: string, market: string): Promise<Post[]> {
  const posts: Post[] = [];
  try {
    const gl = MARKET_TO_ISO[market] || 'us';
    const hl = MARKET_TO_LANG[market] || 'en';
    const res = await fetch(
      `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(keyword)}&gl=${gl}&hl=${hl}`,
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json();
    const suggestions = data[1] || [];
    if (suggestions.length > 0) {
      posts.push({
        text: `Google search suggestions for "${keyword}" in ${market}: people are searching for "${suggestions.slice(0, 6).join('", "')}"`,
        source: 'Google Autocomplete', url: `https://google.com/search?q=${encodeURIComponent(keyword)}`,
        country: market, category: 'Search intent',
        timestamp: new Date().toISOString(), type: 'google_autocomplete'
      });
    }
  } catch (e) { console.error('Autocomplete:', e); }
  return posts;
}

// ── 4. NEWSAPI ──
async function fetchNews(query: string, label: string, markets: string[]): Promise<Post[]> {
  const posts: Post[] = [];
  if (!NEWS_API_KEY) return posts;
  try {
    const iso = markets.map((m: string) => MARKET_TO_ISO[m]).filter(Boolean).join(',');
    const simple = query.replace(/\(|\)|AND|OR|NOT|NEAR\/\d+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 5).join(' ');
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(simple)}&language=en${iso ? `&domains=` : ''}&sortBy=relevancy&pageSize=10&apiKey=${NEWS_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const data = await res.json();
    for (const article of data.articles || []) {
      if (article.title && !article.title.includes('[Removed]')) {
        posts.push({
          text: article.description ? `${article.title}. ${article.description}` : article.title,
          source: article.source?.name || 'News',
          url: article.url || '',
          country: markets[0] || 'Global',
          category: 'News & journalism',
          timestamp: article.publishedAt || new Date().toISOString(),
          type: 'news', query_label: label
        });
      }
    }
  } catch (e) { console.error('NewsAPI:', e); }
  return posts;
}

// ── 5. WIKIPEDIA TRENDING ──
async function fetchWikipedia(keyword: string, market: string): Promise<Post[]> {
  const posts: Post[] = [];
  try {
    const lang = MARKET_TO_LANG[market] || 'en';
    const res = await fetch(
      `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(keyword)}&srlimit=5&format=json&origin=*`,
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json();
    for (const result of data.query?.search || []) {
      const snippet = result.snippet?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (snippet && snippet.length > 30) {
        posts.push({
          text: `Wikipedia: "${result.title}" — ${snippet}`,
          source: 'Wikipedia',
          url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(result.title)}`,
          country: market, category: 'Cultural reference',
          timestamp: new Date().toISOString(), type: 'wikipedia'
        });
      }
    }
  } catch (e) { console.error('Wikipedia:', e); }
  return posts;
}

// ── SEND EMAIL ──
async function sendEmail(brief: any, postCount: number, sourceCount: number) {
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
          <p style="color:#666;line-height:1.7">NOW-AGAIN has finished collecting for <strong>${brief.brand}</strong>.</p>
          <p style="color:#999;font-style:italic">"${brief.question}"</p>
          <ul style="color:#666;line-height:2.2">
            <li><strong>${postCount}</strong> conversations collected</li>
            <li><strong>${sourceCount}</strong> distinct sources</li>
            <li>${(brief.markets||[]).join(', ')} markets</li>
            <li>${(brief.selected_clusters||[]).join(', ')}</li>
          </ul>
          <a href="https://now-again-xi.vercel.app/collecting/${brief.id}"
             style="display:inline-block;background:#0e0d0b;color:#f5f3ee;padding:14px 28px;border-radius:6px;text-decoration:none;font-family:sans-serif;font-size:14px;margin-top:8px">
            Generate insights →
          </a>
        </div>`
      })
    });
  } catch (e) { console.error('Email:', e); }
}

// ── MAIN ──
export async function POST(req: NextRequest) {
  let briefId = '';
  try {
    briefId = (await req.json()).briefId;
    const briefRes = await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${briefId}&select=*`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const brief = (await briefRes.json())[0];
    if (!brief) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const queries: {label:string,query:string}[] = brief.selected_queries || [];
    const clusters: string[] = brief.selected_clusters || [];
    const markets: string[] = brief.markets || [];
    const dbMarkets = markets.map((m: string) => MARKET_MAP[m] || m);

    let allPosts: Post[] = [];
    let log: string[] = [`Starting full collection for ${brief.brand} across ${markets.join(', ')}...`];

    await updateBrief(briefId, {
      status: 'collecting',
      collection_progress: { total_posts: 0, sources_scraped: 0, sources_total: 100, log }
    });

    const saveProgress = async (extra?: string) => {
      if (extra) log = [...log, extra];
      await updateBrief(briefId, {
        collection_progress: {
          total_posts: allPosts.length,
          sources_scraped: allPosts.length,
          sources_total: 100,
          log: log.slice(-25)
        }
      });
    };

    // ── LAYER 1: Curated source scraping ──
    if (clusters.length > 0 && dbMarkets.length > 0) {
      const catList = clusters.map((c: string) => `"${c}"`).join(',');
      const mktList = dbMarkets.map((m: string) => `"${m}"`).join(',');
      const srcRes = await fetch(
        `${SUPABASE_URL}/rest/v1/sources?country=in.(${mktList})&category=in.(${catList})&select=url,country,category&limit=80`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
      );
      const sources = await srcRes.json();
      log = [...log, `Layer 1: Scraping ${sources.length} curated sources (${clusters.join(', ')})`];
      await saveProgress();

      for (let i = 0; i < sources.length; i += 8) {
        const batch = sources.slice(i, i + 8);
        const results = await Promise.all(batch.map((s: any) => scrapePage(s.url, s.country, s.category)));
        const batchPosts = results.flat();
        allPosts = [...allPosts, ...batchPosts];
        const successful = batch.filter((_: any, j: number) => results[j].length > 0).map((s: any) => { try { return new URL(s.url).hostname.replace('www.',''); } catch { return ''; } }).filter(Boolean);
        if (successful.length > 0) await saveProgress(`+${batchPosts.length} from ${successful.slice(0,3).join(', ')}`);
      }
    }

    // ── LAYER 2: Social APIs per query ──
    log = [...log, `Layer 2: Running ${queries.length} queries across HN, Bluesky, Mastodon...`];
    await saveProgress();

    for (const q of queries) {
      const lang = MARKET_TO_LANG[markets[0]] || 'en';
      const [hn, bsky, masto] = await Promise.all([
        fetchHN(q.query, q.label),
        fetchBluesky(q.query, q.label, lang),
        fetchMastodon(q.query, q.label)
      ]);
      allPosts = [...allPosts, ...hn, ...bsky, ...masto];
      await saveProgress(`"${q.label}": +${hn.length}HN +${bsky.length}Bluesky +${masto.length}Mastodon`);
    }

    // ── LAYER 3: Google Autocomplete per market ──
    log = [...log, `Layer 3: Google search intent signals...`];
    const keywords = [brief.category, ...(brief.question || '').split(' ').filter((w: string) => w.length > 5).slice(0, 2)];
    for (const market of markets.slice(0, 3)) {
      for (const kw of keywords.slice(0, 2)) {
        const auto = await fetchGoogleAutocomplete(kw, market);
        allPosts = [...allPosts, ...auto];
      }
    }
    await saveProgress(`+${markets.length * 2} autocomplete signals`);

    // ── LAYER 4: NewsAPI ──
    if (NEWS_API_KEY && queries.length > 0) {
      log = [...log, `Layer 4: News coverage...`];
      for (const q of queries.slice(0, 3)) {
        const news = await fetchNews(q.query, q.label, markets);
        allPosts = [...allPosts, ...news];
      }
      await saveProgress(`+news articles collected`);
    }

    // ── LAYER 5: Wikipedia cultural context ──
    log = [...log, `Layer 5: Cultural context from Wikipedia...`];
    const wikiKeywords = brief.category.split(' ').filter((w: string) => w.length > 4).slice(0, 2);
    for (const market of markets.slice(0, 2)) {
      for (const kw of wikiKeywords) {
        const wiki = await fetchWikipedia(kw, market);
        allPosts = [...allPosts, ...wiki];
      }
    }
    await saveProgress(`+Wikipedia context`);

    // Deduplicate
    const seen = new Set<string>();
    const uniquePosts = allPosts.filter(p => {
      const key = p.text.slice(0, 100).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const sourceNames = [...new Set(uniquePosts.map(p => p.source))];
    const countries = [...new Set(uniquePosts.map(p => p.country).filter(c => c !== 'Global'))];
    log = [...log, `Complete — ${uniquePosts.length} posts from ${sourceNames.length} sources: ${sourceNames.slice(0,6).join(', ')}`];
    if (countries.length > 0) log = [...log, `Markets represented: ${countries.join(', ')}`];

    await updateBrief(briefId, {
      status: 'collected',
      post_count: uniquePosts.length,
      collected_posts: uniquePosts.map(p => `[${p.source}][${p.country}] ${p.text}`),
      collected_posts_full: uniquePosts,
      collection_progress: {
        total_posts: uniquePosts.length,
        sources_scraped: uniquePosts.length,
        sources_total: uniquePosts.length,
        log: log.slice(-30)
      }
    });

    await sendEmail(brief, uniquePosts.length, sourceNames.length);
    return NextResponse.json({ success: true, postCount: uniquePosts.length, sources: sourceNames.length });

  } catch (err) {
    console.error('Collect error:', err);
    if (briefId) await updateBrief(briefId, { status: 'failed' });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
