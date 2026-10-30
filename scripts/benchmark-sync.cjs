// Execute the real App effect/pull/channel functions; synthetic state/transport only.
// This is a behavioral harness, not a source-string assertion.
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Node CommonJS executable; TypeScript annotations are invalid in .cjs. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const source = path.resolve(__dirname, '..');
const ts = require(source + '/node_modules/typescript');
const esbuild = require(source + '/node_modules/esbuild');
const { createClient } = require(source + '/node_modules/@supabase/supabase-js');
const noop = () => {};
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve }; };
const settle = async (rounds=12) => { for (let i=0; i<rounds; i++) await new Promise(setImmediate) };
function textOf(file, ref) {
  return ref ? cp.execFileSync('git',['show',ref+':'+file],{cwd:source,encoding:'utf8'}) : fs.readFileSync(path.join(source,file),'utf8');
}
function ast(file, ref) {
  return ts.createSourceFile(file,textOf(file,ref),ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
}
function extract(file,names,ref) {
  const parsed=ast(file,ref);
  return names.map(name => {
    const node=parsed.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
    if(!node) throw new Error('Missing executable function '+name);
    return node.getText(parsed).replace(/^export /,'');
  }).join('\n');
}
function compilation(ref) {
  const app=ast('src/renderer/src/App.tsx',ref);
  let effect;
  function walk(n) {
    if(ts.isCallExpression(n)&&n.expression.getText(app)==='useEffect'&&n.arguments[0]?.getText(app).includes('realtimeEffectRunCount.current += 1')) effect=n.arguments[0].getText(app);
    ts.forEachChild(n,walk);
  }
  walk(app);
  if(!effect)throw new Error('App effect unavailable');
  const funcs=extract('src/renderer/src/services/PersonalSyncService.ts',['pullProjectMetadata','pullStatuses','pullNewTasks','createPersonalChannel','subscribeToPersonalProject','unsubscribePersonalProject','unsubscribeAllPersonal'],ref);
  const userUnsub=extract('src/renderer/src/services/UserChannelService.ts',['createUserChannel','subscribeToUserChannel','unsubscribeUserChannel'],ref);
  const shared=extract('src/renderer/src/services/SyncService.ts',['createSharedChannel'],ref);
  const reader=textOf('src/renderer/src/services/readAll.ts',ref).replace(/export /g,'');
  const code=`${reader}\n${funcs}\n${userUnsub}\n${shared}\nasync function runEffect(){return (${effect})();}\nglobalThis.fixture={runEffect,pullNewTasks,subscribeToPersonalProject,unsubscribePersonalProject,unsubscribeAllPersonal,createSharedChannel,subscribeToUserChannel,unsubscribeUserChannel};`;
  return esbuild.transformSync(code,{loader:'ts',format:'cjs',target:'es2022'}).code
    .replace(/import\("\.\/services\/PersonalSyncService"\)/g,'Promise.resolve(__importPersonal)')
    .replace(/import\("\.\/services\/UserChannelService"\)/g,'Promise.resolve(__importUser)');
}
function makeHarness({ref=null,connected=true,projectCount=20,archived=0,latency=0}={}) {
  const requests=[], logs=[], intervals=new Map(), timers=new Map(), channels=[];
  let nextId=1, activePulls=0,activeRequests=0,maxConcurrent=0,account='synthetic-user',suspended=false;
  let sourceClient, getClientOverride=null, subscribeOverride=null;
  const projects=Array.from({length:projectCount},(_,i)=>({id:'synthetic-project-'+i,is_shared:0,is_archived:i<archived?1:0,updated_at:'2026-01-01T00:00:00Z'}));
  const projectMap=new Map(projects.map(p=>[p.id,p]));
  const remoteProjects=new Map();
  const events={projectHydrates:0,userSubscriptions:0,userUnsubscribes:0,personalUnsubscribes:0,changeEvents:[]};
  const localApi={
    projects:{getProjectsForUser:async()=>[...projectMap.values()],findById:async(id)=>projectMap.get(id),applyRemote:async(p)=>{projectMap.set(p.id,p);return p}},
    statuses:{findById:async()=>null},tasks:{findById:async()=>null}
  };
  const rest=createClient('http://127.0.0.1:9999','synthetic-public-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,options)=>{
    const parsed=new URL(url);if(parsed.hostname!=='127.0.0.1')throw new Error('Nonlocal request blocked');
    activeRequests++;
    try {
    let rows=[];
    const table=parsed.pathname.split('/').pop();
    if(table==='projects') { const projectId=parsed.searchParams.get('id')?.slice(3);if(remoteProjects.has(projectId)) rows=[remoteProjects.get(projectId)]; }
    const body=JSON.stringify(rows);
    const start=performance.now();
    if(latency) await new Promise(r=>setTimeout(r,latency));
    requests.push({table,method:options?.method??'GET',requestBytes:Buffer.byteLength(String(url))+Buffer.byteLength(String(options?.body??'')),responseBytes:Buffer.byteLength(body),transportMs:performance.now()-start});
    return new Response(body,{status:200,headers:{'Content-Type':'application/json'}});
    } finally { activeRequests-- }
  }}});
  sourceClient={from:(...a)=>rest.from(...a),channel(topic){
    const channel={topic,state:'joining',bindings:[],closed:false,on(_kind,filter,callback){this.bindings.push({filter,callback});return this},subscribe(callback){this.status=callback;channels.push(this);return this},emit(table,eventType='UPDATE',row={}){for(const b of this.bindings)if(b.filter.table===table)b.callback({eventType,new:row,old:row})}};
    return channel;
  },async removeChannel(ch){ch.closed=true;ch.state='closed';ch.status?.('CLOSED');return 'ok'}};
  const storeModule={exports:{}};
  const storeCode=esbuild.transformSync(textOf('src/renderer/src/shared/stores/syncStore.ts',ref),{loader:'ts',format:'cjs',target:'es2022'}).code;
  vm.runInNewContext(storeCode,{module:storeModule,exports:storeModule.exports,require:createRequire(path.join(source,'package.json')),console,Date,window:{api:localApi}});
  const actualSyncStore=storeModule.exports.useSyncStore;
  actualSyncStore.setState({realtimeConnected:connected});
  const store={getState:()=>({projects:Object.fromEntries(projectMap),hydrateProjects:()=>events.projectHydrates++,hydrateLabels:noop,hydrateAllForProject:noop,hydrateAllTaskLabels:noop,scheduleRecount:noop,bumpActivityRefresh:noop})};
  const personal={cacheProjectNames:noop,resetRefreshGate:noop,subscribeToPersonalProject:async(...args)=>{if(subscribeOverride)return subscribeOverride(...args)},unsubscribeAllPersonal:async()=>{events.personalUnsubscribes++}};
  const context={api:localApi,client:sourceClient,isCurrent:async()=>account==='synthetic-user',assertCurrent(){if(account!=='synthetic-user')throw new Error('Account changed')},scope:'synthetic'};
  const sandbox={
    console:{log:noop,warn:noop,error:noop},URL,Response,Date,Promise,Map,Set,navigator:{onLine:true},window:{api:localApi},
    userId:'synthetic-user',isOffline:false,realtimeEffectRunCount:{current:0},currentProjectRef:{current:null},
    useProjectStore:store,useTaskStore:store,useLabelStore:store,useSavedViewStore:store,useStatusStore:store,
    useAuthStore:{getState:()=>({currentUser:account?{id:account}:null})},
    useSyncStore:actualSyncStore,
    logEvent:(...args)=>logs.push(args),isSuspended:()=>suspended,captureSyncContext:async()=>context,handlePullError:async(...a)=>logs.push(a),
    getSupabase:async()=>getClientOverride?getClientOverride():sourceClient,requireSession:async()=>true,
    lastPullAt:new Map(),recentlyDeletedIds:new Set(),projectNameCache:new Map(),remoteTaskOrder:x=>x,pullWatermark:()=>null,clearAuthFailures:noop,pullTaskLabelsForTasks:async()=>0,
    pullTaskLabelsForTask:async()=>0,applyRemoteActivityRow:async()=>{},schedulePersonalReconnect:noop,scheduleSharedReconnect:noop,
    scheduleRemoteProjectRefresh:noop,getCachedProjectName:()=>null,onChangeCallback:null,
    personalChannelStates:new Map(),userChannelState:null,
    setInterval:(fn,ms)=>{const id=nextId++;intervals.set(id,{fn,ms});return id},clearInterval:id=>intervals.delete(id),
    setTimeout:(fn,ms)=>{const id=nextId++;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),
    __importPersonal:personal,__importUser:{subscribeToUserChannel:async()=>{events.userSubscriptions++},unsubscribeUserChannel:async()=>{events.userUnsubscribes++}}
  };
  const compiled=compilation(ref);const codeFingerprint=createHash('sha256').update(compiled).update(storeCode).digest('hex');
  vm.createContext(sandbox);vm.runInContext(compiled,sandbox);
  personal.pullProjectMetadata=(...a)=>sandbox.pullProjectMetadata(...a);
  personal.pullNewTasks=async(...a)=>{activePulls++;maxConcurrent=Math.max(maxConcurrent,activePulls);try{return await sandbox.pullNewTasks(...a)}finally{activePulls--}};
  const untilIdle=async()=>{
    let quiet=0,last=-1;
    for(let i=0;i<3000;i++){
      await new Promise(r=>setTimeout(r,latency?Math.max(1,latency):0));await settle(3);
      if(activePulls===0&&activeRequests===0&&requests.length===last)quiet++;else quiet=0;
      last=requests.length;if(quiet>=3)return;
    }
    throw new Error('Pulls did not settle');
  };
  return {
    sandbox,requests,logs,intervals,timers,channels,events,projects,projectMap,remoteProjects,get sync(){return actualSyncStore.getState()},codeFingerprint,client:sourceClient,context,
    run:()=>sandbox.fixture.runEffect(),untilIdle,maxConcurrent:()=>maxConcurrent,
    changeConnected:(value)=>actualSyncStore.getState().setRealtimeConnected(value),
    setSuspended:(value)=>{suspended=value},setAccount:(value)=>{account=value},
    overrideClient:(value)=>{getClientOverride=value},overrideSubscribe:(value)=>{subscribeOverride=value},
    runTimers:async()=>{const pending=[...timers.values()];timers.clear();for(const {fn}of pending)await fn();await untilIdle()},
    runIntervals:async()=>{for(const {fn}of [...intervals.values()])await fn();await untilIdle()},
    stateRows:()=>[...sandbox.personalChannelStates.keys()],stop:()=>{void rest.auth.stopAutoRefresh()}
  };
}

async function trafficScenario({ref=null,connected=true,flaps=0,archived=0,latency=0}={}) {
  const h=makeHarness({ref,connected,archived,latency});
  const started=performance.now();const cleanup=await h.run();await h.untilIdle();
  const initialMs=performance.now()-started, initialRequests=h.requests.length;
  for(let i=0;i<flaps;i++){h.changeConnected(false);h.changeConnected(true)}
  await h.untilIdle();
  const beforeTimer=h.requests.length, intervalCount=h.intervals.size;
  await h.runIntervals();
  const result={ref:ref??'working tree',projects:20,archived,flaps,initialRequests,initialMs,requestsBeforeTimer:beforeTimer,timerRequests:h.requests.length-beforeTimer,activeFallbackIntervals:intervalCount,maxConcurrentProjectPulls:h.maxConcurrent(),totalRequests:h.requests.length,responseBytes:h.requests.reduce((n,r)=>n+r.responseBytes,0),requestUrlAndBodyBytes:h.requests.reduce((n,r)=>n+r.requestBytes,0),requestsByTable:h.requests.reduce((a,r)=>(a[r.table]=(a[r.table]??0)+1,a),{}),transport:'Actual SDK; synthetic in-memory fetch, external requests blocked',fixedTransportDelayMs:latency,physicalDiskIoMeasured:false,codeFingerprint:h.codeFingerprint};
  cleanup();await settle();h.stop();return result;
}

async function behaviorScenarios() {
  const findings=[];
  const capture=async(name,fn)=>{try{await fn();findings.push({name,passed:true})}catch(error){findings.push({name,passed:false,error:String(error)})}};
  await capture('suspended/offline fallback makes no HTTP requests, recovery resumes',async()=>{
    const h=makeHarness({connected:false});const cleanup=await h.run();await h.untilIdle();
    const initial=h.requests.length;h.setSuspended(true);await h.runIntervals();assert.equal(h.requests.length,initial);
    h.setSuspended(false);h.sandbox.navigator.onLine=false;await h.runIntervals();assert.equal(h.requests.length,initial);
    h.sandbox.navigator.onLine=true;await h.runIntervals();assert.equal(h.requests.length,initial+60);
    cleanup();h.stop();
  });
  await capture('disposed/account-changed effect cannot issue fallback requests',async()=>{
    const h=makeHarness({connected:false});const cleanup=await h.run();await h.untilIdle();const n=h.requests.length;
    h.setAccount('other');await h.runIntervals();assert.equal(h.requests.length,n);cleanup();assert.equal(h.intervals.size,0);h.stop();
  });
  await capture('archived channel removes task/activity bindings and remote restore reattaches them',async()=>{
    const h=makeHarness({projectCount:1,archived:1});const pid=h.projects[0].id;
    const changed=[];await h.sandbox.fixture.subscribeToPersonalProject(pid,(...a)=>changed.push(a));
    const ch=h.channels.at(-1);assert.deepEqual(ch.bindings.map(b=>b.filter.table),['projects']);
    h.remoteProjects.set(pid,{...h.projects[0],is_archived:0,updated_at:'2026-01-02T00:00:00Z',archive_updated_at:'2026-01-02T00:00:00Z'});
    ch.emit('projects');await settle(20);
    assert.equal(ch.closed,true);const restored=h.channels.at(-1);
    assert.deepEqual(restored.bindings.map(b=>b.filter.table),['projects','tasks','activity_log']);assert.equal(h.projectMap.get(pid).is_archived,0);assert.equal(changed.length,1);h.stop();
  });
  await capture('concurrent subscribe calls create only one channel for a project',async()=>{
    const h=makeHarness({projectCount:1});const pid=h.projects[0].id;
    await Promise.all([h.sandbox.fixture.subscribeToPersonalProject(pid,noop),h.sandbox.fixture.subscribeToPersonalProject(pid,noop)]);
    assert.equal(h.channels.length,1);assert.deepEqual(h.stateRows(),[pid]);h.stop();
  });
  await capture('concurrent user subscribe calls create only one discovery channel',async()=>{
    const h=makeHarness({projectCount:0});const opts={subscribePersonalProject:async()=>{}};
    await Promise.all([h.sandbox.fixture.subscribeToUserChannel('synthetic-user',opts),h.sandbox.fixture.subscribeToUserChannel('synthetic-user',opts)]);
    assert.equal(h.channels.length,1);assert.equal(h.sandbox.userChannelState.userId,'synthetic-user');h.stop();
  });
  await capture('old personal cleanup cannot destroy a new subscription while getSupabase is pending',async()=>{
    const h=makeHarness({projectCount:2});await h.sandbox.fixture.subscribeToPersonalProject(h.projects[0].id,noop);
    const gate=deferred();h.overrideClient(()=>gate.promise);const cleanup=h.sandbox.fixture.unsubscribeAllPersonal();await settle();
    h.overrideClient(null);await h.sandbox.fixture.subscribeToPersonalProject(h.projects[1].id,noop);
    gate.resolve(h.client);await cleanup;
    assert.deepEqual(h.stateRows(),[h.projects[1].id]);h.stop();
  });
  await capture('old user cleanup cannot null a newer user channel',async()=>{
    const h=makeHarness({projectCount:0});const gate=deferred();
    h.sandbox.userChannelState={userId:'old',cancelled:false,reconnectTimer:null,channel:{status:noop}};
    h.overrideClient(()=>gate.promise);const cleanup=h.sandbox.fixture.unsubscribeUserChannel();await settle();
    const newer={userId:'new',cancelled:false,reconnectTimer:null,channel:{status:noop}};h.sandbox.userChannelState=newer;
    gate.resolve(h.client);await cleanup;
    assert.equal(h.sandbox.userChannelState,newer);h.stop();
  });
  await capture('disposed setup cannot create a user channel after its final personal subscription resolves',async()=>{
    const h=makeHarness({projectCount:1});const gate=deferred();h.overrideSubscribe(()=>gate.promise);
    const cleanup=await h.run();await h.untilIdle();cleanup();gate.resolve();await settle(20);
    assert.equal(h.events.userSubscriptions,0);h.stop();
  });
  await capture('stale personal event cannot schedule work after App cleanup',async()=>{
    const h=makeHarness({projectCount:1});let callback;
    h.overrideSubscribe((_pid,fn)=>{callback=fn});const cleanup=await h.run();await h.untilIdle();cleanup();await settle();
    callback('UPDATE',{id:'synthetic-task'});assert.equal(h.timers.size,0);h.stop();
  });
  await capture('shared channel failure is included in aggregate Realtime health',async()=>{
    const h=makeHarness({projectCount:1});h.sync.setChannelHealth('personal:healthy',true);
    const state={cancelled:false,attempt:0,channel:null,reconnectTimer:null};await h.sandbox.fixture.createSharedChannel('shared-project',state);
    const ch=h.channels.at(-1);ch.status('SUBSCRIBED');ch.status('CHANNEL_ERROR');assert.equal(h.sync.realtimeConnected,false);h.stop();
  });
  return findings;
}

async function run({baseline=null,output=null,repetitions=7}={}) {
  const before=[];const after=[];
  for(const options of [{connected:true},{connected:false,flaps:3},{connected:true,archived:4}]){
    if(baseline)before.push(await trafficScenario({...options,ref:baseline}));
    after.push(await trafficScenario(options));
  }
  const timings={before:[],after:[],method:'Seven paired runs; 1ms fixed synthetic delay per SDK request; equal 20-project unchanged fixture. Includes actual function/SDK parsing overhead, not cloud throughput.'};
  for(let i=0;i<repetitions;i++)for(const phase of baseline?['before','after']:['after'])timings[phase].push((await trafficScenario({ref:phase==='before'?baseline:null,latency:1})).initialMs);
  const summary=(values)=>{const sorted=[...values].sort((a,b)=>a-b);return {runs:values.length,p50Ms:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]}};
  timings.beforeSummary=timings.before.length?summary(timings.before):null;timings.afterSummary=summary(timings.after);
  const cases=await behaviorScenarios();const result={capturedAt:new Date().toISOString(),beforeRef:baseline?cp.execFileSync('git',['rev-parse',baseline],{cwd:source,encoding:'utf8'}).trim():null,afterRef:'uncommitted working tree',before,after,timings,cases};
  if(output)fs.writeFileSync(output,JSON.stringify(result,null,2));
  return result;
}
module.exports={makeHarness,trafficScenario,behaviorScenarios,run};
if(require.main===module){
  const args=process.argv.slice(2),value=(name)=>{const at=args.indexOf(name);return at<0?null:args[at+1]};
  run({baseline:value('--baseline'),output:value('--output')}).then(r=>{console.log(JSON.stringify(r,null,2));if(r.cases.some(c=>!c.passed))process.exitCode=1}).catch(e=>{console.error(e);process.exitCode=1});
}
