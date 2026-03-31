# Remove Mandatory In-Progress Status Enforcement

## Decisions

- My Day always shows 3 buckets, even if tasks belong to projects without in-progress statuses
- Dragging to In Progress bucket in kanban: show block icon + "No in-progress status" indicator, drop handler shows toast
- Status cycling for 2-status projects: cycles Not Started → Done → Not Started (no code change needed)
- Timer play button: do nothing if no in-progress status (no code change needed)
- TaskRow status label in My Day: show non-default/non-done status names. Not applicable for projects with no in-progress status.

## Changes Made

### 1. StatusList.tsx — Remove enforcement [x]
- Removed `middleStatuses.length <= 1` check and "Must have at least one in-progress status" toast

### 2. DeployProjectTemplateWizard.tsx — Remove enforcement in template wizard [x]
- Removed guard that prevented removing the only middle status

### 3. findProjectStatusForBucket (myDayBuckets.ts) — Fix fallback [x]
- `in_progress` case now returns `undefined` instead of falling back to wrong status

### 4. Drag to In Progress — Block indicator + toast [x]
- KanbanColumn.tsx: Shows ban icon + red background when dragging a task over In Progress column if project has no in-progress status
- AppLayout.tsx: handleBucketDrop shows toast when findProjectStatusForBucket returns undefined
- MyDayView.tsx: handleMyDayStatusChange shows toast when bucket status not found

### 5. TaskRow.tsx — Remove hardcoded "in progress" name check [x]
- Removed `name === 'in progress'` string check, kept default/done hiding

### Also fixed in this branch (pre-existing):
- MyDayView.tsx: handleStatusChange now computes order_index by bucket membership instead of exact status_id (fixes done task positioning in My Day)
