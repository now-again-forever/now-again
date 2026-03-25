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
    .replace(/[\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function scorePost(p: any): number {
  const text = p.text || '';
  const type = p.type || '';
  const source = p.source || '';
  let score = 0;
  if (/\bI\b/.test(text)) score += 5;
  if (/\b(my|me|we|our)\b/i.test(text)) score += 2;
  if (/\b(love|hate|think|feel|believe|prefer|amazing|terrible|brilliant|awful|obsessed|disappointed|tried|bought)\b/i.test(text)) score += 2;
  if (/\b(\d+|yesterday|last week|always|never|every day|usually|started|stopped|switched)\b/i.test(text)) score += 1;
  if (type === 'youtube') score += 4;
  if (type === 'bluesky') score += 2;
  if (/forum|reddit|mumsnet|tripadvisor|trustpilot/i.test(source)) score += 2;
  if (/buy now|shop now|discount|subscribe|sign up|click here|free delivery|privacy|cookie/i.test(text)) score -= 5;
  if (type === 'wikipedia' || type === 'autocomplete') score -= 4;
  if (text.length < 40) score -= 3;
  return score;
}

function isNonEnglish(text: string): boolean {
  const spanishWords = /\b(que|con|para|una|los|las|del|por|como|pero|este|esta|todo|también|cuando|sobre|entre|después|antes|donde|porque|aunque|quiero|tengo|puedo|hace|muy|más|está|son|hay|fue|era|han|ser|estar|tener|hacer|decir|ver|saber|querer|llegar|pasar|deber|poner|parecer|quedar|creer|hablar|llevar|dejar|seguir|encontrar|llamar|venir|pensar|salir|volver|tomar|conocer|vivir|sentir|tratar|mirar|contar|empezar|esperar|buscar|existir|entrar|trabajar)\b/i;
  const frenchWords = /\b(que|les|des|est|dans|avec|pour|sur|par|pas|plus|vous|nous|ils|elle|très|bien|comme|mais|donc|car|je|il|la|le|un|une|du|au|aux|ce|se|on|y|en|ne|qui|lui|me|te|si|ou|et|être|avoir|faire|dit)\b/i;
  const accentedChars = /[àáâãäçèéêëìíîïñòóôõöùúûüýÀÁÂÃÄÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ]/;
  return accentedChars.test(text) || spanishWords.test(text) || frenchWords.test(text);
}

async function callClaude(prompt: string, maxTokens: number = 2500): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] })
  });
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function fetchFreshData(brief: any): Promise<any[]> {
  const posts: any[] = [];
  const query = (brief.category || '').split(' ').slice(0, 3).join(' ');
  try {
    const res = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=25`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    for (const hit of data.hits || []) {
      if (hit.title) posts.push({ text: hit.title, source: 'Hacker News', country: 'Global', type: 'hn' });
    }
  } catch { }
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

    // Get raw posts
    let rawPosts: any[] = [];
    if (brief.collected_posts_full?.length > 0) {
      rawPosts = brief.collected_posts_full;
      console.log(`Using ${rawPosts.length} collected posts`);
    } else if (brief.collected_posts?.length > 0) {
      rawPosts = brief.collected_posts.map((t: string) => ({ text: t, source: 'collected', country: 'Global', type: 'web' }));
    } else {
      rawPosts = await fetchFreshData(brief);
    }

    // Score all posts
    const scored = rawPosts
      .map((p: any) => ({ ...p, _score: scorePost(p) }))
      .sort((a: any, b: any) => b._score - a._score);

    // Select top posts with hard cap of 2 per source
    const srcCap: Record<string, number> = {};
    const selectedPosts: any[] = [];
    for (const p of scored) {
      const src = p.source || 'unknown';
      srcCap[src] = (srcCap[src] || 0) + 1;
      if (srcCap[src] <= 1) selectedPosts.push(p);
      if (selectedPosts.length >= 40) break;
    }

    const sourceList = [...new Set(selectedPosts.map((p: any) => p.source))];
    console.log(`Selected ${selectedPosts.length} posts from ${sourceList.length} sources: ${sourceList.slice(0, 8).join(', ')}`);

    // Build numbered post list for Claude
    const numberedPosts = selectedPosts.map((p, i) => {
      const text = cleanText(p.text || '');
      const src = p.source || 'unknown';
      const country = p.country || 'Global';
      return `[${i + 1}] [${src}|${country}] ${text}`;
    });

    // Generate themes
    const analysisPrompt = `You are a senior cultural insight analyst at NOW-AGAIN.

Client: ${brief.brand}
Category: ${brief.category}
Markets: ${(brief.markets || []).join(', ') || 'Global'}
Question: "${brief.question}"
Sources: ${sourceList.slice(0, 6).join(', ')}

${numberedPosts.length} real collected posts:
${numberedPosts.join('\n')}

Identify 4 distinct cultural themes. For verbatims, prioritise first-person quotes ("I", "my", "me") above all else. CRITICAL: Each of the 4 verbatims in a theme MUST come from a completely different source domain. If posts [1][amazon.es], [2][amazon.es] are both from amazon.es, you may only use ONE of them across ALL themes combined.

For each theme:
- name: evocative 2-4 words
- summary: 2 sentences addressing the question
- drivers: exactly 2 from [Creativity, Experiences, Emotion, Engagement, Relationships, Responsibility, Wellbeing, Simplicity, Resilience, Control, Enhancement, Power, Achievement, Exploration, Individuality, Extremes]
- verbatims: exactly 4 quotes, each starting with post number like "[3] text here"
- implications: exactly 3 strategic implications for ${brief.brand}

Return ONLY valid JSON, no markdown:
{"themes":[{"name":"","summary":"","drivers":["",""],"verbatims":["","","",""],"implications":["","",""]}]}`;

    const raw = (await callClaude(analysisPrompt)).trim();
    console.log('Claude preview:', raw.slice(0, 150));

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`No JSON found: ${raw.slice(0, 200)}`);

    let jsonStr = match[0]
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
      .replace(/\t/g, ' ')
      .replace(/\r/g, ' ');

    let results: any;
    try {
      results = JSON.parse(jsonStr);
    } catch {
      jsonStr = jsonStr.replace(/\n/g, ' ').replace(/\r/g, ' ');
      results = JSON.parse(jsonStr);
    }

    // Translate any non-English verbatims
    const toTranslate: { ti: number; vi: number; text: string }[] = [];
    (results.themes || []).forEach((theme: any, ti: number) => {
      (theme.verbatims || []).forEach((v: string, vi: number) => {
        const text = v.replace(/^\[\d+\]\s*/, '');
        if (isNonEnglish(text)) toTranslate.push({ ti, vi, text });
      });
    });

    if (toTranslate.length > 0) {
      console.log(`Translating ${toTranslate.length} non-English verbatims`);
      try {
        const transPrompt = `Translate each quote to natural English. Return ONLY a JSON array of strings, same order, no other text:\n${JSON.stringify(toTranslate.map(t => t.text))}`;
        const transRaw = await callClaude(transPrompt, 600);
        const transMatch = transRaw.match(/\[[\s\S]*\]/);
        if (transMatch) {
          const translations = JSON.parse(transMatch[0]);
          toTranslate.forEach((item, i) => {
            if (translations[i]) {
              const prefix = results.themes[item.ti].verbatims[item.vi].match(/^\[\d+\]\s*/)?.[0] || '';
              results.themes[item.ti].verbatims[item.vi] = `${prefix}${translations[i]} (translated)`;
            }
          });
        }
      } catch (e) { console.error('Translation failed:', e); }
    }

    results.post_count = selectedPosts.length;
    results.source_count = sourceList.length;

    await updateBrief(briefId, { status: 'complete', results, post_count: selectedPosts.length });
    console.log('Done! Posts:', selectedPosts.length, 'Sources:', sourceList.length);
    return NextResponse.json({ success: true });

  } catch (err) {
    console.error('Generate error:', err);
    if (briefId) await updateBrief(briefId, { status: 'failed' });
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
