# chat.stcuthberts.college — LibreChat deployment & sync notes

## Repo layout
- `origin` — https://github.com/stcuthbertsnz/LibreChat.git (the school's fork; this is what the droplet and production deploy from)
- `upstream` — https://github.com/danny-avila/LibreChat.git (the original open-source project; pull from this only when deliberately bringing in new upstream features)
- Upstream's active development branch is `dev`, not `main` — compare against `upstream/dev` if checking for unreleased features.

## How the droplet gets updates
There is no CI/CD or webhook auto-deploy in this repo — updates are a manual process on the droplet:
```
cd ~/LibreChat
git pull origin main
docker compose -f deploy-compose.yml pull
docker compose -f deploy-compose.yml up -d
docker compose -f deploy-compose.yml logs -f api
```
The `api` container runs this fork's own image, `ghcr.io/stcuthbertsnz/librechat-api:latest`, built from `Dockerfile.multi` (target `api-build`) by `.github/workflows/ghcr.yml` on every push to `main` that touches app code, `packages/`, the lockfile or the Dockerfile. A merge to `main` therefore ships fork changes (such as the conversation delete gate) only once that workflow has finished: check the run is green before pulling. The admin-panel and rag containers still run prebuilt upstream images from `registry.librechat.ai`.

`git pull` updates the bind-mounted config files (`deploy-compose.yml`, `.env`, `client/nginx.conf`, `librechat.yaml`, `branding/`, `skill/`). `docker compose pull` fetches new images while the running containers keep serving, so a failed pull leaves production untouched. `up -d` then recreates only the containers whose image or config changed.

### Pulling the private GHCR image
The package is private (the organisation disables public packages), so the droplet must be logged in to `ghcr.io` once, with a personal access token (classic) that has only the `read:packages` scope, authorised for SSO if the organisation enforces it:
```
echo '<token>' | docker login ghcr.io -u <github-username> --password-stdin
```
The credential is stored unencrypted in `~/.docker/config.json`. If `docker compose pull` reports `denied` or `unauthorized` for `ghcr.io`, the token has expired or lost access: create a new one and log in again.

### Rolling back the api image
Before updating, note the image the api container is running: `docker compose -f deploy-compose.yml images`. Every build is also tagged `sha-<commit>`, so to pin a known-good build set the `api` service's `image:` to `ghcr.io/stcuthbertsnz/librechat-api:sha-<commit>` and run `up -d`. To fall back to upstream's unmodified build, set it to `registry.librechat.ai/librechat-ai/librechat-dev-api:latest` (this build has no conversation delete gate).

## Droplet-specific customizations (now tracked in git, as of commits aefa64dc3 / 399a7b6f2 on 2026-08-18)
- `branding/favicon-32x32.png` and `favicon-16x16.png` — custom favicon, bind-mounted into the api container in `deploy-compose.yml`.
- `admin-panel` service in `deploy-compose.yml` is bound to `127.0.0.1:3000` only — the admin panel is not exposed publicly; reach it via an SSH tunnel to the droplet.
- `client/nginx.conf` — real production config: `server_name chat.stcuthberts.college`, HTTP (port 80) redirects to HTTPS, and a live SSL server block using Let's Encrypt certs at `/etc/letsencrypt/live/chat.stcuthberts.college/`.
- Conversation delete is gated by a per-role permission (`CONVERSATIONS.DELETE`, default allowed). Turn it off for a role with `node config/set-conversation-delete-permission.js <roleName> false`; the Delete action then disappears from the conversation menu and the shift-held quick action. This only exists in the fork's image, not in upstream's.
- Mongo's `depends_on`/`MONGO_URI` were removed from the api service's inline config in `deploy-compose.yml` — Mongo connection details are expected to come from `.env` / `env_file` instead of being hardcoded.

These previously sat as uncommitted local edits on the droplet (meaning a plain `git pull` would fail with "local changes would be overwritten"). They've since been committed and pushed to `origin/main`, so future pulls should be clean unless someone edits these files directly on the server again without committing.

## Droplet → GitHub auth
See Notion for details of deployment pipeline.

## Checking sync status (any machine)
```
git remote -v                                   # confirms which repo(s) this clone points at
git fetch origin && git status                  # ahead/behind vs origin/main
git log HEAD..origin/main --oneline              # commits you're missing
git log origin/main..HEAD --oneline              # local commits not yet pushed
```

## Auth setup — Entra ID (Azure AD) OpenID SSO
Students and staff log in via Microsoft Entra ID OIDC (`OPENID_*` vars in `.env`), not local email/password or Google. Key pieces:
- Entra app registration "librechat" has two **App roles**: `LibreChat Students` (value `LibreChat-Student`) and `LibreChat Staff` (value `LibreChat-Staff`). The **Enterprise Application → Users and groups** blade assigns the `librechat-Staff` and `librechat-Student` security groups to those roles respectively.
- `.env` gates access with `OPENID_REQUIRED_ROLE=LibreChat-Staff,LibreChat-Student` (checked against the `roles` claim in the ID token) and additionally runs **OpenID role sync** (`OPENID_ROLE_SYNC_ENABLED=true`) to map the incoming Entra role onto one of LibreChat's own internal RBAC roles, via `OPENID_ROLE_SYNC_ROLE_PRIORITY=LibreChat-Staff,LibreChat-Student` and `OPENID_ROLE_SYNC_FALLBACK_ROLE=LibreChat-Student`.
- LibreChat's internal roles live in Mongo (`librechat` db, `roles` collection — cluster name `CognitiCluster`), separate from Entra's app roles even though the names match. Ships by default with only `ADMIN` and `USER`; custom roles like `LibreChat-Student` / `LibreChat-Staff` must be created manually (via the `admin-panel` container's Roles UI, `127.0.0.1:3000` behind an SSH tunnel) before role sync can use them.
- Admin accounts (role `ADMIN`) skip role sync entirely (log line: `OpenID role sync skipped for <user>; existing ADMIN role is not managed by generic role sync`) — this is why admin/staff-with-admin logins can look fine even when role sync is fully broken for everyone else.

### Operational notes
- OpenID role sync validates that **every** role named in `OPENID_ROLE_SYNC_ROLE_PRIORITY` (and `OPENID_ADMIN_ROLE`/fallback role vars) already exists in Mongo's `roles` collection before it will sync anyone — a single missing role name breaks sync for **all** non-admin logins at once, not just the users mapped to that specific role. Create any new role in the admin panel first, before referencing its name in these env vars.
- Admin accounts skip role sync entirely, so an admin's own successful login is not a valid health check for role sync — it can look completely fine while sync is broken for everyone else.
- The login rate limiter ("Too many login attempts, please try again after 5 minutes") can trip during repeated troubleshooting and looks like a fresh failure — wait it out rather than assuming a fix didn't work.