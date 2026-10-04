import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import TaskList from '@tiptap/extension-task-list'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { common, createLowlight } from 'lowlight'
import type { Doc } from 'yjs'
import { PageMention } from '../editor/pageMention'
import { FolioTaskItem, TASK_META_EVENT, type TaskMetaRequest } from '../editor/taskItem'
import {
  PRIORITIES,
  localDate,
  pageLabel,
  type PageIndex,
  type PageRec,
  type Priority,
  type TaskSummary,
} from '../lib/pages'
import type { Identity } from '../lib/storage'
import type { Provider } from '../sync/relayRoom'

const lowlight = createLowlight(common)

type MenuItem = {
  id: string
  title: string
  hint: string
  run: (editor: Editor) => void
}

type SlashCommand = {
  id: string
  title: string
  hint: string
  keywords: string
  run: (editor: Editor) => void
}

const COMMANDS: SlashCommand[] = [
  {
    id: 'text',
    title: 'Text',
    hint: 'Plain paragraph',
    keywords: 'paragraph text',
    run: (editor) => editor.chain().focus().setParagraph().run(),
  },
  {
    id: 'h1',
    title: 'Heading 1',
    hint: 'Large section',
    keywords: 'h1 heading title',
    run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: 'h2',
    title: 'Heading 2',
    hint: 'Section',
    keywords: 'h2 heading',
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: 'h3',
    title: 'Heading 3',
    hint: 'Small section',
    keywords: 'h3 heading',
    run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: 'todo',
    title: 'To-do list',
    hint: 'Tasks with priority and date',
    keywords: 'todo task checkbox',
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
  },
  {
    id: 'bullet',
    title: 'Bulleted list',
    hint: 'A simple list',
    keywords: 'ul bullet list',
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: 'ordered',
    title: 'Numbered list',
    hint: 'Steps in order',
    keywords: 'ol numbered list',
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: 'link-page',
    title: 'Link to page',
    hint: 'Or type [[',
    keywords: 'link page mention relation',
    run: (editor) => editor.chain().focus().insertContent('[[').run(),
  },
  {
    id: 'quote',
    title: 'Quote',
    hint: 'Call out a decision',
    keywords: 'quote blockquote',
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: 'code',
    title: 'Code',
    hint: 'Snippet with highlighting',
    keywords: 'code pre',
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: 'rule',
    title: 'Divider',
    hint: 'A horizontal line',
    keywords: 'hr divider rule',
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
]

type Menu = { kind: 'slash' | 'link'; query: string }

function slashQuery(editor: Editor) {
  if (editor.isActive('codeBlock')) return null
  const { $from } = editor.state.selection
  if (!$from.parent.isTextblock) return null
  const text = $from.parent.textContent
  if (!text.startsWith('/')) return null
  if (text.slice(1).includes(' ')) return null
  if ($from.parentOffset !== text.length) return null
  return text.slice(1)
}

function linkQuery(editor: Editor) {
  if (editor.isActive('codeBlock')) return null
  const { $from, empty } = editor.state.selection
  if (!empty || !$from.parent.isTextblock) return null
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc')
  const match = /\[\[([^[\]\n]{0,60})$/.exec(before)
  return match ? match[1] : null
}

function readMenu(editor: Editor): Menu | null {
  const slash = slashQuery(editor)
  if (slash != null) return { kind: 'slash', query: slash }
  const link = linkQuery(editor)
  if (link != null) return { kind: 'link', query: link }
  return null
}

function buildIndex(editor: Editor): PageIndex {
  const tasks: TaskSummary[] = []
  const links = new Set<string>()
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'taskItem' && node.attrs.taskId) {
      const first = node.firstChild
      const text = first
        ? first.textBetween(0, first.content.size, ' ', (leaf) =>
            leaf.type.name === 'pageMention' ? `[[${(leaf.attrs.title as string) || 'page'}]]` : '',
          )
        : ''
      tasks.push({
        id: node.attrs.taskId as string,
        text: text.trim().slice(0, 300),
        done: Boolean(node.attrs.checked),
        priority: (node.attrs.priority as Priority) || '',
        due: (node.attrs.due as string) || '',
      })
    }
    if (node.type.name === 'pageMention' && node.attrs.id) links.add(node.attrs.id as string)
  })
  return { tasks, links: [...links] }
}

function findTask(editor: Editor, taskId: string) {
  let found: { pos: number; attrs: Record<string, unknown> } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (found) return false
    if (node.type.name === 'taskItem' && node.attrs.taskId === taskId) {
      found = { pos, attrs: node.attrs }
      return false
    }
  })
  return found as { pos: number; attrs: Record<string, unknown> } | null
}

function updateTask(editor: Editor, taskId: string, patch: Record<string, unknown>) {
  editor
    .chain()
    .command(({ tr }) => {
      const task = findTask(editor, taskId)
      if (!task) return false
      tr.setNodeMarkup(task.pos, undefined, { ...task.attrs, ...patch })
      return true
    })
    .run()
}

export function PageEditor({
  doc,
  provider,
  identity,
  seedHtml,
  pageId,
  pages,
  onCreatePage,
  onIndex,
}: {
  doc: Doc
  provider: Provider
  identity: Identity
  seedHtml: string | null
  pageId: string
  pages: PageRec[]
  onCreatePage: (title: string) => string | null
  onIndex: (index: PageIndex) => void
}) {
  const seedRef = useRef(seedHtml)
  const onIndexRef = useRef(onIndex)
  onIndexRef.current = onIndex
  const [tick, setTick] = useState(0)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [selected, setSelected] = useState(0)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const [taskMeta, setTaskMeta] = useState<{ taskId: string; top: number; left: number } | null>(null)
  const selectedRef = useRef(0)
  const itemsRef = useRef<MenuItem[]>([])
  const menuRef = useRef<Menu | null>(null)

  useEffect(() => {
    provider.awareness.setLocalStateField('user', {
      name: identity.name || 'Anonymous',
      color: identity.color,
    })
  }, [provider, identity])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        history: false,
        codeBlock: false,
      }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      TaskList,
      FolioTaskItem.configure({ nested: true }),
      PageMention,
      CodeBlockLowlight.configure({ lowlight }),
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === 'heading' ? 'Heading' : 'Write, press / for blocks, or [[ to link a page',
      }),
      Collaboration.configure({ document: doc }),
      CollaborationCursor.configure({
        provider,
        user: {
          name: identity.name || 'Anonymous',
          color: identity.color,
        },
      }),
    ],
    editorProps: {
      attributes: {
        class: 'page-body',
        spellcheck: 'true',
      },
    },
    onCreate: ({ editor: created }) => {
      const fragment = doc.getXmlFragment('default')
      if (seedRef.current && fragment.length === 0) {
        created.commands.setContent(seedRef.current)
      }
    },
  })

  const items = useMemo<MenuItem[]>(() => {
    if (!menu) return []
    const needle = menu.query.trim().toLowerCase()
    if (menu.kind === 'slash') {
      return COMMANDS.filter((item) => `${item.title} ${item.keywords}`.toLowerCase().includes(needle)).map(
        (command) => ({
          id: command.id,
          title: command.title,
          hint: command.hint,
          run: (target: Editor) => {
            const { $from } = target.state.selection
            const start = $from.start()
            target.chain().focus().deleteRange({ from: start, to: start + $from.parent.textContent.length }).run()
            command.run(target)
          },
        }),
      )
    }
    const insertLink = (target: Editor, id: string, title: string) => {
      const query = linkQuery(target)
      if (query == null) return
      const to = target.state.selection.from
      const from = to - query.length - 2
      target
        .chain()
        .focus()
        .deleteRange({ from, to })
        .insertContentAt(from, [
          { type: 'pageMention', attrs: { id, title } },
          { type: 'text', text: ' ' },
        ])
        .run()
    }
    const matches = pages
      .filter((page) => page.id !== pageId && pageLabel(page).toLowerCase().includes(needle))
      .slice(0, 8)
      .map((page) => ({
        id: page.id,
        title: `${page.icon ? `${page.icon} ` : ''}${pageLabel(page)}`,
        hint: page.kind === 'board' ? 'Board' : 'Page',
        run: (target: Editor) => insertLink(target, page.id, pageLabel(page)),
      }))
    const title = menu.query.trim()
    if (title && !pages.some((page) => pageLabel(page).toLowerCase() === needle)) {
      matches.push({
        id: 'create',
        title: `New subpage “${title}”`,
        hint: 'Create and link',
        run: (target: Editor) => {
          const id = onCreatePage(title)
          if (id) insertLink(target, id, title)
        },
      })
    }
    return matches
  }, [menu, pages, pageId, onCreatePage])

  useEffect(() => {
    itemsRef.current = items
    selectedRef.current = 0
    setSelected(0)
  }, [items])

  useEffect(() => {
    if (!editor) return
    const refresh = () => {
      setTick((value) => value + 1)
      const next = readMenu(editor)
      menuRef.current = next
      setMenu((previous) =>
        previous?.kind === next?.kind && previous?.query === next?.query ? previous : next,
      )
      if (next) {
        const coords = editor.view.coordsAtPos(editor.state.selection.from)
        const left = Math.min(coords.left, window.innerWidth - 280)
        const top = Math.min(coords.bottom + 8, window.innerHeight - 300)
        setMenuPos({ top, left })
      }
    }
    editor.on('transaction', refresh)
    return () => {
      editor.off('transaction', refresh)
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    let timer = 0
    const run = () => {
      timer = 0
      if (!editor.isDestroyed) onIndexRef.current(buildIndex(editor))
    }
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(run, 700)
    }
    editor.on('update', schedule)
    const initial = window.setTimeout(run, 1200)
    return () => {
      editor.off('update', schedule)
      window.clearTimeout(initial)
      if (timer) {
        window.clearTimeout(timer)
        run()
      }
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const onKeyDown = (event: KeyboardEvent) => {
      const current = menuRef.current
      if (!current) return
      const list = itemsRef.current
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        event.stopPropagation()
        setSelected((index) => {
          const next = list.length ? (index + 1) % list.length : 0
          selectedRef.current = next
          return next
        })
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        setSelected((index) => {
          const next = list.length ? (index - 1 + list.length) % list.length : 0
          selectedRef.current = next
          return next
        })
      } else if (event.key === 'Enter' && list.length) {
        event.preventDefault()
        event.stopPropagation()
        ;(list[selectedRef.current] ?? list[0]).run(editor)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        const to = editor.state.selection.from
        const length = current.kind === 'slash' ? 1 : current.query.length + 2
        const from = current.kind === 'slash' ? editor.state.selection.$from.start() : to - length
        editor.chain().focus().deleteRange({ from, to: from + length }).run()
      }
    }
    const onTaskMeta = (event: Event) => {
      const { taskId, rect } = (event as CustomEvent<TaskMetaRequest>).detail
      const left = Math.max(8, Math.min(rect.right - 280, window.innerWidth - 290))
      const top = Math.min(rect.bottom + 6, window.innerHeight - 260)
      setTaskMeta({ taskId, top, left })
    }
    const dom = editor.view.dom
    dom.addEventListener('keydown', onKeyDown, true)
    dom.addEventListener(TASK_META_EVENT, onTaskMeta)
    return () => {
      dom.removeEventListener('keydown', onKeyDown, true)
      dom.removeEventListener(TASK_META_EVENT, onTaskMeta)
    }
  }, [editor])

  const active = (name: string, attrs?: Record<string, unknown>) =>
    Boolean(editor?.isActive(name, attrs))

  const task = editor && taskMeta ? findTask(editor, taskMeta.taskId) : null

  return (
    <div className="editor-wrap">
      <div className="toolbar" role="toolbar" aria-label="Formatting" data-rev={tick}>
        <ToolButton label="Bold" pressed={active('bold')} onClick={() => editor?.chain().focus().toggleBold().run()}>
          B
        </ToolButton>
        <ToolButton
          label="Italic"
          pressed={active('italic')}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          I
        </ToolButton>
        <ToolButton
          label="Underline"
          pressed={active('underline')}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
        >
          U
        </ToolButton>
        <ToolButton
          label="Strike"
          pressed={active('strike')}
          onClick={() => editor?.chain().focus().toggleStrike().run()}
        >
          S
        </ToolButton>
        <ToolButton label="Code" pressed={active('code')} onClick={() => editor?.chain().focus().toggleCode().run()}>
          {'</>'}
        </ToolButton>
        <span className="toolbar-gap" />
        <ToolButton
          label="Heading 1"
          pressed={active('heading', { level: 1 })}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          H1
        </ToolButton>
        <ToolButton
          label="Heading 2"
          pressed={active('heading', { level: 2 })}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H2
        </ToolButton>
        <ToolButton
          label="Bulleted list"
          pressed={active('bulletList')}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          List
        </ToolButton>
        <ToolButton
          label="To-do"
          pressed={active('taskList')}
          onClick={() => editor?.chain().focus().toggleTaskList().run()}
        >
          Todo
        </ToolButton>
        <ToolButton
          label="Indent (Tab)"
          pressed={false}
          onClick={() =>
            editor?.chain().focus().sinkListItem(editor.isActive('taskItem') ? 'taskItem' : 'listItem').run()
          }
        >
          →
        </ToolButton>
        <ToolButton
          label="Outdent (Shift+Tab)"
          pressed={false}
          onClick={() =>
            editor?.chain().focus().liftListItem(editor.isActive('taskItem') ? 'taskItem' : 'listItem').run()
          }
        >
          ←
        </ToolButton>
        <ToolButton
          label="Quote"
          pressed={active('blockquote')}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          Quote
        </ToolButton>
        <ToolButton label="Link to page" pressed={false} onClick={() => editor?.chain().focus().insertContent('[[').run()}>
          [[ ]]
        </ToolButton>
        <ToolButton label="Web link" pressed={active('link')} onClick={() => setLink(editor)}>
          URL
        </ToolButton>
      </div>
      <EditorContent editor={editor} />
      {menu && items.length > 0 && (
        <div className="slash-menu" style={{ top: menuPos.top, left: menuPos.left }} role="listbox">
          {menu.kind === 'link' && <div className="menu-heading">Link to page</div>}
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === selected}
              className={index === selected ? 'slash-item is-selected' : 'slash-item'}
              onMouseDown={(event) => {
                event.preventDefault()
                if (editor) item.run(editor)
              }}
            >
              <span>{item.title}</span>
              <small>{item.hint}</small>
            </button>
          ))}
        </div>
      )}
      {editor && taskMeta && task && (
        <TaskMetaPopover
          top={taskMeta.top}
          left={taskMeta.left}
          priority={(task.attrs.priority as Priority) || ''}
          due={(task.attrs.due as string) || ''}
          onChange={(patch) => updateTask(editor, taskMeta.taskId, patch)}
          onClose={() => setTaskMeta(null)}
        />
      )}
    </div>
  )
}

function TaskMetaPopover({
  top,
  left,
  priority,
  due,
  onChange,
  onClose,
}: {
  top: number
  left: number
  priority: Priority
  due: string
  onChange: (patch: { priority?: Priority; due?: string }) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div ref={ref} className="task-pop" style={{ top, left }} role="dialog" aria-label="Task details">
      <div className="task-pop-label">Priority</div>
      <div className="task-pop-row">
        {PRIORITIES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={priority === item.id ? `chip prio-${item.id} is-picked` : `chip prio-${item.id}`}
            onClick={() => onChange({ priority: priority === item.id ? '' : item.id })}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="task-pop-label">Due date</div>
      <div className="task-pop-row">
        <button type="button" className="chip" onClick={() => onChange({ due: localDate() })}>
          Today
        </button>
        <button type="button" className="chip" onClick={() => onChange({ due: localDate(1) })}>
          Tomorrow
        </button>
        <button type="button" className="chip" onClick={() => onChange({ due: localDate(7) })}>
          In a week
        </button>
      </div>
      <div className="task-pop-row">
        <input
          type="date"
          aria-label="Due date"
          value={due}
          onChange={(event) => onChange({ due: event.target.value })}
        />
        {due && (
          <button type="button" className="text-button" onClick={() => onChange({ due: '' })}>
            Clear
          </button>
        )}
      </div>
    </div>
  )
}

function setLink(editor: Editor | null) {
  if (!editor) return
  const previous = editor.getAttributes('link').href as string | undefined
  const next = window.prompt('Link URL', previous || 'https://')
  if (next === null) return
  if (!next.trim()) {
    editor.chain().focus().unsetLink().run()
    return
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: next.trim() }).run()
}

function ToolButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string
  pressed: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      className={pressed ? 'tool is-on' : 'tool'}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onMouseDown={(event) => {
        event.preventDefault()
        onClick()
      }}
    >
      {children}
    </button>
  )
}
