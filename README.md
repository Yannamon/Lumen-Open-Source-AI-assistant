lumen-Open-Source-AI-assistant
Local voice-first personal assistant built with Next.js and LM Studio, featuring chat, browser speech playback, microphone input, screen-audio transcription, internet-grounded answers, and optional Home Assistant/SMTP integrations.

# Personal Voice Assistant

A Next.js + TypeScript local voice-enabled assistant that runs in your browser and uses your LM Studio server as the model backend.

## What it does

- Serves a local Next.js web app at `http://localhost:3000`
- Detects available chat models from your LM Studio server at `http://127.0.0.1:1234`
- Accepts typed prompts or microphone input in the browser
- Speaks assistant replies aloud with browser text-to-speech
- Lets you tune the assistant name, system prompt, model, temperature, and reply length
- Can capture a shared browser tab or screen audio feed and transcribe it through an OpenAI-compatible transcription API

## Run it

1. Make sure LM Studio's local server is running on `http://127.0.0.1:1234`
2. From this folder, run:

```powershell
npm install
npm run dev
```

3. Open `http://localhost:3000` in Chrome or Edge

`npm run dev` uses a small in-process launcher for Next.js dev mode so Windows setups that hit `spawn EPERM` can still start cleanly. If you want to try the stock Next CLI directly, use `npm run dev:next`.

## Production

```powershell
npm run build
npm start
```

Run `npm run build` before `npm start` so the production `.next` output is prepared.

If you run the standalone server or the Docker image, the build now copies Next.js `vendor-chunks` into the standalone output so production startup does not fail with missing `.next/server/vendor-chunks/next.js` files.

## Docker

Build the image:

```powershell
docker build -t virtual-assistant-beta .
```

Run the container:

```powershell
docker run --rm -p 3000:3000 `
  -e LM_STUDIO_BASE_URL=http://host.docker.internal:1234 `
  virtual-assistant-beta
```

If LM Studio is running on the same Windows machine as Docker Desktop, `host.docker.internal` is the simplest container-safe URL. If your LM Studio server is on another machine, point `LM_STUDIO_BASE_URL` to that reachable IP or hostname instead.

## Notes

- Speech recognition uses the browser Web Speech API, so Chrome or Edge will work best.
- Use `http://localhost:3000` on the same computer for microphone access. Opening the app from a plain file path or some non-localhost HTTP addresses can block browser speech features.
- If you want a different backend URL, set `LM_STUDIO_BASE_URL` before starting Next.js.
- Screen or tab transcription is configured separately from LM Studio. Save a transcription API base URL, model, and API key in the UI before using `Screen transcript`.
- Internet search is available through DuckDuckGo on the server side, with no browser-exposed API key needed.
- Turn on `Use internet for grounded answers` in the UI to search the web and return clickable source links.
- Home Assistant is supported through its official REST API. Save your Home Assistant base URL and a long-lived access token in the UI to enable it.
- For Radio Browser playback through Home Assistant, you can also save a default `media_player.*` entity in the UI.
- To transcribe media playing in a browser tab, open `Screen transcript`, choose `Share screen`, pick a tab, and enable audio sharing before you stop and transcribe.
- Local computer control is built in for a few safe commands. Examples:
  - `Open Spotify`
  - `Open Spotify web app`
  - `Play music on Spotify`
  - `Play music on Spotify web`
  - `Open VS Code`
  - `Open this project in VS Code`
  - `Open folder public in VS Code`
  - `Run npm test`
  - `Run python script.py`
  - `Show system info`
  - `Show CPU usage`
  - `Show memory usage`
  - `Paste to Codex: explain this codebase`
  - `Send to Codex and submit: build a React login form`
  - `Home Assistant status light.kitchen`
  - `Home Assistant turn on light.kitchen`
  - `Home Assistant call script.turn_on with {"entity_id":"script.goodnight"}`
  - `Home Assistant list lights`
  - `Home Assistant search radio Jazz FM`
  - `Home Assistant play radio Jazz FM`
  - `Home Assistant play radio BBC World Service on media_player.living_room`
  - `Pause Spotify`
  - `Next track`
  - `Previous track`
  - `Open Notepad`
  - `Open Calculator`
- SMTP sending is built in for Hostinger-style SSL SMTP. Set these environment variables before starting the app:

```powershell
$env:SMTP_HOST='smtp.example.com'
$env:SMTP_PORT='465'
$env:SMTP_USER='your-email@example.com'
$env:SMTP_PASS='your-mailbox-password'
$env:SMTP_FROM='your-email@example.com'
npm run dev
```

- Say `Send email to someone@example.com subject Hello body Thanks for your help.` to send through SMTP.
- Say `Draft email to someone@example.com subject Hello body Thanks for your help.` to open a local draft instead.
- The previous standalone Node server is still available through `npm run legacy:start` while you compare behavior during the migration.

## Open Source Checklist

- Use `.env.example` as the template for local secrets and keep real values in untracked `.env` files.
- Rotate any API keys, SMTP passwords, or Home Assistant tokens that may have been used in this project before publishing.
- Double-check git history separately if this folder ever lived inside another repository with real secrets committed earlier.
