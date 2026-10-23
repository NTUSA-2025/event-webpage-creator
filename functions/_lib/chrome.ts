import * as cheerio from 'cheerio';
import type { Env } from './types';
import { HttpError } from './http';

const officialOrigin = 'https://ntusa.ntu.edu.tw';

export interface ChromeSnapshot {
  syncedAt: string;
  css: string;
  zh: { header: string; footer: string };
  en: { header: string; footer: string };
}

function absolute(value: string, base = officialOrigin): string {
  try { return new URL(value, base).toString(); } catch { return value; }
}

function normalizeFragment($: cheerio.CheerioAPI, selector: string): string {
  const elements = $(selector);
  if (!elements.length) throw new HttpError(502, `官網缺少 ${selector}，未套用更新`);
  elements.find('script, style, link, iframe').remove();
  elements.find('a[href*="/api/auth/signin"], .nav-admin-menu').remove();
  elements.add(elements.find('*')).each((_, element) => {
    if (!('attribs' in element)) return;
    const node = $(element);
    for (const [key, value] of Object.entries(element.attribs)) {
      if (/^on/i.test(key) || key === 'srcdoc') node.removeAttr(key);
      else if (['href', 'src'].includes(key) && value) {
        const resolved = absolute(value);
        if (!/^https:\/\//.test(resolved) && !/^mailto:/.test(resolved)) node.removeAttr(key);
        else node.attr(key, resolved);
      } else if (key.toLowerCase() === 'srcset') {
        node.removeAttr(key); // The absolute src is enough; Next's relative srcset is invalid here.
      }
    }
  });
  return elements.toArray().map((element) => $.html(element)).join('');
}

async function fetchLocale(locale: 'zh-TW' | 'en') {
  const response = await fetch(officialOrigin, { headers: { Cookie: `NEXT_LOCALE=${locale}` }, redirect: 'follow' });
  if (!response.ok) throw new HttpError(502, '官網暫時無法讀取，未套用更新');
  const html = await response.text();
  if (html.length > 2_000_000) throw new HttpError(502, '官網頁面過大，未套用更新');
  const $ = cheerio.load(html);
  const cssUrl = $('link[rel="stylesheet"]').first().attr('href');
  if (!cssUrl) throw new HttpError(502, '官網樣式檔未找到，未套用更新');
  return {
    cssUrl: absolute(cssUrl),
    header: normalizeFragment($, 'header.navbar') + normalizeFragment($, '.drawer-overlay') + normalizeFragment($, 'aside.drawer'),
    footer: normalizeFragment($, 'footer.footer'),
  };
}

export async function syncChrome(env: Env): Promise<ChromeSnapshot> {
  const [zh, en] = await Promise.all([fetchLocale('zh-TW'), fetchLocale('en')]);
  const cssResponse = await fetch(zh.cssUrl);
  if (!cssResponse.ok) throw new HttpError(502, '官網樣式檔無法讀取，未套用更新');
  let css = await cssResponse.text();
  if (css.length > 500_000 || !css.includes('.navbar') || !css.includes('.footer')) throw new HttpError(502, '官網樣式結構不符合預期，未套用更新');
  css = css.replace(/:root\b/g, ':host').replace(/url\((['"]?)([^)'" ]+)\1\)/g, (_match, _quote: string, path: string) => `url("${absolute(path, zh.cssUrl)}")`);
  const snapshot: ChromeSnapshot = { syncedAt: new Date().toISOString(), css, zh: { header: zh.header, footer: zh.footer }, en: { header: en.header, footer: en.footer } };
  const key = `chrome/${crypto.randomUUID()}.json`;
  await env.FILES.put(key, JSON.stringify(snapshot), { httpMetadata: { contentType: 'application/json' } });
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP')
    .bind('chrome_key', key).run();
  return snapshot;
}

export async function getChrome(env: Env): Promise<ChromeSnapshot | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('chrome_key').first<{ value: string }>();
  if (!row) return null;
  const object = await env.FILES.get(row.value);
  if (!object) return null;
  return object.json<ChromeSnapshot>();
}
