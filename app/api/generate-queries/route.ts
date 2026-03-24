import { NextRequest, NextResponse } from 'next/server';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const MARKET_LANGUAGES: Record<string, string> = {
  'France': 'French', 'FR': 'French',
  'Spain': 'Spanish', 'ES': 'Spanish',
  'Germany': 'German', 'DE': 'German',
  'Poland': 'Polish', 'PL': 'Polish',
  'Turkey': 'Turkish', 'TR': 'Turkish',
  'Italy': 'Italian',
  'Netherlands': 'Dutch',
  'Brazil': 'Portuguese',
  'Mexico': 'Spanish',
  'Japan': 'Japanese',
  'China': 'Chinese',
  'Russia': 'Russian',
  'South Korea': 'Korean',
  'UK': 'English', 'USA': 'English', 'US': 'English',
  'Global': 'English', 'Global English': 'English',
  'Australia': 'English', 'Canada': 'English',
};

const ENGLISH_MARKETS = new Set(['UK', 'USA', 'US', 'Australia', 'Canada', 'Ireland', 'Global English', 'Global']);

async function callClaude(prompt: string, maxTokens: number = 1000): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function generateBaseQueries(brief: any, selectedCats: string): Promise<any[]> {
  const raw = await callClaude(`You are a social listening expert. Generate 5 Boolean search queries for this research brief.

Brand: ${brief.brand}
Category: ${brief.category}
Markets: ${(brief.markets || []).join(', ')}
Question: "${brief.question}"
Content clusters: ${selectedCats}

Generate 5 queries covering different angles. Use Boolean operators (AND, OR, NEAR/9). Make them specific enough to find real consumer conversations, not brand content or news articles.

Return ONLY a JSON array, no markdown:
[{"label":"Short descriptive name","query":"the boolean query string"},...]`, 1000);

  return JSON.parse(raw.replace(/```json|```/g, '').trim());
}

async function translateQuery(query: string, label: string, language: string, market: string): Promise<{ label: string; query: string; language: string }> {
  const raw = await callClaude(`Translate this Boolean search query into ${language} for use in ${market}.

Original English query: ${query}

Rules:
- Keep Boolean operators (AND, OR, NOT, NEAR) in English — they are universal
- Translate only the search terms themselves
- Keep quotes around multi-word phrases
- Use natural ${language} that consumers would actually write online
- Keep proper nouns (brand names, product names) in their original form
- Return ONLY the translated query string, nothing else`);

  return {
    label: `${label} (${language})`,
    query: raw.trim(),
    language
  };
}

async function scoreSourceRelevance(urls: string[], brief: any): Promise<string[]> {
  const urlList = urls.map((u, i) => `${i + 1}. ${u}`).join('\n');

  const raw = await callClaude(`You are a cultural research expert. Score these website URLs for relevance to this research brief.

Brief question: "${brief.question}"
Brand: ${brief.brand}
Category: ${brief.category}

Website URLs:
${urlList}

For each URL, decide if it would likely contain relevant consumer conversations, opinions, or cultural content related to the brief. Consider what kind of content the website likely hosts based on its URL.

Score: 2 = highly relevant (consumer conversations, opinions, lifestyle content), 1 = possibly relevant, 0 = not relevant (brand sites, news only, medical/clinical, unrelated topic)

Return ONLY a JSON array of numbers (one per URL in order), e.g.: [2,1,0,2,2,0,1,...]`, 500);

  const scores = JSON.parse(raw.replace(/```json|```/g, '').trim());
  return urls.filter((_, i) => scores[i] >= 2);
}

export async function POST(req: NextRequest) {
  try {
    const { brief, selectedCats, candidateUrls } = await req.json();

    const markets = brief.markets || [];
    const nonEnglishMarkets = markets.filter((m: string) => !ENGLISH_MARKETS.has(m));
    const needsTranslation = nonEnglishMarkets.length > 0;

    // Step 1: Generate base English queries
    const baseQueries = await generateBaseQueries(brief, selectedCats);

    // Step 2: Score source relevance if candidate URLs provided
    let scoredUrls: string[] = [];
    if (candidateUrls && candidateUrls.length > 0) {
      const batches = [];
      for (let i = 0; i < Math.min(candidateUrls.length, 150); i += 50) {
        batches.push(candidateUrls.slice(i, i + 50));
      }
      const results = await Promise.all(batches.map((batch: string[]) => scoreSourceRelevance(batch, brief)));
      scoredUrls = results.flat();
    }

    // Step 3: Translate queries for non-English markets
    const allQueries = [...baseQueries.map((q: any) => ({ ...q, language: 'English', selected: true, editable: false }))];

    if (needsTranslation) {
      const translationPromises = nonEnglishMarkets.flatMap((market: string) => {
        const language = MARKET_LANGUAGES[market] || 'the local language';
        return baseQueries.slice(0, 3).map((q: any) =>
          translateQuery(q.query, q.label, language, market)
            .then(t => ({ ...t, selected: true, editable: false }))
        );
      });
      const translations = await Promise.all(translationPromises);
      allQueries.push(...translations);
    }

    return NextResponse.json({
      queries: allQueries,
      scoredUrls,
      translatedLanguages: needsTranslation ? [...new Set(nonEnglishMarkets.map((m: string) => MARKET_LANGUAGES[m] || m))] : []
    });

  } catch (err) {
    console.error(err);
    return NextResponse.json({ queries: [], scoredUrls: [], translatedLanguages: [] }, { status: 500 });
  }
}
