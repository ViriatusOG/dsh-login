# DSH 0.2.1-alpha.3 compatibility check (2026-10-15)

Status: **adapted and RELEASED as `@islibaodong/dsh-login@0.3.3`** (npm latest;
git tag `v0.3.3` + master pushed). DSH 0.2.1-alpha.3 (published 2026-10-14,
868 commits past the alpha.2 merge) ships the **first native role-based
enforcement primitive** — the new `packages/api/remote-access` package, an
authorize-only RBAC for non-owner Peers — plus **bidirectional terminal
streams** (`terminal.follow`/`terminal.write`/`terminal.resize` are replaced by
a single `terminal.attach`), **breaking gateway internals** (`inject:
['typert', 'remoteAccess']`, `peer` required on every remote call), and a
**web-app bundle split** whose new `harness-dev-context` row injects `webApp` —
which dsh-login must provide now that it disables the web-runtime row. Suite
**20 files / 253 tests green** on real 0.2.1-alpha.3 builds. Previous
adaptation: `docs/adapt-dsh-0.2.1-alpha.2.md`.

## 1. Version detection

| Channel | Finding |
|---|---|
| npm `@deepseek-ai/dsh-web-frontend` dist-tags | new **`0.2.1-alpha.3`** under **`alpha`** (web-frontend `time.modified` 2026-10-14T12:37Z); all six `@deepseek-ai/dsh-*` peers (web-frontend, host-webserver, host-frontend-static, settings, client-connection, credentials) re-published at alpha.3; `next` = `0.2.0-rc.2`. Vendored packages **re-published** for alpha.3 (dist-tag `dsh-0-2-1-alpha-3`): `@deepseek-ai/cordis` 4.0.5-alpha.**2**, `@deepseek-ai/schemastery` 3.18.5-alpha.**2**, `cordis-plugin-include` 1.0.10-alpha.2, `cordis-plugin-loader` 1.0.6-alpha.2. |
| Harness checkout | tag `dsh-v0.2.1-alpha.3` (commit `2fbf4359b8`); `origin/master` = `571902028a` (868 commits past the alpha.2 merge `d743267388`, 16 past the tag). Diff alpha.2..alpha.3 over `packages/` + `apps/`: 2404 files, +74908/−11541; 188 files on plugin-visible paths. Local `dev` worktree still at alpha.2 (stale) — inspected via detached worktree `E:\code\deepseek-harness-wt-alpha3`. |
| dsh-login base | `0.3.2` tree, clean. |

## 2. Compatibility surface (868 commits, diffed against `dsh-v0.2.1-alpha.2`)

Release theme: **native RBAC substrate + bidirectional terminal**. A new
`remoteAccess` typert namespace and service carries per-Peer authorization for
non-owner connections; the terminal becomes a bidirectional attach stream; and
the web-app bundle splits its prompt-context rows.

| Integration point | 0.2.1-alpha.3 change | Impact on dsh-login |
|---|---|---|
| `packages/api/remote-access` (**NEW package**) | Authorize-only RBAC for non-owner Peers: `Principal`/`PrincipalMap` (merge-extensible; only `{kind:'owner'}` today), `registerPolicy(kind, policy)`, `decide()` per-resource, owner baseline injected into every rendered index as the `__DSH_REMOTE_ACCESS__` global, client `mountAccess` subscribes via `remoteAccess.follow` (the one always-allowed method; it answers with only the caller's own grants). | dsh-login users reach the native stack as **owner principals** (v1 cookie → `browserPeer {kind:'owner'}`), and owners bypass remote-access checks — dsh-login's own walls keep enforcing. But the client module's mount calls `remoteAccess.follow` on every page load: without it on `USER_ALLOWED` the bridge wall + remote guard would deny it and the mount logs a denied-stream error. **`remoteAccess.follow` added to `USER_ALLOWED`.** |
| `packages/api/session/terminal` | **BREAKING**: `terminal.follow` → `terminal.attach` (bidirectional stream; uplink `{type:'write'}/{type:'resize'}` sequenced commands replace the removed `terminal.write`/`terminal.resize` methods). | `USER_ALLOWED`: removed `terminal.follow`/`terminal.write`/`terminal.resize`, added `terminal.attach`. Capabilities flow from `USER_ALLOWED`, so `src/capabilities.ts` needed no change. |
| `packages/api/gateway` | **BREAKING internals**: `TypertGatewayService.inject = ['typert', 'remoteAccess']` (the gateway no longer boots without the remote-access row); `InvokeRemoteRequest.peer` REQUIRED; `admitConnection` → `{peer, release}` or `{rejection: 401\|403\|409}`; new RemoteError codes `remote-access/denied`, `gateway/peer-disposed`, `gateway/interactions-forbidden`. | **No dsh-login change.** `src/remote-guard.ts`'s `wrapRemoteGateway` is a spread-wrap overriding only `invoke`/`stream` — it forwards every other gateway member unchanged and neither constructs a gateway nor implements `PeerScope`, so the alpha.3 member additions flow through untouched (re-verified structurally; the composition glue is deployment-side per `docs/compose-guard.md`). |
| `packages/bundle/web-app` + new `@deepseek-ai/dsh-harness-dev-context` | The web-runtime row no longer owns the prompt sections: a **new enabled `harness-dev-context` bundle row** (`inject: ['systemPrompt','sessionProjections','webApp']`) serves the harness-source + web-surface sections and reads `ctx.webApp.getAdvertisedUrl()` at context-assembly time. `webApp` = `{ getAdvertisedUrl() }` backed by `webServer.getOrigin()` (new alpha.3 accessor; throws before the listener binds). | **Composition-breaking for dsh-login**: the shipped `cordis.patch.yml` disables the web-runtime row (dsh-login re-provides `webRuntime`), which was the **sole `webApp` provider** — the enabled `harness-dev-context` row would fail injection at boot. Fix shipped in `src/web-runtime.ts`: dsh-login now also **provides `webApp`** with a lazy `getAdvertisedUrl` that feature-detects `webServer.getOrigin()` (try/catch) and falls back to the manual `http://host:port` formation (pre-alpha.3 harnesses / pre-bind reads); `''` when `webServer` is absent. `cordis.patch.yml` unchanged — `harness-dev-context` then loads upstream parity (app:web-surface + harness:source sections). |
| `packages/host/webserver` | New `getOrigin()` (protocol + `bindUrlHost(host)` + bound port; throws `'webserver: origin read before the listener bound a port'` pre-bind), `get port()` (undefined pre-bind), `bindUrlHost()` (loopback canonicalized, IPv6 bracketed). Listen still binds during service init. | Additive only — consumed via the feature-detect above; no signature dsh-login calls changed. `src/web-runtime.ts`'s URL line / `DSH_WEB_URL` logic unchanged (alpha.2 behavior retained). |
| `packages/client/connection` | Host half refactored: `operator-peer.ts` → `peer.ts` (`Peer implements PeerScope` with `principal`/`signal`/`interactions`), v2 `ApiCookiePayload {version:2, id: PeerId}`, `admitConnection` with socket-ownership 409, new `GET /connect` token→cookie exchange route. Client half additive: dual exports `client.node.js`/`client.browser.js`, `interactions` connect option (default `'answer'` in-page), new `socket.ts`. | **No dsh-login impact**: option A consumes neither the host connection face nor implements `PeerScope`; `/connect` is the same launch-token owner exchange. Client bundle re-stamp needed (recurring gotcha): `npm run build:client` regenerated `dist/client.js` — the logical `/plugins/<pkg>/client.js` URL is unchanged (the new chunk guard in `packages/client/modules` stops `client.node.*` from being served as browser chunks). |
| `@deepseek-ai/dsh-credentials` | Documented precedence flip: managed `.credentials.yaml` > inherited env > `.env`; `assertUnshadowed` deleted (set/unset no longer throw on env-shadowed refs); unknown top-level keys tolerated; `chokidar ^4→^5`. Core `resolve/describe/set/unset` signatures unchanged. | Compatible, net-positive. dsh-login's `UserStore(ctx.credentials, credentialRef(...))` unaffected. |
| `packages/client/modules` | Only a chunk guard added (`client.node.js` never served as browser chunks). | Boot-graph lever intact — `packages/client/modules/src/index.ts:585` still pushes the `__DSH_BOOT__` global row → `uiRoleGate` (0.3.0) unaffected. |

## 3. Changes shipped (0.3.3)

- **`package.json` version** `0.3.2` → `0.3.3`.
- **devDependencies**: the 10 dsh packages → `^0.2.1-alpha.3`; vendored pins
  retargeted to the re-published alphas — cordis `~4.0.5-alpha.2`,
  schemastery `~3.18.5-alpha.2`, cordis-plugin-include `~1.0.10-alpha.2`,
  cordis-plugin-loader `~1.0.6-alpha.2`. **Peers unchanged**: the dsh tuples
  `>=0.2.1-alpha.1 <0.3.0-0` and the cordis/schemastery `^…-rc.1 || ~…-alpha.1`
  ranges already admit the alpha.2 vendor re-publishes (same-tuple).
- **`src/web-runtime.ts`**: `provideWebRuntime` now also provides
  **`webApp`** (`{ getAdvertisedUrl: () => advertisedUrl(ctx) }`) so the
  alpha.3 `harness-dev-context` row's `webApp` injection resolves — see §2.
  `advertisedUrl` feature-detects `webServer.getOrigin()` and falls back to the
  manual formation; read is lazy (per-session context assembly, post-bind).
- **`src/api-filter.ts`**: `USER_ALLOWED` — removed `terminal.follow`/
  `terminal.write`/`terminal.resize` (no longer exist as methods), added
  `terminal.attach` (the bidirectional stream; write/resize are now sequenced
  uplink commands inside it) and `remoteAccess.follow` (the client mount's
  snapshot stream; the gateway always allows it and it answers with only the
  caller's own grants).
- **`dist/client.js`** regenerated (`npm run build:client` — recurring gotcha
  after a `dsh-client-connection` bump; the dual `client.browser.js` export
  does not change dsh-login's single-file client bundle).
- **No change** to `src/remote-guard.ts`, `src/capabilities.ts` (flows from
  `USER_ALLOWED`), `src/bridge-list-filter.ts`, `src/ui-gate.ts`,
  `src/gateway.ts`, `cordis.patch.yml`.

## 4. Verification (against real 0.2.1-alpha.3 builds from npm)

- `npm install` clean **only after** deleting `node_modules` +
  `package-lock.json` (the stale-tree ERESOLVE wedge, recurring) — 109
  packages; verified `@deepseek-ai/dsh-host-webserver` +
  `dsh-client-connection` = 0.2.1-alpha.3, cordis = 4.0.5-alpha.2.
- `npm test`: **20 files / 253 tests passed** (5.67 s), including the new
  `tests/web-runtime.spec.ts` (5 unit tests over the `webApp` provide) and a
  **real-composition** integration test in `tests/plugin-entry.spec.ts`
  (boots the actual alpha.3 `HttpServer` + dsh-login composition and asserts
  `ctx.webApp.getAdvertisedUrl()` = `http://127.0.0.1:<port>`).
- `npm run build`: exit 0 (host + client regen). `npm run verify:imports`:
  every `src/*.ts` ok.

## 5. Multi-user / role verdict at 0.2.1-alpha.3 (the first upstream RBAC substrate)

- `multi.?user|multiuser|role.?based|\brbac\b` over `packages` + `apps`:
  **1 hit** — `packages/api/remote-access/README.md` (first hit in six
  watches). Upstream ships **no native multi-user accounts** (no user store,
  no login, no identity UI) — dsh-login remains the account/authn layer.
- **What IS new**: native **role-based enforcement machinery** for non-owner
  Peers — the remote-access policy engine (`Principal`/`PrincipalMap`,
  `registerPolicy`, per-resource `decide`, snapshot injection) plus the
  multi-principal connection machinery (`createPeer`/`admitConnection`, v2 API
  cookies `{version:2, id: PeerId}`, the `GET /connect` exchange, socket
  ownership 409). This is the substrate a future native whole-UI/per-resource
  permission system would build on.
- dsh-login users are **owner principals** to that machinery (v1 cookie →
  `browserPeer {kind:'owner'}`), so remote-access never gates them — dsh-login's
  login wall, bridge allow-list, remote guard, and `uiRoleGate` remain the
  actual multi-user boundary. Known caveats for any future integration:
  undeclared resources are UNCHECKED; api-session `added` entries leak
  `parentSessionId`; the ready frame exposes full host/home — dsh-login's own
  event/list scrubbing still covers those.
- Future option (documented, not integrated): register remote-access policies
  per dsh-login role if dsh-login ever mints non-owner principals.
