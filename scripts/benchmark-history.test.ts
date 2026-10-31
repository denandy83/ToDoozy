import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
const require=createRequire(import.meta.url)
const { trafficScenario, eventScenario, makeHarness }=require('./benchmark-sync.cjs')
const baseline='dea910d34d3a47de01e6398e4145377ae964d548'
it('executes both actual App startup effects and every paired historical request cohort',async()=>{
  for(const options of [{connected:true},{connected:false,flaps:3},{connected:true,archived:1},{connected:false}]){
    const before=await trafficScenario({...options,projectCount:2,fullStartup:true,ref:baseline})
    const after=await trafficScenario({...options,projectCount:2,fullStartup:true,ref:null})
    for(const result of [before,after]){
      expect(result.startupComparisonValid).toBe(true)
      expect(result.initialRequests).toBeGreaterThan(0)
      expect(result.requestUrlAndBodyBytes).toBeGreaterThan(0)
      expect(result.responseBytes).toBeGreaterThan(0)
      expect(result.physicalDiskIoMeasured).toBe(false)
      expect(result.phaseTraffic.initial.requests).toBe(result.initialRequests)
    }
    expect(before.codeFingerprint).not.toBe(after.codeFingerprint)
  }
  for(const shared of [false,true]){
    const before=await eventScenario({ref:baseline,shared,projectCount:2})
    const after=await eventScenario({ref:null,shared,projectCount:2})
    expect(before.requests).toBeGreaterThan(0);expect(after.requests).toBeGreaterThan(0)
    expect(before.codeFingerprint).not.toBe(after.codeFingerprint)
    expect(after.physicalDiskIoMeasured).toBe(false)
  }
},60000)
it('exposes the real eviction helper only for source revisions that contain it',async()=>{
  const before=await makeHarness({ref:baseline,projectCount:0}),after=await makeHarness({ref:null,projectCount:1})
  try{
    expect(before.services.evictProjectData).toBeUndefined()
    after.repo.tasks.create({id:'evicted',project_id:'p0',owner_id:'u',status_id:'s0',title:'Temporary'})
    await after.stores.useTaskStore.getState().hydrateAllForProject('p0')
    expect(after.stores.useTaskStore.getState().tasks.evicted).toBeDefined()
    after.services.evictProjectData('p0')
    expect(after.stores.useTaskStore.getState().tasks.evicted).toBeUndefined()
    expect(after.repo.tasks.findById('evicted')).toBeDefined()
  }finally{await before.stop();await after.stop()}
},30000)
