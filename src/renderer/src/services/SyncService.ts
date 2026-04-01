/**
 * SyncService — manages write-through to Supabase and Realtime subscriptions
 * for shared projects. Runs in the renderer process where the authenticated
 * Supabase client lives.
 */
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'
import { getSupabase } from '../lib/supabase'
import type { Task, Status, SyncOperation } from '../../../shared/types'

type RealtimeCallback = (event: string, table: string, payload: Record<string, unknown>) => void

let channels: Map<string, RealtimeChannel> = new Map()
let onChangeCallback: RealtimeCallback | null = null
let isOnline = true

export function setOnlineStatus(online: boolean): void {
  isOnline = online
}

export function getOnlineStatus(): boolean {
  return isOnline
}

export function setRealtimeCallback(cb: RealtimeCallback): void {
  onChangeCallback = cb
}

/**
 * Subscribe to Realtime changes for a shared project.
 */
export async function subscribeToProject(projectId: string): Promise<void> {
  if (channels.has(projectId)) return

  const supabase = await getSupabase()
  const channel = supabase
    .channel(`project:${projectId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'shared_tasks', filter: `project_id=eq.${projectId}` },
      (payload) => {
        const data = payload.eventType === 'DELETE'
          ? payload.old as Record<string, unknown>
          : payload.new as Record<string, unknown>
        onChangeCallback?.('task', payload.eventType, data)
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'shared_statuses', filter: `project_id=eq.${projectId}` },
      (payload) => {
        const data = payload.eventType === 'DELETE'
          ? payload.old as Record<string, unknown>
          : payload.new as Record<string, unknown>
        onChangeCallback?.('status', payload.eventType, data)
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'shared_project_members', filter: `project_id=eq.${projectId}` },
      (payload) => {
        // For DELETE events, pass the old record (new is empty on delete)
        const data = payload.eventType === 'DELETE'
          ? payload.old as Record<string, unknown>
          : payload.new as Record<string, unknown>
        onChangeCallback?.('member', payload.eventType, data)
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'shared_activity_log', filter: `project_id=eq.${projectId}` },
      (payload) => {
        onChangeCallback?.('activity', payload.eventType, payload.new as Record<string, unknown>)
      }
    )
    .subscribe()

  channels.set(projectId, channel)
}

/**
 * Unsubscribe from Realtime changes for a project.
 */
export async function unsubscribeFromProject(projectId: string): Promise<void> {
  const channel = channels.get(projectId)
  if (channel) {
    const supabase = await getSupabase()
    await supabase.removeChannel(channel)
    channels.delete(projectId)
  }
}

/**
 * Unsubscribe from all Realtime channels.
 */
export async function unsubscribeAll(): Promise<void> {
  const supabase = await getSupabase()
  for (const channel of channels.values()) {
    await supabase.removeChannel(channel)
  }
  channels = new Map()
}

// ── Write-Through Operations ────────────────────────────────────────

/**
 * Upload a project and all its data to Supabase (first-time share).
 */
export async function uploadProjectToSupabase(
  projectId: string,
  _ownerId?: string
): Promise<void> {
  const supabase = await getSupabase()

  // Verify we have an authenticated session before attempting Supabase operations
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    throw new Error('No authenticated Supabase session. Please log out and log back in.')
  }
  console.log('[SyncService] Sharing project with auth.uid:', session.user.id)

  // Get project data from local
  const project = await window.api.projects.findById(projectId)
  if (!project) throw new Error('Project not found')

  // Create shared project and add owner as member atomically via SECURITY DEFINER function
  const { error: shareError } = await supabase.rpc('share_project', {
    p_id: project.id,
    p_name: project.name,
    p_description: project.description ?? null,
    p_color: project.color ?? '#888888',
    p_icon: project.icon ?? 'folder'
  })
  if (shareError) throw shareError

  // Upload statuses
  const statuses = await window.api.statuses.findByProjectId(projectId)
  if (statuses.length > 0) {
    const { error: statusError } = await supabase.from('shared_statuses').upsert(
      statuses.map((s) => ({
        id: s.id,
        project_id: projectId,
        name: s.name,
        color: s.color,
        icon: s.icon,
        order_index: s.order_index,
        is_done: s.is_done,
        is_default: s.is_default,
        created_at: s.created_at,
        updated_at: s.updated_at
      }))
    )
    if (statusError) throw statusError
  }

  // Upload all project labels (not just task-assigned ones)
  const projectLabels = await window.api.labels.findByProjectId(projectId)
  const allLabelData = projectLabels.map((l) => ({ name: l.name, color: l.color }))
  await supabase.from('shared_projects').update({ label_data: JSON.stringify(allLabelData) }).eq('id', projectId)

  // Upload tasks with label names+colors (resolve IDs for cross-user sync)
  const tasks = await window.api.tasks.findByProjectId(projectId)
  for (const task of tasks) {
    const taskLabels = await window.api.tasks.getLabels(task.id)
    const labelData: Array<{ name: string; color: string }> = []
    for (const tl of taskLabels) {
      const label = await window.api.labels.findById(tl.label_id)
      if (label) labelData.push({ name: label.name, color: label.color })
    }
    await syncTaskToSupabase(supabase, task, labelData)
  }
}

async function syncTaskToSupabase(
  supabase: SupabaseClient,
  task: Task,
  labelData: Array<{ name: string; color: string }> | string[]
): Promise<void> {
  const { error } = await supabase.from('shared_tasks').upsert({
    id: task.id,
    project_id: task.project_id,
    owner_id: task.owner_id,
    assigned_to: task.assigned_to,
    title: task.title,
    description: task.description,
    status_id: task.status_id,
    priority: task.priority,
    due_date: task.due_date,
    parent_id: task.parent_id,
    order_index: task.order_index,
    is_template: task.is_template,
    is_archived: task.is_archived,
    completed_date: task.completed_date,
    recurrence_rule: task.recurrence_rule,
    reference_url: task.reference_url,
    label_names: JSON.stringify(labelData),
    created_at: task.created_at,
    updated_at: task.updated_at
  })
  if (error) throw error
}

/**
 * Write-through a task change to Supabase (for shared projects).
 */
export async function syncTaskChange(
  task: Task,
  operation: SyncOperation,
  labelData?: Array<{ name: string; color: string }>
): Promise<void> {
  if (!isOnline) {
    await window.api.sync.enqueue('shared_tasks', task.id, operation, JSON.stringify(task))
    return
  }

  const supabase = await getSupabase()

  if (operation === 'DELETE') {
    await supabase.from('shared_tasks').delete().eq('id', task.id)
  } else {
    await syncTaskToSupabase(supabase, task, labelData ?? [])
  }
}

/**
 * Write-through a status change to Supabase.
 */
export async function syncStatusChange(
  status: Status,
  operation: SyncOperation
): Promise<void> {
  if (!isOnline) {
    await window.api.sync.enqueue('shared_statuses', status.id, operation, JSON.stringify(status))
    return
  }

  const supabase = await getSupabase()

  if (operation === 'DELETE') {
    await supabase.from('shared_statuses').delete().eq('id', status.id)
  } else {
    await supabase.from('shared_statuses').upsert({
      id: status.id,
      project_id: status.project_id,
      name: status.name,
      color: status.color,
      icon: status.icon,
      order_index: status.order_index,
      is_done: status.is_done,
      is_default: status.is_default,
      created_at: status.created_at,
      updated_at: status.updated_at
    })
  }
}

/**
 * Process queued offline changes.
 */
export async function processSyncQueue(): Promise<number> {
  const queue = await window.api.sync.getQueue()
  if (queue.length === 0) return 0

  const supabase = await getSupabase()
  let processed = 0

  for (const entry of queue) {
    try {
      const payload = JSON.parse(entry.payload)

      if (entry.operation === 'DELETE') {
        await supabase.from(entry.table_name).delete().eq('id', entry.row_id)
      } else {
        await supabase.from(entry.table_name).upsert(payload)
      }

      await window.api.sync.dequeue(entry.id)
      processed++
    } catch (err) {
      console.error(`Failed to sync queue entry ${entry.id}:`, err)
      break // Stop on first error to maintain order
    }
  }

  return processed
}

/**
 * Generate an invite link for a shared project.
 * If targetEmail is provided, the invite is tied to that email address.
 */
export async function generateInviteLink(
  projectId: string,
  createdBy: string,
  targetEmail?: string
): Promise<string> {
  const supabase = await getSupabase()
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15 minutes

  const insertData: Record<string, unknown> = {
    project_id: projectId,
    created_by: createdBy,
    expires_at: expiresAt,
    status: 'pending'
  }
  if (targetEmail) {
    insertData.target_email = targetEmail.toLowerCase().trim()
  }

  const { data, error } = await supabase
    .from('shared_project_invites')
    .insert(insertData)
    .select('token')
    .single()

  if (error) throw error
  return `todoozy://invite/${data.token}`
}

/**
 * Check if the current user has any pending email-based invites.
 */
export async function checkPendingInvites(userEmail: string): Promise<Array<{
  token: string
  projectId: string
  projectName: string
  ownerEmail: string
  expiresAt: string
}>> {
  const supabase = await getSupabase()

  const { data, error } = await supabase.rpc('get_pending_invites_for_email', {
    user_email: userEmail.toLowerCase().trim()
  })

  if (error || !data) return []

  return data.map((invite: Record<string, unknown>) => ({
    token: invite.token as string,
    projectId: invite.project_id as string,
    projectName: invite.project_name as string,
    ownerEmail: invite.owner_email as string,
    expiresAt: invite.expires_at as string
  }))
}

/**
 * Validate an invite token and return invite details.
 */
/**
 * Subscribe to real-time invite notifications for a specific email.
 */
export async function subscribeToInvites(
  email: string,
  onInvite: (invite: { token: string }) => void
): Promise<() => void> {
  const supabase = await getSupabase()
  const channel = supabase
    .channel(`invites:${email}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'shared_project_invites',
        filter: `target_email=eq.${email.toLowerCase().trim()}`
      },
      (payload) => {
        const invite = payload.new as { token: string; status: string }
        if (invite.status === 'pending') {
          onInvite({ token: invite.token })
        }
      }
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

export async function validateInviteToken(token: string): Promise<{
  valid: boolean
  expired: boolean
  projectName: string
  ownerName: string
  projectId: string
  inviteId: string
} | null> {
  const supabase = await getSupabase()

  // Use SECURITY DEFINER function to bypass RLS — the invitee isn't a member yet
  const { data, error } = await supabase.rpc('validate_invite', {
    invite_token: token
  })

  if (error || !data || data.length === 0) return null

  const invite = data[0]
  const expired = new Date(invite.expires_at) < new Date() || invite.status === 'expired'

  return {
    valid: !expired && invite.status === 'pending',
    expired,
    projectName: invite.project_name,
    ownerName: invite.owner_email,
    projectId: invite.project_id,
    inviteId: invite.token
  }
}

/**
 * Accept an invite — adds user to shared_project_members and syncs data down.
 */
export async function acceptInvite(token: string, userId: string): Promise<string> {
  const supabase = await getSupabase()

  console.log('[SyncService] Accepting invite token:', token)
  // Use server-side function that validates the invite and adds the member atomically
  const { data: projectId, error } = await supabase.rpc('accept_invite', {
    invite_token: token
  })

  console.log('[SyncService] accept_invite result:', { projectId, error })
  if (error) throw new Error(error.message)
  if (!projectId) throw new Error('Failed to accept invite')

  // Sync project data down to local
  console.log('[SyncService] Syncing project down:', projectId)
  await syncProjectDown(projectId, userId)
  console.log('[SyncService] Project synced successfully')

  return projectId
}

/**
 * Decline an invite — marks it so it won't show again.
 */
export async function declineInvite(token: string): Promise<void> {
  const supabase = await getSupabase()
  await supabase
    .from('shared_project_invites')
    .update({ status: 'declined' })
    .eq('token', token)
}

/**
 * Sync all shared project data from Supabase to local SQLite.
 */
export async function syncProjectDown(projectId: string, userId: string): Promise<void> {
  const supabase = await getSupabase()

  // Get shared project
  const { data: project } = await supabase
    .from('shared_projects')
    .select('*')
    .eq('id', projectId)
    .single()

  if (!project) throw new Error('Shared project not found')

  // Ensure the project owner's user record exists locally (needed for FK on projects.owner_id)
  const localOwner = await window.api.users.findById(project.owner_id)
  if (!localOwner) {
    await window.api.users.create({
      id: project.owner_id,
      email: 'shared-user',
      display_name: null,
      avatar_url: null
    }).catch(() => { /* already exists */ })
  }

  // Create local project if not exists
  const localProject = await window.api.projects.findById(projectId)
  if (!localProject) {
    await window.api.projects.create({
      id: project.id,
      name: project.name,
      description: project.description,
      color: project.color,
      icon: project.icon,
      owner_id: project.owner_id,
      is_default: 0
    })
    // Add current user as member locally
    await window.api.projects.addMember(projectId, userId, 'member')
  }
  // Mark as shared
  await window.api.projects.update(projectId, { is_shared: 1 })

  // Sync all project labels (create locally if missing, associate with project)
  if (project.label_data) {
    const labels: Array<{ name: string; color: string }> = JSON.parse(project.label_data)
    for (const entry of labels) {
      let label = await window.api.labels.findByName(userId, entry.name)
      if (!label) {
        label = await window.api.labels.create({
          id: crypto.randomUUID(),
          name: entry.name,
          color: entry.color
        })
      }
      await window.api.labels.addToProject(projectId, label.id).catch(() => {})
    }
  }

  // Sync statuses
  const { data: statuses } = await supabase
    .from('shared_statuses')
    .select('*')
    .eq('project_id', projectId)

  if (statuses) {
    for (const status of statuses) {
      const existing = await window.api.statuses.findById(status.id)
      if (!existing) {
        await window.api.statuses.create({
          id: status.id,
          project_id: status.project_id,
          name: status.name,
          color: status.color,
          icon: status.icon,
          order_index: status.order_index,
          is_done: status.is_done,
          is_default: status.is_default
        })
      }
    }
  }

  // Sync tasks
  const { data: tasks } = await supabase
    .from('shared_tasks')
    .select('*')
    .eq('project_id', projectId)

  if (tasks) {
    for (const task of tasks) {
      const existing = await window.api.tasks.findById(task.id)
      if (!existing) {
        await window.api.tasks.create({
          id: task.id,
          project_id: task.project_id,
          owner_id: task.owner_id,
          title: task.title,
          description: task.description,
          status_id: task.status_id,
          priority: task.priority,
          due_date: task.due_date,
          parent_id: task.parent_id,
          order_index: task.order_index,
          assigned_to: task.assigned_to,
          is_template: task.is_template,
          is_archived: task.is_archived,
          completed_date: task.completed_date,
          recurrence_rule: task.recurrence_rule,
          reference_url: task.reference_url
        })
      }

      // Auto-create labels from label_names and associate with project
      if (task.label_names) {
        const parsed: Array<string | { name: string; color: string }> = JSON.parse(task.label_names)
        for (const entry of parsed) {
          // Support both old format (string) and new format ({name, color})
          const name = typeof entry === 'string' ? entry : entry.name
          const color = typeof entry === 'string' ? '#888888' : entry.color
          // Find existing label by name for this user, or create with the sharer's color
          let label = await window.api.labels.findByName(userId, name)
          if (!label) {
            label = await window.api.labels.create({
              id: crypto.randomUUID(),
              name,
              color
            })
          }
          // Ensure label is associated with this project
          await window.api.labels.addToProject(projectId, label.id).catch(() => {})
          // Assign label to task
          await window.api.tasks.addLabel(task.id, label.id).catch(() => {})
        }
      }
    }
  }

  // Sync members locally
  const { data: members } = await supabase
    .from('shared_project_members')
    .select('*')
    .eq('project_id', projectId)

  if (members) {
    for (const member of members) {
      const localMembers = await window.api.projects.getMembers(projectId)
      const alreadyMember = localMembers.some((m) => m.user_id === member.user_id)
      if (!alreadyMember) {
        await window.api.projects.addMember(projectId, member.user_id, member.role)
      }
    }
  }
}

/**
 * Remove all Supabase data for a project (unshare).
 */
export async function removeProjectFromSupabase(projectId: string): Promise<void> {
  const supabase = await getSupabase()

  // Explicitly delete non-owner members first — direct deletes trigger Realtime events
  // (cascade deletes do NOT trigger Realtime, so members wouldn't get notified)
  const { data: { session } } = await supabase.auth.getSession()
  const ownerId = session?.user?.id
  if (ownerId) {
    await supabase
      .from('shared_project_members')
      .delete()
      .eq('project_id', projectId)
      .neq('user_id', ownerId)
  }

  // Now delete the project (cascades remaining data: tasks, statuses, owner member row, etc.)
  const { error } = await supabase.from('shared_projects').delete().eq('id', projectId)
  if (error) throw error
}

/**
 * Get shared project members with their profile info from Supabase.
 */
export async function getSharedProjectMembers(projectId: string): Promise<Array<{
  user_id: string
  role: string
  joined_at: string
  email: string
  display_name: string | null
}>> {
  const supabase = await getSupabase()

  const { data, error } = await supabase
    .from('shared_project_members')
    .select('user_id, role, joined_at')
    .eq('project_id', projectId)

  if (error || !data) return []

  // Get user profiles from auth
  const members: Array<{
    user_id: string
    role: string
    joined_at: string
    email: string
    display_name: string | null
  }> = []

  for (const member of data) {
    // Try to get user info from local users table first
    const localUser = await window.api.users.findById(member.user_id)
    members.push({
      user_id: member.user_id,
      role: member.role,
      joined_at: member.joined_at,
      email: localUser?.email ?? 'unknown',
      display_name: localUser?.display_name ?? null
    })
  }

  return members
}

/**
 * Remove a member from a shared project.
 */
export async function removeSharedMember(projectId: string, userId: string): Promise<void> {
  const supabase = await getSupabase()
  const { error } = await supabase
    .from('shared_project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId)
  if (error) throw error

  // Also remove locally
  await window.api.projects.removeMember(projectId, userId)
}
