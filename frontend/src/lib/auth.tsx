import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, onAuthLost, post, refreshSession } from './api'
import type { User } from './types'

interface AuthState {
  user: User | null
  loading: boolean
  isAdmin: boolean
  setUser: (u: User | null) => void
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

async function loadMe(): Promise<User | null> {
  try {
    return await api<User>('/api/auth/me')
  } catch {
    // no access cookie yet (or it expired): one silent refresh before calling it signed out
    if (await refreshSession()) {
      try {
        return await api<User>('/api/auth/me')
      } catch {
        return null
      }
    }
    return null
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: loadMe, staleTime: Infinity, retry: false })
  const [lost, setLost] = useState(false)

  useEffect(() => {
    const off = onAuthLost(() => setLost(true))
    return () => {
      off()
    }
  }, [])

  // The access cookie lives 30 minutes; refresh before it lapses so page images never 401 mid-read.
  useEffect(() => {
    if (!me.data) return
    const id = window.setInterval(() => void refreshSession(), 20 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [me.data])

  const setUser = useCallback(
    (u: User | null) => {
      setLost(false)
      qc.setQueryData(['me'], u)
    },
    [qc],
  )

  const signOut = useCallback(async () => {
    try {
      await post('/api/auth/logout')
    } finally {
      qc.clear()
      qc.setQueryData(['me'], null)
    }
  }, [qc])

  const value = useMemo<AuthState>(() => {
    const user = lost ? null : (me.data ?? null)
    return { user, loading: me.isLoading, isAdmin: user?.role === 'admin', setUser, signOut }
  }, [me.data, me.isLoading, lost, setUser, signOut])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
