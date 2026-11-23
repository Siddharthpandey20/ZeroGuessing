import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import { ApiError, post } from '../lib/api'
import styles from './ShareDialog.module.css'
import { tr } from '../lib/i18n'

/** A frozen, read-only snapshot behind an unguessable link (backend shares API), plus a self-contained HTML export. */
export function ShareDialog({ chatId, turn, onClose }: { chatId: string; turn?: number; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [days, setDays] = useState(7)
  const [crops, setCrops] = useState(true)
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // No close() in a cleanup: under StrictMode the effect runs mount, cleanup, mount, and that close() fired the
  // dialog's close event, whose onClose unmounted the dialog the moment it opened (Share looked dead).
  // An unmounted <dialog> leaves the top layer by itself.
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])

  // VITE_PUBLIC_ORIGIN: the address other people can reach (deployed domain or a tunnel); else wherever this app runs
  const origin = (import.meta.env.VITE_PUBLIC_ORIGIN as string | undefined)?.replace(/\/+$/, '') || window.location.origin
  const link = token ? `${origin}/s/${token}` : ''
  const localOnly = /^https?:\/\/(localhost|127\.|\[::1\])/.test(origin)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      // the clipboard API needs https or localhost; fall back to selecting the text for Ctrl+C
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Share link"]')
      input?.select()
      document.execCommand?.('copy')
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }
  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await post<{ token: string }>(`/api/chats/${chatId}/shares`, { turn: turn ?? null, expires_days: days, include_crops: crops })
      setToken(r.token)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tr('The link could not be created.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} className={styles.dialog} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-labelledby="share-title">
      <div className={styles.body}>
        <h2 id="share-title" className={styles.title}>{tr(turn ? 'Share this answer' : 'Share this chat')}</h2>
        <p className={styles.lead}>{tr('The link opens a frozen copy: the answers, their verdicts and their quotes exactly as shown now.')}</p>

        {!token ? (
          <>
            <fieldset className={styles.group}>
              <legend>{tr('Link expires after')}</legend>
              <div className={styles.seg}>
                {[1, 7, 30].map((d) => (
                  <label key={d} data-on={days === d || undefined}>
                    <input type="radio" name="days" value={d} checked={days === d} onChange={() => setDays(d)} />
                    {tr(d === 1 ? '{n} day' : '{n} days', { n: d })}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className={styles.check}>
              <input type="checkbox" checked={crops} onChange={(e) => setCrops(e.target.checked)} />
              <span>{tr('Include page images of the cited passages')}</span>
            </label>
            <p className={styles.warn}>{tr(crops ? 'Anyone with the link can read the quoted passages and page images.' : 'Anyone with the link can read the quoted passages.')}</p>
            {error && <p className={styles.error} role="alert">{error}</p>}
            <div className={styles.actions}>
              <button type="button" className="btn btn-quiet" onClick={onClose}>{tr('Cancel')}</button>
              <button type="button" className="btn btn-primary" onClick={create} disabled={busy}>{tr(busy ? 'Creating' : 'Create link')}</button>
            </div>
          </>
        ) : (
          <>
            <div className={styles.linkRow}>
              <input className="input" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Share link" />
              <button type="button" className="btn btn-ink" onClick={copy}>
                {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />} {tr(copied ? 'Copied' : 'Copy')}
              </button>
            </div>
            <p className={styles.warn}>
              {tr('Anyone with this link can open it without signing in, until it expires.')}
              {localOnly && ' This address only works on this computer: set VITE_PUBLIC_ORIGIN to your deployed or tunnelled address to share it with others.'}
            </p>
            <div className={styles.actions}>
              <a className="btn btn-ghost" href={`/public/shares/${token}/html`} target="_blank" rel="noreferrer">
                <Download size={15} aria-hidden="true" /> {tr('Offline HTML copy')}
              </a>
              <button type="button" className="btn btn-primary" onClick={onClose}>{tr('Done')}</button>
            </div>
          </>
        )}
      </div>
    </dialog>
  )
}
