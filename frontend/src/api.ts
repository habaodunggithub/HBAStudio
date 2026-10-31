export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Also used by binary readers so HTTP errors retain their status and detail. */
export async function checkedFetch(url: string, options?: RequestInit): Promise<Response> {
  const response = await fetch(url, options)
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail = body?.detail
    throw new ApiError(
      typeof detail === 'string'
        ? detail
        : detail
          ? JSON.stringify(detail)
          : `Yêu cầu thất bại (${response.status})`,
      response.status,
    )
  }
  return response
}

export async function api<T = any>(
  path: string,
  method = 'GET',
  data?: unknown,
  options?: Pick<RequestInit, 'signal'>,
): Promise<T> {
  const response = await checkedFetch('/api/v1' + path, {
    ...options,
    method,
    headers: data instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : data instanceof FormData ? data : JSON.stringify(data),
  })
  return response.json()
}
