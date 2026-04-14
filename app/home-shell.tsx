"use client";

import AssistantBootstrap from "./assistant-bootstrap";

const pageMarkup = `
<div class="page-shell">
  <main class="workspace-shell">
    <section class="desktop-window">
      <header class="window-bar">
        <div class="window-controls" aria-hidden="true">
          <span class="window-dot window-dot-close"></span>
          <span class="window-dot window-dot-minimize"></span>
          <span class="window-dot window-dot-expand"></span>
        </div>
        <div class="window-search">Search commands, files, memory</div>
        <div class="window-actions" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </header>

      <div class="desktop-layout">
        <aside class="workspace-sidebar">
          <div class="sidebar-brand">
            <div class="sidebar-brand-mark"></div>
            <div>
              <strong>Lumen</strong>
              <p>Personal voice assistant</p>
            </div>
          </div>

          <nav class="sidebar-nav" aria-label="Workspace sections">
            <button class="sidebar-nav-item is-active" type="button">Today</button>
            <button class="sidebar-nav-item" type="button">Conversations</button>
            <button class="sidebar-nav-item" type="button">Automations</button>
            <button class="sidebar-nav-item" type="button">Memory</button>
            <button class="sidebar-nav-item" type="button">Files</button>
          </nav>

          <section class="sidebar-session">
            <p class="sidebar-section-label">Session</p>
            <div class="sidebar-session-head">
              <span>Voice activity</span>
              <span class="sidebar-session-pill">Ready</span>
            </div>
            <div class="sidebar-meter" aria-hidden="true">
              <span class="sidebar-meter-fill"></span>
            </div>
            <p class="helper-text">Low latency - natural speech ready</p>
            <div class="sidebar-session-actions">
              <button id="listen-button" class="primary-button" type="button">
                Start voice input
              </button>
              <button id="clear-chat" class="ghost-button" type="button">
                Clear session
              </button>
            </div>
          </section>
        </aside>

        <section class="workspace-main">
          <header class="workspace-header">
            <div class="workspace-title-block">
              <p class="eyebrow">Desktop workspace</p>
              <h1 id="hero-title">Lumen is ready</h1>
              <p class="hero-description">
                A polished voice assistant workspace that blends live speaking, transcript,
                actions, and summaries in one calm desktop layout.
              </p>
            </div>

            <div class="workspace-header-actions">
              <div class="workspace-tabs" aria-hidden="true">
                <span class="workspace-tab">Sidebar</span>
                <span class="workspace-tab">Workspace</span>
              </div>
              <button
                id="toggle-control-panel"
                class="ghost-button control-panel-toggle"
                type="button"
                aria-expanded="true"
                aria-controls="control-panel"
              >
                Hide inspector
              </button>
            </div>
          </header>

          <div class="workspace-grid">
            <section class="workspace-focus">
              <section class="hero-card workspace-orb-card">
                <div class="hero-orb" aria-hidden="true">
                  <div class="orb-core">
                    <span class="orb-ring orb-ring-a"></span>
                    <span class="orb-ring orb-ring-b"></span>
                    <span class="orb-ring orb-ring-c"></span>
                    <span class="orb-mic"></span>
                  </div>
                </div>
              </section>

              <section class="shortcut-card">
                <div class="section-head shortcut-card-head">
                  <div>
                    <h3>Quick actions</h3>
                    <p class="helper-text">Run fast chat workflows or seed a new bot profile from a guided prompt.</p>
                  </div>
                  <span class="badge badge-soft">12 actions</span>
                </div>
                <div class="shortcut-grid">
                  <button class="shortcut-tile" type="button" data-prompt="Plan my day and give me the top three priorities.">
                    <span class="shortcut-kicker">Today</span>
                    <strong>Daily plan</strong>
                    <span class="shortcut-note">Top three priorities</span>
                  </button>
                  <button class="shortcut-tile" type="button" data-prompt="Help me write a polished message with a friendly tone.">
                    <span class="shortcut-kicker">Client</span>
                    <strong>Client reply</strong>
                    <span class="shortcut-note">Draft from voice</span>
                  </button>
                  <button class="shortcut-tile" type="button" data-prompt="Summarize this topic into a short, practical explanation.">
                    <span class="shortcut-kicker">Notes</span>
                    <strong>Meeting notes</strong>
                    <span class="shortcut-note">Short practical summary</span>
                  </button>
                  <button class="shortcut-tile" type="button" data-prompt="Brainstorm five creative ideas and recommend the strongest one.">
                    <span class="shortcut-kicker">Research</span>
                    <strong>Idea sprint</strong>
                    <span class="shortcut-note">Five ideas, one pick</span>
                  </button>
                  <button
                    class="shortcut-tile"
                    type="button"
                    data-prompt="Help me with a coding task in detail. Example: build a React component for a pricing page with responsive cards, explain the file structure, and include clean TypeScript."
                  >
                    <span class="shortcut-kicker">Coding</span>
                    <strong>Build feature</strong>
                    <span class="shortcut-note">React and TypeScript</span>
                  </button>
                  <button
                    class="shortcut-tile"
                    type="button"
                    data-prompt="Write a coding command with a clear example. Example: create the exact pnpm, npm, git, or PowerShell command I should run to start the app, install a package, or search the codebase."
                  >
                    <span class="shortcut-kicker">Command</span>
                    <strong>Shell command</strong>
                    <span class="shortcut-note">pnpm, git, PowerShell</span>
                  </button>
                  <button
                    class="shortcut-tile"
                    type="button"
                    data-prompt="Grammar check: Paste your text after this sentence and I will correct grammar, spelling, punctuation, and clarity while preserving your meaning."
                  >
                    <span class="shortcut-kicker">Writing</span>
                    <strong>Grammar check</strong>
                    <span class="shortcut-note">Correct and tighten copy</span>
                  </button>
                  <button
                    class="shortcut-tile"
                    type="button"
                    data-prompt="Show me the hidden gems in Microsoft Lists, especially custom templates, conditional formatting, and integrations with other Microsoft tools. Give practical examples I can use."
                  >
                    <span class="shortcut-kicker">Workflow</span>
                    <strong>Lists guide</strong>
                    <span class="shortcut-note">Templates and integrations</span>
                  </button>
                  <button
                    class="shortcut-tile"
                    type="button"
                    data-bot-prompt="Create a calm real-estate assistant bot that speaks clearly, drafts polished client messages, uses internet research when needed, and keeps answers concise."
                  >
                    <span class="shortcut-kicker">Bot</span>
                    <strong>Real-estate bot</strong>
                    <span class="shortcut-note">Voice-first client helper</span>
                  </button>
                  <button
                    class="shortcut-tile"
                    type="button"
                    data-bot-prompt="Create a private tutor bot for study sessions that explains concepts simply, asks follow-up questions, and adapts explanations for voice conversations."
                  >
                    <span class="shortcut-kicker">Bot</span>
                    <strong>Tutor bot</strong>
                    <span class="shortcut-note">Simple study coaching</span>
                  </button>
                  <button
                    class="shortcut-tile"
                    type="button"
                    data-bot-prompt="Create a support triage bot that sounds confident and empathetic, gathers the right details quickly, and summarizes issues in a structured way."
                  >
                    <span class="shortcut-kicker">Bot</span>
                    <strong>Support bot</strong>
                    <span class="shortcut-note">Fast issue intake</span>
                  </button>
                  <button
                    class="shortcut-tile"
                    type="button"
                    data-bot-prompt="Create a personal coach bot that keeps me focused, helps plan my day, checks in with short voice-friendly prompts, and pushes toward action."
                  >
                    <span class="shortcut-kicker">Bot</span>
                    <strong>Coach bot</strong>
                    <span class="shortcut-note">Planning and accountability</span>
                  </button>
                </div>
              </section>

            </section>

            <section class="workspace-conversation">
              <section class="chat-log-shell conversation-card">
                <div class="section-head conversation-head">
                  <div>
                    <h3>Conversation workspace</h3>
                    <p class="helper-text">Transcript, reasoning, and action log</p>
                  </div>
                  <span class="badge badge-soft">Live</span>
                </div>
                <section id="chat-log" class="chat-log" aria-live="polite"></section>
              </section>

              <form id="composer" class="composer">
                <button
                  id="composer-listen-button"
                  class="icon-button"
                  type="button"
                  aria-label="Start voice input"
                  title="Start voice input"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M12 14.5a3.5 3.5 0 0 0 3.5-3.5V7a3.5 3.5 0 1 0-7 0v4a3.5 3.5 0 0 0 3.5 3.5Zm6-3.5a1 1 0 1 0-2 0 4 4 0 1 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.91V20H9.5a1 1 0 1 0 0 2h5a1 1 0 1 0 0-2H13v-3.09A6 6 0 0 0 18 11Z"
                    />
                  </svg>
                </button>
                <button
                  id="stop-speaking"
                  class="icon-button composer-stop"
                  type="button"
                  aria-label="Stop speech"
                  title="Stop speech"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M7 7h10v10H7z" />
                  </svg>
                </button>
                <label class="composer-field" for="message-input">
                  <span class="sr-only">Message</span>
                  <textarea
                    id="message-input"
                    rows="4"
                    placeholder="Type a fallback command or continue by voice..."
                  ></textarea>
                </label>
                <button id="send-button" class="send-orb" type="submit" aria-label="Send request">
                  <span class="send-orb-core"></span>
                </button>
              </form>

              <section id="visual-examples-screen" class="visual-screen" aria-live="polite" hidden>
                <div class="section-head visual-screen-head">
                  <div>
                    <p class="eyebrow">Visual examples</p>
                    <h3 id="visual-screen-title">Image and graph ideas</h3>
                  </div>
                  <button id="hide-visual-screen" class="ghost-button visual-screen-dismiss" type="button">
                    Hide
                  </button>
                </div>
                <div class="visual-screen-meta">
                  <span id="visual-screen-kind" class="badge badge-soft">Preview</span>
                  <p id="visual-screen-summary" class="helper-text">
                    Visual examples will appear here when a prompt is better answered with an image or chart.
                  </p>
                </div>
                <div class="visual-screen-actions">
                  <button
                    id="download-visual-json"
                    class="ghost-button visual-json-download"
                    type="button"
                    hidden
                  >
                    Download JSON
                  </button>
                </div>
                <div id="visual-screen-preview" class="visual-screen-preview"></div>
                <div id="visual-screen-grid" class="visual-screen-grid"></div>
                <pre id="visual-screen-json" class="visual-screen-json" hidden></pre>
              </section>
            </section>
          </div>
        </section>

        <aside id="control-panel" class="control-panel inspector-panel">
          <div class="inspector-heading">
            <h2>Inspector</h2>
            <p class="lead">Compact Mac-style controls</p>
          </div>

          <section class="live-card inspector-card">
            <div class="section-head">
              <h3>Live transcript</h3>
              <span id="listening-indicator" class="badge">Idle</span>
            </div>
            <p id="live-transcript" class="live-transcript">
              Start voice input or type a request below.
            </p>
          </section>

          <section class="panel-card inspector-card model-controls-card">
            <div class="section-head">
              <div>
                <h3>Models and endpoint</h3>
                <p class="helper-text">Switch the LM Studio endpoint and active models here.</p>
              </div>
              <button id="refresh-models" class="ghost-button" type="button">
                Refresh
              </button>
            </div>

            <label class="field">
              <span>LM Studio endpoint</span>
              <input id="endpoint-input" type="url" placeholder="http://127.0.0.1:1234" />
            </label>

            <div class="button-row">
              <button id="save-endpoint" class="ghost-button" type="button">
                Save endpoint
              </button>
            </div>

            <label class="field">
              <span>Chat model</span>
              <select id="model-select"></select>
            </label>

            <label class="field">
              <span>Speech polish model</span>
              <select id="speech-model-select"></select>
            </label>

            <label class="field">
              <span>Playback voice</span>
              <select id="voice-select"></select>
            </label>

            <div class="sliders model-controls-sliders">
              <label class="field">
                <span>Temperature <strong id="temperature-value">0.7</strong></span>
                <input
                  id="temperature"
                  type="range"
                  min="0"
                  max="1.2"
                  step="0.1"
                  value="0.7"
                />
              </label>

              <label class="field">
                <span>Reply length <strong id="max-tokens-value">400</strong></span>
                <input
                  id="max-tokens"
                  type="range"
                  min="100"
                  max="1200"
                  step="50"
                  value="400"
                />
              </label>
            </div>

            <p id="models-inventory" class="helper-text">
              Loading LM Studio models...
            </p>
            <p class="helper-text">
              Model and voice changes save automatically. Use refresh after loading new models in LM Studio.
            </p>
          </section>

          <section class="panel-card inspector-card prompt-card">
            <div class="section-head">
              <div>
                <h3>System prompt</h3>
                <p class="helper-text">Edit the assistant's base behavior for chat replies.</p>
              </div>
            </div>

            <label class="field">
              <span>Assistant instruction</span>
              <textarea id="system-prompt" rows="8"></textarea>
            </label>
          </section>

          <section class="panel-card inspector-card bot-studio-card">
            <div class="section-head">
              <div>
                <h3>Bot studio</h3>
                <p class="helper-text">
                  Inspired by Clawdbot-style agent profiles: create and switch saved bots with their own voice-first behavior.
                </p>
              </div>
            </div>

            <label class="field">
              <span>Active bot</span>
              <select id="bot-select"></select>
            </label>

            <div class="button-row">
              <button id="new-bot" class="ghost-button" type="button">New bot</button>
              <button id="save-bot" class="ghost-button" type="button">Save bot</button>
              <button id="delete-bot" class="ghost-button" type="button">Delete bot</button>
            </div>

            <label class="field">
              <span>Bot name</span>
              <input id="bot-name" type="text" maxlength="60" placeholder="Concierge, Tutor, Coach..." />
            </label>

            <label class="field">
              <span>Bot description</span>
              <input id="bot-description" type="text" maxlength="140" placeholder="Short summary of what this bot is for" />
            </label>

            <label class="field">
              <span>Greeting</span>
              <input id="bot-greeting" type="text" maxlength="160" placeholder="Optional opening line for this bot" />
            </label>

            <label class="field">
              <span>Create bot from voice or text prompt</span>
              <textarea
                id="bot-builder-prompt"
                rows="5"
                placeholder="Example: Create a calm real-estate assistant bot that speaks clearly, uses internet research, prefers concise answers, and helps draft client messages."
              ></textarea>
            </label>

            <div class="button-row">
              <button id="record-bot-prompt" class="ghost-button" type="button">Record prompt</button>
              <button id="create-bot-from-prompt" class="ghost-button" type="button">Create from prompt</button>
            </div>

            <section class="clawd-skill-library">
              <div class="section-head">
                <div>
                  <h3>ClawdHub-style skill packs</h3>
                  <p class="helper-text">
                    Instant bot presets inspired by clawdbot workflows, voice-first routing, and showcase builds.
                  </p>
                </div>
              </div>
              <div id="clawd-skill-grid" class="shortcut-grid clawd-skill-grid"></div>
            </section>

            <p id="bot-studio-status" class="helper-text">
              Build bots from typed or spoken prompts, or install a Clawdbot-style skill pack and switch instantly.
            </p>
          </section>

          <section class="panel-card behaviors-card">
            <h3>Behaviors</h3>
            <div class="toggle-grid inspector-toggle-grid">
              <label class="toggle">
                <span>Clap or "Talk to me"</span>
                <input id="clap-wake" type="checkbox" checked />
              </label>
              <label class="toggle">
                <span>Hands-free follow-up</span>
                <input id="hands-free" type="checkbox" />
              </label>
              <label class="toggle">
                <span>Speak responses</span>
                <input id="auto-speak" type="checkbox" checked />
              </label>
              <label class="toggle">
                <span>Internet answers</span>
                <input id="use-internet" type="checkbox" />
              </label>
              <label class="toggle">
                <span>Agent mode</span>
                <input id="agent-mode" type="checkbox" />
              </label>
            </div>
            <p id="clap-wake-note" class="helper-text">
              Clap once or say "Talk to me" to start the conversation.
            </p>
          </section>

          <section class="panel-card status-card">
            <h3>Runtime status</h3>
            <dl>
              <div>
                <dt>Model endpoint</dt>
                <dd id="connection-status">Checking...</dd>
              </div>
              <div>
                <dt>Speech output</dt>
                <dd id="speech-output-status">Checking...</dd>
              </div>
              <div>
                <dt>Speech input</dt>
                <dd id="speech-support">Checking...</dd>
              </div>
              <div>
                <dt>Active mic</dt>
                <dd id="mic-status">Checking...</dd>
              </div>
              <div>
                <dt>SMTP</dt>
                <dd id="smtp-status">Checking...</dd>
              </div>
              <div>
                <dt>Internet</dt>
                <dd id="internet-status">Checking...</dd>
              </div>
              <div>
                <dt>Home Assistant</dt>
                <dd id="home-assistant-status">Checking...</dd>
              </div>
              <div>
                <dt>Transcription</dt>
                <dd id="transcription-status">Checking...</dd>
              </div>
              <div>
                <dt>WhatsApp</dt>
                <dd id="whatsapp-status">Checking...</dd>
              </div>
            </dl>
          </section>

          <section class="panel-card inspector-card">
            <div class="section-head">
              <h3>Screen transcript</h3>
              <div class="button-row">
                <button id="start-screen-transcript" class="ghost-button" type="button">
                  Share screen
                </button>
                <button id="stop-screen-transcript" class="ghost-button" type="button" disabled>
                  Stop capture
                </button>
              </div>
            </div>

            <div class="screen-preview-shell">
              <label class="field">
                <span>Capture source</span>
                <select id="screen-capture-surface">
                  <option value="any">Any screen, window, or tab</option>
                  <option value="desktop">Desktop</option>
                  <option value="window">Window</option>
                  <option value="tab">Browser tab</option>
                </select>
              </label>

              <video
                id="screen-preview"
                class="screen-preview"
                autoplay
                muted
                playsInline
                hidden
              ></video>
              <p id="screen-preview-empty" class="helper-text">
                Choose Desktop to capture audio from multiple apps or tabs through system audio when your browser supports it.
              </p>
            </div>

            <label class="field">
              <span>Transcript</span>
              <textarea
                id="screen-transcript"
                rows="5"
                placeholder="Transcript segments will appear here while the capture is running."
              ></textarea>
            </label>

            <div class="button-row">
              <button id="use-screen-transcript" class="ghost-button" type="button" disabled>
                Use in chat
              </button>
            </div>

            <p id="screen-transcript-status" class="helper-text">
              Capture is idle. Share a tab and turn on audio for the best live transcript results.
            </p>
          </section>

          <section class="panel-card agent-queue-card">
            <div class="section-head">
              <h3>Agent action queue</h3>
              <div class="button-row">
                <button id="run-approved-agent-actions" class="ghost-button" type="button" disabled>
                  Resume approved
                </button>
                <button id="clear-agent-queue" class="ghost-button" type="button">
                  Clear queue
                </button>
              </div>
            </div>

            <p id="agent-queue-status" class="helper-text">
              Agent mode will show queued actions and approvals here.
            </p>
            <div id="agent-action-queue" class="agent-action-queue"></div>
          </section>

          <details class="panel-card inspector-details" open>
            <summary>Assistant setup</summary>

            <div class="inspector-details-body">
              <h3>Assistant setup</h3>

              <label class="field">
                <span>Assistant name</span>
                <input id="assistant-name" type="text" maxlength="40" />
              </label>

              <section class="mic-card">
                <div class="section-head">
                  <h3>Microphone</h3>
                  <button id="refresh-mics" class="ghost-button" type="button">
                    Refresh mics
                  </button>
                </div>

                <label class="field">
                  <span>Detected input devices</span>
                  <select id="mic-select"></select>
                </label>

                <p id="mic-note" class="helper-text">
                  Browser speech recognition uses your system default microphone.
                </p>
              </section>

            </div>
          </details>

          <details class="panel-card inspector-details">
            <summary>SMTP setup</summary>
            <div class="inspector-details-body">
              <div class="section-head">
                <h3>SMTP setup</h3>
                <button id="save-smtp" class="ghost-button" type="button">
                  Save SMTP
                </button>
              </div>

              <label class="field">
                <span>SMTP host</span>
                <input id="smtp-host" type="text" placeholder="smtp.example.com" />
              </label>

              <label class="field">
                <span>SMTP port</span>
                <input id="smtp-port" type="number" min="1" step="1" placeholder="465" />
              </label>

              <label class="field">
                <span>SMTP username</span>
                <input id="smtp-user" type="text" placeholder="your-email@example.com" />
              </label>

              <label class="field">
                <span>SMTP password</span>
                <input id="smtp-pass" type="password" placeholder="App password or mailbox password" />
              </label>

              <p id="smtp-note" class="helper-text">
                SMTP password is write-only here. Leave it blank to keep the current saved password.
              </p>
            </div>
          </details>

          <details class="panel-card inspector-details">
            <summary>Home Assistant</summary>
            <div class="inspector-details-body">
              <div class="section-head">
                <h3>Home Assistant</h3>
                <button id="save-home-assistant" class="ghost-button" type="button">
                  Save Home Assistant
                </button>
              </div>

              <label class="field">
                <span>Base URL</span>
                <input id="home-assistant-url" type="url" placeholder="http://homeassistant.local:8123" />
              </label>

              <label class="field">
                <span>Long-lived access token</span>
                <input id="home-assistant-token" type="password" placeholder="Paste a Home Assistant long-lived token" />
              </label>

              <label class="field">
                <span>Default media player entity</span>
                <input id="home-assistant-player" type="text" placeholder="media_player.living_room" />
              </label>

              <p id="home-assistant-note" class="helper-text">
                The token is write-only here. Leave it blank to keep the current saved token.
              </p>
            </div>
          </details>

          <details class="panel-card inspector-details">
            <summary>Transcription setup</summary>
            <div class="inspector-details-body">
              <div class="section-head">
                <h3>Transcription setup</h3>
                <button id="save-transcription" class="ghost-button" type="button">
                  Save transcription
                </button>
              </div>

              <label class="field">
                <span>API base URL</span>
                <input
                  id="transcription-base-url"
                  type="url"
                  placeholder="http://127.0.0.1:8080/v1"
                />
              </label>

              <label class="field">
                <span>API key (optional)</span>
                <input
                  id="transcription-api-key"
                  type="password"
                  placeholder="Optional for LocalAI"
                />
              </label>

              <label class="field">
                <span>Transcription model</span>
                <input
                  id="transcription-model"
                  type="text"
                  placeholder="whisper-1"
                />
              </label>

              <label class="field">
                <span>Language hint</span>
                <input
                  id="transcription-language"
                  type="text"
                  maxlength="12"
                  placeholder="Optional, e.g. en"
                />
              </label>

              <p id="transcription-note" class="helper-text">
                LocalAI usually does not need an API key. Leave this blank to keep any saved value.
              </p>
            </div>
          </details>

          <details class="panel-card inspector-details">
            <summary>WhatsApp connector</summary>
            <div class="inspector-details-body">
              <div class="section-head">
                <h3>WhatsApp connector</h3>
                <button id="save-whatsapp" class="ghost-button" type="button">
                  Save WhatsApp
                </button>
              </div>

              <label class="field">
                <span>WhatsApp sender</span>
                <input
                  id="whatsapp-phone-number"
                  type="text"
                  placeholder="whatsapp:+14155238886"
                />
              </label>

              <label class="field">
                <span>Public webhook URL</span>
                <input
                  id="whatsapp-webhook-url"
                  type="url"
                  placeholder="https://your-domain.example/api/whatsapp"
                />
              </label>

              <label class="field">
                <span>Twilio auth token</span>
                <input
                  id="whatsapp-auth-token"
                  type="password"
                  placeholder="Optional but recommended for signature checks"
                />
              </label>

              <label class="field">
                <span>Chat model</span>
                <select id="whatsapp-model"></select>
              </label>

              <div class="toggle-grid">
                <label class="toggle">
                  <span>Allow internet-backed replies</span>
                  <input id="whatsapp-use-internet" type="checkbox" />
                </label>
                <label class="toggle">
                  <span>Use agent mode for WhatsApp</span>
                  <input id="whatsapp-agent-mode" type="checkbox" />
                </label>
              </div>

              <label class="field">
                <span>WhatsApp system prompt</span>
                <textarea
                  id="whatsapp-system-prompt"
                  rows="4"
                  placeholder="Assistant behavior for inbound WhatsApp chats"
                ></textarea>
              </label>

              <p id="whatsapp-note" class="helper-text">
                Point your Twilio WhatsApp webhook to <code>/api/whatsapp</code> on a public URL.
              </p>
            </div>
          </details>
        </aside>
      </div>
    </section>
  </main>

  <template id="message-template">
    <article class="message">
      <div class="message-meta">
        <span class="message-role"></span>
      </div>
      <p class="message-content"></p>
      <div class="message-sources"></div>
    </article>
  </template>
</div>
`;

export default function HomeShell() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: pageMarkup }} />
      <AssistantBootstrap />
    </>
  );
}
