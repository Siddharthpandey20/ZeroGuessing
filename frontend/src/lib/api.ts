// One fetch wrapper for the whole app. Auth lives in HttpOnly cookies set by /api/auth/*
// (an access cookie for every /api request, including <img> page renders, and a refresh cookie).
// On a 401 we refresh once and retry; if that fails, listeners are told to show sign-in.

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Listener = () => void
const authLost = new Set<Listener>()
export const onAuthLost = (fn: Listener) => {
  authLost.add(fn)
  return () => authLost.delete(fn)
}

let refreshing: Promise<boolean> | null = null
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => queueMicrotask(() => (refreshing = null)))
  return refreshing
}

async function detail(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (typeof body?.detail === 'string') return body.detail
    if (Array.isArray(body?.detail)) return body.detail.map((d: { msg?: string }) => d.msg).join('; ')
  } catch {
    /* not JSON */
  }
  return res.statusText || `Request failed (${res.status})`
}

export async function request(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const isJson = init.body !== undefined && !(init.body instanceof FormData)
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: { ...(isJson ? { 'content-type': 'application/json' } : {}), ...init.headers },
  })
  if (res.status === 401 && retry && !path.startsWith('/api/auth/')) {
    if (await refreshSession()) return request(path, init, false)
    authLost.forEach((fn) => fn())
  }
  if (!res.ok) throw new ApiError(res.status, await detail(res))
  return res
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await request(path, init)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) })
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', ...(body === undefined ? {} : json(body)) })
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', ...json(body) })
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', ...json(body) })
export const del = (path: string) => api<void>(path, { method: 'DELETE' })

// Same-origin image URLs: the access cookie authenticates them, and the API sends Cache-Control.
export const pageUrl = (docId: string, page: number, highlight: string[] = [], dpi = 120) =>
  `/api/documents/${docId}/pages/${page}.png?dpi=${dpi}${highlight.length ? `&highlight=${highlight.join(',')}` : ''}`
export const cropUrl = (sentenceId: string) => `/api/sentences/${sentenceId}/preview.png`
export const fileUrl = (docId: string) => `/api/documents/${docId}/file`
