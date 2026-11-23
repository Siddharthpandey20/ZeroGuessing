import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ScanSearch, X } from 'lucide-react'
import { api, cropUrl, del, post } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Conflict } from '../lib/types'
import { ConflictCard } from './answer/AnswerView'
import { fmtDateTime } from './answer/selection'
import styles from './Alerts.module.css'
import { tr } from '../lib/i18n'

/** Conflicts found across the library without anyone asking: both quotes, both pages, side by side. */
export default function Alerts() {
  const { isAdmin } = useAuth()
  const qc = useQueryClient()
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: () => api<Conflict[]>('/api/alerts') })
  const scan = useMutation({
    mutationFn: () => post('/api/alerts/scan'),
    onSuccess: () => window.setTimeout(() => qc.invalidateQueries({ queryKey: ['alerts'] }), 3000),
  })
  const dismiss = useMutation({
    mutationFn: (id: string) => del(`/api/alerts/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['alerts'] })
      const prev = qc.getQueryData<Conflict[]>(['alerts'])
      qc.setQueryData<Conflict[]>(['alerts'], (old) => old?.filter((a) => a.id !== id))
      return { prev }
    },
    onError: (_e, _id, ctx) => ctx?.prev && qc.setQueryData(['alerts'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  })

  const n = alerts.data?.length ?? 0

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.h1}>{tr('Alerts')}</h1>
          <p className={styles.sub}>
            {alerts.isLoading ? tr('Loading') : n ? `${tr(n === 1 ? '{n} conflict between clauses on the same subject.' : '{n} conflicts between clauses on the same subject.', { n })} ${tr('Amendments that lawfully replace a clause are not listed here.')}` : tr('No conflicts between the documents in use.')}
          </p>
        </div>
        {isAdmin && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => scan.mutate()} disabled={scan.isPending}>
            <ScanSearch size={15} strokeWidth={1.8} aria-hidden="true" /> {tr(scan.isSuccess ? 'Scanning the library' : 'Scan again')}
          </button>
        )}
      </header>

      {alerts.isError && <p className={styles.error} role="alert">{tr('Alerts could not be loaded. Try again in a moment.')}</p>}

      <div className={styles.grid}>
        {alerts.isLoading && [0, 1].map((i) => <span key={i} className={`skeleton ${styles.skel}`} />)}
        {alerts.data?.map((x) => (
          <article key={x.id} className={styles.item}>
            <div className={styles.itemTop}>
              <span className={styles.found}>{tr(x.source === 'query' ? 'Found while answering' : 'Found by the library scan')}, {fmtDateTime(x.created_at)}</span>
              {isAdmin && (
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => dismiss.mutate(x.id)} aria-label={tr('Dismiss this alert')}>
                  <X size={14} aria-hidden="true" /> {tr('Dismiss')}
                </button>
              )}
            </div>
            <ConflictCard x={x} cropFor={cropUrl} large />
          </article>
        ))}
      </div>

      {!alerts.isLoading && !n && !alerts.isError && (
        <div className={styles.empty}>
          <p className={styles.emptyHead}>{tr('Nothing disagrees.')}</p>
          <p>{tr('When two clauses state different numbers, dates, rules or eligibility for the same subject, they appear here with both quotes.')}</p>
        </div>
      )}
    </div>
  )
}
