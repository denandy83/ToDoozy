/**
 * Members section for project settings — shows member list, invite button,
 * remove/leave/unshare actions.
 */
import { useState, useEffect, useCallback } from 'react'
import { UserPlus, LogOut, Unlink, Trash2, Check } from 'lucide-react'
import { useAuthStore } from '../../shared/stores/authStore'
import { useProjectStore } from '../../shared/stores/projectStore'
import type { Project } from '../../../../shared/types'
import { getAvatarColor, getAvatarInitials, AVATAR_PALETTE } from '../../../../shared/avatarUtils'
import { invalidateMemberDisplay } from '../../shared/hooks/useMemberDisplay'
import {
  generateInviteLink,
  removeSharedMember,
  removeProjectFromSupabase,
  getSharedProjectMembers,
  updateSharedMemberDisplay,
  unsubscribeFromProject
} from '../../services/SyncService'

interface MemberSettingsProps {
  project: Project
  onToast: (message: string) => void
}

interface MemberDisplay {
  user_id: string
  email: string
  display_name: string | null
  role: string
  joined_at: string
  display_color: string | null
  display_initials: string | null
}

export function MemberSettings({ project, onToast }: MemberSettingsProps): React.JSX.Element {
  const currentUser = useAuthStore((s) => s.currentUser)
  const updateProject = useProjectStore((s) => s.updateProject)
  const [members, setMembers] = useState<MemberDisplay[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedLink, setCopiedLink] = useState(false)
  const [confirmUnshare, setConfirmUnshare] = useState(false)
  const [emailInviteValue, setEmailInviteValue] = useState('')
  const [sendingEmailInvite, setSendingEmailInvite] = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null)
  const [editColor, setEditColor] = useState('')
  const [editInitials, setEditInitials] = useState('')

  const handleSaveMemberDisplay = async (userId: string): Promise<void> => {
    const color = editColor || null
    const initials = editInitials.trim() || null
    // Save locally
    await window.api.projects.updateMember(project.id, userId, { display_color: color, display_initials: initials })
    // Sync to Supabase so all members see the change
    if (project.is_shared === 1) {
      await updateSharedMemberDisplay(project.id, userId, color, initials).catch((err) =>
        console.warn('Failed to sync member display to Supabase:', err)
      )
    }
    setMembers((prev) => prev.map((m) => m.user_id === userId ? { ...m, display_color: color, display_initials: initials } : m))
    invalidateMemberDisplay(project.id)
    setEditingMemberId(null)
    onToast('Member appearance updated')
  }

  const isOwner = project.owner_id === currentUser?.id
  const isShared = project.is_shared === 1

  const loadMembers = useCallback(async () => {
    if (!isShared) {
      setLoading(false)
      return
    }
    try {
      const data = await getSharedProjectMembers(project.id)
      // Enrich with local display overrides
      const localMembers = await window.api.projects.getMembers(project.id)
      const localMap = new Map(localMembers.map((lm) => [lm.user_id, lm]))
      setMembers(data.map((m) => ({
        ...m,
        joined_at: m.joined_at,
        display_color: localMap.get(m.user_id)?.display_color ?? null,
        display_initials: localMap.get(m.user_id)?.display_initials ?? null
      })))
    } catch (err) {
      console.error('Failed to load members:', err)
    } finally {
      setLoading(false)
    }
  }, [project.id, isShared])

  useEffect(() => {
    loadMembers()
  }, [loadMembers])

  const handleGenerateInvite = async (): Promise<void> => {
    if (!currentUser) return
    try {
      const link = await generateInviteLink(project.id, currentUser.id)
      await navigator.clipboard.writeText(link)
      setCopiedLink(true)
      onToast('Invite link copied to clipboard (expires in 15 minutes)')
      setTimeout(() => setCopiedLink(false), 3000)
    } catch (err) {
      console.error('Failed to generate invite:', err)
      onToast('Failed to generate invite link')
    }
  }

  const handleEmailInvite = async (): Promise<void> => {
    if (!currentUser || !emailInviteValue.trim()) return
    const email = emailInviteValue.trim().toLowerCase()
    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      onToast('Please enter a valid email address')
      return
    }
    // Check if already a member
    if (members.some((m) => m.email.toLowerCase() === email)) {
      onToast('This person is already a member')
      return
    }
    setSendingEmailInvite(true)
    try {
      await generateInviteLink(project.id, currentUser.id, email)
      setEmailInviteValue('')
      onToast(`Invite sent to ${email}. They'll see it when they open ToDoozy.`)
    } catch (err) {
      console.error('Failed to send email invite:', err)
      onToast('Failed to send invite')
    } finally {
      setSendingEmailInvite(false)
    }
  }

  const handleRemoveMember = async (userId: string): Promise<void> => {
    try {
      await removeSharedMember(project.id, userId)
      setMembers((prev) => prev.filter((m) => m.user_id !== userId))
      onToast('Member removed')
    } catch (err) {
      console.error('Failed to remove member:', err)
      onToast('Failed to remove member')
    }
  }

  const handleLeaveProject = async (keepLocal: boolean): Promise<void> => {
    if (!currentUser) return
    try {
      await removeSharedMember(project.id, currentUser.id)
      await unsubscribeFromProject(project.id)
      if (keepLocal) {
        // Create a new local project with a fresh UUID so it can't collide with the shared original
        const newId = crypto.randomUUID()
        await window.api.projects.create({
          id: newId,
          name: `${project.name} (local copy)`,
          description: project.description,
          color: project.color,
          icon: project.icon,
          owner_id: currentUser.id,
          is_default: 0
        })
        await window.api.projects.addMember(newId, currentUser.id, 'owner')
        // Copy statuses to new project
        const statuses = await window.api.statuses.findByProjectId(project.id)
        const statusIdMap: Record<string, string> = {}
        for (const s of statuses) {
          const newStatusId = crypto.randomUUID()
          statusIdMap[s.id] = newStatusId
          await window.api.statuses.create({
            id: newStatusId,
            project_id: newId,
            name: s.name,
            color: s.color,
            icon: s.icon,
            order_index: s.order_index,
            is_done: s.is_done,
            is_default: s.is_default
          })
        }
        // Copy labels to new project
        const oldLabels = await window.api.labels.findByProjectId(project.id)
        for (const l of oldLabels) {
          await window.api.labels.addToProject(newId, l.id).catch(() => {})
        }
        // Copy tasks to new project (remap status IDs and parent IDs)
        const tasks = await window.api.tasks.findByProjectId(project.id)
        const taskIdMap: Record<string, string> = {}
        // First pass: create all tasks without parent_id
        for (const t of tasks) {
          const newTaskId = crypto.randomUUID()
          taskIdMap[t.id] = newTaskId
          await window.api.tasks.create({
            id: newTaskId,
            project_id: newId,
            owner_id: currentUser.id,
            title: t.title,
            description: t.description,
            status_id: statusIdMap[t.status_id] ?? t.status_id,
            priority: t.priority,
            due_date: t.due_date,
            parent_id: null,
            order_index: t.order_index,
            assigned_to: null,
            is_template: t.is_template,
            is_archived: t.is_archived,
            completed_date: t.completed_date,
            recurrence_rule: t.recurrence_rule,
            reference_url: t.reference_url
          })
          // Copy labels
          const labels = await window.api.tasks.getLabels(t.id)
          for (const l of labels) {
            await window.api.tasks.addLabel(newTaskId, l.label_id).catch(() => {})
          }
        }
        // Second pass: set parent_id for subtasks
        for (const t of tasks) {
          if (t.parent_id && taskIdMap[t.parent_id]) {
            await window.api.tasks.update(taskIdMap[t.id], { parent_id: taskIdMap[t.parent_id] })
          }
        }
        // Delete the old shared project locally
        await window.api.projects.delete(project.id)
        onToast('You left the project. A local copy has been kept.')
      } else {
        await window.api.projects.delete(project.id)
        onToast('You left the project.')
      }
      const { hydrateProjects } = useProjectStore.getState()
      await hydrateProjects(currentUser.id)
      setShowLeaveConfirm(false)
    } catch (err) {
      console.error('Failed to leave project:', err)
      onToast('Failed to leave project')
    }
  }

  const handleUnshare = async (): Promise<void> => {
    try {
      await removeProjectFromSupabase(project.id)
      await unsubscribeFromProject(project.id)
      await updateProject(project.id, { is_shared: 0 })
      setMembers([])
      setConfirmUnshare(false)
      onToast('Project unshared. All members have been notified.')
    } catch (err) {
      console.error('Failed to unshare:', err)
      onToast('Failed to unshare project')
    }
  }

  if (!isShared) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted">
        <p className="text-sm font-light">This project is not shared.</p>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-widest">
          Use the Share button in the project header to start collaborating.
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Invite by Email */}
      {isOwner && (
        <div className="space-y-2">
          <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
            Invite
          </h4>
          <div className="flex gap-2">
            <input
              type="email"
              value={emailInviteValue}
              onChange={(e) => setEmailInviteValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleEmailInvite() }}
              placeholder="Email address"
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-light text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
            />
            <button
              onClick={handleEmailInvite}
              disabled={!emailInviteValue.trim() || sendingEmailInvite}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
            >
              <UserPlus size={14} />
              Invite
            </button>
          </div>
          <button
            onClick={handleGenerateInvite}
            className="flex w-full items-center gap-2 rounded-lg border border-border px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
          >
            {copiedLink ? <Check size={14} className="text-green-500" /> : <UserPlus size={14} />}
            {copiedLink ? 'Link Copied!' : 'Or copy invite link'}
          </button>
        </div>
      )}

      {/* Member List */}
      <div className="space-y-1">
        <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          Members ({members.length})
        </h4>
        {members.map((member) => (
          <div key={member.user_id} className="space-y-1">
            <div className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-foreground/6">
              <button
                onClick={() => {
                  if (editingMemberId === member.user_id) {
                    setEditingMemberId(null)
                  } else {
                    setEditingMemberId(member.user_id)
                    setEditColor(member.display_color ?? '')
                    setEditInitials(member.display_initials ?? '')
                  }
                }}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[9px] font-bold uppercase tracking-wider text-white transition-opacity hover:opacity-80"
                style={{ backgroundColor: getAvatarColor(member.user_id, member.display_color) }}
                title="Click to customize"
              >
                {getAvatarInitials(member.display_name, member.email, member.display_initials)}
              </button>
              <div className="flex-1 min-w-0">
                <p className="truncate text-[13px] font-light text-foreground">
                  {member.display_name ?? member.email}
                </p>
                {member.display_name && (
                  <p className="truncate text-[10px] text-muted">{member.email}</p>
                )}
              </div>
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent">
                {member.role}
              </span>
              {isOwner && member.user_id !== currentUser?.id && (
                <button
                  onClick={() => handleRemoveMember(member.user_id)}
                  className="rounded p-1 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                  title="Remove member"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            {/* Edit avatar appearance */}
            {editingMemberId === member.user_id && (
              <div
                ref={(el) => { if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50) }}
                className="ml-12 flex flex-col gap-2 rounded-lg border border-border bg-background p-3"
              >
                <div>
                  <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-muted">Color</p>
                  <div className="flex flex-wrap gap-1.5">
                    {AVATAR_PALETTE.map((c) => (
                      <button
                        key={c}
                        onClick={() => setEditColor(c)}
                        className={`h-5 w-5 rounded-full transition-transform ${editColor === c ? 'scale-125 ring-2 ring-foreground/30 ring-offset-1 ring-offset-background' : 'hover:scale-110'}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    {editColor && (
                      <button
                        onClick={() => setEditColor('')}
                        className="flex h-5 items-center px-1.5 rounded text-[8px] font-bold uppercase tracking-wider text-muted hover:bg-foreground/6"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-muted">Initials</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editInitials}
                      onChange={(e) => setEditInitials(e.target.value.slice(0, 3))}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveMemberDisplay(member.user_id) }}
                      placeholder={getAvatarInitials(member.display_name, member.email)}
                      maxLength={3}
                      className="w-16 rounded border border-border bg-surface px-2 py-1 text-center text-[11px] font-bold uppercase tracking-widest text-foreground placeholder:text-muted/40 focus:border-accent focus:outline-none"
                    />
                    <div
                      className="flex h-7 w-7 items-center justify-center rounded-full text-[9px] font-bold uppercase text-white"
                      style={{ backgroundColor: editColor || getAvatarColor(member.user_id) }}
                    >
                      {editInitials || getAvatarInitials(member.display_name, member.email)}
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-1.5">
                  <button
                    onClick={() => setEditingMemberId(null)}
                    className="rounded px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-muted hover:bg-foreground/6"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleSaveMemberDisplay(member.user_id)}
                    className="rounded bg-accent px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-white hover:bg-accent/90"
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Leave / Unshare */}
      <div className="border-t border-border pt-4">
        {!isOwner && (
          showLeaveConfirm ? (
            <div className="space-y-2">
              <p className="text-sm font-light text-muted">
                Keep a local copy of this project?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => handleLeaveProject(true)}
                  className="flex-1 rounded-md border border-border px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-foreground transition-colors hover:bg-foreground/6"
                >
                  Keep Copy
                </button>
                <button
                  onClick={() => handleLeaveProject(false)}
                  className="flex-1 rounded-md bg-danger px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-white transition-colors hover:bg-danger/90"
                >
                  Delete
                </button>
              </div>
              <button
                onClick={() => setShowLeaveConfirm(false)}
                className="w-full text-center text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowLeaveConfirm(true)}
              className="flex w-full items-center gap-2 rounded-lg px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-danger transition-colors hover:bg-danger/10"
            >
              <LogOut size={14} />
              Leave Project
            </button>
          )
        )}
        {isOwner && (
          <>
            {confirmUnshare ? (
              <div className="space-y-2">
                <p className="text-sm font-light text-muted">
                  This will remove all members. They can keep a local copy. Are you sure?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmUnshare(false)}
                    className="flex-1 rounded-md px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUnshare}
                    className="flex-1 rounded-md bg-danger px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-white transition-colors hover:bg-danger/90"
                  >
                    Unshare
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmUnshare(true)}
                className="flex w-full items-center gap-2 rounded-lg px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-danger transition-colors hover:bg-danger/10"
              >
                <Unlink size={14} />
                Unshare Project
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
