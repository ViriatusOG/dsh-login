# Adapting dsh-login to DSH 0.2.1-rc.2 (→ released as 0.3.5)

> Follow-up to [`docs/adapt-dsh-0.2.1-alpha.4.md`](adapt-dsh-0.2.1-alpha.4.md) (0.3.4). Watch cycle 2026-10-18; released as **0.3.5** (git tag `v0.3.5`).

## 1. Version detection

Three upstream releases landed between the previous watch (alpha.4, 2026-10-16) and this one; rc.2 is the newest published build.

| source | value at detection (2026-10-18) |
|---|---|
| npm `@deepseek-ai/dsh-host-webserver` `alpha` dist-tag | `0.2.1-alpha.5` (was `0.2.1-alpha.4`) |
| npm `@deepseek-ai/dsh-host-webserver` `next` dist-tag | `0.2.1-rc.2` — the newest published build |
| npm `@deepseek-ai/dsh-host-webserver` `latest` dist-tag | `0.0.1-rc.1` (stale stable channel, unchanged) |
| git tag | `dsh-v0.2.1-rc.2` → `687f282e86` (2026-10-17 15:22:43 +0800, PR #6408) |
| prior tags | `dsh-v0.2.1-rc.1` → `1600d8a1e1` (2026-10-16 21:46:57, PR #6387); `dsh-v0.2.1-alpha.5` → `1517a4dbca` (2026-10-16 19:02:34, PR #6327) |
| previous tag | `dsh-v0.2.1-alpha.4` → `86a402200d` (2026-10-15 20:22:44) |
| commits between | **49** (`dsh-v0.2.1-alpha.4..dsh-v0.2.1-rc.2`; 36 + 4 + 9 across the three tags) |

## 2. Compatibility surface (what changed upstream and what it touches)

Scanned at tag `dsh-v0.2.1-rc.2` (read-only `git diff`/`git show` against `E:\code\deepseek-harness`). The alpha.4..rc.2 diff touches 533 files (+6073/−1146), but **the entire dsh-login integration surface is source-unchanged**:

| integration point | upstream change alpha.4 → rc.2 | impact on dsh-login |
|---|---|---|
| `packages/host/webserver/src` | none (package.json only) | gateway/fallback/index-render composition unchanged |
| `packages/client/connection/src` | none (package.json only) | `/api` transport + browser-session auth unchanged |
| `packages/settings/settings/src` | none (package.json only) | `ctx.settings` seam unchanged (`remote-web-ui-compat` keeps working) |
| `packages/host/frontend-static/src` | none (package.json only) | `serveStatic` shape unchanged |
| `packages/client/modules/src` | none (package.json only) | **boot-graph lever intact** — `__DSH_BOOT__` + `release` field unchanged |
| `packages/client/runtime`, `packages/client/ui-slots` | none (package.json only) | no per-identity activation gate added; `uiRoleGate` remains the answer |
| `packages/api/*` controllers (session / workspace / terminal / settings / job / account / plugin-manager / plugin-market / remote-access / remotes) | **zero src diff** | **wire method registry unchanged — no new namespace or method.** `USER_ALLOWED` / `ADMIN_ONLY_*` need no edits |
| `packages/web-app` bundle | none | no new enabled rows → no duplicate `webApp` provider conflict |
| `packages/boot/app-boot` | none (package.json only) | boot compatibility admission unchanged; peers admit rc.2 |
| vendor re-release | PR #6388 moved the vendored packages to **stable**: cordis `4.0.5`, cosmokit `1.8.6`, group `1.0.5`, hmr `1.0.20`, include `1.0.10`, loader `1.0.6`, logger-console `1.0.5`, schemastery `3.18.5`, timer `1.1.7` | the npm `dsh-0-2-1-alpha-3` vendor dist-tags stayed at the alpha vintages; the **stable** releases are the correct pins now. All rc.2 dsh packages peer on `cordis ~4.0.5` (and `schemastery ~3.18.5` where used) |
| `packages/api/terminal-controller` | client-only additions (`src/client/inventory.ts`, view/recovery caching, `connection/reset` handling); `src/index.ts` + server half **zero diff** | browser-side cache; **no new wire methods** — the `terminal.*` allow-list is unchanged |
| `packages/credentials/deepseek-account-platform` | bonus-notification parsing broadened (JSON metadata, optional `title`, per-field optionality) | `account` is already admin-only wholesale in dsh-login; no change |
| NEW `packages/web/web-deepseek-api` | registers `deepseek-search-api` / `deepseek-fetch-api` into `ctx.web` (agent-side search/fetch providers behind a settings switch) | **not a typert namespace** — no wire surface for the browser; no gating needed |
| NEW `packages/client/ui-deepseek-model-label-1017` | bundled client UI plugin (temporary 1017 badge) | native, non-admin bundle → rides the default path; no `ADMIN_ONLY_UI_PLUGINS` change |
| NEW `packages/client/ui-settings-web-search` | settings card for the web-search switch | client UI only; no wire surface |

## 3. Changes shipped (0.3.5)

- **`package.json`** — `version` → `0.3.5`; the 10 `@deepseek-ai/dsh-*` devDependencies retargeted `^0.2.1-alpha.4` → `^0.2.1-rc.2`; the vendored pins moved from the alpha vintages to the **stable** releases (`@deepseek-ai/cordis ~4.0.5`, `schemastery ~3.18.5`, `cordis-plugin-include ~1.0.10`, `cordis-plugin-loader ~1.0.6`). **The plugin's own peerDependencies are unchanged**: the `>=0.2.1-alpha.1 <0.3.0-0` branches admit alpha.5 / rc.1 / rc.2 (same-tuple prereleases), and `~4.0.5-alpha.1` / `~3.18.5-alpha.1` admit the stable vendor releases.
- **No source changes.** `src/api-filter.ts` (`USER_ALLOWED`), `src/remote-guard.ts`, `src/capabilities.ts`, `src/ui-gate.ts`, `src/web-runtime.ts` and the gateway are all untouched — the wire registry and every integration point are source-identical to alpha.4.
- **`dist/*`** — rebuilt (`npm run build`) and byte-identical to the committed files (`git hash-object` matches the index for `dist/index.js`, `dist/client.js`, `dist/index.js.map`). The connection client half did not change, so no re-stamp churn.
- **Docs** — this file; README / README.zh banner + status + adaptation history + tracking/evaluation updates; `.claude/rules/changelog.md` + `gotchas.md` entries.

## 4. Verification

| step | result |
|---|---|
| `npm install` (after devDep retarget) | **no ERESOLVE** this cycle; 21 lockfile version rows moved to `0.2.1-rc.2` (+ stable vendors); node_modules confirmed **0.2.1-rc.2** for all 10 dsh packages and `cordis 4.0.5` / `schemastery 3.18.5` / `include 1.0.10` / `loader 1.0.6` |
| `npx vitest run` | **20 files / 256 tests green** (baseline on alpha.4 was also 256/256 — no test change needed) |
| `npm run build` | exit 0 (`dist/index.js` + `dist/client.js` 37134 chars + map) |
| `npm run verify:imports` | all ok |
| dist determinism | `git hash-object dist/*` == index blobs — no dist churn to commit |

As with every release: the per-user isolation guard composed over the native `typertGateway` ([`docs/compose-guard.md`](compose-guard.md)) and the two-browser isolation sign-off remain **deployment-side acceptance steps** (see [`docs/verify-option-A.md`](verify-option-A.md) §B).

## 5. Multi-user / role verdict

- **No native multi-user accounts at rc.2.** The recurring `multi.?user|multiuser|role.?based|\brbac\b` grep over `packages/` + `apps/` yields exactly one hit: `packages/api/remote-access/README.md` — the same authorize-only substrate introduced at alpha.3 (per-`Peer` policies for non-owner connections; dsh-login users are owner principals and are never gated by it). No user/account/auth package exists; `identity` still only means telemetry correlation ids.
- **Whole-UI role gating is still not natively implementable.** `packages/client/runtime` and `packages/client/ui-slots` are source-unchanged since alpha.4 (no `permission`/`isAdmin`/`isAllowed`/account-`role` concept; the client still activates every bundle unconditionally). dsh-login's own `uiRoleGate` (since 0.3.0) remains THE answer, and the boot-graph lever it uses is intact at rc.2.
- **Role-based whole-UI control is therefore feasible and already shipped in-plugin** — per-package granularity, admins/`uiRoleGate:false` see the unfiltered graph, and the `/api` allow-list (`apiBridgeAuth` + `USER_ALLOWED`) remains the real security boundary. Nothing at rc.2 changes that design; no upstream capability would simplify it.
- The new rc.2 UI bundles (`ui-deepseek-model-label-1017`, `ui-settings-web-search`) are native non-admin UI — they intentionally ride the ungated path.

**Conclusion: no new multi-user capability upstream; no source adaptation needed. 0.3.5 is a devDep/vendor retarget + documentation release.**
