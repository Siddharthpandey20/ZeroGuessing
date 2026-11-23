import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, ChevronLeft, ChevronRight, Files, Mic, PanelLeft, Pencil, Plus, RefreshCw, Share2, Sparkles, Square, Trash2, TriangleAlert, Upload, Volume2 } from 'lucide-react'
import { api, ApiError, cropUrl, del, patch, post } from '../lib/api'
import { canSpeak, speak, spokenAnswer, stopSpeaking } from '../lib/speech'
import type { ChatDetail, ChatDoc, ChatSummary, Message, Turn, UploadResult } from '../lib/types'
import { AnswerView } from './answer/AnswerView'
import { StageReadout } from './answer/StageReadout'
import { fmtDate, type Selection } from './answer/selection'
import { ChatDocs, isReady } from './ChatDocs'
import { Composer, type AskOptions, type InputMode } from './Composer'
import { Evidence } from './Evidence'
import { ShareDialog } from './ShareDialog'
import { consumeSpeak, dismissPending, runAnswer, takeFresh, usePending, type Pending } from './askStore'
import styles from './Ask.module.css'

const SUGGESTIONS = [
  'What is the prepayment penalty on a floating-rate home loan today?',
  'What penal charge applies to an overdue home loan instalment?',
  'What is the EMI on the home loan in the key facts statement?',
  'Are co-borrowers covered under the home loan protection insurance?',
  'Within how many days must a complaint be resolved?',
  'What is the foreclosure charge on gold loans?',
]

const cropFor = (id: string) => cropUrl(id)

export default function Ask() {
  const { chatId } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const pending = usePending(chatId)
  const [selection, setSelection] = useState<Selection>(null)
  const [railOpen, setRailOpen] = useState(false)
  const [shareFor, setShareFor] = useState<{ turn?: number } | null>(null)
  const [docsOpen, setDocsOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [notes, setNotes] = useState<string[]>([])
  const docsBtn = useRef<HTMLButtonElement>(null)

  const chats = useQuery({ queryKey: ['chats'], queryFn: () => api<ChatSummary[]>('/api/chats') })
  const chat = useQuery({ queryKey: ['chat', chatId], queryFn: () => api<ChatDetail>(`/api/chats/${chatId}`), enabled: !!chatId })
  const chatDocs = useQuery({
    queryKey: ['chat-docs', chatId],
    queryFn: () => api<ChatDoc[]>(`/api/chats/${chatId}/documents`),
    enabled: !!chatId,
    // poll only while something is still being read
    refetchInterval: (q) => (q.state.data?.some((d) => !isReady(d) && d.ingest_status !== 'failed') ? 1500 : false),
  })
  const docs = chatId ? chatDocs.data ?? [] : []
  const ready = docs.filter(isReady).length

  useEffect(() => setSelection(null), [chatId])
  useEffect(() => setNotes([]), [chatId])

  /** The chat to act on; a brand-new chat is created on first use (a question or an upload). */
  // one creation in flight at a time: two quick uploads (or an upload then a question) land in the same new chat
  const creating = useRef<Promise<string> | null>(null)
  useEffect(() => {
    creating.current = null
  }, [chatId])
  const ensureChat = useCallback(async () => {
    if (chatId) return chatId
    creating.current ??= post<ChatSummary>('/api/chats', {}).then((c) => {
      qc.invalidateQueries({ queryKey: ['chats'] })
      nav(`/app/c/${c.id}`)
      return c.id
    })
    try {
      return await creating.current
    } catch (e) {
      creating.current = null
      throw e
    }
  }, [chatId, nav, qc])

  const ask = useCallback(
    async (question: string, asOf: string, mode: InputMode, opts?: AskOptions) => {
      const id = await ensureChat()
      void runAnswer(qc, { chatId: id, path: `/api/chats/${id}/messages`, body: { question, as_of: asOf, input_mode: mode }, turn: null, question, asOf, speakReply: opts?.speakReply })
    },
    [ensureChat, qc],
  )

  /** Upload PDFs into this chat (or the demo set when `files` is omitted) and show them in the sidebar. */
  const addDocs = useCallback(
    async (files?: File[]) => {
      setUploading(true)
      setNotes([])
      setDocsOpen(true)
      try {
        const id = await ensureChat()
        let res: UploadResult[]
        if (files) {
          const fd = new FormData()
          files.forEach((f) => fd.append('files', f))
          res = await api<UploadResult[]>(`/api/chats/${id}/documents`, { method: 'POST', body: fd })
        } else {
          res = await post<UploadResult[]>(`/api/chats/${id}/documents/demo`)
        }
        setNotes(res.filter((r) => r.status === 'rejected').map((r) => `${r.filename} was not added: ${r.detail ?? 'not a usable PDF'}.`))
        await Promise.all([qc.invalidateQueries({ queryKey: ['chat-docs', id] }), qc.invalidateQueries({ queryKey: ['documents'] })])
      } catch (e) {
        setNotes([e instanceof ApiError ? e.message : 'The upload failed. Check your connection and try again.'])
      } finally {
        setUploading(false)
      }
    },
    [ensureChat, qc],
  )

  const removeDoc = useCallback(
    async (docId: string) => {
      if (!chatId) return
      qc.setQueryData<ChatDoc[]>(['chat-docs', chatId], (l) => l?.filter((d) => d.id !== docId))
      try {
        await del(`/api/chats/${chatId}/documents/${docId}`)
      } finally {
        qc.invalidateQueries({ queryKey: ['chat-docs', chatId] })
      }
    },
    [chatId, qc],
  )

  const closeDocs = useCallback(() => setDocsOpen(false), [])
  const busy = !!pending && !pending.error
  const showEmpty = !chatId || (!!chat.data && chat.data.turns.length === 0 && !pending)

  return (
    <div className={styles.ask} data-evidence={selection ? 'open' : undefined} data-rail={railOpen ? 'open' : undefined}>
      <ChatRail chats={chats.data} loading={chats.isLoading} activeId={chatId} onPick={() => setRailOpen(false)}
        onDelete={async (id) => {
          await del(`/api/chats/${id}`)
          qc.invalidateQueries({ queryKey: ['chats'] })
          if (id === chatId) nav('/app')
        }}
      />

      <section className={styles.thread} aria-label="Conversation">
        <div className={styles.threadTop}>
          <button type="button" className={`btn btn-quiet btn-icon btn-sm ${styles.railToggle}`} onClick={() => setRailOpen((o) => !o)} aria-label="Show chats">
            <PanelLeft size={16} strokeWidth={1.8} />
          </button>
          <ChatName chatId={chatId} title={chat.data?.title} />
          <button ref={docsBtn} type="button" className={`btn btn-ghost btn-sm ${styles.docsBtn}`} onClick={() => setDocsOpen((o) => !o)}
            aria-expanded={docsOpen} aria-label={`Documents in this chat: ${docs.length}`}>
            <Files size={14} strokeWidth={1.8} aria-hidden="true" />
            <span className={styles.docsLabel}>Documents</span>
            <span className={`${styles.docsCount} tnum`} data-empty={docs.length === 0 || undefined}>{docs.length}</span>
          </button>
          {chatId && !!chat.data?.turns.length && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShareFor({})} aria-label="Share this chat">
              <Share2 size={14} strokeWidth={1.8} aria-hidden="true" /> <span className={styles.docsLabel}>Share</span>
            </button>
          )}
        </div>

        {showEmpty ? (
          <EmptyChat onAsk={ask} onAttach={addDocs} onDemo={() => addDocs()} onOpenDocs={() => setDocsOpen(true)}
            total={docs.length} ready={ready} loading={!!chatId && chatDocs.isLoading} uploading={uploading} />
        ) : (
          <Thread
            chatId={chatId!}
            detail={chat.data}
            loading={chat.isLoading}
            error={chat.isError}
            pending={pending}
            selection={selection}
            onSelect={setSelection}
            onShare={(turn) => setShareFor({ turn })}
            onAsk={ask}
            onAttach={addDocs}
            busy={busy}
          />
        )}
      </section>

      <aside className={styles.evidence} aria-label="Evidence">
        <Evidence selection={selection} onClose={() => setSelection(null)} onSelect={setSelection} cropFor={cropFor} />
      </aside>

      <ChatDocs open={docsOpen} onClose={closeDocs} docs={docs} loading={!!chatId && chatDocs.isLoading} uploading={uploading} notes={notes}
        onUpload={addDocs} onDemo={() => addDocs()} onRemove={removeDoc} returnFocus={docsBtn} />

      {shareFor && chatId && <ShareDialog chatId={chatId} turn={shareFor.turn} onClose={() => setShareFor(null)} />}
    </div>
  )
}

/** The chat's short name, editable in place (Enter or leaving the field saves, Escape cancels). */
function ChatName({ chatId, title }: { chatId?: string; title?: string }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)

  if (!chatId) return <h1 className={styles.chatTitle}>New chat</h1>

  const save = async () => {
    const t = value.trim().replace(/\s+/g, ' ').slice(0, 60)
    setEditing(false)
    if (!t || t === title) return
    qc.setQueryData<ChatDetail>(['chat', chatId], (d) => (d ? { ...d, title: t } : d))
    qc.setQueryData<ChatSummary[]>(['chats'], (l) => l?.map((c) => (c.id === chatId ? { ...c, title: t } : c)))
    try {
      await patch(`/api/chats/${chatId}`, { title: t })
      setError(false)
    } catch {
      setError(true)
    } finally {
      qc.invalidateQueries({ queryKey: ['chats'] })
      qc.invalidateQueries({ queryKey: ['chat', chatId] })
    }
  }

  if (editing)
    return (
      <input className={styles.titleInput} autoFocus value={value} maxLength={60} aria-label="Chat name"
        onChange={(e) => setValue(e.target.value)} onBlur={save} onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            setValue(title ?? '')
            setEditing(false)
          }
        }} />
    )
  return (
    <div className={styles.titleRow}>
      <h1 className={styles.chatTitle} onDoubleClick={() => { setValue(title ?? ''); setEditing(true) }}>{title ?? ' '}</h1>
      <button type="button" className={`btn btn-quiet btn-icon btn-sm ${styles.rename}`} onClick={() => { setValue(title ?? ''); setEditing(true) }} aria-label="Rename this chat" title="Rename">
        <Pencil size={13} strokeWidth={1.8} />
      </button>
      {error && <span className={styles.renameErr} role="alert">Not saved</span>}
    </div>
  )
}

function ChatRail({ chats, loading, activeId, onPick, onDelete }: {
  chats?: ChatSummary[]; loading: boolean; activeId?: string; onPick: () => void; onDelete: (id: string) => void
}) {
  const [confirm, setConfirm] = useState<string | null>(null)
  return (
    <nav className={styles.rail} aria-label="Your chats">
      <Link to="/app" className="btn btn-ink btn-sm" onClick={onPick}>
        <Plus size={15} strokeWidth={2} aria-hidden="true" /> New chat
      </Link>
      <div className={styles.railList}>
        {loading && [0, 1, 2, 3].map((i) => <span key={i} className={`skeleton ${styles.railSkel}`} />)}
        {!loading && !chats?.length && <p className={styles.railEmpty}>Chats you start are kept here.</p>}
        {chats?.map((c) => (
          <div key={c.id} className={styles.railItem} data-active={c.id === activeId || undefined}>
            {confirm === c.id ? (
              <div className={styles.confirm}>
                <span>Delete this chat?</span>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirm(null)}>Keep</button>
                <button type="button" className={`btn btn-sm ${styles.danger}`} onClick={() => { setConfirm(null); onDelete(c.id) }}>Delete</button>
              </div>
            ) : (
              <>
                <Link to={`/app/c/${c.id}`} className={styles.railLink} onClick={onPick}>
                  <span className={styles.railTitle}>{c.title}</span>
                  <span className={styles.railDate}>{fmtDate(c.updated_at, { day: 'numeric', month: 'short' })}</span>
                </Link>
                <button type="button" className={`btn btn-quiet btn-icon btn-sm ${styles.railDel}`} onClick={() => setConfirm(c.id)} aria-label={`Delete “${c.title}”`}>
                  <Trash2 size={14} strokeWidth={1.8} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </nav>
  )
}

function EmptyChat({ onAsk, onAttach, onDemo, onOpenDocs, total, ready, loading, uploading }: {
  onAsk: (q: string, a: string, m: InputMode, o?: AskOptions) => void; onAttach: (files: File[]) => void; onDemo: () => void; onOpenDocs: () => void
  total: number; ready: number; loading: boolean; uploading: boolean
}) {
  const [seed, setSeed] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const working = total - ready
  return (
    <div className={styles.empty}>
      <div className={styles.emptyInner}>
        <h2 className={styles.emptyHead}>Ask the documents.<br />Get only what they prove.</h2>
        {loading ? (
          <p className={styles.emptySub}>Checking this chat’s documents</p>
        ) : total === 0 ? (
          <>
            <p className={styles.emptySub}>Start by adding the PDFs this chat should answer from. Answers will quote them and nothing else.</p>
            <input ref={picker} type="file" accept="application/pdf,.pdf" multiple hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                if (files.length) onAttach(files)
                e.target.value = ''
              }} />
            <div className={styles.startActions}>
              <button type="button" className="btn btn-ink" onClick={() => picker.current?.click()} disabled={uploading}>
                <Upload size={15} strokeWidth={1.8} aria-hidden="true" /> Upload PDFs
              </button>
              <button type="button" className="btn btn-ghost" onClick={onDemo} disabled={uploading}>
                <Sparkles size={15} strokeWidth={1.8} aria-hidden="true" /> Use the demo documents
              </button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.emptySub}>
              {total} {total === 1 ? 'document' : 'documents'} in this chat{working > 0 ? `, ${working} still being read` : ''}.{' '}
              <button type="button" className={styles.inlineLink} onClick={onOpenDocs}>See them</button>
            </p>
            <ul className={styles.suggest}>
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button type="button" onClick={() => setSeed(s)}>{s}</button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className={styles.dock}>
        <Composer key={seed ?? 'blank'} initial={seed ? { question: seed, asOf: new Date().toISOString().slice(0, 10) } : undefined} onSubmit={onAsk} onAttach={onAttach} autoFocus />
      </div>
    </div>
  )
}

function Thread({ chatId, detail, loading, error, pending, selection, onSelect, onShare, onAsk, onAttach, busy }: {
  chatId: string; detail?: ChatDetail; loading: boolean; error: boolean; pending: Pending | null; selection: Selection
  onSelect: (s: Selection) => void; onShare: (turn: number) => void; onAsk: (q: string, a: string, m: InputMode, o?: AskOptions) => void
  onAttach: (files: File[]) => void; busy: boolean
}) {
  const qc = useQueryClient()
  const scroller = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<Record<number, number>>({})
  const [editing, setEditing] = useState<number | null>(null)
  const [speaking, setSpeaking] = useState<string | null>(null)
  const spokeFor = useRef<string | null>(null)
  const fresh = takeFresh()
  const turns = detail?.turns ?? []
  const selectedSentence = selection?.kind === 'citation' ? selection.citation.sentence_id : null

  // A new question scrolls its own heading to the top, so the answer reads from its first line.
  // Opening an existing chat starts at its latest turn.
  const count = turns.length + (pending && pending.turn === null ? 1 : 0)
  const first = useRef(true)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !count) return
    const last = el.querySelector<HTMLElement>('article:last-of-type')
    if (!last) return
    const top = last.offsetTop - 24
    el.scrollTo({ top, behavior: first.current ? 'auto' : 'smooth' })
    first.current = false
  }, [count])

  const listen = (m: Message) => {
    if (!m.answer) return
    if (speaking === m.id) {
      stopSpeaking()
      setSpeaking(null)
      return
    }
    const s = spokenAnswer(m.answer)
    setSpeaking(m.id)
    speak(s.text, s.lang, () => setSpeaking((x) => (x === m.id ? null : x)))
  }

  // a question asked with the voice-conversation button gets its answer read back once it arrives
  useEffect(() => {
    if (!fresh || spokeFor.current === fresh || !canSpeak()) return
    const m = turns.flatMap((t) => t.versions).find((v) => v.id === fresh)
    if (m && m.answer && !m.answer.error && consumeSpeak(m.id)) {
      spokeFor.current = fresh
      listen(m)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh, turns])
  useEffect(() => () => stopSpeaking(), [chatId])

  // Editing or re-running a past question continues the conversation from there: the questions and answers after it
  // disappear at once (the server deletes them too), like ChatGPT.
  const dropAfter = (turn: number) => {
    void qc.cancelQueries({ queryKey: ['chat', chatId] })
    qc.setQueryData<ChatDetail>(['chat', chatId], (d) => (d ? { ...d, turns: d.turns.filter((x) => x.turn <= turn) } : d))
    setView((v) => Object.fromEntries(Object.entries(v).filter(([k]) => Number(k) <= turn)))
    onSelect(null)
  }
  const resend = (t: Turn, question: string, asOf: string, mode: InputMode) => {
    setEditing(null)
    dropAfter(t.turn)
    void runAnswer(qc, { chatId, path: `/api/chats/${chatId}/turns/${t.turn}`, method: 'PUT', body: { question, as_of: asOf, input_mode: mode }, turn: t.turn, question, asOf },
      (m) => setView((v) => ({ ...v, [t.turn]: m.version })))
  }
  const regenerate = (t: Turn, m: Message) => {
    dropAfter(t.turn)
    void runAnswer(qc, { chatId, path: `/api/chats/${chatId}/turns/${t.turn}/regenerate`, turn: t.turn, question: m.question, asOf: m.as_of },
      (msg) => setView((v) => ({ ...v, [t.turn]: msg.version })))
  }

  return (
    <>
      <div className={styles.scroll} ref={scroller}>
        <div className={styles.turns}>
          {loading && <div className={styles.turnSkel}><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>}
          {error && <p className={styles.loadError}>This chat could not be loaded. It may have been deleted.</p>}
          {turns.map((t) => {
            const version = view[t.turn] ?? t.latest
            const m = t.versions.find((v) => v.version === version) ?? t.versions[t.versions.length - 1]
            const live = pending && pending.turn === t.turn ? pending : null
            return (
              <article key={t.turn} className={styles.turn}>
                <header className={styles.qRow}>
                  {editing === t.turn ? (
                    <div className={styles.editBox}>
                      <Composer compact autoFocus submitLabel="Resend" initial={{ question: m.question, asOf: m.as_of }} onCancel={() => setEditing(null)} onSubmit={(q, a, mode) => resend(t, q, a, mode)} />
                    </div>
                  ) : (
                    <>
                      <p className={styles.question}>{live ? live.question : m.question}</p>
                      <div className={styles.qMeta}>
                        {m.input_mode === 'camera' && <span className={styles.badge}><Camera size={12} aria-hidden="true" /> From a photo</span>}
                        {m.input_mode === 'voice' && <span className={styles.badge}><Mic size={12} aria-hidden="true" /> Spoken</span>}
                        {t.versions.length > 1 && !live && (
                          <span className={styles.versions} aria-label="Versions of this question">
                            <button type="button" className="btn btn-quiet btn-icon btn-sm" disabled={version <= 1} onClick={() => setView((v) => ({ ...v, [t.turn]: version - 1 }))} aria-label="Previous version"><ChevronLeft size={14} /></button>
                            <span className="tnum">{version} of {t.versions.length}</span>
                            <button type="button" className="btn btn-quiet btn-icon btn-sm" disabled={version >= t.versions.length} onClick={() => setView((v) => ({ ...v, [t.turn]: version + 1 }))} aria-label="Next version"><ChevronRight size={14} /></button>
                          </span>
                        )}
                        {!live && (
                          <button type="button" className="btn btn-quiet btn-icon btn-sm" onClick={() => setEditing(t.turn)} disabled={busy} aria-label="Edit the question or its date and resend">
                            <Pencil size={14} strokeWidth={1.8} />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </header>

                <div className={styles.sheet}>
                  {live ? (
                    live.error ? <StreamError p={live} chatId={chatId} /> : <StageReadout stage={live.stage} info={live.info} />
                  ) : m.status === 'failed' || !m.answer || m.answer.error ? (
                    <FailedAnswer message={(m.answer?.error as string) ?? 'This answer failed.'} onRetry={() => regenerate(t, m)} />
                  ) : (
                    <AnswerView answer={m.answer} cropFor={cropFor} onSelect={onSelect} selectedSentence={selectedSentence} fresh={fresh === m.id} />
                  )}
                </div>

                {!live && m.answer && m.status !== 'failed' && !m.answer.error && (
                  <footer className={styles.turnActions}>
                    {canSpeak() && (
                      <button type="button" className="btn btn-quiet btn-sm" onClick={() => listen(m)} aria-pressed={speaking === m.id}>
                        {speaking === m.id ? <Square size={12} strokeWidth={2.4} aria-hidden="true" /> : <Volume2 size={13} strokeWidth={1.8} aria-hidden="true" />}
                        {speaking === m.id ? ' Stop' : ' Listen'}
                      </button>
                    )}
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => regenerate(t, m)} disabled={busy}>
                      <RefreshCw size={13} strokeWidth={1.8} aria-hidden="true" /> Run again
                    </button>
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => onShare(t.turn)}>
                      <Share2 size={13} strokeWidth={1.8} aria-hidden="true" /> Share this answer
                    </button>
                  </footer>
                )}
              </article>
            )
          })}

          {pending && pending.turn === null && (
            <article key="pending" className={`${styles.turn} ${styles.arrive}`}>
              <header className={styles.qRow}><p className={styles.question}>{pending.question}</p></header>
              <div className={styles.sheet}>
                {pending.error ? <StreamError p={pending} chatId={chatId} /> : <StageReadout stage={pending.stage} info={pending.info} />}
              </div>
            </article>
          )}
        </div>
      </div>
      <div className={styles.dock}>
        <Composer onSubmit={onAsk} onAttach={onAttach} busy={busy} />
      </div>
    </>
  )
}

function StreamError({ p, chatId }: { p: Pending; chatId: string }) {
  return (
    <div className={styles.failed} role="alert">
      <p className={styles.failedHead}><TriangleAlert size={16} strokeWidth={1.8} aria-hidden="true" /> No answer was produced, so nothing is shown.</p>
      <p className={styles.failedBody}>{p.error}</p>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => dismissPending(chatId)}>Dismiss</button>
    </div>
  )
}

function FailedAnswer({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={styles.failed} role="alert">
      <p className={styles.failedHead}><TriangleAlert size={16} strokeWidth={1.8} aria-hidden="true" /> No answer was produced, so nothing is shown.</p>
      <p className={styles.failedBody}>{message}</p>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}><RefreshCw size={13} aria-hidden="true" /> Try again</button>
    </div>
  )
}
