export interface EditorMessage {
  channel: 'event-page-editor';
  type: 'select' | 'text' | 'drag' | 'resize';
  id: string;
  tag?: string;
  text?: string;
  src?: string;
  dx?: number;
  dy?: number;
  width?: string;
  height?: string;
}

const bridge = `<script>
(() => {
  const send = (type, element, more = {}) => parent.postMessage({ channel: 'event-page-editor', type, id: element.getAttribute('data-editor-id'), tag: element.tagName.toLowerCase(), text: element.textContent?.trim().slice(0, 500) || '', src: element.getAttribute('src') || '', ...more }, '*');
  const editable = (target) => target?.closest?.('[data-editor-id]');
  let drag;
  const frame = document.createElement('div');
  frame.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #58a7b8;z-index:2147483647;display:none;box-sizing:border-box';
  const handle = document.createElement('div');
  handle.style.cssText = 'position:absolute;right:-7px;bottom:-7px;width:13px;height:13px;border:2px solid white;background:#58a7b8;border-radius:3px;cursor:nwse-resize;pointer-events:auto';
  frame.appendChild(handle); document.body.appendChild(frame);
  let selected;
  const place = () => { if (!selected) return; const r = selected.getBoundingClientRect(); frame.style.left = r.left + 'px'; frame.style.top = r.top + 'px'; frame.style.width = r.width + 'px'; frame.style.height = r.height + 'px'; frame.style.display = 'block'; };
  handle.addEventListener('pointerdown', (event) => {
    if (!selected) return;
    event.preventDefault(); event.stopPropagation();
    const r = selected.getBoundingClientRect();
    drag = { element: selected, x: event.clientX, y: event.clientY, resize: true, width: r.width, height: r.height };
  });
  document.addEventListener('pointerdown', (event) => {
    const element = editable(event.target);
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    selected = element; place();
    send('select', element);
    drag = { element, x: event.clientX, y: event.clientY };
  }, true);
  document.addEventListener('pointermove', (event) => {
    if (!drag) return;
    if (drag.resize) {
      frame.style.width = Math.max(24, drag.width + event.clientX - drag.x) + 'px';
      frame.style.height = Math.max(24, drag.height + event.clientY - drag.y) + 'px';
    }
  }, true);
  document.addEventListener('pointerup', (event) => {
    if (!drag) return;
    const dx = Math.round(event.clientX - drag.x), dy = Math.round(event.clientY - drag.y);
    if (drag.resize) send('resize', drag.element, { width: Math.max(24, Math.round(drag.width + dx)) + 'px', height: Math.max(24, Math.round(drag.height + dy)) + 'px' });
    else if (Math.abs(dx) + Math.abs(dy) > 4) send('drag', drag.element, { dx, dy });
    drag = null;
  }, true);
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
</script>`;

export function iframeDocument(html: string, editMode: boolean): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src ${window.location.origin} https: data:; frame-src https:; form-action https:; connect-src 'none'; base-uri 'none'">`;
  const protectedHtml = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (head) => `${head}${csp}`) : `${csp}${html}`;
  if (!editMode) return protectedHtml;
  return /<\/body>/i.test(protectedHtml) ? protectedHtml.replace(/<\/body>/i, `${bridge}</body>`) : `${protectedHtml}${bridge}`;
}

export function patchElement(html: string, id: string, patch: { text?: string; src?: string; dx?: number; dy?: number; width?: string; height?: string }): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const element = [...document.querySelectorAll('[data-editor-id]')].find((node) => node.getAttribute('data-editor-id') === id) as HTMLElement | undefined;
  if (!element) throw new Error('此元素無法視覺編輯，請使用程式碼編輯器');
  if (patch.text !== undefined) element.textContent = patch.text;
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
