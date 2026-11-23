import { useSyncExternalStore } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { streamEvents } from '../lib/sse'
import type { Message, Stage, TraceStep } from '../lib/types'

/**
 * In-flight answers, kept outside React so a stream survives route changes
 * (the first question creates a chat and moves the URL to /app/c/:id while it is still answering).
 */
export interface Pending {
  chatId: string
  turn: number | null // null: a new turn at the end; a number: edit or regenerate of that turn
  question: string
  asOf: string
  stage: Stage | null
  info: { evidence?: number; claims?: number }
  trace: TraceStep[] // finished steps, streamed as they happen
  startedAt: number
  error?: string
}

let state: Record<string, Pending> = {}
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const set = (chatId: string, p: Pending | null) => {
  const next = { ...state }
  if (p) next[chatId] = p
  else delete next[chatId]
  state = next
  emit()
}

export const usePending = (chatId: string | undefined) =>
  useSyncExternalStore(subscribe, () => (chatId ? state[chatId] ?? null : null))

export const dismissPending = (chatId: string) => set(chatId, null)

let lastFresh: string | null = null
export const takeFresh = () => lastFresh

// answers to read aloud as soon as they arrive: only questions asked with the voice-conversation button
const speakIds = new Set<string>()
export const consumeSpeak = (id: string) => speakIds.delete(id)

export async function runAnswer(
  qc: QueryClient,
  opts: { chatId: string; path: string; method?: 'POST' | 'PUT'; body?: unknown; turn: number | null; question: string; asOf: string; speakReply?: boolean },
  onDone?: (m: Message) => void,
) {
  const { chatId } = opts
  let p: Pending = { chatId, turn: opts.turn, question: opts.question, asOf: opts.asOf, stage: null, info: {}, trace: [], startedAt: Date.now() }
  set(chatId, p)
  let shown = false // an early answer is on screen; the stream stays open for its conflict-check update
  try {
    for await (const ev of streamEvents(opts.path, opts.body, { method: opts.method })) {
      const d = ev.data as Record<string, unknown>
      if (ev.event === 'stage') {
        p = { ...p, stage: d.stage as Stage, info: { ...p.info, ...(d.evidence ? { evidence: d.evidence as number } : {}), ...(d.claims ? { claims: d.claims as number } : {}) } }
        set(chatId, p)
      } else if (ev.event === 'trace') {
        p = { ...p, trace: [...p.trace, d.step as TraceStep] }
        set(chatId, p)
      } else if (ev.event === 'answer') {
        const msg = d.message as Message
        lastFresh = msg?.id ?? null
        if (opts.speakReply && msg?.id) speakIds.add(msg.id)
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['chat', chatId] }),
          qc.invalidateQueries({ queryKey: ['chats'] }),
          qc.invalidateQueries({ queryKey: ['alerts'] }),
        ])
        set(chatId, null)
        if (msg) onDone?.(msg)
        // the verified answer arrived before the conflict check finished: keep listening for its update
        if (!(d.answer as { conflicts_pending?: boolean } | undefined)?.conflicts_pending) return
        shown = true
      } else if (ev.event === 'answer_update') {
        // the same answer with any conflicts the check found; the turn is already on screen, so just refresh it
        await Promise.all([qc.invalidateQueries({ queryKey: ['chat', chatId] }), qc.invalidateQueries({ queryKey: ['alerts'] })])
        return
      } else if (ev.event === 'error') {
        if (shown) {
          // the answer is already shown and saved; only the late conflict check failed
          qc.invalidateQueries({ queryKey: ['chat', chatId] })
          return
        }
        set(chatId, { ...p, error: (d.message as string) || 'The answer could not be produced.' })
        qc.invalidateQueries({ queryKey: ['chat', chatId] })
        return
      }
    }
    if (shown) {
      qc.invalidateQueries({ queryKey: ['chat', chatId] }) // closed before the update: show what was saved
      return
    }
    // stream ended without an answer event
    set(chatId, { ...p, error: 'The connection closed before the answer arrived.' })
  } catch (e) {
    if (shown) {
      qc.invalidateQueries({ queryKey: ['chat', chatId] })
      return
    }
    set(chatId, { ...p, error: e instanceof Error ? e.message : 'The request failed.' })
  }
}
