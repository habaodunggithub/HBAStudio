export type Point = { x: number; y: number }
export type Camera = Point & { zoom: number }
export type CardSize = { width: number; height: number }
export type NoteCard = { type: 'note'; title: string; text: string }
export type Edge = { source: string; target: string; arrow: boolean }
export type WorkView = 'board' | 'list'

export type BoardLayout = {
  nodes: Record<string, Point>
  sizes: Record<string, CardSize>
  cards: Record<string, NoteCard>
  edges: Record<string, Edge>
  hidden: string[]
  camera: Camera | null
  suggestions: boolean
  view?: WorkView
}

export type BoardPatch = Partial<Omit<BoardLayout, 'cards' | 'edges'>> & {
  cards?: Record<string, NoteCard | null>
  edges?: Record<string, Edge | null>
}

export function emptyLayout(): BoardLayout {
  return {
    nodes: {},
    sizes: {},
    cards: {},
    edges: {},
    hidden: [],
    camera: null,
    suggestions: false,
  }
}

// Preserve deletion markers in the queue; remove them only from the visible layout.
function merge<T extends BoardPatch>(state: T, patch: BoardPatch, removeNull: boolean): T {
  const next = { ...state, ...patch }
  for (const field of ['nodes', 'sizes', 'cards', 'edges'] as const) {
    if (!patch[field]) continue
    const values = { ...state[field], ...patch[field] }
    if (removeNull) for (const key in values) if (values[key] === null) delete values[key]
    Object.assign(next, { [field]: values })
  }
  return next
}

export const applyLayoutPatch = (layout: BoardLayout, patch: BoardPatch) =>
  merge(layout, patch, true)
export const mergePatches = (previous: BoardPatch, next: BoardPatch) => merge(previous, next, false)
