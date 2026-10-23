import type { Env, ProjectRow, RevisionRow } from './types';
import { HttpError } from './http';

const encoder = new TextEncoder();

export function initialHtml(title: string): string {
  const safe = title.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  return `<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${safe}</title>\n<style>body{margin:0;font-family:system-ui,sans-serif;background:#f7f5f0;color:#202638}main{min-height:75vh;display:grid;place-items:center;padding:4rem 2rem;text-align:center}h1{font-size:clamp(2.5rem,6vw,5rem)}p{line-height:1.8}</style>\n</head>\n<body>\n<main><div><p data-editor-id="intro">活動網頁設計草稿</p><h1 data-editor-id="title">${safe}</h1><p data-editor-id="hint">在左側描述活動，開始產生網頁。</p></div></main>\n</body>\n</html>`;
}

export async function getProject(env: Env, id: string): Promise<ProjectRow> {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<ProjectRow>();
  if (!project) throw new HttpError(404, '找不到活動專案');
  return project;
}

export async function getOwnedProject(env: Env, id: string, sub: string): Promise<ProjectRow> {
  const project = await getProject(env, id);
  if (project.owner_sub !== sub) throw new HttpError(403, '無權檢視此活動專案');
  return project;
}

export async function getRevision(env: Env, id: string): Promise<RevisionRow> {
  const revision = await env.DB.prepare('SELECT * FROM revisions WHERE id = ?').bind(id).first<RevisionRow>();
  if (!revision) throw new HttpError(404, '找不到版本');
  return revision;
}

export async function revisionHtml(env: Env, id: string): Promise<string> {
  const revision = await getRevision(env, id);
  const object = await env.FILES.get(revision.source_key);
  if (!object) throw new HttpError(503, '版本檔案遺失');
  return object.text();
}

export async function createProject(env: Env, title: string, ownerSub: string, ownerEmail: string): Promise<ProjectRow> {
  const id = crypto.randomUUID(), revisionId = crypto.randomUUID();
  const sourceKey = `projects/${id}/revisions/${revisionId}.html`;
  await env.FILES.put(sourceKey, initialHtml(title), { httpMetadata: { contentType: 'text/html; charset=utf-8' } });
  await env.DB.batch([
    env.DB.prepare('INSERT INTO projects (id, owner_sub, owner_email, title, current_revision_id) VALUES (?, ?, ?, ?, ?)').bind(id, ownerSub, ownerEmail, title, revisionId),
    env.DB.prepare('INSERT INTO revisions (id, project_id, source_key, origin) VALUES (?, ?, ?, ?)').bind(revisionId, id, sourceKey, 'initial'),
  ]);
  return getProject(env, id);
}

export async function saveRevision(env: Env, project: ProjectRow, html: string, origin: RevisionRow['origin'], note: string | null, expected: string): Promise<string> {
  if (project.current_revision_id !== expected) throw new HttpError(409, '草稿已更新，請重新整理後再儲存');
  const id = crypto.randomUUID();
  const sourceKey = `projects/${project.id}/revisions/${id}.html`;
  await env.FILES.put(sourceKey, html, { httpMetadata: { contentType: 'text/html; charset=utf-8' } });
  const result = await env.DB.batch([
    env.DB.prepare('INSERT INTO revisions (id, project_id, source_key, origin, note) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND current_revision_id = ?)').bind(id, project.id, sourceKey, origin, note, project.id, expected),
    env.DB.prepare('UPDATE projects SET current_revision_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND current_revision_id = ?').bind(id, project.id, expected),
  ]);
  if (result[1].meta.changes !== 1) throw new HttpError(409, '草稿已更新，請重新整理後再儲存');
  return id;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hash(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

export async function shareToken(env: Env, projectId: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${projectId}:${salt}`))));
}

export async function shareHash(token: string): Promise<string> { return hash(token); }

export async function publish(env: Env, project: ProjectRow, rotate = false): Promise<string> {
  if (!project.current_revision_id) throw new HttpError(409, '尚無可分享的版本');
  const salt = rotate || !project.share_salt ? crypto.randomUUID() : project.share_salt;
  const token = await shareToken(env, project.id, salt);
  const tokenHash = await shareHash(token);
  await env.DB.prepare('UPDATE projects SET shared_revision_id = ?, share_salt = ?, share_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(project.current_revision_id, salt, tokenHash, project.id).run();
  return token;
}

export async function publicProject(env: Env, token: string): Promise<ProjectRow> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(404, '分享連結不存在');
  const tokenHash = await shareHash(token);
  const project = await env.DB.prepare('SELECT * FROM projects WHERE share_hash = ? AND shared_revision_id IS NOT NULL').bind(tokenHash).first<ProjectRow>();
  if (!project) throw new HttpError(404, '分享連結已失效');
  return project;
}
