import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceRootSetting, normalizeWorkspaceRoot } from '../src/workspace-root-setting.ts'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-login-wsroot-'))
}

describe('normalizeWorkspaceRoot', () => {
  it('accepts absolute paths, trims trailing separators, rejects the rest', () => {
    expect(normalizeWorkspaceRoot('/srv/dsh/')).toBe('/srv/dsh')
    expect(normalizeWorkspaceRoot('  /srv//dsh  ')).toBe('/srv/dsh')
    expect(normalizeWorkspaceRoot('/')).toBe('/')
    expect(normalizeWorkspaceRoot('relative/dir')).toBeUndefined()
    expect(normalizeWorkspaceRoot('')).toBeUndefined()
    expect(normalizeWorkspaceRoot('/a\0b')).toBeUndefined()
  })
})

describe('WorkspaceRootSetting', () => {
  it('falls back until set, persists the override, and clears back to the fallback', async () => {
    const dir = tmp()
    const file = join(dir, 'settings-workspace-root.json')
    const setting = new WorkspaceRootSetting(file, '/fallback')
    expect(setting.get()).toBe('/fallback')
    expect(setting.isDefault()).toBe(true)

    expect(setting.set('/srv/chats/')).toBe('/srv/chats')
    expect(setting.isDefault()).toBe(false)
    await setting.flush()
    expect(new WorkspaceRootSetting(file, '/fallback').get()).toBe('/srv/chats')

    expect(setting.set('')).toBe('/fallback')
    await setting.flush()
    expect(new WorkspaceRootSetting(file, '/fallback').isDefault()).toBe(true)
  })

  it('refuses an invalid path without changing the value, and ignores a corrupt file', () => {
    const dir = tmp()
    const file = join(dir, 'settings-workspace-root.json')
    writeFileSync(file, '{not json')
    const setting = new WorkspaceRootSetting(file, '/fallback')
    expect(setting.get()).toBe('/fallback')
    setting.set('/ok')
    expect(setting.set('relative')).toBeUndefined()
    expect(setting.get()).toBe('/ok')
  })
})
