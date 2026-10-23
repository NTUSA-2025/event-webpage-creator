import { api, type ChromeSnapshot } from './api';

export async function loadChrome(): Promise<ChromeSnapshot> {
  const { chrome } = await api<{ chrome: ChromeSnapshot }>('chrome');
  return chrome;
}
