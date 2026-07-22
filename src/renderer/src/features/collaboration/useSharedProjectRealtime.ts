import { useState, useCallback, useEffect } from 'react'
import {
  subscribeToProject,
  setRealtimeCallback,
  getSharedProjectMembers,
  unsubscribeFromProject
} from '../../services/SyncService'
import { invalidateMemberDisplay } from '../../shared/hooks/useMemberDisplay'
import { useTaskStore, useStatusStore } from '../../shared/stores'
import { useLabelStore } from '../../shared/stores/labelStore'
import { placeholderEmail, isPlaceholderEmail } from '../../../../shared/placeholderUser'
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

        if (table === 'task') {
          if (event === 'DELETE' && payload?.id) {
            // Hard-delete fallback (e.g. 30-day purge job removed the row).
            // Soft-deletes arrive as UPDATE with deleted_at set — handled below.
            await window.api.tasks.hardDelete(payload.id as string).catch(() => {})
          } else if ((event === 'INSERT' || event === 'UPDATE') && payload?.id) {
            // Soft-delete propagation: an UPDATE with deleted_at !== null is a
            // tombstone. Use applyRemote so the local row preserves the remote
            // deleted_at + updated_at (no NOW() bump that would force a push back).
            if (payload.deleted_at != null) {
              await window.api.tasks.applyRemote({
                id: payload.id as string,
                project_id: payload.project_id as string,
                owner_id: payload.owner_id as string,
                assigned_to: (payload.assigned_to as string | null) ?? null,
                title: payload.title as string,
                description: (payload.description as string | null) ?? null,
                status_id: payload.status_id as string,
                priority: (payload.priority as number) ?? 0,
                due_date: (payload.due_date as string | null) ?? null,
                parent_id: (payload.parent_id as string | null) ?? null,
                order_index: (payload.order_index as number) ?? 0,
                is_template: (payload.is_template as number) ?? 0,
                is_archived: (payload.is_archived as number) ?? 0,
                is_in_my_day: (payload.is_in_my_day as number) ?? 0,
                completed_date: (payload.completed_date as string | null) ?? null,
                recurrence_rule: (payload.recurrence_rule as string | null) ?? null,
                reference_url: (payload.reference_url as string | null) ?? null,
                my_day_dismissed_date: (payload.my_day_dismissed_date as string | null) ?? null,
                created_at: payload.created_at as string,
                updated_at: payload.updated_at as string,
                deleted_at: payload.deleted_at as string
              }).catch(() => {})
              return
            }
            // Upsert locally — check if exists
            const existing = await window.api.tasks.findById(payload.id as string)
            if (existing) {
              await window.api.tasks.update(payload.id as string, {
                title: payload.title as string,
                description: payload.description as string | null,
                status_id: payload.status_id as string,
                priority: payload.priority as number,
                due_date: payload.due_date as string | null,
                parent_id: payload.parent_id as string | null,
                order_index: payload.order_index as number,
                assigned_to: payload.assigned_to as string | null,
                is_archived: payload.is_archived as number,
                completed_date: payload.completed_date as string | null,
                recurrence_rule: payload.recurrence_rule as string | null,
                reference_url: payload.reference_url as string | null
              })
            } else {
              // Ensure owner + assigned user records exist for FK
              const ownerId = payload.owner_id as string
              const localOwner = await window.api.users.findById(ownerId)
              if (!localOwner) {
                await window.api.users.create({ id: ownerId, email: placeholderEmail(ownerId), display_name: null, avatar_url: null }).catch(() => {})
              }
              const assignedId = payload.assigned_to as string | null
              if (assignedId) {
                const localAssignee = await window.api.users.findById(assignedId)
                if (!localAssignee) {
                  await window.api.users.create({ id: assignedId, email: placeholderEmail(assignedId), display_name: null, avatar_url: null }).catch(() => {})
                }
              }
              // If this is a subtask, ensure the parent exists locally or the
              // parent_id FK will throw. Skip the insert if the parent is
              // missing — the next syncProjectDown / pullNewTasks will pick
              // it up in the correct parents-first order.
              const parentId = payload.parent_id as string | null
              if (parentId) {
                const localParent = await window.api.tasks.findById(parentId)
                if (!localParent) {
                  console.warn(`[Realtime] Skipping subtask ${payload.id} — parent ${parentId} not synced yet`)
                  return
                }
              }
              await window.api.tasks.create({
                id: payload.id as string,
                project_id: payload.project_id as string,
                owner_id: ownerId,
                title: payload.title as string,
                description: payload.description as string | null,
                status_id: payload.status_id as string,
                priority: payload.priority as number,
                due_date: payload.due_date as string | null,
                parent_id: payload.parent_id as string | null,
                order_index: payload.order_index as number,
                assigned_to: payload.assigned_to as string | null,
                is_template: (payload.is_template as number) ?? 0,
                is_archived: (payload.is_archived as number) ?? 0,
                completed_date: payload.completed_date as string | null,
                recurrence_rule: payload.recurrence_rule as string | null,
                reference_url: payload.reference_url as string | null
              })
            }
            // Sync labels from payload (check project labels first to avoid duplicates)
            if (payload.label_names) {
              const projLabels = await window.api.labels.findByProjectId(selectedProject.id)
              const projLabelsByName = new Map(projLabels.map((l: { name: string; id: string }) => [l.name.toLowerCase(), l]))
              const parsed: Array<string | { name: string; color: string }> = JSON.parse(payload.label_names as string)
              for (const entry of parsed) {
                const name = typeof entry === 'string' ? entry : entry.name
                const color = typeof entry === 'string' ? '#888888' : entry.color
                let label = projLabelsByName.get(name.toLowerCase()) as Awaited<ReturnType<typeof window.api.labels.findByName>> | undefined
                if (!label) {
                  label = await window.api.labels.findByName(userId, name)
                }
                if (!label) {
                  label = await window.api.labels.create({ id: crypto.randomUUID(), user_id: userId, name, color })
                }
                await window.api.labels.addToProject(selectedProject.id, label.id).catch(() => {})
                await window.api.tasks.addLabel(payload.id as string, label.id).catch(() => {})
              }
            }
          }
          // Refresh task store
          useTaskStore.getState().hydrateAllForProject(selectedProject.id, userId)
        }

        if (table === 'status') {
          // Full status re-sync is fine — statuses are few
          useStatusStore.getState().hydrateStatuses(selectedProject.id)
        }

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

        if (table === 'project_label') {
          // Remote tombstone or revival on the project↔label junction.
          // Mirror the remote state locally and cascade to task_labels so
          // the label disappears from tasks immediately. Without this,
          // User A keeps seeing a label that User B removed until the
          // next reconcile pass.
          const projectId = (payload.project_id as string) ?? selectedProject.id
          const labelId = payload.label_id as string | undefined
          const remoteDeletedAt = (payload.deleted_at as string | null | undefined) ?? null
          if (!labelId) return
          await window.api.labels.applyRemoteProjectLabel({
            project_id: projectId,
            label_id: labelId,
            created_at: (payload.created_at as string | null) ?? null,
            deleted_at: remoteDeletedAt
          }).catch(() => {})
          if (remoteDeletedAt) {
            await window.api.labels.softDeleteTaskLabelsForProjectLabel(projectId, labelId).catch(() => {})
          }
          await useTaskStore.getState().hydrateAllTaskLabels(projectId)
          await useLabelStore.getState().hydrateLabels(projectId)
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
