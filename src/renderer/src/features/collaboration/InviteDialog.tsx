/**
 * Dialog shown when a user receives an invite link to join a shared project.
 * Also used for expired invite messages.
 */

interface InviteDialogProps {
  projectName: string
  ownerName: string
  expired: boolean
  onAccept: () => void
  onDecline: () => void
}

export function InviteDialog({
  projectName,
  ownerName,
  expired,
  onAccept,
  onDecline
}: InviteDialogProps): React.JSX.Element {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[400px] rounded-xl border border-border bg-background p-6 shadow-2xl">
        {expired ? (
          <>
            <h2 className="text-lg font-light tracking-tight text-foreground">
              Invite Expired
            </h2>
            <p className="mt-3 text-sm font-light text-muted">
              This invite link has expired. Ask the project owner for a new one.
            </p>
            <div className="mt-6 flex justify-end">
              <button
                onClick={onDecline}
                className="rounded-md bg-accent px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-white transition-colors hover:bg-accent/90"
              >
                OK
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-light tracking-tight text-foreground">
              Join Project
            </h2>
            <p className="mt-3 text-sm font-light text-muted">
              <span className="font-medium text-foreground">{ownerName}</span> invited you to join{' '}
              <span className="font-medium text-foreground">{projectName}</span>.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={onDecline}
                className="rounded-md px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
              >
                Decline
              </button>
              <button
                onClick={onAccept}
                className="rounded-md bg-accent px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-white transition-colors hover:bg-accent/90"
              >
                Accept
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
