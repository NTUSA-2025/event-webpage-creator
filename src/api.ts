export interface User {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  isAdmin: boolean;
  isEngineer: boolean;
  canCreate: boolean;
}

export interface Project {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  currentRevisionId: string;
  sharedRevisionId: string | null;
  shareUrl: string | null;
}

export interface Revision {
  id: string;
  origin: 'initial' | 'manual' | 'ai' | 'restore';
  note: string | null;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface ChromeSnapshot {
  syncedAt: string;
  css: string;
  zh: { header: string; footer: string };
  en: { header: string; footer: string };
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    credentials: 'same-origin',
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `請求失敗（${response.status}）`);
  }
  return response.json() as Promise<T>;
}

export function shareAbsolute(path: string): string {
  return new URL(path, window.location.origin).toString();
}
