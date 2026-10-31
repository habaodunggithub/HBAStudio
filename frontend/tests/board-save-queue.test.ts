import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BoardSaveQueue } from '../src/board/saveQueue.ts'
import { applyLayoutPatch, emptyLayout, type BoardPatch } from '../src/board/model.ts'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test('edits during a save are serialized and flush waits for all edits', async () => {
  const writes: BoardPatch[] = [],
    first = deferred(),
    second = deferred()
  const queue = new BoardSaveQueue(async (patch) => {
    writes.push(patch)
    await (writes.length === 1 ? first.promise : second.promise)
  })
  queue.enqueue({ nodes: { a: { x: 0, y: 0 } } })
  const flush = queue.flush()
  queue.enqueue({ nodes: { a: { x: 90, y: 10 }, b: { x: 200, y: 0 } } })
  const concurrentFlush = queue.flush()
  assert.equal(writes.length, 1)
  first.resolve()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(writes.length, 2)
  assert.deepEqual(writes[1].nodes?.a, { x: 90, y: 10 })
  second.resolve()
  assert.deepEqual(await Promise.all([flush, concurrentFlush]), [true, true])
  assert.deepEqual(queue.snapshot(), {})
})

test('retry preserves newer edits, deletion markers, and unrelated failed fields', async () => {
  const first = deferred(),
    writes: BoardPatch[] = []
  const queue = new BoardSaveQueue(async (patch) => {
    writes.push(patch)
    if (writes.length === 1) await first.promise
  })
  queue.enqueue({
    edges: { e: { source: 'a', target: 'b', arrow: true } },
    nodes: { a: { x: 10, y: 20 } },
    camera: { x: 1, y: 2, zoom: 1 },
  })
  const flush = queue.flush()
  queue.enqueue({ edges: { e: null }, camera: { x: 30, y: 40, zoom: 2 } })
  first.reject(new Error('offline'))
  assert.equal(await flush, false)
  assert.equal(await queue.flush(), true)
  assert.deepEqual(writes[1], {
    edges: { e: null },
    nodes: { a: { x: 10, y: 20 } },
    camera: { x: 30, y: 40, zoom: 2 },
  })
  assert.deepEqual(applyLayoutPatch(emptyLayout(), writes[1]).edges, {})
  assert.equal(queue.error, null)
})

test('leaving one board cannot merge its pending edits into another board', async () => {
  const pending = deferred(),
    writes: [string, BoardPatch][] = []
  const oldBoard = new BoardSaveQueue(async (patch) => {
    writes.push(['old', patch])
    await pending.promise
  })
  const newBoard = new BoardSaveQueue(async (patch) => {
    writes.push(['new', patch])
  })
  oldBoard.enqueue({ hidden: ['document:old'] })
  const oldFlush = oldBoard.flush()
  newBoard.enqueue({ hidden: ['document:new'] })
  assert.equal(await newBoard.flush(), true)
  pending.reject(new Error('old board offline'))
  assert.equal(await oldFlush, false)
  assert.deepEqual(newBoard.snapshot(), {})
  assert.deepEqual(oldBoard.snapshot(), { hidden: ['document:old'] })
  assert.deepEqual(
    writes.map(([board]) => board),
    ['old', 'new'],
  )
})
