/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const esbuild = require('esbuild');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const source = path.resolve(__dirname, '..');
const noop = () => {};
const settle = () => new Promise(setImmediate);
function textOf(file, ref) {
  return ref ? cp.execFileSync('git', ['show', `${ref}:${file}`], { cwd: source, encoding: 'utf8' }) : fs.readFileSync(path.join(source, file), 'utf8');
}
async function compilation(ref) {
  const app = ts.createSourceFile('App.tsx', textOf('src/renderer/src/App.tsx', ref), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect, startupEffect;
  function walk(node) {
    if (ts.isCallExpression(node) && node.expression.getText(app) === 'useEffect' && node.arguments[0]?.getText(app).includes('realtimeEffectRunCount.current += 1')) effect = node.arguments[0].getText(app);
    if (ts.isCallExpression(node) && node.expression.getText(app) === 'useEffect' && node.arguments[1]?.getText(app).includes('startupUserId')) startupEffect = node.arguments[0].getText(app);
    ts.forEachChild(node, walk);
  }
  walk(app);
  if (!effect || !startupEffect) throw Error('App sync effect unavailable');
  const entry = `
    import { DatabaseSync } from 'node:sqlite';
    import { migrations } from '../../main/database/migrations';
    import { createRepositories } from '../../main/repositories';
    import * as personal from './services/PersonalSyncService';
    import * as shared from './services/SyncService';
    import * as user from './services/UserChannelService';
    import { captureSyncContext } from './services/syncContext';
    import { isSuspended } from './services/powerState';
    import { useAuthStore } from './shared/stores/authStore';
    import { useSyncStore } from './shared/stores/syncStore';
    import { useProjectStore } from './shared/stores/projectStore';
    import { useTaskStore } from './shared/stores/taskStore';
    import { useLabelStore } from './shared/stores/labelStore';
    import { useStatusStore } from './shared/stores/statusStore';
    import { useSavedViewStore } from './shared/stores/savedViewStore';
    import { useTimerStore } from './shared/stores/timerStore';
    import { useViewStore } from './shared/stores/viewStore';
    import * as refresh from './services/remoteProjectRefresh';
    import { useSettingsStore } from './shared/stores/settingsStore';
    import { logEvent } from './shared/stores/logStore';
    const db=new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON;CREATE TABLE schema_version(version INTEGER PRIMARY KEY)');
    for(const migrate of migrations)migrate(db);
    const repo=createRepositories(db);
    const realtimeEffectRunCount={current:0},currentProjectRef={current:null};
    function runEffect(){const userId=useAuthStore.getState().currentUser?.id,isOffline=false;return (${effect})();}
    function runStartup(){const startupUserId=useAuthStore.getState().currentUser?.id,isAuthenticated=!!startupUserId,isOffline=false;return (${startupEffect})();}
    globalThis.fixture={personal,shared,user,refresh,captureSyncContext,repo,db,runEffect,runStartup,
      stores:{useAuthStore,useSyncStore,useProjectStore,useTaskStore,useLabelStore,useStatusStore,useSavedViewStore,useSettingsStore,useTimerStore,useViewStore}};`;
  const result = await esbuild.build({ stdin: { contents: entry, resolveDir: path.join(source, 'src/renderer/src'), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
    plugins: [{name:'isolated-runtime',setup(build){
      build.onResolve({filter:/^@supabase\/supabase-js$/},()=>({path:'sdk',namespace:'fixture'}));
      build.onResolve({filter:/^\./},args=>{
        const file=path.resolve(args.resolveDir,args.path);
        if(file.endsWith('/lib/supabase'))return {path:'supabase',namespace:'fixture'};
        if(file.endsWith('/services/sessionRecovery')||file.endsWith('/services/powerState'))return {path:path.basename(file),namespace:'fixture'};
      });
      build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='sdk'
        ? 'export const createClient=(url,key,options={})=>globalThis.runtime.sdk.createClient(url,key,{...options,global:{...options.global,fetch:options.global?.fetch??globalThis.runtime.transport}});'
        : args.path==='supabase'
        ? 'export const getSupabase=()=>globalThis.runtime.getSupabase();export const safeRefresh=()=>globalThis.runtime.requireSession();export const parseAuthTokensFromUrl=()=>null;'
        : args.path==='powerState'
        ? 'export const isSuspended=()=>globalThis.runtime.isSuspended();export const initPowerListener=()=>{};'
        : 'export const requireSession=()=>globalThis.runtime.requireSession();export const tryRestoreSession=async()=>null;export const startRecoveryTimer=()=>{};export const stopRecoveryTimer=()=>{};export const resetPermanentlyDeadFlag=()=>{};export const isPermanentlyDead=()=>false;',loader:'js'}));
      build.onLoad({filter:/\.tsx?$/},args=>{
        if(!args.path.startsWith(source+path.sep)||args.path.includes('/node_modules/'))return;
        return {contents:textOf(path.relative(source,args.path),ref),loader:args.path.endsWith('.tsx')?'tsx':'ts'};
      });
    }}] });
  return result.outputFiles[0].text;
}

function split(value) {
  let depth=0,quoted=false,start=0;const parts=[];
  for(let i=0;i<value.length;i++){if(value[i]==='"')quoted=!quoted;if(quoted)continue;if(value[i]==='(')depth++;if(value[i]===')')depth--;if(value[i]===','&&!depth){parts.push(value.slice(start,i));start=i+1}}
  return [...parts,value.slice(start)];
}
function predicate(row,key,expression) {
  const dot=expression.indexOf('.'),op=expression.slice(0,dot),raw=expression.slice(dot+1);
  let value;try{value=JSON.parse(raw)}catch{value=raw}
  if(op==='in')return split(raw.slice(1,-1)).map(x=>x.replace(/^"|"$/g,'')).includes(String(row[key]));
  if(op==='is')return (row[key]??null)===value;
  if(op==='gt')return String(row[key])>String(value);
  if(op==='lte')return String(row[key])<=String(value);
  if(op==='eq')return row[key]===value;
  throw Error(`Unsupported fixture filter ${op}`);
}
function expression(row,value) {
  if(value.startsWith('and('))return split(value.slice(4,-1)).every(x=>expression(row,x));
  const dot=value.indexOf('.');return predicate(row,value.slice(0,dot),value.slice(dot+1));
}
async function makeHarness({ref=process.env.TODOOZY_BENCH_REF??null,connected=true,projectCount=20,archived=0,shared=0,latency=0}={}) {
  const requests=[],channels=[],logs=[],fixtureErrors=[],intervals=new Map(),timers=new Map();
  const remote={projects:[],project_members:[],tasks:[],statuses:[],user_labels:[],user_settings:[],user_themes:[],user_saved_views:[],user_project_areas:[],project_templates:[],project_labels:[],task_labels:[],activity_log:[]};
  let nextId=1,active=0,maxConcurrent=0,suspended=false,disposed=false,generation=1,beforeRequest=null;
  const runtime={sdk:{createClient}};
  const transport=async(url,options={})=>{
    const parsed=new URL(url);if(parsed.hostname!=='127.0.0.1')throw Error('External fixture request blocked');
    if(disposed)throw Error('Fixture closed');
    active++;maxConcurrent=Math.max(maxConcurrent,active);
    const table=parsed.pathname.split('/').pop(),method=options.method??'GET',start=performance.now();
    try {
      if(beforeRequest){const callback=beforeRequest;beforeRequest=null;await callback()}
      if(latency)await new Promise(resolve=>setTimeout(resolve,latency));
      const body=options.body?JSON.parse(options.body):null;
      const record={url:String(url),body,table,method,requestBytes:Buffer.byteLength(String(url))+Buffer.byteLength(options.body??''),responseBytes:0,transportMs:performance.now()-start};requests.push(record);
      const finish=(data,status=200)=>{const json=JSON.stringify(data);record.responseBytes+=Buffer.byteLength(json);return new Response(method==='HEAD'?null:json,{status,headers:{'Content-Type':'application/json','Content-Range':`0-${Math.max(0,data?.length-1)}/${Array.isArray(data)?data.length:1}`}})};
      if(parsed.pathname.includes('/rpc/')) {
        if(table==='share_project') {
          const row=remote.projects.find(row=>row.id===body.p_id);
          if(!row){remote.projects.push({id:body.p_id,owner_id:body.p_owner_id??'u',name:body.p_name,updated_at:new Date().toISOString()});remote.project_members.push({project_id:body.p_id,user_id:body.p_owner_id??'u',role:'owner'})}
        }
        return finish([]);
      }
      const rows=remote[table]??=[];
      const selected=rows.filter(row=>[...parsed.searchParams].every(([key,value])=>['select','order','limit','offset','on_conflict','columns'].includes(key)||key==='or'?key!=='or'||split(value.slice(1,-1)).some(x=>expression(row,x)):predicate(row,key,value)));
      if(method==='POST') {
        for(const row of Array.isArray(body)?body:[body]){
          if(table==='tasks'&&row.parent_id&&!remote.tasks.some(parent=>parent.id===row.parent_id))return finish({message:'Parent missing',code:'23503'},409);
          const keys=table==='task_labels'?['task_id','label_id']:table==='project_labels'?['project_id','label_id']:['id'];
          const existing=rows.find(item=>keys.every(key=>item[key]===row[key]));
          if(existing)Object.assign(existing,row);else rows.push({...row});
        }
        return finish([]);
      }
      if(method==='PATCH'){for(const row of selected)Object.assign(row,body);return finish([])}
      if(method==='DELETE'){remote[table]=rows.filter(row=>!selected.includes(row));return finish([])}
      const order=(parsed.searchParams.get('order')??'').split(',').filter(Boolean);
      let result=[...selected].sort((a,b)=>{for(const item of order){const [key,direction]=item.split('.');if(a[key]!==b[key])return (String(a[key])<String(b[key])?-1:1)*(direction==='desc'?-1:1)}return 0}).slice(0,Number(parsed.searchParams.get('limit')??1000));
      const columns=parsed.searchParams.get('select')??'*';
      if(columns!=='*')result=result.map(row=>Object.fromEntries(columns.split(',').map(key=>[key,row[key]])));
      const accept=new Headers(options.headers).get('accept')??'';
      return finish(accept.includes('vnd.pgrst.object')?(result[0]??null):result);
    } finally {active--}
  };
  runtime.transport=transport;
  const rest=createClient('http://127.0.0.1:9999','synthetic-public-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:transport}});
  runtime.client={from:(...args)=>rest.from(...args),rpc:(...args)=>rest.rpc(...args),auth:{getSession:async()=>({data:{session:{user:{id:'u'},access_token:'synthetic'}}})},channel(topic){
    const channel={topic,state:'joining',closed:false,bindings:[],on(_kind,filter,callback){this.bindings.push({filter,callback});return this},subscribe(callback){this.status=status=>{if(status==='SUBSCRIBED')this.state='joined';callback(status)};channels.push(this);if(connected)queueMicrotask(()=>{if(!this.closed)this.status('SUBSCRIBED')});return this},emit(table,eventType='UPDATE',row={}){for(const binding of this.bindings)if(binding.filter.table===table)binding.callback({eventType,new:row,old:row})}};
    return channel;
  },removeChannel:async(channel)=>{channel.closed=true;channel.state='closed';return 'ok'}};
  const code=await compilation(ref);
  const sandbox={module:{exports:{}},exports:{},require,console:{log:noop,warn:noop,error:(...args)=>logs.push(args)},process,Buffer,queueMicrotask,crypto:require('node:crypto').webcrypto,URL,Headers,Request,Response,AbortController,TextEncoder,TextDecoder,performance,Date,Map,Set,Promise,fetch:transport,navigator:{onLine:true},localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},runtime,
    setInterval:(fn,ms)=>{const id=nextId++;intervals.set(id,{fn,ms});return id},clearInterval:id=>intervals.delete(id),setTimeout:(fn,ms)=>{const id=nextId++;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id)};
  runtime.getSupabase=async()=>runtime.client;runtime.requireSession=async()=>({user:{id:sandbox.fixture?.stores.useAuthStore.getState().currentUser?.id??'u'},access_token:'synthetic'});runtime.isSuspended=()=>suspended;
  vm.createContext(sandbox);
  vm.runInContext(code,sandbox);
  const fixture=sandbox.fixture,{repo,stores}=fixture;
  const nativeCalls=[];
  const api=new Proxy({}, {get:(_,namespace)=>new Proxy({}, {get:(_,method)=>async(...args)=>{
    if(namespace!=='sync')nativeCalls.push({namespace,method,args});
    if(namespace==='app'&&method==='getChangelog')return '# Synthetic changelog';
    if(namespace==='releaseNotes'&&method==='sync')return {ok:true,count:0,cached:true};
    if(namespace==='auth'&&method==='getSupabaseConfig')return Promise.resolve({url:'http://127.0.0.1:9999',anonKey:'synthetic-public-key'});
    if(namespace==='sync'){
      if(method==='captureContext')return Promise.resolve({userId:stores.useAuthStore.getState().currentUser?.id??null,generation});
      if(method==='invokeContext'){const [origin,channel,values]=args;if(origin.generation!==generation||origin.userId!==stores.useAuthStore.getState().currentUser?.id)return Promise.reject(Error('Database changed'));const [ns,op]=channel.split(':');return Promise.resolve(api[ns][op](...values))}
      const mapped={getQueue:'findAll',count:'count',enqueue:'enqueue',dequeue:'dequeue',updatePayload:'updatePayload'}[method];if(mapped)return Promise.resolve(repo.syncQueue[mapped](...args));
    }
    if(['timer','tray','log','power'].includes(namespace))return method.startsWith('on')?noop:Promise.resolve();
    const op=namespace==='tasks'?({applyRemote:'applyRemoteTask',completeRecurring:'completeRecurringTask'}[method]??method):namespace==='labels'&&method==='findAll'?'findAllForUser':namespace==='savedViews'&&method==='countMatching'?'countMatchingTasks':method;
    if(!repo[namespace]?.[op]){const message=`Unsupported fixture API ${namespace}.${op}`;fixtureErrors.push(message);return Promise.reject(Error(message))}
    return Promise.resolve(repo[namespace][op](...args));
  }})});
  const listeners=new Map();
  sandbox.window={api,addEventListener:(event,callback)=>{const callbacks=listeners.get(event)??new Set();callbacks.add(callback);listeners.set(event,callbacks)},removeEventListener:(event,callback)=>listeners.get(event)?.delete(callback)};
  for(const id of ['u','other'])repo.users.create({id,email:`${id}@example.invalid`,display_name:null,avatar_url:null});
  const projects=[];
  for(let index=0;index<projectCount;index++){
    const id=`p${index}`,isShared=index<shared,owner_id=isShared?'other':'u';
    repo.projects.create({id,owner_id,name:`Synthetic ${index}`});repo.projects.addMember(id,owner_id,'owner');
    if(isShared)repo.projects.addMember(id,'u','member');
    repo.projects.update(id,{is_shared:isShared?1:0,is_archived:index<archived?1:0});
    repo.statuses.create({id:`s${index}`,project_id:id,name:'Open',is_default:1});
    repo.statuses.create({id:`done${index}`,project_id:id,name:'Done',is_done:1});
    projects.push(repo.projects.findById(id));remote.projects.push({...projects.at(-1)});
    remote.project_members.push(...repo.projects.getMembers(id).map(row=>({...row})));
    remote.statuses.push(...repo.statuses.findByProjectId(id).map(row=>({...row})));
  }
  repo.settings.set('u','last_sync_at','2026-01-01T00:00:00Z');
  stores.useAuthStore.setState({currentUser:{id:'u'},isOffline:false});stores.useSettingsStore.getState().setUserId('u');stores.useSyncStore.setState({realtimeConnected:connected});
  await stores.useProjectStore.getState().hydrateProjects('u');
  const untilIdle=async()=>{let quiet=0,last=-1;for(let i=0;i<2000;i++){await settle();if(!active&&requests.length===last)quiet++;else quiet=0;last=requests.length;if(quiet>=10)return;if(latency)await new Promise(resolve=>setTimeout(resolve,latency))}throw Error('Fixture did not settle')};
  return {sandbox,services:fixture,repo,stores,projects,remote,requests,nativeCalls,channels,logs,fixtureErrors,intervals,timers,codeFingerprint:createHash('sha256').update(code).digest('hex'),
    run:()=>fixture.runEffect(),runStartup:()=>fixture.runStartup(),untilIdle,context:()=>fixture.captureSyncContext(),maxConcurrent:()=>maxConcurrent,setSuspended:value=>{suspended=value},setAccount:value=>{generation++;stores.useAuthStore.setState({currentUser:value?{id:value}:null})},
    changeConnected:value=>stores.useSyncStore.getState().setRealtimeConnected(value),beforeRequest:callback=>{beforeRequest=callback},
    runStartupTimers:async()=>{const jobs=[...timers].filter(([,job])=>job.ms===2000);for(const [id,{fn}] of jobs){timers.delete(id);await fn()}await untilIdle()},
    runIntervals:async()=>{for(const {fn}of [...intervals.values()])await fn();await untilIdle()},runTimers:async()=>{const jobs=[...timers.values()];timers.clear();for(const {fn}of jobs)await fn();await untilIdle()},
    stop:async()=>{generation++;stores.useAuthStore.setState({currentUser:null});await untilIdle();await fixture.personal.unsubscribeAllPersonal();await fixture.shared.unsubscribeAll();await fixture.user.unsubscribeUserChannel();fixture.db.close();disposed=true;await rest.auth.stopAutoRefresh()}};
}
async function trafficScenario(options={}) {
  const harness=await makeHarness(options);const start=performance.now();const cleanup=await harness.run();const startupCleanup=options.fullStartup?harness.runStartup():null;await harness.untilIdle();if(options.fullStartup)await harness.runStartupTimers();
  const initialRequests=harness.requests.length,initialMs=performance.now()-start;
  if((options.projectCount??20)>0&&!initialRequests)throw Error('Benchmark did not exercise the SDK transport');
  for(let i=0;i<(options.flaps??0);i++){for(const channel of [...harness.channels].filter(channel=>!channel.closed))channel.status('SUBSCRIBED');harness.changeConnected(false);harness.changeConnected(true)}
  await harness.untilIdle();const beforeTimer=harness.requests.length,activeFallbackIntervals=harness.intervals.size;
  await harness.runIntervals();
  assert.equal(harness.fixtureErrors.length,0,JSON.stringify(harness.fixtureErrors));
  const summarize=rows=>({requests:rows.length,requestUrlAndBodyBytes:rows.reduce((sum,row)=>sum+row.requestBytes,0),responseBytes:rows.reduce((sum,row)=>sum+row.responseBytes,0),requestsByTable:rows.reduce((counts,row)=>(counts[`${row.method} ${row.table}`]=(counts[`${row.method} ${row.table}`]??0)+1,counts),{})});
  const result={ref:options.ref??'working tree',fullStartup:!!options.fullStartup,startupComparisonValid:!!options.fullStartup,projects:options.projectCount??20,archived:options.archived??0,initialRequests,initialMs,requestsBeforeTimer:beforeTimer,timerRequests:harness.requests.length-beforeTimer,activeFallbackIntervals,maxConcurrentRequests:harness.maxConcurrent(),requestsByTable:harness.requests.reduce((counts,row)=>(counts[row.table]=(counts[row.table]??0)+1,counts),{}),requestUrlAndBodyBytes:harness.requests.reduce((sum,row)=>sum+row.requestBytes,0),responseBytes:harness.requests.reduce((sum,row)=>sum+row.responseBytes,0),phaseTraffic:{initial:summarize(harness.requests.slice(0,initialRequests)),recovery:summarize(harness.requests.slice(initialRequests,beforeTimer)),fallbackTimer:summarize(harness.requests.slice(beforeTimer))},transport:'Actual App effects, repositories, sync modules and SDK; synthetic fetch',physicalDiskIoMeasured:false,codeFingerprint:harness.codeFingerprint};
  startupCleanup?.();cleanup();await harness.untilIdle();await harness.stop();return result;
}
async function eventScenario(options={}) {
  const harness=await makeHarness({...options,shared:options.shared?(options.projectCount??20):0});
  let cleanup,startupCleanup;
  try {
    const task=harness.repo.tasks.create({id:'event-task',project_id:'p0',owner_id:options.shared?'other':'u',status_id:'s0',title:'Before event'});
    harness.repo.tasks.applyRemoteTask({...task,created_at:'2026-01-02T00:00:00.000Z',updated_at:'2026-01-02T00:00:00.000Z'});
    harness.remote.tasks.push({...harness.repo.tasks.findById(task.id)});
    cleanup=await harness.run();startupCleanup=harness.runStartup();
    await harness.untilIdle();await harness.runStartupTimers();
    if(harness.logs.length||harness.fixtureErrors.length)throw Error(`Startup fixture errors: ${JSON.stringify([...harness.logs,...harness.fixtureErrors])}`);
    harness.requests.length=0;
    const db=harness.services.db;
    db.exec('CREATE TEMP TABLE event_local_writes(table_name TEXT,verb TEXT)');
    for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
      for(const verb of ['INSERT','UPDATE','DELETE'])db.exec(`CREATE TEMP TRIGGER event_${name}_${verb} AFTER ${verb} ON main."${name}" BEGIN INSERT INTO event_local_writes VALUES('${name}','${verb}');END`);
    }
    const channel=[...harness.channels].reverse().find(row=>!row.closed&&row.topic===`${options.shared?'project':'personal'}:p0`);
    assert(channel,'Runtime project channel exists after both real App startup effects');
    const changed={...harness.remote.tasks[0],title:'After event',updated_at:'2030-01-01T00:00:00.000Z'};
    Object.assign(harness.remote.tasks[0],changed);
    const start=performance.now();
    channel.emit('tasks','UPDATE',changed);await harness.runTimers();await harness.untilIdle();
    const elapsedMs=performance.now()-start,requests=[...harness.requests];
    await harness.runTimers();await harness.untilIdle();
    assert.equal(harness.repo.tasks.findById(task.id)?.title,'After event');
    return {ref:options.ref??'working tree',shared:!!options.shared,projects:options.projectCount??20,requests:requests.length,elapsedMs,
      extraNextTimerRequests:harness.requests.length-requests.length,
      requestsByTable:requests.reduce((counts,row)=>{const key=`${row.method} ${row.table}`;counts[key]=(counts[key]??0)+1;return counts},{}),
      remoteWrites:requests.filter(row=>!['GET','HEAD'].includes(row.method)).length,
      localWrites:db.prepare('SELECT table_name,verb,count(*) AS count FROM event_local_writes GROUP BY table_name,verb ORDER BY table_name,verb').all(),
      requestUrlAndBodyBytes:requests.reduce((sum,row)=>sum+row.requestBytes,0),responseBytes:requests.reduce((sum,row)=>sum+row.responseBytes,0),
      codeFingerprint:harness.codeFingerprint,physicalDiskIoMeasured:false};
  } finally {startupCleanup?.();cleanup?.();await harness.stop()}
}
async function behaviorScenarios(){
  const results=[];const check=async(name,run)=>{try{await run();results.push({name,passed:true})}catch(error){results.push({name,passed:false,error:String(error)})}};
  await check('suspended/offline catch-up is deferred until resume',async()=>{const h=await makeHarness({projectCount:1});try{const context=await h.context();h.setSuspended(true);await h.services.personal.requestSyncCatchUp(context);assert.equal(h.requests.length,0);h.setSuspended(false);h.sandbox.navigator.onLine=false;await h.services.personal.requestSyncCatchUp(context);assert.equal(h.requests.length,0);h.sandbox.navigator.onLine=true;await h.services.personal.requestSyncCatchUp(context);assert(h.requests.length>0)}finally{await h.stop()}});
  await check('real App and channel recovery share a serialized sweep',async()=>{const h=await makeHarness({projectCount:2});let cleanup;try{cleanup=await h.run();await h.untilIdle();for(const channel of h.channels)channel.status('SUBSCRIBED');h.changeConnected(false);h.changeConnected(true);await h.untilIdle();assert.equal(h.maxConcurrent(),1)}finally{cleanup?.();await h.stop()}});
  await check('closed personal metadata callback cannot restart work or resubscribe',async()=>{const h=await makeHarness({projectCount:1,archived:1});try{await h.services.user.subscribeToUserChannel('u');await h.services.personal.requestSyncCatchUp(await h.context());await h.untilIdle();const old=h.channels.find(row=>row.topic==='personal:p0'&&!row.closed);assert(old);await h.services.personal.unsubscribePersonalProject('p0');h.requests.length=0;old.emit('projects','UPDATE',{...h.remote.projects[0]});await h.runTimers();await h.untilIdle();assert.equal(h.requests.length,0);assert.equal(h.channels.filter(row=>row.topic==='personal:p0'&&!row.closed).length,0)}finally{await h.stop()}});
  await check('change after an active sweep read is retained by a serialized pending follow-up',async()=>{
    const h=await makeHarness({projectCount:1});let cleanup;
    try {
      cleanup=await h.run();await h.untilIdle();
      const task=h.repo.tasks.create({id:'in-sweep-task',project_id:'p0',owner_id:'u',status_id:'s0',title:'Before sweep'});
      h.repo.tasks.hardDelete(task.id);
      h.remote.tasks.push({...task,updated_at:'2030-01-01T00:00:00.000Z'});
      let entered,release,paused=false;const started=new Promise(resolve=>{entered=resolve}),resume=new Promise(resolve=>{release=resolve});
      const apply=h.repo.tasks.applyRemoteTask.bind(h.repo.tasks);
      h.repo.tasks.applyRemoteTask=input=>{const value=apply(input);if(input.id===task.id&&!paused){paused=true;entered();return resume.then(()=>value)}return value};
      const context=await h.context(),first=h.services.personal.requestSyncCatchUp(context);
      await started;
      Object.assign(h.remote.tasks[0],{title:'Changed during sweep',updated_at:'2030-01-02T00:00:00.000Z'});
      const follow=h.services.personal.requestProjectRefresh(context,['p0']);
      for(let i=0;i<5;i++)await settle();
      release();await Promise.all([first,follow]);await h.untilIdle();
      assert.equal(h.repo.tasks.findById(task.id)?.title,'Changed during sweep');assert.equal(h.maxConcurrent(),1);
    } finally {cleanup?.();await h.stop()}
  });
  return results;
}
async function run({baseline=null,output=null,repetitions=7}={}){
  const before=[],after=[];for(const options of [{connected:true,fullStartup:true},{connected:false,flaps:3,fullStartup:true},{connected:true,archived:4,fullStartup:true},{connected:false,fullStartup:true}]){if(baseline)before.push(await trafficScenario({...options,ref:baseline}));after.push(await trafficScenario(options))}
  const events={before:[],after:[],method:'One identical changed remote task on p0 among20 projects, delivered through its actual active project channel after both real App startup effects. Synthetic fetch; archived projects excluded from this event cohort.'};
  for(const shared of [true,false]){if(baseline)events.before.push(await eventScenario({ref:baseline,shared}));events.after.push(await eventScenario({shared}))}
  const timings={before:[],after:[],method:'Paired real App realtime and separate startup effects with isolated SQLite and a fixed1ms synthetic SDK transport. Includes legacy shared startup/init/reconcile, excludes the intentional2000ms startup timer wait, cloud disk throughput and non-Supabase release-note traffic.'};
  for(let i=0;i<repetitions;i++)for(const phase of baseline?['before','after']:['after'])timings[phase].push((await trafficScenario({ref:phase==='before'?baseline:null,latency:1,fullStartup:true})).initialMs);
  const eventTimings={shared:{before:[],after:[]},personal:{before:[],after:[]},method:'Paired one-task event completion with fixed1ms synthetic transport latency; each sample uses fresh isolated native SQLite and real App effects/services/SDK. No cloud throughput or physical disk I/O measured.'};
  for(let i=0;i<repetitions;i++)for(const shared of [true,false])for(const phase of baseline?['before','after']:['after'])eventTimings[shared?'shared':'personal'][phase].push((await eventScenario({ref:phase==='before'?baseline:null,latency:1,shared})).elapsedMs);
  const quantiles=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?{samples:sorted.length,p50Ms:sorted[Math.ceil(sorted.length*0.5)-1],p95Ms:sorted[Math.ceil(sorted.length*0.95)-1]}:null};
  timings.summary={before:quantiles(timings.before),after:quantiles(timings.after)};
  for(const scope of ['shared','personal'])eventTimings[scope].summary={before:quantiles(eventTimings[scope].before),after:quantiles(eventTimings[scope].after)};
  const result={capturedAt:new Date().toISOString(),beforeRef:baseline,afterRef:'working tree',before,after,events,timings,eventTimings,cases:await behaviorScenarios()};if(output)fs.writeFileSync(output,JSON.stringify(result,null,2));return result;
}
module.exports={makeHarness,trafficScenario,eventScenario,behaviorScenarios,run};
if(require.main===module){const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]};run({baseline:value('--baseline'),output:value('--output')}).then(result=>{console.log(JSON.stringify(result,null,2));if(result.cases.some(row=>!row.passed))process.exitCode=1}).catch(error=>{console.error(error);process.exitCode=1})}
