import { NextRequest, NextResponse } from 'next/server';

async function fetchTrendsData(keyword: string, geo: string = ''): Promise<number[]> {
  try {
    const req = JSON.stringify({
      comparisonItem: [{ keyword: keyword.slice(0, 100), geo, time: 'today 12-m' }],
      category: 0,
      property: ''
    });

    const exploreRes = await fetch(
      `https://trends.google.com/trends/api/explore?hl=en&tz=0&req=${encodeURIComponent(req)}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://trends.google.com/trends/explore',
        },
        signal: AbortSignal.timeout(8000)
      }
    );

    const exploreText = await exploreRes.text();
    const exploreJson = JSON.parse(exploreText.replace(/^\)\]\}',\n/, ''));
    const timelineWidget = (exploreJson.widgets || []).find((w: any) => w.id === 'TIMESERIES');
    if (!timelineWidget) return [];

    const dataRes = await fetch(
      `https://trends.google.com/trends/api/widgetdata/multiline?hl=en&tz=0&req=${encodeURIComponent(JSON.stringify(timelineWidget.request))}&token=${encodeURIComponent(timelineWidget.token)}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://trends.google.com/trends/explore',
        },
        signal: AbortSignal.timeout(8000)
      }
    );

    const dataJson = JSON.parse((await dataRes.text()).replace(/^\)\]\}',\n/, ''));
    return (dataJson?.default?.timelineData || []).map((p: any) => p.value?.[0] ?? 0);
  } catch (e) {
    console.error('Trends fetch:', keyword, e);
    return [];
  }
}

function calcVelocity(values: number[]): number {
  if (values.length < 8) return 0;
  const recent = values.slice(-4).reduce((s, v) => s + v, 0) / 4;
  const older = values.slice(-12, -4).reduce((s, v) => s + v, 0) / 8;
  if (older === 0) return recent > 0 ? 50 : 0;
  return Math.round(((recent - older) / older) * 100);
}

const GEO_MAP: Record<string, string> = {
  UK: 'GB', US: 'US', USA: 'US', FR: 'FR', France: 'FR',
  ES: 'ES', Spain: 'ES', DE: 'DE', Germany: 'DE', PL: 'PL', TR: 'TR', Global: ''
};

export async function POST(req: NextRequest) {
  try {
    const { keywords, markets } = await req.json();
    const geo = GEO_MAP[markets?.[0]] || '';
    const results: Record<string, { values: number[]; velocity: number }> = {};

    for (const kw of (keywords || []).slice(0, 5)) {
      const values = await fetchTrendsData(kw, geo);
      results[kw] = { values: values.slice(-12), velocity: calcVelocity(values) };
    }

    return NextResponse.json({ success: true, trends: results });
  } catch (err) {
    console.error('Trends error:', err);
    return NextResponse.json({ success: false, trends: {} });
  }
}
