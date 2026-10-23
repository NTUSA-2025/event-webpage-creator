export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(data), { status, headers });
}

export async function readJson(
  request: Request,
  limit = 2_000_000,
): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    throw new HttpError(415, '請使用 JSON 提交資料');
  }
  const raw = await request.text();
  if (raw.length > limit) throw new HttpError(413, '資料太大');
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('object required');
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'JSON 格式錯誤');
  }
}

export function stringField(body: Record<string, unknown>, field: string, max: number): string {
  const value = body[field];
  if (typeof value !== 'string' || value.length > max)
    throw new HttpError(400, `${field} 格式錯誤`);
  return value;
}

export function assertMutationOrigin(request: Request, origin: string): void {
  const supplied = request.headers.get('Origin');
  if (!supplied || supplied !== origin) throw new HttpError(403, '來源不符');
}

export function safeError(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  console.error('API error', error);
  return json({ error: '服務暫時無法使用' }, 500);
}

export function textHtml(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; frame-src https:; script-src 'unsafe-inline'; form-action https:; base-uri 'none'",
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
