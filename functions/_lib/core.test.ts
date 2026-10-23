import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDriveLink, validateSource } from './media';
import { shareHash, shareToken } from './storage';
import {
  createProject,
  getProject,
  publicProject,
  publish,
  revisionHtml,
  saveRevision,
} from './storage';
import { syncChrome } from './chrome';
import { startGoogle } from './auth';
import { generateHtml } from './llm';
import { onRequest } from '../api/[[path]]';
import type { Env } from './types';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

describe('generated page contracts', () => {
  it('accepts Drive sharing links with resource keys', () => {
    expect(
      parseDriveLink(
        'https://drive.google.com/file/d/abcdef1234567890/view?usp=sharing&resourcekey=0-xyz',
      ),
    ).toMatchObject({ id: 'abcdef1234567890', resourceKey: '0-xyz' });
    expect(parseDriveLink('https://evil.example/file/d/abcdef1234567890/view')).toBeNull();
  });

  it('rejects external code while allowing inline code and HTTPS embeds', () => {
    expect(() =>
      validateSource(
        '<!doctype html><html><body><script>const x=1</script><iframe src="https://example.com/embed"></iframe></body></html>',
      ),
    ).not.toThrow();
    expect(() =>
      validateSource(
        '<!doctype html><html><script src="https://cdn.example/app.js"></script></html>',
      ),
    ).toThrow(/外部/);
    expect(() =>
      validateSource(
        '<!doctype html><html><body><img src="https://example.com/a.png"></body></html>',
      ),
    ).toThrow(/Drive/);
  });

  it('derives a stable revocable capability token from the project salt', async () => {
    const env = { SESSION_SECRET: 'x'.repeat(48) } as Env;
    const token = await shareToken(env, 'project', 'salt-a');
    expect(token).toHaveLength(43);
    expect(await shareToken(env, 'project', 'salt-a')).toBe(token);
    expect(await shareToken(env, 'project', 'salt-b')).not.toBe(token);
    expect(await shareHash(token)).not.toBe(token);
  });
});

describe('authentication boundary', () => {
  it('starts Google login with signed state and PKCE', async () => {
    const env = {
      SESSION_SECRET: 'x'.repeat(48),
      PUBLIC_ORIGIN: 'https://studio.example.org',
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'secret',
    } as Env;
    const response = await startGoogle(env, '/#/dashboard');
    const location = new URL(response.headers.get('Location')!);
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect(response.headers.get('Set-Cookie')).toContain('Secure');
  });

  it('rejects unauthenticated project reads and cross-origin mutations', async () => {
    const env = { PUBLIC_ORIGIN: 'https://studio.example.org' } as Env;
    const get = await onRequest({
      request: new Request('https://studio.example.org/api/projects'),
      env,
      params: { path: ['projects'] },
    } as never);
    expect(get.status).toBe(401);
    const post = await onRequest({
      request: new Request('https://studio.example.org/api/auth/logout', {
        method: 'POST',
        headers: { Origin: 'https://other.example.org' },
      }),
      env,
      params: { path: ['auth', 'logout'] },
    } as never);
    expect(post.status).toBe(403);
  });
});

describe('draft and sharing flow', () => {
  it('keeps draft changes out of the view link until published and revokes rotated links', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readFileSync('migrations/0001_init.sql', 'utf8'));
    const memory = new Map<string, string>();
    const prepare = (sql: string) => ({
      bind: (...args: Array<string | null>) => ({
        first: async () => sqlite.prepare(sql).get(...args) || null,
        all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
        run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...args).changes } }),
      }),
    });
    const db = {
      prepare,
      batch: async (statements: Array<{ run: () => Promise<{ meta: { changes: number } }> }>) => {
        sqlite.exec('BEGIN');
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          sqlite.exec('COMMIT');
          return results;
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        }
      },
    };
    const files = {
      put: async (key: string, body: string) => {
        memory.set(key, body);
      },
      get: async (key: string) => (memory.has(key) ? { text: async () => memory.get(key)! } : null),
    };
    const env = { DB: db, FILES: files, SESSION_SECRET: 'x'.repeat(48) } as unknown as Env;
    const created = await createProject(env, '迎新活動', 'owner', 'owner@example.org');
    const firstToken = await publish(env, created);
    const oldSharedId = (await publicProject(env, firstToken)).shared_revision_id;
    const html = '<!doctype html><html><body><h1>新設計</h1></body></html>';
    const revisionId = await saveRevision(
      env,
      await getProject(env, created.id),
      html,
      'manual',
      null,
      created.current_revision_id!,
    );
    expect((await publicProject(env, firstToken)).shared_revision_id).toBe(oldSharedId);
    expect(await revisionHtml(env, revisionId)).toBe(html);
    const sameToken = await publish(env, await getProject(env, created.id));
    expect(sameToken).toBe(firstToken);
    expect((await publicProject(env, sameToken)).shared_revision_id).toBe(revisionId);
    const nextToken = await publish(env, await getProject(env, created.id), true);
    expect(nextToken).not.toBe(firstToken);
    await expect(publicProject(env, firstToken)).rejects.toThrow(/失效/);
    sqlite.close();
  });
});

describe('multimodal page generation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('passes accessible Drive image bytes to the configured model and returns editable HTML', async () => {
    const requests: Array<{ url: string; body?: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
        if (url.includes('fields='))
          return Response.json({ mimeType: 'image/png', size: '4', name: 'poster.png' });
        if (url.includes('alt=media')) return new Response(new Uint8Array([137, 80, 78, 71]));
        return Response.json({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: '<!doctype html><html><body><h1>迎新活動</h1></body></html>' },
            },
          ],
        });
      }),
    );
    const env = {
      LLM_API_KEY: 'test-key',
      GOOGLE_DRIVE_API_KEY: 'drive-key',
      DB: {
        prepare: () => ({
          all: async () => ({
            results: [
              { key: 'llm_base_url', value: 'https://llm.example.org/v1' },
              { key: 'llm_model', value: 'vision-model' },
            ],
          }),
        }),
      },
    } as unknown as Env;
    const result = await generateHtml(
      env,
      '設計迎新頁',
      '<!doctype html><html><body></body></html>',
      ['https://drive.google.com/file/d/abcdef1234567890/view'],
    );
    expect(result).toContain('data-editor-id');
    const modelRequest = requests.find((request) => request.url.endsWith('/chat/completions'));
    expect(modelRequest?.body).toContain('data:image/png;base64,');
    expect(modelRequest?.body).toContain('vision-model');
  });
});

describe('official chrome synchronization', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the previous snapshot when the official page structure changes', async () => {
    const put = vi.fn();
    const prepare = vi.fn();
    const env = { FILES: { put }, DB: { prepare } } as unknown as Env;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            '<html><head><link rel="stylesheet" href="/site.css"></head><body>changed</body></html>',
            { status: 200 },
          ),
      ),
    );
    await expect(syncChrome(env)).rejects.toThrow(/官網缺少/);
    expect(put).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('rewrites official links and switches to a complete bilingual snapshot', async () => {
    const body =
      '<html><head><link rel="stylesheet" href="/_next/site.css"></head><body><header class="navbar"><a href="/about">About</a></header><div class="drawer-overlay"></div><aside class="drawer"><a href="/forms">Forms</a></aside><footer class="footer"><a href="/api/auth/signin">Admin sign in</a><a href="/data">Data</a></footer></body></html>';
    const put = vi.fn(async () => undefined);
    const run = vi.fn(async () => ({}));
    const bind = vi.fn(() => ({ run }));
    const env = { FILES: { put }, DB: { prepare: vi.fn(() => ({ bind })) } } as unknown as Env;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (input: string | URL | Request, init?: RequestInit) =>
          new Response(
            String(input).endsWith('.css')
              ? ':root{--brand:#fff}.navbar{color:red}.footer{color:blue}'
              : (init?.headers as Record<string, string>)?.Cookie === 'NEXT_LOCALE=zh-TW'
                ? body.replace('About', '關於')
                : body,
          ),
      ),
    );
    const result = await syncChrome(env);
    expect(result.zh.header).toContain('https://ntusa.ntu.edu.tw/about');
    expect(result.en.footer).not.toContain('/api/auth/signin');
    expect(result.css).toContain(':host{--brand');
    expect(put).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
  });
});
