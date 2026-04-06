import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './hooks/useAuth'
import { useTasks } from './hooks/useTasks'
import { signalReady, isTelegramContext, getTelegramWebApp } from './lib/telegram'
import { LoginScreen } from './components/LoginScreen'
import { ProjectSelector } from './components/ProjectSelector'
import { TaskList } from './components/TaskList'
import { TaskDetail } from './components/TaskDetail'
import { LoadingSpinner } from './components/LoadingSpinner'
import type { SharedTask } from './types'

export function App() {
  const auth = useAuth()
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<SharedTask | null>(null)
  const { projects, tasks, statuses, loading: tasksLoading, refresh } = useTasks(selectedProjectId)

  // Signal Telegram that the app is ready
  useEffect(() => {
    signalReady()
  }, [])

  // Try Telegram auth on mount
  useEffect(() => {
    if (isTelegramContext() && !auth.isAuthenticated && !auth.loading) {
      auth.loginViaTelegram()
    }
  }, [auth.isAuthenticated, auth.loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select first project
  useEffect(() => {
    if (projects.length > 0 && !selectedProjectId) {
      setSelectedProjectId(projects[0].id)
    }
  }, [projects, selectedProjectId])

  // Handle back from task detail
  const handleBack = useCallback(() => {
    setSelectedTask(null)
  }, [])

  // Pull-to-refresh via Telegram MainButton
  useEffect(() => {
    const wa = getTelegramWebApp()
    if (!wa || !auth.isAuthenticated) return
    // No main button needed for now
  }, [auth.isAuthenticated])

  // Show loading
  if (auth.loading) {
    return <LoadingSpinner text="Loading..." />
  }

  // Show login if not authenticated
  if (!auth.isAuthenticated) {
    return (
      <LoginScreen
        onLogin={auth.loginWithEmail}
        loading={auth.loading}
        error={auth.error}
      />
    )
  }

  // Task detail view
  if (selectedTask) {
    const taskStatus = statuses.find(s => s.id === selectedTask.status_id)
    const subtasks = tasks.filter(t => t.parent_id === selectedTask.id)
    return (
      <TaskDetail
        task={selectedTask}
        status={taskStatus}
        subtasks={subtasks}
        statuses={statuses}
        onBack={handleBack}
      />
    )
  }

  // Main task list view
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--tg-theme-bg-color)' }}>
      {/* Header */}
      <div className="px-4 pt-4 pb-1 flex items-center justify-between">
        <h1 className="text-xl font-light tracking-[0.1em] uppercase">
          Tasks
        </h1>
        <button
          onClick={refresh}
          className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded"
          style={{
            color: 'var(--tg-theme-link-color)',
            backgroundColor: 'var(--tg-theme-secondary-bg-color)'
          }}
        >
          Refresh
        </button>
      </div>

      {/* Project selector */}
      <ProjectSelector
        projects={projects}
        selectedId={selectedProjectId}
        onSelect={setSelectedProjectId}
      />

      {/* Task list */}
      {tasksLoading ? (
        <LoadingSpinner text="Loading tasks..." />
      ) : (
        <TaskList
          tasks={tasks}
          statuses={statuses}
          onSelectTask={setSelectedTask}
        />
      )}
    </div>
  )
}
