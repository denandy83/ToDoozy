import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { SharedTask, SharedProject, SharedStatus } from '../types'

interface TasksState {
  projects: SharedProject[]
  tasks: SharedTask[]
  statuses: SharedStatus[]
  loading: boolean
  error: string | null
}

export function useTasks(selectedProjectId: string | null) {
  const [state, setState] = useState<TasksState>({
    projects: [],
    tasks: [],
    statuses: [],
    loading: true,
    error: null
  })

  // Load projects the user is a member of
  const loadProjects = useCallback(async () => {
    const { data, error } = await supabase
      .from('shared_projects')
      .select('*')
      .order('name')

    if (error) {
      setState(prev => ({ ...prev, error: error.message, loading: false }))
      return
    }
    setState(prev => ({ ...prev, projects: data ?? [], loading: false }))
  }, [])

  // Load tasks and statuses for the selected project
  const loadProjectData = useCallback(async (projectId: string) => {
    setState(prev => ({ ...prev, loading: true }))

    const [tasksResult, statusesResult] = await Promise.all([
      supabase
        .from('shared_tasks')
        .select('*')
        .eq('project_id', projectId)
        .eq('is_template', 0)
        .eq('is_archived', 0)
        .order('order_index'),
      supabase
        .from('shared_statuses')
        .select('*')
        .eq('project_id', projectId)
        .order('order_index')
    ])

    if (tasksResult.error || statusesResult.error) {
      setState(prev => ({
        ...prev,
        error: tasksResult.error?.message ?? statusesResult.error?.message ?? 'Failed to load',
        loading: false
      }))
      return
    }

    setState(prev => ({
      ...prev,
      tasks: tasksResult.data ?? [],
      statuses: statusesResult.data ?? [],
      loading: false,
      error: null
    }))
  }, [])

  // Load projects on mount
  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  // Load tasks when project changes
  useEffect(() => {
    if (selectedProjectId) {
      loadProjectData(selectedProjectId)
    }
  }, [selectedProjectId, loadProjectData])

  const refresh = useCallback(() => {
    loadProjects()
    if (selectedProjectId) {
      loadProjectData(selectedProjectId)
    }
  }, [loadProjects, loadProjectData, selectedProjectId])

  return { ...state, refresh }
}
