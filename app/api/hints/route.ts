import { NextRequest, NextResponse } from 'next/server';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;

export async function POST(req: NextRequest) {
  try {
    const { posts, brief } = await req.json();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `You are a cultural insight researcher. A researcher has starred these ${posts.length} posts while exploring data for: "${brief.question}" (${brief.brand}).

Starred posts:
${posts.slice(0, 15).join('\n')}

Identify 3-4 interesting patterns, tensions or emerging themes you notice across these posts. Each hint should spark a new cluster idea or challenge an assumption. Be specific and provocative — not generic.

Return ONLY a JSON array of hint strings:
["hint 1", "hint 2", "hint 3"]`
        }]
      })
    });
    const data = await res.json();
    const raw = data.content?.[0]?.text || '[]';
    const match = raw.match(/\[[\s\S]*\]/);
    const hints = match ? JSON.parse(match[0]) : [];
    return NextResponse.json({ hints });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ hints: [] });
  }
}
