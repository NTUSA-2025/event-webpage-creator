import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Code2,
  Copy,
  Download,
  Eye,
  FileClock,
  Grip,
  Link2,
  LoaderCircle,
  LogIn,
  LogOut,
  MessageSquare,
  Plus,
  RotateCcw,
  Save,
  Send,
  Settings2,
  Shield,
  Smartphone,
  Monitor,
  Trash2,
  WandSparkles,
} from 'lucide-react';
import {
  api,
  shareAbsolute,
  type ChatMessage,
  type ChromeSnapshot,
  type Project,
  type Revision,
  type User,
} from './api';
import { ChromeSlot, loadChrome, setChromeCache } from './chrome';
import { iframeDocument, patchElement, type EditorMessage } from './editor';
import './styles.css';

function route(): string[] {
  return (window.location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
}
function go(path: string): void {
  window.location.hash = `/${path}`;
}
function signIn(returnTo = '/#/dashboard'): void {
  window.location.href = `/api/auth/start?return=${encodeURIComponent(returnTo)}`;
}
function err(error: unknown): string {
  return error instanceof Error ? error.message : '操作失敗';
}
function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' });
}

function App() {
  const [path, setPath] = useState(route);
  const [user, setUser] = useState<User | null>(null);
  const [chrome, setChrome] = useState<ChromeSnapshot | null>(null);
  const [locale, setLocale] = useState<'zh' | 'en'>(() =>
    localStorage.getItem('locale') === 'en' ? 'en' : 'zh',
  );
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const currentPath = useRef(path);
  const editorDirty = useRef(false);
  const onEditorDirtyChange = useCallback((dirty: boolean) => {
    editorDirty.current = dirty;
  }, []);

  useEffect(() => {
    const onHash = () => {
      const nextPath = route();
      const leavingEditor =
        currentPath.current[0] === 'edit' &&
        (nextPath[0] !== 'edit' || nextPath[1] !== currentPath.current[1]);
      if (leavingEditor && editorDirty.current && !window.confirm('草稿尚未儲存，確定要離開嗎？')) {
        window.history.replaceState(null, '', `#/${currentPath.current.join('/')}`);
        return;
      }
      currentPath.current = nextPath;
      if (leavingEditor) editorDirty.current = false;
      setPath(nextPath);
      window.scrollTo(0, 0);
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!editorDirty.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('beforeunload', onBeforeUnload);
    Promise.allSettled([api<{ user: User }>('me'), loadChrome()]).then(([me, common]) => {
      if (me.status === 'fulfilled') setUser(me.value.user);
      if (common.status === 'fulfilled') setChrome(common.value);
      setLoading(false);
    });
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  const changeLocale = useCallback((value: 'zh' | 'en') => {
    setLocale(value);
    localStorage.setItem('locale', value);
  }, []);
  const logout = async () => {
    if (editorDirty.current && !window.confirm('草稿尚未儲存，確定要登出嗎？')) return;
    setSessionError('');
    try {
      await api('auth/logout', { method: 'POST' });
      editorDirty.current = false;
      setUser(null);
      go('dashboard');
    } catch (error) {
      setSessionError(`登出失敗：${err(error)}`);
    }
  };
  const viewToken = path[0] === 'view' ? path[1] : undefined;

  return (
    <div className="app-shell">
      <ChromeSlot kind="header" snapshot={chrome} locale={locale} onLocale={changeLocale} />
      <div className="utility-bar">
        <a href="#/dashboard" className="utility-brand">
          <span className="utility-dot" /> 活動網頁設計台{' '}
          <span className="utility-beta">DESIGN STUDIO</span>
        </a>
        <div className="utility-actions">
          {user?.isAdmin && (
            <button className="utility-link" onClick={() => go('admin')}>
              <Settings2 size={15} /> 管理後台
            </button>
          )}
          {user && (
            <span className="user-pill">
              {user.picture && <img src={user.picture} alt="" />}
              {user.name}
            </span>
          )}
          {user ? (
            <button className="utility-link" onClick={logout}>
              <LogOut size={15} /> 登出
            </button>
          ) : (
            <button
              className="utility-link"
              onClick={() => signIn(viewToken ? `/#/view/${viewToken}` : '/#/dashboard')}
            >
              <LogIn size={15} /> Google 登入
            </button>
          )}
        </div>
      </div>
      {sessionError && (
        <div className="editor-alert error-message" role="alert">
          {sessionError}
          <button aria-label="關閉錯誤訊息" onClick={() => setSessionError('')}>
            ✕
          </button>
        </div>
      )}
      <main className="app-main">
        {loading ? (
          <div className="loading-screen">
            <LoaderCircle className="spin" /> 載入中
          </div>
        ) : path[0] === 'view' && viewToken ? (
          <ShareView key={viewToken} token={viewToken} user={user} />
        ) : path[0] === 'edit' && path[1] ? (
          user?.canCreate ? (
            <Editor key={path[1]} id={path[1]} onDirtyChange={onEditorDirtyChange} />
          ) : (
            <AccessPage user={user} />
          )
        ) : path[0] === 'admin' ? (
          user?.isAdmin ? (
            <AdminPanel onChrome={setChrome} />
          ) : (
            <AccessPage user={user} />
          )
        ) : user?.canCreate ? (
          <Dashboard user={user} />
        ) : (
          <AccessPage user={user} />
        )}
      </main>
      <ChromeSlot kind="footer" snapshot={chrome} locale={locale} onLocale={changeLocale} />
    </div>
  );
}

function AccessPage({ user }: { user: User | null }) {
  return (
    <section className="access-page">
      <div className="eyebrow">NTUSA · EVENT PAGE STUDIO</div>
      <h1>
        把活動想法，
        <br />
        <em>變成可以討論的網頁。</em>
      </h1>
      <p>用對話建立活動頁、在畫面上調整細節，再把設計稿交給工程師審查與整合。</p>
      <div className="access-card">
        <WandSparkles size={30} />
        <div>
          <strong>{user ? '此帳號尚未取得建立資格' : '使用 Google 帳號開始'}</strong>
          <span>
            {user
              ? `已登入 ${user.email}。請聯絡管理員開通資格。`
              : '登入後可建立草稿、分享預覽並追蹤修改版本。'}
          </span>
        </div>
        {!user && (
          <button className="primary-button" onClick={() => signIn()}>
            <LogIn size={17} /> Google 登入
          </button>
        )}
      </div>
      <div className="access-note">
        <Shield size={18} /> 此平台產出設計稿；正式活動頁仍須經工程師檢視後納入官網。
      </div>
    </section>
  );
}

function Dashboard({ user }: { user: User }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ projects: Project[] }>('projects')
      .then((r) => setProjects(r.projects))
      .catch((e) => setError(err(e)))
      .finally(() => setProjectsLoading(false));
  }, []);
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ project: Project }>('projects', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim() }),
      });
      go(`edit/${result.project.id}`);
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dashboard page-wrap">
      <div className="dashboard-hero">
        <div>
          <div className="eyebrow">WORKSPACE / 我的活動</div>
          <h1>
            從一個想法
            <br />
            開始設計活動頁。
          </h1>
          <p>歡迎回來，{user.name}。你可以繼續編輯草稿，或建立新的活動設計。</p>
        </div>
        <div className="hero-mark">
          <WandSparkles size={60} strokeWidth={1.1} />
        </div>
      </div>
      <section className="new-project">
        <div>
          <span className="section-kicker">01 / NEW PROJECT</span>
          <h2>建立新活動</h2>
          <p>先輸入活動名稱，接著告訴 AI 你的內容與風格。</p>
        </div>
        <form onSubmit={create}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="例如：2027 臺大學生會迎新茶會"
            aria-label="活動名稱"
          />
          <button className="primary-button" disabled={busy || !title.trim()}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />} 建立活動
          </button>
        </form>
      </section>
      {error && <p className="error-message">{error}</p>}
      <section className="project-section">
        <div className="section-title">
          <div>
            <span className="section-kicker">02 / YOUR PROJECTS</span>
            <h2>我的設計稿</h2>
          </div>
          <span className="count-badge">
            {projectsLoading ? '載入中' : `${projects.length} 個活動`}
          </span>
        </div>
        {projectsLoading ? (
          <div className="empty-state" role="status">
            <LoaderCircle size={17} className="spin" /> 載入設計稿…
          </div>
        ) : projects.length ? (
          <div className="project-grid">
            {projects.map((p) => (
              <button className="project-card" key={p.id} onClick={() => go(`edit/${p.id}`)}>
                <span className="project-icon">
                  <Code2 size={25} />
                </span>
                <span className="project-card-title">{p.title}</span>
                <span className="project-card-meta">
                  {p.sharedRevisionId ? (
                    <>
                      <span className="status-dot" /> 已建立分享預覽
                    </>
                  ) : (
                    '尚未分享'
                  )}{' '}
                  · 更新於 {formatDate(p.updatedAt)}
                </span>
                <span className="project-card-arrow">
                  <ArrowRight size={19} />
                </span>
              </button>
            ))}
          </div>
        ) : !error ? (
          <div className="empty-state">還沒有活動設計稿。從上方建立第一個活動吧。</div>
        ) : null}
      </section>
    </div>
  );
}

type ProjectDetail = {
  project: Project;
  html: string;
  previewHtml: string;
  revisions: Revision[];
  chat: ChatMessage[];
};

function Editor({ id, onDirtyChange }: { id: string; onDirtyChange: (dirty: boolean) => void }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [source, setSource] = useState('');
  const [rendered, setRendered] = useState('');
  const [prompt, setPrompt] = useState('');
  const [mediaInput, setMediaInput] = useState('');
  const [selected, setSelected] = useState<EditorMessage | null>(null);
  const [editMode, setEditMode] = useState(true);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [panel, setPanel] = useState<'chat' | 'history'>('chat');
  const [busy, setBusy] = useState<'save' | 'ai' | 'share' | 'restore' | ''>('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const frame = useRef<HTMLIFrameElement>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const dirty = !!detail && source !== detail.html;

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const reload = useCallback(async () => {
    const data = await api<ProjectDetail>(`projects/${id}`);
    setDetail(data);
    setSource(data.html);
    setRendered(data.previewHtml);
  }, [id]);
  useEffect(() => {
    reload().catch((e) => setError(err(e)));
  }, [reload]);
  useEffect(() => {
    if (!detail || source === detail.html) return;
    const timer = window.setTimeout(() => {
      api<{ previewHtml: string }>(`projects/${id}/preview`, {
        method: 'POST',
        body: JSON.stringify({ html: source }),
      })
        .then((r) => {
          if (sourceRef.current === source) setRendered(r.previewHtml);
        })
        .catch((e) => setError(`預覽：${err(e)}`));
    }, 650);
    return () => clearTimeout(timer);
  }, [source, detail, id]);
  useEffect(() => {
    const onMessage = (event: MessageEvent<EditorMessage>) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.channel !== 'event-page-editor'
      )
        return;
      const message = event.data;
      if (!message.id || message.id.length > 200) return;
      if (message.type === 'select') setSelected(message);
      if (message.type === 'text' && message.leaf === true && typeof message.text === 'string') {
        try {
          setSource((current) => patchElement(current, message.id, { text: message.text }));
          setNotice('文字已更新，記得儲存草稿。');
        } catch (e) {
          setError(err(e));
        }
      }
      if (message.type === 'drag' && Number.isFinite(message.dx) && Number.isFinite(message.dy)) {
        try {
          setSource((current) =>
            patchElement(current, message.id, { dx: message.dx, dy: message.dy }),
          );
          setNotice('位置已更新，記得儲存草稿。');
        } catch (e) {
          setError(err(e));
        }
      }
      if (
        message.type === 'resize' &&
        typeof message.width === 'string' &&
        typeof message.height === 'string'
      ) {
        try {
          setSource((current) =>
            patchElement(current, message.id, { width: message.width, height: message.height }),
          );
          setNotice('尺寸已更新，記得儲存草稿。');
        } catch (e) {
          setError(err(e));
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const save = async (html = source): Promise<string> => {
    if (!detail) throw new Error('尚未載入專案');
    const data = await api<{ revisionId: string; previewHtml: string }>(
      `projects/${id}/revisions`,
      {
        method: 'POST',
        body: JSON.stringify({ html, expectedRevisionId: detail.project.currentRevisionId }),
      },
    );
    setRendered(data.previewHtml);
    await reload();
    return data.revisionId;
  };
  const saveClick = async () => {
    setBusy('save');
    setError('');
    try {
      await save();
      setNotice('草稿已儲存，分享版尚未更新。');
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy('');
    }
  };
  const generate = async () => {
    if (!detail || !prompt.trim()) return;
    setBusy('ai');
    setError('');
    setNotice('');
    try {
      let expected = detail.project.currentRevisionId;
      if (source !== detail.html) expected = await save();
      const mediaLinks = mediaInput
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const result = await api<{ revisionId: string; html: string; previewHtml: string }>(
        `projects/${id}/ai`,
        {
          method: 'POST',
          body: JSON.stringify({ prompt: prompt.trim(), mediaLinks, expectedRevisionId: expected }),
        },
      );
      setSource(result.html);
      setRendered(result.previewHtml);
      setPrompt('');
      setMediaInput('');
      setSelected(null);
      setNotice('AI 已產生新版本。請檢查預覽與原始碼。');
      await reload();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy('');
    }
  };
  const share = async (rotate = false) => {
    if (!detail) return;
    setBusy('share');
    setError('');
    try {
      if (source !== detail.html) await save();
      const result = await api<{ shareUrl: string }>(
        `projects/${id}/share${rotate ? '/rotate' : ''}`,
        { method: 'POST' },
      );
      await reload();
      setNotice(rotate ? '已重建連結，舊連結已失效。' : '分享版已更新。');
      await navigator.clipboard.writeText(shareAbsolute(result.shareUrl)).catch(() => undefined);
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy('');
    }
  };
  const revoke = async () => {
    if (!window.confirm('確定撤銷分享連結？持連結者將無法再檢視。')) return;
    setBusy('share');
    try {
      await api(`projects/${id}/share`, { method: 'DELETE' });
      await reload();
      setNotice('分享連結已撤銷。');
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy('');
    }
  };
  const restore = async (revisionId: string) => {
    if (!detail || !window.confirm('以這個版本建立新的草稿版本？')) return;
    setBusy('restore');
    setError('');
    try {
      await api(`projects/${id}/restore`, {
        method: 'POST',
        body: JSON.stringify({ revisionId, expectedRevisionId: detail.project.currentRevisionId }),
      });
      await reload();
      setNotice('已還原為新草稿版本。');
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy('');
    }
  };
  const patchSelected = (patch: {
    text?: string;
    src?: string;
    width?: string;
    height?: string;
  }) => {
    if (!selected) return;
    try {
      setSource((current) => patchElement(current, selected.id, patch));
      setNotice('元素已更新，記得儲存草稿。');
    } catch (e) {
      setError(err(e));
    }
  };
  const copyShareLink = async () => {
    if (!detail?.project.shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareAbsolute(detail.project.shareUrl));
      setError('');
      setNotice('分享連結已複製。');
    } catch {
      setError('無法複製連結，請開啟分享預覽後從網址列複製。');
    }
  };
  const jumpTo = (section: string) => {
    document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const previewDocument = useMemo(() => iframeDocument(rendered, editMode), [rendered, editMode]);
  if (!detail)
    return (
      <div className="loading-screen">
        {error || (
          <>
            <LoaderCircle className="spin" /> 載入設計稿
          </>
        )}
      </div>
    );
  const shareLink = detail.project.shareUrl && shareAbsolute(detail.project.shareUrl);
  return (
    <div className="editor-page">
      <div className="editor-toolbar">
        <div className="editor-title">
          <button className="icon-button" title="返回" onClick={() => go('dashboard')}>
            <ArrowLeft size={19} />
          </button>
          <div>
            <span className="breadcrumb">我的活動 / 設計稿</span>
            <strong>{detail.project.title}</strong>
          </div>
          <span className={`draft-badge ${dirty ? 'unsaved' : ''}`}>
            {dirty ? '未儲存' : '草稿已儲存'}
          </span>
        </div>
        <div className="toolbar-actions">
          <button className="secondary-button" onClick={saveClick} disabled={!!busy || !dirty}>
            {busy === 'save' ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}
            {busy === 'save' ? '儲存中…' : '儲存草稿'}
          </button>
          <button className="primary-button" onClick={() => share()} disabled={!!busy}>
            {busy === 'share' ? <LoaderCircle size={16} className="spin" /> : <Link2 size={16} />}
            {busy === 'share'
              ? '更新中…'
              : detail.project.sharedRevisionId
                ? '更新分享版'
                : '建立分享連結'}
          </button>
        </div>
      </div>
      {error && (
        <div className="editor-alert error-message" role="alert">
          {error}
          <button onClick={() => setError('')}>✕</button>
        </div>
      )}
      {notice && (
        <div className="editor-alert success-message" role="status">
          <Check size={16} /> {notice}
          <button onClick={() => setNotice('')}>✕</button>
        </div>
      )}
      <nav className="editor-section-nav" aria-label="編輯區段">
        <button onClick={() => jumpTo('editor-assistant')}>
          <MessageSquare size={15} /> 對話
        </button>
        <button onClick={() => jumpTo('editor-preview')}>
          <Eye size={15} /> 預覽
        </button>
        <button onClick={() => jumpTo('editor-code')}>
          <Code2 size={15} /> 原始碼
        </button>
      </nav>
      <div className="editor-grid">
        <aside className="assistant-pane" id="editor-assistant">
          <div className="pane-tabs">
            <button className={panel === 'chat' ? 'active' : ''} onClick={() => setPanel('chat')}>
              <MessageSquare size={16} /> 對話
            </button>
            <button
              className={panel === 'history' ? 'active' : ''}
              onClick={() => setPanel('history')}
            >
              <FileClock size={16} /> 版本
            </button>
          </div>
          {panel === 'chat' ? (
            <>
              <div className="chat-scroll">
                <div className="assistant-intro">
                  <span className="sparkle-mark">
                    <WandSparkles size={21} />
                  </span>
                  <strong>設計助手</strong>
                  <p>
                    描述活動的內容、目標受眾、視覺風格或想調整的區塊。我會產生可交給工程師的 HTML。
                  </p>
                </div>
                {detail.chat.map((m) => (
                  <div className={`chat-bubble ${m.role}`} key={m.id}>
                    {m.content}
                    <small>{formatDate(m.created_at)}</small>
                  </div>
                ))}
              </div>
              <div className="prompt-box">
                <label htmlFor="media-links">Google Drive 圖片連結（每行一個，最多四個）</label>
                <textarea
                  id="media-links"
                  className="media-input"
                  value={mediaInput}
                  onChange={(e) => setMediaInput(e.target.value)}
                  placeholder="https://drive.google.com/file/d/.../view"
                />
                <label htmlFor="prompt">描述要生成或修改的內容</label>
                <textarea
                  id="prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="例如：把首屏改成深藍色，加入活動議程與講者介紹…"
                />
                <button
                  className="primary-button send-button"
                  disabled={!!busy || !prompt.trim()}
                  onClick={generate}
                >
                  {busy === 'ai' ? <LoaderCircle size={17} className="spin" /> : <Send size={17} />}{' '}
                  送出修改
                </button>
                <small>單次最多 4 張圖片；目前限制每日 30 次 AI 修改。</small>
              </div>
            </>
          ) : (
            <div className="history-scroll">
              {detail.revisions.map((r) => (
                <div className="history-item" key={r.id}>
                  <div>
                    <span className="history-dot" />
                    <strong>
                      {r.origin === 'ai'
                        ? 'AI 修改'
                        : r.origin === 'manual'
                          ? '手動儲存'
                          : r.origin === 'restore'
                            ? '版本還原'
                            : '建立專案'}
                    </strong>
                  </div>
                  <small>{formatDate(r.created_at)}</small>
                  {r.note && <p>{r.note}</p>}
                  <button
                    className="text-button"
                    disabled={!!busy || r.id === detail.project.currentRevisionId}
                    onClick={() => restore(r.id)}
                  >
                    <RotateCcw size={14} /> 還原此版本
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="share-panel">
            <strong>
              <Link2 size={16} /> 分享預覽
            </strong>
            <p>連結僅供設計檢視，不可作為正式活動宣傳頁。</p>
            {shareLink ? (
              <>
                <a
                  className="share-url"
                  href={shareLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={shareLink}
                  aria-label="開啟分享預覽（新分頁）"
                >
                  {shareLink}
                </a>
                <div className="share-actions">
                  <button onClick={copyShareLink}>
                    <Copy size={14} /> 複製
                  </button>
                  <button onClick={() => share(true)}>
                    <RotateCcw size={14} /> 重建
                  </button>
                  <button onClick={revoke}>
                    <Trash2 size={14} /> 撤銷
                  </button>
                </div>
              </>
            ) : (
              <span className="share-muted">尚未建立分享連結</span>
            )}
          </div>
        </aside>
        <section className="code-pane" id="editor-code">
          <div className="pane-heading">
            <div>
              <Code2 size={17} /> 原始碼 <span className="source-indicator">HTML · CSS · JS</span>
            </div>
            <small>程式碼是最終依據</small>
          </div>
          <textarea
            spellCheck={false}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            aria-label="活動頁原始碼"
            className="code-editor"
          />
        </section>
        <section className="preview-pane" id="editor-preview">
          <div className="pane-heading">
            <div>
              <Eye size={17} /> 即時預覽
            </div>
            <div className="preview-controls">
              <button
                className={device === 'desktop' ? 'active' : ''}
                onClick={() => setDevice('desktop')}
                title="桌面"
              >
                <Monitor size={17} />
              </button>
              <button
                className={device === 'mobile' ? 'active' : ''}
                onClick={() => setDevice('mobile')}
                title="手機"
              >
                <Smartphone size={17} />
              </button>
              <span className="control-divider" />
              <button className={editMode ? 'active' : ''} onClick={() => setEditMode(!editMode)}>
                {editMode ? (
                  <>
                    <Grip size={15} /> 編輯
                  </>
                ) : (
                  <>
                    <Eye size={15} /> 互動
                  </>
                )}
              </button>
            </div>
          </div>
          <div className="preview-workspace">
            <iframe
              ref={frame}
              title="活動頁預覽"
              sandbox="allow-scripts allow-forms"
              className={`preview-frame ${device}`}
              srcDoc={previewDocument}
            />
          </div>
          {editMode && (
            <div className="inspector">
              <div className="inspector-title">
                {selected ? (
                  <>
                    已選取 <code>{selected.tag}</code> <span>#{selected.id}</span>
                  </>
                ) : (
                  '點選預覽中的元素以快速修改；拖拉可調整位置，雙擊可改文字。'
                )}
              </div>
              {selected && (
                <div className="inspector-fields">
                  {selected.leaf && selected.tag !== 'img' && (
                    <label>
                      文字
                      <input
                        defaultValue={selected.text}
                        key={`${selected.id}-text`}
                        onBlur={(e) => patchSelected({ text: e.target.value })}
                      />
                    </label>
                  )}
                  {selected.tag === 'img' && (
                    <label>
                      Drive 連結
                      <input
                        defaultValue={selected.src}
                        key={`${selected.id}-src`}
                        onBlur={(e) => patchSelected({ src: e.target.value })}
                      />
                    </label>
                  )}
                  <label>
                    寬度
                    <input
                      placeholder="例如 320px"
                      onBlur={(e) => e.target.value && patchSelected({ width: e.target.value })}
                    />
                  </label>
                  <label>
                    高度
                    <input
                      placeholder="例如 180px"
                      onBlur={(e) => e.target.value && patchSelected({ height: e.target.value })}
                    />
                  </label>
                </div>
              )}
              {selected && <p className="inspector-hint">修改欄位後按 Tab 套用，再儲存草稿。</p>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ShareView({ token, user }: { token: string; user: User | null }) {
  const [data, setData] = useState<{ title: string; html: string; updatedAt: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ title: string; html: string; updatedAt: string }>(`view/${token}`)
      .then(setData)
      .catch((e) => setError(err(e)));
  }, [token]);
  const shareDocument = useMemo(() => iframeDocument(data?.html || '', false), [data?.html]);
  return (
    <div className="share-view">
      <div className="share-banner">
        <div>
          <span className="preview-label">
            <Eye size={15} /> 設計預覽
          </span>
          <h1>{data?.title || '活動網頁預覽'}</h1>
          <p>此連結僅供檢視與討論；正式活動頁須經工程師審查並整合至官網。</p>
        </div>
        {data && (
          <div className="share-banner-actions">
            {user?.isEngineer ? (
              <a className="primary-button" href={`/api/view/${token}/export`}>
                <Download size={16} /> 下載單檔 HTML
              </a>
            ) : user ? (
              <span className="restricted-note">下載限工程師群組</span>
            ) : (
              <button className="secondary-button" onClick={() => signIn(`/#/view/${token}`)}>
                <LogIn size={16} /> 工程師登入
              </button>
            )}
          </div>
        )}
      </div>
      {error ? (
        <div className="share-error">{error}</div>
      ) : data ? (
        <iframe
          className="share-frame"
          sandbox="allow-scripts allow-forms"
          title={data.title}
          srcDoc={shareDocument}
        />
      ) : (
        <div className="loading-screen">
          <LoaderCircle className="spin" /> 載入分享版
        </div>
      )}
    </div>
  );
}

type Rule = { id: string; kind: 'email' | 'domain' | 'group'; value: string };
function AdminPanel({ onChrome }: { onChrome: (snapshot: ChromeSnapshot) => void }) {
  const [llm, setLlm] = useState({ baseUrl: '', model: '' });
  const [rules, setRules] = useState<Rule[]>([]);
  const [chrome, setChrome] = useState<ChromeSnapshot | null>(null);
  const [kind, setKind] = useState<Rule['kind']>('email');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    api<{ llm: typeof llm; rules: Rule[]; chrome: ChromeSnapshot | null }>('admin')
      .then((r) => {
        setLlm(r.llm);
        setRules(r.rules);
        setChrome(r.chrome);
      })
      .catch((e) => setError(err(e)));
  }, []);
  const saveLlm = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy('llm');
    setError('');
    try {
      await api('admin/llm', { method: 'PUT', body: JSON.stringify(llm) });
      setNotice('LLM 設定已儲存。API key 由部署環境管理。');
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy('');
    }
  };
  const addRule = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy('rule');
    setError('');
    try {
      const result = await api<Rule>('admin/rules', {
        method: 'POST',
        body: JSON.stringify({ kind, value }),
      });
      setRules((list) => [...list, result]);
      setValue('');
      setNotice('建立資格已更新。');
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy('');
    }
  };
  const removeRule = async (id: string) => {
    try {
      await api(`admin/rules/${id}`, { method: 'DELETE' });
      setRules((list) => list.filter((r) => r.id !== id));
      setNotice('建立資格已更新。');
    } catch (e) {
      setError(err(e));
    }
  };
  const sync = async () => {
    setBusy('chrome');
    setError('');
    try {
      const result = await api<{ chrome: ChromeSnapshot }>('admin/chrome/sync', { method: 'POST' });
      setChrome(result.chrome);
      setChromeCache(result.chrome);
      onChrome(result.chrome);
      setNotice('已從官網同步中英文導覽列與頁尾。');
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="admin-page page-wrap">
      <button className="back-link" onClick={() => go('dashboard')}>
        <ArrowLeft size={16} /> 返回工作區
      </button>
      <div className="admin-header">
        <span className="eyebrow">CONTROL ROOM</span>
        <h1>管理平台設定</h1>
        <p>設定生成模型與建立資格；共用版位可從官網即時同步。</p>
      </div>
      {error && <p className="error-message">{error}</p>}
      {notice && <p className="success-message">{notice}</p>}
      <div className="admin-grid">
        <section className="admin-card">
          <div className="admin-card-icon">
            <WandSparkles size={21} />
          </div>
          <h2>LLM API</h2>
          <p>API key 儲存在 Cloudflare secret；此處設定相容 OpenAI 的服務網址與多模態模型。</p>
          <form onSubmit={saveLlm}>
            <label>
              Base URL
              <input
                type="url"
                value={llm.baseUrl}
                onChange={(e) => setLlm({ ...llm, baseUrl: e.target.value })}
                placeholder="https://api.example.com/v1"
                required
              />
            </label>
            <label>
              模型名稱
              <input
                value={llm.model}
                onChange={(e) => setLlm({ ...llm, model: e.target.value })}
                placeholder="支援圖片輸入的模型名稱"
                required
              />
            </label>
            <button className="primary-button" disabled={!!busy}>
              <Save size={16} /> 儲存設定
            </button>
          </form>
        </section>
        <section className="admin-card">
          <div className="admin-card-icon">
            <Shield size={21} />
          </div>
          <h2>建立資格</h2>
          <p>管理可建立活動頁的帳號、網域與 Google Groups。移除後，下次請求即重新驗證。</p>
          <form onSubmit={addRule} className="rule-form">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as Rule['kind'])}
              aria-label="規則種類"
            >
              <option value="email">指定信箱</option>
              <option value="domain">整個網域</option>
              <option value="group">Google Group</option>
            </select>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={kind === 'domain' ? 'ntusa.ntu.edu.tw' : 'name@ntusa.ntu.edu.tw'}
              required
            />
            <button className="secondary-button" disabled={!!busy}>
              <Plus size={16} /> 新增
            </button>
          </form>
          <div className="rule-list">
            {rules.length ? (
              rules.map((r) => (
                <div className="rule-row" key={r.id}>
                  <span className="rule-kind">
                    {r.kind === 'email' ? '信箱' : r.kind === 'domain' ? '網域' : '群組'}
                  </span>
                  <span>{r.value}</span>
                  <button title="移除" onClick={() => removeRule(r.id)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            ) : (
              <div className="rule-empty">尚無規則，只有管理員可建立活動。</div>
            )}
          </div>
        </section>
        <section className="admin-card chrome-card">
          <div className="admin-card-icon">
            <Link2 size={21} />
          </div>
          <h2>官網共用元件</h2>
          <p>
            從 ntusa.ntu.edu.tw
            擷取中英文公開導覽列、手機選單與頁尾。通過結構檢查後會立即套用到平台與所有分享頁。
          </p>
          <div className="sync-status">
            <span className="status-dot" />{' '}
            {chrome
              ? `上次同步：${formatDate(chrome.syncedAt)}`
              : '使用內建官網版位；尚未執行首次同步'}
          </div>
          <button className="primary-button" disabled={!!busy} onClick={sync}>
            {busy === 'chrome' ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <RotateCcw size={16} />
            )}{' '}
            更新共用元件
          </button>
        </section>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
