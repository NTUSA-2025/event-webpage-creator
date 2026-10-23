import type { Env } from './types';
import { HttpError } from './http';
import { getDriveImage, parseDriveLink, validateSource } from './media';
import * as cheerio from 'cheerio';

function base64(bytes: ArrayBuffer): string {
  let binary = '';
  const data = new Uint8Array(bytes);
  for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(binary);
}

export function validateLlmUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new HttpError(400, 'LLM base URL 格式錯誤'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || value.length > 500 ||
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(url.hostname)) {
    throw new HttpError(400, 'LLM base URL 必須是公開 HTTPS 網址');
  }
  return url.toString().replace(/\/$/, '');
}

export async function llmSettings(env: Env): Promise<{ baseUrl: string; model: string }> {
  const result = await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('llm_base_url', 'llm_model')").all<{ key: string; value: string }>();
  const map = Object.fromEntries((result.results || []).map((x) => [x.key, x.value]));
  return { baseUrl: map.llm_base_url || '', model: map.llm_model || '' };
}

export async function generateHtml(env: Env, prompt: string, previous: string, mediaLinks: string[]): Promise<string> {
  if (!env.LLM_API_KEY) throw new HttpError(503, 'LLM API key 尚未設定');
  const { baseUrl, model } = await llmSettings(env);
  if (!baseUrl || !model) throw new HttpError(503, '請管理員先設定 LLM API');
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: `使用者要求：${prompt}\n\n目前完整 HTML：\n${previous}\n\n請回傳更新後的完整 HTML 文件，無需 Markdown 圍欄。` }];
  for (const link of mediaLinks) {
    const ref = parseDriveLink(link);
    if (!ref) throw new HttpError(400, '請貼上 Google Drive 圖片分享連結');
    const image = await getDriveImage(env, ref);
    content.push({ type: 'text', text: `素材「${image.name}」的原始分享連結：${link}。請用此連結作為 img src。` });
    content.push({ type: 'image_url', image_url: { url: `data:${image.mime};base64,${base64(image.bytes)}` } });
  }
  const response = await fetch(`${validateLlmUrl(baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.LLM_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0.5, max_tokens: 12000, messages: [
      { role: 'system', content: '你是活動網頁設計師。只輸出一份完整 HTML。CSS 和 JS 必須內嵌，不可使用外部 script、stylesheet 或 CDN。圖片只能使用使用者提供的 Google Drive 公開連結；可使用任意 HTTPS iframe。頁面應具備手機版排版。主要可視元素加上唯一 data-editor-id，方便視覺編輯。不得加入後端 API、資料庫、帳號登入、訪客資料收集程式。保留使用者原有內容並完成本次修改。' },
      { role: 'user', content },
    ] }),
  });
  if (!response.ok) throw new HttpError(502, `LLM 服務失敗（${response.status}）`);
  const result = await response.json() as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
  const choice = result.choices?.[0];
  if (!choice?.message?.content || choice.finish_reason === 'length') throw new HttpError(502, 'LLM 未完成 HTML，請縮小修改範圍');
  const html = choice.message.content.trim().replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '');
  validateSource(html);
  const $ = cheerio.load(html);
  const used = new Set<string>();
  $('[data-editor-id]').each((_, element) => {
    const id = $(element).attr('data-editor-id');
    if (!id || used.has(id)) $(element).removeAttr('data-editor-id');
    else used.add(id);
  });
  $('h1, h2, h3, h4, p, a, button, img, section, article, div').each((_, element) => {
    if ($(element).attr('data-editor-id')) return;
    let id: string;
    do { id = `node-${crypto.randomUUID()}`; } while (used.has(id));
    $(element).attr('data-editor-id', id);
    used.add(id);
  });
  return $.html();
}
