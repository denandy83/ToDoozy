const path = require('node:path');
const fs = require('node:fs');
const cp = require('node:child_process');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
async function nativeUiFixture() {
  const runtime = { handlers: new Map(), windows: [], title: '', menu: [], session: null, files: new Map(), userId: null, contexts: new Set(), scope: null, held: null, messages: [], ready: 0 };
  class Contents extends EventEmitter {
    send(channel, context) {
      runtime.messages.push([channel, context]);
      if (channel === 'sync:context-changed') {
        runtime.scope = JSON.stringify([context.userId, context.generation]);
        for (const listener of runtime.contexts) listener();
      }
    }
    setWindowOpenHandler() {}
  }
  class Window extends EventEmitter {
    constructor() { super(); this.webContents = new Contents(); this.destroyed = false; this.shown = 0; runtime.windows.push(this); }
    static getAllWindows() { return runtime.windows.filter(win => !win.destroyed); }
    isDestroyed() { return this.destroyed; }
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('closed'); } }
    show() { this.shown++; }
    focus() {}
    hide() {}
    loadFile() {}
    loadURL() {}
    getSize() { return [500, 300]; }
    setPosition() {}
  }
  const ipcMain = new EventEmitter();
  ipcMain.handle = (channel, listener) => runtime.handlers.set(channel, listener);
  runtime.mainWindow = new Window();
  runtime.electron = {
    ipcMain, BrowserWindow: Window,
    Tray: class extends EventEmitter {
      constructor() { super(); runtime.tray = this; }
      setTitle(value) { runtime.title = value; }
      setToolTip(value) { runtime.tooltip = value; }
      closeContextMenu() { runtime.menu = []; }
      popUpContextMenu(menu) { runtime.menu = menu; }
      destroy() {}
    },
    Menu: { buildFromTemplate: rows => rows },
    nativeImage: { createFromPath: () => ({ setTemplateImage() {} }) },
    app: { isPackaged: false, getPath: () => '/synthetic-unused', getVersion: () => 'synthetic', quit() {} },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() },
    dialog: {}, shell: { openExternal: async () => {} },
    screen: { getCursorScreenPoint: () => ({x:0,y:0}), getDisplayNearestPoint: () => ({workArea:{x:0,y:0,width:1000,height:800}}) }
  };
  const entry = `
    import { DatabaseSync } from 'node:sqlite';
    import { migrations } from './src/main/database/migrations';
    import { createRepositories } from './src/main/repositories';
    import { registerIpcHandlers } from './src/main/ipc-handlers';
    import * as tray from './src/main/tray';
    import * as quick from './src/main/quick-add';
    import { trustedRendererUrl } from './src/main/navigation-security';
    import { useTimerStore, resetTimerForAccount } from './src/renderer/src/shared/stores/timerStore';
    import QuickAddApp from './src/renderer/src/QuickAddApp';
    const databases = new Map(), repositories = new Map();
    for (const user of ['a','b']) {
      const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON;CREATE TABLE schema_version(version INTEGER PRIMARY KEY)');
      for (const migration of migrations) migration(db);
      const repo = createRepositories(db, user);
      repo.users.create({id:user,email:user+'@example.invalid',display_name:null,avatar_url:null});
      repo.projects.create({id:'p-'+user,owner_id:user,name:'PRIVATE PROJECT '+user,is_default:1});
      repo.statuses.create({id:'s-'+user,project_id:'p-'+user,name:'OPEN',is_default:1});
      repo.tasks.create({id:'t-'+user,owner_id:user,project_id:'p-'+user,status_id:'s-'+user,title:'PRIVATE TASK '+user+' '.repeat(2)+'long title '.repeat(10),is_in_my_day:1});
      databases.set(user,db);repositories.set(user,repo);
    }
    globalThis.runtime.databases=databases;globalThis.runtime.db=databases.get('a');
    registerIpcHandlers();tray.createTray();
    module.exports={tray,quick,useTimerStore,resetTimerForAccount,QuickAddApp,repositories,databases,trustedRendererUrl};`;
  const result = await esbuild.build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', logLevel: 'silent', plugins: [{name:'native-fixture',setup(build) {
    build.onLoad({filter:/\.[cm]?[jt]sx?$/}, args => {
      const rel=path.relative(root,args.path).replaceAll(path.sep,'/');
      let contents;
      if (rel==='src/main/index.ts') contents='export const getMainWindow=()=>globalThis.runtime.mainWindow;export const registerQuickAddShortcut=()=>({success:true});export const registerAppToggleShortcut=()=>({success:true});';
      else if (rel==='src/main/database/index.ts') contents='export const getDatabase=()=>globalThis.runtime.db;export const switchDatabase=(id)=>{globalThis.runtime.userId=id;return globalThis.runtime.db=globalThis.runtime.databases.get(id)};export const clearDatabaseUserId=()=>{globalThis.runtime.userId=null};export const getDatabaseUserId=()=>globalThis.runtime.userId;export const getDatabasePath=()=>null;';
      else if (rel==='src/main/priority-icons.ts') contents='export const getPriorityDotIcon=()=>null;';
      else contents=process.env.REVIEW_BASE_REF ? cp.execFileSync('git',['show',process.env.REVIEW_BASE_REF+':'+rel],{cwd:root,encoding:'utf8'}) : fs.readFileSync(args.path,'utf8');
      return {contents,loader:args.path.endsWith('tsx')?'tsx':'ts'};
    });
  }}] });
  const localRequire = name => {
    if (name==='electron') return runtime.electron;
    if (name==='@electron-toolkit/utils') return {is:{dev:false}};
    if (name==='keytar') return {default:{}};
    if (name==='fs') return {existsSync: name => runtime.files.has(name), readFileSync: name => runtime.files.get(name), writeFileSync: (name,value) => runtime.files.set(name,value), unlinkSync: name => runtime.files.delete(name)};
    return require(name);
  };
  const sandbox = {runtime,module:{exports:{}},exports:{},require:localRequire,__dirname:path.join(root,'src/main'),process,Buffer,console,URL,setTimeout,clearTimeout,setInterval,clearInterval,crypto:require('node:crypto').webcrypto,atob,navigator:{onLine:false},window:null,document:globalThis.document};
  vm.runInNewContext(result.outputFiles[0].text,sandbox);
  const services=sandbox.module.exports;
  const event = (sender=runtime.mainWindow.webContents, frame={parent:null,url:services.trustedRendererUrl()}) => ({sender,senderFrame:frame});
  const invoke = (channel,...args) => runtime.handlers.get(channel)(event(),...args);
  const switchTo = user => { invoke('auth:switchDatabase',user); runtime.session=JSON.stringify({access_token:'synthetic.'+Buffer.from(JSON.stringify({sub:user})).toString('base64')+'.synthetic'});runtime.files.set('/synthetic-unused/.auth-session',Buffer.from(runtime.session)); };
  const clear = () => invoke('auth:clearSession');
  const hold = channel => {
    let release,entered;const wait=new Promise(resolve=>{release=resolve}),entry=new Promise(resolve=>{entered=resolve});
    runtime.held={channel,wait,entered};return {release,entered:entry};
  };
  const apiFor = win => new Proxy({}, {get(_,namespace) {
    if(namespace==='sync') return {
      currentContext:()=>runtime.scope,
      onContextChanged: listener=>{runtime.contexts.add(listener);return ()=>runtime.contexts.delete(listener)},
      captureContext:async()=>invoke('sync:captureContext'),
      invokeContext:async(context,channel,args)=>{
        if(runtime.failChannel===channel) throw new Error('synthetic read failure');
        const result=runtime.handlers.get('sync:invokeContext')(event(win.webContents),context,channel,args);
        if(runtime.held?.channel===channel){const gate=runtime.held;runtime.held=null;gate.entered();await gate.wait}
        return result;
      }
    };
    return new Proxy({}, {get(_,method){return async(...args)=>{
      const channel=namespace+':'+method;
      if(channel==='quickadd:signalReady'){runtime.ready++;ipcMain.emit('quickadd:ready',event(win.webContents));return}
      if(channel==='timer:minimizeToTray'||channel==='timer:navigateToTask') args.push(runtime.scope);
      const result=runtime.handlers.get(channel)(event(win.webContents),...args);
      if(runtime.held?.channel===channel){const gate=runtime.held;runtime.held=null;gate.entered();await gate.wait}
      return result;
    }}});
  }});
  const menu = async () => { runtime.tray.emit('click');await new Promise(resolve=>setTimeout(resolve,170));return runtime.menu; };
  const stop = () => {services.resetTimerForAccount();services.quick.hideQuickAddWindow();services.tray.destroyTray();for(const db of services.databases.values())db.close()};
  return {runtime,services,event,invoke,switchTo,clear,hold,apiFor,menu,stop,sandbox};
}
module.exports={nativeUiFixture};
