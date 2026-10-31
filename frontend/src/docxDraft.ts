export type DocxDraft = { id: string; revision: string; blob: Blob }
async function access<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('hba-docx-drafts', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('documents', { keyPath: 'id' })
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result,
        transaction = db.transaction('documents', mode),
        request = run(transaction.objectStore('documents'))
      let value: T
      request.onsuccess = () => (value = request.result)
      transaction.oncomplete = () => {
        db.close()
        resolve(value)
      }
      transaction.onerror = () => {
        db.close()
        reject(transaction.error)
      }
    }
  })
}
export const getDocxDraft = (id: string) =>
  access<DocxDraft | undefined>('readonly', (store) => store.get(id))
export const putDocxDraft = (draft: DocxDraft) => access('readwrite', (store) => store.put(draft))
export const deleteDocxDraft = (id: string) => access('readwrite', (store) => store.delete(id))
