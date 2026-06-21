# Cisco Video Saver

Local Docker setup for Cisco Video Saver, a self-hosted video downloader for supported platforms. Paste a link from any service shown in the app's supported services list and Cisco will try to fetch the available media. YouTube links also get a local helper panel with quality choices powered by `yt-dlp`.

## What is included

- `docker-compose.yml` starts the full local stack.
- `docker/nginx/` contains nginx config for the Cisco web UI and the YouTube session bridge.
- `services/youtube-downloader/` contains the local `yt-dlp` bridge used by the custom YouTube panel.
- `cobalt-source/` contains the patched upstream source used to build the Cisco web UI and override selected API files.
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

The Cisco processing API is exposed locally at `http://localhost:9000`, and the YouTube helper API is exposed at `http://localhost:8787`.

## Supported platforms

Cisco can download videos, audio, photos, and other media from the services listed in the app's supported services popover. That list is loaded from the running processing server, so supported platforms may change as the server is updated or configured.

The current stack includes support for common services such as YouTube, Vimeo, Twitter/X, TikTok, Instagram, Facebook, Reddit, SoundCloud, Pinterest, Bluesky, Dailymotion, Snapchat, Twitch clips, VK, Rutube, Tumblr, Loom, Streamable, Bilibili, Newgrounds, and others reported by the app.

Support for a platform means technical compatibility only. It does not imply affiliation, endorsement, or permission to save protected content.

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
   git commit -m "Initial Cisco video saver setup"
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
