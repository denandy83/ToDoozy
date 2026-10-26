interface StatusRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>
}

export async function mutateProjectStatus(client: StatusRpcClient, projectId: string, actor: string, action: string, input: Record<string, unknown>) {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await client.rpc('manage_project_status', {
      p_project_id: projectId, p_actor: actor, p_action: action, p_input: input
    })
    if (!error) return data
    if (attempt >= 2 || (error.code !== '40P01' && error.code !== '40001')) throw new Error(error.message)
  }
}
