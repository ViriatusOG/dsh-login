# Adapting dsh-login to DSH 0.2.1-alpha.4 (→ released as 0.3.4)

> Follow-up to [`docs/adapt-dsh-0.2.1-alpha.3.md`](adapt-dsh-0.2.1-alpha.3.md) (0.3.3). Watch cycle 2026-10-16; released as **0.3.4** (git tag `v0.3.4`).

## 1. Version detection

The daily watch runs `npm view @deepseek-ai/dsh dist-tags --registry=https://registry.npmjs.org` and compares against the version the last adapt round tracked. The `alpha` dist-tag moved:

| source | value at detection (2026-10-16) |
|---|---|
| npm `@deepseek-ai/dsh` `alpha` dist-tag | `0.2.1-alpha.4` (was `0.2.1-alpha.3`) |
| npm `@deepseek-ai/dsh` `latest` dist-tag | `0.2.0-rc.2` (unchanged — the stable channel has not moved) |
| git tag | `dsh-v0.2.1-alpha.4` → `86a402200d` (2026-10-15 20:22:44 +0800, "Merge pull request #6301 from deepseek-harness/worktree/release-dsh-0.2.1-alpha.4") |
| previous tag | `dsh-v0.2.1-alpha.3` → `2fbf4359b8` (2026-10-14 19:48:55 +0800) |
| commits between | 89 (`git rev-list dsh-v0.2.1-alpha.3..dsh-v0.2.1-alpha.4 --count`) |

## 2. Compatibility surface (what changed upstream and what it touches)

Scanned at tag `dsh-v0.2.1-alpha.4` (read-only `git show`/`grep` against `E:\code\deepseek-harness`):

| integration point | upstream change in alpha.4 | impact on dsh-login |
|---|---|---|
| `packages/boot/plugin-market` (new) | New plugin-market service: market index list + bundle install; typert namespace **`pluginMarket`** with methods `listIndexes` / `setIndexes` / `search`; emits `plugin-market/changed` | **The only new wire namespace.** `setIndexes` reconfigures the instance-wide index list — admin-only wholesale, mirroring the `pluginManager` posture. Gated in all three dsh-login layers (see §3). |
| `packages/bundle/web-app/cordis.patch.yml` | New client bundle rows pairing the market UI (`ui-plugin-market` → `@deepseek-ai/dsh-client-ui-plugin-market`) | Runs under `uiRoleGate`: the client bundle is mounted only for admins (an admin-only *bundle* behind an admin-only *API* — consistent). No `ADMIN_ONLY_UI_PLUGINS` change needed: native DSH UIs are intentionally not whole-UI gated; the API allow-list is the boundary. |
| `packages/client/modules/src/index.ts:636` | `ClientModuleRegistry` now carries `this.release = {version, commit?}` (version from the client package, commit from `DSH_CLIENT_COMMIT_HASH`) and attaches it to the boot graph (`:826` — field **`release`**) | New top-level boot-graph field. `filterBootGraph` passes it through untouched (it only removes entries / patches batches), but the contract is now regression-tested: filter + HTML round-trip must preserve `release` byte-identically. |
| `packages/host/webserver/src/index.ts` | Exports intact: `bindUrlHost` (`:210`), `getOrigin` (`:351`), `renderIndex` (`:584`) → `applyIndexTaps(renderIndexInjections(html, this.collectIndexInjections()))`; `src/web-runtime.ts` untouched | No change: dsh-login's web-runtime takeover and index rendering path keep composing. |
| `packages/api/terminal-controller/src/index.ts:216` | `attach(agent, id, signal): RemoteStream<TerminalFrame, TerminalInput>` unchanged (throws "Terminal attachment requires a Remote invocation" without one) | No change to the 0.3.3 allow-list shape (`terminal.attach` admitted, follow/write/resize still absent). |
| `packages/api/remote-access/src/index.ts:271` | `follow(signal)` / `FOLLOW_ACTION 'remoteAccess/follow'` unchanged (owner + every Peer allowed) | No change. |
| `packages/boot/app-boot/src/plugin-compatibility.ts` | Boot admission: `engines.dsh` first, else `dsh-peer` scan; `satisfies()` uses `includePrerelease: true`; warning wording now "requirements"/"dsh requirements" | dsh-login ships no `engines.dsh`; the peer `dsh-*` ranges already admit `0.2.1-alpha.4` (`^0.2.1-alpha.3` tuples accept alpha.4). Fail-open behavior unchanged. |

Multi-principal remote-access (alpha.3's RBAC substrate) saw no alpha.4 changes relevant to dsh-login.

## 3. Changes shipped (0.3.4)

- **`package.json`** — devDependencies retargeted `^0.2.1-alpha.3` → `^0.2.1-alpha.4` (the 13 `@deepseek-ai/dsh-*` rows; vendored cordis/schemastery/loader/include alphas unchanged). No version bump of the plugin's own peer ranges was needed — they already admitted alpha.4.
- **`src/remote-guard.ts`** — `ADMIN_ONLY_NAMESPACES` += `'pluginMarket'` (comment: DSH 0.2.1-alpha.4; `setIndexes` reconfigures the instance-wide market index list, mirroring the `pluginManager` posture). Ordinary users' whole `pluginMarket.*` surface now 403s at the REMOTE layer.
- **`src/capabilities.ts`** — four edits mirroring the guard into the `/api` bridge + discovery layer:
  - `ADMIN_ONLY_TWO_SEGMENT_DOMAINS` += `'pluginMarket'` (`/api/pluginMarket/*` denied as a two-segment domain);
  - `adminOnlyMethods()` += `'pluginMarket.listIndexes'`, `'pluginMarket.setIndexes'`, `'pluginMarket.search'` (advertised to admins only);
  - `allDomains()` += `'pluginMarket'`;
  - `QUIET_DENY_METHODS` += `'pluginMarket.listIndexes'`, `'pluginMarket.search'` — the two read probes the Plugins page's Discover tab boots with; `setIndexes` (a write) stays a loud 403.
- **Tests** — three new specs pinning the gate at each layer:
  - `tests/capabilities.spec.ts`: "keeps the pluginMarket namespace (0.2.1-alpha.4) admin-only across all three layers" (ordinary `caps.methods` lack `pluginMarket.*`, admin methods contain them; two-segment deny; `isReadProbe` true for `listIndexes`/`search`, false for `setIndexes`); plus `pluginMarket` joined the two-segment-deny loop.
  - `tests/remote-guard.spec.ts`: "denies the whole pluginMarket namespace (0.2.1-alpha.4) for ordinary users but passes admins" (all three methods reject `/forbidden/` with zero gateway calls; admin wrapper passes through).
  - `tests/ui-gate.spec.ts`: "preserves future top-level fields (0.2.1-alpha.4 `release`) through filtering" (`filterBootGraph` keeps `release`; `servedGraph(applyUiGate(renderIndexHtml(graph)))` keeps it).
- **Docs** — this file; README/README.zh banner + status + history + tracking/evaluation updates; `.claude/rules/changelog.md` entry.

Deliberately unchanged: `USER_ALLOWED` (no new user-facing wire method in alpha.4), `ADMIN_ONLY_UI_PLUGINS` and `src/ui-gate.ts` (native UI bundles stay intentionally ungated), remote guard `USER_ALLOWED` method list.

## 4. Verification

| step | result |
|---|---|
| `npm install` (after devDep retarget) | changed 21 packages; installed `dsh-client-modules` / `dsh-host-webserver` / `dsh-client-connection` confirmed **0.2.1-alpha.4** |
| `npx vitest run` | **20 files / 256 tests green** (0.3.3 was 253; +3 new) |
| `npm run build` | exit 0 |
| `npm run verify:imports` | all ok |

As with every release: the per-user isolation guard composed over the native `typertGateway` ([`docs/compose-guard.md`](compose-guard.md)) and the two-browser isolation sign-off remain **deployment-side acceptance steps** (see [`docs/verify-option-A.md`](verify-option-A.md) §B).

## 5. Multi-user / role verdict

- Upstream still ships **no native multi-user accounts** — the recurring `multi.?user|multiuser|role.?based|\brbac\b` grep produces no new hits at alpha.4; dsh-login remains the account/authn layer.
- The client boot/activation layer still carries no `role`/`permission`/`isAdmin` concept (grep zero hits under `packages/client`; DOM `role="…"` accessibility attributes still dominate raw `role` greps). **A whole-UI role-based permission gate is still not natively implementable** — which is why dsh-login ships its own (`uiRoleGate`, since 0.3.0).
- alpha.4's `release` boot-graph field is release-identity plumbing for client reload gating, **not** a permission axis (and dsh-login's gate preserves it).
- alpha.3's remote-access RBAC substrate (`packages/api/remote-access`) is unchanged at alpha.4 and remains a *connection* policy for non-owner Peers — not a UI-activation gate.

**Conclusion: no new multi-user capability upstream; no change to dsh-login's role model.**
