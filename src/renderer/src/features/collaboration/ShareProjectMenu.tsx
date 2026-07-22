import { useState, useCallback } from 'react'
import { Share2, Link, UserPlus, Unlink } from 'lucide-react'
import { useProjectStore } from '../../shared/stores'
import { useToast } from '../../shared/components/Toast'
import { uploadProjectToSupabase, subscribeToProject } from '../../services/SyncService'
import type { Project, User } from '../../../../shared/types'

interface ShareProjectMenuProps {
  selectedProject: Project
  currentUser: User | null
}

/**
 * Header share control for a project: the Share button + its dropdown
 * (invite by email, create/copy invite link, unshare). Extracted verbatim
 * from AppLayout (Story #107). All share/invite handlers keep their exact
 * dynamic imports and side effects.
 */
export function ShareProjectMenu({ selectedProject, currentUser }: ShareProjectMenuProps): React.JSX.Element {
  const updateProject = useProjectStore((s) => s.updateProject)
  const { addToast } = useToast()

  const [shareMenuOpen, setShareMenuOpen] = useState(false)
  const [emailInviteInput, setEmailInviteInput] = useState('')
  const [showEmailInput, setShowEmailInput] = useState(false)
  const [showUnshareConfirm, setShowUnshareConfirm] = useState(false)

  // Handle share project
  const handleShareProject = useCallback(async () => {
    if (!selectedProject || !currentUser) return
    try {
      await uploadProjectToSupabase(selectedProject.id, currentUser.id)
      await updateProject(selectedProject.id, { is_shared: 1 })
      const { generateInviteLink } = await import('../../services/SyncService')
      const link = await generateInviteLink(selectedProject.id, currentUser.id)
      await navigator.clipboard.writeText(link)
      await subscribeToProject(selectedProject.id)
      addToast({ message: 'Project shared! Invite link copied to clipboard.' })
    } catch (err) {
      console.error('Failed to share project:', err)
      addToast({ message: 'Failed to share project. Check your connection.' })
    }
  }, [selectedProject, currentUser, updateProject, addToast])

  // Handle generating a new invite link for an already-shared project
  const handleGenerateInviteLink = useCallback(async () => {
    if (!selectedProject || !currentUser) return
    try {
      const { generateInviteLink } = await import('../../services/SyncService')
      const link = await generateInviteLink(selectedProject.id, currentUser.id)
      await navigator.clipboard.writeText(link)
      addToast({ message: 'Invite link copied to clipboard (expires in 15 min).' })
    } catch (err) {
      console.error('Failed to generate invite link:', err)
      addToast({ message: 'Failed to generate invite link.' })
    }
  }, [selectedProject, currentUser, addToast])

  const handleUnshareProject = useCallback(async () => {
    if (!selectedProject || !currentUser) return
    try {
      const { removeProjectFromSupabase, unsubscribeFromProject: unsub } = await import('../../services/SyncService')
      await removeProjectFromSupabase(selectedProject.id)
      await unsub(selectedProject.id)
      await updateProject(selectedProject.id, { is_shared: 0 })
      setShareMenuOpen(false)
      setShowUnshareConfirm(false)
      addToast({ message: 'Project unshared. All members have been removed.' })
    } catch (err) {
      console.error('Failed to unshare project:', err)
      addToast({ message: 'Failed to unshare project.' })
    }
  }, [selectedProject, currentUser, updateProject, addToast])

  const handleEmailInviteFromHeader = useCallback(async () => {
    if (!selectedProject || !currentUser || !emailInviteInput.trim()) return
    const email = emailInviteInput.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      addToast({ message: 'Please enter a valid email address' })
      return
    }
    try {
      const { generateInviteLink } = await import('../../services/SyncService')
      // If not shared yet, share first
      if (selectedProject.is_shared !== 1) {
        const { uploadProjectToSupabase, subscribeToProject } = await import('../../services/SyncService')
        await uploadProjectToSupabase(selectedProject.id)
        await updateProject(selectedProject.id, { is_shared: 1 })
        await subscribeToProject(selectedProject.id)
      }
      await generateInviteLink(selectedProject.id, currentUser.id, email)
      setEmailInviteInput('')
      setShowEmailInput(false)
      setShareMenuOpen(false)
      addToast({ message: `Invite sent to ${email}. They'll see it when they open ToDoozy.` })
    } catch (err) {
      console.error('Failed to send email invite:', err)
      addToast({ message: 'Failed to send invite' })
    }
  }, [selectedProject, currentUser, emailInviteInput, updateProject, addToast])

  return (
    <div className="relative ml-1">
      <button
        onClick={() => { setShareMenuOpen(!shareMenuOpen); setShowEmailInput(false) }}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
        title="Share project"
        aria-label="Share project"
      >
        <Share2 size={16} />
      </button>
      {shareMenuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setShareMenuOpen(false); setShowEmailInput(false) }} />
          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-surface p-1 shadow-lg">
            {showEmailInput ? (
              <div className="flex flex-col gap-1.5 p-2">
                <input
                  type="email"
                  value={emailInviteInput}
                  onChange={(e) => setEmailInviteInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleEmailInviteFromHeader()
                    if (e.key === 'Escape') { e.stopPropagation(); setShowEmailInput(false) }
                  }}
                  placeholder="Email address"
                  autoFocus
                  className="rounded border border-border bg-background px-2.5 py-1.5 text-sm font-light text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
                />
                <button
                  onClick={handleEmailInviteFromHeader}
                  disabled={!emailInviteInput.trim()}
                  className="rounded bg-accent px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-widest text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
                >
                  Send Invite
                </button>
              </div>
            ) : (
              <>
                <button
                  onClick={() => setShowEmailInput(true)}
                  className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[12px] font-light text-foreground transition-colors hover:bg-foreground/6"
                >
                  <UserPlus size={14} className="text-muted" />
                  Invite member by email
                </button>
                <button
                  onClick={async () => {
                    if (selectedProject.is_shared !== 1) {
                      await handleShareProject()
                    } else {
                      await handleGenerateInviteLink()
                    }
                    setShareMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[12px] font-light text-foreground transition-colors hover:bg-foreground/6"
                >
                  <Link size={14} className="text-muted" />
                  {selectedProject.is_shared === 1 ? 'Copy invite link' : 'Create invite link'}
                </button>
                {selectedProject.is_shared === 1 && selectedProject.owner_id === currentUser?.id && (
                  <>
                    <div className="my-1 border-t border-border" />
                    {showUnshareConfirm ? (
                      <div className="flex flex-col gap-1.5 p-2">
                        <p className="text-[11px] font-light text-muted">Remove all members?</p>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => setShowUnshareConfirm(false)}
                            className="flex-1 rounded px-2 py-1.5 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleUnshareProject}
                            className="flex-1 rounded bg-danger px-2 py-1.5 text-[11px] font-bold uppercase tracking-widest text-white transition-colors hover:bg-danger/90"
                          >
                            Unshare
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowUnshareConfirm(true)}
                        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[12px] font-light text-danger transition-colors hover:bg-danger/10"
                      >
                        <Unlink size={14} />
                        Unshare project
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
