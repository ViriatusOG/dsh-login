/**
 * WorkspaceRootSetting — live + persisted admin choice of the folder that
 * holds every ordinary user's default workspace.
 *
 * The config `workspaceRoot` (or `<dshHome>/workspaces` when blank) is the
 * fallback; an admin can point it at any absolute folder from 设置-用户管理 so
 * each user's chat folders are created inside a location the admin picked
 * (`<root>/<username>`), instead of users choosing their own host directory.
 * Same contract as BooleanSetting: memory is authoritative for the running
 * process, the JSON file (`{ path }`, empty = fallback) is restart survival.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, normalize } from 'node:path'

/** Debounce window for coalescing disk writes (ms). */
const SAVE_DEBOUNCE_MS = 200

/** Longest root path an admin may store. */
export const MAX_WORKSPACE_ROOT_LENGTH = 4096

/**
 * Normalize an admin-supplied root, or undefined when it is not an absolute
 * path (relative paths would resolve against the server's cwd, which an admin
 * cannot see from the panel). Trailing separators are trimmed.
 */
export function normalizeWorkspaceRoot(value: string): string | undefined {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > MAX_WORKSPACE_ROOT_LENGTH || trimmed.includes('\0')) return undefined
  if (!isAbsolute(trimmed)) return undefined
  const normalized = normalize(trimmed)
  const trimmedEnd = normalized.replace(/[/\\]+$/, '')
  // Keep filesystem roots (`/`, `C:\`) intact: trimming them would no longer be absolute.
  return trimmedEnd !== '' && isAbsolute(trimmedEnd) && !/^[A-Za-z]:$/.test(trimmedEnd) ? trimmedEnd : normalized
}

export class WorkspaceRootSetting {
  /** Admin override; undefined means "use the fallback". */
  private override: string | undefined
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  /** Tail of a single serialized write queue; writes never overlap. */
  private saving: Promise<void> = Promise.resolve()

  /**
   * @param filePath JSON file holding `{ path: string }`.
   * @param fallback Root used while no admin override is set (the resolved config value).
   */
  constructor(private readonly filePath: string, readonly fallback: string) {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
      const path = parsed !== null && typeof parsed === 'object' ? (parsed as { path?: unknown }).path : undefined
      if (typeof path === 'string') this.override = normalizeWorkspaceRoot(path)
    } catch { /* absent or corrupt: keep the fallback */ }
  }

  /** The root currently in effect. */
  get(): string {
    return this.override ?? this.fallback
  }

  /** Whether the effective root is the fallback (no admin override). */
  isDefault(): boolean {
    return this.override === undefined
  }

  /**
   * Set the admin override (`''` clears it back to the fallback) and persist
   * it. Returns the effective root, or undefined when `path` is invalid (the
   * current value is then left unchanged).
   */
  set(path: string): string | undefined {
    if (path.trim() === '') {
      this.override = undefined
    } else {
      const normalized = normalizeWorkspaceRoot(path)
      if (normalized === undefined) return undefined
      this.override = normalized
    }
    this.scheduleSave()
    return this.get()
  }

  /** Force the pending save; resolves when the queued write settled. */
  async flush(): Promise<void> {
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer)
      this.saveTimer = undefined
    }
    this.saving = this.saving.then(() => this.writeNow())
    await this.saving
  }

  private scheduleSave(): void {
    if (this.saveTimer !== undefined) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      this.saving = this.saving.then(() => this.writeNow())
    }, SAVE_DEBOUNCE_MS)
  }

  private async writeNow(): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true })
      await writeFile(this.filePath, `${JSON.stringify({ path: this.override ?? '' })}\n`, 'utf8')
    } catch { /* persistence is best-effort; memory stays authoritative */ }
  }
}
