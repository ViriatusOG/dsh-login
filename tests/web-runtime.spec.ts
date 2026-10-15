import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { provideWebRuntime } from '../src/web-runtime.ts'

/**
 * Contract tests for the `webApp` provide dsh-login added in the
 * DSH 0.2.1-alpha.3 adaptation: with the web-runtime row disabled,
 * dsh-login becomes the only provider of `webApp`, which the new
 * harness-dev-context row reads for its `app:web-surface` context line.
 *
 * These run against a fake context so both the alpha.3 shape
 * (`webServer.getOrigin()`) and the older/manual fallback spellings are
 * covered deterministically; the real-server integration lives in
 * tests/plugin-entry.spec.ts. (A missing webServer service is not
 * simulated: provideWebRuntime dereferences ctx.webServer.host eagerly,
 * so dsh-login only ever runs behind a bound webserver.)
 */

interface RecordedProvide { name: string; value: unknown }

function fakeCtx(webServer: unknown): { ctx: Context; provides: RecordedProvide[] } {
  const provides: RecordedProvide[] = []
  // Mirror cordis's provide() semantics: the service becomes readable both as
  // ctx.<name> and through ctx.get(<name>).
  const ctx = {
    get(key: string) {
      return (ctx as unknown as Record<string, unknown>)[key]
    },
    provide(name: string, value: unknown) {
      provides.push({ name, value })
      ;(ctx as unknown as Record<string, unknown>)[name] = value
    },
  } as Record<string, unknown> & Pick<Context, 'get' | 'provide'>
  ctx.webServer = webServer
  return { ctx: ctx as unknown as Context, provides }
}

function webAppOf(ctx: Context): { getAdvertisedUrl: () => string } {
  return (ctx as unknown as { webApp: { getAdvertisedUrl: () => string } }).webApp
}

describe('provideWebRuntime webApp takeover (DSH 0.2.1-alpha.3)', () => {
  it('provides webApp alongside webRuntime', () => {
    const { ctx, provides } = fakeCtx({ host: '127.0.0.1', port: 13080 })
    provideWebRuntime(ctx, [])
    const names = provides.map(p => p.name)
    expect(names).toContain('webRuntime')
    expect(names).toContain('webApp')
    expect(typeof webAppOf(ctx).getAdvertisedUrl).toBe('function')
  })

  it('prefers webServer.getOrigin() when the harness exposes it (alpha.3+)', () => {
    const { ctx } = fakeCtx({ host: '127.0.0.1', port: 13080, getOrigin: () => 'http://127.0.0.1:13080' })
    provideWebRuntime(ctx, [])
    expect(webAppOf(ctx).getAdvertisedUrl()).toBe('http://127.0.0.1:13080')
  })

  it('falls back to the manual formation when getOrigin throws (pre-bind / zone-id bind)', () => {
    const { ctx } = fakeCtx({
      host: '127.0.0.1',
      port: 13080,
      getOrigin: () => { throw new Error('webserver: origin read before the listener bound a port') },
    })
    provideWebRuntime(ctx, [])
    expect(webAppOf(ctx).getAdvertisedUrl()).toBe('http://127.0.0.1:13080')
  })

  it('falls back to the manual formation when getOrigin is absent (pre-alpha.3 harness)', () => {
    const { ctx } = fakeCtx({ host: '192.168.1.10', port: 13080 })
    provideWebRuntime(ctx, [])
    expect(webAppOf(ctx).getAdvertisedUrl()).toBe('http://192.168.1.10:13080')
  })

  it('spells a wildcard bind as loopback, like the `dsh web:` print line', () => {
    const { ctx } = fakeCtx({ host: '0.0.0.0', port: 13080 })
    provideWebRuntime(ctx, [])
    expect(webAppOf(ctx).getAdvertisedUrl()).toBe('http://127.0.0.1:13080')
  })
})
