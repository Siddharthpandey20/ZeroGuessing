import { request } from './api'

// The ask endpoints are POSTs that answer with text/event-stream (sse-starlette), which EventSource
// cannot send, so the stream is read off fetch. Events are separated by a blank line; lines may end in \r\n.

export interface SseEvent {
  event: string
  data: unknown
}

export async function* streamEvents(
  path: string,
  body: unknown,
  { method = 'POST', signal }: { method?: 'POST' | 'PUT'; signal?: AbortSignal } = {},
): AsyncGenerator<SseEvent> {
  const res = await request(path, {
    method,
    body: JSON.stringify(body ?? {}),
    headers: { accept: 'text/event-stream' },
    signal,
  })
  if (!res.body) return
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += value.replace(/\r\n?/g, '\n')
    let cut: number
    while ((cut = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, cut)
      buf = buf.slice(cut + 2)
      let event = 'message'
      const data: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      if (!data.length) continue
      const raw = data.join('\n')
      let parsed: unknown = raw
      try {
        parsed = JSON.parse(raw)
      } catch {
        /* plain text event */
      }
      yield { event, data: parsed }
    }
  }
}
