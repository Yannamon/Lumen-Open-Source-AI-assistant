// @ts-nocheck

let hasInitializedAssistantUi = false;

export function initAssistantUi() {
  if (hasInitializedAssistantUi) {
    return;
  }

  hasInitializedAssistantUi = true;

const defaults = {
  endpoint: "http://127.0.0.1:1234",
  homeAssistantBaseUrl: "",
  homeAssistantPlayer: "",
  smtpHost: "smtp.example.com",
  smtpPort: 465,
  smtpUser: "",
  transcriptionBaseUrl: "http://127.0.0.1:8080/v1",
  transcriptionModel: "whisper-1",
  transcriptionLanguage: "",
  useInternet: false,
  agentMode: false,
  assistantName: "Lumen",
  systemPrompt:
    "You are a warm, capable personal assistant running locally on my computer. Be concise, helpful, proactive, and conversational. If I ask for something ambiguous, make a reasonable assumption and move us forward.",
  autoSpeak: true,
  handsFree: false,
  temperature: 0.7,
  maxTokens: 400,
  selectedSpeechModel: "",
  screenCaptureSurface: "any",
  panelHidden: false,
  pendingAgentApproval: null,
  agentActionQueue: [],
};

const SCREEN_TRANSCRIPT_CHUNK_MS = 20000;
const SCREEN_TRANSCRIPT_PROMPT_TAIL_LENGTH = 600;

const state = {
  messages: [],
  models: [],
  speechModels: [],
  voices: [],
  visualExamples: null,
  visualDownloadUrl: null,
  microphones: [],
  recognition: null,
  isListening: false,
  isSending: false,
  shouldResumeListening: false,
  finalTranscript: "",
  speechRequestId: 0,
  screenCaptureDisplayStream: null,
  screenCaptureAudioStream: null,
  screenRecorder: null,
  isScreenTranscribing: false,
  screenTranscriptSessionId: 0,
  screenTranscriptPendingUploads: 0,
  screenTranscriptChunkCount: 0,
  screenTranscriptUploadChain: Promise.resolve(),
  agentActionQueue: [],
  pendingAgentApproval: null,
};

const elements = {
  pageShell: document.querySelector(".page-shell"),
  controlPanel: document.querySelector("#control-panel"),
  toggleControlPanel: document.querySelector("#toggle-control-panel"),
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
  transcriptionBaseUrl: document.querySelector("#transcription-base-url"),
  transcriptionApiKey: document.querySelector("#transcription-api-key"),
  transcriptionModel: document.querySelector("#transcription-model"),
  transcriptionLanguage: document.querySelector("#transcription-language"),
  saveTranscription: document.querySelector("#save-transcription"),
  transcriptionNote: document.querySelector("#transcription-note"),
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
  transcriptionStatus: document.querySelector("#transcription-status"),
  heroTitle: document.querySelector("#hero-title"),
  heroOrb: document.querySelector(".hero-orb"),
  listenButton: document.querySelector("#listen-button"),
  clearChat: document.querySelector("#clear-chat"),
  listeningIndicator: document.querySelector("#listening-indicator"),
  liveTranscript: document.querySelector("#live-transcript"),
  visualExamplesScreen: document.querySelector("#visual-examples-screen"),
  visualScreenTitle: document.querySelector("#visual-screen-title"),
  visualScreenKind: document.querySelector("#visual-screen-kind"),
  visualScreenSummary: document.querySelector("#visual-screen-summary"),
  visualScreenPreview: document.querySelector("#visual-screen-preview"),
  visualScreenGrid: document.querySelector("#visual-screen-grid"),
  visualScreenJson: document.querySelector("#visual-screen-json"),
  downloadVisualJson: document.querySelector("#download-visual-json"),
  hideVisualScreen: document.querySelector("#hide-visual-screen"),
  chatLog: document.querySelector("#chat-log"),
  composer: document.querySelector("#composer"),
  composerListenButton: document.querySelector("#composer-listen-button"),
  messageInput: document.querySelector("#message-input"),
  stopSpeaking: document.querySelector("#stop-speaking"),
  sendButton: document.querySelector("#send-button"),
  startScreenTranscript: document.querySelector("#start-screen-transcript"),
  stopScreenTranscript: document.querySelector("#stop-screen-transcript"),
  useScreenTranscript: document.querySelector("#use-screen-transcript"),
  screenPreview: document.querySelector("#screen-preview"),
  screenPreviewEmpty: document.querySelector("#screen-preview-empty"),
  screenCaptureSurface: document.querySelector("#screen-capture-surface"),
  screenTranscript: document.querySelector("#screen-transcript"),
  screenTranscriptStatus: document.querySelector("#screen-transcript-status"),
  agentActionQueue: document.querySelector("#agent-action-queue"),
  agentQueueStatus: document.querySelector("#agent-queue-status"),
  runApprovedAgentActions: document.querySelector("#run-approved-agent-actions"),
  clearAgentQueue: document.querySelector("#clear-agent-queue"),
  template: document.querySelector("#message-template"),
  shortcutTiles: document.querySelectorAll(".shortcut-tile"),
};

const SCRAPE_INTENT_PATTERN =
  /\b(scrap(?:e|ing|ping)|web\s*scrap(?:e|ing|ping)|extract|crawl|parse\s+(?:this\s+)?(?:page|site|website)|pull\s+data|download\s+json|as\s+json|to\s+json)\b/i;
const SCRAPE_CONTEXT_PATTERN =
  /\b(url|link|page|site|website|html|json|data|content|headings|links|images|metadata)\b/i;

function normalizeScrapeUrl(value) {
  const rawValue = String(value || "").trim().replace(/[),.;!?]+$/, "");

  if (!rawValue) {
    return "";
  }

  const nextValue = /^[a-z]+:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`;

  try {
    const parsed = new URL(nextValue);

    if (!/^https?:$/i.test(parsed.protocol)) {
      return "";
    }

    return parsed.toString();
  } catch {
    return "";
  }
}

function extractUrlFromText(text) {
  const source = String(text || "");
  const directMatch = source.match(/https?:\/\/[^\s<>"']+/i);

  if (directMatch?.[0]) {
    return directMatch[0];
  }

  const domainMatch = source.match(
    /\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<>"']*)?/i
  );

  return domainMatch?.[0] || "";
}

function parseScrapeRequest(prompt) {
  const text = String(prompt || "").trim();
  const extractedUrl = extractUrlFromText(text);

  if (!text || !extractedUrl) {
    return null;
  }

  const hasDirectIntent = SCRAPE_INTENT_PATTERN.test(text);
  const hasScrapeContext = SCRAPE_CONTEXT_PATTERN.test(text);
  const isUrlOnly = text === extractedUrl || text === normalizeScrapeUrl(extractedUrl);

  if (!hasDirectIntent && !hasScrapeContext && !isUrlOnly) {
    return null;
  }

  const targetUrl = normalizeScrapeUrl(extractedUrl);

  if (!targetUrl) {
    return null;
  }

  return {
    prompt: text,
    url: targetUrl,
  };
}

function readSettings() {
  try {
    const savedSettings = JSON.parse(localStorage.getItem("assistant-settings")) || {};

    if (savedSettings.assistantName === "Nova") {
      savedSettings.assistantName = defaults.assistantName;
    }

    return {
      ...defaults,
      ...savedSettings,
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
      transcriptionBaseUrl:
        elements.transcriptionBaseUrl.value.trim() || defaults.transcriptionBaseUrl,
      transcriptionModel:
        elements.transcriptionModel.value.trim() || defaults.transcriptionModel,
      transcriptionLanguage: elements.transcriptionLanguage.value.trim(),
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
      screenCaptureSurface: elements.screenCaptureSurface.value,
      panelHidden: elements.pageShell.classList.contains("is-panel-hidden"),
      pendingAgentApproval: state.pendingAgentApproval,
      agentActionQueue: state.agentActionQueue,
    })
  );
}

function updateControlPanelVisibility(panelHidden) {
  elements.pageShell.classList.toggle("is-panel-hidden", panelHidden);
  elements.controlPanel.setAttribute("aria-hidden", String(panelHidden));
  elements.toggleControlPanel.textContent = panelHidden ? "Show panel" : "Hide panel";
  elements.toggleControlPanel.setAttribute("aria-expanded", String(!panelHidden));
  elements.toggleControlPanel.setAttribute(
    "aria-label",
    panelHidden ? "Show side panel" : "Hide side panel"
  );
}

function toggleControlPanelVisibility() {
  updateControlPanelVisibility(!elements.pageShell.classList.contains("is-panel-hidden"));
  saveSettings();
}

const VISUAL_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "for",
  "from",
  "help",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "please",
  "show",
  "that",
  "the",
  "this",
  "to",
  "use",
  "visual",
  "with",
]);

function toTitleCase(value) {
  return String(value || "").replace(/\b[a-z]/g, (character) => character.toUpperCase());
}

function buildSeedSeries(prompt, count, minimum, maximum) {
  const text = String(prompt || "").trim() || "visual";
  const span = Math.max(maximum - minimum, 1);
  let seed = 0;

  for (let index = 0; index < text.length; index += 1) {
    seed = (seed * 33 + text.charCodeAt(index) + index) % 2147483647;
  }

  const values = [];
  let current = seed || 97;

  for (let index = 0; index < count; index += 1) {
    current = (current * 48271 + 31) % 2147483647;
    values.push(minimum + (current % (span + 1)));
  }

  return values;
}

function extractVisualKeywords(prompt, count = 4) {
  const tokens =
    String(prompt || "")
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9-]*/g) || [];
  const uniqueTokens = [];

  tokens.forEach((token) => {
    if (
      token.length < 3 ||
      VISUAL_STOP_WORDS.has(token) ||
      uniqueTokens.includes(token)
    ) {
      return;
    }

    uniqueTokens.push(token);
  });

  return uniqueTokens.slice(0, count);
}

function describeVisualFocus(keywords) {
  if (!keywords.length) {
    return "the topic";
  }

  if (keywords.length === 1) {
    return keywords[0];
  }

  if (keywords.length === 2) {
    return `${keywords[0]} and ${keywords[1]}`;
  }

  return `${keywords.slice(0, -1).join(", ")}, and ${keywords[keywords.length - 1]}`;
}

function detectVisualRequest(prompt) {
  const normalizedPrompt = String(prompt || "").toLowerCase();

  if (!normalizedPrompt.trim()) {
    return null;
  }

  let graphScore = 0;
  let imageScore = 0;

  if (
    /\b(graph|chart|plot|dashboard|trend|timeline|histogram|scatter|bar chart|line chart|pie chart|breakdown)\b/.test(
      normalizedPrompt
    )
  ) {
    graphScore += 3;
  }

  if (
    /\b(compare|comparison|forecast|projection|distribution|percent|rate|growth|revenue|sales|traffic|users|population|monthly|weekly|quarterly|yearly)\b/.test(
      normalizedPrompt
    )
  ) {
    graphScore += 1;
  }

  if (
    /\b(image|photo|picture|illustration|poster|mockup|render|portrait|thumbnail|logo|diagram|infographic|scene|screenshot|wireframe)\b/.test(
      normalizedPrompt
    )
  ) {
    imageScore += 3;
  }

  if (
    /\b(concept|style|composition|layout|brand|cover|look and feel|visualize|show me visually)\b/.test(
      normalizedPrompt
    )
  ) {
    imageScore += 1;
  }

  if (!graphScore && !imageScore) {
    return null;
  }

  return {
    kind: graphScore >= imageScore ? "graph" : "image",
    prompt: String(prompt || "").trim(),
  };
}

function createVisualSuggestionCard(card) {
  const article = document.createElement("article");
  article.className = "visual-suggestion-card";

  const eyebrow = document.createElement("span");
  eyebrow.className = "visual-card-kicker";
  eyebrow.textContent = card.kicker;

  const title = document.createElement("strong");
  title.className = "visual-card-title";
  title.textContent = card.title;

  const description = document.createElement("p");
  description.className = "visual-card-description";
  description.textContent = card.description;

  article.append(eyebrow, title, description);
  return article;
}

function createGraphCanvas(model) {
  const canvas = document.createElement("div");
  canvas.className = "visual-canvas visual-canvas-graph";

  const grid = document.createElement("div");
  grid.className = "visual-chart-grid";

  for (let index = 0; index < 4; index += 1) {
    const line = document.createElement("span");
    line.className = "visual-chart-grid-line";
    grid.appendChild(line);
  }

  const bars = document.createElement("div");
  bars.className = "visual-chart-bars";

  model.points.forEach((point) => {
    const group = document.createElement("div");
    group.className = "visual-chart-bar-group";

    const bar = document.createElement("span");
    bar.className = "visual-chart-bar";
    bar.style.setProperty("--bar-height", `${point.value}%`);

    const label = document.createElement("span");
    label.className = "visual-chart-label";
    label.textContent = point.label;

    group.append(bar, label);
    bars.appendChild(group);
  });

  const chips = document.createElement("div");
  chips.className = "visual-chip-row";

  model.chips.forEach((chip) => {
    const chipNode = document.createElement("span");
    chipNode.className = "visual-chip";
    chipNode.textContent = chip;
    chips.appendChild(chipNode);
  });

  canvas.append(grid, bars, chips);
  return canvas;
}

function createImageCanvas(model) {
  const canvas = document.createElement("div");
  canvas.className = "visual-canvas visual-canvas-image";

  const halo = document.createElement("span");
  halo.className = "visual-image-halo";

  const framePrimary = document.createElement("div");
  framePrimary.className = "visual-image-frame visual-image-frame-primary";
  framePrimary.textContent = model.primaryLabel;

  const frameSecondary = document.createElement("div");
  frameSecondary.className = "visual-image-frame visual-image-frame-secondary";
  frameSecondary.textContent = model.secondaryLabel;

  const frameAccent = document.createElement("div");
  frameAccent.className = "visual-image-frame visual-image-frame-accent";
  frameAccent.textContent = model.accentLabel;

  const chipRow = document.createElement("div");
  chipRow.className = "visual-chip-row";

  model.chips.forEach((chip) => {
    const chipNode = document.createElement("span");
    chipNode.className = "visual-chip";
    chipNode.textContent = chip;
    chipRow.appendChild(chipNode);
  });

  canvas.append(halo, framePrimary, frameSecondary, frameAccent, chipRow);
  return canvas;
}

function buildVisualExampleModel(prompt, request) {
  const keywords = extractVisualKeywords(prompt);
  const focus = describeVisualFocus(keywords);

  if (request.kind === "graph") {
    const labels =
      keywords.length >= 4
        ? keywords.slice(0, 4).map(toTitleCase)
        : ["Signal", "Shift", "Peak", "Outcome"];
    const points = buildSeedSeries(prompt, 4, 28, 88).map((value, index) => ({
      label: labels[index],
      value,
    }));

    return {
      kind: "graph",
      badge: "Graph examples",
      title: "Chart-ready visual examples",
      summary: `This request sounds data-driven, so the hidden visual screen opened with chart directions for ${focus}.`,
      showcaseTitle: "Suggested chart layout",
      showcaseText:
        "Lead with the big movement, keep labels short, and annotate the most important jump or drop.",
      chips: ["Trend", "Comparison", "Highlight"],
      points,
      cards: [
        {
          kicker: "Trend",
          title: `Track ${toTitleCase(keywords[0] || "Momentum")}`,
          description:
            "Use a simple trend view when the answer depends on change over time or a single rising or falling signal.",
        },
        {
          kicker: "Compare",
          title: "Show category gaps",
          description:
            "A grouped or stacked comparison makes it easier to spot leaders, laggards, and distribution at a glance.",
        },
        {
          kicker: "Explain",
          title: "Annotate the takeaway",
          description:
            "Add one short callout near the peak so the user understands the conclusion without reading a long paragraph.",
        },
      ],
    };
  }

  return {
    kind: "image",
    badge: "Image examples",
    title: "Image-ready visual examples",
    summary: `This request sounds easier to explain with imagery, so the hidden visual screen opened with composition ideas for ${focus}.`,
    showcaseTitle: "Suggested composition",
    showcaseText:
      "Use one clear hero subject, one supporting detail, and a caption area that frames the scene without crowding it.",
    chips: ["Hero frame", "Detail crop", "Caption layer"],
    primaryLabel: toTitleCase(keywords[0] || "Hero subject"),
    secondaryLabel: toTitleCase(keywords[1] || "Scene detail"),
    accentLabel: toTitleCase(keywords[2] || "Context note"),
    cards: [
      {
        kicker: "Hero",
        title: "Start with one focal point",
        description:
          "Put the main object or idea in the strongest position first, then let secondary elements support it.",
      },
      {
        kicker: "Detail",
        title: "Include a close-up variation",
        description:
          "A second crop helps answer follow-up questions about texture, labels, controls, or key visual cues.",
      },
      {
        kicker: "Explain",
        title: "Layer in quick annotations",
        description:
          "Short labels or captions make the image useful for teaching, not just for decoration.",
      },
    ],
  };
}

function truncateVisualText(value, maxLength = 180) {
  const text = String(value || "").trim();

  if (!text || text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function slugifyFilePart(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function resetVisualScreenContent() {
  elements.visualScreenPreview.innerHTML = "";
  elements.visualScreenGrid.innerHTML = "";
  elements.visualScreenJson.textContent = "";
  elements.visualScreenJson.hidden = true;

  if (state.visualDownloadUrl) {
    URL.revokeObjectURL(state.visualDownloadUrl);
    state.visualDownloadUrl = null;
  }

  elements.downloadVisualJson.hidden = true;
  delete elements.downloadVisualJson.dataset.filename;
}

function setVisualJsonDownload(data, filename) {
  const serialized = JSON.stringify(data, null, 2);
  const blob = new Blob([serialized], { type: "application/json" });

  if (state.visualDownloadUrl) {
    URL.revokeObjectURL(state.visualDownloadUrl);
  }

  state.visualDownloadUrl = URL.createObjectURL(blob);
  elements.downloadVisualJson.hidden = false;
  elements.downloadVisualJson.dataset.filename = filename || "visual-data.json";
  elements.visualScreenJson.textContent = serialized;
  elements.visualScreenJson.hidden = false;
}

function createVisualStat(label, value) {
  const card = document.createElement("div");
  card.className = "visual-stat-card";

  const labelNode = document.createElement("span");
  labelNode.className = "visual-stat-label";
  labelNode.textContent = label;

  const valueNode = document.createElement("strong");
  valueNode.className = "visual-stat-value";
  valueNode.textContent = value;

  card.append(labelNode, valueNode);
  return card;
}

function hideVisualExamples() {
  state.visualExamples = null;
  elements.visualExamplesScreen.hidden = true;
  resetVisualScreenContent();
}

function renderVisualExamples(model) {
  if (!model) {
    hideVisualExamples();
    return;
  }

  elements.visualExamplesScreen.hidden = false;
  elements.visualScreenTitle.textContent = model.title;
  elements.visualScreenKind.textContent = model.badge;
  elements.visualScreenSummary.textContent = model.summary;
  resetVisualScreenContent();

  const showcase = document.createElement("article");
  showcase.className = "visual-showcase-card";

  const canvas =
    model.kind === "graph" ? createGraphCanvas(model) : createImageCanvas(model);
  const copy = document.createElement("div");
  copy.className = "visual-showcase-copy";

  const title = document.createElement("strong");
  title.className = "visual-showcase-title";
  title.textContent = model.showcaseTitle;

  const text = document.createElement("p");
  text.className = "visual-showcase-text";
  text.textContent = model.showcaseText;

  copy.append(title, text);
  showcase.append(canvas, copy);
  elements.visualScreenPreview.appendChild(showcase);

  model.cards.forEach((card) => {
    elements.visualScreenGrid.appendChild(createVisualSuggestionCard(card));
  });
}

function renderVisualLoadingState(title, badge, summary) {
  elements.visualExamplesScreen.hidden = false;
  elements.visualScreenTitle.textContent = title;
  elements.visualScreenKind.textContent = badge;
  elements.visualScreenSummary.textContent = summary;
  resetVisualScreenContent();

  const showcase = document.createElement("article");
  showcase.className = "visual-showcase-card";

  const copy = document.createElement("div");
  copy.className = "visual-showcase-copy";

  const loading = document.createElement("strong");
  loading.className = "visual-showcase-title";
  loading.textContent = "Preparing visual data";

  const text = document.createElement("p");
  text.className = "visual-showcase-text";
  text.textContent =
    "Fetching the page, extracting structured content, and getting the JSON file ready.";

  copy.append(loading, text);
  showcase.append(copy);
  elements.visualScreenPreview.appendChild(showcase);
}

function renderVisualErrorState(title, badge, summary, bodyText) {
  elements.visualExamplesScreen.hidden = false;
  elements.visualScreenTitle.textContent = title;
  elements.visualScreenKind.textContent = badge;
  elements.visualScreenSummary.textContent = summary;
  resetVisualScreenContent();

  const showcase = document.createElement("article");
  showcase.className = "visual-showcase-card";

  const copy = document.createElement("div");
  copy.className = "visual-showcase-copy";

  const errorTitle = document.createElement("strong");
  errorTitle.className = "visual-showcase-title";
  errorTitle.textContent = "No structured data was captured";

  const text = document.createElement("p");
  text.className = "visual-showcase-text";
  text.textContent = bodyText;

  copy.append(errorTitle, text);
  showcase.append(copy);
  elements.visualScreenPreview.appendChild(showcase);
}

function renderScrapeVisualResult(scrape) {
  const product = scrape.product || {};
  const productName = product.name || scrape.title || scrape.finalUrl;
  const productDescription =
    product.description ||
    scrape.description ||
    scrape.excerpt ||
    "The page was scraped successfully and formatted as JSON.";
  const productPrice = product.price || "Not found";
  const headingText = (scrape.headings || [])
    .slice(0, 3)
    .map((entry) => entry.text)
    .join(" | ");
  const linkText = (scrape.links || [])
    .slice(0, 3)
    .map((entry) => entry.text || entry.url)
    .join(" | ");
  const imageText = (scrape.images || [])
    .slice(0, 3)
    .map((entry) => entry.alt || entry.url)
    .join(" | ");

  state.visualExamples = {
    kind: "scrape",
    scrape,
  };
  elements.visualExamplesScreen.hidden = false;
  elements.visualScreenTitle.textContent = "Web scrape result";
  elements.visualScreenKind.textContent = product.isProductLike ? "Product JSON ready" : "JSON ready";
  elements.visualScreenSummary.textContent = product.isProductLike
    ? `Focused product details extracted from ${scrape.finalUrl}.`
    : `Structured data extracted from ${scrape.finalUrl}.`;
  resetVisualScreenContent();

  const showcase = document.createElement("article");
  showcase.className = "visual-showcase-card";

  const stats = document.createElement("div");
  stats.className = "visual-stats-grid";
  stats.append(
    createVisualStat("Status", String(scrape.status || "OK")),
    createVisualStat(product.isProductLike ? "Price" : "Words", product.isProductLike ? productPrice : String(scrape.wordCount || 0)),
    createVisualStat("Links", String(scrape.counts?.links || 0)),
    createVisualStat("Images", String(scrape.counts?.images || 0))
  );

  const copy = document.createElement("div");
  copy.className = "visual-showcase-copy";

  const title = document.createElement("strong");
  title.className = "visual-showcase-title";
  title.textContent = productName;

  const text = document.createElement("p");
  text.className = "visual-showcase-text";
  text.textContent = productDescription;

  const urlNode = document.createElement("p");
  urlNode.className = "visual-showcase-text";
  urlNode.textContent = `Source: ${scrape.finalUrl}`;

  copy.append(title, text, urlNode);
  showcase.append(stats, copy);
  elements.visualScreenPreview.appendChild(showcase);

  [
    {
      kicker: "Product",
      title: truncateVisualText(productName || "Untitled product", 70),
      description: truncateVisualText(productDescription || "No product description was available.", 160),
    },
    {
      kicker: "Price",
      title: productPrice,
      description: truncateVisualText(
        [
          product.priceAmount ? `Amount: ${product.priceAmount}` : "",
          product.priceCurrency ? `Currency: ${product.priceCurrency}` : "",
          product.availability ? `Availability: ${product.availability}` : "",
        ]
          .filter(Boolean)
          .join(" | ") || "No structured price metadata was found.",
        160
      ),
    },
    {
      kicker: "Description",
      title: product.brand ? `Brand: ${product.brand}` : "Product summary",
      description: truncateVisualText(productDescription || scrape.excerpt || "No product description was available.", 180),
    },
    {
      kicker: "Headings",
      title: `${scrape.counts?.headings || 0} heading${scrape.counts?.headings === 1 ? "" : "s"} found`,
      description: truncateVisualText(headingText || "No headings were extracted.", 160),
    },
    {
      kicker: "Links",
      title: `${scrape.counts?.links || 0} link${scrape.counts?.links === 1 ? "" : "s"} captured`,
      description: truncateVisualText(linkText || "No links were extracted.", 160),
    },
    {
      kicker: "Images",
      title: `${scrape.counts?.images || 0} image${scrape.counts?.images === 1 ? "" : "s"} captured`,
      description: truncateVisualText(
        product.imageUrl || imageText || "No images were extracted.",
        160
      ),
    },
  ].forEach((card) => {
    elements.visualScreenGrid.appendChild(createVisualSuggestionCard(card));
  });

  const fileNameBase =
    slugifyFilePart(productName) ||
    slugifyFilePart(scrape.title) ||
    slugifyFilePart(new URL(scrape.finalUrl).hostname) ||
    "scrape-result";
  setVisualJsonDownload(scrape, `${fileNameBase}.json`);
}

function updateVisualExamples(prompt) {
  const request = detectVisualRequest(prompt);

  if (!request) {
    hideVisualExamples();
    return null;
  }

  const model = buildVisualExampleModel(prompt, request);
  state.visualExamples = model;
  renderVisualExamples(model);
  return model;
}

async function performScrapeRequest(request) {
  renderVisualLoadingState(
    "Web scrape result",
    "Scraping",
    `Extracting structured content from ${request.url}.`
  );

  const response = await fetch("/api/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.details || payload.error || "Web scraping failed.");
  }

  if (!payload.scrape) {
    throw new Error("The scraper returned an empty payload.");
  }

  renderScrapeVisualResult(payload.scrape);
  return payload.scrape;
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

function hasPendingAgentApprovals() {
  return Boolean(
    state.pendingAgentApproval?.runId &&
      state.agentActionQueue.some((item) => item.status === "pending_approval")
  );
}

function syncAgentQueueButtons() {
  elements.runApprovedAgentActions.disabled = !hasPendingAgentApprovals();
}

function renderAgentActionQueue() {
  elements.agentActionQueue.innerHTML = "";

  if (!state.agentActionQueue.length) {
    elements.agentQueueStatus.textContent =
      "Agent mode will show queued actions and approvals here.";
    syncAgentQueueButtons();
    return;
  }

  const pendingCount = state.agentActionQueue.filter(
    (item) => item.status === "pending_approval"
  ).length;
  elements.agentQueueStatus.textContent = pendingCount
    ? `Review ${pendingCount} queued action${pendingCount === 1 ? "" : "s"} before the workflow resumes.`
    : "Latest queued agent actions.";

  state.agentActionQueue.forEach((item) => {
    const article = document.createElement("article");
    article.className = "agent-queue-item";
    article.dataset.tier = item.safetyTier;

    const meta = document.createElement("div");
    meta.className = "agent-queue-meta";

    const owner = document.createElement("span");
    owner.className = "agent-queue-pill";
    owner.textContent = item.owner === "research-agent" ? "Research" : "Operations";

    const tier = document.createElement("span");
    tier.className = "agent-queue-pill";
    tier.textContent = item.safetyTier;

    const status = document.createElement("span");
    status.className = "agent-queue-pill";
    status.textContent = item.status.replace(/_/g, " ");

    meta.append(owner, tier, status);

    const title = document.createElement("p");
    title.className = "agent-queue-title";
    title.textContent = item.title || "Queued action";

    const description = document.createElement("p");
    description.className = "agent-queue-description";
    description.textContent = item.description || item.request || "No description.";

    article.append(meta, title, description);

    if (item.status === "pending_approval") {
      const decisionRow = document.createElement("div");
      decisionRow.className = "agent-queue-decision";

      const approveButton = document.createElement("button");
      approveButton.type = "button";
      approveButton.className = "ghost-button";
      approveButton.textContent = "Approve";
      const selectedDecision = item.reviewDecision || "approve";
      if (selectedDecision === "approve") {
        approveButton.classList.add("is-selected");
      }
      approveButton.addEventListener("click", () => {
        item.reviewDecision = "approve";
        renderAgentActionQueue();
        saveSettings();
      });

      const rejectButton = document.createElement("button");
      rejectButton.type = "button";
      rejectButton.className = "ghost-button";
      rejectButton.textContent = "Reject";
      if (selectedDecision === "reject") {
        rejectButton.classList.add("is-selected");
      }
      rejectButton.addEventListener("click", () => {
        item.reviewDecision = "reject";
        renderAgentActionQueue();
        saveSettings();
      });

      decisionRow.append(approveButton, rejectButton);
      article.appendChild(decisionRow);

      if (item.canEdit) {
        const editWrap = document.createElement("div");
        editWrap.className = "agent-queue-edit";

        const label = document.createElement("label");
        label.textContent = "Edited args JSON";

        const textarea = document.createElement("textarea");
        textarea.value = JSON.stringify(item.reviewEditedArgs || item.args || {}, null, 2);
        textarea.addEventListener("input", () => {
          item.reviewEditedArgsText = textarea.value;
          try {
            item.reviewEditedArgs = JSON.parse(textarea.value);
            textarea.style.borderColor = "";
          } catch {
            textarea.style.borderColor = "rgba(251, 146, 177, 0.5)";
          }
          saveSettings();
        });

        editWrap.append(label, textarea);
        article.appendChild(editWrap);
      }
    }

    if (item.result || item.error) {
      const result = document.createElement("p");
      result.className = `agent-queue-result${item.error ? " is-error" : ""}`;
      result.textContent = item.error || item.result;
      article.appendChild(result);
    }

    elements.agentActionQueue.appendChild(article);
  });

  syncAgentQueueButtons();
}

function normalizeAgentActionQueue(queue) {
  return (Array.isArray(queue) ? queue : []).map((item) => ({
    ...item,
    reviewDecision: item.reviewDecision || "approve",
    reviewEditedArgs:
      item.reviewEditedArgs && typeof item.reviewEditedArgs === "object"
        ? item.reviewEditedArgs
        : item.args || {},
    reviewEditedArgsText:
      typeof item.reviewEditedArgsText === "string"
        ? item.reviewEditedArgsText
        : JSON.stringify(item.args || {}, null, 2),
  }));
}

function applyAgentWorkflowPayload(payload) {
  state.agentActionQueue = normalizeAgentActionQueue(payload.actionQueue);
  state.pendingAgentApproval =
    payload.pendingApproval && typeof payload.pendingApproval === "object"
      ? payload.pendingApproval
      : null;
  renderAgentActionQueue();
}

function clearAgentActionQueue() {
  state.agentActionQueue = [];
  state.pendingAgentApproval = null;
  renderAgentActionQueue();
  saveSettings();
}

async function resumeApprovedAgentActions() {
  if (!state.pendingAgentApproval?.runId) {
    return;
  }

  const decisions = state.agentActionQueue
    .filter((item) => item.status === "pending_approval")
    .map((item) => {
      let editedArgs = undefined;

      if (item.canEdit) {
        try {
          editedArgs = JSON.parse(item.reviewEditedArgsText || "{}");
        } catch {
          throw new Error(`Edited args for "${item.title}" are not valid JSON.`);
        }
      }

      return {
        id: item.id,
        decision: item.reviewDecision === "reject" ? "reject" : "approve",
        editedArgs,
      };
    });

  setHelperText(elements.agentQueueStatus, "Resuming agent workflow...");

  const response = await fetch("/api/agent-approval", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      runId: state.pendingAgentApproval.runId,
      decisions,
    }),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.details || payload.error || "Could not resume the agent workflow.");
  }

  applyAgentWorkflowPayload(payload);

  const assistantReply = String(payload.message || "").trim();
  if (assistantReply) {
    state.messages.push({
      role: "assistant",
      content: assistantReply,
      sources: Array.isArray(payload.sources) ? payload.sources : [],
      reasoningTrace: Array.isArray(payload.reasoningTrace) ? payload.reasoningTrace : [],
    });
    rerenderChat();
    elements.liveTranscript.textContent = "Reply ready.";
    void speakText(assistantReply);
  }

  saveSettings();
}

function rerenderChat() {
  elements.chatLog.innerHTML = "";

  if (!state.messages.length) {
    const emptyState = document.createElement("div");
    emptyState.className = "chat-log-empty";

    const title = document.createElement("strong");
    title.className = "chat-log-empty-title";
    title.textContent = `${elements.assistantName.value || defaults.assistantName} is online`;

    const detail = document.createElement("p");
    detail.className = "chat-log-empty-detail";
    detail.textContent =
      "Start voice input, choose a quick action, or type a message to begin the session.";

    emptyState.append(title, detail);
    elements.chatLog.appendChild(emptyState);
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

function setHelperText(target, text, isError = false) {
  target.textContent = text;
  target.style.color = isError ? "#fda4af" : "";
}

function syncScreenTranscriptButtons() {
  const isCapturing = Boolean(
    state.screenRecorder && state.screenRecorder.state !== "inactive"
  );
  elements.startScreenTranscript.disabled = isCapturing || state.isScreenTranscribing;
  elements.stopScreenTranscript.disabled = !isCapturing;
  elements.useScreenTranscript.disabled = !elements.screenTranscript.value.trim();
}

function updateScreenTranscriptBusyState(delta) {
  state.screenTranscriptPendingUploads = Math.max(
    0,
    state.screenTranscriptPendingUploads + delta
  );
  state.isScreenTranscribing = state.screenTranscriptPendingUploads > 0;
  syncScreenTranscriptButtons();
}

function clearScreenPreview() {
  elements.screenPreview.pause();
  elements.screenPreview.srcObject = null;
  elements.screenPreview.hidden = true;
  elements.screenPreviewEmpty.hidden = false;
}

function stopMediaStream(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

function resetScreenCaptureState() {
  stopMediaStream(state.screenCaptureDisplayStream);
  stopMediaStream(state.screenCaptureAudioStream);
  state.screenCaptureDisplayStream = null;
  state.screenCaptureAudioStream = null;
  state.screenRecorder = null;
  clearScreenPreview();
  syncScreenTranscriptButtons();
}

function getPreferredScreenCaptureMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
  ];
  return (
    candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || ""
  );
}

function getScreenTranscriptExtension(mimeType) {
  if (/ogg/i.test(mimeType)) {
    return "ogg";
  }

  if (/mp4/i.test(mimeType)) {
    return "m4a";
  }

  return "webm";
}

function getScreenCaptureDisplayOptions() {
  const surfacePreference = elements.screenCaptureSurface.value || defaults.screenCaptureSurface;
  const video =
    surfacePreference === "desktop"
      ? { displaySurface: "monitor" }
      : surfacePreference === "window"
        ? { displaySurface: "window" }
        : surfacePreference === "tab"
          ? { displaySurface: "browser" }
          : true;

  return {
    video,
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      suppressLocalAudioPlayback: false,
    },
    preferCurrentTab: surfacePreference === "tab",
    selfBrowserSurface: "include",
    surfaceSwitching: "include",
    systemAudio: "include",
    monitorTypeSurfaces: "include",
  };
}

function getScreenTranscriptPrompt() {
  const transcriptTail = elements.screenTranscript.value
    .trim()
    .slice(-SCREEN_TRANSCRIPT_PROMPT_TAIL_LENGTH);

  if (!transcriptTail) {
    return "";
  }

  return `Continue this transcript naturally and keep names, acronyms, and punctuation consistent:\n\n${transcriptTail}`;
}

function appendScreenTranscriptText(text) {
  const nextText = String(text || "").trim();

  if (!nextText) {
    return;
  }

  const currentText = elements.screenTranscript.value.trim();
  elements.screenTranscript.value = currentText
    ? `${currentText}\n${nextText}`
    : nextText;
  syncScreenTranscriptButtons();
}

async function uploadScreenTranscript(
  file,
  language = "",
  prompt = "",
  options = {}
) {
  const { chunkIndex = 1, isFinal = false, sessionId = state.screenTranscriptSessionId } = options;

  updateScreenTranscriptBusyState(1);
  setHelperText(
    elements.screenTranscriptStatus,
    isFinal
      ? `Transcribing final segment ${chunkIndex}...`
      : `Transcribing segment ${chunkIndex} while capture continues...`
  );

  try {
    const formData = new FormData();
    formData.append("file", file);

    if (language) {
      formData.append("language", language);
    }

    if (prompt) {
      formData.append("prompt", prompt);
    }

    const response = await fetch("/api/transcribe", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.details || payload.error || "Transcription failed.");
    }

    if (sessionId !== state.screenTranscriptSessionId) {
      return;
    }

    if (payload.text) {
      appendScreenTranscriptText(payload.text);
    }

    setHelperText(
      elements.screenTranscriptStatus,
      payload.text
        ? isFinal
          ? `Transcript ready with ${payload.model} after ${chunkIndex} segment${chunkIndex === 1 ? "" : "s"}.`
          : `Segment ${chunkIndex} added with ${payload.model}. Recording continues...`
        : isFinal
          ? "The final segment finished, but no transcript text was returned."
          : `Segment ${chunkIndex} finished, but no transcript text was returned.`
    );
  } catch (error) {
    if (sessionId === state.screenTranscriptSessionId) {
      setHelperText(
        elements.screenTranscriptStatus,
        `I couldn't transcribe segment ${chunkIndex}: ${error.message}`,
        true
      );
    }
  } finally {
    updateScreenTranscriptBusyState(-1);
  }
}

function enqueueScreenTranscriptChunk(blob, mimeType, options = {}) {
  const { isFinal = false, sessionId = state.screenTranscriptSessionId } = options;

  if (!blob?.size || sessionId !== state.screenTranscriptSessionId) {
    return;
  }

  state.screenTranscriptChunkCount += 1;
  const chunkIndex = state.screenTranscriptChunkCount;
  const extension = getScreenTranscriptExtension(mimeType || "audio/webm");

  state.screenTranscriptUploadChain = state.screenTranscriptUploadChain
    .catch(() => {})
    .then(async () => {
      if (sessionId !== state.screenTranscriptSessionId) {
        return;
      }

      const file = new File([blob], `screen-capture-${chunkIndex}.${extension}`, {
        type: mimeType || "audio/webm",
      });

      await uploadScreenTranscript(
        file,
        elements.transcriptionLanguage.value.trim(),
        getScreenTranscriptPrompt(),
        { chunkIndex, isFinal, sessionId }
      );
    });
}

function stopScreenTranscriptCapture() {
  if (!state.screenRecorder) {
    return;
  }

  setHelperText(
    elements.screenTranscriptStatus,
    "Finishing capture and preparing the transcript..."
  );

  if (state.screenRecorder.state !== "inactive") {
    state.screenRecorder.stop();
  }
}

async function startScreenTranscriptCapture() {
  if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) {
    setHelperText(
      elements.screenTranscriptStatus,
      "Screen capture is unavailable in this browser.",
      true
    );
    return;
  }

  try {
    stopSpeaking();

    const displayStream = await navigator.mediaDevices.getDisplayMedia(
      getScreenCaptureDisplayOptions()
    );
    const audioTracks = displayStream.getAudioTracks();

    if (!audioTracks.length) {
      stopMediaStream(displayStream);
      setHelperText(
        elements.screenTranscriptStatus,
        "No shared audio was detected. If you want sound from multiple apps or tabs, choose Desktop and enable system audio when your browser offers it.",
        true
      );
      return;
    }

    const captureStream = new MediaStream(audioTracks);
    const mimeType = getPreferredScreenCaptureMimeType();
    const recorder = mimeType
      ? new MediaRecorder(captureStream, {
          mimeType,
          audioBitsPerSecond: 128000,
        })
      : new MediaRecorder(captureStream);
    const sessionId = state.screenTranscriptSessionId + 1;

    state.screenTranscriptSessionId = sessionId;
    state.screenTranscriptPendingUploads = 0;
    state.screenTranscriptChunkCount = 0;
    state.screenTranscriptUploadChain = Promise.resolve();
    state.isScreenTranscribing = false;
    state.screenCaptureDisplayStream = displayStream;
    state.screenCaptureAudioStream = captureStream;
    state.screenRecorder = recorder;
    elements.screenTranscript.value = "";
    elements.screenPreview.srcObject = displayStream;
    elements.screenPreview.hidden = false;
    elements.screenPreviewEmpty.hidden = true;
    elements.screenPreview.play().catch(() => {});

    recorder.ondataavailable = (event) => {
      if (!event.data?.size || sessionId !== state.screenTranscriptSessionId) {
        return;
      }

      const isFinalChunk = recorder.state === "inactive";
      enqueueScreenTranscriptChunk(event.data, recorder.mimeType || mimeType || "audio/webm", {
        isFinal: isFinalChunk,
        sessionId,
      });
    };

    recorder.onerror = () => {
      resetScreenCaptureState();
      setHelperText(
        elements.screenTranscriptStatus,
        "The browser stopped recording the shared audio.",
        true
      );
    };

    recorder.onstop = () => {
      resetScreenCaptureState();
      setHelperText(
        elements.screenTranscriptStatus,
        state.screenTranscriptChunkCount
          ? "Finishing the last transcript segment..."
          : "Capture ended before any audio chunk could be transcribed."
      );

      void state.screenTranscriptUploadChain.finally(() => {
        if (sessionId !== state.screenTranscriptSessionId) {
          return;
        }

        setHelperText(
          elements.screenTranscriptStatus,
          elements.screenTranscript.value.trim()
            ? `Transcript ready from ${state.screenTranscriptChunkCount} segment${state.screenTranscriptChunkCount === 1 ? "" : "s"}.`
            : "The capture ended, but no transcript text was produced.",
          !elements.screenTranscript.value.trim()
        );
      });
    };

    displayStream.getTracks().forEach((track) => {
      track.addEventListener(
        "ended",
        () => {
          if (state.screenRecorder === recorder && recorder.state !== "inactive") {
            stopScreenTranscriptCapture();
          }
        },
        { once: true }
      );
    });

    recorder.start(SCREEN_TRANSCRIPT_CHUNK_MS);
    setHelperText(
      elements.screenTranscriptStatus,
      "Capturing shared media. Transcript segments will appear here while recording continues."
    );
    syncScreenTranscriptButtons();
  } catch (error) {
    setHelperText(
      elements.screenTranscriptStatus,
      `I couldn't start screen capture: ${error.message}`,
      true
    );
    resetScreenCaptureState();
  }
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
    elements.transcriptionBaseUrl.value =
      payload.transcription?.baseUrl || defaults.transcriptionBaseUrl;
    elements.transcriptionApiKey.value = "";
    elements.transcriptionModel.value =
      payload.transcription?.model || defaults.transcriptionModel;
    elements.transcriptionLanguage.value =
      payload.transcription?.language || defaults.transcriptionLanguage;
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
    setStatus(
      elements.transcriptionStatus,
      payload.transcription?.enabled
        ? `Ready with ${payload.transcription.model}`
        : payload.transcription?.baseUrl
          ? "Base URL saved, model missing"
          : "Not configured",
      !payload.transcription?.enabled
    );
    elements.homeAssistantNote.textContent =
      "The token is write-only here. Leave it blank to keep the current saved token.";
    elements.transcriptionNote.textContent =
      "The API key is optional for LocalAI-compatible servers. Leave it blank to keep the current saved value.";
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
    elements.transcriptionBaseUrl.value =
      settings.transcriptionBaseUrl || defaults.transcriptionBaseUrl;
    elements.transcriptionModel.value =
      settings.transcriptionModel || defaults.transcriptionModel;
    elements.transcriptionLanguage.value =
      settings.transcriptionLanguage || defaults.transcriptionLanguage;
    elements.screenCaptureSurface.value =
      settings.screenCaptureSurface || defaults.screenCaptureSurface;
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

async function saveTranscriptionConfig() {
  const transcriptionPayload = {
    baseUrl:
      elements.transcriptionBaseUrl.value.trim() || defaults.transcriptionBaseUrl,
    model:
      elements.transcriptionModel.value.trim() || defaults.transcriptionModel,
    language: elements.transcriptionLanguage.value.trim(),
  };

  if (elements.transcriptionApiKey.value) {
    transcriptionPayload.apiKey = elements.transcriptionApiKey.value;
  }

  setStatus(elements.transcriptionStatus, "Saving transcription config...");

  try {
    const response = await fetch("/api/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ transcription: transcriptionPayload }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(
        payload.details || payload.error || "Could not save transcription settings."
      );
    }

    elements.transcriptionBaseUrl.value =
      payload.transcription?.baseUrl || defaults.transcriptionBaseUrl;
    elements.transcriptionApiKey.value = "";
    elements.transcriptionModel.value =
      payload.transcription?.model || defaults.transcriptionModel;
    elements.transcriptionLanguage.value =
      payload.transcription?.language || defaults.transcriptionLanguage;
    setStatus(
      elements.transcriptionStatus,
      payload.transcription?.enabled
        ? `Ready with ${payload.transcription.model}`
        : "Saved, but the transcription model is still missing.",
      !payload.transcription?.enabled
    );
    elements.transcriptionNote.textContent =
      "The API key is optional for LocalAI-compatible servers. Leave it blank to keep the current saved value.";
    saveSettings();
  } catch (error) {
    setStatus(elements.transcriptionStatus, error.message, true);
    elements.transcriptionNote.textContent =
      "Check the LocalAI base URL, model, and language hint, then save again.";
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

function splitLongSpeechSegment(segment, maxLength) {
  const words = segment.trim().split(/\s+/).filter(Boolean);
  const chunks = [];
  let currentChunk = "";

  words.forEach((word) => {
    if (word.length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = "";
      }

      for (let index = 0; index < word.length; index += maxLength) {
        chunks.push(word.slice(index, index + maxLength));
      }
      return;
    }

    const nextChunk = currentChunk ? `${currentChunk} ${word}` : word;

    if (nextChunk.length <= maxLength) {
      currentChunk = nextChunk;
      return;
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    currentChunk = word;
  });

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function splitTextForSpeech(text, maxLength = 220) {
  const normalizedText = text.replace(/\s+/g, " ").trim();

  if (!normalizedText) {
    return [];
  }

  const sentenceLikeParts =
    normalizedText.match(/[^.!?;:,]+[.!?;:,]*|.+$/g)?.map((part) => part.trim()).filter(Boolean) ||
    [normalizedText];

  const chunks = [];
  let currentChunk = "";

  sentenceLikeParts.forEach((part) => {
    if (part.length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = "";
      }

      chunks.push(...splitLongSpeechSegment(part, maxLength));
      return;
    }

    const nextChunk = currentChunk ? `${currentChunk} ${part}` : part;

    if (nextChunk.length <= maxLength) {
      currentChunk = nextChunk;
      return;
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    currentChunk = part;
  });

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
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

  const voice = state.voices.find((entry) => entry.name === elements.voiceSelect.value);
  const chunks = splitTextForSpeech(spokenText);

  if (!chunks.length) {
    return;
  }

  const finalizeSpeech = () => {
    if (requestId !== state.speechRequestId) {
      return;
    }

    if (state.shouldResumeListening && state.recognition && !state.isListening) {
      state.shouldResumeListening = false;
      startListening();
      return;
    }

    state.shouldResumeListening = false;
  };

  const handleSpeechError = () => {
    if (requestId === state.speechRequestId) {
      state.shouldResumeListening = false;
    }
  };

  const speakChunk = (chunkIndex) => {
    if (requestId !== state.speechRequestId) {
      return;
    }

    const utterance = new SpeechSynthesisUtterance(chunks[chunkIndex]);

    if (voice) {
      utterance.voice = voice;
    }

    utterance.onend = () => {
      if (requestId !== state.speechRequestId) {
        return;
      }

      if (chunkIndex === chunks.length - 1) {
        finalizeSpeech();
        return;
      }

      speakChunk(chunkIndex + 1);
    };

    utterance.onerror = handleSpeechError;

    window.speechSynthesis.speak(utterance);
  };

  state.shouldResumeListening = elements.handsFree.checked;
  speakChunk(0);
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
  const scrapeRequest = parseScrapeRequest(userText);

  if (!userText || state.isSending) {
    return;
  }

  if (!scrapeRequest && !elements.modelSelect.value) {
    setStatus(elements.connectionStatus, "Select a chat model first.", true);
    return;
  }

  state.isSending = true;
  elements.sendButton.disabled = true;
  elements.listenButton.disabled = true;
  stopSpeaking();
  const visualExamples = scrapeRequest ? null : updateVisualExamples(userText);

  state.messages.push({ role: "user", content: userText });
  rerenderChat();
  elements.messageInput.value = "";
  elements.liveTranscript.textContent = scrapeRequest
    ? "Scraping the page and preparing JSON..."
    : elements.agentMode.checked
      ? "Agent mode is planning and acting..."
    : visualExamples
      ? "Thinking and preparing visual examples..."
      : "Thinking...";

  try {
    if (scrapeRequest) {
      const scrape = await performScrapeRequest(scrapeRequest);
      const assistantReply = `I scraped ${scrape.finalUrl} and displayed the structured result on the visualizer screen. Use Download JSON to save it.`;
      state.messages.push({
        role: "assistant",
        content: assistantReply,
      });
      rerenderChat();
      elements.liveTranscript.textContent = "Scrape ready.";
      void speakText(assistantReply);
      return;
    }

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
    applyAgentWorkflowPayload(payload);
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
    if (scrapeRequest) {
      renderVisualErrorState(
        "Web scrape result",
        "Scrape failed",
        `I couldn't extract data from ${scrapeRequest.url}.`,
        error.message
      );
    }

    const failureMessage = scrapeRequest
      ? `I couldn't scrape that page: ${error.message}`
      : `I hit a problem reaching LM Studio: ${error.message}`;
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
  elements.toggleControlPanel.addEventListener("click", toggleControlPanelVisibility);
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
  elements.saveTranscription.addEventListener("click", () => {
    saveTranscriptionConfig().catch(() => {});
  });
  elements.refreshMics.addEventListener("click", refreshMicrophones);
  elements.startScreenTranscript.addEventListener("click", () => {
    startScreenTranscriptCapture().catch(() => {});
  });
  elements.stopScreenTranscript.addEventListener("click", stopScreenTranscriptCapture);
  elements.useScreenTranscript.addEventListener("click", () => {
    const transcript = elements.screenTranscript.value.trim();

    if (!transcript) {
      return;
    }

    elements.messageInput.value = transcript;
    elements.messageInput.focus();
  });
  elements.screenTranscript.addEventListener("input", syncScreenTranscriptButtons);
  elements.runApprovedAgentActions.addEventListener("click", () => {
    resumeApprovedAgentActions().catch((error) => {
      setHelperText(elements.agentQueueStatus, error.message, true);
    });
  });
  elements.clearAgentQueue.addEventListener("click", clearAgentActionQueue);

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
    elements.transcriptionBaseUrl,
    elements.transcriptionModel,
    elements.transcriptionLanguage,
    elements.screenCaptureSurface,
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
  elements.downloadVisualJson.addEventListener("click", () => {
    if (!state.visualDownloadUrl) {
      return;
    }

    const link = document.createElement("a");
    link.href = state.visualDownloadUrl;
    link.target = "_self";
    link.rel = "noopener";
    link.download = elements.downloadVisualJson.dataset.filename || "visual-data.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
  });

  elements.clearChat.addEventListener("click", () => {
    state.messages = [];
    stopSpeaking();
    hideVisualExamples();
    elements.liveTranscript.textContent = "Start voice input or type a request below.";
    rerenderChat();
  });

  elements.hideVisualScreen.addEventListener("click", hideVisualExamples);

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
  elements.transcriptionBaseUrl.value =
    settings.transcriptionBaseUrl || defaults.transcriptionBaseUrl;
  elements.transcriptionApiKey.value = "";
  elements.transcriptionModel.value =
    settings.transcriptionModel || defaults.transcriptionModel;
  elements.transcriptionLanguage.value =
    settings.transcriptionLanguage || defaults.transcriptionLanguage;
  elements.screenCaptureSurface.value =
    settings.screenCaptureSurface || defaults.screenCaptureSurface;
  elements.assistantName.value = settings.assistantName;
  elements.systemPrompt.value = settings.systemPrompt;
  elements.autoSpeak.checked = settings.autoSpeak;
  elements.useInternet.checked = settings.useInternet;
  elements.agentMode.checked = settings.agentMode;
  elements.handsFree.checked = settings.handsFree;
  elements.temperature.value = String(settings.temperature);
  elements.maxTokens.value = String(settings.maxTokens);
  state.pendingAgentApproval = settings.pendingAgentApproval || null;
  state.agentActionQueue = normalizeAgentActionQueue(settings.agentActionQueue);
  updateControlPanelVisibility(Boolean(settings.panelHidden));
  updateRangeLabels();
  updateHeroTitle();
  clearScreenPreview();
  syncScreenTranscriptButtons();
  hideVisualExamples();
  renderAgentActionQueue();
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

void initialize();
}
