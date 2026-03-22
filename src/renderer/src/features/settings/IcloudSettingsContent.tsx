import { useEffect } from 'react'
import { Cloud, CloudOff } from 'lucide-react'
import { useAttachmentStore } from '../../shared/stores'

export function IcloudSettingsContent(): React.JSX.Element {
  const icloudAvailable = useAttachmentStore((s) => s.icloudAvailable)
  const icloudEnabled = useAttachmentStore((s) => s.icloudEnabled)
  const checkIcloudStatus = useAttachmentStore((s) => s.checkIcloudStatus)
  const setIcloudEnabled = useAttachmentStore((s) => s.setIcloudEnabled)

  useEffect(() => {
    checkIcloudStatus()
  }, [checkIcloudStatus])

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
        iCloud Drive
      </p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {icloudEnabled ? (
            <Cloud size={20} className="text-accent" />
          ) : (
            <CloudOff size={20} className="text-muted" />
          )}
          <div>
            <p className="text-sm font-light text-foreground">iCloud Drive Sync</p>
            <p className="text-[10px] text-muted">
              {!icloudAvailable
                ? 'iCloud Drive is not available on this system'
                : icloudEnabled
                  ? 'Attachments sync to iCloud Drive for access on other devices'
                  : 'Enable to sync task attachments via iCloud Drive'}
            </p>
          </div>
        </div>

        <button
          onClick={() => setIcloudEnabled(!icloudEnabled)}
          disabled={!icloudAvailable}
          className={`relative h-6 w-11 rounded-full transition-colors ${
            !icloudAvailable
              ? 'cursor-not-allowed bg-border opacity-50'
              : icloudEnabled
                ? 'bg-accent'
                : 'bg-border'
          }`}
          aria-label={icloudEnabled ? 'Disable iCloud sync' : 'Enable iCloud sync'}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              icloudEnabled ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </button>
      </div>

      {icloudEnabled && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mb-2">
            Storage Location
          </p>
          <p className="text-sm font-light text-fg-secondary break-all">
            ~/Library/Mobile Documents/com~apple~CloudDocs/ToDoozy/
          </p>
          <p className="mt-2 text-[10px] text-muted">
            Files are also stored locally for offline access
          </p>
        </div>
      )}

      {!icloudEnabled && icloudAvailable && (
        <p className="text-sm font-light text-fg-secondary">
          When disabled, existing local copies remain accessible but won&apos;t sync to other devices. New attachments cannot be added.
        </p>
      )}
    </div>
  )
}
