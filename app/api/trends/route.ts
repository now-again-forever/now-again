import { NextRequest, NextResponse } from 'next/server';

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const GEO_MAP: Record<string, string> = {
  UK: 'GB', US: 'US', USA: 'US', FR: 'FR', France: 'FR',
  ES: 'ES', Spain: 'ES', DE: 'DE', Germany: 'DE', PL: 'PL', TR: 'TR', Global: ''
};

async function fetchTrend(keyword: string, geo: string): Promise<{ values: number[]; velocity: number }> {
  if (!SERPAPI_KEY) return { values: [], velocity: 0 };
  try {
    const params = new URLSearchParams({
      engine: 'google_trends',
      q: keyword.slice(0, 100),
      date: 'today 12-m',
      data_type: 'TIMESERIES',
      api_key: SERPAPI_KEY,
    });
    if (geo) params.set('geo', geo);

    const res = await fetch(`https://serpapi.com/search.json?${params}`, {
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) {
      console.error('SerpAPI trends error:', res.status, await res.text());
      return { values: [], velocity: 0 };
    }
    const data = await res.json();
    const points: number[] = (data.interest_over_time?.timeline_data || [])
      .map((p: any) => p.values?.[0]?.extracted_value ?? 0);

    if (points.length < 8) return { values: points, velocity: 0 };

    // Velocity: avg of last 4 weeks vs avg of 8 weeks before that
    const recent = points.slice(-4).reduce((s, v) => s + v, 0) / 4;
    const older = points.slice(-12, -4).reduce((s, v) => s + v, 0) / 8;
    const velocity = older > 0 ? Math.round(((recent - older) / older) * 100) : 0;

    return { values: points.slice(-12), velocity };
  } catch (e) {
    console.error('Trend fetch failed for', keyword, e);
    return { values: [], velocity: 0 };
  }
}

export async function POST(req: NextRequest) {
  try {
    const { briefId } = await req.json();

    const briefRes = await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${briefId}&select=clusters,markets`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const brief = (await briefRes.json())[0];
    if (!brief) return NextResponse.json({ success: false });

    const clusters: any[] = brief.clusters || [];
    const geo = GEO_MAP[brief.markets?.[0]] || '';

    const results: Record<string, { values: number[]; velocity: number }> = {};

    // Fetch trends for all clusters in parallel (SerpAPI handles rate limiting)
    await Promise.all(
      clusters.map(async (c: any) => {
        results[c.name] = await fetchTrend(c.name, geo);
      })
    );

    console.log(`Trends fetched for ${Object.keys(results).length} clusters`);
    return NextResponse.json({ success: true, trends: results });

  } catch (err) {
    console.error('Trends route error:', err);
    return NextResponse.json({ success: false, trends: {} });
  }
}
