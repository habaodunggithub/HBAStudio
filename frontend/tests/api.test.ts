import assert from 'node:assert/strict'
import { test } from 'node:test'
import { api, ApiError, checkedFetch } from '../src/api.ts'

test('all readers retain conflict status and server detail', async (t) => {
  const original = globalThis.fetch
  t.after(() => {
    globalThis.fetch = original
  })
  globalThis.fetch = async () => Response.json({ detail: 'File đã thay đổi' }, { status: 409 })
  await assert.rejects(api('/document', 'PUT', { content: 'draft' }), (error) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.status, 409)
    assert.equal(error.message, 'File đã thay đổi')
    return true
  })
  globalThis.fetch = async () => new Response('Bad gateway', { status: 502 })
  await assert.rejects(
    checkedFetch('/binary-file'),
    (error) => error instanceof ApiError && error.status === 502,
  )
})

test('JSON and DOCX multipart requests preserve serialization and abort signals', async (t) => {
  const original = globalThis.fetch
  t.after(() => {
    globalThis.fetch = original
  })
  const calls: RequestInit[] = [],
    controller = new AbortController()
  globalThis.fetch = async (_url, options) => {
    calls.push(options!)
    return Response.json({ revision: 'saved' })
  }
  await api('/document', 'PUT', { text: 'Tiếng Việt' }, { signal: controller.signal })
  const form = new FormData()
  form.append('revision', 'base')
  await api('/docx', 'PUT', form)
  assert.equal(calls[0].body, JSON.stringify({ text: 'Tiếng Việt' }))
  assert.equal(calls[0].signal, controller.signal)
  assert.equal(new Headers(calls[0].headers).get('Content-Type'), 'application/json')
  assert.equal(calls[1].body, form)
  assert.equal(new Headers(calls[1].headers).has('Content-Type'), false)
})
