import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'

if (process.versions.electron) {
  const { app } = await import('electron')
  app.setPath('userData', path.resolve('node_modules/.cache/package-verification'))
  app.whenReady().then(() => {
    try {
      const require = createRequire(path.join(process.env.VERIFY_APP_ASAR, 'package.json'))
      for (const name of ['electron-updater', 'keytar', '@supabase/supabase-js', 'semver', '@modelcontextprotocol/sdk/server/mcp.js']) require(name)
      console.log('Packaged runtime dependencies loaded, including native keytar and MCP SDK')
      app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
  })
} else {
  const fs = await import('node:fs/promises')
  const { spawn } = await import('node:child_process')
  const { build, Platform, Arch } = await import('electron-builder')
  const { listPackage, extractFile, statFile } = await import('@electron/asar')
  const { default: electron } = await import('electron')
  const output = path.resolve('dist/package-verification')
  const run = async (command, args, env) => {
    const child = spawn(command, args, { env, stdio: 'inherit' })
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) })
    assert.equal(code, 0, `${command} failed`)
  }
  const env = { ...process.env, SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_ANON_KEY: 'sb_publishable_synthetic_packaging_only', CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
  await run('npm', ['run', 'build'], env)
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  await build({
    targets: Platform.MAC.createTarget(['dir'], Arch[process.arch]),
    publish: 'never',
    config: {
      extends: path.resolve('electron-builder.yml'),
      directories: { output },
      electronDist: path.resolve('node_modules/electron/dist'),
      forceCodeSigning: false,
      mac: { identity: null, notarize: false }
    }
  })
  const platformOutput = path.join(output, process.arch === 'arm64' ? 'mac-arm64' : 'mac')
  const app = (await fs.readdir(platformOutput)).find((name) => name.endsWith('.app'))
  assert.ok(app, 'No test app was produced')
  const resources = path.join(platformOutput, app, 'Contents/Resources')
  const archive = path.join(resources, 'app.asar')
  const entries = listPackage(archive).map((name) => name.replace(/^\//, ''))
  for (const entry of entries) {
    assert.ok(entry === 'package.json' || entry === 'out' || entry.startsWith('out/main/') || entry === 'out/main' ||
      entry.startsWith('out/preload/') || entry === 'out/preload' || entry.startsWith('out/renderer/') || entry === 'out/renderer' ||
      entry === 'node_modules' || entry.startsWith('node_modules/'), `Workspace file packaged: ${entry}`)
  }
  const metadata = JSON.parse(extractFile(archive, 'package.json').toString())
  for (const name of [metadata.main.replace(/^\.\//, ''), 'out/preload/index.js', 'out/renderer/index.html']) {
    assert.ok(extractFile(archive, name).length > 0, `Missing runtime entrypoint: ${name}`)
  }
  assert.ok(entries.some((name) => name.startsWith('out/renderer/assets/') && name.endsWith('.js')), 'Missing renderer JavaScript')
  assert.ok(entries.some((name) => name.startsWith('out/renderer/assets/') && name.endsWith('.css')), 'Missing renderer styles')
  const original = JSON.parse(await fs.readFile('package.json', 'utf8'))
  for (const name of Object.keys(original.dependencies)) {
    const packaged = JSON.parse(extractFile(archive, `node_modules/${name}/package.json`).toString())
    assert.equal(packaged.name, name, `Missing production dependency: ${name}`)
  }
  const native = entries.filter((name) => name.endsWith('.node'))
  assert.ok(native.length > 0, 'Missing native runtime modules')
  for (const name of native) {
    assert.ok(statFile(archive, name).unpacked, `Native module was not unpacked: ${name}`)
    assert.ok((await fs.stat(path.join(`${archive}.unpacked`, name))).size > 0, `Missing native module bytes: ${name}`)
  }
  for (const name of ['icon.png', 'iconTemplate.png', 'iconTemplate@2x.png', 'CHANGELOG.md']) {
    assert.deepEqual(await fs.readFile(path.join(resources, name)), await fs.readFile(name === 'CHANGELOG.md' ? name : path.join('resources', name)), `Missing or changed bundled resource: ${name}`)
  }
  delete env.ELECTRON_RUN_AS_NODE
  env.VERIFY_APP_ASAR = archive
  await run(electron, [path.resolve('scripts/verify-package-contents.mjs')], env)
  console.log(`Package contents passed: ${entries.length} ASAR entries, ${Object.keys(original.dependencies).length} production dependencies, ${native.length} native modules, compiled entrypoints, renderer assets, icons and changelog; workspace material excluded`)
}
