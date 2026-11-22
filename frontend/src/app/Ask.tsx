import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, ChevronLeft, ChevronRight, PanelLeft, Pencil, Plus, RefreshCw, Share2, Trash2, TriangleAlert } from 'lucide-react'
import { api, cropUrl, del, post } from '../lib/api'
import type { ChatDetail, ChatSummary, DocumentRow, Message, Turn } from '../lib/types'
import { AnswerView } from './answer/AnswerView'
import { StageReadout } from './answer/StageReadout'
import { fmtDate, type Selection } from './answer/selection'
import { Composer, type InputMode } from './Composer'
import { Evidence } from './Evidence'
import { ShareDialog } from './ShareDialog'
import { dismissPending, runAnswer, takeFresh, usePending, type Pending } from './askStore'
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

  const chats = useQuery({ queryKey: ['chats'], queryFn: () => api<ChatSummary[]>('/api/chats') })
  const chat = useQuery({ queryKey: ['chat', chatId], queryFn: () => api<ChatDetail>(`/api/chats/${chatId}`), enabled: !!chatId })
  const docs = useQuery({ queryKey: ['documents'], queryFn: () => api<DocumentRow[]>('/api/documents') })

  useEffect(() => setSelection(null), [chatId])

  const ask = useCallback(
    async (question: string, asOf: string, mode: InputMode) => {
      let id = chatId
      if (!id) {
        const c = await post<ChatSummary>('/api/chats', {})
        id = c.id
        qc.invalidateQueries({ queryKey: ['chats'] })
        nav(`/app/c/${id}`)
      }
      void runAnswer(qc, { chatId: id, path: `/api/chats/${id}/messages`, body: { question, as_of: asOf, input_mode: mode }, turn: null, question, asOf })
    },
    [chatId, nav, qc],
  )

  const busy = !!pending && !pending.error
  const indexed = docs.data?.filter((d) => d.active && d.ingest_status.startsWith('indexed')).length ?? 0

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
          <button type="button" className={`btn btn-quiet btn-icon btn-sm ${styles.railToggle}`} onClick={() => setRailOpen((o) => !o)} aria-label="Show questions">
            <PanelLeft size={16} strokeWidth={1.8} />
          </button>
          <h1 className={styles.chatTitle}>{chatId ? chat.data?.title ?? ' ' : 'New question'}</h1>
          {chatId && !!chat.data?.turns.length && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShareFor({})}>
              <Share2 size={14} strokeWidth={1.8} aria-hidden="true" /> Share
            </button>
          )}
        </div>

        {!chatId ? (
          <EmptyChat onAsk={ask} indexed={indexed} docsLoading={docs.isLoading} />
        ) : (
          <Thread
            chatId={chatId}
            detail={chat.data}
            loading={chat.isLoading}
            error={chat.isError}
            pending={pending}
            selection={selection}
            onSelect={setSelection}
            onShare={(turn) => setShareFor({ turn })}
            onAsk={ask}
            busy={busy}
          />
        )}
      </section>

      <aside className={styles.evidence} aria-label="Evidence">
        <Evidence selection={selection} onClose={() => setSelection(null)} onSelect={setSelection} cropFor={cropFor} />
      </aside>

      {shareFor && chatId && <ShareDialog chatId={chatId} turn={shareFor.turn} onClose={() => setShareFor(null)} />}
    </div>
  )
}

function ChatRail({ chats, loading, activeId, onPick, onDelete }: {
  chats?: ChatSummary[]; loading: boolean; activeId?: string; onPick: () => void; onDelete: (id: string) => void
}) {
  const [confirm, setConfirm] = useState<string | null>(null)
  return (
    <nav className={styles.rail} aria-label="Your questions">
      <Link to="/app" className="btn btn-ink btn-sm" onClick={onPick}>
        <Plus size={15} strokeWidth={2} aria-hidden="true" /> New question
      </Link>
      <div className={styles.railList}>
        {loading && [0, 1, 2, 3].map((i) => <span key={i} className={`skeleton ${styles.railSkel}`} />)}
        {!loading && !chats?.length && <p className={styles.railEmpty}>Questions you ask are kept here.</p>}
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

function EmptyChat({ onAsk, indexed, docsLoading }: { onAsk: (q: string, a: string, m: InputMode) => void; indexed: number; docsLoading: boolean }) {
  const [seed, setSeed] = useState<string | null>(null)
  return (
    <div className={styles.empty}>
      <div className={styles.emptyInner}>
        <h2 className={styles.emptyHead}>Ask the documents.<br />Get only what they prove.</h2>
        <p className={styles.emptySub}>
          {docsLoading ? 'Checking the library' : indexed ? (
            <>{indexed} {indexed === 1 ? 'document is' : 'documents are'} loaded. <Link to="/app/library">See the library</Link></>
          ) : (
            <>No documents are loaded yet. <Link to="/app/library">Add some in the library</Link></>
          )}
        </p>
        <ul className={styles.suggest}>
          {SUGGESTIONS.map((s) => (
            <li key={s}>
              <button type="button" onClick={() => setSeed(s)}>{s}</button>
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.dock}>
        <Composer key={seed ?? 'blank'} initial={seed ? { question: seed, asOf: new Date().toISOString().slice(0, 10) } : undefined} onSubmit={onAsk} autoFocus />
      </div>
    </div>
  )
}

function Thread({ chatId, detail, loading, error, pending, selection, onSelect, onShare, onAsk, busy }: {
  chatId: string; detail?: ChatDetail; loading: boolean; error: boolean; pending: Pending | null; selection: Selection
  onSelect: (s: Selection) => void; onShare: (turn: number) => void; onAsk: (q: string, a: string, m: InputMode) => void; busy: boolean
}) {
  const qc = useQueryClient()
  const scroller = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<Record<number, number>>({})
  const [editing, setEditing] = useState<number | null>(null)
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

  const resend = (t: Turn, question: string, asOf: string, mode: InputMode) => {
    setEditing(null)
    void runAnswer(qc, { chatId, path: `/api/chats/${chatId}/turns/${t.turn}`, method: 'PUT', body: { question, as_of: asOf, input_mode: mode }, turn: t.turn, question, asOf },
      (m) => setView((v) => ({ ...v, [t.turn]: m.version })))
  }
  const regenerate = (t: Turn, m: Message) => {
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

                {!live && m.answer && m.status !== 'failed' && (
                  <footer className={styles.turnActions}>
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
        <Composer onSubmit={onAsk} busy={busy} />
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

