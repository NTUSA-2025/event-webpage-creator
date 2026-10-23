import { SignJWT, jwtVerify } from 'jose';
import * as cheerio from 'cheerio';
import type { Env } from './types';
import { HttpError } from './http';

export interface DriveRef {
  id: string;
  resourceKey?: string;
  original: string;
}

export function parseDriveLink(input: string): DriveRef | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com') return null;
  const id =
    url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)/)?.[1] ||
    (['/open', '/uc'].includes(url.pathname) ? url.searchParams.get('id') : null);
  if (!id || !/^[A-Za-z0-9_-]{10,}$/.test(id)) return null;
  const resourceKey = url.searchParams.get('resourcekey') || undefined;
  return { id, resourceKey, original: input };
}

async function driveFetch(env: Env, ref: DriveRef, query: string): Promise<Response> {
  if (!env.GOOGLE_DRIVE_API_KEY) throw new HttpError(503, 'Google Drive API key 尚未設定');
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(ref.id)}`);
  url.search = query;
  url.searchParams.set('key', env.GOOGLE_DRIVE_API_KEY);
  const headers: Record<string, string> = {};
  if (ref.resourceKey) headers['X-Goog-Drive-Resource-Keys'] = `${ref.id}/${ref.resourceKey}`;
  return fetch(url, { headers });
}

export async function getDriveImage(
  env: Env,
  ref: DriveRef,
): Promise<{ bytes: ArrayBuffer; mime: string; name: string }> {
  const metadataResponse = await driveFetch(
    env,
    ref,
    'fields=id,name,mimeType,size,capabilities(canDownload)',
  );
  if (!metadataResponse.ok)
    throw new HttpError(400, 'Drive 素材無法公開讀取；請設定為知道連結者可檢視');
  const metadata = (await metadataResponse.json()) as {
    name?: string;
    mimeType?: string;
    size?: string;
    capabilities?: { canDownload?: boolean };
  };
  const mime = metadata.mimeType || '';
  if (!/^image\/(png|jpeg|webp|gif)$/.test(mime))
    throw new HttpError(400, '只支援 Drive PNG、JPEG、WebP、GIF 圖片');
  const size = Number(metadata.size);
  if (
    !Number.isFinite(size) ||
    size <= 0 ||
    size > 8_000_000 ||
    metadata.capabilities?.canDownload === false
  )
    throw new HttpError(400, 'Drive 圖片太大或禁止下載');
  const response = await driveFetch(env, ref, 'alt=media');
  if (!response.ok) throw new HttpError(400, 'Drive 素材下載失敗');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 8_000_000) throw new HttpError(400, 'Drive 圖片太大');
  return { bytes, mime, name: metadata.name || ref.id };
}

export function driveLinks(html: string): DriveRef[] {
  const matches =
    html.match(/https:\/\/drive\.google\.com\/(?:file\/d\/|open\?|uc\?)[^"'\s<>)]*/g) || [];
  return [
    ...new Map(
      matches
        .map((x) => parseDriveLink(x.replace(/&amp;/g, '&')))
        .filter((x): x is DriveRef => !!x)
        .map((x) => [x.id, x]),
    ).values(),
  ];
}

export function validateSource(html: string): void {
  if (html.length > 1_000_000 || !/<!doctype html>/i.test(html) || !/<html[\s>]/i.test(html))
    throw new HttpError(400, '請提供小於 1 MB 的完整 HTML 文件');
  const $ = cheerio.load(html);
  if (
    $('base, script[src], link[rel="stylesheet"]').length ||
    /@import\b/i.test($('style').text())
  ) {
    throw new HttpError(400, 'HTML 不可依賴外部 JS 或 CSS');
  }
  $('img').each((_, element) => {
    const src = $(element).attr('src');
    if (src && !parseDriveLink(src) && !src.startsWith('data:image/'))
      throw new HttpError(400, '圖片請使用 Google Drive 分享連結');
  });
  $('iframe').each((_, element) => {
    const src = $(element).attr('src');
    if (!src || !src.startsWith('https://') || $(element).attr('srcdoc'))
      throw new HttpError(400, '外部嵌入須使用 HTTPS iframe 網址');
  });
}

async function mediaToken(env: Env, ref: DriveRef): Promise<string> {
  return new SignJWT({ id: ref.id, resourceKey: ref.resourceKey })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('2h')
    .sign(new TextEncoder().encode(env.SESSION_SECRET));
}

export async function previewHtml(env: Env, html: string): Promise<string> {
  const $ = cheerio.load(html);
  const images = $('img').toArray();
  for (const image of images) {
    const ref = parseDriveLink($(image).attr('src') || '');
    if (ref) $(image).attr('src', `/api/media/${await mediaToken(env, ref)}`);
  }
  return $.html();
}

export async function mediaResponse(env: Env, token: string): Promise<Response> {
  let id: string, resourceKey: string | undefined;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(env.SESSION_SECRET));
    id = String(payload.id);
    resourceKey = typeof payload.resourceKey === 'string' ? payload.resourceKey : undefined;
  } catch {
    throw new HttpError(404, '圖片連結已失效');
  }
  const image = await getDriveImage(env, { id, resourceKey, original: '' });
  return new Response(image.bytes, {
    headers: {
      'Content-Type': image.mime,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
