import { NextRequest, NextResponse } from 'next/server';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;

export async function POST(req: NextRequest) {
  try {
    const { brief, selectedCats } = await req.json();

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `You are a social listening expert. Generate 5 Boolean search queries for this research brief.

Brand: ${brief.brand}
Category: ${brief.category}
Markets: ${(brief.markets || []).join(', ')}
Question: "${brief.question}"
Content clusters selected: ${selectedCats}

Generate 5 queries covering different angles of the question. Use Boolean operators (AND, OR, NEAR). Each should be specific and find real consumer conversations.

Return ONLY a JSON array, no markdown:
[{"label":"Short descriptive name","query":"the boolean query string"},...]`
        }]
      })
    });

    const data = await res.json();
    const raw = data.content?.[0]?.text || '[]';
    const queries = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return NextResponse.json({ queries });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ queries: [] });
  }
}
