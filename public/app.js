const defaults = {
  endpoint: "http://127.0.0.1:1234",
  homeAssistantBaseUrl: "",
  homeAssistantPlayer: "",
  smtpHost: "smtp.example.com",
  smtpPort: 465,
  smtpUser: "",
  useInternet: false,
  agentMode: false,
  assistantName: "Nova",
  systemPrompt:
    "You are a warm, capable personal assistant running locally on my computer. Be concise, helpful, proactive, and conversational. If I ask for something ambiguous, make a reasonable assumption and move us forward.",
  autoSpeak: true,
  handsFree: false,
  temperature: 0.7,
  maxTokens: 400,
  selectedSpeechModel: "",
};

const state = {
  messages: [],
  models: [],
  speechModels: [],
  voices: [],
  microphones: [],
  recognition: null,
  isListening: false,
  isSending: false,
  shouldResumeListening: false,
  finalTranscript: "",
  speechRequestId: 0,
};

const elements = {
  assistantName: document.querySelector("#assistant-name"),
  modelSelect: document.querySelector("#model-select"),
  voiceSelect: document.querySelector("#voice-select"),
  speechModelSelect: document.querySelector("#speech-model-select"),
  systemPrompt: document.querySelector("#system-prompt"),
  autoSpeak: document.querySelector("#auto-speak"),
  useInternet: document.querySelector("#use-internet"),
  agentMode: document.querySelector("#agent-mode"),
  handsFree: document.querySelector("#hands-free"),
  temperature: document.querySelector("#temperature"),
  temperatureValue: document.querySelector("#temperature-value"),
  maxTokens: document.querySelector("#max-tokens"),
  maxTokensValue: document.querySelector("#max-tokens-value"),
  refreshModels: document.querySelector("#refresh-models"),
  endpointInput: document.querySelector("#endpoint-input"),
  saveEndpoint: document.querySelector("#save-endpoint"),
  homeAssistantUrl: document.querySelector("#home-assistant-url"),
  homeAssistantPlayer: document.querySelector("#home-assistant-player"),
  homeAssistantToken: document.querySelector("#home-assistant-token"),
  saveHomeAssistant: document.querySelector("#save-home-assistant"),
  smtpHost: document.querySelector("#smtp-host"),
  smtpPort: document.querySelector("#smtp-port"),
  smtpUser: document.querySelector("#smtp-user"),
  smtpPass: document.querySelector("#smtp-pass"),
  saveSmtp: document.querySelector("#save-smtp"),
  smtpNote: document.querySelector("#smtp-note"),
  homeAssistantNote: document.querySelector("#home-assistant-note"),
  connectionStatus: document.querySelector("#connection-status"),
  speechSupport: document.querySelector("#speech-support"),
  micSelect: document.querySelector("#mic-select"),
  refreshMics: document.querySelector("#refresh-mics"),
  micNote: document.querySelector("#mic-note"),
  micStatus: document.querySelector("#mic-status"),
  speechOutputStatus: document.querySelector("#speech-output-status"),
  smtpStatus: document.querySelector("#smtp-status"),
  internetStatus: document.querySelector("#internet-status"),
  homeAssistantStatus: document.querySelector("#home-assistant-status"),
  heroTitle: document.querySelector("#hero-title"),
  heroOrb: document.querySelector(".hero-orb"),
  listenButton: document.querySelector("#listen-button"),
  clearChat: document.querySelector("#clear-chat"),
  listeningIndicator: document.querySelector("#listening-indicator"),
  liveTranscript: document.querySelector("#live-transcript"),
  chatLog: document.querySelector("#chat-log"),
  composer: document.querySelector("#composer"),
  composerListenButton: document.querySelector("#composer-listen-button"),
  messageInput: document.querySelector("#message-input"),
  stopSpeaking: document.querySelector("#stop-speaking"),
  sendButton: document.querySelector("#send-button"),
  template: document.querySelector("#message-template"),
  shortcutTiles: document.querySelectorAll(".shortcut-tile"),
};

function readSettings() {
  try {
    return {
      ...defaults,
      ...(JSON.parse(localStorage.getItem("assistant-settings")) || {}),
    };
  } catch {
    return defaults;
  }
}

function saveSettings() {
  localStorage.setItem(
    "assistant-settings",
    JSON.stringify({
      assistantName: elements.assistantName.value.trim() || defaults.assistantName,
      endpoint: elements.endpointInput.value.trim() || defaults.endpoint,
      homeAssistantBaseUrl:
        elements.homeAssistantUrl.value.trim() || defaults.homeAssistantBaseUrl,
      homeAssistantPlayer:
        elements.homeAssistantPlayer.value.trim() || defaults.homeAssistantPlayer,
      smtpHost: elements.smtpHost.value.trim() || defaults.smtpHost,
      smtpPort: Number(elements.smtpPort.value) || defaults.smtpPort,
      smtpUser: elements.smtpUser.value.trim() || defaults.smtpUser,
      useInternet: elements.useInternet.checked,
      agentMode: elements.agentMode.checked,
      systemPrompt: elements.systemPrompt.value.trim() || defaults.systemPrompt,
      autoSpeak: elements.autoSpeak.checked,
      handsFree: elements.handsFree.checked,
      temperature: Number(elements.temperature.value),
      maxTokens: Number(elements.maxTokens.value),
      selectedVoice: elements.voiceSelect.value,
      selectedModel: elements.modelSelect.value,
      selectedSpeechModel: elements.speechModelSelect.value,
    })
  );
}

function renderMessage(role, content, sources = [], reasoningTrace = []) {
  const fragment = elements.template.content.cloneNode(true);
  const article = fragment.querySelector(".message");
  const roleLabel = fragment.querySelector(".message-role");
  const contentNode = fragment.querySelector(".message-content");
  const sourcesNode = fragment.querySelector(".message-sources");

  article.classList.add(role);
  roleLabel.textContent = role === "assistant" ? elements.assistantName.value : "You";
  contentNode.textContent = content;

  if (sources.length) {
    const label = document.createElement("p");
    label.className = "message-sources-label";
    label.textContent = "Sources";
    sourcesNode.appendChild(label);

    const list = document.createElement("ul");
    list.className = "message-sources-list";

    sources.forEach((source, index) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      link.textContent = source.title || source.url || `Source ${index + 1}`;
      item.appendChild(link);
      list.appendChild(item);
    });

    sourcesNode.appendChild(list);
  }

  if (role === "assistant" && reasoningTrace.length) {
    const traceNode = document.createElement("details");
    traceNode.className = "message-trace";
    traceNode.open = true;

    const summary = document.createElement("summary");
    summary.className = "message-trace-summary";
    summary.textContent = "Agent trace";
    traceNode.appendChild(summary);

    const list = document.createElement("div");
    list.className = "message-trace-list";

    reasoningTrace.forEach((entry) => {
      const item = document.createElement("div");
      item.className = `message-trace-item is-${entry.status === "error" ? "error" : "ok"}`;

      const step = document.createElement("span");
      step.className = "message-trace-step";
      step.textContent = `Step ${entry.step}`;

      const title = document.createElement("strong");
      title.className = "message-trace-title";
      title.textContent = entry.title || "Agent action";

      const detail = document.createElement("p");
      detail.className = "message-trace-detail";
      detail.textContent = entry.detail || "Completed an action.";

      item.append(step, title, detail);
      list.appendChild(item);
    });

    traceNode.appendChild(list);
    article.appendChild(traceNode);
  }

  elements.chatLog.appendChild(fragment);
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function rerenderChat() {
  elements.chatLog.innerHTML = "";

  if (!state.messages.length) {
    renderMessage(
      "assistant",
      `${elements.assistantName.value || defaults.assistantName} is online. Submit a request by voice or text to begin the session.`
    );
    return;
  }

  state.messages.forEach((message) =>
    renderMessage(
      message.role,
      message.content,
      message.sources || [],
      message.reasoningTrace || []
    )
  );
}

function setStatus(target, text, isError = false) {
  target.textContent = text;
  target.style.color = isError ? "#fda4af" : "";
}

function updateSpeechOutputStatus(note = "") {
  if (!window.speechSynthesis) {
    setStatus(elements.speechOutputStatus, "Browser speech unavailable", true);
    return;
  }

  const selectedSpeechModel = elements.speechModelSelect.value;
  if (selectedSpeechModel) {
    setStatus(
      elements.speechOutputStatus,
      note || `Browser playback + ${selectedSpeechModel}`
    );
    return;
  }

  const voiceCount = state.voices.length;
  setStatus(
    elements.speechOutputStatus,
    note || `${voiceCount} browser voice${voiceCount === 1 ? "" : "s"} available`
  );
}

function updateRangeLabels() {
  elements.temperatureValue.textContent = Number(elements.temperature.value).toFixed(1);
  elements.maxTokensValue.textContent = elements.maxTokens.value;
}

function updateHeroTitle() {
  const name = elements.assistantName.value.trim() || defaults.assistantName;
  elements.heroTitle.textContent = `${name} is ready`;
}

function updateListeningUi(label, buttonLabel) {
  elements.listeningIndicator.textContent = label;
  elements.listenButton.textContent = buttonLabel;
}

function setHeroListeningState(isListening) {
  elements.heroOrb?.classList.toggle("is-listening", isListening);
}

function startListening() {
  if (!state.recognition || state.isListening) {
    return;
  }

  try {
    state.recognition.start();
  } catch (error) {
    elements.liveTranscript.textContent = `Voice input error: ${error.message}`;
  }
}

function handleListenButtonClick() {
  if (!state.recognition) {
    return;
  }

  if (state.isListening) {
    state.recognition.stop();
    return;
  }

  stopSpeaking();
  startListening();
}

function populateVoiceOptions() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  state.voices = voices;
  elements.voiceSelect.innerHTML = "";

  if (!voices.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No speech voices available";
    elements.voiceSelect.appendChild(option);
    setStatus(elements.speechOutputStatus, "Unavailable in this browser", true);
    return;
  }

  voices.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.name;
    option.textContent = `${voice.name} (${voice.lang})`;
    elements.voiceSelect.appendChild(option);
  });

  const settings = readSettings();
  const preferredVoice =
    voices.find((voice) => voice.name === settings.selectedVoice)?.name ||
    voices.find((voice) => /^en/i.test(voice.lang))?.name ||
    voices[0]?.name ||
    "";

  elements.voiceSelect.value = preferredVoice;
  updateSpeechOutputStatus();
}

function populateSpeechModelOptions(models, defaultSpeechModel) {
  state.speechModels = models;
  elements.speechModelSelect.innerHTML = "";

  const offOption = document.createElement("option");
  offOption.value = "";
  offOption.textContent = "Off (browser voice only)";
  elements.speechModelSelect.appendChild(offOption);

  models.forEach((model) => {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.id;
    elements.speechModelSelect.appendChild(option);
  });

  const settings = readSettings();
  const preferredSpeechModel =
    models.find((model) => model.id === settings.selectedSpeechModel)?.id ||
    defaultSpeechModel ||
    "";

  elements.speechModelSelect.value = preferredSpeechModel;
  updateSpeechOutputStatus();
}

async function loadModels() {
  setStatus(elements.connectionStatus, "Connecting...");

  try {
    const response = await fetch("/api/models");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.details || payload.error || "Model lookup failed.");
    }

    const allModels = payload.models || [];
    const chatModels = allModels.filter((model) => model.kind === "chat");
    const speechModels = allModels.filter((model) => model.kind === "tts");
    state.models = chatModels;
    elements.modelSelect.innerHTML = "";

    if (!chatModels.length) {
      throw new Error("LM Studio is reachable, but no chat models are loaded.");
    }

    chatModels.forEach((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.id;
      elements.modelSelect.appendChild(option);
    });

    const settings = readSettings();
    elements.modelSelect.value =
      chatModels.find((model) => model.id === settings.selectedModel)?.id ||
      payload.defaultModel ||
      chatModels[0]?.id ||
      "";
    populateSpeechModelOptions(speechModels, payload.defaultSpeechModel || "");

    setStatus(
      elements.connectionStatus,
      `Connected to ${payload.baseUrl} with ${chatModels.length} chat model${chatModels.length === 1 ? "" : "s"}`
    );
    saveSettings();
    return true;
  } catch (error) {
    setStatus(elements.connectionStatus, error.message, true);
    throw error;
  }
}

async function loadEndpointConfig() {
  try {
    const response = await fetch("/api/config");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.details || payload.error || "Could not load endpoint config.");
    }

    elements.endpointInput.value = payload.baseUrl || defaults.endpoint;
    elements.homeAssistantUrl.value =
      payload.homeAssistant?.baseUrl || defaults.homeAssistantBaseUrl;
    elements.homeAssistantPlayer.value =
      payload.homeAssistant?.defaultMediaPlayer || defaults.homeAssistantPlayer;
    elements.homeAssistantToken.value = "";
    elements.smtpHost.value = payload.smtp?.host || defaults.smtpHost;
    elements.smtpPort.value = String(payload.smtp?.port || defaults.smtpPort);
    elements.smtpUser.value = payload.smtp?.user || defaults.smtpUser;
    elements.smtpPass.value = "";
    setStatus(
      elements.smtpStatus,
      payload.smtp?.passwordSet
        ? `Ready on ${payload.smtp.host}:${payload.smtp.port}`
        : "Host set, password not saved yet.",
      !payload.smtp?.passwordSet
    );
    setStatus(
      elements.internetStatus,
      payload.internet?.enabled
        ? `${payload.internet.provider} ready`
        : `${payload.internet?.provider || "Search API"} not configured`,
      !payload.internet?.enabled
    );
    setStatus(
      elements.homeAssistantStatus,
      payload.homeAssistant?.enabled
        ? `Ready on ${payload.homeAssistant.baseUrl}`
        : payload.homeAssistant?.baseUrl
          ? `Base URL saved, token missing`
          : "Not configured",
      !payload.homeAssistant?.enabled
    );
    elements.homeAssistantNote.textContent =
      "The token is write-only here. Leave it blank to keep the current saved token.";
    saveSettings();
  } catch (error) {
    const settings = readSettings();
    elements.endpointInput.value = settings.endpoint || defaults.endpoint;
    elements.homeAssistantUrl.value =
      settings.homeAssistantBaseUrl || defaults.homeAssistantBaseUrl;
    elements.homeAssistantPlayer.value =
      settings.homeAssistantPlayer || defaults.homeAssistantPlayer;
    elements.smtpHost.value = settings.smtpHost || defaults.smtpHost;
    elements.smtpPort.value = String(settings.smtpPort || defaults.smtpPort);
    elements.smtpUser.value = settings.smtpUser || defaults.smtpUser;
  }
}

async function saveEndpointConfig() {
  const baseUrl = elements.endpointInput.value.trim() || defaults.endpoint;
  elements.endpointInput.value = baseUrl;

  setStatus(elements.connectionStatus, "Saving endpoint...");

  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ baseUrl }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.details || payload.error || "Could not save the endpoint.");
    }

    elements.endpointInput.value = payload.baseUrl;
    saveSettings();
    await loadModels();
    return true;
  } catch (error) {
    setStatus(elements.connectionStatus, error.message, true);
    throw error;
  }
}

async function saveHomeAssistantConfig() {
  const homeAssistantPayload = {
    baseUrl: elements.homeAssistantUrl.value.trim(),
    defaultMediaPlayer: elements.homeAssistantPlayer.value.trim(),
  };

  if (elements.homeAssistantToken.value) {
    homeAssistantPayload.token = elements.homeAssistantToken.value;
  }

  setStatus(elements.homeAssistantStatus, "Saving Home Assistant...");

  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ homeAssistant: homeAssistantPayload }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(
        payload.details || payload.error || "Could not save Home Assistant settings."
      );
    }

    elements.homeAssistantUrl.value =
      payload.homeAssistant?.baseUrl || defaults.homeAssistantBaseUrl;
    elements.homeAssistantPlayer.value =
      payload.homeAssistant?.defaultMediaPlayer || defaults.homeAssistantPlayer;
    elements.homeAssistantToken.value = "";
    setStatus(
      elements.homeAssistantStatus,
      payload.homeAssistant?.enabled
        ? `Ready on ${payload.homeAssistant.baseUrl}`
        : "Saved, but token is still missing.",
      !payload.homeAssistant?.enabled
    );
    elements.homeAssistantNote.textContent =
      "The token is write-only here. Leave it blank to keep the current saved token.";
    saveSettings();
  } catch (error) {
    setStatus(elements.homeAssistantStatus, error.message, true);
    elements.homeAssistantNote.textContent =
      "Check the Home Assistant URL and long-lived access token, then save again.";
  }
}

async function saveSmtpConfig() {
  const smtpPayload = {
    host: elements.smtpHost.value.trim(),
    port: Number(elements.smtpPort.value),
    user: elements.smtpUser.value.trim(),
  };

  if (elements.smtpPass.value) {
    smtpPayload.pass = elements.smtpPass.value;
  }

  setStatus(elements.smtpStatus, "Saving SMTP...");

  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ smtp: smtpPayload }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.details || payload.error || "Could not save SMTP settings.");
    }

    elements.smtpHost.value = payload.smtp?.host || defaults.smtpHost;
    elements.smtpPort.value = String(payload.smtp?.port || defaults.smtpPort);
    elements.smtpUser.value = payload.smtp?.user || defaults.smtpUser;
    elements.smtpPass.value = "";
    setStatus(
      elements.smtpStatus,
      payload.smtp?.passwordSet
        ? `Ready on ${payload.smtp.host}:${payload.smtp.port}`
        : "Saved, but password is still missing.",
      !payload.smtp?.passwordSet
    );
    elements.smtpNote.textContent =
      "SMTP password is write-only here. Leave it blank to keep the current saved password.";
    saveSettings();
  } catch (error) {
    setStatus(elements.smtpStatus, error.message, true);
    elements.smtpNote.textContent =
      "Check the SMTP host, port, username, and password, then save again.";
  }
}

async function refreshMicrophones() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    elements.micSelect.innerHTML = "";
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Device listing unavailable";
    elements.micSelect.appendChild(option);
    setStatus(elements.micStatus, "Browser cannot list microphones.", true);
    return;
  }

  try {
    if (navigator.mediaDevices?.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    }
  } catch (error) {
    elements.micSelect.innerHTML = "";
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Microphone permission required";
    elements.micSelect.appendChild(option);
    setStatus(elements.micStatus, "Microphone permission not granted.", true);
    elements.micNote.textContent =
      "Allow microphone access in the browser, then refresh mics. Speech recognition uses your system default microphone.";
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const microphones = devices.filter((device) => device.kind === "audioinput");
    state.microphones = microphones;
    elements.micSelect.innerHTML = "";

    if (!microphones.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No microphones detected";
      elements.micSelect.appendChild(option);
      setStatus(elements.micStatus, "No microphones detected.", true);
      return;
    }

    microphones.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Microphone ${index + 1}`;
      elements.micSelect.appendChild(option);
    });

    const selectedMicId =
      microphones.find((device) => device.deviceId === elements.micSelect.value)?.deviceId ||
      microphones[0].deviceId;
    elements.micSelect.value = selectedMicId;

    const selectedLabel =
      microphones.find((device) => device.deviceId === selectedMicId)?.label || "System default mic";
    setStatus(elements.micStatus, selectedLabel);
    elements.micNote.textContent =
      "Browser speech recognition listens to the system default microphone. Use this list to confirm the device labels available on this computer.";
  } catch (error) {
    setStatus(elements.micStatus, `Could not list microphones: ${error.message}`, true);
  }
}

function getRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function setupRecognition() {
  const RecognitionCtor = getRecognitionCtor();

  if (!RecognitionCtor) {
    setStatus(
      elements.speechSupport,
      "Speech recognition unavailable. Use Chrome or Edge on http://localhost:3000.",
      true
    );
    elements.listenButton.disabled = true;
    elements.micNote.textContent =
      "Open the app on localhost in Chrome or Edge, then allow microphone access.";
    return;
  }

  setStatus(elements.speechSupport, "Speech recognition ready");
  elements.micNote.textContent =
    "Speech recognition is available. It will use your system default microphone.";

  const recognition = new RecognitionCtor();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onstart = () => {
    state.isListening = true;
    state.finalTranscript = "";
    updateListeningUi("Listening", "Stop voice input");
    setHeroListeningState(true);
    elements.liveTranscript.textContent = "Listening...";
  };

  recognition.onresult = (event) => {
    let interim = "";
    let finalText = state.finalTranscript;

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const transcript = event.results[index][0].transcript;
      if (event.results[index].isFinal) {
        finalText += `${transcript} `;
      } else {
        interim += transcript;
      }
    }

    state.finalTranscript = finalText;
    elements.liveTranscript.textContent = `${finalText} ${interim}`.trim() || "Listening...";
  };

  recognition.onerror = (event) => {
    state.isListening = false;
    updateListeningUi("Voice error", "Start voice input");
    setHeroListeningState(false);
    elements.liveTranscript.textContent =
      event.error === "not-allowed"
        ? "Microphone permission was denied."
        : `Voice input error: ${event.error}`;
  };

  recognition.onend = async () => {
    const transcript = state.finalTranscript.trim();
    state.isListening = false;
    updateListeningUi("Idle", "Start voice input");
    setHeroListeningState(false);

    if (transcript) {
      elements.messageInput.value = transcript;
      elements.liveTranscript.textContent = transcript;
      state.finalTranscript = "";
      await sendCurrentMessage();
      return;
    }

    if (!elements.liveTranscript.textContent.trim()) {
      elements.liveTranscript.textContent = "Start voice input or type a request below.";
    }
  };

  state.recognition = recognition;
}

function stopSpeaking() {
  state.speechRequestId += 1;
  window.speechSynthesis?.cancel?.();
  state.shouldResumeListening = false;
}

async function prepareSpeechText(text, requestId) {
  const selectedSpeechModel = elements.speechModelSelect.value;

  if (!selectedSpeechModel) {
    return text;
  }

  updateSpeechOutputStatus(`Preparing speech with ${selectedSpeechModel}...`);

  try {
    const response = await fetch("/api/speak", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model: selectedSpeechModel,
      }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.details || payload.error || "Speech preparation failed.");
    }

    if (requestId !== state.speechRequestId) {
      return "";
    }

    updateSpeechOutputStatus(
      payload.enhanced
        ? `Browser playback + ${payload.model}`
        : `Browser playback + ${payload.model} fallback`
    );
    return (payload.text || text).trim();
  } catch (error) {
    if (requestId === state.speechRequestId) {
      updateSpeechOutputStatus("Browser playback only");
    }

    return text;
  }
}

async function speakText(text) {
  if (!elements.autoSpeak.checked || !window.speechSynthesis || !text.trim()) {
    return;
  }

  stopSpeaking();
  const requestId = state.speechRequestId;
  const spokenText = await prepareSpeechText(text, requestId);

  if (!spokenText || requestId !== state.speechRequestId) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(spokenText);
  const voice = state.voices.find((entry) => entry.name === elements.voiceSelect.value);
  if (voice) {
    utterance.voice = voice;
  }

  state.shouldResumeListening = elements.handsFree.checked;

  utterance.onend = () => {
    if (state.shouldResumeListening && state.recognition && !state.isListening) {
      state.shouldResumeListening = false;
      startListening();
    }
  };

  utterance.onerror = () => {
    state.shouldResumeListening = false;
  };

  window.speechSynthesis.speak(utterance);
}

function buildMessages() {
  const messages = [];
  const systemPrompt = elements.systemPrompt.value.trim();

  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }

  messages.push(
    ...state.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }))
  );
  return messages;
}

async function sendCurrentMessage() {
  const userText = elements.messageInput.value.trim();

  if (!userText || state.isSending) {
    return;
  }

  if (!elements.modelSelect.value) {
    setStatus(elements.connectionStatus, "Select a chat model first.", true);
    return;
  }

  state.isSending = true;
  elements.sendButton.disabled = true;
  elements.listenButton.disabled = true;
  stopSpeaking();

  state.messages.push({ role: "user", content: userText });
  rerenderChat();
  elements.messageInput.value = "";
  elements.liveTranscript.textContent = "Thinking...";
  if (elements.agentMode.checked) {
    elements.liveTranscript.textContent = "Agent mode is planning and acting...";
  }

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: elements.modelSelect.value,
        messages: buildMessages(),
        useInternet: elements.useInternet.checked,
        agentMode: elements.agentMode.checked,
        temperature: Number(elements.temperature.value),
        maxTokens: Number(elements.maxTokens.value),
      }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.details || payload.error || "Assistant request failed.");
    }

    const assistantReply = payload.message.trim();
    state.messages.push({
      role: "assistant",
      content: assistantReply,
      sources: Array.isArray(payload.sources) ? payload.sources : [],
      reasoningTrace: Array.isArray(payload.reasoningTrace) ? payload.reasoningTrace : [],
    });
    rerenderChat();
    elements.liveTranscript.textContent = "Reply ready.";
    void speakText(assistantReply);
  } catch (error) {
    const failureMessage = `I hit a problem reaching LM Studio: ${error.message}`;
    state.messages.push({ role: "assistant", content: failureMessage });
    rerenderChat();
    elements.liveTranscript.textContent = "Something went wrong.";
  } finally {
    state.isSending = false;
    elements.sendButton.disabled = false;
    elements.listenButton.disabled = !state.recognition;
    saveSettings();
  }
}

function attachEvents() {
  elements.refreshModels.addEventListener("click", () => {
    loadModels().catch(() => {});
  });
  elements.saveEndpoint.addEventListener("click", () => {
    saveEndpointConfig().catch(() => {});
  });
  elements.saveHomeAssistant.addEventListener("click", () => {
    saveHomeAssistantConfig().catch(() => {});
  });
  elements.saveSmtp.addEventListener("click", () => {
    saveSmtpConfig().catch(() => {});
  });
  elements.refreshMics.addEventListener("click", refreshMicrophones);

  elements.shortcutTiles.forEach((button) => {
    button.addEventListener("click", () => {
      const prompt = button.getAttribute("data-prompt") || "";
      elements.messageInput.value = prompt;
      elements.messageInput.focus();
    });
  });

  elements.assistantName.addEventListener("input", () => {
    updateHeroTitle();
    rerenderChat();
    saveSettings();
  });

  [
    elements.systemPrompt,
    elements.autoSpeak,
    elements.useInternet,
    elements.agentMode,
    elements.handsFree,
    elements.modelSelect,
    elements.endpointInput,
    elements.homeAssistantUrl,
    elements.homeAssistantPlayer,
    elements.smtpHost,
    elements.smtpPort,
    elements.smtpUser,
    elements.voiceSelect,
    elements.speechModelSelect,
  ].forEach((element) => {
    element.addEventListener("change", () => {
      saveSettings();
      updateSpeechOutputStatus();
    });
  });

  elements.temperature.addEventListener("input", () => {
    updateRangeLabels();
    saveSettings();
  });

  elements.maxTokens.addEventListener("input", () => {
    updateRangeLabels();
    saveSettings();
  });

  elements.composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    await sendCurrentMessage();
  });

  elements.listenButton.addEventListener("click", handleListenButtonClick);
  elements.composerListenButton.addEventListener("click", handleListenButtonClick);

  elements.stopSpeaking.addEventListener("click", stopSpeaking);

  elements.clearChat.addEventListener("click", () => {
    state.messages = [];
    stopSpeaking();
    elements.liveTranscript.textContent = "Start voice input or type a request below.";
    rerenderChat();
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      sendCurrentMessage();
    }
  });
}

function applySettings() {
  const settings = readSettings();
  elements.endpointInput.value = settings.endpoint;
  elements.homeAssistantUrl.value = settings.homeAssistantBaseUrl || "";
  elements.homeAssistantPlayer.value = settings.homeAssistantPlayer || "";
  elements.homeAssistantToken.value = "";
  elements.smtpHost.value = settings.smtpHost;
  elements.smtpPort.value = String(settings.smtpPort);
  elements.smtpUser.value = settings.smtpUser;
  elements.smtpPass.value = "";
  elements.assistantName.value = settings.assistantName;
  elements.systemPrompt.value = settings.systemPrompt;
  elements.autoSpeak.checked = settings.autoSpeak;
  elements.useInternet.checked = settings.useInternet;
  elements.agentMode.checked = settings.agentMode;
  elements.handsFree.checked = settings.handsFree;
  elements.temperature.value = String(settings.temperature);
  elements.maxTokens.value = String(settings.maxTokens);
  updateRangeLabels();
  updateHeroTitle();
}

async function initialize() {
  applySettings();
  attachEvents();
  setupRecognition();
  populateVoiceOptions();
  await loadEndpointConfig();
  await refreshMicrophones();

  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = populateVoiceOptions;
  }

  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", refreshMicrophones);
  }

  rerenderChat();
  try {
    await loadModels();
  } catch {
    elements.liveTranscript.textContent =
      "The assistant UI loaded, but the LM Studio endpoint is not ready yet. Check the endpoint in the control dock.";
  }
}

initialize();
