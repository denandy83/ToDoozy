import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { is } from '@electron-toolkit/utils'
import { isTrustedAppUrl } from '../shared/trustedAppUrl'
import { validateExternalUrl } from './shell-url'

export function trustedRendererUrl(): string {
  return is.dev && process.env.ELECTRON_RENDERER_URL
    ? process.env.ELECTRON_RENDERER_URL
    : pathToFileURL(join(__dirname, '../renderer/index.html')).href
}

export function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame
  if (!frame || frame.parent !== null || !isTrustedAppUrl(frame.url, trustedRendererUrl())) {
    throw new Error('Untrusted IPC sender')
  }
}

export function guardRendererNavigation(contents: WebContents): void {
  const external = (url: string): void => {
    if (validateExternalUrl(url).ok) void shell.openExternal(url).catch(() => {})
  }
  contents.on('will-navigate', (event, url) => {
    if (isTrustedAppUrl(url, trustedRendererUrl())) return
    event.preventDefault()
    external(url)
  })
  contents.on('will-redirect', (event, url) => {
    if (!isTrustedAppUrl(url, trustedRendererUrl())) event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' } })
}
