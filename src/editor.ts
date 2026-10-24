import type { ChromeSnapshot } from './api';

export interface EditorMessage {
  channel: 'event-page-editor';
  type: 'select' | 'text' | 'drag' | 'resize' | 'scroll';
  id: string;
  tag?: string;
  text?: string;
  leaf?: boolean;
  src?: string;
  dx?: number;
  dy?: number;
  width?: string;
  height?: string;
  scrollY?: number;
}

const bridge = `
(() => {
  const send = (type, element, more = {}) => parent.postMessage({ channel: 'event-page-editor', type, id: element.getAttribute('data-editor-id'), tag: element.tagName.toLowerCase(), leaf: element.children.length === 0, text: element.textContent?.trim().slice(0, 500) || '', src: element.getAttribute('src') || '', ...more }, '*');
  const editable = (target) => target?.closest?.('[data-editor-id]');
  let drag;
  const style = document.createElement('style');
  style.textContent = '[data-editor-id]{touch-action:none}';
  document.head.appendChild(style);
  const frame = document.createElement('div');
  frame.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #58a7b8;z-index:2147483647;display:none;box-sizing:border-box';
  const handle = document.createElement('div');
  handle.style.cssText = 'position:absolute;right:-7px;bottom:-7px;width:13px;height:13px;border:2px solid white;background:#58a7b8;border-radius:3px;cursor:nwse-resize;pointer-events:auto';
  frame.appendChild(handle); document.body.appendChild(frame);
  let selected;
  const place = () => { if (!selected) return; const r = selected.getBoundingClientRect(); frame.style.left = r.left + 'px'; frame.style.top = r.top + 'px'; frame.style.width = r.width + 'px'; frame.style.height = r.height + 'px'; frame.style.display = 'block'; };
  const startDrag = (event, element, resize) => {
    const rect = element.getBoundingClientRect();
    const translate = element.style.translate.match(/(-?\\d+(?:\\.\\d+)?)px\\s+(-?\\d+(?:\\.\\d+)?)px/);
    drag = {
      element, pointerId: event.pointerId, x: event.clientX, y: event.clientY, resize,
      left: rect.left, top: rect.top, width: rect.width, height: rect.height,
      translateX: translate ? Number(translate[1]) : 0,
      translateY: translate ? Number(translate[2]) : 0,
      originalTranslate: element.style.translate,
      originalWidth: element.style.width, originalHeight: element.style.height,
    };
    event.target.setPointerCapture?.(event.pointerId);
  };
  handle.addEventListener('pointerdown', (event) => {
    if (!selected || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    startDrag(event, selected, true);
  });
  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const element = editable(event.target);
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    selected = element; place();
    send('select', element);
    startDrag(event, element, false);
  }, true);
  document.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const dx = Math.round(event.clientX - drag.x), dy = Math.round(event.clientY - drag.y);
    if (drag.resize) {
      const width = Math.max(24, Math.round(drag.width + dx)) + 'px';
      const height = Math.max(24, Math.round(drag.height + dy)) + 'px';
      drag.element.style.width = width;
      drag.element.style.height = height;
      frame.style.width = width;
      frame.style.height = height;
    } else {
      drag.element.style.translate = (drag.translateX + dx) + 'px ' + (drag.translateY + dy) + 'px';
      frame.style.left = drag.left + dx + 'px';
      frame.style.top = drag.top + dy + 'px';
    }
  }, true);
  const finishDrag = (event, cancelled) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = Math.round(event.clientX - drag.x), dy = Math.round(event.clientY - drag.y);
    if (cancelled || Math.abs(dx) + Math.abs(dy) <= 4) {
      drag.element.style.translate = drag.originalTranslate;
      drag.element.style.width = drag.originalWidth;
      drag.element.style.height = drag.originalHeight;
    } else if (drag.resize) {
      const width = Math.max(24, Math.round(drag.width + dx)) + 'px';
      const height = Math.max(24, Math.round(drag.height + dy)) + 'px';
      drag.element.style.width = width;
      drag.element.style.height = height;
      send('resize', drag.element, { width, height });
    } else {
      drag.element.style.translate = (drag.translateX + dx) + 'px ' + (drag.translateY + dy) + 'px';
      send('drag', drag.element, { dx, dy });
    }
    drag = null;
    place();
  };
  document.addEventListener('pointerup', (event) => finishDrag(event, false), true);
  document.addEventListener('pointercancel', (event) => finishDrag(event, true), true);
  addEventListener('scroll', () => { if (!drag) place(); }, { passive: true });
  addEventListener('resize', () => { if (!drag) place(); });
  document.addEventListener('dblclick', (event) => {
    const element = editable(event.target);
    if (!element || element.matches('img, iframe, video') || element.children.length) return;
    event.preventDefault();
    element.contentEditable = 'true';
    element.focus();
    const finish = () => { element.contentEditable = 'false'; send('text', element); element.removeEventListener('blur', finish); };
    element.addEventListener('blur', finish);
  }, true);
})();
`;

function chromeBridge(snapshot: ChromeSnapshot, initialLocale: 'zh' | 'en'): string {
  const payload = JSON.stringify(snapshot).replace(/</g, '\\u003c');
  return `
(() => {
  const snapshot = ${payload};
  let locale = ${JSON.stringify(initialLocale)};
  const headerHost = document.querySelector('[data-official-chrome="header"]');
  const footerHost = document.querySelector('[data-official-chrome="footer"]');
  const headerRoot = headerHost.attachShadow({ mode: 'open' });
  const footerRoot = footerHost.attachShadow({ mode: 'open' });
  const spacer = document.querySelector('[data-official-chrome-spacer]');
  const updateScrolled = () => {
    headerRoot.querySelector('.navbar')?.classList.toggle('scrolled', scrollY > 8);
  };
  const render = () => {
    headerRoot.innerHTML = '<style>' + snapshot.css + '</style><div data-live-body></div>';
    footerRoot.innerHTML = '<style>' + snapshot.css + '</style><div data-live-body></div>';
    const headerBody = headerRoot.querySelector('[data-live-body]');
    const footerBody = footerRoot.querySelector('[data-live-body]');
    headerBody.className = snapshot.bodyClass;
    footerBody.className = snapshot.bodyClass;
    headerBody.innerHTML = snapshot[locale].header;
    footerBody.innerHTML = snapshot[locale].footer;
    spacer.style.height = headerRoot.querySelector('.navbar').getBoundingClientRect().height + 'px';
    updateScrolled();
  };
  addEventListener('scroll', updateScrolled, { passive: true });
  headerRoot.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('.locale-switcher__option');
    if (button) {
      const next = button.textContent.trim() === 'EN' ? 'en' : 'zh';
      if (next !== locale) {
        locale = next;
        render();
        parent.postMessage({ channel: 'event-page-chrome', locale }, '*');
      }
      return;
    }
    if (target.closest('.hamburger')) {
      headerRoot.querySelector('.drawer')?.classList.add('open');
      headerRoot.querySelector('.drawer-overlay')?.classList.add('open');
    } else if (target.closest('.drawer-close, .drawer-overlay, .drawer-link')) {
      headerRoot.querySelector('.drawer')?.classList.remove('open');
      headerRoot.querySelector('.drawer-overlay')?.classList.remove('open');
    }
  });
  render();
})();`;
}

export function iframeDocument(
  html: string,
  editMode: boolean,
  chrome: ChromeSnapshot | null = null,
  locale: 'zh' | 'en' = 'zh',
  initialScrollY = 0,
  trackScroll = false,
): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const csp = document.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src ${window.location.origin} https: data:; frame-src https:; form-action https:; connect-src 'none'; base-uri 'none'`;
  document.head.insertBefore(csp, document.head.firstChild);
  if (chrome) {
    const header = document.createElement('div');
    header.dataset.officialChrome = 'header';
    const footer = document.createElement('div');
    footer.dataset.officialChrome = 'footer';
    const spacer = document.createElement('div');
    spacer.dataset.officialChromeSpacer = '';
    document.body.insertBefore(header, document.body.firstChild);
    document.body.insertBefore(spacer, header.nextSibling);
    document.body.appendChild(footer);
    const script = document.createElement('script');
    script.textContent = chromeBridge(chrome, locale);
    document.body.appendChild(script);
  }
  if (editMode) {
    const script = document.createElement('script');
    script.textContent = bridge;
    document.body.appendChild(script);
  }
  if (trackScroll) {
    const script = document.createElement('script');
    const y = Number.isFinite(initialScrollY) ? Math.max(0, Math.round(initialScrollY)) : 0;
    script.textContent = `
(() => {
  const savedY = ${y};
  const restore = () => scrollTo({ top: savedY, behavior: 'instant' });
  addEventListener('scroll', () => parent.postMessage({ channel: 'event-page-editor', type: 'scroll', id: '', scrollY }, '*'), { passive: true });
  if (savedY) {
    restore();
    requestAnimationFrame(restore);
    addEventListener('load', restore, { once: true });
  }
})();`;
    document.body.appendChild(script);
  }
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

export function patchElement(
  html: string,
  id: string,
  patch: { text?: string; src?: string; dx?: number; dy?: number; width?: string; height?: string },
): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const element = [...document.querySelectorAll('[data-editor-id]')].find(
    (node) => node.getAttribute('data-editor-id') === id,
  ) as HTMLElement | undefined;
  if (!element) throw new Error('此元素無法視覺編輯，請使用程式碼編輯器');
  if (patch.text !== undefined) {
    if (element.children.length) throw new Error('此元素含有巢狀內容，請使用程式碼編輯器修改文字');
    element.textContent = patch.text;
  }
  if (patch.src !== undefined) element.setAttribute('src', patch.src);
  if (patch.dx !== undefined || patch.dy !== undefined) {
    const current = element.style.translate.match(/(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px/);
    const x = (current ? Number(current[1]) : 0) + (patch.dx || 0);
    const y = (current ? Number(current[2]) : 0) + (patch.dy || 0);
    element.style.translate = `${x}px ${y}px`;
  }
  if (patch.width !== undefined) element.style.width = patch.width;
  if (patch.height !== undefined) element.style.height = patch.height;
  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}
