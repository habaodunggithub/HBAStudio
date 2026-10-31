import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  arrange,
  visualOrder,
  arrangementSignature,
  type ArrangeCard,
} from '../src/board/arrangement.ts'

const cards: ArrangeCard[] = Array.from({ length: 11 }, (_, index) => ({
  key: String(index),
  title: 'Card ' + index,
  x: (index % 3) * 100,
  y: Math.floor(index / 3) * 100,
  width: index % 2 ? 260 : 2400,
  height: index % 3 ? 180 : 2400,
}))
test('all modes preserve every card and prevent overlaps at mixed extreme sizes', () => {
  for (const mode of ['row', 'column', 'grid'] as const) {
    const before = structuredClone(cards),
      result = arrange(cards, mode)
    assert.equal(Object.keys(result.nodes).length, cards.length)
    assert.deepEqual(cards, before)
    for (const a of cards)
      for (const b of cards)
        if (a.key !== b.key) {
          const p = result.nodes[a.key],
            q = result.nodes[b.key]
          assert.ok(
            p.x + a.width <= q.x ||
              q.x + b.width <= p.x ||
              p.y + a.height <= q.y ||
              q.y + b.height <= p.y,
          )
        }
    if (mode === 'row') assert.ok(Object.values(result.nodes).every((p) => p.y === 0))
    if (mode === 'column') assert.ok(Object.values(result.nodes).every((p) => p.x === 0))
  }
  assert.deepEqual(arrange([], 'grid').nodes, {})
})
test('visual order is stable and semantic changes invalidate pending arrangements', () => {
  assert.deepEqual(
    visualOrder([...cards].reverse()).map((c) => c.key),
    cards.map((c) => c.key),
  )
  const baseline = arrangementSignature(cards, {})
  assert.equal(arrangementSignature([...cards].reverse(), {}), baseline)
  for (const update of [{ x: -100 }, { width: 300 }, { content: 'Changed requirements' }]) {
    const next = cards.map((card, index) => (index ? card : { ...card, ...update }))
    assert.notEqual(arrangementSignature(next, {}), baseline)
  }
  assert.notEqual(
    arrangementSignature(cards, { e: { source: '0', target: '1', arrow: true } }),
    baseline,
  )
})
