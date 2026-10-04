import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Background,
  ConnectionMode,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Doc } from 'yjs'
import { randomId } from '../lib/storage'

type CardValue = { x: number; y: number; text: string; color: string }
type LinkValue = { source: string; target: string; sourceHandle?: string; targetHandle?: string; label?: string }
type CardData = { text: string; color: string; onText: (id: string, text: string) => void }
type CardNode = Node<CardData, 'card'>

const COLORS = ['#fffdf8', '#fde7c8', '#f9d0c4', '#d9ead3', '#cfe2f3', '#e4d7f5']

const isCard = (value: unknown): value is CardValue =>
  Boolean(value) && typeof (value as CardValue).x === 'number' && typeof (value as CardValue).y === 'number'

/** Renders "- item" and "[ ] item" lines as lists so cards can hold sub-lists. */
function CardText({ text }: { text: string }) {
  const lines = text.split('\n')
  if (!text.trim()) return <span className="card-empty">Double-click to write</span>
  return (
    <>
      {lines.map((line, index) => {
        const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
        const box = /^\s*\[( |x)\]\s+(.*)$/i.exec(line)
        const depth = (/^\s*/.exec(line)?.[0].length ?? 0) >= 2 ? ' is-nested' : ''
        if (box) {
          return (
            <div key={index} className={`card-line card-box${depth}${box[1].trim() ? ' is-done' : ''}`}>
              {box[1].trim() ? '☑' : '☐'} {box[2]}
            </div>
          )
        }
        if (bullet) {
          return (
            <div key={index} className={`card-line card-bullet${depth}`}>
              • {bullet[1]}
            </div>
          )
        }
        return (
          <div key={index} className={index === 0 ? 'card-line card-head' : 'card-line'}>
            {line || '\u00a0'}
          </div>
        )
      })}
    </>
  )
}

const CardView = memo(function CardView({ id, data, selected }: NodeProps<CardNode>) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(data.text)
  useEffect(() => {
    if (!editing) setDraft(data.text)
  }, [data.text, editing])
  const sides: [Position, string][] = [
    [Position.Top, 't'],
    [Position.Right, 'r'],
    [Position.Bottom, 'b'],
    [Position.Left, 'l'],
  ]
  return (
    <div
      className={selected ? 'board-card is-selected' : 'board-card'}
      style={{ background: data.color }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        setEditing(true)
      }}
    >
      {sides.map(([position, key]) => (
        <Handle key={key} id={key} type="source" position={position} className="board-handle" />
      ))}
      {editing ? (
        <textarea
          className="nodrag nowheel card-input"
          autoFocus
          value={draft}
          placeholder={'Title\n- item\n  - sub-item\n[ ] task'}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            setEditing(false)
            if (draft !== data.text) data.onText(id, draft)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
              event.currentTarget.blur()
            }
          }}
        />
      ) : (
        <CardText text={data.text} />
      )}
    </div>
  )
})

const nodeTypes = { card: CardView }

function Board({ doc }: { doc: Doc }) {
  const cards = useMemo(() => doc.getMap<CardValue>('cards'), [doc])
  const links = useMemo(() => doc.getMap<LinkValue>('links'), [doc])
  const flow = useReactFlow()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [nodes, setNodes] = useState<CardNode[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const draggingRef = useRef(new Set<string>())
  const lastWrite = useRef(0)

  const onText = useCallback(
    (id: string, text: string) => {
      const current = cards.get(id)
      if (current) cards.set(id, { ...current, text })
    },
    [cards],
  )

  useEffect(() => {
    const syncCards = () => {
      setNodes((previous) => {
        const prevById = new Map(previous.map((node) => [node.id, node]))
        const next: CardNode[] = []
        cards.forEach((value, id) => {
          if (!isCard(value)) return
          const prev = prevById.get(id)
          const dragging = draggingRef.current.has(id)
          next.push({
            id,
            type: 'card',
            position: dragging && prev ? prev.position : { x: value.x, y: value.y },
            data: { text: typeof value.text === 'string' ? value.text : '', color: value.color || COLORS[0], onText },
            selected: prev?.selected,
          })
        })
        return next
      })
    }
    const syncLinks = () => {
      const next: Edge[] = []
      links.forEach((value, id) => {
        if (!value || !cards.has(value.source) || !cards.has(value.target)) return
        next.push({
          id,
          source: value.source,
          target: value.target,
          sourceHandle: value.sourceHandle,
          targetHandle: value.targetHandle,
          label: value.label || undefined,
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
        })
      })
      setEdges((previous) => {
        const selectedIds = new Set(previous.filter((edge) => edge.selected).map((edge) => edge.id))
        return next.map((edge) => (selectedIds.has(edge.id) ? { ...edge, selected: true } : edge))
      })
    }
    const both = () => {
      syncCards()
      syncLinks()
    }
    cards.observe(both)
    links.observe(syncLinks)
    both()
    return () => {
      cards.unobserve(both)
      links.unobserve(syncLinks)
    }
  }, [cards, links, onText])

  const writePosition = (id: string, x: number, y: number) => {
    const current = cards.get(id)
    if (current) cards.set(id, { ...current, x: Math.round(x), y: Math.round(y) })
  }

  const onNodesChange = (changes: NodeChange<CardNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current))
    const now = Date.now()
    doc.transact(() => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          if (change.dragging) {
            draggingRef.current.add(change.id)
            if (now - lastWrite.current > 90) writePosition(change.id, change.position.x, change.position.y)
          } else {
            draggingRef.current.delete(change.id)
            writePosition(change.id, change.position.x, change.position.y)
          }
        } else if (change.type === 'position' && change.dragging === false) {
          draggingRef.current.delete(change.id)
          const node = flow.getNode(change.id)
          if (node) writePosition(change.id, node.position.x, node.position.y)
        } else if (change.type === 'remove') {
          cards.delete(change.id)
          links.forEach((value, linkId) => {
            if (value.source === change.id || value.target === change.id) links.delete(linkId)
          })
        }
      }
    })
    if (changes.some((change) => change.type === 'position' && change.dragging)) lastWrite.current = now
  }

  const onEdgesChange = (changes: EdgeChange[]) => {
    const removed = changes.filter((change) => change.type === 'remove')
    if (removed.length) doc.transact(() => removed.forEach((change) => links.delete(change.id)))
    const selects = changes.filter((change) => change.type === 'select')
    if (selects.length) {
      setEdges((current) =>
        current.map((edge) => {
          const change = selects.find((item) => item.id === edge.id)
          return change && change.type === 'select' ? { ...edge, selected: change.selected } : edge
        }),
      )
    }
  }

  const onConnect = (connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    links.set(randomId(), {
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
    })
  }

  const addCard = (x: number, y: number, text = '') => {
    const id = randomId()
    cards.set(id, { x: Math.round(x), y: Math.round(y), text, color: COLORS[0] })
    return id
  }

  const addAtCenter = () => {
    const box = wrapRef.current?.getBoundingClientRect()
    if (!box) return
    const point = flow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 })
    addCard(point.x - 90 + Math.random() * 40, point.y - 30 + Math.random() * 40)
  }

  const onDoubleClick = (event: ReactMouseEvent) => {
    const target = event.target as HTMLElement
    if (!target.classList.contains('react-flow__pane')) return
    const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    addCard(point.x - 90, point.y - 24)
  }

  const selectedNodes = nodes.filter((node) => node.selected)
  const selectedEdges = edges.filter((edge) => edge.selected)

  const recolor = (color: string) => {
    doc.transact(() => {
      for (const node of selectedNodes) {
        const current = cards.get(node.id)
        if (current) cards.set(node.id, { ...current, color })
      }
    })
  }

  const labelEdge = () => {
    const edge = selectedEdges[0]
    if (!edge) return
    const current = links.get(edge.id)
    if (!current) return
    const label = window.prompt('Arrow label', current.label || '')
    if (label !== null) links.set(edge.id, { ...current, label: label.trim() })
  }

  const removeSelected = () => {
    doc.transact(() => {
      for (const node of selectedNodes) {
        cards.delete(node.id)
        links.forEach((value, linkId) => {
          if (value.source === node.id || value.target === node.id) links.delete(linkId)
        })
      }
      for (const edge of selectedEdges) links.delete(edge.id)
    })
  }

  return (
    <div className="board">
      <div className="board-toolbar">
        <button type="button" className="primary slim" onClick={addAtCenter}>
          + Card
        </button>
        {selectedNodes.length > 0 && (
          <div className="board-colors" aria-label="Card colour">
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className="swatch"
                style={{ background: color }}
                aria-label={`Colour ${color}`}
                onClick={() => recolor(color)}
              />
            ))}
          </div>
        )}
        {selectedEdges.length === 1 && (
          <button type="button" className="secondary slim" onClick={labelEdge}>
            Label arrow
          </button>
        )}
        {(selectedNodes.length > 0 || selectedEdges.length > 0) && (
          <button type="button" className="secondary slim" onClick={removeSelected}>
            Delete
          </button>
        )}
        <span className="board-hint">
          Double-click empty space for a card · drag from a dot to connect · double-click a card to edit
        </span>
      </div>
      <div className="board-canvas" ref={wrapRef} onDoubleClick={onDoubleClick}>
        <ReactFlow<CardNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          connectionMode={ConnectionMode.Loose}
          zoomOnDoubleClick={false}
          deleteKeyCode={['Delete', 'Backspace']}
          fitView
          fitViewOptions={{ maxZoom: 1.1, padding: 0.2 }}
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={22} size={1.2} color="#d8cfc2" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  )
}

export default function BoardEditor({ doc, seed }: { doc: Doc; seed: boolean }) {
  useEffect(() => {
    const cards = doc.getMap<CardValue>('cards')
    if (!seed || cards.size > 0) return
    const links = doc.getMap<LinkValue>('links')
    doc.transact(() => {
      const ids = [randomId(), randomId(), randomId()]
      cards.set(ids[0], { x: 0, y: 0, text: 'Idea\n- what\n- why', color: COLORS[1] })
      cards.set(ids[1], { x: 280, y: -60, text: 'Step one\n[ ] task\n[x] done', color: COLORS[3] })
      cards.set(ids[2], { x: 280, y: 110, text: 'Step two\n- detail\n  - sub-detail', color: COLORS[4] })
      links.set(randomId(), { source: ids[0], target: ids[1], sourceHandle: 'r', targetHandle: 'l' })
      links.set(randomId(), { source: ids[0], target: ids[2], sourceHandle: 'r', targetHandle: 'l' })
    })
  }, [doc, seed])

  return (
    <ReactFlowProvider>
      <Board doc={doc} />
    </ReactFlowProvider>
  )
}
