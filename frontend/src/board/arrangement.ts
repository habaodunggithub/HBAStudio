import type { Camera, Edge, Point } from './model.ts'

export type ArrangeCard = Point & {
  key: string
  title: string
  width: number
  height: number
  content?: unknown
}
export type Arrangement = { nodes: Record<string, Point>; edges: Record<string, Edge | null> }
export type ArrangeMode = 'row' | 'column' | 'grid'
export type CodexArrangement = {
  order: string[]
  summary: string
  links: (Edge & { reason: string })[]
  warnings: string[]
}

/** Keep the current reading order, with key as a stable tie breaker. */
export function visualOrder(cards: ArrangeCard[]) {
  return [...cards].sort((a, b) => a.y - b.y || a.x - b.x || a.key.localeCompare(b.key))
}

export function arrange(cards: ArrangeCard[], mode: ArrangeMode): Arrangement {
  const columns =
    mode === 'row' ? cards.length : mode === 'column' ? 1 : Math.ceil(Math.sqrt(cards.length))
  const nodes: Record<string, Point> = {}
  let y = 0
  for (let i = 0; i < cards.length; i += columns) {
    const row = cards.slice(i, i + columns)
    let x = 0
    for (const card of row) {
      nodes[card.key] = { x, y }
      x += card.width + 80
    }
    y += Math.max(...row.map((card) => card.height)) + 80
  }
  return { nodes, edges: {} }
}

export function arrangementSignature(cards: ArrangeCard[], edges: Record<string, Edge>) {
  return JSON.stringify({
    cards: [...cards].sort((a, b) => a.key.localeCompare(b.key)),
    edges: Object.entries(edges).sort(([a], [b]) => a.localeCompare(b)),
  })
}

export function fitArrangement(
  cards: ArrangeCard[],
  nodes: Record<string, Point>,
  width: number,
  height: number,
  top = 24,
): Camera {
  const left = Math.min(...cards.map((c) => nodes[c.key].x))
  const upper = Math.min(...cards.map((c) => nodes[c.key].y))
  const right = Math.max(...cards.map((c) => nodes[c.key].x + c.width))
  const bottom = Math.max(...cards.map((c) => nodes[c.key].y + c.height))
  const zoom = Math.max(
    0.25,
    Math.min(1, (width - 64) / (right - left), (height - top - 64) / (bottom - upper)),
  )
  return { zoom, x: (width - (right - left) * zoom) / 2 - left * zoom, y: top - upper * zoom }
}
