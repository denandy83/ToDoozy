import { useState, type FormEvent } from 'react'

interface LoginScreenProps {
  onLogin: (email: string, password: string) => Promise<void>
  loading: boolean
  error: string | null
}

export function LoginScreen({ onLogin, loading, error }: LoginScreenProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (email && password) {
      onLogin(email, password)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      {/* Logo / Title */}
      <div className="text-center mb-8">
        <h1
          className="text-3xl font-light tracking-[0.15em] uppercase"
          style={{ color: 'var(--tg-theme-text-color)' }}
        >
          ToDoozy
        </h1>
        <p
          className="text-xs font-light mt-2"
          style={{ color: 'var(--tg-theme-hint-color)' }}
        >
          Sign in with your ToDoozy account
        </p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-xs space-y-4">
        <div>
          <label
            className="text-[10px] font-bold uppercase tracking-[0.3em] block mb-1.5"
            style={{ color: 'var(--tg-theme-hint-color)' }}
          >
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="w-full px-3 py-2.5 rounded-lg text-sm font-light outline-none"
            style={{
              backgroundColor: 'var(--tg-theme-secondary-bg-color)',
              color: 'var(--tg-theme-text-color)',
              border: '1px solid transparent'
            }}
          />
        </div>

        <div>
          <label
            className="text-[10px] font-bold uppercase tracking-[0.3em] block mb-1.5"
            style={{ color: 'var(--tg-theme-hint-color)' }}
          >
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Your password"
            required
            className="w-full px-3 py-2.5 rounded-lg text-sm font-light outline-none"
            style={{
              backgroundColor: 'var(--tg-theme-secondary-bg-color)',
              color: 'var(--tg-theme-text-color)',
              border: '1px solid transparent'
            }}
          />
        </div>

        {error && (
          <p className="text-xs text-center" style={{ color: '#ef4444' }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !email || !password}
          className="w-full py-2.5 rounded-lg text-[11px] font-bold uppercase tracking-widest disabled:opacity-50"
          style={{
            backgroundColor: 'var(--tg-theme-button-color)',
            color: 'var(--tg-theme-button-text-color)'
          }}
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      <p
        className="text-[10px] font-light mt-6 text-center px-4"
        style={{ color: 'var(--tg-theme-hint-color)' }}
      >
        After signing in, your Telegram account will be linked automatically for future visits.
      </p>
    </div>
  )
}
