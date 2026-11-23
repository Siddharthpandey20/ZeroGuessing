import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { LogOut } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { LangSwitch } from '../components/LangSwitch'
import { useT } from '../lib/i18n'
import type { Conflict } from '../lib/types'
import { RouteFallback } from '../components/RouteFallback'
import styles from './Workspace.module.css'

export default function Workspace() {
  const { user, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <RouteFallback />
  if (!user) return <Navigate to={`/sign-in?next=${encodeURIComponent(loc.pathname)}`} replace />
  return (
    <div className={styles.shell}>
      <TopBar />
      <div className={styles.body}>
        <Outlet />
      </div>
    </div>
  )
}

function TopBar() {
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: () => api<Conflict[]>('/api/alerts') })
  const { pathname } = useLocation()
  const askOn = !/^\/app\/(library|alerts)/.test(pathname)
  const t = useT()

  return (
    <header className={styles.top}>
      <Link to="/" className={`${styles.brand} wordmark`} aria-label="ZeroGuess home">zeroguess</Link>
      <nav className={styles.tabs} aria-label={t('Workspace')}>
        <Link to="/app" className={tabClass(askOn)} aria-current={askOn ? 'page' : undefined}>
          {t('Ask')}
        </Link>
        <NavLink to="/app/alerts" className={({ isActive }) => tabClass(isActive)}>
          {t('Alerts')}
          {!!alerts.data?.length && <span className={`${styles.count} ${styles.countWarn} tnum`}>{alerts.data.length}</span>}
        </NavLink>
      </nav>
      <div className={styles.end}>
        <LangSwitch />
        <UserMenu />
      </div>
    </header>
  )
}

const tabClass = (on: boolean) => `${styles.tab}${on ? ` ${styles.tabOn}` : ''}`

function UserMenu() {
  const { user, signOut } = useAuth()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', off)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  if (!user) return null
  const initials = (user.name || user.email).split(/[\s@.]/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('')
  return (
    <div className={styles.user} ref={ref}>
      <button type="button" className={styles.avatarBtn} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {user.picture ? <img src={user.picture} alt="" className={styles.avatar} referrerPolicy="no-referrer" /> : <span className={styles.avatar}>{initials}</span>}
        <span className={styles.userName}>{user.name || user.email}</span>
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          <div className={styles.menuHead}>
            <span>{user.email}</span>
            <span className={styles.role}>{t(user.role === 'admin' ? 'Admin: can upload and confirm' : 'Viewer: can ask and share')}</span>
          </div>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={async () => {
              await signOut()
              nav('/', { replace: true })
            }}
          >
            <LogOut size={15} strokeWidth={1.8} aria-hidden="true" /> {t('Sign out')}
          </button>
        </div>
      )}
    </div>
  )
}
