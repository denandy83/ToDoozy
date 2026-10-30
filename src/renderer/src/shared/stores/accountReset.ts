import { useTaskStore } from './taskStore'
import { useProjectStore } from './projectStore'
import { useStatusStore } from './statusStore'
import { useLabelStore } from './labelStore'
import { useAttachmentStore } from './attachmentStore'
import { useSavedViewStore } from './savedViewStore'
import { useProjectAreaStore } from './projectAreaStore'
import { useTemplateStore } from './templateStore'
import { useViewStore } from './viewStore'
import { useSettingsStore } from './settingsStore'
import { useLogStore } from './logStore'
import { useNotificationStore } from './notificationStore'
import { resetTimerForAccount } from './timerStore'

function clear<S>(store: { getInitialState(): S; setState(state: S, replace: true): void }): void {
  if (store.getInitialState && store.setState) store.setState(store.getInitialState(), true)
}

/** Synchronous privacy boundary; asynchronous hydrations also fence their replies. */
export function resetAccountStores(): void {
  clear(useTaskStore); clear(useProjectStore); clear(useStatusStore); clear(useLabelStore)
  clear(useAttachmentStore); clear(useSavedViewStore); clear(useProjectAreaStore); clear(useTemplateStore)
  clear(useViewStore); clear(useSettingsStore); clear(useLogStore)
  clear(useNotificationStore)
  resetTimerForAccount()
}
