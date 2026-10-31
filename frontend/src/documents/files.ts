import { checkedFetch } from '../api'

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
export const documentEndpoint = (id: string) => '/knowledge/documents/' + encodeURIComponent(id)
export const documentFileUrl = (id: string) => '/api/v1' + documentEndpoint(id) + '/file'

export async function readBytes(url: string, signal?: AbortSignal) {
  return (await checkedFetch(url, { signal })).arrayBuffer()
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
