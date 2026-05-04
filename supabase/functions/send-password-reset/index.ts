import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { email } = await req.json() as { email: string }
    if (!email) return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    let hasEmailIdentity = false
    let userExists = false
    try {
      const { data: rows } = await adminClient
        .schema('auth')
        .from('identities')
        .select('provider, users!inner(email)')
        .eq('users.email', email)
      if (rows && rows.length > 0) {
        userExists = true
        hasEmailIdentity = rows.some((r: { provider: string }) => r.provider === 'email')
      }
    } catch {
      // Fallback: listUsers
      const { data: { users } } = await adminClient.auth.admin.listUsers()
      const user = users.find((u) => u.email === email)
      if (user) {
        userExists = true
        hasEmailIdentity = user.identities?.some((i) => i.provider === 'email') ?? false
      }
    }

    if (!userExists) return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })

    if (hasEmailIdentity) {
      await adminClient.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: 'https://denandy83.github.io/ToDoozy/reset-password.html' }
      })
    } else {
      await adminClient.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo: 'https://denandy83.github.io/ToDoozy/no-password.html' }
      })
    }

    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
  } catch (e) {
    console.error('send-password-reset error:', e)
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders })
  }
})
