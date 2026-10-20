# dsh-login (English fork)

Sign-in and separate user accounts for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) web UI.

This is a fork of [islibaodong/dsh-login](https://github.com/islibaodong/dsh-login) with the sign-in and setup pages in English. Everything else is upstream's code. The package keeps its upstream name, `@islibaodong/dsh-login`, so it replaces the upstream copy in place.

| Sign-in page | Settings → Users |
|:---:|:---:|
| ![Sign-in page](images/login.png) | ![User management](images/users.png) |

## Why

The DSH web UI has no login: it assumes one person on localhost. Once it is reachable on a network, anyone who can open it can read every conversation, use your model keys and change settings. dsh-login puts a sign-in wall in front of it and gives each person their own account.

## What you get

- **Sign-in wall:** pages, assets, the API and WebSockets all need a valid session. Visitors without one land on `/login`.
- **Accounts:** the first visit creates the administrator. The admin adds everyone else under Settings → Users.
- **Separate conversations:** ordinary users see only their own sessions, subagents and workspace. Credentials, plugins, presets and host settings are admin only.
- **Own workspace per user:** each ordinary user gets a private workspace folder on first visit (`<root>/<username>`), where they create folders for their chats. Admins pick the root folder under Settings → Users (it defaults to `<DSH_HOME>/workspaces`, or the `workspaceRoot` config). Ordinary users can't create workspaces or sessions in any folder outside their own.
- **User management:** admins see last sign-in and online status, and can reset passwords, disable or remove users. Each change signs that user out at once.
- **Sessions survive restarts:** the cookie is HttpOnly, SameSite=Strict and lasts 7 days. Passwords are stored as scrypt hashes.

## Install

```bash
dsh plugin --profile web add github:ViriatusOG/dsh-login
```

Restart `dsh web` and open it. The first visit asks you to create the administrator account. Then sign in and add users under **Settings → Users → Create user**.

`dist/` is committed and there is no build script, so the install from git runs nothing. To pin a version, add `#<commit>` to the address.

Remove it with:

```bash
dsh plugin --profile web remove @islibaodong/dsh-login
```

Removing the plugin keeps the accounts (they live in DSH's credential store), so adding it again brings them back.

## Good to know

- **Everyone runs on one machine account.** Accounts keep conversations apart, but every user's agent runs commands on the server as the user DSH runs as. Only give accounts to people you trust with that.
- **Use HTTPS on the internet.** Over plain HTTP the session cookie is sent in the clear. Put a reverse proxy with TLS (nginx, Caddy) in front for anything beyond a home LAN.
- **Tunnels and other hosts work.** A host you sign in through once (frp, a tunnel, a LAN address) is trusted from then on. The list is in Settings → Users → Allowed hosts.
- **Ordinary users can't pick host folders.** That's on purpose, and their own workspace is created for them instead.

## Where data lives

| What | Where |
|------|-------|
| Accounts (scrypt hashes) | DSH credentials, ref `DSH_LOGIN_PASSWORD_USERS` |
| Sign-in sessions | `<DSH_HOME>/.dsh-login/sessions.json` |
| Who owns which session | `<DSH_HOME>/.dsh-login/ownership.json` |
| Trusted hosts, settings | `<DSH_HOME>/.dsh-login/*.json` |

## Keeping up with upstream

Versions are upstream's plus `-en.N` (this one is `0.3.5-en.1`). For a new upstream release:

1. Merge upstream into `master`.
2. If `src/login-page.ts` changed, re-apply the English text.
3. Rebuild with `node scripts/build-host.mjs` (only `esbuild` is needed) and commit `dist/`.
4. Bump the version.

How it works inside (routes, the API wall, the permission model, compatibility notes per DSH version) is documented in detail in [upstream's README](https://github.com/islibaodong/dsh-login#readme) and in [`docs/`](docs/).

## License

MIT, as upstream. See [LICENSE](LICENSE).
