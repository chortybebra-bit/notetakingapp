import { useEffect, useMemo, useState } from 'react'
import type { Map as YMap } from 'yjs'
import { DECISION_HTML, MEETING_HTML, WELCOME_HTML } from '../content/templates'
import { usePeers, useRelayOnline } from '../lib/presence'
import { inviteLink, randomIdentity, upsertSpace, type Identity, type SavedSpace } from '../lib/storage'
import { metaRoom, openRoom, pageRoom, type RoomHandle } from '../sync/relayRoom'
import { InstallButton } from './InstallButton'
import { PageEditor } from './PageEditor'

type PageValue = {
  title: string
  parentId: string
  created: number
}

type PageRec = PageValue & { id: string }

function readPages(map: YMap<PageValue>): PageRec[] {
  const pages: PageRec[] = []
  map.forEach((value, id) => {
    if (!value || typeof value !== 'object') return
    pages.push({
      id,
      title: typeof value.title === 'string' ? value.title : '',
      parentId: typeof value.parentId === 'string' ? value.parentId : '',
      created: typeof value.created === 'number' ? value.created : 0,
    })
  })
  pages.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id))
  return pages
}

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

export function Workspace({ space }: { space: SavedSpace }) {
  const { vaultId, secret } = space
  const meta = useRoom(metaRoom(vaultId), secret)
  const [identity, setIdentityState] = useState<Identity>(space.identity)
  const [teamName, setTeamName] = useState(space.name)
  const [pages, setPages] = useState<PageRec[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [seeds, setSeeds] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState('')
  const [shareOpen, setShareOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia('(min-width: 761px)').matches)
  const [newMenu, setNewMenu] = useState(false)
  const relayOnline = useRelayOnline()

  useEffect(() => {
    if (!meta) return
    const info = meta.doc.getMap<string>('info')
    const pageMap = meta.doc.getMap<PageValue>('pages')
    const refresh = () => {
      const nextPages = readPages(pageMap)
      setPages(nextPages)
      const name = info.get('name')
      if (typeof name === 'string' && name.trim()) {
        setTeamName(name)
        upsertSpace(vaultId, secret, { name })
      }
    }
    info.observe(refresh)
    pageMap.observe(refresh)
    refresh()

    const creatorLabel = sessionStorage.getItem(`folio-creator-${vaultId}`)
    if (creatorLabel && pageMap.size === 0) {
      const id = crypto.randomUUID()
      meta.doc.transact(() => {
        if (pageMap.size !== 0) return
        info.set('name', creatorLabel)
        pageMap.set(id, { title: 'Welcome', parentId: '', created: Date.now() })
      })
      if (pageMap.has(id)) {
        setSeeds({ [id]: WELCOME_HTML })
        setActiveId(id)
      }
      sessionStorage.removeItem(`folio-creator-${vaultId}`)
    }

    return () => {
      info.unobserve(refresh)
      pageMap.unobserve(refresh)
    }
  }, [meta, secret, vaultId])

  useEffect(() => {
    if (!pages.length) return
    if (!activeId || !pages.some((page) => page.id === activeId)) {
      setActiveId(pages[0].id)
    }
  }, [pages, activeId])

  const active = pages.find((page) => page.id === activeId) ?? null
  const pageHandle = useRoom(active ? pageRoom(vaultId, active.id) : null, secret)
  const peers = usePeers(meta?.provider.awareness ?? null)

  useEffect(() => {
    if (!meta) return
    meta.provider.awareness.setLocalStateField('user', {
      name: identity.name || 'Anonymous',
      color: identity.color,
      pageTitle: active?.title || 'Untitled',
    })
  }, [meta, identity, active])

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

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return pages
    return pages.filter((page) => (page.title || 'untitled').toLowerCase().includes(needle))
  }, [filter, pages])

  function updatePage(id: string, patch: Partial<PageValue>) {
    if (!meta) return
    const map = meta.doc.getMap<PageValue>('pages')
    const current = map.get(id)
    if (!current) return
    map.set(id, { ...current, ...patch })
  }

  function createPage(parentId: string, title: string, html: string | null) {
    if (!meta) return
    const id = crypto.randomUUID()
    meta.doc.getMap<PageValue>('pages').set(id, {
      title,
      parentId,
      created: Date.now(),
    })
    if (html) setSeeds((current) => ({ ...current, [id]: html }))
    setActiveId(id)
    setNewMenu(false)
    setSidebarOpen(true)
  }

  function deletePage(id: string) {
    if (!meta) return
    if (!window.confirm('Delete this page and its subpages for the whole team?')) return
    const map = meta.doc.getMap<PageValue>('pages')
    const all = readPages(map)
    const drop = new Set<string>()
    const walk = (pageId: string) => {
      if (drop.has(pageId)) return
      drop.add(pageId)
      all.filter((page) => page.parentId === pageId).forEach((child) => walk(child.id))
    }
    walk(id)
    meta.doc.transact(() => {
      drop.forEach((pageId) => map.delete(pageId))
    })
  }

  const link = inviteLink(vaultId, secret)
  const others = peers.filter((peer) => !peer.self)

  return (
    <div className={sidebarOpen ? 'workspace' : 'workspace sidebar-collapsed'}>
      <button
        type="button"
        className="backdrop"
        aria-label="Close pages"
        onClick={() => setSidebarOpen(false)}
      />
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
        <div className="side-actions">
          <button type="button" className="secondary slim" onClick={() => setNewMenu((open) => !open)}>
            New page
          </button>
          {newMenu && (
            <div className="new-menu">
              <button type="button" onClick={() => createPage('', 'Untitled', null)}>
                Blank page
              </button>
              <button type="button" onClick={() => createPage('', 'Meeting notes', MEETING_HTML)}>
                Meeting notes
              </button>
              <button type="button" onClick={() => createPage('', 'Decision', DECISION_HTML)}>
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
            <p className="side-note">
              Waiting for pages. They arrive as soon as the server has a copy.
            </p>
          )}
          {(filter.trim() ? visible : pages.filter((page) => isRoot(page, pages))).map((page) => (
            <PageBranch
              key={page.id}
              page={page}
              pages={filter.trim() ? [] : pages}
              depth={0}
              activeId={activeId}
              onOpen={setActiveId}
              onCreateChild={(parentId) => createPage(parentId, 'Untitled', null)}
              onDelete={deletePage}
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
          <button
            type="button"
            className="icon-button mobile-only"
            onClick={() => setSidebarOpen(true)}
          >
            Pages
          </button>
          <div className="status-line">
            <span className="lock">Encrypted</span>
            <span className={relayOnline ? 'dot on' : 'dot'} />
            <span>{relayOnline ? 'Synced through blind relay' : 'Offline — edits saved on this device'}</span>
            <span className="muted">
              {others.length ? `${others.length} other${others.length === 1 ? '' : 's'} here` : 'Only you'}
            </span>
          </div>
          <button type="button" className="primary slim" onClick={() => setShareOpen((open) => !open)}>
            Share
          </button>
          {shareOpen && (
            <div className="share-pop" role="dialog" aria-label="Invite teammates">
              <h2>Invite someone</h2>
              <p>
                This link is the key to the space: anyone who has it can read and edit. The part
                after # never reaches the server. Send it over an end-to-end encrypted chat.
              </p>
              <textarea readOnly value={link} rows={3} onFocus={(event) => event.currentTarget.select()} />
              <div className="share-actions">
                <button
                  type="button"
                  className="primary slim"
                  onClick={() => {
                    void navigator.clipboard.writeText(link).then(() => {
                      setCopied(true)
                      window.setTimeout(() => setCopied(false), 1600)
                    })
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
        {meta && !active && <div className="loading">No pages yet.</div>}
        {meta && active && (
          <article className="sheet">
            <input
              className="page-title"
              aria-label="Page title"
              value={active.title}
              placeholder="Untitled"
              maxLength={200}
              onChange={(event) => updatePage(active.id, { title: event.target.value })}
            />
            {pageHandle ? (
              <PageEditor
                key={active.id}
                doc={pageHandle.doc}
                provider={pageHandle.provider}
                identity={identity}
                seedHtml={seeds[active.id] ?? null}
              />
            ) : (
              <div className="loading tight">Opening page…</div>
            )}
          </article>
        )}
      </section>
    </div>
  )
}

function isRoot(page: PageRec, pages: PageRec[]) {
  if (!page.parentId) return true
  return !pages.some((item) => item.id === page.parentId)
}

function PageBranch({
  page,
  pages,
  depth,
  activeId,
  onOpen,
  onCreateChild,
  onDelete,
  trail,
}: {
  page: PageRec
  pages: PageRec[]
  depth: number
  activeId: string | null
  onOpen: (id: string) => void
  onCreateChild: (parentId: string) => void
  onDelete: (id: string) => void
  trail: string[]
}) {
  if (trail.includes(page.id)) return null
  const children = pages.filter((item) => item.parentId === page.id)
  return (
    <div>
      <div className={page.id === activeId ? 'page-row is-active' : 'page-row'} style={{ paddingLeft: 8 + depth * 14 }}>
        <button type="button" className="page-link" onClick={() => onOpen(page.id)}>
          {page.title.trim() || 'Untitled'}
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
      {children.map((child) => (
        <PageBranch
          key={child.id}
          page={child}
          pages={pages}
          depth={depth + 1}
          activeId={activeId}
          onOpen={onOpen}
          onCreateChild={onCreateChild}
          onDelete={onDelete}
          trail={[...trail, page.id]}
        />
      ))}
    </div>
  )
}
