import { create } from 'zustand'

export type AuthUser = { id: string; email: string }
type AuthStatus = 'loading' | 'authed' | 'anon'

type AuthState = {
  user: AuthUser | null
  status: AuthStatus
  checkAuth: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json()
    if (typeof body?.detail === 'string') return body.detail
    if (Array.isArray(body?.detail) && body.detail[0]?.msg) return body.detail[0].msg
  } catch {
    // ignore — use fallback
  }
  return fallback
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: 'loading',

  checkAuth: async () => {
    try {
      const res = await fetch('/api/auth/me')
      if (!res.ok) {
        set({ user: null, status: 'anon' })
        return
      }
      const user = await res.json()
      set({ user, status: 'authed' })
    } catch {
      set({ user: null, status: 'anon' })
    }
  },

  login: async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) throw new Error(await readError(res, 'Login failed'))
    const user = await res.json()
    set({ user, status: 'authed' })
  },

  register: async (email, password) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) throw new Error(await readError(res, 'Registration failed'))
    const user = await res.json()
    set({ user, status: 'authed' })
  },

  logout: async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    set({ user: null, status: 'anon' })
  },
}))
