import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { EyeOff, FileText, LoaderCircle, Plus, ShieldQuestion, Sparkles, TriangleAlert, Upload, X } from 'lucide-react'
import type { ChatDoc } from '../lib/types'
import styles from './ChatDocs.module.css'
import { tr } from '../lib/i18n'

export const isReady = (d: ChatDoc) => d.ingest_status.startsWith('indexed')
const isWorking = (d: ChatDoc) => !isReady(d) && d.ingest_status !== 'failed'

const STATUS: Record<string, string> = { queued: 'Waiting to be read', parsing: 'Reading the PDF', embedding: 'Indexing', failed: 'Could not be read' }

/**
 * The documents this chat answers from, in a sidebar that slides over the conversation.
 * Escape or the scrim closes it; focus moves into it on open and back to the toggle on close.
 */
export function ChatDocs({ open, onClose, docs, loading, uploading, notes, onUpload, onDemo, onRemove, returnFocus }: {
  open: boolean
  onClose: () => void
  docs: ChatDoc[]
  loading: boolean
  uploading: boolean
  notes: string[]
  onUpload: (files: File[]) => void
  onDemo: () => void
  onRemove: (id: string) => void
  returnFocus?: React.RefObject<HTMLElement | null>
}) {
  const panel = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const back = returnFocus?.current
    return () => {
      window.removeEventListener('keydown', onKey)
      back?.focus()
    }
  }, [open, onClose, returnFocus])

  const working = docs.filter(isWorking).length
  return (
    <>
      <div className={styles.scrim} data-open={open || undefined} onClick={onClose} aria-hidden="true" />
      <div ref={panel} className={styles.panel} data-open={open || undefined} role="dialog" aria-modal="false" aria-labelledby="chat-docs-head" tabIndex={-1} inert={!open}>
        <div className={styles.head}>
          <div>
            <h2 id="chat-docs-head" className={styles.title}>{tr('Documents in this chat')}</h2>
            <p className={styles.sub}>
              {docs.length === 0 ? tr('Answers come only from PDFs you add here.') : `${tr(docs.length === 1 ? '{n} document' : '{n} documents', { n: docs.length })}${working ? tr(', {n} still being read', { n: working }) : ''}. ${tr('Answers come only from these.')}`}
            </p>
          </div>
          <button type="button" className="btn btn-quiet btn-icon btn-sm" onClick={onClose} aria-label={tr('Close documents')}>
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        <div className={styles.body}>
          <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              if (files.length) onUpload(files)
              e.target.value = ''
            }} />
          <button type="button" className={styles.drop} onClick={() => input.current?.click()} disabled={uploading}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const files = Array.from(e.dataTransfer.files).filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
              if (files.length) onUpload(files)
            }}>
            {uploading ? <LoaderCircle size={18} className={styles.spin} aria-hidden="true" /> : <Upload size={18} strokeWidth={1.8} aria-hidden="true" />}
            <span className={styles.dropMain}>{tr(uploading ? 'Uploading' : 'Upload PDFs')}</span>
            <span className={styles.dropSub}>{tr('or drop them here. Up to 5 PDFs (30 MB in all), 100 pages each.')}</span>
          </button>

          {notes.length > 0 && (
            <ul className={styles.notes} role="status">
              {notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}

          {loading ? (
            <div className={styles.list}>{[0, 1].map((i) => <span key={i} className={`skeleton ${styles.skel}`} />)}</div>
          ) : docs.length > 0 ? (
            <ul className={styles.list}>
              {docs.map((d) => (
                <li key={d.id} className={styles.doc} data-state={isReady(d) ? 'ready' : d.ingest_status === 'failed' ? 'failed' : 'working'}>
                  <span className={styles.icon} aria-hidden="true">
                    {isWorking(d) ? <LoaderCircle size={16} className={styles.spin} /> : d.ingest_status === 'failed' ? <TriangleAlert size={16} strokeWidth={1.8} /> : <FileText size={16} strokeWidth={1.8} />}
                  </span>
                  <span className={styles.docText}>
                    <span className={styles.docTitle} title={d.filename}>{d.title}</span>
                    <span className={styles.docMeta}>
                      {isReady(d) ? tr(d.page_count === 1 ? '{n} page, ready' : '{n} pages, ready', { n: d.page_count }) : d.ingest_status === 'failed' ? (d.ingest_error || tr(STATUS.failed)) : tr(STATUS[d.ingest_status] ?? 'Reading the PDF')}
                    </span>
                    <DocNotes d={d} />
                  </span>
                  <button type="button" className={`btn btn-quiet btn-icon btn-sm ${styles.remove}`} onClick={() => onRemove(d.id)} aria-label={tr('Remove {title} from this chat', { title: d.title })} title={tr('Remove from this chat')}>
                    <X size={14} strokeWidth={1.8} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles.empty}>
              <p>{tr('No documents yet. Upload your own, or try the demo set: a bank’s loan policy, two amending circulars, a key facts statement, a vendor agreement and an insurance policy.')}</p>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onDemo} disabled={uploading}>
                <Sparkles size={14} strokeWidth={1.8} aria-hidden="true" /> {tr('Add the demo documents')}
              </button>
            </div>
          )}

          {docs.length > 0 && (
            <button type="button" className={`btn btn-quiet btn-sm ${styles.more}`} onClick={() => input.current?.click()} disabled={uploading}>
              <Plus size={14} strokeWidth={2} aria-hidden="true" /> {tr('Add more')}
            </button>
          )}
        </div>
      </div>
    </>
  )
}

/** What was left out when the PDF was read, and changes it makes that wait for the user's confirmation. */
function DocNotes({ d }: { d: ChatDoc }) {
  const hidden = d.hidden_text_ignored ?? 0
  const odd = d.suspicious_text_ignored ?? 0
  const pending = d.n_amendments_proposed ?? 0
  if (!hidden && !odd && !pending) return null
  return (
    <>
      {(hidden > 0 || odd > 0) && (
        <span className={styles.docWarn}>
          <EyeOff size={12} strokeWidth={2} aria-hidden="true" />
          {[
            hidden > 0 ? tr(hidden === 1 ? '{n} hidden passage ignored' : '{n} hidden passages ignored', { n: hidden }) : '',
            odd > 0 ? tr(odd === 1 ? '{n} instruction-like sentence ignored' : '{n} instruction-like sentences ignored', { n: odd }) : '',
          ].filter(Boolean).join(', ')}
        </span>
      )}
      {pending > 0 && (
        <Link className={styles.docWarn} to={`/app/library/${d.id}`}>
          <ShieldQuestion size={12} strokeWidth={2} aria-hidden="true" />
          {tr(pending === 1 ? '{n} change needs your confirmation' : '{n} changes need your confirmation', { n: pending })}
        </Link>
      )}
    </>
  )
}
