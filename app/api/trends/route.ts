import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(req: NextRequest) {
  try {
    const { briefId } = await req.json();

    const briefRes = await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${briefId}&select=collected_posts_full,clusters`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const brief = (await briefRes.json())[0];
    if (!brief) return NextResponse.json({ success: false });

    const allPosts: any[] = brief.collected_posts_full || [];
    const clusters: any[] = brief.clusters || [];

    // Build 8-week buckets from actual post timestamps
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const NUM_WEEKS = 8;

    const results: Record<string, { values: number[]; velocity: number }> = {};

    for (const cluster of clusters) {
      const clusterPosts: any[] = cluster.posts || [];
      if (clusterPosts.length === 0) {
        results[cluster.name] = { values: [], velocity: 0 };
        continue;
      }

      // Count posts per week bucket
      const buckets = new Array(NUM_WEEKS).fill(0);
      let datedCount = 0;

      for (const post of clusterPosts) {
        const ts = post.timestamp ? new Date(post.timestamp).getTime() : 0;
        if (!ts || ts <= 0) continue;
        const weeksAgo = Math.floor((now - ts) / weekMs);
        if (weeksAgo >= 0 && weeksAgo < NUM_WEEKS) {
          buckets[NUM_WEEKS - 1 - weeksAgo]++;
          datedCount++;
        }
      }

      // If too few dated posts, fall back to a flat line showing cluster size
      if (datedCount < 3) {
        const flatVal = Math.min(clusterPosts.length, 10);
        results[cluster.name] = {
          values: new Array(NUM_WEEKS).fill(flatVal),
          velocity: 0
        };
        continue;
      }

      // Velocity: compare last 2 weeks vs prior 4 weeks
      const recentAvg = (buckets[6] + buckets[7]) / 2;
      const olderAvg = (buckets[2] + buckets[3] + buckets[4] + buckets[5]) / 4;
      const velocity = olderAvg > 0
        ? Math.round(((recentAvg - olderAvg) / olderAvg) * 100)
        : recentAvg > 0 ? 50 : 0;

      results[cluster.name] = { values: buckets, velocity };
    }

    return NextResponse.json({ success: true, trends: results });

  } catch (err) {
    console.error('Trends error:', err);
    return NextResponse.json({ success: false, trends: {} });
  }
}
