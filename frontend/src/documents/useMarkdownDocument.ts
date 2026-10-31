import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api'
import { documentEndpoint, downloadBlob } from './files'
type Content = {
  content: string
  revision: string
}
export function useMarkdownDocument(id: string, title: string) {
  const endpoint = documentEndpoint(id) + '/content',
    draftKey = 'hba-markdown-draft:' + id
  const [source, setSource] = useState<Content | null>(null),
    [text, setText] = useState(''),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [conflict, setConflict] = useState(false),
    [draftError, setDraftError] = useState(false)
  const draft = useRef<Content | null>(null),
    generation = useRef(0),
    mounted = useRef(true)
  const dirty = source !== null && text !== source.content
  function persistDraft() {
    try {
      if (draft.current) localStorage.setItem(draftKey, JSON.stringify(draft.current))
      else localStorage.removeItem(draftKey)
      return true
    } catch {
      return false
    }
  }
  async function load(discard = false) {
    const version = ++generation.current
    setLoading(true)
    setError('')
    try {
      const latest: Content = await api(endpoint)
      if (!mounted.current || version !== generation.current) return
      let stored: Content | null = null
      if (!discard)
        try {
          const value = JSON.parse(localStorage.getItem(draftKey) || 'null')
          if (
            typeof value?.content === 'string' &&
            value.content.length <= 2 * 1024 * 1024 &&
            /^[a-f0-9]{64}$/.test(value.revision)
          )
            stored = value
        } catch {}
      draft.current = stored && stored.content !== latest.content ? stored : null
      setSource(latest)
      setText(draft.current?.content ?? latest.content)
      setConflict(!!draft.current && draft.current.revision !== latest.revision)
      setDraftError(!persistDraft())
    } catch (e: any) {
      if (mounted.current && version === generation.current) setError(e.message)
    } finally {
      if (mounted.current && version === generation.current) setLoading(false)
    }
  }
  useEffect(() => {
    mounted.current = true
    void load()
    const leave = () => persistDraft()
    addEventListener('pagehide', leave)
    return () => {
      mounted.current = false
      generation.current++
      persistDraft()
      removeEventListener('pagehide', leave)
    }
  }, [id])
  useEffect(() => {
    if (!source) return
    const timer = setTimeout(() => setDraftError(!persistDraft()), 300)
    return () => clearTimeout(timer)
  }, [text, source])
  function edit(content: string) {
    setText(content)
    draft.current =
      source && content !== source.content
        ? { content, revision: draft.current?.revision || source.revision }
        : null
  }
  async function save() {
    if (!source || !dirty || saving || conflict) return
    const content = text,
      revision = draft.current?.revision || source.revision
    setSaving(true)
    setError('')
    try {
      const body = await api<{
        revision: string
      }>(endpoint, 'PUT', { content, revision })
      if (!mounted.current) return
      setSource({ content, revision: body.revision })
      draft.current = null
      setDraftError(!persistDraft())
      setConflict(false)
    } catch (e: any) {
      if (mounted.current) {
        if (e instanceof ApiError && e.status === 409) setConflict(true)
        setError(e.message)
      }
    } finally {
      if (mounted.current) setSaving(false)
    }
  }
  function download() {
    downloadBlob(new Blob([text], { type: 'text/markdown;charset=utf-8' }), title)
  }
  return {
    source,
    text,
    loading,
    saving,
    error,
    conflict,
    draftError,
    dirty,
    load,
    edit,
    save,
    download,
  }
}
