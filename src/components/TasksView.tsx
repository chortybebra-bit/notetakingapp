import { useMemo, useState } from 'react'
import {
  PRIORITIES,
  dueInfo,
  localDate,
  pageLabel,
  pathTo,
  priorityLabel,
  priorityRank,
  type PageIndex,
  type PageRec,
  type Priority,
  type TaskSummary,
} from '../lib/pages'

type Row = { task: TaskSummary; page: PageRec; section: PageRec }

const GROUPS = [
  { id: 'overdue', title: 'Overdue' },
  { id: 'today', title: 'Today' },
  { id: 'week', title: 'Next 7 days' },
  { id: 'later', title: 'Later' },
  { id: 'none', title: 'No date' },
  { id: 'done', title: 'Done' },
] as const

type GroupId = (typeof GROUPS)[number]['id']

function groupOf(task: TaskSummary): GroupId {
  if (task.done) return 'done'
  if (!task.due) return 'none'
  const today = localDate()
  if (task.due < today) return 'overdue'
  if (task.due === today) return 'today'
  if (task.due <= localDate(7)) return 'week'
  return 'later'
}

export function TasksView({
  pages,
  index,
  reminders,
  onEnableReminders,
  onOpen,
  onToggle,
}: {
  pages: PageRec[]
  index: Record<string, PageIndex>
  reminders: 'unsupported' | 'default' | 'granted' | 'denied'
  onEnableReminders: () => void
  onOpen: (pageId: string) => void
  onToggle: (pageId: string, taskId: string, done: boolean) => void
}) {
  const [section, setSection] = useState('all')
  const [priority, setPriority] = useState<'all' | 'any' | Priority>('all')
  const [search, setSearch] = useState('')
  const [showDone, setShowDone] = useState(false)

  const sections = useMemo(() => pages.filter((page) => !page.parentId || !pages.some((p) => p.id === page.parentId)), [pages])

  const rows = useMemo(() => {
    const byId = new Map(pages.map((page) => [page.id, page]))
    const out: Row[] = []
    for (const [pageId, entry] of Object.entries(index)) {
      const page = byId.get(pageId)
      if (!page) continue
      const section = pathTo(pageId, pages)[0] ?? page
      for (const task of entry.tasks) {
        if (!task.text.trim() && !task.due && !task.priority) continue
        out.push({ task, page, section })
      }
    }
    return out
  }, [index, pages])

  const filtered = rows.filter(({ task, section: top }) => {
    if (section !== 'all' && top.id !== section) return false
    if (priority === 'any' && !task.priority) return false
    if (priority !== 'all' && priority !== 'any' && task.priority !== priority) return false
    if (!showDone && task.done) return false
    if (search.trim() && !task.text.toLowerCase().includes(search.trim().toLowerCase())) return false
    return true
  })

  const grouped = GROUPS.map((group) => ({
    ...group,
    rows: filtered
      .filter((row) => groupOf(row.task) === group.id)
      .sort(
        (a, b) =>
          priorityRank(a.task.priority) - priorityRank(b.task.priority) ||
          (a.task.due || '9999').localeCompare(b.task.due || '9999') ||
          a.task.text.localeCompare(b.task.text),
      ),
  })).filter((group) => group.rows.length > 0)

  const open = rows.filter((row) => !row.task.done).length

  return (
    <div className="tasks-view">
      <header className="tasks-head">
        <div>
          <h1>Tasks</h1>
          <p className="tasks-sub">
            {open} open across all pages. Add tasks anywhere with <kbd>/todo</kbd>, then set priority and date with ⚑.
          </p>
        </div>
        <div className="reminder-box">
          {reminders === 'granted' && <span className="reminder-on">Reminders on</span>}
          {reminders === 'default' && (
            <button type="button" className="secondary slim" onClick={onEnableReminders}>
              Turn on reminders
            </button>
          )}
          {reminders === 'denied' && <span className="muted-text">Notifications are blocked in this browser</span>}
          {reminders === 'unsupported' && (
            <span className="muted-text">Pop-up reminders need https. Due tasks are counted in the sidebar.</span>
          )}
        </div>
      </header>

      <div className="tasks-filters">
        <input
          className="tasks-search"
          placeholder="Search tasks"
          aria-label="Search tasks"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select aria-label="Section" value={section} onChange={(event) => setSection(event.target.value)}>
          <option value="all">All sections</option>
          {sections.map((page) => (
            <option key={page.id} value={page.id}>
              {page.icon ? `${page.icon} ` : ''}
              {pageLabel(page)}
            </option>
          ))}
        </select>
        <select
          aria-label="Priority"
          value={priority}
          onChange={(event) => setPriority(event.target.value as typeof priority)}
        >
          <option value="all">Any priority</option>
          <option value="any">Has priority</option>
          {PRIORITIES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <label className="tasks-done-toggle">
          <input type="checkbox" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} />
          Show done
        </label>
      </div>

      {grouped.length === 0 && (
        <p className="tasks-empty">
          {rows.length === 0
            ? 'No tasks yet. Type /todo on any page to add one.'
            : 'Nothing matches these filters.'}
        </p>
      )}

      {grouped.map((group) => (
        <section key={group.id} className={`task-group group-${group.id}`}>
          <h2>
            {group.title} <span>{group.rows.length}</span>
          </h2>
          {group.rows.map(({ task, page }) => {
            const due = dueInfo(task.due)
            const trail = [...pathTo(page.id, pages), page].map(pageLabel).join(' › ')
            return (
              <div key={`${page.id}:${task.id}`} className={task.done ? 'task-row is-done' : 'task-row'}>
                <input
                  type="checkbox"
                  aria-label={task.done ? 'Mark as not done' : 'Mark as done'}
                  checked={task.done}
                  onChange={(event) => onToggle(page.id, task.id, event.target.checked)}
                />
                <button type="button" className="task-row-main" onClick={() => onOpen(page.id)}>
                  <span className="task-row-text">{task.text || 'Untitled task'}</span>
                  <span className="task-row-page">{trail}</span>
                </button>
                {task.priority && <span className={`chip prio-${task.priority}`}>{priorityLabel(task.priority)}</span>}
                {due && <span className={`chip due-${task.done ? 'done' : due.tone}`}>{due.label}</span>}
              </div>
            )
          })}
        </section>
      ))}
    </div>
  )
}
