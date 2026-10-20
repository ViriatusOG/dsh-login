import { describe, expect, it } from 'vitest'
import { collectAbsolutePaths, isInsideFolder, payloadWithinFolder } from '../src/path-fence.ts'

describe('path fence', () => {
  it('collects absolute path strings anywhere in a payload', () => {
    expect(collectAbsolutePaths({ a: '/x', b: ['rel', { c: '/y' }], d: 3 })?.sort()).toEqual(['/x', '/y'])
  })

  it('treats only the folder and its descendants as inside', () => {
    expect(isInsideFolder('/w/alice', '/w/alice')).toBe(true)
    expect(isInsideFolder('/w/alice', '/w/alice/a/b')).toBe(true)
    expect(isInsideFolder('/w/alice', '/w/alice/..x')).toBe(true)
    expect(isInsideFolder('/w/alice', '/w/alice/../bob')).toBe(false)
    expect(isInsideFolder('/w/alice', '/w/alicebob')).toBe(false)
    expect(isInsideFolder('/w/alice', '/')).toBe(false)
  })

  it('ignores methods it does not cover and denies oversized payloads', () => {
    expect(payloadWithinFolder('session.prompt', { path: '/etc' }, '/w/alice')).toBe(true)
    const huge = { list: Array.from({ length: 5000 }, () => 'x') }
    expect(payloadWithinFolder('session.create', huge, '/w/alice')).toBe(false)
  })
})
