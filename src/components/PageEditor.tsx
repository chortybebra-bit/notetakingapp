import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { common, createLowlight } from 'lowlight'
import type { Doc } from 'yjs'
import type { Identity } from '../lib/storage'
import type { Provider } from '../sync/relayRoom'

const lowlight = createLowlight(common)

type SlashItem = {
  id: string
  title: string
  hint: string
  keywords: string
  run: (editor: Editor) => void
}

const COMMANDS: SlashItem[] = [
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
    id: 'todo',
    title: 'To-do list',
    hint: 'Tasks you can check off',
    keywords: 'todo task checkbox',
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
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

export function PageEditor({
  doc,
  provider,
  identity,
  seedHtml,
}: {
  doc: Doc
  provider: Provider
  identity: Identity
  seedHtml: string | null
}) {
  const seedRef = useRef(seedHtml)
  const [tick, setTick] = useState(0)
  const [query, setQuery] = useState<string | null>(null)
  const [selected, setSelected] = useState(0)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const selectedRef = useRef(0)
  const itemsRef = useRef<SlashItem[]>([])

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
      TaskItem.configure({ nested: true }),
      CodeBlockLowlight.configure({ lowlight }),
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === 'heading' ? 'Heading' : 'Write, or press / for blocks',
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

  const items = useMemo(() => {
    if (query == null) return []
    const needle = query.toLowerCase()
    return COMMANDS.filter((item) => `${item.title} ${item.keywords}`.toLowerCase().includes(needle))
  }, [query])

  useEffect(() => {
    itemsRef.current = items
    selectedRef.current = 0
    setSelected(0)
  }, [items])

  useEffect(() => {
    if (!editor) return
    const refresh = () => {
      setTick((value) => value + 1)
      const next = slashQuery(editor)
      setQuery(next)
      if (next != null) {
        const coords = editor.view.coordsAtPos(editor.state.selection.from)
        const left = Math.min(coords.left, window.innerWidth - 280)
        const top = Math.min(coords.bottom + 8, window.innerHeight - 280)
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (slashQuery(editor) == null) return
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
        runSlash(editor, list[selectedRef.current] ?? list[0])
      } else if (event.key === 'Escape') {
        event.preventDefault()
        const { $from } = editor.state.selection
        const start = $from.start()
        editor.chain().focus().deleteRange({ from: start, to: start + 1 }).run()
      }
    }
    const dom = editor.view.dom
    dom.addEventListener('keydown', onKeyDown, true)
    return () => dom.removeEventListener('keydown', onKeyDown, true)
  }, [editor])

  const active = (name: string, attrs?: Record<string, unknown>) =>
    Boolean(editor?.isActive(name, attrs))

  return (
    <div className="editor-wrap">
      <div className="toolbar" role="toolbar" aria-label="Formatting" data-rev={tick}>
        <ToolButton
          label="Bold"
          pressed={active('bold')}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
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
        <ToolButton
          label="Code"
          pressed={active('code')}
          onClick={() => editor?.chain().focus().toggleCode().run()}
        >
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
          label="Quote"
          pressed={active('blockquote')}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          Quote
        </ToolButton>
        <ToolButton
          label="Link"
          pressed={active('link')}
          onClick={() => setLink(editor)}
        >
          Link
        </ToolButton>
      </div>
      <EditorContent editor={editor} />
      {query != null && items.length > 0 && (
        <div className="slash-menu" style={{ top: menuPos.top, left: menuPos.left }} role="listbox">
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === selected}
              className={index === selected ? 'slash-item is-selected' : 'slash-item'}
              onMouseDown={(event) => {
                event.preventDefault()
                if (editor) runSlash(editor, item)
              }}
            >
              <span>{item.title}</span>
              <small>{item.hint}</small>
            </button>
          ))}
        </div>
      )}
      </div>
  )
}

function runSlash(editor: Editor, item: SlashItem) {
  const { $from } = editor.state.selection
  const start = $from.start()
  const text = $from.parent.textContent
  editor.chain().focus().deleteRange({ from: start, to: start + text.length }).run()
  item.run(editor)
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
