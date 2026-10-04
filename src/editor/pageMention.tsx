import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useContext } from 'react'
import { PagesContext, pageLabel } from '../lib/pages'

function MentionView({ node }: NodeViewProps) {
  const { byId, open } = useContext(PagesContext)
  const id = node.attrs.id as string
  const page = byId.get(id)
  return (
    <NodeViewWrapper
      as="span"
      className={page ? 'page-mention' : 'page-mention is-missing'}
      data-page-id={id}
      onClick={() => page && open(id)}
      title={page ? 'Open page' : 'This page was deleted'}
    >
      {page?.icon ? `${page.icon} ` : '↗ '}
      {page ? pageLabel(page) : (node.attrs.title as string) || 'Deleted page'}
    </NodeViewWrapper>
  )
}

/** An inline link to another page in the space. Shows the page's current title. */
export const PageMention = Node.create({
  name: 'pageMention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      id: { default: '', parseHTML: (element) => element.getAttribute('data-page-id') || '', renderHTML: () => ({}) },
      title: { default: '', parseHTML: (element) => element.textContent || '', renderHTML: () => ({}) },
    }
  },

  parseHTML() {
    return [{ tag: 'a[data-page-id]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, { 'data-page-id': node.attrs.id, class: 'page-mention' }),
      (node.attrs.title as string) || 'Untitled',
    ]
  },

  renderText({ node }) {
    return `[[${(node.attrs.title as string) || 'Untitled'}]]`
  },

  addNodeView() {
    return ReactNodeViewRenderer(MentionView)
  },
})
