import { expect, it, vi } from 'vitest'
import { mutateProjectStatus } from './statusRpc'

it.each(['40P01', '40001'])('retries a rolled-back complete status RPC after %s', async (code) => {
  const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: { code, message: 'rolled back' } })
    .mockResolvedValue({ data: { id: 'status', name: 'Done' }, error: null })
  expect(await mutateProjectStatus({ rpc }, 'project', 'owner', 'update', { id: 'status', is_done: true })).toEqual({ id: 'status', name: 'Done' })
  expect(rpc.mock.calls).toEqual(Array.from({ length: 2 }, () => ['manage_project_status', {
    p_project_id: 'project', p_actor: 'owner', p_action: 'update', p_input: { id: 'status', is_done: true }
  }]))
})
it.each(['create', 'update', 'delete', 'reorder', 'ensure'])('bounds rollback retries for %s', async (action) => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '40P01', message: 'deadlock' } })
  await expect(mutateProjectStatus({ rpc }, 'project', 'owner', action, {})).rejects.toThrow('deadlock')
  expect(rpc).toHaveBeenCalledTimes(3)
})
it.each(['42501', 'P0001', '23503', '23505', '', undefined])('does not retry permission, validation, or ambiguous error %s', async (code) => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { code, message: 'failed' } })
  await expect(mutateProjectStatus({ rpc }, 'project', 'owner', 'delete', {})).rejects.toThrow('failed')
  expect(rpc).toHaveBeenCalledTimes(1)
})
it('does not retry thrown transport errors or a successful committed operation', async () => {
  const rpc = vi.fn().mockRejectedValue(new Error('connection lost'))
  await expect(mutateProjectStatus({ rpc }, 'project', 'owner', 'ensure', {})).rejects.toThrow('connection lost')
  expect(rpc).toHaveBeenCalledTimes(1)
  rpc.mockReset().mockResolvedValue({ data: { created_count: 1 }, error: null })
  expect(await mutateProjectStatus({ rpc }, 'project', 'owner', 'ensure', {})).toEqual({ created_count: 1 })
  expect(rpc).toHaveBeenCalledTimes(1)
})
