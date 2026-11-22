/**
 * Cloudflare Pages Function: same-origin proxy to the FastAPI backend.
 *
 * The browser only ever talks to the Pages domain, so the backend's HttpOnly auth cookies are first-party,
 * <img> page renders authenticate without headers, and there is no CORS. `_routes.json` limits this function
 * to /api/*, /auth/* and /public/*; every other path is a static file (or the SPA's index.html).
 *
 * Set API_ORIGIN in the Pages project settings, e.g. https://<user>-zeroguess-api.hf.space
 */
export async function onRequest({ request, env, next }) {
  const url = new URL(request.url)
  if (!/^\/(api|auth|public)(\/|$)/.test(url.pathname)) return next()
  if (!env.API_ORIGIN) return new Response('API_ORIGIN is not configured', { status: 500 })

  const target = new URL(url.pathname + url.search, env.API_ORIGIN)
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.set('x-forwarded-host', url.host)
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''))

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  })

  // Pass the body through untouched: answers stream as server-sent events and must not be buffered.
  const out = new Response(upstream.body, upstream)
  out.headers.set('x-proxied-by', 'pages')
  if ((upstream.headers.get('content-type') || '').includes('text/event-stream')) {
    out.headers.set('cache-control', 'no-cache, no-transform')
  }
  return out
}
