import { useEffect, useRef, useState } from 'react';
import { api, type ChromeSnapshot } from './api';

const fallbackCss = `
:host{--surface:#f4f0eb;--ink:#313646;--muted:#757575;display:block;font-family:Inter,'Noto Sans TC',system-ui,sans-serif;color:var(--ink)}
*{box-sizing:border-box}a{text-decoration:none}button{font:inherit;cursor:pointer}
.navbar{height:64px;background:rgba(244,240,235,.96);border-bottom:1px solid #e0dbd4;position:relative;z-index:3}
.nav-inner,.footer-inner{max-width:1200px;margin:auto;padding:0 32px;display:flex;align-items:center;justify-content:space-between;gap:24px}
.nav-inner{height:100%}.nav-logo,.footer-brand{display:flex;align-items:center;gap:12px;color:#313646}.logo-mark{height:40px;width:40px;object-fit:contain;border-radius:8px}.logo-mark.small{height:32px;width:32px}.logo-text{display:flex;flex-direction:column}.logo-title{font-size:16px;font-weight:700}.logo-sub,.footer-name-en{font-size:11px;color:#757575}.nav-links,.footer-links{display:flex;align-items:center;gap:6px}.nav-link,.footer-links a{padding:8px 10px;color:#5f6269;font-size:14px;font-weight:600}.nav-link:hover,.footer-links a:hover{color:#5a9aac}.locale-switcher{display:flex;border:1px solid #e0dbd4;border-radius:30px;padding:2px}.locale-switcher__option{border:0;background:none;padding:5px 9px;color:#666}.locale-switcher__option.is-active{background:#d0eaef;border-radius:20px;color:#313646}.hamburger{display:none;border:0;background:none}.hamburger span{display:block;background:#313646;width:22px;height:2px;margin:4px}.drawer-overlay,.drawer{display:none}
.footer{background:#313646;padding:44px 32px;color:white}.footer-inner{flex-wrap:wrap}.footer-brand,.footer-links a{color:white}.footer-name{font-weight:700}.footer-contact,.footer-bug-report{display:block;font-size:12px;color:#b4b9c3}.footer-socials{display:flex;gap:14px}.footer-socials a{color:#cbd1d8}.footer-copy{font-size:12px;color:#b4b9c3}
@media(max-width:850px){.nav-links{display:none}.hamburger{display:block}.drawer-overlay.open{display:block;position:fixed;inset:0;background:#31364655;z-index:9}.drawer{display:flex;position:fixed;right:0;top:0;bottom:0;width:min(320px,85vw);padding:24px;background:#f4f0eb;z-index:10;flex-direction:column;gap:20px;transform:translateX(105%);transition:transform .2s}.drawer.open{transform:none}.drawer-close{align-self:flex-end;border:0;background:#e0dbd4;border-radius:100%;height:38px;width:38px}.drawer-nav{display:flex;flex-direction:column;gap:8px}.drawer-link{color:#313646;padding:8px}.drawer-divider{height:1px;background:#ccc}.footer-inner{align-items:flex-start}}
`;

const labels = {
  zh: ['首頁', '關於我們', '公告', '案件進度', '相關連結', '公開資料'],
  en: ['Home', 'About', 'Announcements', 'Case Progress', 'Links', 'Records'],
};
const hrefs = ['', 'about', 'announcements', 'cases', 'forms', 'data'];

function fallbackHeader(locale: 'zh' | 'en'): string {
  const links = labels[locale].map((label, i) => `<a class="nav-link" href="https://ntusa.ntu.edu.tw/${hrefs[i]}">${label}</a>`).join('');
  const switcher = `<div class="locale-switcher"><button class="locale-switcher__option ${locale === 'zh' ? 'is-active' : ''}" data-locale="zh">中</button><button class="locale-switcher__option ${locale === 'en' ? 'is-active' : ''}" data-locale="en">EN</button></div>`;
  return `<header class="navbar"><div class="nav-inner"><a class="nav-logo" href="https://ntusa.ntu.edu.tw/"><img class="logo-mark" src="https://ntusa.ntu.edu.tw/NTUSA_Logo_1.png" alt="臺大學生會"><span class="logo-text"><span class="logo-title">國立臺灣大學學生會</span><span class="logo-sub">NTU Student Association</span></span></a><nav class="nav-links">${links}${switcher}</nav><button class="hamburger" aria-label="開啟選單"><span></span><span></span><span></span></button></div></header><div class="drawer-overlay"></div><aside class="drawer"><button class="drawer-close" aria-label="關閉選單">✕</button><div class="drawer-nav">${links}${switcher}</div></aside>`;
}

function fallbackFooter(locale: 'zh' | 'en'): string {
  return `<footer class="footer"><div class="footer-inner"><div class="footer-brand"><img class="logo-mark small" src="https://ntusa.ntu.edu.tw/NTUSA_Logo_1.png" alt="臺大學生會"><div><div class="footer-name">國立臺灣大學學生會</div><div class="footer-name-en">NTU Student Association</div><a class="footer-contact" href="mailto:ntusamailbox@gmail.com">ntusamailbox@gmail.com</a><a class="footer-bug-report" href="mailto:infor@ntusa.ntu.edu.tw">infor@ntusa.ntu.edu.tw</a></div></div><div class="footer-links">${labels[locale].slice(0, 3).map((x, i) => `<a href="https://ntusa.ntu.edu.tw/${hrefs[i]}">${x}</a>`).join('')}</div><div class="footer-copy">© 2026 國立臺灣大學學生會資訊部</div></div></footer>`;
}

let chromeCache: ChromeSnapshot | null | undefined;
export async function loadChrome(): Promise<ChromeSnapshot | null> {
  if (chromeCache !== undefined) return chromeCache;
  const result = await api<{ chrome: ChromeSnapshot | null }>('chrome');
  chromeCache = result.chrome;
  return chromeCache;
}
export function setChromeCache(snapshot: ChromeSnapshot): void { chromeCache = snapshot; }

export function ChromeSlot({ kind, snapshot, locale, onLocale }: {
  kind: 'header' | 'footer'; snapshot: ChromeSnapshot | null; locale: 'zh' | 'en'; onLocale: (locale: 'zh' | 'en') => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    const root = host.current.shadowRoot || host.current.attachShadow({ mode: 'open' });
    const html = snapshot?.[locale][kind] || (kind === 'header' ? fallbackHeader(locale) : fallbackFooter(locale));
    root.innerHTML = `<style>${snapshot?.css || fallbackCss}</style>${html}`;
    if (kind === 'header') {
      const drawer = root.querySelector('.drawer');
      const overlay = root.querySelector('.drawer-overlay');
      drawer?.classList.toggle('open', drawerOpen);
      overlay?.classList.toggle('open', drawerOpen);
      const click = (event: Event) => {
        const target = event.target as Element;
        if (target.closest('.hamburger')) setDrawerOpen(true);
        if (target.closest('.drawer-close, .drawer-overlay, .drawer-link')) setDrawerOpen(false);
        const button = target.closest('button');
        if (button?.textContent?.trim() === '中') onLocale('zh');
        if (button?.textContent?.trim() === 'EN') onLocale('en');
      };
      root.addEventListener('click', click);
      return () => root.removeEventListener('click', click);
    }
  }, [kind, snapshot, locale, onLocale, drawerOpen]);

  return <div ref={host} className={`chrome-host ${kind === 'header' ? 'chrome-header' : ''}`} />;
}
