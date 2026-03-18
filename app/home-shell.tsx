"use client";

import AssistantBootstrap from "./assistant-bootstrap";

const pageMarkup = `
<div class="page-shell">
  <main class="assistant-stage">
    <section class="phone-frame">
      <div class="phone-status">
        <span>9:41</span>
        <div class="status-icons" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>

      <section class="hero-card">
        <div class="hero-orb" aria-hidden="true">
          <div class="orb-core">
            <span class="orb-ring orb-ring-a"></span>
            <span class="orb-ring orb-ring-b"></span>
            <span class="orb-ring orb-ring-c"></span>
            <span class="orb-mic"></span>
          </div>
        </div>
        <div class="hero-copy">
          <p class="eyebrow">Voice Assistant</p>
          <h1 id="hero-title">Ask anything</h1>
          <p class="hero-description">
            Speak, type, and let your local model answer in a polished voice-first interface.
          </p>
        </div>
        <div class="hero-actions">
          <button id="listen-button" class="primary-button" type="button">
            Start voice input
          </button>
          <button id="clear-chat" class="ghost-button" type="button">
            Clear session
          </button>
        </div>
      </section>

      <section class="shortcut-card">
        <div class="section-head">
          <h3>Quick actions</h3>
          <span class="badge badge-soft">Local shortcuts</span>
        </div>
        <div class="shortcut-grid">
          <button class="shortcut-tile" type="button" data-prompt="Plan my day and give me the top three priorities.">
            <span class="shortcut-kicker">Focus</span>
            <strong>Plan today</strong>
            <span class="shortcut-note">Top priorities</span>
          </button>
          <button class="shortcut-tile" type="button" data-prompt="Summarize this topic into a short, practical explanation.">
            <span class="shortcut-kicker">Study</span>
            <strong>Explain simply</strong>
            <span class="shortcut-note">Short, practical summary</span>
          </button>
          <button class="shortcut-tile" type="button" data-prompt="Help me write a polished message with a friendly tone.">
            <span class="shortcut-kicker">Writing</span>
            <strong>Draft reply</strong>
            <span class="shortcut-note">Friendly message help</span>
          </button>
          <button class="shortcut-tile" type="button" data-prompt="Brainstorm five creative ideas and recommend the strongest one.">
            <span class="shortcut-kicker">Ideas</span>
            <strong>Brainstorm ideas</strong>
            <span class="shortcut-note">Five options, one pick</span>
          </button>
          <button
            class="shortcut-tile"
            type="button"
            data-prompt="Help me with a coding task in detail. Example: build a React component for a pricing page with responsive cards, explain the file structure, and include clean TypeScript."
          >
            <span class="shortcut-kicker">Coding</span>
            <strong>Build feature</strong>
            <span class="shortcut-note">React, TS, file guidance</span>
          </button>
          <button
            class="shortcut-tile"
            type="button"
            data-prompt="Write a coding command with a clear example. Example: create the exact pnpm, npm, git, or PowerShell command I should run to start the app, install a package, or search the codebase."
          >
            <span class="shortcut-kicker">Command</span>
            <strong>Generate command</strong>
            <span class="shortcut-note">pnpm, git, PowerShell</span>
          </button>
        </div>
      </section>

      <section class="live-card">
        <div class="section-head">
          <h3>Live transcript</h3>
          <span id="listening-indicator" class="badge">Idle</span>
        </div>
        <p id="live-transcript" class="live-transcript">
          Start voice input or type a request below.
        </p>
      </section>

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

      <section id="chat-log" class="chat-log" aria-live="polite"></section>

      <form id="composer" class="composer">
        <label class="composer-field" for="message-input">
          <span class="sr-only">Message</span>
          <textarea
            id="message-input"
            rows="2"
            placeholder="Ask anything"
          ></textarea>
        </label>
        <div class="composer-actions">
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
          <button id="stop-speaking" class="ghost-button" type="button">
            Stop speech
          </button>
          <button id="send-button" class="send-orb" type="submit" aria-label="Send request">
            <span class="send-orb-core"></span>
          </button>
        </div>
      </form>
    </section>
  </main>

  <aside class="control-panel">
    <div class="brand-block">
      <p class="eyebrow">Local Voice Core</p>
      <h2>Control dock</h2>
      <p class="lead">
        Fine-tune the assistant while keeping the main UI close to the voice app reference.
      </p>
    </div>

    <section class="panel-card">
      <div class="section-head">
        <h3>Assistant setup</h3>
        <button id="refresh-models" class="ghost-button" type="button">
          Refresh
        </button>
      </div>

      <label class="field">
        <span>LM Studio endpoint</span>
        <input id="endpoint-input" type="url" placeholder="http://127.0.0.1:1234" />
      </label>

      <button id="save-endpoint" class="ghost-button" type="button">
        Save endpoint
      </button>

      <label class="field">
        <span>Assistant name</span>
        <input id="assistant-name" type="text" maxlength="40" />
      </label>

      <label class="field">
        <span>Chat model</span>
        <select id="model-select"></select>
      </label>

      <label class="field">
        <span>Playback voice</span>
        <select id="voice-select"></select>
      </label>

      <label class="field">
        <span>Speech polish model</span>
        <select id="speech-model-select"></select>
      </label>

      <p class="helper-text">
        Uses the browser for playback and an LM Studio model to smooth replies for speech.
      </p>

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

      <label class="field">
        <span>System prompt</span>
        <textarea id="system-prompt" rows="7"></textarea>
      </label>

      <div class="sliders">
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

      <div class="toggle-grid">
        <label class="toggle">
          <input id="auto-speak" type="checkbox" checked />
          <span>Speak replies aloud</span>
        </label>
        <label class="toggle">
          <input id="use-internet" type="checkbox" />
          <span>Use internet for grounded answers</span>
        </label>
        <label class="toggle">
          <input id="hands-free" type="checkbox" />
          <span>Hands-free follow-up listening</span>
        </label>
      </div>
    </section>

    <section class="panel-card">
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
    </section>

    <section class="panel-card">
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
    </section>

    <section class="panel-card">
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
          placeholder="https://api.openai.com/v1"
        />
      </label>

      <label class="field">
        <span>API key</span>
        <input
          id="transcription-api-key"
          type="password"
          placeholder="OpenAI or compatible API key"
        />
      </label>

      <label class="field">
        <span>Transcription model</span>
        <input
          id="transcription-model"
          type="text"
          placeholder="gpt-4o-mini-transcribe"
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
        The API key is write-only here. Leave it blank to keep the current saved key.
      </p>
    </section>

    <section class="panel-card">
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
          rows="7"
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

    <section class="panel-card status-card">
      <h3>Runtime status</h3>
      <dl>
        <div>
          <dt>LM Studio endpoint</dt>
          <dd id="connection-status">Checking...</dd>
        </div>
        <div>
          <dt>Speech input</dt>
          <dd id="speech-support">Checking...</dd>
        </div>
        <div>
          <dt>Active microphone</dt>
          <dd id="mic-status">Checking...</dd>
        </div>
        <div>
          <dt>Speech output</dt>
          <dd id="speech-output-status">Checking...</dd>
        </div>
        <div>
          <dt>SMTP</dt>
          <dd id="smtp-status">Checking...</dd>
        </div>
        <div>
          <dt>Internet search</dt>
          <dd id="internet-status">Checking...</dd>
        </div>
        <div>
          <dt>Home Assistant</dt>
          <dd id="home-assistant-status">Checking...</dd>
        </div>
        <div>
          <dt>Transcription API</dt>
          <dd id="transcription-status">Checking...</dd>
        </div>
      </dl>
    </section>
  </aside>
</div>

<template id="message-template">
  <article class="message">
    <div class="message-meta">
      <span class="message-role"></span>
    </div>
    <p class="message-content"></p>
    <div class="message-sources"></div>
  </article>
</template>
`;

export default function HomeShell() {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: pageMarkup }} />
      <AssistantBootstrap />
    </>
  );
}
