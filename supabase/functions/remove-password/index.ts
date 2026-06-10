import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleRemovePassword, type RemovePasswordClient } from './removePassword.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Cast through the structural surface: supabase-js types updateUserById's
    // password as `string | undefined`, but GoTrue's admin endpoint accepts
    // an explicit null to clear encrypted_password — see removePassword.ts.
    const { status, body } = await handleRemovePassword(
      adminClient as unknown as RemovePasswordClient,
      req.headers.get('Authorization')
    )
    return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
  } catch (e) {
    console.error('remove-password error:', e)
    return new Response(JSON.stringify({ ok: false, error: 'internal_error' }), {
      status: 500,
      headers: jsonHeaders
    })
  }
})
