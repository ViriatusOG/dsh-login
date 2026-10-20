/**
 * Folder fence for ordinary users' path-bearing wire requests.
 *
 * An ordinary user's workspaces and sessions must live inside the folder the
 * admin set up for them (`<workspace root>/<username>`, see provision.ts).
 * The GUI never lets them pick a host directory (host.pickDirectory is
 * admin-only), but `workspace.create` / `session.create` / `session.fork`
 * carry a path straight from the browser, so a hand-crafted request could
 * still register any folder on the server. The bridge wall runs these checks
 * on the request payload before it reaches the bridge.
 *
 * The check is field-name agnostic: every absolute path string anywhere in
 * the payload must resolve inside the user's folder. `workspace.create` must
 * also carry at least one absolute path, so a relative path (which the host
 * would resolve against its own working directory) cannot slip through.
 */
import { isAbsolute, relative, resolve, sep } from 'node:path'

/** Wire methods whose payload may name a host folder. */
export const PATH_FENCED_METHODS: ReadonlySet<string> = new Set(['workspace.create', 'session.create', 'session.fork'])

/** Methods that must name a folder (and so are denied when none is found). */
const PATH_REQUIRED_METHODS: ReadonlySet<string> = new Set(['workspace.create'])

/** Bound on payload traversal so a hostile body cannot make the scan expensive. */
const MAX_NODES = 2000

/**
 * Every absolute-path string found anywhere in `value`, or undefined when the
 * payload is too large to walk fully.
 */
export function collectAbsolutePaths(value: unknown): string[] | undefined {
  const found: string[] = []
  const stack: unknown[] = [value]
  let visited = 0
  while (stack.length > 0 && visited < MAX_NODES) {
    const node = stack.pop()
    visited += 1
    if (typeof node === 'string') {
      if (node.length > 0 && isAbsolute(node)) found.push(node)
    } else if (Array.isArray(node)) {
      stack.push(...node)
    } else if (node !== null && typeof node === 'object') {
      stack.push(...Object.values(node as Record<string, unknown>))
    }
  }
  return stack.length === 0 ? found : undefined
}

/** Is `candidate` the folder `root` itself or somewhere below it? */
export function isInsideFolder(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/**
 * May an ordinary user send this payload to `endpoint`? True for methods the
 * fence does not cover. Payloads too large to walk fully are denied.
 */
export function payloadWithinFolder(endpoint: string, payload: unknown, folder: string): boolean {
  if (!PATH_FENCED_METHODS.has(endpoint)) return true
  const paths = collectAbsolutePaths(payload)
  if (paths === undefined) return false
  if (PATH_REQUIRED_METHODS.has(endpoint) && paths.length === 0) return false
  return paths.every((path) => isInsideFolder(folder, path))
}
