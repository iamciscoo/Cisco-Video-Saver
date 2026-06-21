# Cobalt Video Saver

Local Docker setup for a customized Cobalt instance with a YouTube download helper. The web UI is served by nginx, Cobalt runs from the official Docker image, and a small local service handles YouTube format detection and downloads with `yt-dlp`.

## What is included

- `docker-compose.yml` starts the full local stack.
- `docker/nginx/` contains nginx config for the Cobalt web UI and the YouTube session bridge.
- `services/youtube-downloader/` contains the local `yt-dlp` bridge used by the custom YouTube panel.
- `cobalt-source/` contains the patched Cobalt source used to build the web UI and override selected API files.
- `downloads/` is created locally at runtime and is intentionally ignored by Git.

## Requirements

- Docker Desktop
- Node.js 20 or newer
- pnpm 9 or newer

## First-time setup

From the project root:

```powershell
Copy-Item cobalt-source\web\.env.example cobalt-source\web\.env
cd cobalt-source
corepack enable
pnpm install
cd web
pnpm run build
cd ..\..
docker compose up -d --build
```

Open the app at:

```text
http://localhost:5173
```

The Cobalt API is exposed locally at `http://localhost:9000`, and the YouTube helper API is exposed at `http://localhost:8787`.

## Rebuild after frontend changes

When editing files under `cobalt-source/web/src` or `cobalt-source/web/static`, rebuild the static web app and restart nginx:

```powershell
cd cobalt-source\web
pnpm run build
cd ..\..
docker compose restart cobalt-web
```

## Useful Docker commands

```powershell
docker compose ps
docker compose logs -f youtube-downloader
docker compose restart cobalt-web
docker compose down
```

Downloaded files are written to `downloads/`.

## GitHub setup

This folder is already a Git repository. Before the first commit, decide how you want to handle `cobalt-source`:

1. Vendored source, simplest for this project:

   Remove the nested Git metadata inside `cobalt-source`, then add and commit normally.

   ```powershell
   Remove-Item -Recurse -Force cobalt-source\.git
   git add .
   git commit -m "Initial Cobalt video saver setup"
   ```

2. Submodule, cleaner if you want to track upstream Cobalt separately:

   Keep `cobalt-source\.git`, add it as a submodule or replace it with a proper `git submodule add` workflow.

For a new GitHub repository, create an empty repo on GitHub, then run:

```powershell
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

Only download videos you have the rights or permission to save.
