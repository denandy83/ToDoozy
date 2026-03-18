import { useEffect } from 'react'
import { useAuthStore } from './shared/stores/authStore'
import { LoginScreen } from './features/auth/LoginScreen'

function App(): React.JSX.Element {
  const { isAuthenticated, loading, initAuth } = useAuthStore()

  useEffect(() => {
    initAuth()
  }, [initAuth])

  if (loading) {
    return <SplashScreen />
  }

  if (!isAuthenticated) {
    return <LoginScreen />
  }

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
      <h1 className="text-3xl font-light tracking-[0.15em] uppercase">ToDoozy</h1>
    </div>
  )
}

function SplashScreen(): React.JSX.Element {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/15">
        <span className="text-2xl font-bold tracking-tight text-accent">TD</span>
      </div>
      <div className="h-1 w-16 overflow-hidden rounded-full bg-border">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
      </div>
    </div>
  )
}

export default App
