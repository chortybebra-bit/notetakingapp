import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { DECISION_HTML, MEETING_HTML, TASKS_HTML, welcomeHtml } from '../content/templates'
import {
  PagesContext,
  isRoot,
  localDate,
  pageLabel,
  pathTo,
  readIndex,
  readPages,
  wouldCycle,
  type PageIndex,
  type PageKind,
  type PageRec,
  type PageValue,
} from '../lib/pages'
import { usePeers, useRelayOnline } from '../lib/presence'
import {
  copyText,
  inviteLink,
  randomId,
  randomIdentity,
  upsertSpace,
  type Identity,
  type SavedSpace,
} from '../lib/storage'
import { metaRoom, openRoom, pageRoom, type RoomHandle } from '../sync/relayRoom'
import { InstallButton } from './InstallButton'
import { PageEditor } from './PageEditor'
import { TasksView } from './TasksView'

const BoardEditor = lazy(() => import('./BoardEditor'))

const ICONS = ['📁', '📄', '✅', '🐞', '💡', '🚀', '🎯', '📣', '💬', '📊', '🧩', '🗺️', '🔒', '⚙️', '📌', '⭐', '🔥', '🧪', '📦', '🛠️', '📈', '🗂️', '🧠', '🔗']

type NewPage = { title: string; html?: string; kind?: PageKind; icon?: string; navigate?: boolean }

type ReminderState = 'unsupported' | 'default' | 'granted' | 'denied'

const reminderState = (): ReminderState =>
  'Notification' in window && window.isSecureContext ? Notification.permission : 'unsupported'

function useRoom(room: string | null, secret: string) {
  const [handle, setHandle] = useState<RoomHandle | null>(null)
  useEffect(() => {
    if (!room) return
    const opened = openRoom(room, secret)
    let cancel = false
    void opened.ready.then(() => {
      if (!cancel) setHandle(opened)
    })
    return () => {
      cancel = true
      opened.release()
      setHandle(null)
    }
  }, [room, secret])
  return handle
}

function loadCollapsed(vaultId: string) {
  try {
    const raw = JSON.parse(localStorage.getItem(`folio-collapsed-${vaultId}`) || '[]')
    return new Set<string>(Array.isArray(raw) ? raw.filter((item) => typeof item === 'string') : [])
  } catch {
    return new Set<string>()
  }
}

export function Workspace({ space }: { space: SavedSpace }) {
  const { vaultId, secret } = space
  const meta = useRoom(metaRoom(vaultId), secret)
  const [identity, setIdentityState] = useState<Identity>(space.identity)
  const [teamName, setTeamName] = useState(space.name)
  const [pages, setPages] = useState<PageRec[]>([])
  const [index, setIndex] = useState<Record<string, PageIndex>>({})
  const [activeId, setActiveId] = useState<string | null>(null)
  const [view, setView] = useState<'page' | 'tasks'>('page')
  const [seeds, setSeeds] = useState<Record<string, string>>({})
  const [boardSeeds, setBoardSeeds] = useState<Set<string>>(() => new Set())
  const [filter, setFilter] = useState('')
  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia('(min-width: 761px)').matches)
  const [newMenu, setNewMenu] = useState(false)
  const [iconMenu, setIconMenu] = useState(false)
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(vaultId))
  const [dragId, setDragId] = useState<string | null>(null)
  const [reminders, setReminders] = useState<ReminderState>(reminderState)
  const relayOnline = useRelayOnline()

  useEffect(() => {
    if (!meta) return
    const info = meta.doc.getMap<string>('info')
    const pageMap = meta.doc.getMap<PageValue>('pages')
    const indexMap = meta.doc.getMap<PageIndex>('index')
    const refresh = () => {
      setPages(readPages(pageMap))
      const name = info.get('name')
      if (typeof name === 'string' && name.trim()) {
        setTeamName(name)
        upsertSpace(vaultId, secret, { name })
      }
    }
    const refreshIndex = () => setIndex(readIndex(indexMap))
    info.observe(refresh)
    pageMap.observe(refresh)
    indexMap.observe(refreshIndex)
    refresh()
    refreshIndex()

    const creatorLabel = sessionStorage.getItem(`folio-creator-${vaultId}`)
    if (creatorLabel && pageMap.size === 0) {
      const id = randomId()
      meta.doc.transact(() => {
        if (pageMap.size !== 0) return
        info.set('name', creatorLabel)
        pageMap.set(id, { title: 'Welcome', parentId: '', created: Date.now(), icon: '👋' })
      })
      if (pageMap.has(id)) {
        setSeeds({ [id]: welcomeHtml() })
        setActiveId(id)
      }
      sessionStorage.removeItem(`folio-creator-${vaultId}`)
    }

    return () => {
      info.unobserve(refresh)
      pageMap.unobserve(refresh)
      indexMap.unobserve(refreshIndex)
    }
  }, [meta, secret, vaultId])

  useEffect(() => {
    if (!pages.length) return
    if (!activeId || !pages.some((page) => page.id === activeId)) {
      setActiveId(pages[0].id)
    }
  }, [pages, activeId])

  useEffect(() => {
    localStorage.setItem(`folio-collapsed-${vaultId}`, JSON.stringify([...collapsed]))
  }, [collapsed, vaultId])

  const active = pages.find((page) => page.id === activeId) ?? null
  const pageHandle = useRoom(active && view === 'page' ? pageRoom(vaultId, active.id) : null, secret)
  const peers = usePeers(meta?.provider.awareness ?? null)

  useEffect(() => {
    if (!meta) return
    meta.provider.awareness.setLocalStateField('user', {
      name: identity.name || 'Anonymous',
      color: identity.color,
      pageTitle: view === 'tasks' ? 'Tasks' : active?.title || 'Untitled',
    })
  }, [meta, identity, active, view])

  function setIdentity(next: Identity) {
    setIdentityState(next)
    upsertSpace(vaultId, secret, { identity: next })
  }

  useEffect(() => {
    document.title = `${teamName} · Folio`
  }, [teamName])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const dueTasks = useMemo(() => {
    const today = localDate()
    const live = new Set(pages.map((page) => page.id))
    return Object.entries(index)
      .filter(([pageId]) => live.has(pageId))
      .flatMap(([, entry]) => entry.tasks)
      .filter((task) => !task.done && task.due && task.due <= today)
  }, [index, pages])

  useEffect(() => {
    if (reminders !== 'granted' || dueTasks.length === 0) return
    const key = `folio-reminded-${vaultId}`
    const today = localDate()
    if (localStorage.getItem(key) === today) return
    const timer = window.setTimeout(() => {
      localStorage.setItem(key, today)
      const lines = dueTasks.slice(0, 4).map((task) => `• ${task.text || 'Untitled task'}`)
      new Notification(`${teamName}: ${dueTasks.length} task${dueTasks.length === 1 ? '' : 's'} due`, {
        body: lines.join('\n'),
        tag: `folio-${vaultId}`,
      })
    }, 2500)
    return () => window.clearTimeout(timer)
  }, [dueTasks, reminders, teamName, vaultId])

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return pages
    return pages.filter((page) => pageLabel(page).toLowerCase().includes(needle))
  }, [filter, pages])

  const openPage = useCallback((id: string) => {
    setView('page')
    setActiveId(id)
    setIconMenu(false)
    if (!window.matchMedia('(min-width: 761px)').matches) setSidebarOpen(false)
  }, [])

  const pagesApi = useMemo(
    () => ({ byId: new Map(pages.map((page) => [page.id, page])), open: openPage }),
    [pages, openPage],
  )

  function updatePage(id: string, patch: Partial<PageValue>) {
    if (!meta) return
    const map = meta.doc.getMap<PageValue>('pages')
    const current = map.get(id)
    if (!current) return
    map.set(id, { ...current, ...patch })
  }

  const createPage = useCallback(
    (parentId: string, { title, html, kind = 'page', icon, navigate = true }: NewPage) => {
      if (!meta) return null
      const id = randomId()
      const value: PageValue = { title, parentId, created: Date.now(), kind }
      if (icon) value.icon = icon
      meta.doc.getMap<PageValue>('pages').set(id, value)
      if (html) setSeeds((current) => ({ ...current, [id]: html }))
      if (kind === 'board') setBoardSeeds((current) => new Set(current).add(id))
      if (parentId) {
        setCollapsed((current) => {
          if (!current.has(parentId)) return current
          const next = new Set(current)
          next.delete(parentId)
          return next
        })
      }
      setNewMenu(false)
      if (navigate) openPage(id)
      return id
    },
    [meta, openPage],
  )

  function movePage(id: string, parentId: string) {
    if (wouldCycle(id, parentId, pages)) return
    const page = pages.find((item) => item.id === id)
    if (!page || page.parentId === parentId) return
    updatePage(id, { parentId })
    if (parentId) {
      setCollapsed((current) => {
        const next = new Set(current)
        next.delete(parentId)
        return next
      })
    }
  }

  function deletePage(id: string) {
    if (!meta) return
    if (!window.confirm('Delete this page and its subpages for the whole team?')) return
    const map = meta.doc.getMap<PageValue>('pages')
    const indexMap = meta.doc.getMap<PageIndex>('index')
    const all = readPages(map)
    const drop = new Set<string>()
    const walk = (pageId: string) => {
      if (drop.has(pageId)) return
      drop.add(pageId)
      all.filter((page) => page.parentId === pageId).forEach((child) => walk(child.id))
    }
    walk(id)
    meta.doc.transact(() => {
      drop.forEach((pageId) => {
        map.delete(pageId)
        indexMap.delete(pageId)
      })
    })
  }

  const writeIndex = useCallback(
    (pageId: string, next: PageIndex) => {
      if (!meta) return
      const map = meta.doc.getMap<PageIndex>('index')
      if (!meta.doc.getMap<PageValue>('pages').has(pageId)) return
      if (JSON.stringify(map.get(pageId)) === JSON.stringify(next)) return
      map.set(pageId, next)
    },
    [meta],
  )

  async function toggleTask(pageId: string, taskId: string, done: boolean) {
    if (!meta) return
    const indexMap = meta.doc.getMap<PageIndex>('index')
    const entry = indexMap.get(pageId)
    if (entry) {
      indexMap.set(pageId, { ...entry, tasks: entry.tasks.map((task) => (task.id === taskId ? { ...task, done } : task)) })
    }
    const handle = openRoom(pageRoom(vaultId, pageId), secret)
    await handle.ready
    const walk = (node: Y.XmlFragment | Y.XmlElement): boolean => {
      for (const child of node.toArray()) {
        if (!(child instanceof Y.XmlElement)) continue
        if (child.nodeName === 'taskItem' && child.getAttribute('taskId') === taskId) {
          child.setAttribute('checked', done as unknown as string)
          return true
        }
        if (walk(child)) return true
      }
      return false
    }
    handle.doc.transact(() => walk(handle.doc.getXmlFragment('default')))
    window.setTimeout(() => handle.release(), 3000)
  }

  async function enableReminders() {
    if (reminderState() === 'unsupported') return
    setReminders(await Notification.requestPermission())
  }

  function toggleCollapsed(id: string) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const link = inviteLink(vaultId, secret)
  const others = peers.filter((peer) => !peer.self)
  const children = active ? pages.filter((page) => page.parentId === active.id) : []
  const backlinks = active
    ? pages.filter((page) => page.id !== active.id && index[page.id]?.links.includes(active.id))
    : []
  const crumbs = active ? pathTo(active.id, pages) : []

  return (
    <PagesContext.Provider value={pagesApi}>
      <div className={sidebarOpen ? 'workspace' : 'workspace sidebar-collapsed'}>
        <button type="button" className="backdrop" aria-label="Close pages" onClick={() => setSidebarOpen(false)} />
        <aside className="sidebar">
          <div className="side-brand">
            <button type="button" className="brand" onClick={() => (location.hash = '')}>
              Folio
            </button>
            <button
              type="button"
              className="icon-button mobile-only"
              aria-label="Close sidebar"
              onClick={() => setSidebarOpen(false)}
            >
              Close
            </button>
          </div>
          <input
            className="team-name"
            aria-label="Team name"
            value={teamName}
            maxLength={80}
            onChange={(event) => {
              const name = event.target.value
              setTeamName(name)
              meta?.doc.getMap<string>('info').set('name', name)
            }}
          />
          <div className="field compact">
            <span>Your alias in this space</span>
            <div className="alias-row">
              <input
                aria-label="Your alias"
                value={identity.name}
                maxLength={40}
                onChange={(event) => setIdentity({ ...identity, name: event.target.value })}
              />
              <button
                type="button"
                className="row-action"
                aria-label="New random alias"
                title="New random alias"
                onClick={() => setIdentity(randomIdentity())}
              >
                ↻
              </button>
            </div>
          </div>
          <button
            type="button"
            className={view === 'tasks' ? 'nav-tasks is-active' : 'nav-tasks'}
            onClick={() => {
              setView('tasks')
              if (!window.matchMedia('(min-width: 761px)').matches) setSidebarOpen(false)
            }}
          >
            <span>✓ Tasks</span>
            {dueTasks.length > 0 && (
              <span className="due-badge" title="Due today or overdue">
                {dueTasks.length}
              </span>
            )}
          </button>
          <div className="side-actions">
            <button type="button" className="secondary slim" onClick={() => setNewMenu((open) => !open)}>
              New
            </button>
            {newMenu && (
              <div className="new-menu">
                <button type="button" onClick={() => createPage('', { title: 'Untitled' })}>
                  📄 Page
                </button>
                <button type="button" onClick={() => createPage('', { title: 'New section', icon: '📁' })}>
                  📁 Section <small>groups pages</small>
                </button>
                <button type="button" onClick={() => createPage('', { title: 'To-do', icon: '✅', html: TASKS_HTML })}>
                  ✅ Task list
                </button>
                <button type="button" onClick={() => createPage('', { title: 'Board', icon: '🗺️', kind: 'board' })}>
                  🗺️ Board <small>diagram</small>
                </button>
                <button type="button" onClick={() => createPage('', { title: 'Meeting notes', html: MEETING_HTML })}>
                  Meeting notes
                </button>
                <button type="button" onClick={() => createPage('', { title: 'Decision', html: DECISION_HTML })}>
                  Decision log
                </button>
              </div>
            )}
          </div>
          <input
            className="filter"
            placeholder="Filter pages"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-label="Filter pages"
          />
          <nav className="page-tree" aria-label="Pages">
            {meta && pages.length === 0 && (
              <p className="side-note">Waiting for pages. They arrive as soon as the server has a copy.</p>
            )}
            {dragId && (
              <div
                className="root-drop"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  movePage(dragId, '')
                  setDragId(null)
                }}
              >
                Drop here for top level
              </div>
            )}
            {(filter.trim() ? visible : pages.filter((page) => isRoot(page, pages))).map((page) => (
              <PageBranch
                key={page.id}
                page={page}
                pages={filter.trim() ? [] : pages}
                depth={0}
                activeId={view === 'page' ? activeId : null}
                collapsed={collapsed}
                dragId={dragId}
                onToggle={toggleCollapsed}
                onOpen={openPage}
                onCreateChild={(parentId) => createPage(parentId, { title: 'Untitled' })}
                onDelete={deletePage}
                onDrag={setDragId}
                onDropOn={(targetId) => {
                  if (dragId) movePage(dragId, targetId)
                  setDragId(null)
                }}
                trail={[]}
              />
            ))}
          </nav>
          <div className="presence">
            <h2>Online</h2>
            {peers.length === 0 && <p>Connecting…</p>}
            {peers.map((peer) => (
              <div key={peer.clientId} className="peer">
                <i style={{ background: peer.color || '#d06a3a' }} />
                <span>
                  {peer.name || 'Teammate'}
                  {peer.self ? ' (you)' : ''}
                </span>
                <small>{peer.pageTitle || 'a page'}</small>
              </div>
            ))}
            <InstallButton className="secondary slim install" />
          </div>
        </aside>

        <section className="stage">
          <header className="topbar">
            <button type="button" className="icon-button mobile-only" onClick={() => setSidebarOpen(true)}>
              Pages
            </button>
            <div className="status-line">
              <span className="lock">Encrypted</span>
              <span className={relayOnline ? 'dot on' : 'dot'} />
              <span>{relayOnline ? 'Synced through blind relay' : 'Offline — edits saved on this device'}</span>
              <span className="muted">
                {others.length ? `${others.length} other${others.length === 1 ? '' : 's'} here` : 'Only you'}
              </span>
              {dueTasks.length > 0 && view !== 'tasks' && (
                <button type="button" className="due-pill" onClick={() => setView('tasks')}>
                  {dueTasks.length} due
                </button>
              )}
            </div>
            <button type="button" className="primary slim" onClick={() => setShareOpen((open) => !open)}>
              Share
            </button>
            {shareOpen && (
              <div className="share-pop" role="dialog" aria-label="Invite teammates">
                <h2>Invite someone</h2>
                <p>
                  This link is the key to the space: anyone who has it can read and edit. The part after # never
                  reaches the server. Send it over an end-to-end encrypted chat.
                </p>
                <textarea readOnly value={link} rows={3} onFocus={(event) => event.currentTarget.select()} />
                <div className="share-actions">
                  <button
                    type="button"
                    className="primary slim"
                    onClick={() => {
                      copyText(link).then(
                        () => {
                          setCopied(true)
                          window.setTimeout(() => setCopied(false), 1600)
                        },
                        () => {},
                      )
                    }}
                  >
                    {copied ? 'Copied' : 'Copy invite link'}
                  </button>
                  <button type="button" className="text-button" onClick={() => setShareOpen(false)}>
                    Close
                  </button>
                </div>
              </div>
            )}
          </header>

          {!meta && <div className="loading">Unlocking this space…</div>}
          {meta && view === 'tasks' && (
            <article className="sheet">
              <TasksView
                pages={pages}
                index={index}
                reminders={reminders}
                onEnableReminders={() => void enableReminders()}
                onOpen={openPage}
                onToggle={(pageId, taskId, done) => void toggleTask(pageId, taskId, done)}
              />
            </article>
          )}
          {meta && view === 'page' && !active && <div className="loading">No pages yet.</div>}
          {meta && view === 'page' && active && (
            <article className={active.kind === 'board' ? 'sheet is-board' : 'sheet'}>
              {crumbs.length > 0 && (
                <nav className="crumbs" aria-label="Breadcrumbs">
                  {crumbs.map((page) => (
                    <button key={page.id} type="button" onClick={() => openPage(page.id)}>
                      {page.icon ? `${page.icon} ` : ''}
                      {pageLabel(page)}
                    </button>
                  ))}
                </nav>
              )}
              <div className="title-row">
                <div className="icon-slot">
                  <button
                    type="button"
                    className={active.icon ? 'page-icon' : 'page-icon is-empty'}
                    aria-label="Page icon"
                    title="Page icon"
                    onClick={() => setIconMenu((open) => !open)}
                  >
                    {active.icon || '＋'}
                  </button>
                  {iconMenu && (
                    <div className="icon-menu">
                      {ICONS.map((icon) => (
                        <button
                          key={icon}
                          type="button"
                          onClick={() => {
                            updatePage(active.id, { icon })
                            setIconMenu(false)
                          }}
                        >
                          {icon}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="icon-clear"
                        onClick={() => {
                          updatePage(active.id, { icon: '' })
                          setIconMenu(false)
                        }}
                      >
                        None
                      </button>
                    </div>
                  )}
                </div>
                <input
                  className="page-title"
                  aria-label="Page title"
                  value={active.title}
                  placeholder="Untitled"
                  maxLength={200}
                  onChange={(event) => updatePage(active.id, { title: event.target.value })}
                />
              </div>

              {(children.length > 0 || active.kind === 'page') && (
                <SubpageCards
                  pages={children}
                  index={index}
                  onOpen={openPage}
                  onAdd={(kind) =>
                    createPage(active.id, kind === 'board' ? { title: 'Board', icon: '🗺️', kind } : { title: 'Untitled' })
                  }
                />
              )}

              {!pageHandle && <div className="loading tight">Opening page…</div>}
              {pageHandle && active.kind === 'board' && (
                <Suspense fallback={<div className="loading tight">Loading board…</div>}>
                  <BoardEditor key={active.id} doc={pageHandle.doc} seed={boardSeeds.has(active.id)} />
                </Suspense>
              )}
              {pageHandle && active.kind === 'page' && (
                <PageEditor
                  key={active.id}
                  doc={pageHandle.doc}
                  provider={pageHandle.provider}
                  identity={identity}
                  seedHtml={seeds[active.id] ?? null}
                  pageId={active.id}
                  pages={pages}
                  onCreatePage={(title) => createPage(active.id, { title, navigate: false })}
                  onIndex={(next) => writeIndex(active.id, next)}
                />
              )}

              {backlinks.length > 0 && (
                <footer className="backlinks">
                  <h2>Linked from</h2>
                  <div>
                    {backlinks.map((page) => (
                      <button key={page.id} type="button" className="chip" onClick={() => openPage(page.id)}>
                        {page.icon ? `${page.icon} ` : '↗ '}
                        {pageLabel(page)}
                      </button>
                    ))}
                  </div>
                </footer>
              )}
            </article>
          )}
        </section>
      </div>
    </PagesContext.Provider>
  )
}

function SubpageCards({
  pages,
  index,
  onOpen,
  onAdd,
}: {
  pages: PageRec[]
  index: Record<string, PageIndex>
  onOpen: (id: string) => void
  onAdd: (kind: PageKind) => void
}) {
  return (
    <div className={pages.length ? 'subpages' : 'subpages is-empty'}>
      {pages.map((page) => {
        const tasks = index[page.id]?.tasks ?? []
        const open = tasks.filter((task) => !task.done).length
        return (
          <button key={page.id} type="button" className="subpage-card" onClick={() => onOpen(page.id)}>
            <span className="subpage-icon">{page.icon || (page.kind === 'board' ? '🗺️' : '📄')}</span>
            <span className="subpage-title">{pageLabel(page)}</span>
            <small>{page.kind === 'board' ? 'Board' : open ? `${open} open task${open === 1 ? '' : 's'}` : 'Page'}</small>
          </button>
        )
      })}
      <div className="subpage-add">
        <button type="button" onClick={() => onAdd('page')}>
          + Subpage
        </button>
        <button type="button" onClick={() => onAdd('board')}>
          + Board
        </button>
      </div>
    </div>
  )
}

function PageBranch({
  page,
  pages,
  depth,
  activeId,
  collapsed,
  dragId,
  onToggle,
  onOpen,
  onCreateChild,
  onDelete,
  onDrag,
  onDropOn,
  trail,
}: {
  page: PageRec
  pages: PageRec[]
  depth: number
  activeId: string | null
  collapsed: Set<string>
  dragId: string | null
  onToggle: (id: string) => void
  onOpen: (id: string) => void
  onCreateChild: (parentId: string) => void
  onDelete: (id: string) => void
  onDrag: (id: string | null) => void
  onDropOn: (targetId: string) => void
  trail: string[]
}) {
  const [over, setOver] = useState(false)
  if (trail.includes(page.id)) return null
  const children = pages.filter((item) => item.parentId === page.id)
  const isCollapsed = collapsed.has(page.id)
  const canDrop = Boolean(dragId) && !wouldCycle(dragId as string, page.id, pages)
  const classes = ['page-row']
  if (page.id === activeId) classes.push('is-active')
  if (over && canDrop) classes.push('is-drop')
  return (
    <div>
      <div
        className={classes.join(' ')}
        style={{ paddingLeft: 2 + depth * 14 }}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', page.id)
          event.dataTransfer.effectAllowed = 'move'
          onDrag(page.id)
        }}
        onDragEnd={() => onDrag(null)}
        onDragOver={(event) => {
          if (!canDrop) return
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setOver(false)
          if (canDrop) onDropOn(page.id)
        }}
      >
        <button
          type="button"
          className={children.length ? 'caret' : 'caret is-leaf'}
          aria-label={isCollapsed ? 'Expand' : 'Collapse'}
          onClick={() => children.length && onToggle(page.id)}
        >
          {children.length ? (isCollapsed ? '▸' : '▾') : '•'}
        </button>
        <button type="button" className="page-link" onClick={() => onOpen(page.id)}>
          {page.icon && <span className="row-icon">{page.icon}</span>}
          {pageLabel(page)}
        </button>
        <button type="button" className="row-action" aria-label="Add subpage" onClick={() => onCreateChild(page.id)}>
          +
        </button>
        <button
          type="button"
          className="row-action"
          aria-label={`Delete ${page.title || 'page'}`}
          onClick={() => onDelete(page.id)}
        >
          ×
        </button>
      </div>
      {!isCollapsed &&
        children.map((child) => (
          <PageBranch
            key={child.id}
            page={child}
            pages={pages}
            depth={depth + 1}
            activeId={activeId}
            collapsed={collapsed}
            dragId={dragId}
            onToggle={onToggle}
            onOpen={onOpen}
            onCreateChild={onCreateChild}
            onDelete={onDelete}
            onDrag={onDrag}
            onDropOn={onDropOn}
            trail={[...trail, page.id]}
          />
        ))}
    </div>
  )
}
