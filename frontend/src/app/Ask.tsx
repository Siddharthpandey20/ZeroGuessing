import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Check, ChevronLeft, ChevronRight, Copy, Files, Mic, PanelLeft, Pencil, Plus, RefreshCw, Share2, Sparkles, Square, Trash2, TriangleAlert, Upload, Volume2 } from 'lucide-react'
import { api, ApiError, cropUrl, del, patch, post } from '../lib/api'
import { canSpeak, speak, spokenAnswer, stopSpeaking } from '../lib/speech'
import type { Answer, ChatDetail, ChatDoc, ChatSummary, Message, Turn, UploadResult } from '../lib/types'
import { AnswerView } from './answer/AnswerView'
import { LiveTrace } from './answer/WorkTrace'
import { fmtDate, type Selection } from './answer/selection'
import { ChatDocs, isReady } from './ChatDocs'
import { Composer, type AskOptions, type Attachment, type InputMode } from './Composer'
import { Evidence } from './Evidence'
import { PromptNav, type NavItem } from './PromptNav'
import { ShareDialog } from './ShareDialog'
import { consumeSpeak, dismissPending, runAnswer, stopAnswer, takeFresh, usePending, type Pending } from './askStore'
import styles from './Ask.module.css'
import { tr } from '../lib/i18n'

/** The answer as plain text for the clipboard: what is shown on screen (in the answer's language), each claim with
 * its source, so the copied text keeps its proof. Blocked claims are left out, as they are not part of the answer. */
function answerText(a: Answer): string {
  if (a.status === 'chat') return a.reply ?? ''
  const hindi = a.lang === 'hi' || a.lang === 'hne'
  const lines = [a.question.trim(), '']
  const shown = a.claims.filter((c) => c.verdict === 'supported' || c.verdict === 'conflicted')
  for (const c of shown) {
    const src = [...new Map(c.citations.map((x) => {
      const ref = x.clause_ref && !x.clause_ref.startsWith('_') ? `, ${x.clause_ref}` : ''
      const s = `${x.doc_title}${ref}, p.${x.page}`
      return [s, s] as const
    })).values()]
    lines.push(`• ${((hindi && c.text_hi) || c.text).trim()}${src.length ? ` [${src.join('; ')}]` : ''}`)
  }
  if (a.abstention?.message) lines.push(...(shown.length ? [''] : []), a.abstention.message)
  return lines.join('\n').trim()
}

/** A drag that carries files from the computer (not selected text or a link from the page). */
const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')
const isPdf = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')

/** Clipboard API where allowed (https, localhost); otherwise a hidden textarea, e.g. a phone opening the dev server
 * by its LAN address over plain http. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall through */ }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try { ok = document.execCommand('copy') } catch { ok = false }
  ta.remove()
  return ok
}

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
  const [dragging, setDragging] = useState(false)
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

  // PDFs added from the question box: chips in the box until the next question is sent (as in ChatGPT)
  const [attached, setAttached] = useState<{ key: string; name: string; docId?: string; error?: string | null }[]>([])
  const shownChat = useRef(chatId)
  useEffect(() => {
    // a brand-new chat is created by its first upload: keep those chips when the address changes to it
    if (shownChat.current) setAttached([])
    shownChat.current = chatId
  }, [chatId])
  const attachments: Attachment[] = attached.map((a) => {
    if (a.error !== undefined) return { key: a.key, name: a.name, state: 'failed', detail: a.error }
    if (!a.docId) return { key: a.key, name: a.name, state: 'uploading' }
    const d = docs.find((x) => x.id === a.docId)
    if (!d) return { key: a.key, name: a.name, state: 'working' }
    if (d.ingest_status === 'failed') return { key: a.key, name: a.name, state: 'failed', detail: d.ingest_error }
    return { key: a.key, name: a.name, state: isReady(d) ? 'ready' : 'working' }
  })
  // nothing is sent while any document of this chat is still being uploaded or read
  const waiting = uploading || docs.some((d) => !isReady(d) && d.ingest_status !== 'failed')

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
      setAttached([]) // the chips belong to this question; the documents stay in the chat
      void runAnswer(qc, { chatId: id, path: `/api/chats/${id}/messages`, body: { question, as_of: asOf, input_mode: mode, reply_lang: opts?.replyLang }, turn: null, question, asOf, speakReply: opts?.speakReply })
    },
    [ensureChat, qc],
  )

  /** Upload PDFs into this chat (or the demo set when `files` is omitted); they show as chips in the question box. */
  const addDocs = useCallback(
    async (files?: File[]) => {
      setUploading(true)
      setNotes([])
      const batch = `${Date.now()}`
      const holders = (files ? files.map((f) => f.name) : [tr('Demo documents')]).map((name, i) => ({ key: `${batch}-${i}`, name }))
      setAttached((l) => [...l, ...holders])
      const settle = (next: typeof attached) => setAttached((l) => [...l.filter((a) => !holders.some((h) => h.key === a.key)), ...next])
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
        settle(res.map((r, i) => r.status === 'rejected' || !r.document_id
          ? { key: `${batch}-r${i}`, name: r.filename, error: r.detail ?? tr('Not a usable PDF') }
          : { key: r.document_id, name: r.filename, docId: r.document_id }))
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : tr('The upload failed. Check your connection and try again.')
        setNotes([msg])
        settle(holders.map((h) => ({ ...h, error: msg })))
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

  /** The ✕ on a chip: take that PDF out of this chat again (a failed one just goes away). */
  const removeAttachment = useCallback(
    (key: string) => {
      const a = attached.find((x) => x.key === key)
      setAttached((l) => l.filter((x) => x.key !== key))
      if (a?.docId) void removeDoc(a.docId)
    },
    [attached, removeDoc],
  )
  const attach = { attachments, onRemoveAttachment: removeAttachment, waiting }

  // A file dropped just outside the chat (the chat list, the evidence panel) must not make the browser leave the app
  // to open the PDF. Drops inside the chat are handled by the conversation column below.
  useEffect(() => {
    const block = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault()
    }
    const end = () => setDragging(false)
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    window.addEventListener('drop', end)
    window.addEventListener('dragend', end)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
      window.removeEventListener('drop', end)
      window.removeEventListener('dragend', end)
    }
  }, [])

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

      <section className={styles.thread} aria-label={tr('Conversation')}
        onDragEnter={(e) => { if (hasFiles(e)) { e.preventDefault(); setDragging(true) } }}
        onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = uploading ? 'none' : 'copy'; setDragging(true) } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false) }}
        onDrop={(e) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          setDragging(false)
          if (uploading) return
          const all = Array.from(e.dataTransfer.files)
          const pdfs = all.filter(isPdf)
          const others = all.filter((f) => !isPdf(f))
          if (others.length) {  // shown as failed chips in the question box, like a rejected upload
            const at = Date.now()
            setAttached((l) => [...l, ...others.map((f, i) => ({ key: `drop-${at}-${i}`, name: f.name, error: tr('Only PDF files can be added') }))])
          }
          if (pdfs.length) void addDocs(pdfs)
        }}>
        {dragging && (
          <div className={styles.dropOverlay} aria-hidden="true">
            <Upload size={22} strokeWidth={1.8} />
            <span>{tr('Drop PDFs to add them to this chat')}</span>
          </div>
        )}
        <div className={styles.threadTop} data-tour="chat-bar">
          <button type="button" data-tour="rail-toggle" className={`btn btn-quiet btn-icon btn-sm ${styles.railToggle}`} onClick={() => setRailOpen((o) => !o)} aria-label={tr('Show chats')}>
            <PanelLeft size={16} strokeWidth={1.8} />
          </button>
          <ChatName chatId={chatId} title={chat.data?.title} />
          <button ref={docsBtn} type="button" className={`btn btn-ghost btn-sm ${styles.docsBtn}`} onClick={() => setDocsOpen((o) => !o)}
            aria-expanded={docsOpen} aria-label={tr('Documents in this chat: {n}', { n: docs.length })}>
            <Files size={14} strokeWidth={1.8} aria-hidden="true" />
            <span className={styles.docsLabel}>{tr('Documents')}</span>
            <span className={`${styles.docsCount} tnum`} data-empty={docs.length === 0 || undefined}>{docs.length}</span>
          </button>
          {chatId && !!chat.data?.turns.length && (
            <button type="button" className="btn btn-ghost btn-sm" data-tour="share" onClick={() => setShareFor({})} aria-label={tr('Share this chat')}>
              <Share2 size={14} strokeWidth={1.8} aria-hidden="true" /> <span className={styles.docsLabel}>{tr('Share')}</span>
            </button>
          )}
        </div>

        {showEmpty ? (
          <EmptyChat onAsk={ask} onAttach={addDocs} onDemo={() => addDocs()} onOpenDocs={() => setDocsOpen(true)}
            total={docs.length} ready={ready} loading={!!chatId && chatDocs.isLoading} uploading={uploading} attach={attach} />
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
            attach={attach}
          />
        )}
      </section>

      <aside className={styles.evidence} aria-label={tr('Evidence')}>
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

  if (!chatId) return <h1 className={styles.chatTitle} data-tour="chat-name">{tr('New chat')}</h1>

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
      <input className={styles.titleInput} autoFocus value={value} maxLength={60} aria-label={tr('Chat name')}
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
    <div className={styles.titleRow} data-tour="chat-name">
      <h1 className={styles.chatTitle} onDoubleClick={() => { setValue(title ?? ''); setEditing(true) }}>{title ?? ' '}</h1>
      <button type="button" data-tour="rename" className={`btn btn-quiet btn-icon btn-sm ${styles.rename}`} onClick={() => { setValue(title ?? ''); setEditing(true) }} aria-label={tr('Rename this chat')} title={tr('Rename')}>
        <Pencil size={13} strokeWidth={1.8} />
      </button>
      {error && <span className={styles.renameErr} role="alert">{tr('Not saved')}</span>}
    </div>
  )
}

function ChatRail({ chats, loading, activeId, onPick, onDelete }: {
  chats?: ChatSummary[]; loading: boolean; activeId?: string; onPick: () => void; onDelete: (id: string) => void
}) {
  const [confirm, setConfirm] = useState<string | null>(null)
  return (
    <nav className={styles.rail} aria-label={tr('Your chats')}>
      <Link to="/app" data-tour="new-chat" className="btn btn-ink btn-sm" onClick={onPick}>
        <Plus size={15} strokeWidth={2} aria-hidden="true" /> {tr('New chat')}
      </Link>
      <div className={styles.railList}>
        {loading && [0, 1, 2, 3].map((i) => <span key={i} className={`skeleton ${styles.railSkel}`} />)}
        {!loading && !chats?.length && <p className={styles.railEmpty}>{tr('Chats you start are kept here.')}</p>}
        {chats?.map((c) => (
          <div key={c.id} className={styles.railItem} data-active={c.id === activeId || undefined}>
            {confirm === c.id ? (
              <div className={styles.confirm}>
                <span>{tr('Delete this chat?')}</span>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirm(null)}>{tr('Keep')}</button>
                <button type="button" className={`btn btn-sm ${styles.danger}`} onClick={() => { setConfirm(null); onDelete(c.id) }}>{tr('Delete')}</button>
              </div>
            ) : (
              <>
                <Link to={`/app/c/${c.id}`} className={styles.railLink} onClick={onPick}>
                  <span className={styles.railTitle}>{c.title}</span>
                  <span className={styles.railDate}>{fmtDate(c.updated_at, { day: 'numeric', month: 'short' })}</span>
                </Link>
                <button type="button" className={`btn btn-quiet btn-icon btn-sm ${styles.railDel}`} onClick={() => setConfirm(c.id)} aria-label={tr('Delete “{title}”', { title: c.title })}>
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

/** What the question box shows about PDFs just added, and whether it may send yet. */
interface AttachState { attachments: Attachment[]; onRemoveAttachment: (key: string) => void; waiting: boolean }

function EmptyChat({ onAsk, onAttach, onDemo, onOpenDocs, total, ready, loading, uploading, attach }: {
  onAsk: (q: string, a: string, m: InputMode, o?: AskOptions) => void; onAttach: (files: File[]) => void; onDemo: () => void; onOpenDocs: () => void
  total: number; ready: number; loading: boolean; uploading: boolean; attach: AttachState
}) {
  const [seed, setSeed] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const working = total - ready
  return (
    <div className={styles.empty}>
      <div className={styles.emptyInner}>
        <h2 className={styles.emptyHead}>{tr('Ask the documents.')}<br />{tr('Get only what they prove.')}</h2>
        {loading ? (
          <p className={styles.emptySub}>{tr('Checking this chat’s documents')}</p>
        ) : total === 0 ? (
          <>
            <p className={styles.emptySub}>{tr('Start by adding the PDFs this chat should answer from. Answers will quote them and nothing else.')}</p>
            <input ref={picker} type="file" accept="application/pdf,.pdf" multiple hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                if (files.length) onAttach(files)
                e.target.value = ''
              }} />
            <div className={styles.startActions}>
              <button type="button" data-tour="upload-empty" className="btn btn-ink" onClick={() => picker.current?.click()} disabled={uploading}>
                <Upload size={15} strokeWidth={1.8} aria-hidden="true" /> {tr('Upload PDFs')}
              </button>
              <button type="button" className="btn btn-ghost" onClick={onDemo} disabled={uploading}>
                <Sparkles size={15} strokeWidth={1.8} aria-hidden="true" /> {tr('Use the demo documents')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.emptySub}>
              {tr(total === 1 ? '{n} document in this chat' : '{n} documents in this chat', { n: total })}{working > 0 ? tr(', {n} still being read', { n: working }) : ''}.{' '}
              <button type="button" className={styles.inlineLink} onClick={onOpenDocs}>{tr('See them')}</button>
            </p>
            <ul className={styles.suggest}>
              {SUGGESTIONS.map((q) => tr(q)).map((s) => (
                <li key={s}>
                  <button type="button" onClick={() => setSeed(s)}>{s}</button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className={styles.dock}>
        <Composer key={seed ?? 'blank'} initial={seed ? { question: seed, asOf: new Date().toISOString().slice(0, 10) } : undefined} onSubmit={onAsk} onAttach={onAttach} autoFocus {...attach} />
      </div>
    </div>
  )
}

function Thread({ chatId, detail, loading, error, pending, selection, onSelect, onShare, onAsk, onAttach, busy, attach }: {
  chatId: string; detail?: ChatDetail; loading: boolean; error: boolean; pending: Pending | null; selection: Selection
  onSelect: (s: Selection) => void; onShare: (turn: number) => void; onAsk: (q: string, a: string, m: InputMode, o?: AskOptions) => void
  onAttach: (files: File[]) => void; busy: boolean; attach: AttachState
}) {
  const qc = useQueryClient()
  const scroller = useRef<HTMLDivElement>(null)
  const [switching, setSwitching] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [speaking, setSpeaking] = useState<string | null>(null)
  const [voiceProblem, setVoiceProblem] = useState<{ id: string; text: string } | null>(null)
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

  const [copied, setCopied] = useState<string | null>(null)
  const copy = async (m: Message) => {
    if (!m.answer) return
    if (await copyText(answerText(m.answer))) {
      setCopied(m.id)
      window.setTimeout(() => setCopied((x) => (x === m.id ? null : x)), 2000)
    }
  }

  const listen = (m: Message) => {
    if (!m.answer) return
    if (speaking === m.id) {
      stopSpeaking()
      setSpeaking(null)
      return
    }
    const s = spokenAnswer(m.answer)
    setSpeaking(m.id)
    setVoiceProblem(null)
    speak(s.text, s.lang, (problem) => {
      setSpeaking((x) => (x === m.id ? null : x))
      if (problem) setVoiceProblem({ id: m.id, text: problem })
    })
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

  // Editing or re-running a past question starts a new branch from there, like ChatGPT: the questions and answers
  // after it leave the screen at once. They are kept with the old version (the < 1 of 2 > switcher brings them back).
  const dropAfter = (turn: number) => {
    void qc.cancelQueries({ queryKey: ['chat', chatId] })
    qc.setQueryData<ChatDetail>(['chat', chatId], (d) => (d ? { ...d, turns: d.turns.filter((x) => x.turn <= turn) } : d))
    onSelect(null)
  }
  /** Show another version of a turn together with the follow-ups asked after it. */
  const switchVersion = async (t: Turn, version: number) => {
    setSwitching(true)
    onSelect(null)
    try {
      qc.setQueryData<ChatDetail>(['chat', chatId], await post<ChatDetail>(`/api/chats/${chatId}/turns/${t.turn}/select`, { version }))
    } finally {
      setSwitching(false)
    }
  }
  const resend = (t: Turn, question: string, asOf: string, mode: InputMode, opts?: AskOptions) => {
    setEditing(null)
    dropAfter(t.turn)
    void runAnswer(qc, { chatId, path: `/api/chats/${chatId}/turns/${t.turn}`, method: 'PUT', body: { question, as_of: asOf, input_mode: mode, reply_lang: opts?.replyLang }, turn: t.turn, question, asOf })
  }
  const regenerate = (t: Turn, m: Message) => {
    dropAfter(t.turn)
    void runAnswer(qc, { chatId, path: `/api/chats/${chatId}/turns/${t.turn}/regenerate`, turn: t.turn, question: m.question, asOf: m.as_of })
  }

  // the jump list shows the question of the version on screen (or the one being re-asked)
  const navItems: NavItem[] = turns.map((t) => {
    const v = t.active ?? t.latest
    const m = t.versions.find((x) => x.version === v) ?? t.versions[t.versions.length - 1]
    return { key: String(t.turn), question: pending && pending.turn === t.turn ? pending.question : m.question }
  })
  if (pending && pending.turn === null) navItems.push({ key: 'pending', question: pending.question })

  return (
    <>
      <div className={styles.scrollWrap}>
      <PromptNav items={navItems} scroller={scroller} />
      <div className={styles.scroll} ref={scroller}>
        <div className={styles.turns}>
          {loading && <div className={styles.turnSkel}><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>}
          {error && <p className={styles.loadError}>This chat could not be loaded. It may have been deleted.</p>}
          {turns.map((t) => {
            const version = t.active ?? t.latest
            const m = t.versions.find((v) => v.version === version) ?? t.versions[t.versions.length - 1]
            const live = pending && pending.turn === t.turn ? pending : null
            return (
              <article key={t.turn} className={styles.turn} data-turn={t.turn}>
                <header className={styles.qRow}>
                  {editing === t.turn ? (
                    <div className={styles.editBox}>
                      <Composer compact autoFocus submitLabel={tr('Resend')} initial={{ question: m.question, asOf: m.as_of }} onCancel={() => setEditing(null)} onSubmit={(q, a, mode, o) => resend(t, q, a, mode, o)} />
                    </div>
                  ) : (
                    <>
                      <p className={styles.question}>{live ? live.question : m.question}</p>
                      <div className={styles.qMeta}>
                        {m.input_mode === 'camera' && <span className={styles.badge}><Camera size={12} aria-hidden="true" /> From a photo</span>}
                        {m.input_mode === 'voice' && <span className={styles.badge}><Mic size={12} aria-hidden="true" /> Spoken</span>}
                        {t.versions.length > 1 && !live && (
                          <span className={styles.versions} aria-label={tr('Versions of this question')}>
                            <button type="button" className="btn btn-quiet btn-icon btn-sm" disabled={version <= 1 || switching || busy} onClick={() => void switchVersion(t, version - 1)} aria-label={tr('Previous version')}><ChevronLeft size={14} /></button>
                            <span className="tnum">{version} of {t.versions.length}</span>
                            <button type="button" className="btn btn-quiet btn-icon btn-sm" disabled={version >= t.versions.length || switching || busy} onClick={() => void switchVersion(t, version + 1)} aria-label={tr('Next version')}><ChevronRight size={14} /></button>
                          </span>
                        )}
                        {!live && (
                          <button type="button" className="btn btn-quiet btn-icon btn-sm" onClick={() => setEditing(t.turn)} disabled={busy} aria-label={tr('Edit the question or its date and resend')}>
                            <Pencil size={14} strokeWidth={1.8} />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </header>

                <div className={styles.sheet}>
                  {live ? (
                    live.error ? <StreamError p={live} chatId={chatId} /> : <LiveTrace steps={live.trace} stage={live.stage} info={live.info} startedAt={live.startedAt} />
                  ) : m.status === 'failed' || !m.answer || m.answer.error ? (
                    <FailedAnswer message={(m.answer?.error as string) ?? tr('This answer failed.')} stopped={!!m.answer?.stopped} onRetry={() => regenerate(t, m)} />
                  ) : (
                    <AnswerView answer={m.answer} cropFor={cropFor} onSelect={onSelect} selectedSentence={selectedSentence} fresh={fresh === m.id} />
                  )}
                </div>

                {!live && m.answer && m.status !== 'failed' && !m.answer.error && (
                  <footer className={styles.turnActions}>
                    {canSpeak() && (
                      <button type="button" className="btn btn-quiet btn-sm" onClick={() => listen(m)} aria-pressed={speaking === m.id}>
                        {speaking === m.id ? <Square size={12} strokeWidth={2.4} aria-hidden="true" /> : <Volume2 size={13} strokeWidth={1.8} aria-hidden="true" />}
                        {' '}{tr(speaking === m.id ? 'Stop' : 'Listen')}
                      </button>
                    )}
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => void copy(m)} aria-live="polite">
                      {copied === m.id ? <Check size={13} strokeWidth={2.2} aria-hidden="true" /> : <Copy size={13} strokeWidth={1.8} aria-hidden="true" />}
                      {' '}{tr(copied === m.id ? 'Copied' : 'Copy')}
                    </button>
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => regenerate(t, m)} disabled={busy}>
                      <RefreshCw size={13} strokeWidth={1.8} aria-hidden="true" /> {tr('Run again')}
                    </button>
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => onShare(t.turn)}>
                      <Share2 size={13} strokeWidth={1.8} aria-hidden="true" /> {tr('Share this answer')}
                    </button>
                  </footer>
                )}
                {voiceProblem?.id === m.id && <p className={styles.voiceProblem} role="status">{tr(voiceProblem.text)}</p>}
              </article>
            )
          })}

          {pending && pending.turn === null && (
            <article key="pending" className={`${styles.turn} ${styles.arrive}`} data-turn="pending">
              <header className={styles.qRow}><p className={styles.question}>{pending.question}</p></header>
              <div className={styles.sheet}>
                {pending.error ? <StreamError p={pending} chatId={chatId} /> : <LiveTrace steps={pending.trace} stage={pending.stage} info={pending.info} startedAt={pending.startedAt} />}
              </div>
            </article>
          )}
        </div>
      </div>
      </div>
      <div className={styles.dock}>
        <Composer onSubmit={onAsk} onAttach={onAttach} busy={busy} onStop={() => stopAnswer(qc, chatId)} {...attach} />
      </div>
    </>
  )
}

function StreamError({ p, chatId }: { p: Pending; chatId: string }) {
  return (
    <div className={styles.failed} role="alert">
      <p className={styles.failedHead}><TriangleAlert size={16} strokeWidth={1.8} aria-hidden="true" /> {tr('No answer was produced, so nothing is shown.')}</p>
      <p className={styles.failedBody}>{p.error}</p>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => dismissPending(chatId)}>{tr('Dismiss')}</button>
    </div>
  )
}

function FailedAnswer({ message, onRetry, stopped }: { message: string; onRetry: () => void; stopped?: boolean }) {
  if (stopped)
    return (
      <div className={styles.failed} role="status">
        <p className={styles.failedHead}><Square size={14} strokeWidth={2.2} aria-hidden="true" /> {tr('You stopped this answer before it finished.')}</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}><RefreshCw size={13} aria-hidden="true" /> {tr('Answer it again')}</button>
      </div>
    )
  return (
    <div className={styles.failed} role="alert">
      <p className={styles.failedHead}><TriangleAlert size={16} strokeWidth={1.8} aria-hidden="true" /> {tr('No answer was produced, so nothing is shown.')}</p>
      <p className={styles.failedBody}>{message}</p>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}><RefreshCw size={13} aria-hidden="true" /> {tr('Try again')}</button>
    </div>
  )
}
