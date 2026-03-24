import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;

async function fetchHackerNews(query: string): Promise<string[]> {
  const posts: string[] = [];
  try {
    const res = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=30`,{signal:AbortSignal.timeout(4000)});
    const data = await res.json();
    for (const hit of data.hits||[]) { if(hit.title) posts.push(`[HN] ${hit.title}`); if(hit.story_text) posts.push(`[HN] ${hit.story_text.slice(0,200)}`); }
  } catch(e){console.error('HN:',e);}
  return posts;
}

async function fetchBluesky(query: string): Promise<string[]> {
  const posts: string[] = [];
  try {
    const q = query.replace(/\(|\)|AND|OR/g,' ').replace(/\s+/g,' ').trim().split(' ').slice(0,4).join(' ');
    const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=20`,{headers:{'Accept':'application/json'},signal:AbortSignal.timeout(4000)});
    const text = await res.text();
    if(!text.startsWith('{')) return posts;
    const data = JSON.parse(text);
    for(const post of data.posts||[]) { if(post.record?.text?.length>20) posts.push(`[Bluesky] ${post.record.text.slice(0,200)}`); }
  } catch(e){console.error('Bluesky:',e);}
  return posts;
}

function buildQuery(brief: any): string {
  const catWords = (brief.category||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter((w:string)=>w.length>3).slice(0,3);
  return catWords.join(' OR ');
}

async function updateBrief(id: string, payload: object) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${id}`,{method:'PATCH',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`},body:JSON.stringify(payload)});
  if(!res.ok) console.error('Supabase:',await res.text());
}

export async function POST(req: NextRequest) {
  let briefId = '';
  try {
    briefId = (await req.json()).briefId;
    const brief = (await (await fetch(`${SUPABASE_URL}/rest/v1/briefs?id=eq.${briefId}&select=*`,{headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`}})).json())[0];
    if(!brief) return NextResponse.json({error:'not found'},{status:404});

    const query = buildQuery(brief);
    console.log('Query:', query);

    const [hn,bsky] = await Promise.all([fetchHackerNews(query),fetchBluesky(query)]);
    const posts = [...hn,...bsky];
    console.log('Posts:', posts.length);

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:'claude-haiku-4-5',max_tokens:1800,messages:[{role:'user',content:`You are a cultural insight analyst at NOW-AGAIN.\nClient: ${brief.brand}\nCategory: ${brief.category}\nMarkets: ${(brief.markets||[]).join(', ')||'Global'}\nQuestion: "${brief.question}"\n\n${posts.length} real online posts:\n${posts.slice(0,40).join('\n')}\n\nIdentify 4 cultural themes. Return ONLY valid JSON:\n{"themes":[{"name":"string","summary":"string","drivers":["string","string"],"verbatims":["string","string","string","string"],"implications":["string","string","string"]}]}\n\nDrivers: Creativity,Experiences,Emotion,Engagement,Relationships,Responsibility,Wellbeing,Simplicity,Resilience,Control,Enhancement,Power,Achievement,Exploration,Individuality,Extremes`}]})});

    const raw = (await claudeRes.json()).content?.[0]?.text||'';
    console.log('Claude:', raw.slice(0,200));
    const results = JSON.parse(raw.replace(/```json|```/g,'').trim());
    results.search_query = query;
    await updateBrief(briefId,{status:'complete',results,post_count:posts.length});
    console.log('Done!');
    return NextResponse.json({success:true});
  } catch(err) {
    console.error('Error:',err);
    if(briefId) await updateBrief(briefId,{status:'failed'});
    return NextResponse.json({error:String(err)},{status:500});
  }
}
