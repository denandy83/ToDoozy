import { describe, expect, it } from 'vitest'
import { requireSupabaseBuildConfig } from './supabase-build-config'

const project = 'https://example.supabase.co'
const publishable = 'sb_publishable_synthetic_test_key'
const jwt = (role: string) => `e30.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.test`

describe('embedded Supabase build configuration', () => {
  it('requires both client settings', () => {
    for (const env of [{}, { SUPABASE_URL: project }, { SUPABASE_ANON_KEY: publishable }]) {
      expect(() => requireSupabaseBuildConfig(env)).toThrow('Build requires')
    }
  })
  it('accepts public keys and normalizes a project URL', () => {
    for (const key of [publishable, jwt('anon')]) {
      expect(requireSupabaseBuildConfig({ SUPABASE_URL: `${project}/`, SUPABASE_ANON_KEY: key }))
        .toEqual({ url: project, anonKey: key })
    }
    expect(requireSupabaseBuildConfig({ SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: publishable }).url)
      .toBe('http://127.0.0.1:54321')
  })
  it('rejects malformed or credential-bearing endpoints', () => {
    for (const url of ['invalid', 'http://remote.example', 'https://user:password@example.com', `${project}/path`, `${project}?key=secret`]) {
      expect(() => requireSupabaseBuildConfig({ SUPABASE_URL: url, SUPABASE_ANON_KEY: publishable })).toThrow('SUPABASE_URL')
    }
  })
  it('rejects secret keys and JWTs with a privileged role without exposing them', () => {
    for (const key of ['sb_secret_synthetic_test_key', jwt('service_role'), 'invalid.jwt.data']) {
      expect(() => requireSupabaseBuildConfig({ SUPABASE_URL: project, SUPABASE_ANON_KEY: key })).toThrow('must be a publishable key')
      try { requireSupabaseBuildConfig({ SUPABASE_URL: project, SUPABASE_ANON_KEY: key }) } catch (error) {
        expect(String(error)).not.toContain(key)
      }
    }
  })
})
