import TaskItem from '@tiptap/extension-task-item'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import type { NodeViewRendererProps } from '@tiptap/core'
import { dueInfo, priorityLabel, type Priority } from '../lib/pages'
import { randomId } from '../lib/storage'

export const TASK_META_EVENT = 'folio-task-meta'

export type TaskMetaRequest = { taskId: string; rect: DOMRect }

const attr = (name: string) => ({
  default: '',
  keepOnSplit: false,
  parseHTML: (element: HTMLElement) => element.getAttribute(`data-${name}`) || '',
  renderHTML: (attrs: Record<string, string>) => (attrs[name] ? { [`data-${name}`]: attrs[name] } : {}),
})

/** Task items with a stable id, a priority, and a due date. */
export const FolioTaskItem = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      taskId: {
        ...attr('task-id'),
        renderHTML: (attrs: Record<string, string>) => (attrs.taskId ? { 'data-task-id': attrs.taskId } : {}),
      },
      priority: attr('priority'),
      due: attr('due'),
    }
  },

  addNodeView() {
    const base = this.parent?.()
    return (props: NodeViewRendererProps) => {
      const view = base!(props)
      const dom = view.dom as HTMLElement
      const meta = document.createElement('span')
      meta.className = 'task-meta'
      meta.contentEditable = 'false'
      let current = props.node

      const render = (node: PMNode) => {
        current = node
        const priority = node.attrs.priority as Priority
        const due = dueInfo(node.attrs.due as string)
        dom.dataset.priority = priority || ''
        meta.replaceChildren()
        if (priority) {
          const chip = document.createElement('button')
          chip.type = 'button'
          chip.className = `chip prio-${priority}`
          chip.textContent = priorityLabel(priority)
          meta.append(chip)
        }
        if (due) {
          const chip = document.createElement('button')
          chip.type = 'button'
          chip.className = `chip due-${node.attrs.checked ? 'done' : due.tone}`
          chip.textContent = due.label
          meta.append(chip)
        }
        const edit = document.createElement('button')
        edit.type = 'button'
        edit.className = 'task-edit'
        edit.title = 'Priority and due date'
        edit.setAttribute('aria-label', 'Priority and due date')
        edit.textContent = priority || due ? '⋯' : '⚑'
        meta.append(edit)
      }
      render(props.node)

      meta.addEventListener('mousedown', (event) => event.preventDefault())
      meta.addEventListener('click', (event) => {
        event.preventDefault()
        const taskId = current.attrs.taskId as string
        if (!taskId) return
        const detail: TaskMetaRequest = { taskId, rect: meta.getBoundingClientRect() }
        props.editor.view.dom.dispatchEvent(new CustomEvent(TASK_META_EVENT, { detail, bubbles: true }))
      })
      dom.append(meta)

      return {
        ...view,
        update: (node: PMNode, ...rest: unknown[]) => {
          if (node.type !== current.type) return false
          const ok = (view.update as ((n: PMNode, ...r: unknown[]) => boolean) | undefined)?.(node, ...rest)
          if (ok === false) return false
          render(node)
          return true
        },
        stopEvent: (event: Event) => meta.contains(event.target as globalThis.Node),
        ignoreMutation: (mutation: { type: string; target: globalThis.Node }) =>
          mutation.type !== 'selection' && meta.contains(mutation.target),
      }
    }
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((tr) => tr.docChanged)) return null
          const seen = new Set<string>()
          let tr = null as ReturnType<typeof state.tr.setNodeMarkup> | null
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'taskItem') return
            const id = node.attrs.taskId as string
            if (id && !seen.has(id)) {
              seen.add(id)
              return
            }
            const fresh = randomId()
            seen.add(fresh)
            tr = (tr ?? state.tr).setNodeMarkup(pos, undefined, { ...node.attrs, taskId: fresh })
          })
          return tr
        },
      }),
    ]
  },
})
