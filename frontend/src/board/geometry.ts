import type { Camera, CardSize, Point } from './model'

export function defaultPosition(index: number): Point {
  return { x: (index % 3) * 560, y: Math.floor(index / 3) * 640 }
}

export function zoomAt(camera: Camera, amount: number, anchor: Point): Camera {
  const zoom = Math.max(0.25, Math.min(2, amount))
  return {
    zoom,
    x: anchor.x - ((anchor.x - camera.x) * zoom) / camera.zoom,
    y: anchor.y - ((anchor.y - camera.y) * zoom) / camera.zoom,
  }
}

export function edgeEndpoints(p: Point, s: CardSize, q: Point, t: CardSize) {
  const c = { x: p.x + s.width / 2, y: p.y + s.height / 2 }
  const d = { x: q.x + t.width / 2, y: q.y + t.height / 2 }
  const dx = d.x - c.x,
    dy = d.y - c.y
  const k = Math.min(s.width / 2 / (Math.abs(dx) || 0.001), s.height / 2 / (Math.abs(dy) || 0.001))
  const l = Math.min(t.width / 2 / (Math.abs(dx) || 0.001), t.height / 2 / (Math.abs(dy) || 0.001))
  return {
    x1: c.x + dx * k,
    y1: c.y + dy * k,
    x2: d.x - dx * l,
    y2: d.y - dy * l,
  }
}
