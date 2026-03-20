import { useState, useCallback, type FormEvent, type KeyboardEvent } from 'react'
import { useAuthStore } from '../../shared/stores/authStore'

type AuthMode = 'login' | 'signup'

export function LoginScreen(): React.JSX.Element {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const { loading, error, clearError, signInWithEmail, signUpWithEmail, signInWithGoogle } =
    useAuthStore()

  const handleSubmit = useCallback(
    async (e: FormEvent): Promise<void> => {
      e.preventDefault()
      if (!email.trim() || !password.trim()) return

      if (mode === 'login') {
        await signInWithEmail(email.trim(), password)
      } else {
        await signUpWithEmail(email.trim(), password)
      }
    },
    [email, password, mode, signInWithEmail, signUpWithEmail]
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent): void => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const form = (e.target as HTMLElement).closest('form')
        if (form) form.requestSubmit()
      }
      if (e.key === 'Escape') {
        clearError()
      }
    },
    [clearError]
  )

  const toggleMode = useCallback((): void => {
    setMode((m) => (m === 'login' ? 'signup' : 'login'))
    clearError()
  }, [clearError])

  const handleGoogleSignIn = useCallback(async (): Promise<void> => {
    await signInWithGoogle()
  }, [signInWithGoogle])

  const isFormValid = email.trim().length > 0 && password.trim().length >= 8

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="flex w-full max-w-sm flex-col items-center gap-8 px-6">
        {/* Logo and title */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/15">
            <span className="text-2xl font-bold tracking-tight text-accent">TD</span>
          </div>
          <h1 className="text-3xl font-light tracking-[0.15em] uppercase text-foreground">
            ToDoozy
          </h1>
          <p className="text-sm font-light text-muted">
            {mode === 'login' ? 'Sign in to continue' : 'Create your account'}
          </p>
        </div>

        {/* Auth form */}
        <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="flex w-full flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="email"
              className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus
              disabled={loading}
              className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm font-light text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none disabled:opacity-50"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="password"
              className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'Minimum 8 characters' : 'Your password'}
              disabled={loading}
              className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm font-light text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none disabled:opacity-50"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-[11px] font-light text-danger">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !isFormValid}
            className="mt-1 rounded-lg bg-accent px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-accent-fg transition-colors hover:bg-accent/80 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-40"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <LoadingSpinner />
                {mode === 'login' ? 'Signing in...' : 'Creating account...'}
              </span>
            ) : mode === 'login' ? (
              'Sign In'
            ) : (
              'Create Account'
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="flex w-full items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[9px] font-bold uppercase tracking-wider text-muted">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* Google OAuth */}
        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-border bg-surface px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-foreground transition-colors hover:bg-foreground/6 focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-40"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        {/* Toggle login/signup */}
        <p className="text-sm font-light text-muted">
          {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button
            onClick={toggleMode}
            disabled={loading}
            className="font-medium text-accent hover:underline focus:outline-none disabled:opacity-50"
          >
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  )
}

function LoadingSpinner(): React.JSX.Element {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}

function GoogleIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}
