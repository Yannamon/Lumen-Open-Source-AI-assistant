lumen-Open-Source-AI-assistant
Local voice-first personal assistant built with Next.js and LM Studio, featuring chat, browser speech playback, microphone input, screen-audio transcription, internet-grounded answers, and optional Home Assistant/SMTP integrations.

# Personal Voice Assistant

A Next.js + TypeScript local voice-enabled assistant that runs in your browser and uses your LM Studio server as the model backend.

## What it does

- Serves a local Next.js web app at `http://localhost:3000`
- Detects available chat models from your LM Studio server at `http://yourip:1234`
- Accepts typed prompts or microphone input in the browser
- Speaks assistant replies aloud with browser text-to-speech
- Lets you tune the assistant name, system prompt, model, temperature, and reply length
- Includes an optional Agent mode for multi-step tasks using built-in tools like internet search, email, system info, and local app controls
- Hides raw chain-of-thought style output and returns clean final answers, including stripping `<think>` blocks from models that emit them
- Includes quick actions for grammar checking and Microsoft Lists guidance
- Can capture a shared browser tab or screen audio feed and transcribe it through LocalAI or another OpenAI-compatible transcription API

## Agent mode

When `Agent mode for multi-step tasks` is turned on in the UI, the assistant now runs through a Mastra workflow with explicit `plan -> review -> execute -> summarize` stages. Instead of executing tool calls immediately, it builds an action queue, applies safety tiers, pauses for approval when needed, resumes from persisted state, and then writes the final answer.

Built-in agent tools:

- `Current date and time`: checks the local machine clock instead of guessing
- `Internet search`: uses DuckDuckGo server-side to gather grounded web results and return clickable source links
- `Computer control`: opens supported local apps, controls Spotify playback, opens VS Code, and reads system, CPU, or memory status
- `Home Assistant`: checks entity state, lists supported domains, calls services, and can search or play radio stations through Home Assistant
- `Email`: sends through configured SMTP or opens a local draft

Examples of tasks Agent mode can handle well:

- "What time is it here, and what day is it?"
- "Look up today's weather and summarize it with sources."
- "Open VS Code and show my system info."
- "Check the state of `light.kitchen` and then turn it off."
- "Draft an email to the team about tomorrow's deployment."
- "Search for Jazz FM and play it on my living room speaker through Home Assistant."

Agent mode guardrails:

- It only uses the built-in tool set above
- It uses safety tiers: `safe`, `confirm`, and `blocked`
- It requires approval before `send_email`, computer-control actions, and destructive Home Assistant actions
- It persists suspended workflow state so approvals can resume the same run
- It does not run arbitrary shell commands on its own
- It does not automate Codex window pasting or submission from within agent mode
- If the task needs the web, `Use internet for grounded answers` should also be enabled

## Reasoning

This project already includes a lightweight reasoning workflow aimed at practical local assistant tasks rather than exposing a long visible "thinking" transcript.

Current reasoning-related features:

- `Mastra workflow control`: Agent mode uses a persisted workflow with explicit planning, review, execution, and summarization stages
- `Visible action queue`: the UI shows queued actions, safety tiers, approval state, and execution results
- `Human approval gates`: higher-risk actions pause the workflow until you approve or reject them
- `Grounded reasoning`: when internet grounding is enabled, the assistant can search first and answer with clickable sources instead of relying only on model memory
- `Time-aware reasoning`: the app injects the exact local date, time, and timezone into the prompt so "today", "tomorrow", and "what time is it" requests do not depend on model guesses
- `Clean final-answer mode`: the assistant instructs the model not to expose hidden chain-of-thought, and the app strips `<think>...</think>` blocks before showing or speaking a reply
- `Voice-safe output`: replies can be post-processed for speech so the spoken answer stays natural and concise instead of reading internal reasoning aloud
- `Reasoning-model compatible`: you can still point the UI at reasoning-capable models in LM Studio, but the default model picker intentionally favors chat/instruct models for faster voice-first interaction

Open-source references that informed this section:

- [OctoTools](https://github.com/octotools/octotools): an open-source planner/executor framework for complex reasoning with extensible tool cards
- [tRPC-Agent-Go](https://github.com/trpc-group/trpc-agent-go): a framework that separates planning, tools, memory, and execution flow, including cycle-based planner/executor loops

If you want to evolve this project further, those repos are good references for features like stronger planners, reusable tool metadata, memory layers, evaluation loops, and more explicit multi-agent orchestration.

## Run it

1. Open LM Studio, go to `Developer`, and turn on the `Developer Server` so the local server is running on `http://yourip:1234`
2. From this folder, run:

```powershell
npm install
npm run build
npm run dev
```

3. Open `http://localhost:3000` in Chrome or Edge

4. Optional for `Screen transcript`: run LocalAI locally on `http://127.0.0.1:8080` and load a Whisper model such as `whisper-1`

`npm run dev` uses a small in-process launcher for Next.js dev mode so Windows setups that hit `spawn EPERM` can still start cleanly. `npm run dev:next` now points to the same safe launcher so the Windows `spawn EPERM` path does not come back by accident.

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
- Screen or tab transcription now defaults to LocalAI at `http://127.0.0.1:8080/v1` with model `whisper-1`.
- If your LocalAI setup does not require auth, you can leave the transcription API key blank.
- You can still point transcription at any other OpenAI-compatible speech-to-text endpoint if you prefer.
- Internet search is available through DuckDuckGo on the server side, with no browser-exposed API key needed.
- Turn on `Use internet for grounded answers` in the UI to search the web and return clickable source links.
- Turn on `Agent mode for multi-step tasks` in the UI if you want the assistant to decide when to use its built-in tools before answering. Agent mode can check time, search the web, control a limited set of local actions, talk to Home Assistant, and send or draft email, but it does not run arbitrary shell commands on its own.
- Use the `Grammar check` quick action or start a message with `Grammar check:` to get a corrected version plus key improvements.
- Use the `Microsoft Lists` quick action to get practical ideas for templates, conditional formatting, and Microsoft 365 integrations.
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
- Direct local computer control supports a little more than Agent mode does. For example, explicit user commands like `Run npm test` or `Paste to Codex: ...` are available, but Agent mode itself intentionally blocks arbitrary shell commands and Codex window automation.
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
