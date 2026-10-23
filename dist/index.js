// src/index.ts
import { join as join3 } from "node:path";
import { credentialRef } from "@deepseek-ai/dsh-credentials";

// src/config.ts
import z from "@deepseek-ai/schemastery";
var Config = z.object({
  password: z.string().required(),
  distIndex: z.string().default(""),
  dataDir: z.string().default(""),
  sessionTtl: z.natural().default(604800),
  enabled: z.boolean().default(true),
  takeOverWebRuntime: z.boolean().default(true),
  trustedHosts: z.array(String).default([]),
  autoTrustHosts: z.boolean().default(true),
  defaultWorkspace: z.boolean().default(true),
  workspaceRoot: z.string().default(""),
  remoteWebUiCompat: z.boolean().default(true),
  remoteWebUiPublicBaseUrl: z.string().default(""),
  quietDenials: z.boolean().default(true),
  apiBridgeAuth: z.boolean().default(true),
  uiRoleGate: z.boolean().default(true)
});

// src/session.ts
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
var SAVE_DEBOUNCE_MS = 200;
var SessionStore = class {
  constructor(ttlSeconds, filePath) {
    this.ttlSeconds = ttlSeconds;
    this.filePath = filePath;
    if (filePath !== void 0) this.load();
  }
  ttlSeconds;
  filePath;
  store = /* @__PURE__ */ new Map();
  saveTimer;
  saving = Promise.resolve();
  /** Generate a 32-byte random token for `user` with its admin flag. */
  create(user, isAdmin) {
    const token = randomBytes(32).toString("hex");
    const createdAt = Date.now();
    const session = { token, user, isAdmin, createdAt, expiresAt: createdAt + this.ttlSeconds * 1e3 };
    this.store.set(token, session);
    this.scheduleSave();
    return session;
  }
  /** Return the live session for a token, or undefined. */
  verify(token) {
    if (token.length === 0) return void 0;
    const session = this.store.get(token);
    if (session === void 0) return void 0;
    if (Date.now() > session.expiresAt) {
      this.store.delete(token);
      this.scheduleSave();
      return void 0;
    }
    return session;
  }
  /** Remove a session. Revoking an unknown token is a no-op. */
  revoke(token) {
    if (this.store.delete(token)) this.scheduleSave();
  }
  /**
   * Revoke every live session belonging to `user` (user removal or password
   * change). Returns the number of sessions removed.
   */
  revokeAllFor(user) {
    let removed = 0;
    for (const [token, session] of this.store) {
      if (session.user === user) {
        this.store.delete(token);
        removed++;
      }
    }
    if (removed > 0) this.scheduleSave();
    return removed;
  }
  /**
   * Count live (unexpired) sessions per username. Used by the admin user
   * list to report online status; expired entries are swept along the way.
   */
  onlineCounts() {
    const counts = /* @__PURE__ */ new Map();
    const now = Date.now();
    let swept = false;
    for (const [token, session] of this.store) {
      if (now > session.expiresAt) {
        this.store.delete(token);
        swept = true;
        continue;
      }
      counts.set(session.user, (counts.get(session.user) ?? 0) + 1);
    }
    if (swept) this.scheduleSave();
    return counts;
  }
  /** Remove all expired sessions. */
  cleanup() {
    const now = Date.now();
    let swept = false;
    for (const [token, session] of this.store) {
      if (now > session.expiresAt) {
        this.store.delete(token);
        swept = true;
      }
    }
    if (swept) this.scheduleSave();
  }
  /** Force the pending save; resolves when the queued write settled (teardown). */
  async flush() {
    if (this.saveTimer !== void 0) {
      clearTimeout(this.saveTimer);
      this.saveTimer = void 0;
    }
    await this.saving;
    await this.writeNow();
  }
  load() {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [];
      const now = Date.now();
      for (const entry of list) {
        if (typeof entry !== "object" || entry === null) continue;
        const s = entry;
        if (typeof s.token !== "string" || typeof s.user !== "string" || typeof s.isAdmin !== "boolean") continue;
        if (typeof s.createdAt !== "number" || typeof s.expiresAt !== "number") continue;
        if (now > s.expiresAt) continue;
        this.store.set(s.token, { token: s.token, user: s.user, isAdmin: s.isAdmin, createdAt: s.createdAt, expiresAt: s.expiresAt });
      }
    } catch {
    }
  }
  scheduleSave() {
    if (this.filePath === void 0 || this.saveTimer !== void 0) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = void 0;
      this.saving = this.writeNow();
    }, SAVE_DEBOUNCE_MS);
  }
  async writeNow() {
    if (this.filePath === void 0) return;
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, `${JSON.stringify([...this.store.values()])}
`, { encoding: "utf8", mode: 384 });
    } catch {
    }
  }
};

// src/users.ts
import { randomBytes as randomBytes2, scryptSync, timingSafeEqual } from "node:crypto";
var USERNAME_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;
var KEY_LEN = 64;
function hashPassword(password, saltHex) {
  return scryptSync(password, Buffer.from(saltHex, "hex"), KEY_LEN).toString("hex");
}
function constantTimeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
var UserStore = class {
  constructor(credentials, ref) {
    this.credentials = credentials;
    this.ref = ref;
  }
  credentials;
  ref;
  async list() {
    const resolved = await this.credentials.resolve(this.ref);
    if (resolved === void 0) return [];
    try {
      const parsed = JSON.parse(resolved.value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  async isEmpty() {
    return (await this.list()).length === 0;
  }
  async create(username, password, isAdmin) {
    if (!USERNAME_PATTERN.test(username)) throw new Error("invalid username");
    if (password.length === 0) throw new Error("password must not be empty");
    const records = await this.list();
    if (records.some((u) => u.username === username)) throw new Error(`user "${username}" already exists`);
    const salt = randomBytes2(16).toString("hex");
    const record = {
      username,
      salt,
      hash: hashPassword(password, salt),
      isAdmin: records.length === 0 ? true : isAdmin,
      createdAt: Date.now()
    };
    await this.credentials.set(this.ref, JSON.stringify([...records, record]));
    return record;
  }
  async verify(username, password) {
    const record = (await this.list()).find((u) => u.username === username);
    if (record === void 0) return void 0;
    if (record.disabled === true) return void 0;
    return constantTimeEqualHex(hashPassword(password, record.salt), record.hash) ? record : void 0;
  }
  /**
   * Set or clear the disabled flag for `username`. The caller (admin API)
   * owns the last-enabled-admin guard and session revocation.
   */
  async setDisabled(username, disabled) {
    const records = await this.list();
    const record = records.find((u) => u.username === username);
    if (record === void 0) throw new Error(`unknown user "${username}"`);
    if (disabled) record.disabled = true;
    else delete record.disabled;
    await this.credentials.set(this.ref, JSON.stringify(records));
  }
  /**
   * Stamp `lastLoginAt` for a verified login. Best-effort audit field:
   * unknown users are a silent no-op so this can never fail a login.
   */
  async touchLastLogin(username) {
    const records = await this.list();
    const record = records.find((u) => u.username === username);
    if (record === void 0) return;
    record.lastLoginAt = Date.now();
    await this.credentials.set(this.ref, JSON.stringify(records));
  }
  async setPassword(username, password) {
    if (password.length === 0) throw new Error("password must not be empty");
    const records = await this.list();
    const record = records.find((u) => u.username === username);
    if (record === void 0) throw new Error(`unknown user "${username}"`);
    record.salt = randomBytes2(16).toString("hex");
    record.hash = hashPassword(password, record.salt);
    await this.credentials.set(this.ref, JSON.stringify(records));
  }
  async remove(username) {
    const records = await this.list();
    const next = records.filter((u) => u.username !== username);
    if (next.length === records.length) throw new Error(`unknown user "${username}"`);
    await this.credentials.set(this.ref, JSON.stringify(next));
  }
};

// src/ownership.ts
import { mkdir as mkdir2, writeFile as writeFile2 } from "node:fs/promises";
import { readFileSync as readFileSync2 } from "node:fs";
import { dirname as dirname2 } from "node:path";
var SAVE_DEBOUNCE_MS2 = 200;
var OwnershipIndex = class {
  constructor(filePath) {
    this.filePath = filePath;
    try {
      const raw = readFileSync2(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string") this.map.set(k, v);
        }
      }
    } catch {
    }
  }
  filePath;
  map = /* @__PURE__ */ new Map();
  saveTimer;
  saving = Promise.resolve();
  record(sessionId, username) {
    this.map.set(sessionId, username);
    this.scheduleSave();
  }
  lookup(sessionId) {
    return this.map.get(sessionId);
  }
  has(sessionId) {
    return this.map.has(sessionId);
  }
  knownUsernames() {
    return new Set(this.map.values());
  }
  /** All recorded [sessionId, username] pairs (snapshot). */
  entries() {
    return [...this.map.entries()];
  }
  /** Force the pending save; resolves when the file write settled. */
  async flush() {
    if (this.saveTimer !== void 0) {
      clearTimeout(this.saveTimer);
      this.saveTimer = void 0;
    }
    await this.saving;
    await this.writeNow();
  }
  scheduleSave() {
    if (this.saveTimer !== void 0) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = void 0;
      this.saving = this.writeNow();
    }, SAVE_DEBOUNCE_MS2);
  }
  async writeNow() {
    try {
      await mkdir2(dirname2(this.filePath), { recursive: true });
      await writeFile2(this.filePath, `${JSON.stringify(Object.fromEntries(this.map))}
`, "utf8");
    } catch {
    }
  }
};

// src/hosts.ts
import { mkdir as mkdir3, writeFile as writeFile3 } from "node:fs/promises";
import { readFileSync as readFileSync3 } from "node:fs";
import { dirname as dirname3 } from "node:path";
var SAVE_DEBOUNCE_MS3 = 200;
var MAX_HOST_LENGTH = 255;
function canonicalAuthority(host) {
  let entryUrl;
  try {
    entryUrl = new URL(`http://${host}`);
  } catch {
    return void 0;
  }
  const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${host}`).port;
  return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}
function isBareAuthority(host) {
  const c = canonicalAuthority(host);
  return c !== void 0 && c === host.toLowerCase() && host.length <= MAX_HOST_LENGTH;
}
function isLoopbackCanonical(authority) {
  const hostname = (authority.split(":")[0] ?? "").toLowerCase();
  if (hostname === "localhost") return true;
  if (hostname === "::1") return true;
  if (/^127\./.test(hostname)) return true;
  if (hostname === "0.0.0.0") return true;
  if (/^\[?::1\]?/.test(authority)) return true;
  return false;
}
var TrustedHosts = class {
  constructor(filePath) {
    this.filePath = filePath;
    try {
      const raw = readFileSync3(filePath, "utf8");
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed) ? parsed : parsed !== null && typeof parsed === "object" ? Object.keys(parsed) : [];
      for (const entry of entries) {
        if (typeof entry === "string") {
          const c = canonicalAuthority(entry);
          if (c !== void 0) this.set.add(c);
        }
      }
    } catch {
    }
  }
  filePath;
  set = /* @__PURE__ */ new Set();
  saveTimer;
  /** Tail of a single serialized write queue; writes never overlap. */
  saving = Promise.resolve();
  /** Canonicalize an authority; undefined when not a bare authority. */
  canonicalize(host) {
    return canonicalAuthority(host);
  }
  /** Whether this authority is currently trusted (canonical comparison). */
  has(authority) {
    const c = canonicalAuthority(authority);
    return c !== void 0 && this.set.has(c);
  }
  /**
   * Add one (auto-learned) Host authority, skipping loopback, invalid and
   * non-bare inputs. Returns true when newly recorded. Idempotent.
   */
  learn(host) {
    if (!isBareAuthority(host)) return false;
    const c = canonicalAuthority(host);
    if (isLoopbackCanonical(c)) return false;
    if (this.set.has(c)) return false;
    this.set.add(c);
    this.scheduleSave();
    return true;
  }
  /** Add a validated authority (admin manual add). Returns true when new. */
  add(authority) {
    if (!isBareAuthority(authority)) return false;
    const c = canonicalAuthority(authority);
    if (isLoopbackCanonical(c)) return false;
    if (this.set.has(c)) return false;
    this.set.add(c);
    this.scheduleSave();
    return true;
  }
  /** Remove an authority; returns true when it existed. Idempotent. */
  remove(authority) {
    const c = canonicalAuthority(authority);
    const key = c ?? authority;
    const existed = this.set.delete(key);
    if (existed) this.scheduleSave();
    return existed;
  }
  /** Snapshot of the currently trusted authorities. */
  list() {
    return [...this.set];
  }
  /** Force the pending save; resolves when the queued write settled. */
  async flush() {
    if (this.saveTimer !== void 0) {
      clearTimeout(this.saveTimer);
      this.saveTimer = void 0;
    }
    this.saving = this.saving.then(() => this.writeNow());
    await this.saving;
  }
  scheduleSave() {
    if (this.saveTimer !== void 0) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = void 0;
      this.saving = this.saving.then(() => this.writeNow());
    }, SAVE_DEBOUNCE_MS3);
  }
  async writeNow() {
    try {
      await mkdir3(dirname3(this.filePath), { recursive: true });
      await writeFile3(this.filePath, `${JSON.stringify(this.list())}
`, "utf8");
    } catch {
    }
  }
};

// src/boolean-setting.ts
import { mkdir as mkdir4, writeFile as writeFile4 } from "node:fs/promises";
import { readFileSync as readFileSync4 } from "node:fs";
import { dirname as dirname4 } from "node:path";
var SAVE_DEBOUNCE_MS4 = 200;
var BooleanSetting = class {
  constructor(filePath, initial) {
    this.filePath = filePath;
    this.enabled = initial;
    try {
      const raw = readFileSync4(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object" && typeof parsed.enabled === "boolean") {
        this.enabled = parsed.enabled;
      }
    } catch {
    }
  }
  filePath;
  enabled;
  saveTimer;
  /** Tail of a single serialized write queue; writes never overlap. */
  saving = Promise.resolve();
  /** Whether the toggle is currently on. */
  get() {
    return this.enabled;
  }
  /** Set the flag and persist it (best-effort). Returns the new value. */
  set(enabled) {
    this.enabled = enabled;
    this.scheduleSave();
    return this.enabled;
  }
  /** Force the pending save; resolves when the queued write settled. */
  async flush() {
    if (this.saveTimer !== void 0) {
      clearTimeout(this.saveTimer);
      this.saveTimer = void 0;
    }
    this.saving = this.saving.then(() => this.writeNow());
    await this.saving;
  }
  scheduleSave() {
    if (this.saveTimer !== void 0) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = void 0;
      this.saving = this.saving.then(() => this.writeNow());
    }, SAVE_DEBOUNCE_MS4);
  }
  async writeNow() {
    try {
      await mkdir4(dirname4(this.filePath), { recursive: true });
      await writeFile4(this.filePath, `${JSON.stringify({ enabled: this.enabled })}
`, "utf8");
    } catch {
    }
  }
};

// src/workspace-setting.ts
var DefaultWorkspaceSetting = class extends BooleanSetting {
};

// src/workspace-root-setting.ts
import { mkdir as mkdir5, writeFile as writeFile5 } from "node:fs/promises";
import { readFileSync as readFileSync5 } from "node:fs";
import { dirname as dirname5, isAbsolute, normalize } from "node:path";
var SAVE_DEBOUNCE_MS5 = 200;
var MAX_WORKSPACE_ROOT_LENGTH = 4096;
function normalizeWorkspaceRoot(value) {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_WORKSPACE_ROOT_LENGTH || trimmed.includes("\0")) return void 0;
  if (!isAbsolute(trimmed)) return void 0;
  const normalized = normalize(trimmed);
  const trimmedEnd = normalized.replace(/[/\\]+$/, "");
  return trimmedEnd !== "" && isAbsolute(trimmedEnd) && !/^[A-Za-z]:$/.test(trimmedEnd) ? trimmedEnd : normalized;
}
var WorkspaceRootSetting = class {
  /**
   * @param filePath JSON file holding `{ path: string }`.
   * @param fallback Root used while no admin override is set (the resolved config value).
   */
  constructor(filePath, fallback) {
    this.filePath = filePath;
    this.fallback = fallback;
    try {
      const parsed = JSON.parse(readFileSync5(filePath, "utf8"));
      const path = parsed !== null && typeof parsed === "object" ? parsed.path : void 0;
      if (typeof path === "string") this.override = normalizeWorkspaceRoot(path);
    } catch {
    }
  }
  filePath;
  fallback;
  /** Admin override; undefined means "use the fallback". */
  override;
  saveTimer;
  /** Tail of a single serialized write queue; writes never overlap. */
  saving = Promise.resolve();
  /** The root currently in effect. */
  get() {
    return this.override ?? this.fallback;
  }
  /** Whether the effective root is the fallback (no admin override). */
  isDefault() {
    return this.override === void 0;
  }
  /**
   * Set the admin override (`''` clears it back to the fallback) and persist
   * it. Returns the effective root, or undefined when `path` is invalid (the
   * current value is then left unchanged).
   */
  set(path) {
    if (path.trim() === "") {
      this.override = void 0;
    } else {
      const normalized = normalizeWorkspaceRoot(path);
      if (normalized === void 0) return void 0;
      this.override = normalized;
    }
    this.scheduleSave();
    return this.get();
  }
  /** Force the pending save; resolves when the queued write settled. */
  async flush() {
    if (this.saveTimer !== void 0) {
      clearTimeout(this.saveTimer);
      this.saveTimer = void 0;
    }
    this.saving = this.saving.then(() => this.writeNow());
    await this.saving;
  }
  scheduleSave() {
    if (this.saveTimer !== void 0) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = void 0;
      this.saving = this.saving.then(() => this.writeNow());
    }, SAVE_DEBOUNCE_MS5);
  }
  async writeNow() {
    try {
      await mkdir5(dirname5(this.filePath), { recursive: true });
      await writeFile5(this.filePath, `${JSON.stringify({ path: this.override ?? "" })}
`, "utf8");
    } catch {
    }
  }
};

// src/remote-web-ui-compat.ts
var REMOTE_WEB_UI_NAMESPACE = "remote-web-ui";
var RemoteWebUiCompat = class {
  constructor(deps) {
    this.deps = deps;
  }
  deps;
  /**
   * Apply the compat document to remote-web-ui's settings namespace.
   * @param compatEnabled - when true, mount the host routes and open the pairing
   * gate; when false, restore the pairing requirement only.
   * @param publicBaseUrl - optional public base URL (e.g. `http://host:port`) to
   * write so remote-web-ui's `/api/pair/*` fence trusts the public origin. Only
   * written when compat is on and the value is a non-empty http(s) URL.
   */
  async apply(compatEnabled, publicBaseUrl) {
    const settings = this.deps.getSettings();
    if (settings === void 0) return "skipped";
    let patch;
    if (compatEnabled) {
      patch = { enabled: true, requirePairingForLan: false };
      if (typeof publicBaseUrl === "string" && isHttpUrl(publicBaseUrl)) patch.publicBaseUrl = publicBaseUrl;
    } else {
      patch = { requirePairingForLan: true };
    }
    try {
      await settings.update(REMOTE_WEB_UI_NAMESPACE, patch);
      return "ok";
    } catch (error) {
      if (isUnregisteredNamespace(error)) return "unregistered";
      throw error;
    }
  }
};
function isUnregisteredNamespace(error) {
  const message = String(error instanceof Error ? error.message : error);
  return message.includes("not registered") || message.includes("No configurable plugin entry");
}
function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}
async function applyWithRetry(compat, enabled, publicBaseUrl, attempts = 60, delayMs = 250) {
  let last = "unregistered";
  for (let i = 0; i < attempts; i++) {
    const result = await compat.apply(enabled, publicBaseUrl);
    if (result === "ok") return "ok";
    last = result;
    await new Promise((resolve2) => setTimeout(resolve2, delayMs));
  }
  return last;
}

// src/gateway.ts
import { readFile } from "node:fs/promises";
import { dirname as dirname6 } from "node:path";
import { serveStatic } from "@deepseek-ai/dsh-host-frontend-static";

// src/auth.ts
var COOKIE_NAME = "dsh_session";
function extractSessionToken(cookieHeader) {
  if (cookieHeader === void 0) return void 0;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${COOKIE_NAME}=`)) {
      return trimmed.slice(COOKIE_NAME.length + 1);
    }
  }
  return void 0;
}
function buildCookieHeader(token, ttlSeconds) {
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${String(ttlSeconds)}`;
}
function buildClearCookieHeader() {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

// src/api-filter.ts
var USER_ALLOWED = /* @__PURE__ */ new Set([
  "session.list",
  "session.search",
  "session.create",
  "session.history",
  "session.models",
  "session.selectModel",
  "session.rename",
  "session.fork",
  "session.prompt",
  "session.attachment",
  "session.updateQueue",
  "session.cancel",
  "subagent.list",
  "subagent.history",
  "subagent.prompt",
  "subagent.interrupt",
  "host.describe",
  "workspace.list",
  "workspace.create",
  "workspace.rename",
  "workspace.delete",
  "workspace.insertBefore",
  "workspace.insertSessionBefore",
  "workspace.archiveSession",
  // DSH 0.1.6: restore one archived Session (pairs with archiveSession above).
  "workspace.unarchiveSession",
  // DSH 0.1.7: sidebar session pinning (pinned sessions ride the workspace
  // tree like rename/archive; both carry the workspace/session ids the guard's
  // GUARDED_ID_FIELDS already ownership-check).
  "workspace.pinSession",
  "workspace.unpinSession",
  // DSH 0.1.7: the job controller (`dsh-api-job-controller`, typert namespace
  // `job`; SessionJob moved here out of `session`). `list`/`follow` are
  // reconnect-safe streams and `kill` is the human stop button — the same
  // trust boundary as `session.prompt`. Every request carries `sessionId`
  // (JobFollowRequest omits it only for unowned jobs, which any caller may
  // observe), ownership-checked through the guard's GUARDED_ID_FIELDS. Note:
  // `jobId` must NOT be added to the guarded fields — job ids are not in the
  // ownership sidecar and every id collected must resolve owned, which would
  // deny legitimate kills.
  "job.list",
  "job.follow",
  "job.kill",
  // DSH 0.1.6: the sidebar terminal (`dsh-api-terminal-controller`, typert
  // namespace `terminal`). Every method is session-agent-scoped by the Gateway
  // (the `agent` argument is supplied by the Gateway itself, never by the
  // browser), so it stays inside the caller's own agent subtree — the same
  // trust boundary as `session.prompt` (an agent can already run shell for the
  // user). `terminal.list` addresses a session explicitly and is ownership-
  // checked through the guard's GUARDED_ID_FIELDS (`sessionId`).
  "terminal.environment",
  "terminal.shells",
  "terminal.list",
  "terminal.create",
  // DSH 0.2.1-alpha.3: `terminal.follow` became the bidirectional
  // `terminal.attach` stream — uplink write/resize now ride the attach stream
  // itself as sequenced commands, so the standalone `terminal.write` and
  // `terminal.resize` methods no longer exist on the wire.
  "terminal.attach",
  "terminal.rename",
  "terminal.close",
  // DSH 0.1.6-alpha.2: terminal retention across reconnects. `terminal.retain`
  // addresses a session explicitly (`sessionId`) and is ownership-checked
  // through GUARDED_ID_FIELDS like terminal.list. NOTE: since alpha.2 user
  // terminals run with the execution environment's system-user permissions
  // (no Agent sandbox), a deployment wanting stricter posture subtracts the
  // terminal.* entries from this set before wrapping (see docs/adapt-dsh-0.1.6-alpha.2.md).
  "terminal.retain",
  // DSH 0.2.1-alpha.3: the native remote-access client mounts on every page
  // and opens its `remoteAccess/follow` snapshot stream. The gateway always
  // allows this method and the answer only ever contains the caller's own
  // grants (an owner principal gets the owner baseline), so admitting it
  // here just keeps that mount silent instead of surfacing a denied-stream
  // error on every page load.
  "remoteAccess.follow",
  // DSH 0.1.6-alpha.2: the right Sidebar's document preview. The read surface
  // of `workspaceFiles` + the Office→PDF converter (`officeToPdf`) are what
  // every user's document/Office preview tab calls; each method's first wire
  // argument is the scoped session identity (`workspaceFileScopeId`), resolved
  // by the Gateway's workspaceFileScope lookup and ownership-checked through
  // GUARDED_ID_FIELDS. Read-only: no write/convert-bytes method is exposed to
  // the wire surface listed here.
  "workspaceFiles.read",
  "workspaceFiles.readAll",
  "workspaceFiles.readBytes",
  "workspaceFiles.readRelated",
  "workspaceFiles.stat",
  "workspaceFiles.list",
  "workspaceFiles.changes",
  "officeToPdf.render",
  "officeToPdf.generation",
  "skill.list",
  "llm.providers",
  "llm.models",
  "goal.create",
  "goal.edit",
  "goal.pause",
  "goal.resume",
  "goal.complete",
  "goal.clear",
  "respond"
]);

// src/capabilities.ts
function userAllowedMethods() {
  return [...USER_ALLOWED];
}
var USER_DOMAINS = [
  "session",
  "workspace",
  "goals",
  "subagents",
  "llm",
  "host",
  "skill",
  "api",
  // DSH 0.1.6: the sidebar terminal (dsh-api-terminal-controller) — every
  // method is session-agent-scoped by the Gateway, so it rides the caller's
  // own agent subtree like `session` does.
  "terminal",
  // DSH 0.1.6-alpha.2: the right Sidebar's document preview — the read-only
  // workspaceFiles surface plus the Office→PDF converter, both scoped to the
  // viewed session identity (workspaceFileScopeId) the Gateway resolves.
  "workspaceFiles",
  "officeToPdf",
  // DSH 0.1.7: the job controller (SessionJob moved here out of `session`) —
  // list/follow/kill with the request's sessionId ownership-checked by the
  // guard (USER_ALLOWED carries job.list/job.follow/job.kill).
  "job"
];
var ADMIN_ONLY_UI_PLUGINS = [
  "@linxin666/dsh-client-ui-plugin-manager",
  "@linxin666/dsh-client-ui-skill-explorer",
  "@linxin666/dsh-client-ui-skin-center",
  "@linxin666/dsh-client-ui-market",
  "@linxin666/dsh-client-ui-git-graph",
  "@linxin666/dsh-client-ui-community-plugins",
  "@linxin666/dsh-client-ui-web-ui-settings",
  "@linxin666/dsh-client-ui-aionui-panel",
  "@linxin666/dsh-client-ui-task-board",
  "@linxin666/dsh-desktop-launcher",
  "@linxin666/dsh-doctor",
  "@linxin666/dsh-pet",
  "@linxin666/dsh-ssh",
  "@linxin666/dsh-perf",
  "@linxin666/dsh-liangshen"
];
var CORE_UI_PLUGINS = [
  "@islibaodong/dsh-login"
];
function deriveCapabilities(user) {
  if (user.isAdmin) {
    return {
      methods: userAllowedMethods().concat(adminOnlyMethods()),
      domains: allDomains(),
      uiPlugins: CORE_UI_PLUGINS.concat(allUiPlugins())
    };
  }
  return {
    methods: userAllowedMethods(),
    domains: [...USER_DOMAINS],
    uiPlugins: [...CORE_UI_PLUGINS]
  };
}
function adminOnlyMethods() {
  return [
    "credentials.list",
    "credentials.get",
    "credentials.set",
    "credentials.delete",
    // DSH 0.1.7: exact wire-method names of the settings controller
    // (describe/update/replace — `settings.list`/`settings.reset` never
    // existed on the wire; `canOpenAgentPresetDirectory` was removed in 0.1.7).
    "settings.describe",
    "settings.update",
    "settings.replace",
    "agentPreset.list",
    "agentPreset.read",
    "agentPreset.write",
    // DSH 0.1.7-rc.1: the preset registry's document viewer
    // (`agentPresets.readDocument` — view one declaration's child plugin
    // list). Same strictly-admin posture as the rest of the namespace.
    "agentPresets.readDocument",
    "host.path",
    "host.system",
    // DSH 0.1.6-alpha.2: the native plugin manager (packages/boot/
    // plugin-manager, typert namespace `pluginManager`) — installs, enables,
    // disables, and removes profile bundles. Strictly admin-only: never added
    // to USER_ALLOWED, and ADMIN_ONLY_NAMESPACES denies it for ordinary users.
    "pluginManager.listPlugins",
    "pluginManager.listBundles",
    "pluginManager.inspect",
    "pluginManager.setPluginEnabled",
    "pluginManager.setBundleEnabled",
    "pluginManager.installBundle",
    "pluginManager.cancelInstall",
    "pluginManager.removeBundle",
    // DSH 0.1.7: the account controller (typert namespace `account`) — the
    // process-wide upstream DeepSeek Platform grant: browser sign-in, cancel,
    // and revoke are whole-instance operations; even the read projections
    // (state/profile/recharge-wallet balance) are the operator's data.
    // Ordinary users are denied by default; advertised here for admins.
    // 0.1.7-rc.2 adds `watchExpiry` (credential-expiry notice stream, commit
    // 8f180cf45f): same strictly-admin posture — it streams the operator's
    // grant-expiry events to the account page.
    "account.getState",
    "account.getProfile",
    "account.getBalance",
    "account.startSignIn",
    "account.cancelSignIn",
    "account.signOut",
    "account.watch",
    "account.watchExpiry",
    // DSH 0.1.7: the plugin-registry probe the new bundled plugin-manager UI
    // uses (client/ui-plugin-manager, service id `pluginRegistryProbe`) —
    // same strictly-admin posture as pluginManager.
    "pluginRegistryProbe.list",
    // DSH 0.2.1-alpha.4: the plugin market (packages/boot/plugin-market,
    // typert namespace `pluginMarket`) — reads and reconfigures the
    // instance-wide market index list its installs resolve against.
    // Strictly admin-only: never added to USER_ALLOWED, and
    // ADMIN_ONLY_NAMESPACES denies it for ordinary users.
    "pluginMarket.listIndexes",
    "pluginMarket.setIndexes",
    "pluginMarket.search"
  ];
}
function allDomains() {
  return [
    ...USER_DOMAINS,
    "credentials",
    "settings",
    "agentPresets",
    "pluginManager",
    // DSH 0.1.7: the account controller's namespace (admin-only; see
    // remote-guard's ADMIN_ONLY_NAMESPACES and the two-segment deny list).
    "account",
    // DSH 0.2.1-alpha.4: the plugin market's namespace (admin-only; see
    // remote-guard's ADMIN_ONLY_NAMESPACES and the two-segment deny list).
    "pluginMarket"
  ];
}
function allUiPlugins() {
  return [...CORE_UI_PLUGINS, ...ADMIN_ONLY_UI_PLUGINS];
}

// src/ui-gate.ts
var BOOT_MARKER = '<script>globalThis["__DSH_BOOT__"] = ';
var DENIED_IDS = new Set(ADMIN_ONLY_UI_PLUGINS);
function filterBootGraph(graph) {
  if (typeof graph !== "object" || graph === null) return null;
  const shape = graph;
  if (typeof shape.rev !== "string" || !Array.isArray(shape.entries) || !Array.isArray(shape.batches)) {
    return null;
  }
  const kept = [];
  const removed = /* @__PURE__ */ new Set();
  for (const row of shape.entries) {
    if (typeof row !== "object" || row === null) return null;
    const entry = row;
    if (typeof entry.id !== "string") return null;
    if (DENIED_IDS.has(entry.id)) {
      removed.add(entry.id);
      continue;
    }
    kept.push(row);
  }
  const batches = [];
  for (const row of shape.batches) {
    if (typeof row !== "object" || row === null) return null;
    const batch = row;
    if (!Array.isArray(batch.entries) || batch.entries.some((id) => typeof id !== "string")) return null;
  }
  if (removed.size === 0) return graph;
  for (const row of kept) {
    for (const field of ["inject", "external"]) {
      const value = row[field];
      if (value === void 0) continue;
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
      if (value.some((item) => removed.has(item) || removed.has(stripClient(item)))) return null;
    }
  }
  for (const row of shape.batches) {
    const batch = row;
    const remaining = batch.entries.filter((id) => typeof id === "string" && !removed.has(id));
    if (remaining.length === 0) continue;
    batches.push(
      remaining.length === batch.entries.length ? row : { ...row, entries: remaining }
    );
  }
  return { ...graph, entries: kept, batches };
}
function stripClient(spec) {
  return spec.endsWith("/client") ? spec.slice(0, -"/client".length) : spec;
}
function applyUiGate(html) {
  const start = html.indexOf(BOOT_MARKER);
  if (start === -1) return html;
  const jsonStart = start + BOOT_MARKER.length;
  const end = html.indexOf("</script>", jsonStart);
  if (end === -1) return html;
  const raw = html.slice(jsonStart, end);
  let graph;
  try {
    graph = JSON.parse(raw);
  } catch {
    return html;
  }
  const filtered = filterBootGraph(graph);
  if (filtered === null) return html;
  const rebuilt = JSON.stringify(filtered).replaceAll("<", "\\u003c");
  return `${html.slice(0, jsonStart)}${rebuilt}${html.slice(end)}`;
}

// src/gateway.ts
function indexRenderer(ctx, distIndex) {
  return async () => {
    const body = await readFile(distIndex, "utf8");
    const webServer = ctx.webServer;
    const render = webServer.renderIndex ?? webServer.applyIndexTaps.bind(webServer);
    return render.call(webServer, body);
  };
}
function createAuthorizeIndex(ctx) {
  return (req, res) => {
    const connection = ctx.get("connection");
    if (connection === void 0) return true;
    const auth = connection.browserAuth ?? connection;
    const hasTokenParam = req.url !== void 0 && /[?&]token=/.test(req.url);
    if (!hasTokenParam && typeof auth.isAuthenticated === "function" && !auth.isAuthenticated(req) && typeof auth.launchToken === "string" && auth.launchToken.length > 0) {
      res.writeHead(302, {
        Location: `/?token=${encodeURIComponent(auth.launchToken)}`,
        "cache-control": "no-store"
      });
      res.end();
      return false;
    }
    return connection.authorizeIndex(req, res);
  };
}
function createGatewayHandler(ctx, config, store) {
  const distRoot = dirname6(config.distIndex);
  const renderIndex = indexRenderer(ctx, config.distIndex);
  const authorizeIndex = createAuthorizeIndex(ctx);
  return async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    const token = extractSessionToken(req.headers.cookie);
    const session = token === void 0 ? void 0 : store.verify(token);
    if (session === void 0) {
      res.writeHead(302, { Location: "/login" });
      res.end();
      return;
    }
    store.cleanup();
    const rawPath = new URL(req.url ?? "/", "http://x").pathname;
    const render = config.uiRoleGate && !session.isAdmin ? async () => applyUiGate(await renderIndex()) : renderIndex;
    await serveStatic(
      decodeURIComponent(rawPath),
      res,
      distRoot,
      config.distIndex,
      () => authorizeIndex(req, res),
      render
    );
  };
}

// src/path-fence.ts
import { isAbsolute as isAbsolute2, relative, resolve, sep } from "node:path";
var PATH_FENCED_METHODS = /* @__PURE__ */ new Set(["workspace.create", "session.create", "session.fork"]);
var PATH_REQUIRED_METHODS = /* @__PURE__ */ new Set(["workspace.create"]);
var MAX_NODES = 2e3;
function collectAbsolutePaths(value) {
  const found = [];
  const stack = [value];
  let visited = 0;
  while (stack.length > 0 && visited < MAX_NODES) {
    const node = stack.pop();
    visited += 1;
    if (typeof node === "string") {
      if (node.length > 0 && isAbsolute2(node)) found.push(node);
    } else if (Array.isArray(node)) {
      stack.push(...node);
    } else if (node !== null && typeof node === "object") {
      stack.push(...Object.values(node));
    }
  }
  return stack.length === 0 ? found : void 0;
}
function isInsideFolder(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute2(rel);
}
function payloadWithinFolder(endpoint, payload, folder) {
  if (!PATH_FENCED_METHODS.has(endpoint)) return true;
  const paths = collectAbsolutePaths(payload);
  if (paths === void 0) return false;
  if (PATH_REQUIRED_METHODS.has(endpoint) && paths.length === 0) return false;
  return paths.every((path) => isInsideFolder(folder, path));
}

// src/bridge-list-filter.ts
function extractSessionItems(value) {
  const items = envelopeValue(value);
  if (items === void 0) return void 0;
  const record = items;
  if (!Array.isArray(record.items)) return void 0;
  const headers = [];
  for (const item of record.items) {
    if (typeof item !== "object" || item === null) return void 0;
    const sessionId = item.sessionId;
    if (typeof sessionId !== "string" || sessionId === "") return void 0;
    const parentSessionId = item.parentSessionId;
    headers.push(
      typeof parentSessionId === "string" && parentSessionId !== "" ? { sessionId, parentSessionId } : { sessionId }
    );
  }
  return headers;
}
function envelopeValue(value) {
  if (typeof value !== "object" || value === null) return void 0;
  const result = value.result;
  if (typeof result !== "object" || result === null) return value;
  const record = result;
  return record.ok === true ? record.value : void 0;
}
function ownedSessionClosure(username, items, ownership) {
  const owned = /* @__PURE__ */ new Set();
  for (const [sid, owner] of ownership.entries()) {
    if (owner === username) owned.add(sid);
  }
  const byParent = /* @__PURE__ */ new Map();
  for (const item of items) {
    if (item.parentSessionId === void 0) continue;
    const list = byParent.get(item.parentSessionId);
    if (list === void 0) byParent.set(item.parentSessionId, [item.sessionId]);
    else list.push(item.sessionId);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const sid of [...owned]) {
      for (const child of byParent.get(sid) ?? []) {
        if (!owned.has(child)) {
          owned.add(child);
          ownership.record(child, username);
          grew = true;
        }
      }
    }
  }
  return owned;
}
async function probeOwnedSessionIds(username, ownership, gateway) {
  let items = [];
  if (gateway !== void 0) {
    try {
      const value = await gateway.invoke({ namespace: "session", method: "list", args: {} });
      const extracted = extractSessionItems(value);
      if (extracted !== void 0) items = extracted;
    } catch {
    }
  }
  return ownedSessionClosure(username, items, ownership);
}
function filterSessionItemsValue(value, owned) {
  if (typeof value !== "object" || value === null) return void 0;
  const payload = envelopeValue(value);
  if (payload === void 0) return void 0;
  const record = payload;
  if (!Array.isArray(record.items)) return void 0;
  const items = [];
  for (const item of record.items) {
    if (typeof item !== "object" || item === null) return void 0;
    const sessionId = item.sessionId;
    if (typeof sessionId !== "string" || sessionId === "") return void 0;
    if (owned.has(sessionId)) items.push(item);
  }
  const filtered = { ...payload, items };
  if (value.result !== void 0) {
    return { ...value, result: { ok: true, value: filtered } };
  }
  return filtered;
}
function filterWorkspaceListValue(value, owned) {
  if (typeof value !== "object" || value === null) return void 0;
  const payload = envelopeValue(value);
  if (payload === void 0) return void 0;
  const record = payload;
  if (!Array.isArray(record.items) || !Array.isArray(record.archivedSessionIds)) return void 0;
  const items = [];
  for (const workspace of record.items) {
    if (typeof workspace !== "object" || workspace === null) return void 0;
    const sessionIds = workspace.sessionIds;
    if (!Array.isArray(sessionIds)) return void 0;
    const kept = sessionIds.filter((id) => typeof id === "string" && owned.has(id));
    if (kept.length > 0) items.push({ ...workspace, sessionIds: kept });
  }
  const archivedSessionIds = record.archivedSessionIds.filter(
    (id) => typeof id === "string" && owned.has(id)
  );
  const filtered = { ...payload, items, archivedSessionIds };
  if (value.result !== void 0) {
    return { ...value, result: { ok: true, value: filtered } };
  }
  return filtered;
}
var RECORD_METHODS = /* @__PURE__ */ new Set(["session.create", "session.fork", "workspace.create"]);
var FILTER_METHODS = /* @__PURE__ */ new Set(["session.list", "session.search", "workspace.list"]);
function recordOwnershipFromResponse(envelope, username, ownership) {
  const payload = envelopeValue(envelope);
  if (typeof payload !== "object" || payload === null) return;
  const sessionId = payload.sessionId;
  const id = payload.id;
  if (typeof sessionId === "string" && sessionId !== "") {
    ownership.record(sessionId, username);
    return;
  }
  if (typeof id === "string" && id !== "") ownership.record(id, username);
}

// src/api-bridge-auth.ts
var DENY_BODY_LIMIT_BYTES = 1 << 20;
function endpointFromUrl(url) {
  if (url === void 0) return void 0;
  const path = url.split("?")[0].split("#")[0];
  if (!path.startsWith("/api/")) return void 0;
  return path.slice("/api/".length).split("/").join(".");
}
function createApiBridgeAuth(deps) {
  const deny403 = (response) => {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("forbidden");
  };
  const denyQuiet = async (request, response, knownRpcId) => {
    const rpcId = knownRpcId ?? await readRequestRpcId(request);
    if (rpcId === void 0) {
      deny403(response);
      return;
    }
    const body = JSON.stringify({
      type: "server-response",
      rpcId,
      result: { ok: false, error: { code: "forbidden", message: "not permitted for this user", details: {} } }
    });
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body))
    });
    response.end(body);
  };
  return async (request, response, next) => {
    const token = extractSessionToken(request.headers.cookie);
    const session = token === void 0 ? void 0 : store_verify(deps, token);
    if (session === void 0) {
      response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
      response.end("unauthorized");
      return;
    }
    deps.store.cleanup();
    const user = { username: session.user, isAdmin: session.isAdmin };
    if (request.method !== "POST") return next();
    if (user.isAdmin) {
      const adminEndpoint = endpointFromUrl(request.url);
      if (adminEndpoint !== void 0 && RECORD_METHODS.has(adminEndpoint)) {
        attachResponseTee(response, {
          endpoint: adminEndpoint,
          username: user.username,
          ownership: deps.ownership,
          owned: void 0
        });
      }
      return next();
    }
    if (deps.provisioner !== void 0) {
      void deps.provisioner.ensure(user).catch(() => {
      });
    }
    const endpoint = endpointFromUrl(request.url);
    if (endpoint === void 0) return next();
    if (!USER_ALLOWED.has(endpoint)) {
      if (deps.quietDenials) {
        await denyQuiet(request, response);
        return;
      }
      deny403(response);
      return;
    }
    if (deps.userFolder !== void 0 && PATH_FENCED_METHODS.has(endpoint)) {
      const body = await bufferRequestBody(request);
      const envelope = body === void 0 ? void 0 : parseClientRequest(body);
      if (envelope === void 0 || !payloadWithinFolder(endpoint, envelope.payload, deps.userFolder(user.username))) {
        if (deps.quietDenials && envelope !== void 0) {
          await denyQuiet(request, response, envelope.rpcId);
          return;
        }
        deny403(response);
        return;
      }
      replayRequestBody(request, body);
    }
    if (FILTER_METHODS.has(endpoint) || RECORD_METHODS.has(endpoint)) {
      const owned = FILTER_METHODS.has(endpoint) ? await resolveOwned(deps, user.username) : void 0;
      attachResponseTee(response, {
        endpoint,
        username: user.username,
        ownership: deps.ownership,
        owned
      });
    }
    return next();
  };
}
function store_verify(deps, token) {
  return deps.store.verify(token);
}
async function resolveOwned(deps, username) {
  if (deps.ownedProvider === void 0) return void 0;
  try {
    return await deps.ownedProvider(username);
  } catch {
    return void 0;
  }
}
async function readRequestRpcId(request) {
  try {
    const chunks = [];
    let size = 0;
    request.setEncoding?.("utf8");
    for await (const chunk of request) {
      const piece = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      size += piece.length;
      if (size > DENY_BODY_LIMIT_BYTES) return void 0;
      chunks.push(piece);
    }
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (parsed.type !== "client-request" || typeof parsed.rpcId !== "string" || parsed.rpcId === "") {
      return void 0;
    }
    return parsed.rpcId;
  } catch {
    return void 0;
  }
}
async function bufferRequestBody(request) {
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      const piece = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      size += piece.length;
      if (size > DENY_BODY_LIMIT_BYTES) return void 0;
      chunks.push(piece);
    }
    return Buffer.concat(chunks);
  } catch {
    return void 0;
  }
}
function parseClientRequest(body) {
  try {
    const parsed = JSON.parse(body.toString("utf8"));
    if (parsed.type !== "client-request" || typeof parsed.rpcId !== "string" || parsed.rpcId === "") return void 0;
    return { rpcId: parsed.rpcId, payload: parsed.payload };
  } catch {
    return void 0;
  }
}
function replayRequestBody(request, body) {
  Object.defineProperty(request, Symbol.asyncIterator, {
    configurable: true,
    value: async function* () {
      if (body.length > 0) yield body;
    }
  });
}
function attachResponseTee(response, context) {
  const raw = response;
  const rawWriteHead = raw.writeHead.bind(response);
  const rawSetHeader = raw.setHeader.bind(response);
  const rawWrite = raw.write.bind(response);
  const rawEnd = raw.end.bind(response);
  const headers = {};
  let status;
  let statusMessage;
  const chunks = [];
  let finalCallback;
  let flushed = false;
  const captureHeader = (name2, value) => {
    headers[String(name2).toLowerCase()] = value;
  };
  response.setHeader = function(name2, value) {
    captureHeader(name2, value);
    return this;
  };
  response.writeHead = function(...args) {
    const first = args[0];
    if (typeof first === "number") status = first;
    for (const arg of args.slice(1)) {
      if (typeof arg === "string" && statusMessage === void 0 && status !== void 0 && args.length === 2) {
        statusMessage = arg;
        continue;
      }
      if (typeof arg === "object" && arg !== null) {
        for (const [key, value] of Object.entries(arg)) {
          captureHeader(key, value);
        }
      }
    }
    return this;
  };
  response.write = function(...args) {
    captureChunk(args);
    return true;
  };
  response.end = function(...args) {
    captureChunk(args);
    flush();
    return this;
  };
  function captureChunk(args) {
    let cb;
    for (let index = args.length - 1; index >= 0; index -= 1) {
      const arg = args[index];
      if (typeof arg === "function") {
        cb = arg;
        continue;
      }
      if (arg !== void 0 && arg !== null && arg !== 0) break;
    }
    const first = args[0];
    if (typeof first === "string" || first instanceof Buffer || first instanceof Uint8Array) {
      const encoding = typeof args[1] === "string" ? args[1] : "utf8";
      const data = first instanceof Buffer ? first : Buffer.from(first, encoding);
      chunks.push({ data, cb });
    } else if (cb !== void 0 && chunks.length > 0) {
      chunks[chunks.length - 1].cb = cb;
    } else if (cb !== void 0) {
      finalCallback = cb;
    }
  }
  function flush() {
    if (flushed) return;
    flushed = true;
    const original = Buffer.concat(chunks.map((chunk) => chunk.data));
    let body = original;
    let replayHeaders = true;
    try {
      if (status === 200 && isJsonBody(headers)) {
        const parsed = JSON.parse(original.toString("utf8"));
        if (FILTER_METHODS.has(context.endpoint)) {
          if (context.owned !== void 0) {
            const filtered = context.endpoint === "workspace.list" ? filterWorkspaceListValue(parsed, context.owned) : filterSessionItemsValue(parsed, context.owned);
            if (filtered !== void 0) body = Buffer.from(JSON.stringify(filtered), "utf8");
          }
        } else {
          recordOwnershipFromResponse(parsed, context.username, context.ownership);
        }
      }
    } catch {
    }
    void replayHeaders;
    if (!response.headersSent) {
      const outgoing = {};
      for (const [key, value] of Object.entries(headers)) {
        if (value !== void 0) outgoing[key] = value;
      }
      if (status !== void 0 || chunks.length > 0) {
        outgoing["content-length"] = String(body.length);
        delete outgoing["transfer-encoding"];
      }
      rawWriteHead(status ?? 200, statusMessage ?? "", outgoing);
    }
    if (body !== original) {
      const last = chunks[chunks.length - 1];
      if (last?.cb !== void 0) rawWrite(body, last.cb);
      else rawWrite(body);
    } else {
      for (const chunk of chunks) {
        if (chunk.cb !== void 0) {
          rawWrite(chunk.data, chunk.cb);
        } else {
          rawWrite(chunk.data);
        }
      }
    }
    if (finalCallback !== void 0) rawEnd(finalCallback);
    else rawEnd();
  }
}
function isJsonBody(headers) {
  const type = headers["content-type"];
  return typeof type === "string" && type.includes("application/json");
}

// src/provision.ts
import { mkdir as mkdir6 } from "node:fs/promises";
import { join } from "node:path";
function sandboxSegment(username) {
  return username.split(/[/\\]/).join("_").replace(/\.\.+/g, "_").replace(/^\.+/, "_").replace(/[^A-Za-z0-9._-]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96) || "user";
}
function userSandboxDir(root, username) {
  return join(root, sandboxSegment(username));
}
var DefaultWorkspaceProvisioner = class {
  constructor(deps) {
    this.deps = deps;
  }
  deps;
  /** Provisioned `root\0username` keys. */
  done = /* @__PURE__ */ new Set();
  /** Workspaces already registered but not yet seeded with a session, by root + username. */
  pending = /* @__PURE__ */ new Map();
  /**
   * Ensure `user` has a default workspace+sandbox. A no-op for admins and
   * for users already provisioned this run; skipped (without marking done)
   * while the toggle is off or no registry is resolvable yet.
   * Best-effort: any error is swallowed so the triggering request survives;
   * a partially completed provisioning (workspace created, session seed
   * failed) stays pending and retries only the missing half.
   */
  async ensure(user) {
    if (user.isAdmin) return;
    const root = this.currentRoot();
    const key = `${root}\0${user.username}`;
    if (this.deps.enabled !== void 0 && !this.deps.enabled()) {
      this.done.delete(key);
      return;
    }
    if (this.done.has(key)) return;
    const registry = this.deps.workspaceRegistry ?? this.deps.getRegistry?.();
    if (registry === void 0) return;
    this.done.add(key);
    try {
      await this.provision(user.username, root, key, registry);
    } catch {
      this.done.delete(key);
    }
  }
  /** The sandbox root in effect right now. */
  currentRoot() {
    const root = this.deps.workspaceRoot;
    return typeof root === "function" ? root() : root;
  }
  async provision(username, root, key, registry) {
    let workspaceId = this.pending.get(key);
    if (workspaceId === void 0) {
      const dir = userSandboxDir(root, username);
      await mkdir6(dir, { recursive: true });
      const workspace = await registry.create(dir, this.deps.title ?? username);
      workspaceId = workspace.id;
      this.pending.set(key, workspaceId);
    }
    const api = this.deps.getApi();
    const create = api?.sessions?.create;
    if (create === void 0) {
      throw new Error("dsh-login: no session.create adapter available for default-workspace provisioning");
    }
    const res = await create({ rpcId: "dsh-login-default-workspace", payload: { workspaceId } });
    if (res?.result?.ok !== true || typeof res.result.value?.sessionId !== "string") {
      throw new Error("dsh-login: session.create returned no usable sessionId for default-workspace provisioning");
    }
    this.deps.ownership.record(res.result.value.sessionId, username);
    this.pending.delete(key);
  }
};

// src/host-session-access.ts
function tryGetService(ctx, key) {
  try {
    const get = ctx.get;
    return get.call(ctx, key);
  } catch {
    return void 0;
  }
}
function extractSessionId(value) {
  if (typeof value !== "object" || value === null) return void 0;
  const direct = value.sessionId;
  if (typeof direct === "string" && direct !== "") return direct;
  for (const level of [value.value, envelopeValue(value)]) {
    if (typeof level !== "object" || level === null) continue;
    const sessionId = level.sessionId;
    if (typeof sessionId === "string" && sessionId !== "") return sessionId;
  }
  return void 0;
}
async function createSessionValue(ctx, payload) {
  const controller = tryGetService(ctx, "sessionController");
  if (typeof controller?.create === "function") {
    return controller.create(payload);
  }
  const gateway = tryGetService(ctx, "typertGateway");
  if (typeof gateway?.invoke === "function") {
    return gateway.invoke({ namespace: "session", method: "create", args: payload });
  }
  throw new Error("dsh-login: neither sessionController nor typertGateway is available for session.create");
}
function createHostSessionApi(ctx) {
  return () => ({
    sessions: {
      create: async (request) => {
        const value = await createSessionValue(ctx, request.payload);
        const sessionId = extractSessionId(value);
        if (sessionId === void 0) {
          throw new Error("dsh-login: session.create returned no sessionId");
        }
        return { result: { ok: true, value: { sessionId } } };
      }
    }
  });
}
function createHostSessionSource(ctx) {
  return {
    async invoke() {
      const controller = tryGetService(ctx, "sessionController");
      if (typeof controller?.list === "function") {
        return controller.list({}, new AbortController().signal);
      }
      const gateway = tryGetService(ctx, "typertGateway");
      if (typeof gateway?.invoke === "function") {
        return gateway.invoke({ namespace: "session", method: "list", args: {} });
      }
      throw new Error("dsh-login: neither sessionController nor typertGateway is available for session.list");
    }
  };
}

// src/http-json.ts
import { homedir } from "node:os";
import { join as join2 } from "node:path";
var MAX_JSON_BODY_BYTES = 8192;
async function readBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (Buffer.concat(chunks).length > maxBytes) {
      throw new Error("body too large");
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}
function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
function resolveDshHome() {
  const env = process.env.DSH_HOME;
  return env !== void 0 && env.length > 0 ? env : join2(homedir(), ".dsh");
}

// src/login-api.ts
async function parseCredentials(req) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed.username !== "string" || typeof parsed.password !== "string") return null;
  return { username: parsed.username, password: parsed.password };
}
function learnRequestHost(req, hosts) {
  const host = req.headers.host;
  if (typeof host === "string" && host.length > 0) hosts.learn(host);
}
function createLoginHandler(deps) {
  return async (req, res) => {
    const creds = await parseCredentials(req);
    if (creds === null) {
      sendJson(res, 400, { error: "bad request" });
      return;
    }
    if (await deps.users.isEmpty()) {
      sendJson(res, 500, { error: "no users configured" });
      return;
    }
    const record = await deps.users.verify(creds.username, creds.password);
    if (record === void 0) {
      sendJson(res, 401, { error: "invalid credentials" });
      return;
    }
    await deps.users.touchLastLogin(record.username).catch(() => {
    });
    const session = deps.store.create(record.username, record.isAdmin);
    if (deps.autoTrust === true && deps.hosts !== void 0) learnRequestHost(req, deps.hosts);
    res.setHeader("Set-Cookie", buildCookieHeader(session.token, deps.sessionTtl));
    sendJson(res, 200, { ok: true });
  };
}
function createLogoutHandler(store) {
  return async (req, res) => {
    const token = extractSessionToken(req.headers.cookie);
    if (token !== void 0) store.revoke(token);
    res.setHeader("Set-Cookie", buildClearCookieHeader());
    res.writeHead(200);
    res.end();
  };
}
function createLogoutRedirectHandler(store) {
  return async (req, res) => {
    const token = extractSessionToken(req.headers.cookie);
    if (token !== void 0) store.revoke(token);
    res.setHeader("Set-Cookie", buildClearCookieHeader());
    res.writeHead(302, { Location: "/login" });
    res.end();
  };
}
function createSetupHandler(deps) {
  return async (req, res) => {
    if (!await deps.users.isEmpty()) {
      sendJson(res, 403, { error: "users already exist" });
      return;
    }
    const creds = await parseCredentials(req);
    if (creds === null || creds.password.length === 0) {
      sendJson(res, 400, { error: "bad request" });
      return;
    }
    let record;
    try {
      record = await deps.users.create(creds.username, creds.password, true);
    } catch {
      sendJson(res, 400, { error: "bad request" });
      return;
    }
    await deps.users.touchLastLogin(record.username).catch(() => {
    });
    const session = deps.store.create(record.username, record.isAdmin);
    if (deps.autoTrust === true && deps.hosts !== void 0) learnRequestHost(req, deps.hosts);
    res.setHeader("Set-Cookie", buildCookieHeader(session.token, deps.sessionTtl));
    sendJson(res, 200, { ok: true });
  };
}

// src/admin-api.ts
import { mkdir as mkdir7 } from "node:fs/promises";
function requireSession(deps, req) {
  const token = extractSessionToken(req.headers.cookie);
  return token === void 0 ? void 0 : deps.store.verify(token);
}
async function readJsonObject(req) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(body);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}
function requireAdmin(deps, req, res) {
  const session = requireSession(deps, req);
  if (session === void 0) {
    sendJson(res, 401, { error: "authentication required" });
    return void 0;
  }
  if (!session.isAdmin) {
    sendJson(res, 403, { error: "admin required" });
    return void 0;
  }
  return session;
}
function createAdminRoutes(deps) {
  const me = { kind: "exact", path: "/api/auth/me", handler: async (req, res) => {
    const session = requireSession(deps, req);
    if (session === void 0) return sendJson(res, 401, { error: "authentication required" });
    return sendJson(res, 200, { username: session.user, isAdmin: session.isAdmin });
  } };
  const capabilitiesRoute = { kind: "exact", path: "/api/auth/capabilities", handler: async (req, res) => {
    const session = requireSession(deps, req);
    if (session === void 0) return sendJson(res, 401, { error: "authentication required" });
    return sendJson(res, 200, {
      username: session.user,
      isAdmin: session.isAdmin,
      capabilities: deriveCapabilities({ username: session.user, isAdmin: session.isAdmin })
    });
  } };
  const usersRoute = { kind: "exact", path: "/api/auth/admin/users", handler: async (req, res) => {
    if (req.method === "GET") {
      if (requireAdmin(deps, req, res) === void 0) return;
      const records = await deps.users.list();
      const online = deps.store.onlineCounts();
      return sendJson(res, 200, {
        users: records.map((record) => ({
          username: record.username,
          isAdmin: record.isAdmin,
          lastLoginAt: record.lastLoginAt ?? null,
          disabled: record.disabled === true,
          onlineSessions: online.get(record.username) ?? 0
        }))
      });
    }
    if (requireAdmin(deps, req, res) === void 0) return;
    const body = await readJsonObject(req);
    if (body === null) return sendJson(res, 400, { error: "bad request" });
    const { username, password, isAdmin } = body;
    if (typeof username !== "string" || typeof password !== "string" || password.length === 0) {
      return sendJson(res, 400, { error: "bad request" });
    }
    if (isAdmin !== void 0 && typeof isAdmin !== "boolean") return sendJson(res, 400, { error: "bad request" });
    if ((await deps.users.list()).some((u) => u.username === username)) {
      return sendJson(res, 409, { error: "user exists" });
    }
    try {
      await deps.users.create(username, password, isAdmin === true);
    } catch {
      return sendJson(res, 400, { error: "bad request" });
    }
    return sendJson(res, 201, { ok: true });
  } };
  const userPassword = { kind: "exact", path: "/api/auth/admin/users/password", handler: async (req, res) => {
    if (requireAdmin(deps, req, res) === void 0) return;
    const body = await readJsonObject(req);
    if (body === null) return sendJson(res, 400, { error: "bad request" });
    const { username, password } = body;
    if (typeof username !== "string" || typeof password !== "string" || password.length === 0) {
      return sendJson(res, 400, { error: "bad request" });
    }
    try {
      await deps.users.setPassword(username, password);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("unknown user")) return sendJson(res, 404, { error: "unknown user" });
      return sendJson(res, 400, { error: "bad request" });
    }
    deps.store.revokeAllFor(username);
    return sendJson(res, 200, { ok: true });
  } };
  const userRemove = { kind: "exact", path: "/api/auth/admin/users/remove", handler: async (req, res) => {
    if (requireAdmin(deps, req, res) === void 0) return;
    const body = await readJsonObject(req);
    if (body === null || typeof body.username !== "string") return sendJson(res, 400, { error: "bad request" });
    const target = body.username;
    const records = await deps.users.list();
    const record = records.find((u) => u.username === target);
    if (record === void 0) return sendJson(res, 404, { error: "unknown user" });
    if (record.isAdmin && records.filter((u) => u.isAdmin).length === 1) {
      return sendJson(res, 409, { error: "cannot remove the last admin" });
    }
    await deps.users.remove(target);
    deps.store.revokeAllFor(target);
    return sendJson(res, 200, { ok: true });
  } };
  const hosts = deps.hosts;
  const hostsRoute = hosts === void 0 ? void 0 : { kind: "exact", path: "/api/auth/admin/hosts", handler: async (req, res) => {
    if (req.method === "GET") {
      if (requireAdmin(deps, req, res) === void 0) return;
      return sendJson(res, 200, { hosts: hosts.list() });
    }
    if (req.method !== "POST" && req.method !== "DELETE") {
      if (requireAdmin(deps, req, res) === void 0) return;
      return sendJson(res, 405, { error: "method not allowed" });
    }
    if (requireAdmin(deps, req, res) === void 0) return;
    const body = await readJsonObject(req);
    if (body === null || typeof body.host !== "string" || body.host.length === 0) {
      return sendJson(res, 400, { error: "bad request" });
    }
    const raw = body.host;
    if (raw.length > MAX_HOST_LENGTH || !isBareAuthority(raw)) {
      return sendJson(res, 400, { error: "invalid host" });
    }
    const canonical = hosts.canonicalize(raw);
    if (req.method === "POST") {
      const added = hosts.add(raw);
      return sendJson(res, added ? 201 : 200, { ok: true, host: canonical });
    }
    hosts.remove(canonical);
    return sendJson(res, 200, { ok: true, host: canonical });
  } };
  const userDisable = { kind: "exact", path: "/api/auth/admin/users/disable", handler: async (req, res) => {
    if (requireAdmin(deps, req, res) === void 0) return;
    const body = await readJsonObject(req);
    if (body === null || typeof body.username !== "string" || typeof body.disabled !== "boolean") {
      return sendJson(res, 400, { error: "bad request" });
    }
    const target = body.username;
    const records = await deps.users.list();
    const record = records.find((u) => u.username === target);
    if (record === void 0) return sendJson(res, 404, { error: "unknown user" });
    if (body.disabled && record.isAdmin && records.filter((u) => u.isAdmin && u.disabled !== true).length === 1) {
      return sendJson(res, 409, { error: "cannot disable the last enabled admin" });
    }
    await deps.users.setDisabled(target, body.disabled);
    if (body.disabled) deps.store.revokeAllFor(target);
    return sendJson(res, 200, { ok: true });
  } };
  const setting = deps.defaultWorkspaceSetting;
  const settingRoute = setting === void 0 ? void 0 : { kind: "exact", path: "/api/auth/admin/settings/default-workspace", handler: async (req, res) => {
    if (requireAdmin(deps, req, res) === void 0) return;
    if (req.method === "GET") return sendJson(res, 200, { enabled: setting.get() });
    if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
    const body = await readJsonObject(req);
    if (body === null || typeof body.enabled !== "boolean") return sendJson(res, 400, { error: "bad request" });
    setting.set(body.enabled);
    return sendJson(res, 200, { ok: true, enabled: setting.get() });
  } };
  const rootSetting = deps.workspaceRootSetting;
  const rootSettingRoute = rootSetting === void 0 ? void 0 : { kind: "exact", path: "/api/auth/admin/settings/workspace-root", handler: async (req, res) => {
    if (requireAdmin(deps, req, res) === void 0) return;
    const describe = () => ({ path: rootSetting.get(), isDefault: rootSetting.isDefault(), defaultPath: rootSetting.fallback });
    if (req.method === "GET") return sendJson(res, 200, describe());
    if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
    const body = await readJsonObject(req);
    if (body === null || typeof body.path !== "string") return sendJson(res, 400, { error: "bad request" });
    const next = body.path.trim() === "" ? rootSetting.fallback : normalizeWorkspaceRoot(body.path);
    if (next === void 0) return sendJson(res, 400, { error: "path must be absolute" });
    try {
      await mkdir7(next, { recursive: true });
    } catch (err) {
      return sendJson(res, 400, { error: `cannot create folder: ${err instanceof Error ? err.message : String(err)}` });
    }
    rootSetting.set(body.path);
    return sendJson(res, 200, { ok: true, ...describe() });
  } };
  const remoteSetting = deps.remoteWebUiSetting;
  const remoteSettingRoute = remoteSetting === void 0 ? void 0 : { kind: "exact", path: "/api/auth/admin/settings/remote-web-ui-compat", handler: async (req, res) => {
    if (requireAdmin(deps, req, res) === void 0) return;
    if (req.method === "GET") return sendJson(res, 200, { enabled: remoteSetting.get() });
    if (req.method !== "POST") return sendJson(res, 405, { error: "method not allowed" });
    const body = await readJsonObject(req);
    if (body === null || typeof body.enabled !== "boolean") return sendJson(res, 400, { error: "bad request" });
    remoteSetting.set(body.enabled);
    let applied = "skipped";
    if (deps.onRemoteWebUiApply !== void 0) applied = await deps.onRemoteWebUiApply(body.enabled);
    return sendJson(res, 200, { ok: true, enabled: remoteSetting.get(), applied });
  } };
  const routes = [me, capabilitiesRoute, usersRoute, userPassword, userRemove, userDisable];
  if (hostsRoute !== void 0) routes.push(hostsRoute);
  if (settingRoute !== void 0) routes.push(settingRoute);
  if (rootSettingRoute !== void 0) routes.push(rootSettingRoute);
  if (remoteSettingRoute !== void 0) routes.push(remoteSettingRoute);
  return routes;
}

// package.json
var package_default = {
  name: "@islibaodong/dsh-login",
  description: "Multi-user authentication gateway plugin for the DSH Web GUI, with per-role whole-UI gating",
  version: "0.3.5-en.3",
  type: "module",
  main: "dist/index.js",
  exports: {
    ".": {
      default: "./dist/index.js"
    },
    "./client": "./dist/client.js",
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  scripts: {
    test: "vitest run",
    "test:watch": "vitest",
    "build:host": "node scripts/build-host.mjs",
    "build:client": "node scripts/build-client.mjs",
    build: "npm run build:host && npm run build:client",
    "verify:imports": "node --import tsx/esm scripts/verify-imports.mjs"
  },
  engines: {
    node: "^22.19.0 || >=24.0.0"
  },
  license: "MIT",
  dsh: {
    bundle: {
      patch: "./cordis.patch.yml"
    },
    client: {
      inject: [
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-locale"
      ],
      platform: "web",
      immediately: true
    }
  },
  peerDependencies: {
    "@deepseek-ai/cordis": "^4.0.1-rc.1 || ~4.0.5-alpha.1",
    "@deepseek-ai/dsh-client-connection": ">=0.1.5-alpha.1 <0.2.0-0 || >=0.1.6-alpha.1 <0.2.0-0 || >=0.1.7-alpha.2 <0.2.0-0 || >=0.2.0-rc.2 <0.3.0-0 || >=0.2.1-alpha.1 <0.3.0-0",
    "@deepseek-ai/dsh-credentials": ">=0.1.5-alpha.1 <0.2.0-0 || >=0.1.6-alpha.1 <0.2.0-0 || >=0.1.7-alpha.2 <0.2.0-0 || >=0.2.0-rc.2 <0.3.0-0 || >=0.2.1-alpha.1 <0.3.0-0",
    "@deepseek-ai/dsh-host-frontend-static": ">=0.1.5-alpha.1 <0.2.0-0 || >=0.1.6-alpha.1 <0.2.0-0 || >=0.1.7-alpha.2 <0.2.0-0 || >=0.2.0-rc.2 <0.3.0-0 || >=0.2.1-alpha.1 <0.3.0-0",
    "@deepseek-ai/dsh-host-webserver": ">=0.1.5-alpha.1 <0.2.0-0 || >=0.1.6-alpha.1 <0.2.0-0 || >=0.1.7-alpha.2 <0.2.0-0 || >=0.2.0-rc.2 <0.3.0-0 || >=0.2.1-alpha.1 <0.3.0-0",
    "@deepseek-ai/dsh-settings": ">=0.1.5-alpha.1 <0.2.0-0 || >=0.1.6-alpha.1 <0.2.0-0 || >=0.1.7-alpha.2 <0.2.0-0 || >=0.2.0-rc.2 <0.3.0-0 || >=0.2.1-alpha.1 <0.3.0-0",
    "@deepseek-ai/dsh-web-frontend": ">=0.1.5-alpha.1 <0.2.0-0 || >=0.1.6-alpha.1 <0.2.0-0 || >=0.1.7-alpha.2 <0.2.0-0 || >=0.2.0-rc.2 <0.3.0-0 || >=0.2.1-alpha.1 <0.3.0-0",
    "@deepseek-ai/schemastery": "^3.18.1-rc.1 || ~3.18.5-alpha.1"
  },
  devDependencies: {
    "@deepseek-ai/cordis": "~4.0.5",
    "@deepseek-ai/cordis-plugin-include": "~1.0.10",
    "@deepseek-ai/cordis-plugin-loader": "~1.0.6",
    "@deepseek-ai/dsh-brand": "^0.2.1-rc.2",
    "@deepseek-ai/dsh-client-connection": "^0.2.1-rc.2",
    "@deepseek-ai/dsh-client-modules": "^0.2.1-rc.2",
    "@deepseek-ai/dsh-credentials": "^0.2.1-rc.2",
    "@deepseek-ai/dsh-host-frontend-static": "^0.2.1-rc.2",
    "@deepseek-ai/dsh-host-webserver": "^0.2.1-rc.2",
    "@deepseek-ai/dsh-scope": "^0.2.1-rc.2",
    "@deepseek-ai/dsh-session": "^0.2.1-rc.2",
    "@deepseek-ai/dsh-settings": "^0.2.1-rc.2",
    "@deepseek-ai/dsh-web-frontend": "^0.2.1-rc.2",
    "@deepseek-ai/schemastery": "~3.18.5",
    "@types/node": "^22.20.1",
    esbuild: "^0.28.2",
    "esbuild-wasm": "^0.28.2",
    tsx: "^4.23.12",
    vitest: "^2.1.9"
  },
  repository: {
    type: "git",
    url: "git+https://github.com/ViriatusOG/dsh-login.git"
  },
  files: [
    "src",
    "dist",
    "cordis.patch.yml",
    "screenshots.json",
    "LICENSE",
    "README.md",
    "README.zh.md"
  ]
};

// src/login-page.ts
var VERSION = `v${package_default.version}`;
var BOARD_JS = `
    (function () {
      var reduce = window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var board = document.getElementById('board');
      var pane = document.getElementById('paneDark');
      var CELL = 72, SIZE = 56;

      function layout() {
        board.innerHTML = '';
        var W = pane.clientWidth, H = pane.clientHeight;
        var cols = Math.ceil(W / CELL);
        var rows = Math.ceil(H / CELL);
        var count = Math.min(18, Math.max(8, Math.round(cols * rows * 0.04)));
        var picks = {};
        var placed = 0, guard = 0;
        while (placed < count && guard++ < cols * rows * 4) {
          var c = Math.floor(Math.random() * cols);
          var r = Math.floor(Math.random() * rows);
          var x = c * CELL + (CELL - SIZE) / 2;
          var y = r * CELL + (CELL - SIZE) / 2;
          // keep the space behind the text block clean
          if (x < 600 && y > H * 0.08 && y < H * 0.92) continue;
          var key = c + ':' + r;
          if (picks[key]) continue;
          picks[key] = true;
          var t = document.createElement('div');
          t.className = 'tile' + (Math.random() < 0.35 ? ' tile--lit' : '');
          t.style.left = x + 'px';
          t.style.top = y + 'px';
          t.style.setProperty('--d', (placed * 45) + 'ms');
          if (!reduce && Math.random() < 0.4) {
            t.style.setProperty('--breath-delay', (6 + Math.random() * 16) + 's');
          }
          board.appendChild(t);
          placed++;
        }
      }

      var tm;
      window.addEventListener('resize', function () {
        clearTimeout(tm);
        tm = setTimeout(layout, 200);
      });
      layout();
    })();
`;
var FORM_JS = `
    (function () {
      var reveals = document.querySelectorAll('[data-reveal]');
      Array.prototype.forEach.call(reveals, function (btn) {
        btn.addEventListener('click', function () {
          var ids = btn.getAttribute('data-reveal').split(' ');
          var show = btn.getAttribute('aria-pressed') !== 'true';
          ids.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.type = show ? 'text' : 'password';
          });
          btn.setAttribute('aria-pressed', show ? 'true' : 'false');
          btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
          btn.textContent = show ? 'Hide' : 'Show';
        });
      });
      if (window.matchMedia && window.matchMedia('(min-width: 881px)').matches) {
        var first = document.getElementById('username');
        if (first) first.focus();
      }
    })();
`;
var BASE_CSS = `
    :root {
      --bg: #0f1420;
      --panel: #151b2c;
      --inset: #0d1220;
      --line: #262f47;
      --line-soft: #1c2438;
      --text: #e8ebf4;
      --muted: #a9b2c7;
      --faint: #8a93ab;
      --accent: #6f9bff;
      --accent-strong: #3f6fe0;
      --accent-strong-hover: #2f5fd0;
      --accent-soft: rgba(111, 155, 255, 0.14);
      --ring: rgba(111, 155, 255, 0.24);
      --ok: #46d19a;
      --lt-bg: #f3f5fa;
      --lt-card: #ffffff;
      --lt-line: #e1e6f1;
      --lt-field: #d5dbe8;
      --lt-inset: #f6f8fc;
      --lt-text: #1d2536;
      --lt-muted: #5d6782;
      --lt-faint: #67718c;
      --danger: #d64545;
      --danger-bg: #fdecec;
      --danger-line: #f3c4c4;
      --danger-text: #8f2323;
      --match: #237a57;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
        "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      min-height: 100vh;
      min-height: 100dvh;
      -webkit-text-size-adjust: 100%;
    }

    .split {
      display: flex;
      min-height: 100vh;
      min-height: 100dvh;
    }
    .pane { flex: 1 1 50%; position: relative; }

    /* ---- left: the dark DSH side ---- */
    .pane--dark {
      flex-basis: 52%;
      background: var(--bg);
      overflow: hidden;
    }
    .board-bg {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background-image:
        linear-gradient(var(--line-soft) 1px, transparent 1px),
        linear-gradient(90deg, var(--line-soft) 1px, transparent 1px);
      background-size: 72px 72px;
      opacity: 0.35;
    }
    .board-bg::after {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(
        ellipse 90% 80% at 30% 50%,
        transparent 30%, var(--bg) 100%
      );
    }
    #board { position: absolute; inset: 0; pointer-events: none; }
    .tile {
      position: absolute;
      width: 56px;
      height: 56px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: rgba(21, 27, 44, 0.55);
      opacity: 0;
      animation: tileIn 0.6s ease both;
      animation-delay: var(--d, 0ms);
    }
    .tile--lit {
      border-color: rgba(111, 155, 255, 0.45);
      background: var(--accent-soft);
      animation: tileIn 0.6s ease both, breath 7s ease-in-out infinite;
      animation-delay: var(--d, 0ms), var(--breath-delay, 4s);
    }
    .tile--lit::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      width: 6px;
      height: 6px;
      margin: -3px 0 0 -3px;
      border-radius: 50%;
      background: var(--accent);
      opacity: 0.8;
    }
    @keyframes tileIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 0.9; transform: none; }
    }
    @keyframes breath {
      0%, 100% { box-shadow: 0 0 0 0 rgba(111, 155, 255, 0); }
      50% { box-shadow: 0 0 22px 0 rgba(111, 155, 255, 0.16); }
    }

    .pane-content {
      position: relative;
      height: 100%;
      min-height: 100vh;
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 48px;
      padding: 64px 72px;
      max-width: 664px;
      animation: rise 0.55s cubic-bezier(0.22, 0.8, 0.36, 1) both;
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: none; }
    }

    .brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .brand-mark {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-mark svg { flex: none; }
    .wordmark {
      font-size: 2rem;
      font-weight: 750;
      letter-spacing: 0.02em;
      line-height: 1;
    }
    .pill {
      display: none;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(21, 27, 44, 0.85);
      font-size: 0.75rem;
      color: var(--muted);
      white-space: nowrap;
    }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--ok);
      box-shadow: 0 0 6px rgba(70, 209, 154, 0.55);
    }

    .story { display: flex; flex-direction: column; gap: 40px; max-width: 520px; }
    .story-head { display: flex; flex-direction: column; gap: 14px; }
    .kicker {
      font-size: 0.94rem;
      font-weight: 600;
      color: #8fb1ff;
    }
    .headline {
      font-size: 2.5rem;
      line-height: 1.15;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .lead {
      font-size: 1rem;
      color: var(--muted);
      line-height: 1.65;
    }

    .features {
      list-style: none;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 24px 32px;
    }
    .features b {
      display: block;
      font-size: 0.94rem;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 6px;
    }
    .features span {
      display: block;
      font-size: 0.875rem;
      color: var(--muted);
      line-height: 1.55;
    }

    .loaded {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 0.8rem;
      color: var(--faint);
    }

    /* ---- right: the light form side ---- */
    .pane--light {
      background: var(--lt-bg);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 48px;
    }

    .card {
      position: relative;
      z-index: 1;
      width: 420px;
      max-width: 100%;
      background: var(--lt-card);
      border: 1px solid var(--lt-line);
      border-radius: 20px;
      padding: 40px;
      box-shadow: 0 18px 44px rgba(23, 32, 55, 0.08);
      color: var(--lt-text);
      display: flex;
      flex-direction: column;
      gap: 24px;
      animation: rise 0.55s cubic-bezier(0.22, 0.8, 0.36, 1) both;
      animation-delay: 130ms;
    }
    .card-head { display: flex; flex-direction: column; gap: 6px; }
    .card h1 {
      font-size: 1.625rem;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: var(--lt-text);
    }
    .subtitle {
      font-size: 0.94rem;
      color: var(--lt-muted);
      line-height: 1.5;
    }

    .error {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 14px;
      border-radius: 12px;
      background: var(--danger-bg);
      border: 1px solid var(--danger-line);
      color: var(--danger-text);
      font-size: 0.875rem;
      line-height: 1.5;
    }
    .error::before {
      content: '!';
      flex: none;
      width: 18px;
      height: 18px;
      margin-top: 1px;
      border-radius: 50%;
      border: 2px solid currentColor;
      font-size: 0.7rem;
      font-weight: 800;
      line-height: 14px;
      text-align: center;
    }
    .error:empty { display: none; }

    form { display: flex; flex-direction: column; gap: 16px; }
    .field { display: flex; flex-direction: column; gap: 8px; }
    .field label {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--lt-text);
    }
    .hint {
      font-size: 0.8125rem;
      line-height: 1.4;
      color: var(--lt-faint);
    }
    .hint--ok { color: var(--match); }
    .hint--bad { color: var(--danger-text); }
    .control { position: relative; display: flex; }
    .card input[type="text"], .card input[type="password"] {
      width: 100%;
      height: 48px;
      padding: 0 14px;
      background: var(--lt-inset);
      border: 1px solid var(--lt-field);
      border-radius: 10px;
      color: var(--lt-text);
      /* 16px stops iOS Safari from zooming into the field on focus */
      font-size: 16px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
    }
    .control input { padding-right: 76px !important; }
    .card input::placeholder { color: #8a93a8; }
    .card input:focus {
      background: #fff;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--ring);
    }
    .card input[aria-invalid="true"] {
      background: #fff;
      border-color: var(--danger);
      box-shadow: 0 0 0 3px rgba(214, 69, 69, 0.15);
    }
    .reveal {
      position: absolute;
      top: 4px;
      right: 4px;
      height: 40px;
      min-width: 64px;
      padding: 0 12px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--accent-strong);
      font-size: 0.875rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
    }
    .reveal:hover { background: var(--accent-soft); }
    .card button[type="submit"] {
      width: 100%;
      height: 48px;
      margin-top: 4px;
      background: var(--accent-strong);
      border: none;
      border-radius: 10px;
      color: #fff;
      font-size: 1rem;
      font-weight: 650;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.15s;
    }
    .card button[type="submit"]:hover { background: var(--accent-strong-hover); }
    .card button[type="submit"]:disabled {
      background: #9fb3df;
      cursor: progress;
    }
    .card button:focus-visible, .about summary:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    .help {
      font-size: 0.875rem;
      line-height: 1.5;
      color: var(--lt-muted);
      text-align: center;
    }

    .about {
      display: none;
      border-top: 1px solid #e6eaf2;
    }
    .about summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 48px;
      font-size: 0.94rem;
      font-weight: 600;
      color: var(--lt-text);
      cursor: pointer;
      list-style: none;
    }
    .about summary::-webkit-details-marker { display: none; }
    .about summary svg { transition: transform 0.15s; }
    .about[open] summary svg { transform: rotate(180deg); }
    .about ul {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding-bottom: 8px;
    }
    .about li {
      display: flex;
      gap: 12px;
      font-size: 0.875rem;
      line-height: 1.5;
      color: var(--lt-muted);
    }
    .about li::before {
      content: '';
      flex: none;
      width: 8px;
      height: 8px;
      margin-top: 6px;
      border-radius: 2px;
      background: var(--accent);
    }
    .about b { color: var(--lt-text); }

    .secure {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding-top: 18px;
      border-top: 1px solid #e6eaf2;
      font-size: 0.8125rem;
      color: var(--lt-faint);
      text-align: center;
    }
    .secure svg { flex: none; }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
      .tile { opacity: 0.9; }
    }

    /* ---- phones and narrow windows: compact brand header, form sheet ---- */
    @media (max-width: 880px) {
      .split { flex-direction: column; }
      .pane--dark {
        flex: none;
        overflow: visible;
        background-image:
          linear-gradient(var(--line-soft) 1px, transparent 1px),
          linear-gradient(90deg, var(--line-soft) 1px, transparent 1px);
        background-size: 36px 36px;
        background-position: -1px -1px;
      }
      .board-bg, #board { display: none; }
      .pane-content {
        min-height: 0;
        max-width: none;
        gap: 0;
        padding: max(40px, env(safe-area-inset-top)) 24px 52px;
      }
      .wordmark { font-size: 1.875rem; }
      .pill { display: inline-flex; }
      .story { gap: 0; }
      .story-head { margin-top: 16px; gap: 0; }
      .kicker, .headline, .features, .loaded { display: none; }
      .lead { font-size: 0.94rem; line-height: 1.5; max-width: 22em; }
      .lead-long { display: none; }

      .pane--light {
        flex: 1 1 auto;
        display: block;
        margin-top: -24px;
        padding: 0;
        background: var(--lt-card);
        border-radius: 24px 24px 0 0;
      }
      .card {
        width: 100%;
        border: none;
        border-radius: 24px 24px 0 0;
        box-shadow: none;
        padding: 28px 24px max(24px, env(safe-area-inset-bottom));
        gap: 20px;
        animation-delay: 0ms;
      }
      .card input[type="text"], .card input[type="password"] {
        height: 52px;
        padding: 0 16px;
        border-radius: 12px;
      }
      .reveal { height: 44px; }
      .card button[type="submit"] { height: 52px; border-radius: 12px; }
      .about { display: block; }
      .secure { border-top: none; padding-top: 4px; }
    }
    @media (min-width: 881px) {
      .lead-short { display: none; }
    }
`;
var PLUG_SVG = `
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
        stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <path d="M9 7V3" /><path d="M15 7V3" />
        <path d="M7 7h10v4a5 5 0 0 1-5 5 5 5 0 0 1-5-5V7z" />
        <path d="M12 16v5" />
      </svg>`;
var LOCK_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true">
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>`;
var CHEVRON_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>`;
var FEATURES = [
  ["Sign-in wall", "Pages, the API and live updates all need a session."],
  ["Separate sessions", "Users see only their own chats and subagents."],
  ["A folder per user", "Each user works in their own folder, inside a root the admin picks."],
  ["User management", "Admins manage accounts in Settings \u2192 Users."],
  ["Remote friendly", "Works over frp, tunnels or the LAN."],
  ["Survives restarts", "Sign-ins last 7 days and outlive a DSH restart."]
];
function renderPage(opts) {
  const grid = FEATURES.map(
    ([title, body]) => `<li><b>${title}</b><span>${body}</span></li>`
  ).join("\n          ");
  const list = FEATURES.map(
    ([title, body]) => `<li><span><b>${title}.</b> ${body}</span></li>`
  ).join("\n            ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0f1420">
  <title>${opts.title}</title>
  <style>${BASE_CSS}</style>
</head>
<body>
  <main class="split">
    <section class="pane pane--dark" id="paneDark">
      <div class="board-bg" aria-hidden="true"></div>
      <div id="board" aria-hidden="true"></div>
      <div class="pane-content">
        <div class="brand-row">
          <div class="brand-mark">${PLUG_SVG}<div class="wordmark">DSH</div></div>
          <span class="pill"><i class="dot"></i>${opts.pill}</span>
        </div>
        <div class="story">
          <div class="story-head">
            <p class="kicker">A sign-in gateway, and the gate itself is a plugin.</p>
            <p class="headline">One DSH, many users, each with their own space.</p>
            <p class="lead"><span class="lead-long">dsh-login puts a sign-in wall in front of the DSH web UI so it can be shared safely on a network.</span><span class="lead-short">${opts.tagline}</span></p>
          </div>
          <ul class="features">
          ${grid}
          </ul>
        </div>
        <div class="loaded"><i class="dot"></i>dsh-login loaded \xB7 ${VERSION}</div>
      </div>
    </section>
    <section class="pane pane--light">
      <div class="card">
        <div class="card-head">
          <h1>${opts.heading}</h1>
          <p class="subtitle">${opts.subtitle}</p>
        </div>
        <div class="error" id="error" role="alert"></div>
        <form id="authForm" novalidate>${opts.fields}</form>${opts.help ? `
        <p class="help">${opts.help}</p>` : ""}
        <details class="about">
          <summary>What is dsh-login?${CHEVRON_SVG}</summary>
          <ul>
            ${list}
          </ul>
        </details>
        <p class="secure">${LOCK_SVG}<span>Hashed passwords \xB7 HttpOnly session cookie</span></p>
      </div>
    </section>
  </main>
  <script>${FORM_JS}</script>
  <script>${opts.script}</script>
  <script>${BOARD_JS}</script>
</body>
</html>`;
}
function renderLoginPage() {
  return renderPage({
    title: "Sign in \xB7 DSH",
    heading: "Sign in",
    subtitle: "Each user has their own account and sessions.",
    tagline: "Multi-user sign-in for the DSH web UI.",
    pill: `dsh-login ${VERSION}`,
    help: "Forgot your password? Ask an admin to reset it.",
    fields: `
          <div class="field">
            <label for="username">Username</label>
            <input type="text" name="username" id="username" placeholder="e.g. alice"
              autocomplete="username" autocapitalize="none" autocorrect="off"
              spellcheck="false" required>
          </div>
          <div class="field">
            <label for="password">Password</label>
            <div class="control">
              <input type="password" name="password" id="password" placeholder="Your password"
                autocomplete="current-password" required>
              <button type="button" class="reveal" data-reveal="password"
                aria-pressed="false" aria-label="Show password">Show</button>
            </div>
          </div>
          <button type="submit" id="submit">Sign in</button>`,
    script: `
    var form = document.getElementById('authForm');
    var username = document.getElementById('username');
    var password = document.getElementById('password');
    var error = document.getElementById('error');
    var submit = document.getElementById('submit');

    function clearInvalid() {
      username.removeAttribute('aria-invalid');
      password.removeAttribute('aria-invalid');
    }
    username.addEventListener('input', clearInvalid);
    password.addEventListener('input', clearInvalid);

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      error.textContent = '';
      clearInvalid();
      if (!username.value) {
        error.textContent = 'Enter your username';
        username.setAttribute('aria-invalid', 'true');
        username.focus();
        return;
      }
      if (!password.value) {
        error.textContent = 'Enter your password';
        password.setAttribute('aria-invalid', 'true');
        password.focus();
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Signing in\u2026';
      try {
        var res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username.value, password: password.value }),
        });
        if (res.ok) {
          window.location = '/';
          return;
        } else if (res.status === 401) {
          error.textContent = 'Wrong username or password. Check both and try again.';
          password.value = '';
          password.setAttribute('aria-invalid', 'true');
          password.focus();
        } else if (res.status === 400) {
          error.textContent = 'Invalid request';
        } else if (res.status === 500) {
          error.textContent = 'No users exist yet. Reload the page to finish setup';
        } else {
          error.textContent = 'Something went wrong';
        }
      } catch (err) {
        error.textContent = 'Network error, please try again';
      }
      submit.disabled = false;
      submit.textContent = 'Sign in';
    });`
  });
}
function renderSetupPage() {
  return renderPage({
    title: "Set up \xB7 DSH",
    heading: "Create admin account",
    subtitle: "This first account manages everyone else in Settings \u2192 Users.",
    tagline: "No accounts exist yet. Create the first one.",
    pill: `First run \xB7 ${VERSION}`,
    fields: `
          <div class="field">
            <label for="username">Username</label>
            <input type="text" name="username" id="username" placeholder="e.g. admin"
              autocomplete="username" autocapitalize="none" autocorrect="off"
              spellcheck="false" aria-describedby="usernameHint" required>
            <span class="hint" id="usernameHint">Letters, digits, _ and -, up to 32 characters.</span>
          </div>
          <div class="field">
            <label for="password">Password</label>
            <div class="control">
              <input type="password" name="password" id="password" placeholder="Choose a password"
                autocomplete="new-password" required>
              <button type="button" class="reveal" data-reveal="password confirm"
                aria-pressed="false" aria-label="Show password">Show</button>
            </div>
          </div>
          <div class="field">
            <label for="confirm">Confirm password</label>
            <input type="password" id="confirm" placeholder="Type it again"
              autocomplete="new-password" aria-describedby="matchHint" required>
            <span class="hint" id="matchHint" aria-live="polite"></span>
          </div>
          <button type="submit" id="submit">Create account and sign in</button>`,
    script: `
    var form = document.getElementById('authForm');
    var username = document.getElementById('username');
    var pw = document.getElementById('password');
    var cf = document.getElementById('confirm');
    var match = document.getElementById('matchHint');
    var error = document.getElementById('error');
    var submit = document.getElementById('submit');

    function updateMatch() {
      cf.removeAttribute('aria-invalid');
      if (!cf.value) {
        match.textContent = '';
        match.className = 'hint';
      } else if (pw.value === cf.value) {
        match.textContent = '\u2713 Passwords match';
        match.className = 'hint hint--ok';
      } else {
        match.textContent = 'Passwords do not match yet';
        match.className = 'hint hint--bad';
      }
    }
    pw.addEventListener('input', updateMatch);
    cf.addEventListener('input', updateMatch);
    username.addEventListener('input', function () {
      username.removeAttribute('aria-invalid');
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      error.textContent = '';
      if (username.value.length < 1) {
        error.textContent = 'Enter a username';
        username.setAttribute('aria-invalid', 'true');
        username.focus();
        return;
      }
      if (pw.value.length < 1) {
        error.textContent = 'Enter a password';
        pw.focus();
        return;
      }
      if (pw.value !== cf.value) {
        error.textContent = 'The passwords do not match';
        cf.value = '';
        updateMatch();
        cf.setAttribute('aria-invalid', 'true');
        cf.focus();
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Creating\u2026';
      try {
        var res = await fetch('/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username.value, password: pw.value }),
        });
        if (res.ok) {
          window.location = '/';
          return;
        } else if (res.status === 403) {
          error.textContent = 'Setup is already done. Please sign in';
        } else if (res.status === 400) {
          error.textContent = 'Invalid request (usernames use letters, digits, _ and -, up to 32 characters)';
          username.setAttribute('aria-invalid', 'true');
        } else {
          error.textContent = 'Something went wrong';
        }
      } catch (err) {
        error.textContent = 'Network error, please try again';
      }
      submit.disabled = false;
      submit.textContent = 'Create account and sign in';
    });`
  });
}

// src/web-runtime.ts
import { networkInterfaces } from "node:os";
import { createRequire } from "node:module";
var ALL_INTERFACES_HOST = "0.0.0.0";
function resolveLanTrust(bindHost, extra) {
  const lanAddresses = bindHost === ALL_INTERFACES_HOST ? Object.values(networkInterfaces()).flat().filter((iface) => iface !== void 0 && iface.family === "IPv4" && !iface.internal).map((iface) => iface.address) : [];
  return { lanAddresses, trustedHosts: [...lanAddresses, ...extra] };
}
function resolveDistIndex() {
  const require2 = createRequire(import.meta.url);
  try {
    return require2.resolve("@deepseek-ai/dsh-web-frontend/dist/index.html");
  } catch {
    throw new Error("dsh-login: frontend dist not found; run pnpm run build from the deepseek-harness repository root first, or set config.distIndex explicitly");
  }
}
var DSH_WEB_URL = "DSH_WEB_URL";
var LOOPBACK_HOST = "127.0.0.1";
function urlHost(bindHost) {
  return bindHost === ALL_INTERFACES_HOST ? LOOPBACK_HOST : bindHost;
}
function printWebUrl(ctx, runtime) {
  const print = () => {
    const webServer = ctx.get("webServer");
    if (webServer === void 0) return;
    const host = urlHost(webServer.host);
    const lanCandidate = runtime.lanAddresses[0];
    const suffix = lanCandidate === void 0 ? "" : ` (LAN: http://${lanCandidate}:${String(webServer.port)})`;
    console.log(`dsh web: http://${host}:${String(webServer.port)}${suffix}`);
  };
  const settled = ctx.get("loader")?.await();
  if (settled === void 0) print();
  else void settled.then(() => print(), () => {
  });
}
function advertisedUrl(ctx) {
  const webServer = ctx.get("webServer");
  if (webServer === void 0) return "";
  const origin = webServer;
  if (typeof origin.getOrigin === "function") {
    try {
      return origin.getOrigin();
    } catch {
    }
  }
  return `http://${urlHost(webServer.host)}:${String(webServer.port)}`;
}
function provideWebRuntime(ctx, trustedHosts) {
  const runtime = resolveLanTrust(ctx.webServer.host, trustedHosts);
  ctx.provide("webRuntime", runtime);
  ctx.provide("webApp", { getAdvertisedUrl: () => advertisedUrl(ctx) });
  printWebUrl(ctx, runtime);
  const shellEnv = ctx.get("shellEnv");
  if (shellEnv !== void 0) {
    ctx.effect(() => shellEnv.register({
      name: "web-runtime",
      variables: {
        [DSH_WEB_URL]: { description: "Canonical local URL of the DeepSeek Harness Web GUI serving this session." }
      },
      resolve: () => {
        const webServer = ctx.get("webServer");
        if (webServer === void 0) return { [DSH_WEB_URL]: "" };
        return { [DSH_WEB_URL]: `http://${urlHost(webServer.host)}:${String(webServer.port)}` };
      }
    }), "dsh-login: DSH_WEB_URL shell variable");
  }
  return runtime;
}

// src/remote-guard.ts
var ADMIN_ONLY_NAMESPACES = /* @__PURE__ */ new Set([
  "credentials",
  "settings",
  "agentPresets",
  // DSH 0.1.6-alpha.2: the native plugin manager installs, enables, disables,
  // and removes profile bundles — never reachable by an ordinary user.
  "pluginManager",
  // DSH 0.1.7-alpha.2: the account controller (`namespace: 'account'`) drives
  // the process-wide upstream DeepSeek Platform grant — startSignIn/signOut/
  // cancelSignIn rebind or revoke THE instance's account — and even the read
  // projections (getState/getProfile/getBalance) expose the operator's
  // profile and recharge-wallet balance. Entire namespace is admin-only;
  // ordinary users are denied by default (absent from USER_ALLOWED), this is
  // defense-in-depth, and capabilities.ts mirrors it in the two-segment deny
  // list and the quiet-deny set.
  "account",
  // DSH 0.2.1-alpha.4: the plugin market (`namespace: 'pluginMarket'`) reads
  // and WRITES the instance-wide market index list — `setIndexes` reconfigures
  // which registries every install resolves against — and the same posture as
  // pluginManager applies. Ordinary users are denied by default (absent from
  // USER_ALLOWED), this is defense-in-depth, and capabilities.ts mirrors it in
  // the two-segment deny list and the quiet-deny set.
  "pluginMarket"
]);
var GUARDED_ID_FIELDS = [
  "sessionId",
  "sessionIds",
  "parentSessionId",
  "parentSessionIds",
  "childSessionId",
  "childSessionIds",
  "agentId",
  "workspaceId",
  "beforeSessionId",
  // DSH 0.1.6-alpha.2: the scoped session identity the Gateway's
  // workspaceFileScope lookup resolves for the document-preview surface
  // (`workspaceFiles.*`, `officeToPdf.render`) — carries a SessionId on the
  // wire exactly like `sessionId`.
  "workspaceFileScopeId"
];
function collectIds(value) {
  if (typeof value === "string") return value === "" ? [] : [value];
  if (Array.isArray(value)) return value.flatMap(collectIds);
  if (typeof value === "object" && value !== null) {
    const record = value;
    for (const key of ["id", "sessionId", "sessionIds", "agentId", "workspaceId"]) {
      const nested = record[key];
      if (nested !== void 0) return collectIds(nested);
    }
    for (const [k, v] of Object.entries(record)) {
      if (GUARDED_ID_FIELDS.includes(k)) {
        return collectIds(v);
      }
    }
  }
  return [];
}
function forbidden(namespace, method) {
  return Object.assign(new Error(`dsh-login: forbidden: ${namespace}.${method}`), { code: "forbidden" });
}
function wrapRemoteGateway(gateway, resolveUser, owns = () => false) {
  const allowed = (user, namespace, method) => {
    if (user.isAdmin) return true;
    if (ADMIN_ONLY_NAMESPACES.has(namespace)) return false;
    return USER_ALLOWED.has(`${namespace}.${method}`);
  };
  const ownershipGuarded = (user, request) => {
    if (user.isAdmin) return true;
    for (const field of GUARDED_ID_FIELDS) {
      for (const id of collectIds(request.args[field])) {
        if (id !== "" && !owns(id)) return false;
      }
    }
    return true;
  };
  const refuse = (user, request) => user === void 0 || !allowed(user, request.namespace, request.method) || !ownershipGuarded(user, request);
  return {
    // Forward every non-dispatch member of the live gateway unchanged
    // (e.g. DSH 0.2.0-rc.2's `hasLiveClient()`), then override the two
    // dispatch methods with the guarded implementations.
    ...gateway,
    async invoke(request) {
      if (refuse(resolveUser(), request)) throw forbidden(request.namespace, request.method);
      return gateway.invoke(request);
    },
    async stream(request) {
      if (refuse(resolveUser(), request)) throw forbidden(request.namespace, request.method);
      return gateway.stream(request);
    }
  };
}
function createRemoteIsolation(options) {
  const resolveUser = () => {
    const sid = options.currentSessionId();
    if (sid === void 0) return void 0;
    const adminUser = options.isAdminSession?.(sid);
    if (adminUser !== void 0 && adminUser !== "") {
      return { username: adminUser, isAdmin: true };
    }
    const username = options.ownership.lookup(sid);
    if (username === void 0 || username === "") return void 0;
    return { username, isAdmin: options.isAdmin?.(username) ?? false };
  };
  const owns = (id) => {
    const user = resolveUser();
    if (user === void 0) return false;
    if (user.isAdmin) return true;
    return options.ownership.lookup(id) === user.username;
  };
  return { resolveUser, owns };
}

// src/glue.ts
var DSH_LOGIN_OWNERSHIP_SERVICE = "dshLoginOwnership";
function createDshLoginIsolation(deps) {
  return createRemoteIsolation({
    ownership: deps.ownership,
    currentSessionId: deps.currentSessionId ?? (() => void 0),
    isAdmin: deps.isAdmin
  });
}
function composeGuardedGateway(gateway, isolation) {
  return wrapRemoteGateway(gateway, isolation.resolveUser, isolation.owns);
}
function getDshLoginOwnership(ctx) {
  try {
    const get = ctx.get;
    return get.call(ctx, DSH_LOGIN_OWNERSHIP_SERVICE);
  } catch {
    return void 0;
  }
}
function composeDshLoginGuard(ctx, gateway) {
  const ownership = getDshLoginOwnership(ctx);
  if (ownership === void 0) return gateway;
  const agents = ctx.agents;
  const isolation = createDshLoginIsolation({
    ownership,
    currentSessionId: () => agents?.currentInitiator?.()?.id
  });
  return composeGuardedGateway(gateway, isolation);
}

// src/index.ts
var name = "dsh-login";
var inject = ["webServer", "credentials"];
function apply(ctx, config) {
  if (!config.enabled) return;
  const dataDir = config.dataDir === "" ? join3(resolveDshHome(), ".dsh-login") : config.dataDir;
  const store = new SessionStore(config.sessionTtl, join3(dataDir, "sessions.json"));
  const users = new UserStore(ctx.credentials, credentialRef(`${config.password}_USERS`));
  const ownership = new OwnershipIndex(join3(dataDir, "ownership.json"));
  const hosts = new TrustedHosts(join3(dataDir, "trusted-hosts.json"));
  const defaultWorkspaceSetting = new DefaultWorkspaceSetting(join3(dataDir, "settings.json"), config.defaultWorkspace);
  const remoteWebUiSetting = new BooleanSetting(join3(dataDir, "settings-remote-web-ui.json"), config.remoteWebUiCompat);
  const remoteWebUiCompat = new RemoteWebUiCompat({
    getSettings: () => ctx.get("settings")
  });
  const distIndex = config.distIndex === "" ? resolveDistIndex() : config.distIndex;
  const gatewayConfig = { ...config, distIndex };
  const loginDeps = { users, store, sessionTtl: config.sessionTtl, hosts, autoTrust: config.autoTrustHosts };
  const runtime = config.takeOverWebRuntime ? provideWebRuntime(ctx, config.trustedHosts) : void 0;
  const workspaceRootSetting = new WorkspaceRootSetting(
    join3(dataDir, "settings-workspace-root.json"),
    config.workspaceRoot === "" ? join3(resolveDshHome(), "workspaces") : config.workspaceRoot
  );
  const provisioner = new DefaultWorkspaceProvisioner({
    workspaceRoot: () => workspaceRootSetting.get(),
    getApi: createHostSessionApi(ctx),
    ownership,
    getRegistry: () => tryGetService(ctx, "workspaceRegistry"),
    enabled: () => defaultWorkspaceSetting.get()
  });
  ctx.provide("dshLoginOwnership", ownership);
  const loginPageRoute = {
    kind: "exact",
    path: "/login",
    handler: async (_req, res) => {
      const html = await users.isEmpty() ? renderSetupPage() : renderLoginPage();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    }
  };
  const gatewayHandler = createGatewayHandler(ctx, gatewayConfig, store);
  ctx.effect(() => ctx.webServer.register(loginPageRoute), "dsh-login: /login");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/api/auth/setup",
    handler: createSetupHandler(loginDeps)
  }), "dsh-login: /api/auth/setup");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/api/auth/login",
    handler: createLoginHandler(loginDeps)
  }), "dsh-login: /api/auth/login");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/api/auth/logout",
    handler: createLogoutHandler(store)
  }), "dsh-login: /api/auth/logout");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/logout",
    handler: createLogoutRedirectHandler(store)
  }), "dsh-login: /logout");
  for (const route of createAdminRoutes({ users, store, hosts, defaultWorkspaceSetting, workspaceRootSetting, remoteWebUiSetting, remoteWebUiCompat, onRemoteWebUiApply: (enabled) => applyWithRetry(remoteWebUiCompat, enabled, config.remoteWebUiPublicBaseUrl, 3, 50) })) {
    ctx.effect(() => ctx.webServer.register(route), `dsh-login: ${route.path}`);
  }
  const bootCompat = applyWithRetry(remoteWebUiCompat, remoteWebUiSetting.get(), config.remoteWebUiPublicBaseUrl);
  void bootCompat;
  ctx.effect(() => ctx.webServer.registerFallback(gatewayHandler), "dsh-login: gateway fallback");
  if (config.apiBridgeAuth) {
    const ownedProvider = (username) => probeOwnedSessionIds(username, ownership, createHostSessionSource(ctx));
    ctx.effect(
      () => ctx.on("connection/request", createApiBridgeAuth({
        store,
        ownership,
        quietDenials: config.quietDenials,
        ownedProvider,
        provisioner,
        // Ordinary users may only name folders inside their own
        // <workspace root>/<username> (path-fence.ts); admins are not fenced.
        userFolder: (username) => userSandboxDir(workspaceRootSetting.get(), username)
      }), { global: true }),
      "dsh-login: /api bridge auth wall"
    );
  }
  const cap = deriveCapabilities({ username: "", isAdmin: false });
  const sessionBaselineScript = `window.__DSH_SESSION__={username:null,isAdmin:false,capabilities:${JSON.stringify(cap)}};`;
  ctx.effect(() => ctx.on("webserver/index-inject", (table) => {
    table.push({ kind: "script", placement: "head", text: sessionBaselineScript });
  }), "dsh-login: capability baseline injection");
  ctx.effect(() => () => Promise.all([store.flush(), ownership.flush(), hosts.flush(), defaultWorkspaceSetting.flush(), workspaceRootSetting.flush(), remoteWebUiSetting.flush()]), "dsh-login: sessions + ownership + hosts + settings flush");
}
export {
  Config,
  DSH_LOGIN_OWNERSHIP_SERVICE,
  apply,
  composeDshLoginGuard,
  composeGuardedGateway,
  createDshLoginIsolation,
  createRemoteIsolation,
  getDshLoginOwnership,
  inject,
  name,
  wrapRemoteGateway
};
//# sourceMappingURL=index.js.map
