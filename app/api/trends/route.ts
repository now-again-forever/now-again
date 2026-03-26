import { NextRequest, NextResponse } from 'next/server';

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const STOP_WORDS = new Set(['the','and','for','with','this','that','from','have','are','was','were','been','being','into','through','about','against','between','during','before','after','above','below','than','when','where','which','while','although','because','since','unless','until','whether','both','each','every','other','another','such','more','most','also','just','very','often','always','never','sometimes','how','what','who','why','their','them','they','these','those']);

function simplifyKeyword(clusterName: string): string {
  // Extract 2-3 meaningful words from cluster name
  return clusterName
    .replace(/[&]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 2)
    .join(' ')
    .toLowerCase();
}

const GEO_MAP: Record<string, string> = {
  UK: 'GB', US: 'US', USA: 'US', FR: 'FR', France: 'FR',
  ES: 'ES', Spain: 'ES', DE: 'DE', Germany: 'DE', PL: 'PL', TR: 'TR', Global: ''
};

async function fetchTrend(keyword: string, geo: string): Promise<{ values: number[]; velocity: number; keyword: string }> {
  if (!SERPAPI_KEY || !keyword) return { values: [], velocity: 0, keyword };
  try {
    const params = new URLSearchParams({
      engine: 'google_trends',
      q: keyword,
      date: 'today 12-m',
      data_type: 'TIMESERIES',
      api_key: SERPAPI_KEY,
    });
    if (geo) params.set('geo', geo);

    const res = await fetch(`https://serpapi.com/search.json?${params}`, {
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) return { values: [], velocity: 0, keyword };

    const data = await res.json();
    const points: number[] = (data.interest_over_time?.timeline_data || [])
      .map((p: any) => p.values?.[0]?.extracted_value ?? 0);

    if (points.length < 8) return { values: points, velocity: 0, keyword };

    const recent = points.slice(-4).reduce((s, v) => s + v, 0) / 4;
    const older = points.slice(-12, -4).reduce((s, v) => s + v, 0) / 8;
    const velocity = older > 0 ? Math.round(((recent - older) / older) * 100) : 0;

    return { values: points.slice(-12), velocity, keyword };
  } catch (e) {
    return { values: [], velocity: 0, keyword };
  }
}

export async function POST(req: NextRequest) {
  try {
    const { briefId } = await req.json();

    const briefRes = await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${briefId}&select=clusters,markets,category`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const brief = (await briefRes.json())[0];
    if (!brief) return NextResponse.json({ success: false });

    const clusters: any[] = brief.clusters || [];
    const geo = GEO_MAP[brief.markets?.[0]] || '';

    // Build simplified keywords — one per cluster
    const keywords = clusters.map(c => ({
      clusterName: c.name,
      searchTerm: simplifyKeyword(c.name)
    })).filter(k => k.searchTerm.length > 2);

    console.log('Searching trends for:', keywords.map(k => k.searchTerm).join(', '));

    // Fetch in parallel
    const results: Record<string, { values: number[]; velocity: number; keyword: string }> = {};
    await Promise.all(
      keywords.map(async ({ clusterName, searchTerm }) => {
        results[clusterName] = await fetchTrend(searchTerm, geo);
      })
    );

    return NextResponse.json({ success: true, trends: results });
  } catch (err) {
    console.error('Trends error:', err);
    return NextResponse.json({ success: false, trends: {} });
  }
}
