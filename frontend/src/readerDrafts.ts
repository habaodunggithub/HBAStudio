const readers = new Map<symbol, { id: string; flush: () => Promise<void> | null }>()
export function registerReaderDraft(id: string, flush: () => Promise<void> | null) {
  const key = Symbol()
  readers.set(key, { id, flush })
  return () => {
    readers.delete(key)
  }
}
export function flushReaderDrafts(id?: string): Promise<void> | null {
  const pending = [...readers.values()]
    .filter((reader) => !id || reader.id === id)
    .map((reader) => reader.flush())
    .filter((result): result is Promise<void> => result !== null)
  return pending.length ? Promise.all(pending).then(() => {}) : null
}
