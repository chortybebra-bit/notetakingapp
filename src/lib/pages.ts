import { createContext } from 'react'
import type { Map as YMap } from 'yjs'

export type PageKind = 'page' | 'board'

export type PageValue = {
  title: string
  parentId: string
  created: number
  icon?: string
  kind?: PageKind
}

export type PageRec = {
  id: string
  title: string
  parentId: string
  created: number
  icon: string
  kind: PageKind
}

export function readPages(map: YMap<PageValue>): PageRec[] {
  const pages: PageRec[] = []
  map.forEach((value, id) => {
    if (!value || typeof value !== 'object') return
    pages.push({
      id,
      title: typeof value.title === 'string' ? value.title : '',
      parentId: typeof value.parentId === 'string' ? value.parentId : '',
      created: typeof value.created === 'number' ? value.created : 0,
      icon: typeof value.icon === 'string' ? value.icon : '',
      kind: value.kind === 'board' ? 'board' : 'page',
    })
  })
  pages.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id))
  return pages
}

export const pageLabel = (page: Pick<PageRec, 'title'>) => page.title.trim() || 'Untitled'

export function isRoot(page: PageRec, pages: PageRec[]) {
  return !page.parentId || !pages.some((item) => item.id === page.parentId)
}

/** Ancestors from the top-level page down to (not including) `id`. */
export function pathTo(id: string, pages: PageRec[]): PageRec[] {
  const byId = new Map(pages.map((page) => [page.id, page]))
  const path: PageRec[] = []
  let current = byId.get(id)
  while (current?.parentId && !path.some((page) => page.id === current?.parentId)) {
    const parent = byId.get(current.parentId)
    if (!parent) break
    path.unshift(parent)
    current = parent
  }
  return path
}

/** True if `parentId` is `id` itself or one of its descendants. */
export function wouldCycle(id: string, parentId: string, pages: PageRec[]) {
  if (!parentId) return false
  if (parentId === id) return true
  return pathTo(parentId, pages).some((page) => page.id === id)
}

export type Priority = '' | 'low' | 'medium' | 'high' | 'urgent'

export const PRIORITIES: { id: Exclude<Priority, ''>; label: string; rank: number }[] = [
  { id: 'urgent', label: 'Urgent', rank: 0 },
  { id: 'high', label: 'High', rank: 1 },
  { id: 'medium', label: 'Medium', rank: 2 },
  { id: 'low', label: 'Low', rank: 3 },
]

export const priorityRank = (priority: Priority) => PRIORITIES.find((item) => item.id === priority)?.rank ?? 4
export const priorityLabel = (priority: Priority) => PRIORITIES.find((item) => item.id === priority)?.label ?? ''

export type TaskSummary = {
  id: string
  text: string
  done: boolean
  priority: Priority
  due: string
}

/** What each page contributes to space-wide views; kept in the (encrypted) meta doc. */
export type PageIndex = {
  tasks: TaskSummary[]
  links: string[]
}

export function readIndex(map: YMap<PageIndex>): Record<string, PageIndex> {
  const out: Record<string, PageIndex> = {}
  map.forEach((value, id) => {
    if (!value || typeof value !== 'object') return
    out[id] = {
      tasks: Array.isArray(value.tasks) ? value.tasks : [],
      links: Array.isArray(value.links) ? value.links : [],
    }
  })
  return out
}

export function localDate(offsetDays = 0) {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'later'

export function dueInfo(due: string): { label: string; tone: DueTone } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return null
  const today = localDate()
  const tomorrow = localDate(1)
  const [year, month, day] = due.split('-').map(Number)
  const pretty = new Date(year, month - 1, day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  if (due < today) return { label: `Overdue · ${pretty}`, tone: 'overdue' }
  if (due === today) return { label: 'Today', tone: 'today' }
  if (due === tomorrow) return { label: 'Tomorrow', tone: 'soon' }
  if (due <= localDate(7)) return { label: pretty, tone: 'soon' }
  return { label: pretty, tone: 'later' }
}

export type PagesApi = {
  byId: Map<string, PageRec>
  open: (id: string) => void
}

export const PagesContext = createContext<PagesApi>({ byId: new Map(), open: () => {} })
