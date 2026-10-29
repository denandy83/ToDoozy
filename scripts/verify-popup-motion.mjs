import path from 'node:path'

if (process.versions.electron) {
  const { app, BrowserWindow } = await import('electron')
  app.setPath('userData', path.resolve('node_modules/.cache/popup-motion'))
  const timeout = setTimeout(() => { console.error('Popup verification timed out'); app.exit(1) }, 45000)
  app.whenReady().then(async () => {
    try {
      const window = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { backgroundThrottling: false } })
      await window.loadURL(process.env.POPUP_MOTION_URL)
      const result = await window.webContents.executeJavaScript('window.popupMotionResult')
      if (!result) throw new Error('Browser fixture did not start')
      console.log(result)
      clearTimeout(timeout)
      app.exit(0)
    } catch (error) {
      console.error(error)
      clearTimeout(timeout)
      app.exit(1)
    }
  })
} else {
  const { createServer } = await import('vite')
  const { default: react } = await import('@vitejs/plugin-react')
  const { default: tailwindcss } = await import('@tailwindcss/vite')
  const { default: electron } = await import('electron')
  const { spawn } = await import('node:child_process')
  const server = await createServer({
    configFile: false,
    plugins: [react(), tailwindcss(), {
      name: 'popup-motion-fixture',
      configureServer(server) {
        server.middlewares.use('/__popup-motion', async (_request, response) => {
          response.setHeader('Content-Type', 'text/html')
          response.end(await server.transformIndexHtml('/__popup-motion', '<html><body><div id="root"></div><script type="module" src="/scripts/popup-motion.browser.tsx"></script></body></html>'))
        })
      }
    }],
    server: { host: '127.0.0.1', port: 0 }
  })
  try {
    await server.listen()
    const url = `${server.resolvedUrls.local[0]}__popup-motion`
    const env = { ...process.env, POPUP_MOTION_URL: url }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(electron, [path.resolve('scripts/verify-popup-motion.mjs')], { env, stdio: 'inherit' })
    process.exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => resolve(code ?? 1)) })
  } finally {
    await server.close()
  }
}
