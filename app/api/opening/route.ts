// app/api/opening/route.ts
// Lichess Opening Explorer 프록시 (API 키를 서버에 보관)

const EXPLORER_URL = 'https://explorer.lichess.org/masters';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fen = searchParams.get('fen');

  if (!fen) {
    return Response.json({ error: 'fen parameter required' }, { status: 400 });
  }

  const token = process.env.LICHESS_API_TOKEN;
  if (!token) {
    return Response.json({ error: 'LICHESS_API_TOKEN not configured' }, { status: 500 });
  }

  const params = new URLSearchParams({ fen, moves: '12' });
  const res = await fetch(`${EXPLORER_URL}?${params}`, {
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    return Response.json(
      { error: `Lichess API error: ${res.status}` },
      { status: res.status },
    );
  }

  const data = await res.json();
  return Response.json(data);
}
