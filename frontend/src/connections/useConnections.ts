import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'

export type CodexConnection = {
  installed: boolean
  enabled: boolean
  source: 'system' | 'app' | 'off'
  connected: boolean
  account: { type: string; email?: string; plan?: string } | null
  error: string
  pending: {
    login_id: string
    url: string
    code?: string
    expires_at: string
    method: string
  } | null
}
export type Connections = { mode: 'local'; codex: CodexConnection; google: Record<string, any> }

export function useConnections(onChanged?: () => void) {
  const [data, setData] = useState<Connections | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [googleWaiting, setGoogleWaiting] = useState(false)
  const alive = useRef(true),
    popup = useRef<Window | null>(null)
  const googleBefore = useRef<{ connected: boolean; connected_at?: string } | null>(null)
  const changed = useRef(onChanged)
  changed.current = onChanged

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await api<Connections>('/connections', 'GET', undefined, { signal })
      if (!alive.current || signal?.aborted) return
      setData(next)
      setError('')
      const before = googleBefore.current
      if (
        before &&
        next.google.connected &&
        (!before.connected || next.google.connected_at !== before.connected_at)
      ) {
        googleBefore.current = null
        setGoogleWaiting(false)
        popup.current?.close()
        changed.current?.()
      }
    } catch (error: any) {
      if (alive.current && !signal?.aborted) setError(error.message)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      await refresh(controller.signal)
      if (!controller.signal.aborted) timer = setTimeout(poll, 2500)
    }
    void poll()
    return () => {
      alive.current = false
      controller.abort()
      clearTimeout(timer)
    }
  }, [refresh])

  useEffect(() => {
    if (!data?.codex.pending) return
    return () => {
      // The provider owns completion; no optimistic "connected" state.
      if (alive.current) window.dispatchEvent(new Event('hba-connections-changed'))
    }
  }, [data?.codex.pending?.login_id])

  async function run(name: string, fn: () => Promise<void>) {
    if (busy) return
    setBusy(name)
    setError('')
    try {
      await fn()
    } catch (error: any) {
      if (alive.current) setError(error.message)
    } finally {
      if (alive.current) setBusy('')
    }
  }

  function login(provider: 'codex' | 'google', method: 'browser' | 'device' = 'browser') {
    if (busy) return
    // Open synchronously while the click still has browser user activation.
    const target =
      method === 'browser'
        ? window.open('about:blank', 'hba-' + provider + '-login', 'popup,width=620,height=740')
        : null
    popup.current = target
    return run(provider, async () => {
      try {
        const result =
          provider === 'codex'
            ? await api<CodexConnection>('/connections/codex/login', 'POST', { method })
            : await api<{ url: string }>('/google/authorize', 'POST')
        const url = 'url' in result ? result.url : result.pending?.url
        if (!url) throw new Error('Chưa mở được trang đăng nhập. Hãy thử lại.')
        const parsed = new URL(url)
        const hosts =
          provider === 'google' ? ['accounts.google.com'] : ['auth.openai.com', 'chatgpt.com']
        if (parsed.protocol !== 'https:' || !hosts.includes(parsed.hostname))
          throw new Error('Địa chỉ đăng nhập không hợp lệ.')
        if (provider === 'codex')
          setData((old) => (old ? { ...old, codex: result as CodexConnection } : old))
        else {
          googleBefore.current = {
            connected: !!data?.google.connected,
            connected_at: data?.google.connected_at,
          }
          setGoogleWaiting(true)
        }
        if (method === 'browser') {
          if (target && !target.closed) target.location.href = url
          else window.location.assign(url)
        }
      } catch (error) {
        target?.close()
        throw error
      }
    })
  }

  const cancel = () =>
    run('codex', async () => {
      await api('/connections/codex/login', 'DELETE')
      popup.current?.close()
      await refresh()
    })
  const useSystem = () =>
    run('codex', async () => {
      await api('/connections/codex/system', 'POST')
      await refresh()
      changed.current?.()
      window.dispatchEvent(new Event('hba-connections-changed'))
    })
  const disconnect = (provider: 'codex' | 'google') =>
    run(provider, async () => {
      await api(provider === 'codex' ? '/connections/codex' : '/google/connection', 'DELETE')
      await refresh()
      changed.current?.()
      window.dispatchEvent(new Event('hba-connections-changed'))
    })
  return { data, error, busy, googleWaiting, refresh, login, cancel, useSystem, disconnect }
}
