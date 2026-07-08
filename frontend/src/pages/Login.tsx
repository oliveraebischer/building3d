import { useState, FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

export default function Login() {
  const login = useAuthStore((s) => s.login)
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
      navigate('/app')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full h-full min-h-screen bg-[#0d0d0d] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Link to="/" className="block text-center mb-8 text-lg font-semibold text-white/90">
          Building<span className="text-accent">3D</span>
        </Link>

        <div className="bg-[#161616] border border-white/[0.07] rounded-xl p-8">
          <h1 className="text-base font-semibold text-white/90 mb-6">Log in</h1>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] text-white/40 mb-1.5">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-3 py-2
                           text-sm text-white/90 outline-none focus:border-accent/40 transition-colors"
                autoComplete="email"
              />
            </div>
            <div>
              <label className="block text-[11px] text-white/40 mb-1.5">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-md px-3 py-2
                           text-sm text-white/90 outline-none focus:border-accent/40 transition-colors"
                autoComplete="current-password"
              />
            </div>

            {error && <p className="text-[12px] text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-accent text-black font-medium text-sm rounded-md py-2
                         disabled:opacity-50 transition-opacity"
            >
              {submitting ? 'Logging in…' : 'Log in'}
            </button>
          </form>

          <p className="text-[12px] text-white/40 mt-6 text-center">
            No account?{' '}
            <Link to="/register" className="text-accent hover:underline">
              Register
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
