import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, type ModelMessage, type UserContent } from 'ai';
import type { Env } from './types';
import { HttpError } from './http';
import { getDriveImage, parseDriveLink, validateSource } from './media';
import * as cheerio from 'cheerio';

export type LlmProvider = 'openai' | 'anthropic' | 'google';

export function validateLlmProvider(value: string): LlmProvider {
  if (value === 'openai' || value === 'anthropic' || value === 'google') return value;
  throw new HttpError(400, '不支援的 LLM 供應商');
}

export function validateLlmUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, 'LLM base URL 格式錯誤');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    value.length > 500 ||
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(url.hostname)
  ) {
    throw new HttpError(400, 'LLM base URL 必須是公開 HTTPS 網址');
  }
  return url.toString().replace(/\/$/, '');
}

export async function llmSettings(
  env: Env,
): Promise<{ provider: LlmProvider; baseUrl: string; model: string }> {
  const result = await env.DB.prepare(
    "SELECT key, value FROM settings WHERE key IN ('llm_provider', 'llm_base_url', 'llm_model')",
  ).all<{ key: string; value: string }>();
  const map = Object.fromEntries((result.results || []).map((x) => [x.key, x.value]));
  return {
    provider: map.llm_provider ? validateLlmProvider(map.llm_provider) : 'openai',
    baseUrl: map.llm_base_url || '',
    model: map.llm_model || '',
  };
}

export function llmKeyStatus(env: Env): Record<LlmProvider, boolean> {
  return {
    openai: !!(env.OPENAI_API_KEY || env.LLM_API_KEY),
    anthropic: !!env.ANTHROPIC_API_KEY,
    google: !!env.GOOGLE_GENERATIVE_AI_API_KEY,
  };
}

function llmModel(env: Env, provider: LlmProvider, model: string, baseUrl: string) {
  const options = baseUrl ? { baseURL: validateLlmUrl(baseUrl) } : {};
  if (provider === 'openai') {
    const apiKey = env.OPENAI_API_KEY || env.LLM_API_KEY;
    if (!apiKey) throw new HttpError(503, 'OpenAI API key 尚未設定');
    const openai = createOpenAI({ apiKey, ...options });
    // Existing custom Chat Completions endpoints remain usable after the upgrade.
    return baseUrl ? openai.chat(model) : openai.responses(model);
  }
  if (provider === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, 'Anthropic API key 尚未設定');
    return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY, ...options })(model);
  }
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY) throw new HttpError(503, 'Gemini API key 尚未設定');
  return createGoogle({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY, ...options })(model);
}

export async function generateHtml(
  env: Env,
  prompt: string,
  previous: string,
  mediaLinks: string[],
  history: Array<{ role: string; content: string }> = [],
): Promise<string> {
  const { provider, baseUrl, model } = await llmSettings(env);
  if (!model) throw new HttpError(503, '請管理員先設定 LLM 模型');
  const selectedModel = llmModel(env, provider, model, baseUrl);
  const content: UserContent = [
    {
      type: 'text',
      text: `使用者要求：${prompt}\n\n目前完整 HTML：\n${previous}\n\n請回傳更新後的完整 HTML 文件，無需 Markdown 圍欄。`,
    },
  ];
  let totalImageBytes = 0;
  for (const link of mediaLinks) {
    const ref = parseDriveLink(link);
    if (!ref) throw new HttpError(400, '請貼上 Google Drive 圖片分享連結');
    const image = await getDriveImage(env, ref);
    totalImageBytes += image.bytes.byteLength;
    if (totalImageBytes > 12_000_000)
      throw new HttpError(400, '本次圖片總量超過 12 MB，請減少圖片或壓縮素材');
    content.push({
      type: 'text',
      text: `素材「${image.name}」的原始分享連結：${link}。請用此連結作為 img src。`,
    });
    content.push({ type: 'image', image: new Uint8Array(image.bytes), mediaType: image.mime });
  }
  const messages: ModelMessage[] = [
    ...history
      .slice(-8)
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({
        role: message.role as 'user' | 'assistant',
        content: message.content,
      })),
    { role: 'user', content },
  ];
  let result: Awaited<ReturnType<typeof generateText>>;
  try {
    result = await generateText({
      model: selectedModel,
      instructions:
        '你是活動網頁設計師。只輸出一份完整 HTML。CSS 和 JS 必須內嵌，不可使用外部 script、stylesheet 或 CDN。圖片只能使用使用者提供的 Google Drive 公開連結；可使用任意 HTTPS iframe。頁面應具備手機版排版。主要可視元素加上唯一 data-editor-id，方便視覺編輯。不得加入後端 API、資料庫、帳號登入、訪客資料收集程式。保留使用者原有內容並完成本次修改。',
      messages,
      maxOutputTokens: 12000,
      maxRetries: 0,
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('LLM generation failed', error);
    throw new HttpError(502, 'LLM 服務失敗，請檢查供應商、模型與 API key');
  }
  if (!result.text || result.finishReason === 'length')
    throw new HttpError(502, 'LLM 未完成 HTML，請縮小修改範圍');
  const html = result.text
    .trim()
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/, '');
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
    do {
      id = `node-${crypto.randomUUID()}`;
    } while (used.has(id));
    $(element).attr('data-editor-id', id);
    used.add(id);
  });
  return $.html();
}
