import type { Env, ProjectRow } from '../_lib/types';
import {
  HttpError,
  assertMutationOrigin,
  json,
  readJson,
  safeError,
  stringField,
} from '../_lib/http';
import {
  cookie,
  finishGoogle,
  requireAdmin,
  requireCreator,
  requireEngineer,
  requireUser,
  sessionUser,
  startGoogle,
} from '../_lib/auth';
import {
  createProject,
  getOwnedProject,
  getRevision,
  publicProject,
  publish,
  revisionHtml,
  saveRevision,
  shareToken,
} from '../_lib/storage';
import { getChrome, syncChrome } from '../_lib/chrome';
import { driveLinks, mediaResponse, previewHtml, validateSource } from '../_lib/media';
import { generateHtml, llmSettings, validateLlmUrl } from '../_lib/llm';

function projectSummary(project: ProjectRow, token?: string) {
  return {
    id: project.id,
    title: project.title,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
    currentRevisionId: project.current_revision_id,
    sharedRevisionId: project.shared_revision_id,
    shareUrl: token ? `/#/view/${token}` : null,
  };
}

async function shareUrl(env: Env, project: ProjectRow): Promise<string | undefined> {
  return project.share_salt && project.share_hash
    ? shareToken(env, project.id, project.share_salt)
    : undefined;
}

function pathSegments(params: Record<string, string | string[]>): string[] {
  const path = params.path;
  return Array.isArray(path) ? path : typeof path === 'string' ? [path] : [];
}

async function route(request: Request, env: Env, parts: string[]): Promise<Response> {
  const method = request.method;
  const url = new URL(request.url);

  if (method === 'GET' && parts[0] === 'auth' && parts[1] === 'start')
    return startGoogle(env, url.searchParams.get('return') || '/#/dashboard');
  if (method === 'GET' && parts[0] === 'auth' && parts[1] === 'callback')
    return finishGoogle(request, env);
  if (method === 'POST' && parts[0] === 'auth' && parts[1] === 'logout') {
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('session', '', env, 0) });
  }
  if (method === 'GET' && parts[0] === 'chrome' && parts.length === 1)
    return json({ chrome: await getChrome(env) });
  if (method === 'GET' && parts[0] === 'media' && parts[1]) return mediaResponse(env, parts[1]);
  if (method === 'GET' && parts[0] === 'view' && parts[1] && parts.length === 2) {
    const project = await publicProject(env, parts[1]);
    return json({
      title: project.title,
      html: await previewHtml(env, await revisionHtml(env, project.shared_revision_id!)),
      updatedAt: project.updated_at,
    });
  }
  if (method === 'GET' && parts[0] === 'view' && parts[1] && parts[2] === 'export') {
    const user = await requireUser(request, env);
    requireEngineer(user);
    const project = await publicProject(env, parts[1]);
    const source = await revisionHtml(env, project.shared_revision_id!);
    const links = driveLinks(source);
    const comment = `<!--\n工程整合提醒：此檔僅為活動頁設計稿。正式納入官網前，請審查 HTML/CSS/JS，下載下列 Google Drive 素材作為官網 asset，並替換連結。\n${links.map((x) => x.original).join('\n')}\n-->\n`;
    const html = source.replace(/<!doctype html>/i, (doctype) => `${doctype}\n${comment}`);
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="event-${project.id}.html"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  const user = await requireUser(request, env);
  if (method === 'GET' && parts[0] === 'me') return json({ user });

  if (parts[0] === 'admin') {
    requireAdmin(user);
    if (method === 'GET' && parts.length === 1) {
      const rules = await env.DB.prepare(
        'SELECT id, kind, value FROM creator_rules ORDER BY kind, value',
      ).all();
      return json({
        llm: await llmSettings(env),
        rules: rules.results || [],
        chrome: await getChrome(env),
      });
    }
    if (method === 'PUT' && parts[1] === 'llm') {
      const body = await readJson(request);
      const baseUrl = validateLlmUrl(stringField(body, 'baseUrl', 500));
      const model = stringField(body, 'model', 150).trim();
      if (!model) throw new HttpError(400, '請輸入模型名稱');
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO settings (key, value) VALUES ('llm_base_url', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
        ).bind(baseUrl),
        env.DB.prepare(
          "INSERT INTO settings (key, value) VALUES ('llm_model', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
        ).bind(model),
      ]);
      return json({ llm: { baseUrl, model } });
    }
    if (method === 'POST' && parts[1] === 'rules') {
      const body = await readJson(request);
      const kind = stringField(body, 'kind', 20);
      const value = stringField(body, 'value', 250).trim().toLowerCase();
      if (
        !['email', 'domain', 'group'].includes(kind) ||
        !value ||
        (kind === 'domain' && (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value) || value.includes('..'))) ||
        (kind !== 'domain' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      )
        throw new HttpError(400, '資格規則格式錯誤');
      const existing = await env.DB.prepare(
        'SELECT id FROM creator_rules WHERE kind = ? AND value = ?',
      )
        .bind(kind, value)
        .first<{ id: string }>();
      if (existing) throw new HttpError(409, '此資格規則已存在');
      const id = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO creator_rules (id, kind, value) VALUES (?, ?, ?)')
        .bind(id, kind, value)
        .run();
      return json({ id, kind, value }, 201);
    }
    if (method === 'DELETE' && parts[1] === 'rules' && parts[2]) {
      await env.DB.prepare('DELETE FROM creator_rules WHERE id = ?').bind(parts[2]).run();
      return json({ ok: true });
    }
    if (method === 'POST' && parts[1] === 'chrome' && parts[2] === 'sync')
      return json({ chrome: await syncChrome(env) });
    throw new HttpError(404, '找不到管理功能');
  }

  if (parts[0] === 'projects') {
    requireCreator(user);
    if (method === 'GET' && parts.length === 1) {
      const rows = await env.DB.prepare(
        'SELECT * FROM projects WHERE owner_sub = ? ORDER BY updated_at DESC LIMIT 100',
      )
        .bind(user.sub)
        .all<ProjectRow>();
      return json({
        projects: await Promise.all(
          (rows.results || []).map(async (p) => projectSummary(p, await shareUrl(env, p))),
        ),
      });
    }
    if (method === 'POST' && parts.length === 1) {
      const body = await readJson(request);
      const title = stringField(body, 'title', 120).trim();
      if (!title) throw new HttpError(400, '請輸入活動名稱');
      const project = await createProject(env, title, user.sub, user.email);
      return json({ project: projectSummary(project) }, 201);
    }
    if (!parts[1]) throw new HttpError(404, '找不到專案');
    const project = await getOwnedProject(env, parts[1], user.sub);
    if (method === 'POST' && parts[2] === 'preview') {
      const body = await readJson(request);
      const html = stringField(body, 'html', 1_000_000);
      validateSource(html);
      return json({ previewHtml: await previewHtml(env, html) });
    }
    if (method === 'GET' && parts.length === 2) {
      const revisions = await env.DB.prepare(
        'SELECT id, origin, note, created_at FROM revisions WHERE project_id = ? ORDER BY created_at DESC LIMIT 100',
      )
        .bind(project.id)
        .all();
      const chat = await env.DB.prepare(
        'SELECT id, role, content, revision_id, created_at FROM chat_messages WHERE project_id = ? ORDER BY created_at ASC LIMIT 200',
      )
        .bind(project.id)
        .all();
      const html = await revisionHtml(env, project.current_revision_id!);
      return json({
        project: projectSummary(project, await shareUrl(env, project)),
        html,
        previewHtml: await previewHtml(env, html),
        revisions: revisions.results || [],
        chat: chat.results || [],
      });
    }
    if (method === 'POST' && parts[2] === 'revisions' && parts.length === 3) {
      const body = await readJson(request);
      const html = stringField(body, 'html', 1_000_000);
      const expected = stringField(body, 'expectedRevisionId', 100);
      validateSource(html);
      const revisionId = await saveRevision(env, project, html, 'manual', null, expected);
      return json({ revisionId, previewHtml: await previewHtml(env, html) });
    }
    if (method === 'POST' && parts[2] === 'restore') {
      const body = await readJson(request);
      const revisionId = stringField(body, 'revisionId', 100);
      const expected = stringField(body, 'expectedRevisionId', 100);
      const revision = await getRevision(env, revisionId);
      if (revision.project_id !== project.id) throw new HttpError(403, '版本不屬於此專案');
      const html = await revisionHtml(env, revisionId);
      const restoredId = await saveRevision(
        env,
        project,
        html,
        'restore',
        `還原 ${revisionId}`,
        expected,
      );
      return json({ revisionId: restoredId, html, previewHtml: await previewHtml(env, html) });
    }
    if (method === 'POST' && parts[2] === 'ai') {
      const body = await readJson(request);
      const prompt = stringField(body, 'prompt', 5000).trim();
      const expected = stringField(body, 'expectedRevisionId', 100);
      const mediaLinks = body.mediaLinks;
      if (
        !prompt ||
        !Array.isArray(mediaLinks) ||
        mediaLinks.length > 4 ||
        !mediaLinks.every((x) => typeof x === 'string' && x.length < 500)
      )
        throw new HttpError(400, '提示或素材連結格式錯誤');
      if (project.current_revision_id !== expected)
        throw new HttpError(409, '草稿已更新，請重新整理後再生成');
      const day = new Date().toISOString().slice(0, 10);
      const usage = await env.DB.prepare(
        'SELECT requests FROM ai_usage WHERE user_sub = ? AND day = ?',
      )
        .bind(user.sub, day)
        .first<{ requests: number }>();
      if ((usage?.requests || 0) >= 30) throw new HttpError(429, '今日 AI 修改次數已達上限');
      const previous = await revisionHtml(env, expected);
      const history = await env.DB.prepare(
        'SELECT role, content FROM chat_messages WHERE project_id = ? ORDER BY created_at DESC LIMIT 8',
      )
        .bind(project.id)
        .all<{ role: string; content: string }>();
      const html = await generateHtml(
        env,
        prompt,
        previous,
        mediaLinks as string[],
        (history.results || []).reverse(),
      );
      const revisionId = await saveRevision(
        env,
        project,
        html,
        'ai',
        prompt.slice(0, 150),
        expected,
      );
      await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO chat_messages (id, project_id, role, content) VALUES (?, ?, ?, ?)',
        ).bind(crypto.randomUUID(), project.id, 'user', prompt),
        env.DB.prepare(
          'INSERT INTO chat_messages (id, project_id, role, content, revision_id) VALUES (?, ?, ?, ?, ?)',
        ).bind(crypto.randomUUID(), project.id, 'assistant', '已更新活動網頁設計稿。', revisionId),
        env.DB.prepare(
          'INSERT INTO ai_usage (user_sub, day, requests) VALUES (?, ?, 1) ON CONFLICT(user_sub, day) DO UPDATE SET requests = requests + 1',
        ).bind(user.sub, day),
      ]);
      return json({ revisionId, html, previewHtml: await previewHtml(env, html) });
    }
    if (parts[2] === 'share') {
      if (method === 'POST') {
        const token = await publish(env, project, parts[3] === 'rotate');
        return json({
          shareUrl: `/#/view/${token}`,
          sharedRevisionId: project.current_revision_id,
        });
      }
      if (method === 'DELETE') {
        await env.DB.prepare(
          'UPDATE projects SET shared_revision_id = NULL, share_salt = NULL, share_hash = NULL WHERE id = ?',
        )
          .bind(project.id)
          .run();
        return json({ ok: true });
      }
    }
  }
  throw new HttpError(404, '找不到功能');
}

export const onRequest: PagesFunction<Env> = async (context) => {
  try {
    const request = context.request;
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(request.method))
      throw new HttpError(405, '不支援此方法');
    if (request.method !== 'GET') assertMutationOrigin(request, context.env.PUBLIC_ORIGIN);
    const parts = pathSegments(context.params as Record<string, string | string[]>);
    return await route(request, context.env, parts);
  } catch (error) {
    return safeError(error);
  }
};
