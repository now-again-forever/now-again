import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const RESEND_KEY = process.env.RESEND_API_KEY;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const NEWSDATA_KEY = process.env.NEWSDATA_KEY;

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
  'UK': 'gb', 'FR': 'fr', 'ES': 'es', 'DE': 'de', 'PL': 'pl', 'TR': 'tr',
  'US': 'us', 'USA': 'us', 'France': 'fr', 'Spain': 'es', 'Germany': 'de',
};
const MARKET_TO_LANG: Record<string, string> = {
  'UK': 'en', 'US': 'en', 'USA': 'en', 'FR': 'fr', 'France': 'fr',
  'ES': 'es', 'Spain': 'es', 'DE': 'de', 'Germany': 'de', 'PL': 'pl', 'TR': 'tr', 'Global': 'en',
};
const MARKET_TO_YT: Record<string, string> = {
  'UK': 'GB', 'US': 'US', 'USA': 'US', 'FR': 'FR', 'France': 'FR',
  'ES': 'ES', 'Spain': 'ES', 'DE': 'DE', 'Germany': 'DE', 'PL': 'PL', 'TR': 'TR',
};

// ── CONVERSATION DETECTION ──
// Patterns that indicate a page is likely to have real human conversations
const CONVERSATION_PATTERNS = [
  /forum/i, /discuss/i, /thread/i, /comment/i, /community/i,
  /reddit\.com/i, /quora\.com/i, /stackexchange/i, /stackoverflow/i,
  /tripadvisor/i, /trustpilot/i, /yelp\.com/i, /mumsnet/i,
  /facebook\.com\/groups/i, /groups\.google/i, /answers\./i,
  /\/qa\//i, /\/questions\//i, /\/reviews\//i, /\/opinions\//i,
  /netmums/i, /thestudentroom/i, /pistonheads/i, /moneysavingexpert/i,
];

const NOISE_PATTERNS = [
  /cookie/i, /privacy-policy/i, /terms-of-service/i, /sitemap/i,
  /wp-admin/i, /login/i, /signup/i, /register/i, /checkout/i,
  /\.pdf$/i, /\.jpg$/i, /\.png$/i, /\.gif$/i,
];

function isConversationRich(url: string): boolean {
  return CONVERSATION_PATTERNS.some(p => p.test(url));
}

function isNoise(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('cookie') || lower.includes('privacy policy') ||
    lower.includes('subscribe to') || lower.includes('sign up') ||
    lower.includes('terms and conditions') || text.length < 40;
}

async function updateBrief(id: string, patch: object) {
  await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify(patch)
  });
}

function simplifyQuery(query: string): string {
  if (query.length < 60 && !query.includes('(') && !query.includes(' OR ')) return query;
  const quoted = (query.match(/"([^"]+)"/g) || []).map((s: string) => s.replace(/"/g, ''));
  if (quoted.length > 0) return quoted.slice(0, 3).join(' ');
  return query.replace(/\b(AND|OR|NOT|NEAR|lang|source[a-z]*|wordcount)\b[^\s]*/gi, ' ')
    .replace(/[()[\]+]/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').filter((w: string) => w.length > 4 && !w.includes(':')).slice(0, 5).join(' ');
}

// ── CORE SCRAPER: Extract conversations from a URL ──
async function scrapeConversations(url: string, country: string, category: string, queryLabel?: string): Promise<Post[]> {
  const posts: Post[] = [];
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return posts;
    const html = await res.text();
    const hostname = (() => { try { return new URL(url).hostname.replace('www.', ''); } catch { return url; } })();

    const clean = (s: string) => s
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z#0-9]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Extract from multiple conversation-rich HTML patterns
    const extractors = [
      // Forum posts and comments
      html.match(/<(?:article|div|li|p)[^>]*class="[^"]*(?:comment|post|reply|message|thread|discussion|review|answer)[^"]*"[^>]*>([\s\S]*?)<\/(?:article|div|li|p)>/gi) || [],
      // Blockquotes (often used for forum quotes)
      html.match(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi) || [],
      // Paragraphs with substance
      html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [],
      // List items (forum threads, Q&A)
      html.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || [],
    ];

    const seen = new Set<string>();
    for (const matches of extractors) {
      for (const match of matches.slice(0, 30)) {
        const text = clean(match);
        if (text.length > 60 && text.length < 600 && !isNoise(text)) {
          const key = text.slice(0, 60);
          if (!seen.has(key)) {
            seen.add(key);
            posts.push({
              text,
              source: hostname,
              url,
              country,
              category,
              timestamp: new Date().toISOString(),
              type: 'web',
              query_label: queryLabel
            });
          }
        }
      }
      if (posts.length >= 8) break;
    }

    // Also extract page title + headings as context
    const title = clean(html.match(/<title[^>]*>(.*?)<\/title>/i)?.[1] || '');
    const h1 = clean(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');
    if (title && title.length > 15 && title.length < 200) {
      posts.unshift({ text: title, source: hostname, url, country, category, timestamp: new Date().toISOString(), type: 'web_title' });
    }

  } catch { /* silent — many sites block */ }
  return posts;
}

// ── EXTRACT OUTBOUND LINKS (for rabbit hole exploration) ──
function extractConversationLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const base = (() => { try { return new URL(baseUrl).origin; } catch { return ''; } })();
  const hrefs = html.match(/href="([^"]+)"/gi) || [];

  for (const href of hrefs) {
    const url = href.replace(/href="/i, '').replace(/"$/, '');
    try {
      const full = url.startsWith('http') ? url : `${base}${url.startsWith('/') ? url : `/${url}`}`;
      if (full.startsWith('http') &&
          !NOISE_PATTERNS.some(p => p.test(full)) &&
          isConversationRich(full) &&
          !links.includes(full)) {
        links.push(full);
      }
    } catch { }
  }
  return links.slice(0, 5);
}

// ── SERP DISCOVERY: Find relevant URLs via Google ──
async function serpDiscover(query: string, market: string, label: string): Promise<string[]> {
  if (!SERPAPI_KEY) return [];
  try {
    const gl = MARKET_TO_ISO[market] || 'us';
    const hl = MARKET_TO_LANG[market] || 'en';
    const simple = simplifyQuery(query);
    const res = await fetch(
      `https://serpapi.com/search.json?q=${encodeURIComponent(simple)}&gl=${gl}&hl=${hl}&num=10&api_key=${SERPAPI_KEY}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await res.json();
    return (data.organic_results || []).map((r: any) => r.link).filter(Boolean).slice(0, 10);
  } catch (e) { console.error('SerpAPI:', e); }
  return [];
}

// ── YOUTUBE COMMENTS ──
async function fetchYouTube(query: string, label: string, markets: string[]): Promise<Post[]> {
  const posts: Post[] = [];
  if (!YOUTUBE_API_KEY) return posts;
  try {
    const regionCode = MARKET_TO_YT[markets[0]] || 'US';
    const lang = MARKET_TO_LANG[markets[0]] || 'en';
    const simple = simplifyQuery(query);
    const searchRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(simple)}&type=video&maxResults=5&relevanceLanguage=${lang}&regionCode=${regionCode}&key=${YOUTUBE_API_KEY}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const searchData = await searchRes.json();
    const videoIds = (searchData.items || []).map((v: any) => v.id?.videoId).filter(Boolean);
    for (const videoId of videoIds.slice(0, 4)) {
      try {
        const commentsRes = await fetch(
          `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=25&order=relevance&key=${YOUTUBE_API_KEY}`,
          { signal: AbortSignal.timeout(8000) }
        );
        const commentsData = await commentsRes.json();
        for (const item of commentsData.items || []) {
          const text = item.snippet?.topLevelComment?.snippet?.textDisplay?.replace(/<[^>]+>/g, '');
          if (text && text.length > 30) {
            posts.push({
              text: text.slice(0, 400),
              source: 'YouTube',
              url: `https://youtube.com/watch?v=${videoId}`,
              country: markets[0] || 'Global',
              category: 'Social media',
              timestamp: item.snippet?.topLevelComment?.snippet?.publishedAt || new Date().toISOString(),
              type: 'youtube',
              query_label: label
            });
          }
        }
      } catch { }
    }
  } catch (e) { console.error('YouTube:', e); }
  return posts;
}

// ── TAVILY DEEP SEARCH ──
async function fetchTavily(query: string, label: string): Promise<Post[]> {
  const posts: Post[] = [];
  if (!TAVILY_API_KEY) return posts;
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: TAVILY_API_KEY, query: simplifyQuery(query), search_depth: 'basic', max_results: 8, include_raw_content: false }),
      signal: AbortSignal.timeout(10000)
    });
    const data = await res.json();
    for (const result of data.results || []) {
      if (result.content && result.content.length > 50) {
        posts.push({
          text: result.content.slice(0, 400),
          source: result.url ? (() => { try { return new URL(result.url).hostname.replace('www.', ''); } catch { return 'Web'; } })() : 'Web',
          url: result.url || '',
          country: 'Global',
          category: 'Web',
          timestamp: result.published_date || new Date().toISOString(),
          type: 'tavily',
          query_label: label
        });
      }
    }
  } catch (e) { console.error('Tavily:', e); }
  return posts;
}

// ── HACKER NEWS ──
async function fetchHN(query: string, label: string): Promise<Post[]> {
  const posts: Post[] = [];
  try {
    const res = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(simplifyQuery(query))}&tags=story&hitsPerPage=15`, { signal: AbortSignal.timeout(6000) });
    const data = await res.json();
    for (const hit of data.hits || []) {
      if (hit.title) posts.push({ text: hit.story_text ? `${hit.title}. ${hit.story_text.slice(0, 200)}` : hit.title, source: 'Hacker News', url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`, country: 'Global', category: 'Tech culture', timestamp: hit.created_at || new Date().toISOString(), type: 'hn', query_label: label });
    }
  } catch (e) { console.error('HN:', e); }
  return posts;
}

// ── BLUESKY ──
async function fetchBluesky(query: string, label: string, lang?: string): Promise<Post[]> {
  const posts: Post[] = [];
  try {
    const langParam = lang && lang !== 'en' ? `&lang=${lang}` : '';
    const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(simplifyQuery(query))}&limit=20${langParam}`, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(6000) });
    const text = await res.text();
    if (!text.startsWith('{')) return posts;
    const data = JSON.parse(text);
    for (const post of data.posts || []) {
      if (post.record?.text?.length > 20) posts.push({ text: post.record.text, source: 'Bluesky', url: `https://bsky.app/profile/${post.author?.handle}`, country: 'Global', category: 'Social media', timestamp: post.indexedAt || new Date().toISOString(), type: 'bluesky', query_label: label });
    }
  } catch (e) { console.error('Bluesky:', e); }
  return posts;
}

// ── NEWSDATA ──
async function fetchNewsdata(query: string, label: string, markets: string[]): Promise<Post[]> {
  const posts: Post[] = [];
  if (!NEWSDATA_KEY) return posts;
  try {
    const lang = MARKET_TO_LANG[markets[0]] || 'en';
    const country = MARKET_TO_ISO[markets[0]] || '';
    const res = await fetch(`https://newsdata.io/api/1/news?apikey=${NEWSDATA_KEY}&q=${encodeURIComponent(simplifyQuery(query))}&language=${lang}${country ? `&country=${country}` : ''}&size=10`, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    for (const article of data.results || []) {
      if (article.title && !article.title.includes('[Removed]')) {
        posts.push({ text: article.description ? `${article.title}. ${article.description}` : article.title, source: article.source_id || 'News', url: article.link || '', country: article.country?.[0] || markets[0] || 'Global', category: 'News', timestamp: article.pubDate || new Date().toISOString(), type: 'newsdata', query_label: label });
      }
    }
  } catch (e) { console.error('Newsdata:', e); }
  return posts;
}

// ── GOOGLE AUTOCOMPLETE ──
async function fetchAutocomplete(keyword: string, market: string): Promise<Post[]> {
  const posts: Post[] = [];
  try {
    const gl = MARKET_TO_ISO[market] || 'us';
    const hl = MARKET_TO_LANG[market] || 'en';
    const res = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(keyword)}&gl=${gl}&hl=${hl}`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    const suggestions = data[1] || [];
    if (suggestions.length > 0) posts.push({ text: `People in ${market} search for: "${suggestions.slice(0, 6).join('", "')}"`, source: 'Google Trends', url: `https://google.com/search?q=${encodeURIComponent(keyword)}`, country: market, category: 'Search intent', timestamp: new Date().toISOString(), type: 'autocomplete' });
  } catch { }
  return posts;
}

// ── WIKIPEDIA ──
async function fetchWikipedia(keyword: string, market: string): Promise<Post[]> {
  const posts: Post[] = [];
  try {
    const lang = MARKET_TO_LANG[market] || 'en';
    const res = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(keyword)}&srlimit=3&format=json&origin=*`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return posts;
    const text = await res.text();
    if (!text.startsWith('{')) return posts;
    const data = JSON.parse(text);
    for (const result of data.query?.search || []) {
      const snippet = result.snippet?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (snippet && snippet.length > 30) posts.push({ text: `${result.title}: ${snippet}`, source: 'Wikipedia', url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(result.title)}`, country: market, category: 'Cultural reference', timestamp: new Date().toISOString(), type: 'wikipedia' });
    }
  } catch { }
  return posts;
}

// ── EMAIL ──
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
        html: `<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;padding:40px 20px"><h1 style="font-size:28px;font-weight:400;color:#0e0d0b">Data collection complete.</h1><p style="color:#666;line-height:1.7">NOW-AGAIN has finished collecting for <strong>${brief.brand}</strong>.</p><p style="color:#999;font-style:italic">"${brief.question}"</p><ul style="color:#666;line-height:2.2"><li><strong>${postCount}</strong> conversations from <strong>${sourceCount}</strong> sources</li><li>${(brief.markets||[]).join(', ')} markets</li></ul><a href="https://now-again-xi.vercel.app/collecting/${brief.id}" style="display:inline-block;background:#0e0d0b;color:#f5f3ee;padding:14px 28px;border-radius:6px;text-decoration:none;font-family:sans-serif;font-size:14px;margin-top:8px">Generate insights →</a></div>`
      })
    });
  } catch { }
}

// ── MAIN COLLECTION AGENT ──
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
    const primaryMarket = markets[0] || 'Global';
    const lang = MARKET_TO_LANG[primaryMarket] || 'en';

    let allPosts: Post[] = [];
    let log: string[] = [`Starting deep collection for ${brief.brand} — ${markets.join(', ')}...`];
    const scrapedUrls = new Set<string>();

    await updateBrief(briefId, { status: 'collecting', collection_progress: { total_posts: 0, sources_scraped: 0, sources_total: 100, log } });

    const save = async (msg?: string) => {
      if (msg) log = [...log, msg];
      await updateBrief(briefId, { collection_progress: { total_posts: allPosts.length, sources_scraped: allPosts.length, sources_total: 100, log: log.slice(-30) } });
    };

    const addPosts = (newPosts: Post[]) => { allPosts = [...allPosts, ...newPosts]; };

    // ═══════════════════════════════════════
    // PHASE 1: CURATED SOURCE LIBRARY
    // Scrape curated URLs + follow their conversation links
    // ═══════════════════════════════════════
    if (clusters.length > 0 && dbMarkets.length > 0) {
      const catList = clusters.map((c: string) => `"${c}"`).join(',');
      const mktList = dbMarkets.map((m: string) => `"${m}"`).join(',');
      const srcRes = await fetch(`${SUPABASE_URL}/rest/v1/sources?country=in.(${mktList})&category=in.(${catList})&select=url,country,category&limit=80`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
      const srcRaw = await srcRes.json();
      const sources = Array.isArray(srcRaw) ? srcRaw : [];
      await save(`Phase 1: Exploring ${sources.length} curated sources + following conversation links...`);

      for (let i = 0; i < sources.length; i += 6) {
        const batch = sources.slice(i, i + 6);
        const results = await Promise.all(batch.map(async (s: any) => {
          if (scrapedUrls.has(s.url)) return [];
          scrapedUrls.add(s.url);
          const posts = await scrapeConversations(s.url, s.country, s.category);

          // Rabbit hole: if page has conversation links, follow them
          if (posts.length > 0) {
            try {
              const res = await fetch(s.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) });
              const html = await res.text();
              const convLinks = extractConversationLinks(html, s.url);
              for (const link of convLinks.slice(0, 2)) {
                if (!scrapedUrls.has(link)) {
                  scrapedUrls.add(link);
                  const rabbitPosts = await scrapeConversations(link, s.country, s.category);
                  posts.push(...rabbitPosts.slice(0, 4));
                }
              }
            } catch { }
          }
          return posts;
        }));

        const batchPosts = results.flat();
        addPosts(batchPosts);
        if (batchPosts.length > 0) {
          const sites = batch.map((s: any) => { try { return new URL(s.url).hostname.replace('www.',''); } catch { return ''; } }).filter(Boolean);
          await save(`+${batchPosts.length} from ${sites.slice(0,3).join(', ')}`);
        }
      }
    }

    // ═══════════════════════════════════════
    // PHASE 2: DYNAMIC WEB DISCOVERY via SerpAPI
    // For each query, find what Google surfaces then scrape those pages
    // ═══════════════════════════════════════
    if (SERPAPI_KEY) {
      await save(`Phase 2: Dynamic web discovery — searching Google for each query...`);
      const broadTerms = [brief.category, ...(brief.question||'').replace(/[?"]/g,'').split(' ').filter((w:string) => w.length > 5).slice(0,2)];
      const discoveryQueries = [...queries.slice(0, 5), ...broadTerms.map(t => ({ label: t, query: t }))];

      for (const q of discoveryQueries) {
        const urls = await serpDiscover(q.query, primaryMarket, q.label);
        if (urls.length === 0) continue;
        await save(`  "${q.label}": found ${urls.length} pages to explore`);

        const results = await Promise.all(urls.map(async (url: string) => {
          if (scrapedUrls.has(url)) return [];
          scrapedUrls.add(url);
          const posts = await scrapeConversations(url, primaryMarket, 'Web discovery', q.label);

          // One level of rabbit hole from discovered pages
          if (posts.length > 2 && isConversationRich(url)) {
            try {
              const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) });
              const html = await res.text();
              const deeper = extractConversationLinks(html, url);
              for (const deepUrl of deeper.slice(0, 2)) {
                if (!scrapedUrls.has(deepUrl)) {
                  scrapedUrls.add(deepUrl);
                  const deepPosts = await scrapeConversations(deepUrl, primaryMarket, 'Web discovery', q.label);
                  posts.push(...deepPosts.slice(0, 3));
                }
              }
            } catch { }
          }
          return posts;
        }));

        const found = results.flat();
        addPosts(found);
        if (found.length > 0) await save(`  +${found.length} conversations from discovered pages`);
      }
    }

    // ═══════════════════════════════════════
    // PHASE 3: SOCIAL & API SOURCES
    // YouTube, Bluesky, HN, Tavily, Newsdata
    // ═══════════════════════════════════════
    await save(`Phase 3: Social platforms and APIs...`);
    const allQueryInputs = [...queries, ...[brief.category, brief.question?.split(' ').filter((w:string) => w.length > 5).slice(0,3).join(' ')].filter(Boolean).map((t:string) => ({ label: t, query: t }))];

    for (const q of allQueryInputs.slice(0, 8)) {
      const [yt, bsky, hn, tv, nd] = await Promise.all([
        fetchYouTube(q.query, q.label, markets),
        fetchBluesky(q.query, q.label, lang),
        fetchHN(q.query, q.label),
        fetchTavily(q.query, q.label),
        fetchNewsdata(q.query, q.label, markets),
      ]);
      const total = yt.length + bsky.length + hn.length + tv.length + nd.length;
      addPosts([...yt, ...bsky, ...hn, ...tv, ...nd]);
      if (total > 0) await save(`"${q.label}": +${yt.length}YT +${bsky.length}Bsky +${hn.length}HN +${tv.length}Tavily +${nd.length}News`);
    }

    // ═══════════════════════════════════════
    // PHASE 4: SEARCH INTENT & CONTEXT
    // Autocomplete + Wikipedia
    // ═══════════════════════════════════════
    await save(`Phase 4: Search intent signals...`);
    const kwds = [brief.category, ...(brief.question||'').split(' ').filter((w:string) => w.length > 5).slice(0,2)];
    for (const market of markets.slice(0,3)) {
      for (const kw of kwds.slice(0,2)) {
        const auto = await fetchAutocomplete(kw, market);
        addPosts(auto);
      }
    }
    for (const market of markets.slice(0,2)) {
      for (const kw of (brief.category||'').split(' ').filter((w:string) => w.length > 4).slice(0,2)) {
        const wiki = await fetchWikipedia(kw, market);
        addPosts(wiki);
      }
    }

    // ═══════════════════════════════════════
    // DEDUPLICATE & SAVE
    // ═══════════════════════════════════════
    const seen = new Set<string>();
    const uniquePosts = allPosts.filter(p => {
      const key = p.text.slice(0, 80).toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const sourceNames = [...new Set(uniquePosts.map(p => p.source))];
    const countries = [...new Set(uniquePosts.map(p => p.country).filter(c => c && c !== 'Global'))];
    const typeBreakdown = uniquePosts.reduce((acc: Record<string,number>, p) => { acc[p.type] = (acc[p.type]||0)+1; return acc; }, {});

    log = [
      ...log,
      `━━━ COLLECTION COMPLETE ━━━`,
      `${uniquePosts.length} unique conversations from ${sourceNames.length} sources`,
      `Sources: ${sourceNames.slice(0,8).join(', ')}`,
      `Types: ${Object.entries(typeBreakdown).map(([k,v]) => `${k}:${v}`).join(' ')}`,
      ...(countries.length > 0 ? [`Markets: ${countries.join(', ')}`] : []),
      `Pages explored: ${scrapedUrls.size}`
    ];

    await updateBrief(briefId, {
      status: 'collected',
      post_count: uniquePosts.length,
      collected_posts: uniquePosts.map(p => `[${p.source}][${p.country}] ${p.text}`),
      collected_posts_full: uniquePosts,
      collection_progress: { total_posts: uniquePosts.length, sources_scraped: scrapedUrls.size, sources_total: scrapedUrls.size, log: log.slice(-35) }
    });

    await sendEmail(brief, uniquePosts.length, sourceNames.length);
    return NextResponse.json({ success: true, postCount: uniquePosts.length, sources: sourceNames.length, pagesExplored: scrapedUrls.size });

  } catch (err) {
    console.error('Collect error:', err);
    if (briefId) await updateBrief(briefId, { status: 'failed' });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
