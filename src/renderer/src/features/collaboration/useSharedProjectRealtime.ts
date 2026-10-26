import { useState, useCallback, useEffect } from 'react'
import {
  subscribeToProject,
  setRealtimeCallback,
  getSharedProjectMembers,
  unsubscribeFromProject
} from '../../services/SyncService'
import { invalidateMemberDisplay } from '../../shared/hooks/useMemberDisplay'
import { useTaskStore } from '../../shared/stores'
import { isPlaceholderEmail } from '../../../../shared/placeholderUser'
import type { Project, User } from '../../../../shared/types'

export interface SharedProjectMember {
  user_id: string
  email: string
  display_name: string | null
  role: string
}

export interface RemovedFromProject {
  id: string
  name: string
}

interface UseSharedProjectRealtimeResult {
  projectMembers: SharedProjectMember[]
  removedFromProject: RemovedFromProject | null
  setRemovedFromProject: React.Dispatch<React.SetStateAction<RemovedFromProject | null>>
}

/**
 * Owns the shared-project Realtime lifecycle for the active project:
 * subscribes to the project channel, loads its members, and reconciles the
 * per-field Realtime payloads (member/task/status/activity/project_label)
 * into the local database + Zustand stores. Extracted verbatim from AppLayout
 * (Story #107) — the effect dependency array and every field cast are preserved
 * exactly, so behavior is unchanged.
 */
export function useSharedProjectRealtime(
  selectedProject: Project | null,
  currentUser: User | null
): UseSharedProjectRealtimeResult {
  const [projectMembers, setProjectMembers] = useState<SharedProjectMember[]>([])
  const [removedFromProject, setRemovedFromProject] = useState<RemovedFromProject | null>(null)

  // Load shared project members when project changes
  const loadMembers = useCallback(async (projectId: string) => {
    setProjectMembers([])
    try {
      const members = await getSharedProjectMembers(projectId)
      setProjectMembers(members.map((m) => ({
        user_id: m.user_id,
        email: m.email,
        display_name: m.display_name,
        role: m.role
      })))
      // Upsert local users rows so useMemberDisplay can render real names/emails
      // instead of falling back to 'unknown'. Without this, a new member who
      // joins the owner's project never appears in the local users table and
      // the avatar tooltip shows 'unknown'.
      for (const m of members) {
        const localUser = await window.api.users.findById(m.user_id)
        if (!localUser) {
          await window.api.users.create({
            id: m.user_id,
            email: m.email,
            display_name: m.display_name,
            avatar_url: null
          }).catch(() => { /* already exists */ })
        } else if (isPlaceholderEmail(localUser.email) && m.email && !isPlaceholderEmail(m.email)) {
          await window.api.users.update(m.user_id, {
            email: m.email,
            display_name: m.display_name
          }).catch(() => {})
        }
      }
      // Sync display customizations to local DB so avatars render correctly
      for (const m of members) {
        await window.api.projects.updateMember(projectId, m.user_id, {
          display_color: m.display_color ?? null,
          display_initials: m.display_initials ?? null
        }).catch(() => {})
      }
      // Always invalidate avatar cache after syncing member data
      invalidateMemberDisplay(projectId)
    } catch {
      // Fallback to local members
      const rawMembers = await window.api.projects.getMembers(projectId)
      const enriched = await Promise.all(
        rawMembers.map(async (m) => {
          const user = await window.api.users.findById(m.user_id)
          return {
            user_id: m.user_id,
            email: user?.email ?? 'unknown',
            display_name: user?.display_name ?? null,
            role: m.role
          }
        })
      )
      setProjectMembers(enriched)
    }
  }, [])

  useEffect(() => {
    if (selectedProject?.is_shared === 1) {
      loadMembers(selectedProject.id)
      subscribeToProject(selectedProject.id)
      let removedFlag = false
      setRealtimeCallback(async (table: string, event: string, payload: Record<string, unknown>) => {
        const userId = currentUser?.id
        if (!userId || !selectedProject || removedFlag) return

        if (table === 'member') {
          // project_id guard: every shared channel funnels into this one
          // callback, so a removal from a NON-active shared project must not
          // tear down the active one. Non-active removals are handled by the
          // per-user channel (UserChannelService).
          if (event === 'DELETE' && payload?.user_id === userId && payload?.project_id === selectedProject.id) {
            // Set flag immediately to block all subsequent events in this batch
            removedFlag = true
            unsubscribeFromProject(selectedProject.id)
            setRemovedFromProject({ id: selectedProject.id, name: selectedProject.name })
            return
          } else {
            await loadMembers(selectedProject.id)
          }
        }

        // Task/status rows are applied once by remoteProjectRefresh for every
        // subscribed project. Never run local CRUD (which stamps NOW) on remote rows.
        if (table === 'activity' && event === 'INSERT') {
          // Persist remote members' activity entries locally (idempotent by
          // id) and refresh the Detail panel if it's showing this task.
          const taskId = payload?.task_id as string | undefined
          const rowId = payload?.id as string | undefined
          if (rowId && taskId) {
            await window.api.activityLog
              .applyRemote({
                id: rowId,
                task_id: taskId,
                user_id: (payload.user_id as string) ?? '',
                action: (payload.action as string) ?? '',
                old_value: (payload.old_value as string | null) ?? null,
                new_value: (payload.new_value as string | null) ?? null,
                created_at: (payload.created_at as string) ?? new Date().toISOString()
              })
              .then((res) => {
                if (res === 'applied') useTaskStore.getState().bumpActivityRefresh(taskId)
              })
              .catch(() => {})
          }
        }


      })
    } else {
      setProjectMembers([])
    }

    return undefined
    // currentUser is intentionally excluded from the dependency array: the
    // callback captures it at subscribe time, matching the original AppLayout
    // effect exactly. Re-subscribing on every auth-state change is not wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject?.id, selectedProject?.is_shared, loadMembers])

  return { projectMembers, removedFromProject, setRemovedFromProject }
}
