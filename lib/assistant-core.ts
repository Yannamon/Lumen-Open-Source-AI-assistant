import * as childProcess from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as tls from "node:tls";

import {
  createAgentGateway,
  type AgentToolName,
} from "@/lib/agent-gateway";
import { createMastraAgentOrchestrator } from "@/lib/agent-workflow";

export type SearchSource = {
  title: string;
  url: string;
  snippet: string;
};

export type ApiResult<T> = {
  status: number;
  body: T;
};

type AgentTraceStep = {
  step: number;
  title: string;
  detail: string;
  status: "ok" | "error";
};

let mastraAgentOrchestrator:
  | ReturnType<typeof createMastraAgentOrchestrator>
  | null = null;
let agentGateway:
  | ReturnType<typeof createAgentGateway>
  | null = null;

const APP_ROOT = process.cwd();
const DEFAULT_LM_STUDIO_BASE_URL = "http://127.0.0.1:1234";
let lmStudioBaseUrl = (
  process.env.LM_STUDIO_BASE_URL || DEFAULT_LM_STUDIO_BASE_URL
).replace(/\/+$/, "");
const smtpConfig = {
  host: process.env.SMTP_HOST || "smtp.example.com",
  port: Number(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER || "",
  pass: process.env.SMTP_PASS || "",
  from: process.env.SMTP_FROM || process.env.SMTP_USER || "",
};
const homeAssistantConfig = {
  baseUrl: (process.env.HOME_ASSISTANT_BASE_URL || "").replace(/\/+$/, ""),
  token: process.env.HOME_ASSISTANT_TOKEN || "",
  defaultMediaPlayer: process.env.HOME_ASSISTANT_MEDIA_PLAYER || "",
};
const DEFAULT_TRANSCRIPTION_BASE_URL = "http://127.0.0.1:8080/v1";
const DEFAULT_TRANSCRIPTION_MODEL = "whisper-1";
const transcriptionConfig = {
  baseUrl: normalizeBaseUrl(
    process.env.TRANSCRIPTION_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      DEFAULT_TRANSCRIPTION_BASE_URL
  ),
  apiKey: process.env.TRANSCRIPTION_API_KEY || process.env.OPENAI_API_KEY || "",
  model: process.env.TRANSCRIPTION_MODEL || DEFAULT_TRANSCRIPTION_MODEL,
  language: process.env.TRANSCRIPTION_LANGUAGE || "",
};
const INTERNET_SEARCH_PROVIDER = "DuckDuckGo";
const DUCKDUCKGO_HTML_SEARCH_URL = "https://html.duckduckgo.com/html/";
const DUCKDUCKGO_LITE_SEARCH_URL = "https://lite.duckduckgo.com/lite/";
const DEFAULT_SPEECH_MODEL = "tts2-emo-qwen3-8b-192k";
const SPOTIFY_WEB_URL = "https://open.spotify.com/";
const RADIO_BROWSER_API_BASE_URL = "https://stations.radioss.app/json";
const AGENT_LOOP_LIMIT = 4;
const AGENT_TOOL_CALL_LIMIT = 4;
const ASSISTANT_GUARDRAIL = {
  role: "system",
  content:
    "You are a local voice assistant. Give direct final answers only. Do not output hidden reasoning, chain-of-thought, or 'thinking process' text unless the user explicitly asks for a brief reasoning summary.",
};

function buildDateTimeContextMessage() {
  const now = new Date();
  const timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "local system timezone";
  const formatted = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "long",
    timeZone,
  }).format(now);

  return {
    role: "system",
    content: `Current local date and time: ${formatted}. Time zone: ${timeZone}. If the user asks for the current time, date, today, tomorrow, or similar, use this exact context rather than guessing.`,
  };
}

function buildInternetGroundingMessage(query, sources) {
  const serializedSources = sources
    .map(
      (source, index) =>
        `[${index + 1}] ${source.title}\nURL: ${source.url}\nSnippet: ${source.snippet || "No snippet provided."}`
    )
    .join("\n\n");

  return {
    role: "system",
    content:
      `The user asked for internet-backed help about: "${query}". ` +
      `Answer using only the search sources below when they are relevant. ` +
      `Cite claims inline with [1], [2], etc. If the sources are insufficient, say so clearly.\n\n` +
      serializedSources,
  };
}

function buildAgentModeMessage(useInternet) {
  return {
    role: "system",
    content:
      "Agent mode is enabled. You may use available tools to gather information or take safe local actions before answering. " +
      "Use tools instead of guessing when the task needs the current date or time, internet research, webpage extraction, Home Assistant, email, local computer control, memory, or structured output storage. " +
      "Only take actions that directly help with the user's request. Do not run arbitrary shell commands, automate external prompt windows, or take destructive actions. " +
      `${useInternet ? "Internet search is available for this request. " : "Internet search is not enabled for this request. "}` +
      `${getAgentGateway().buildInjectedContext({ useInternet })} ` +
      "You may make multiple tool calls, then provide one concise final answer.",
  };
}

function buildAgentToolDefinitions(useInternet) {
  return getAgentGateway()
    .getToolSchemas()
    .filter((tool) => useInternet || tool.name !== "search_internet")
    .map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
}

function getAgentGateway() {
  if (!agentGateway) {
    agentGateway = createAgentGateway(APP_ROOT);
  }

  return agentGateway;
}

function buildSpeechPolishMessages(text) {
  return [
    {
      role: "system",
      content:
        "You improve assistant replies for natural browser speech synthesis. " +
        "Preserve facts, numbers, names, URLs, commands, and intent. " +
        "Return only the final spoken text with no analysis. /no_think",
    },
    {
      role: "user",
      content:
        "Make this sound natural when read aloud, but keep the meaning the same:\n\n" +
        text,
    },
  ];
}

function buildGrammarCheckMessages(text) {
  return [
    {
      role: "system",
      content:
        "You are a careful grammar and clarity editor. Correct grammar, spelling, punctuation, and awkward phrasing while preserving the original meaning and tone. " +
        "Return plain text using this format exactly:\n" +
        "Corrected text:\n" +
        "<improved text>\n\n" +
        "Key improvements:\n" +
        "- <brief improvement>\n" +
        "- <brief improvement>\n" +
        "If the text is already strong, still provide the corrected text and say that only minor or no changes were needed.",
    },
    {
      role: "user",
      content: `Check and improve this writing:\n\n${text}`,
    },
  ];
}

function formatDateTimeParts(date) {
  const timeZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "local system timezone";

  return {
    timeZone,
    time: new Intl.DateTimeFormat("en-US", {
      timeStyle: "short",
      timeZone,
    }).format(date),
    date: new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeZone,
    }).format(date),
    dateTime: new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone,
    }).format(date),
  };
}

function getDirectDateTimeAnswer(message) {
  if (typeof message !== "string") {
    return null;
  }

  const normalized = message.toLowerCase().trim();
  const asksTime =
    /what time is it|current time|time right now|time now|what's the time|what is the time/.test(
      normalized
    );
  const asksDate =
    /what date is it|current date|today's date|todays date|what day is it|what is today's date|what is todays date/.test(
      normalized
    );

  if (!asksTime && !asksDate) {
    return null;
  }

  const now = new Date();
  const { timeZone, time, date, dateTime } = formatDateTimeParts(now);

  if (asksTime && asksDate) {
    return `It is ${dateTime} (${timeZone}).`;
  }

  if (asksTime) {
    return `It is ${time} (${timeZone}) on ${date}.`;
  }

  return `Today is ${date} (${timeZone}).`;
}

function parseEmailRequest(message) {
  if (typeof message !== "string") {
    return null;
  }

  const normalized = message.trim();
  const intentMatch = normalized.match(/^(send|draft|compose)\s+email\b/i);
  if (!intentMatch) {
    return null;
  }

  const intent = intentMatch[1].toLowerCase();

  const emailMatches = [...normalized.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)];
  if (!emailMatches.length) {
    return null;
  }

  const to = emailMatches.map((match) => match[0]).join(",");
  const subjectMatch = normalized.match(
    /subject\s*[:\-]?\s*(.+?)(?=\s+(?:body|message)\s*[:\-]?|$)/i
  );
  const bodyMatch = normalized.match(/(?:body|message)\s*[:\-]?\s*(.+)$/i);

  const subject = subjectMatch?.[1]?.trim() || "Message from your local assistant";
  const body = bodyMatch?.[1]?.trim() || "";

  return { intent, to, subject, body };
}

function parseGrammarCheckRequest(message) {
  if (typeof message !== "string") {
    return null;
  }

  const trimmed = message.trim();
  const match = trimmed.match(
    /^(?:grammar check|check grammar|proofread|proofread this|fix grammar|correct grammar|improve grammar|edit grammar|polish writing)\s*[:\-]?\s+([\s\S]+)$/i
  );

  if (!match) {
    return null;
  }

  const text = match[1]?.trim();
  return text ? { text } : null;
}

function buildMailtoUrl({ to, subject, body }) {
  const params = new URLSearchParams();

  if (subject) {
    params.set("subject", subject);
  }

  if (body) {
    params.set("body", body);
  }

  const query = params.toString();
  return `mailto:${to}${query ? `?${query}` : ""}`;
}

function normalizeBaseUrl(value) {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

function looksLikeHtmlDocument(value) {
  const text = typeof value === "string" ? value.trim().slice(0, 200).toLowerCase() : "";
  return text.startsWith("<!doctype html") || text.startsWith("<html") || text.includes("<body");
}

function openMailtoDraft(mailtoUrl) {
  const command = process.platform === "win32" ? "start" : "xdg-open";

  if (process.platform === "win32") {
    childProcess.spawn("cmd", ["/c", "start", "", mailtoUrl], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    return;
  }

  childProcess.spawn(command, [mailtoUrl], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

function decodeHtmlEntities(value) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  const namedEntities = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const normalized = entity.toLowerCase();

    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return namedEntities[normalized] || match;
  });
}

function stripHtmlTags(value) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  return value.replace(/<[^>]*>/g, " ");
}

function normalizeWhitespace(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function cleanSearchText(value) {
  return normalizeWhitespace(decodeHtmlEntities(stripHtmlTags(value)));
}

function stripReasoningBlocks(value) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  return value
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .trim();
}

function parseJsonObject(value) {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new Error("Tool arguments were not valid JSON.");
  }
}

function parseJsonObjectSafe(value) {
  try {
    return parseJsonObject(value);
  } catch {
    return {};
  }
}

function clipAgentTraceText(value, maxLength = 220) {
  const text = typeof value === "string" ? normalizeWhitespace(value) : "";

  if (!text) {
    return "";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function getAgentTraceTitle(toolName) {
  switch (toolName) {
    case "get_current_datetime":
      return "Checked local date and time";
    case "search_internet":
      return "Searched the web";
    case "scrape_webpage":
      return "Scraped a webpage";
    case "computer_control_request":
      return "Used local computer control";
    case "home_assistant_request":
      return "Queried Home Assistant";
    case "send_email":
      return "Prepared email action";
    case "remember_memory":
      return "Saved a memory";
    case "recall_memory":
      return "Recalled memory";
    case "write_json_record":
      return "Saved structured output";
    default:
      return "Used an agent tool";
  }
}

function buildAgentTraceDetail(toolName, args, payload) {
  if (payload?.ok === false) {
    return payload.error || "The tool call did not complete successfully.";
  }

  switch (toolName) {
    case "get_current_datetime":
      return payload?.dateTime
        ? `Checked the local clock: ${payload.dateTime} (${payload.timeZone || "local time"}).`
        : "Checked the local computer clock.";
    case "search_internet": {
      const resultCount = Array.isArray(payload?.results) ? payload.results.length : 0;
      const query = payload?.query || args?.query || "";
      return query
        ? `Looked up "${query}" and gathered ${resultCount} grounded source${resultCount === 1 ? "" : "s"}.`
        : `Gathered ${resultCount} grounded source${resultCount === 1 ? "" : "s"} from the web.`;
    }
    case "scrape_webpage":
      return (
        payload?.result ||
        payload?.url ||
        args?.url ||
        "Fetched and extracted structured webpage content."
      );
    case "computer_control_request":
      return payload?.result || payload?.request || args?.request || "Completed a local computer action.";
    case "home_assistant_request":
      return payload?.result || payload?.request || args?.request || "Completed a Home Assistant action.";
    case "send_email":
      return payload?.result
        || (payload?.to ? `Prepared an email action for ${payload.to}.` : "")
        || (args?.to ? `Prepared an email action for ${args.to}.` : "Prepared an email action.");
    case "remember_memory":
      return payload?.result || "Stored a memory for future turns.";
    case "recall_memory": {
      const count = Array.isArray(payload?.items) ? payload.items.length : 0;
      return payload?.result || `Recalled ${count} stored memory item${count === 1 ? "" : "s"}.`;
    }
    case "write_json_record":
      return payload?.result || "Saved a structured JSON record to local output storage.";
    default:
      return payload?.result || payload?.message || "Completed a tool action.";
  }
}

function buildAgentTraceEntry(stepNumber, toolCall, result): AgentTraceStep {
  const toolName = toolCall?.function?.name || "";
  const args = parseJsonObjectSafe(toolCall?.function?.arguments || "{}");
  const payload = parseJsonObjectSafe(result?.content || "{}");

  return {
    step: stepNumber,
    title: getAgentTraceTitle(toolName),
    detail: clipAgentTraceText(buildAgentTraceDetail(toolName, args, payload)),
    status: payload?.ok === false ? "error" : "ok",
  };
}

function getMessageTextContent(message) {
  if (typeof message?.content === "string") {
    return message.content;
  }

  if (Array.isArray(message?.content)) {
    return message.content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        return typeof part?.text === "string" ? part.text : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

function mergeSearchSources(existing, incoming) {
  const merged = new Map();

  for (const source of [...existing, ...incoming]) {
    const key = source?.url || source?.title;
    if (!key || merged.has(key)) {
      continue;
    }

    merged.set(key, source);
  }

  return [...merged.values()];
}

function extractDuckDuckGoResultUrl(rawHref) {
  if (typeof rawHref !== "string" || !rawHref.trim()) {
    return "";
  }

  const href = decodeHtmlEntities(rawHref.trim());
  const absoluteHref = href.startsWith("//") ? `https:${href}` : href;

  try {
    const parsed = new URL(absoluteHref, "https://duckduckgo.com");
    const redirectTarget = parsed.searchParams.get("uddg");

    if (redirectTarget) {
      return redirectTarget;
    }

    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch (_) {
    return "";
  }

  return "";
}

function dedupeSources(sources, limit = 5) {
  const uniqueSources = [];
  const seenUrls = new Set();

  for (const source of sources) {
    if (!source?.url || seenUrls.has(source.url)) {
      continue;
    }

    seenUrls.add(source.url);
    uniqueSources.push(source);

    if (uniqueSources.length >= limit) {
      break;
    }
  }

  return uniqueSources;
}

async function fetchDuckDuckGoSearchPage(baseUrl, query) {
  const params = new URLSearchParams({ q: query });
  const response = await fetch(`${baseUrl}?${params.toString()}`, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    },
  });
  const html = await response.text();

  if (!response.ok) {
    throw new Error(`Search request failed with status ${response.status}.`);
  }

  return html;
}

function parseDuckDuckGoHtmlResults(html) {
  const blocks =
    html.match(
      /<div class="result results_links[\s\S]*?<div class="clear"><\/div>\s*<\/div>\s*<\/div>/gi
    ) || [];
  const sources = [];

  for (const block of blocks) {
    const titleMatch = block.match(
      /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
    );
    const snippetMatch = block.match(
      /<(?:a|div)[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/i
    );
    const url = extractDuckDuckGoResultUrl(titleMatch?.[1] || "");
    const title = cleanSearchText(titleMatch?.[2] || "");
    const snippet = cleanSearchText(snippetMatch?.[1] || "");

    if (!url || !title) {
      continue;
    }

    sources.push({ title, url, snippet });
  }

  return dedupeSources(sources);
}

function parseDuckDuckGoLiteResults(html) {
  const sources = [];
  const resultPattern =
    /<a[^>]+class=['"]result-link['"][^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>(?:[\s\S]*?<td class=['"]result-snippet['"]>\s*([\s\S]*?)\s*<\/td>)?/gi;
  let match;

  while ((match = resultPattern.exec(html)) !== null) {
    const url = extractDuckDuckGoResultUrl(match[1] || "");
    const title = cleanSearchText(match[2] || "");
    const snippet = cleanSearchText(match[3] || "");

    if (!url || !title) {
      continue;
    }

    sources.push({ title, url, snippet });
  }

  return dedupeSources(sources);
}

function runPowerShell(command): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      {
        windowsHide: true,
        timeout: 15000,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message));
          return;
        }

        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      }
    );
  });
}

async function sendMediaKey(virtualKeyHex) {
  const command = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class MediaControl {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@;
[MediaControl]::keybd_event(${virtualKeyHex}, 0, 0, [UIntPtr]::Zero);
Start-Sleep -Milliseconds 80;
[MediaControl]::keybd_event(${virtualKeyHex}, 0, 2, [UIntPtr]::Zero);
`;

  await runPowerShell(command);
}

async function openWebApp(url) {
  const safeUrl = String(url || "").replace(/'/g, "''");
  const command = `
$targetUrl = '${safeUrl}';
if (Get-Command chrome.exe -ErrorAction SilentlyContinue) {
  Start-Process chrome.exe "--app=$targetUrl"
} elseif (Get-Command msedge.exe -ErrorAction SilentlyContinue) {
  Start-Process msedge.exe "--app=$targetUrl"
} else {
  Start-Process $targetUrl
}
`;

  await runPowerShell(command);
}

async function focusWindowByPattern(patterns) {
  const searchPatterns = Array.isArray(patterns) ? patterns : [patterns];
  const encodedPatterns = searchPatterns
    .filter(Boolean)
    .map((pattern) => `'${escapePowerShellString(pattern)}'`)
    .join(", ");
  const command = `
Add-Type -AssemblyName System.Windows.Forms;
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ForegroundWindow {
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hWnd);
}
"@;
$patterns = @(${encodedPatterns});
$targetWindow = Get-Process |
  Where-Object { $_.MainWindowHandle -and $_.MainWindowTitle } |
  Where-Object {
    $title = $_.MainWindowTitle;
    foreach ($pattern in $patterns) {
      if ($title -like "*$pattern*") {
        return $true
      }
    }
    return $false
  } |
  Select-Object -First 1;
if (-not $targetWindow) {
  throw 'Could not find the target window.'
}
$wshShell = New-Object -ComObject WScript.Shell;
$null = [System.Windows.Forms.SendKeys]::SendWait('%');
Start-Sleep -Milliseconds 120;
$null = [ForegroundWindow]::ShowWindowAsync($targetWindow.MainWindowHandle, 9);
$null = [ForegroundWindow]::BringWindowToTop($targetWindow.MainWindowHandle);
$null = [ForegroundWindow]::SetForegroundWindow($targetWindow.MainWindowHandle);
try {
  $null = $wshShell.AppActivate([int]$targetWindow.Id);
} catch {
}
Start-Sleep -Milliseconds 180;
Write-Output $targetWindow.MainWindowTitle
`;

  const { stdout } = await runPowerShell(command);
  return stdout.trim();
}

async function sendKeysToFocusedWindow(keys) {
  const safeKeys = escapePowerShellString(keys);
  const command = `
Add-Type -AssemblyName System.Windows.Forms;
Start-Sleep -Milliseconds 120;
[System.Windows.Forms.SendKeys]::SendWait('${safeKeys}');
`;

  await runPowerShell(command);
}

async function controlSpotifyWebPlayback(commandName) {
  await openWebApp(SPOTIFY_WEB_URL);

  const spotifyWindowPatterns = ["Spotify", "Open Spotify", "spotify"];
  const waitSchedule =
    commandName === "play" ? [2200, 1600, 2200] : [700, 900];

  for (const waitMs of waitSchedule) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));

    try {
      await focusWindowByPattern(spotifyWindowPatterns);
    } catch {
    }

    if (commandName === "play" || commandName === "pause") {
      await sendMediaKey("0xB3");
      if (commandName === "play") {
        await new Promise((resolve) => setTimeout(resolve, 180));
        try {
          await sendKeysToFocusedWindow(" ");
        } catch {
        }
      }
      continue;
    }

    if (commandName === "next") {
      await sendMediaKey("0xB0");
      return;
    }

    if (commandName === "previous") {
      await sendMediaKey("0xB1");
      return;
    }
  }
}

function escapePowerShellString(value) {
  return String(value || "").replace(/'/g, "''");
}

function unwrapQuotedValue(value) {
  const trimmed = String(value || "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function resolveExistingPath(target) {
  const cleaned = unwrapQuotedValue(target).replace(/[.?!]+$/, "").trim();
  if (!cleaned) {
    return APP_ROOT;
  }

  if (/^(this|current)\s+(project|folder|directory)$/i.test(cleaned) || /^here$/i.test(cleaned)) {
    return APP_ROOT;
  }

  const candidates = [];

  if (path.isAbsolute(cleaned)) {
    candidates.push(path.normalize(cleaned));
  } else {
    candidates.push(path.resolve(APP_ROOT, cleaned));
    candidates.push(path.resolve(process.cwd(), cleaned));
    candidates.push(path.resolve(cleaned));
    candidates.push(path.join(os.homedir(), cleaned));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function openVsCode(targetPath = "") {
  const resolvedPath = targetPath ? resolveExistingPath(targetPath) : null;
  if (targetPath && !resolvedPath) {
    throw new Error(`I couldn't find that path: ${targetPath}`);
  }

  const safeTargetPath = resolvedPath ? `'${escapePowerShellString(resolvedPath)}'` : "$null";
  const command = `
$targetPath = ${safeTargetPath};
$codeCommand = Get-Command code -ErrorAction SilentlyContinue;
$candidates = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\\Microsoft VS Code\\bin\\code.cmd'),
  (Join-Path $env:LOCALAPPDATA 'Programs\\Microsoft VS Code\\Code.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft VS Code\\bin\\code.cmd'),
  (Join-Path $env:ProgramFiles 'Microsoft VS Code\\Code.exe'),
  (Join-Path \${env:ProgramFiles(x86)} 'Microsoft VS Code\\bin\\code.cmd'),
  (Join-Path \${env:ProgramFiles(x86)} 'Microsoft VS Code\\Code.exe')
) | Where-Object { $_ -and (Test-Path $_) };
$resolvedCode = if ($codeCommand) { $codeCommand.Source } else { $candidates | Select-Object -First 1 };
if (-not $resolvedCode) {
  throw 'VS Code is not installed or the code launcher is unavailable.';
}
$args = @();
if ($targetPath) {
  $args += $targetPath;
}
Start-Process -FilePath $resolvedCode -ArgumentList $args
`;

  await runPowerShell(command);
  return resolvedPath;
}

async function pasteIntoCodexWindow(text, submit = false) {
  const promptText = String(text || "").trim();
  if (!promptText) {
    throw new Error("I need some text to paste into Codex.");
  }

  const safePromptText = escapePowerShellString(promptText);
  const command = `
Add-Type -AssemblyName System.Windows.Forms;
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ForegroundWindow {
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@;
$promptText = '${safePromptText}';
$clipboardBackup = $null;
$hasClipboardBackup = $false;
function Test-IsForegroundTarget($windowProcess) {
  $foregroundHandle = [ForegroundWindow]::GetForegroundWindow();
  if ($foregroundHandle -eq [IntPtr]::Zero) {
    return $false;
  }

  if ($foregroundHandle -eq $windowProcess.MainWindowHandle) {
    return $true;
  }

  $foregroundProcessId = [uint32]0;
  $null = [ForegroundWindow]::GetWindowThreadProcessId(
    $foregroundHandle,
    [ref]$foregroundProcessId
  );
  return $foregroundProcessId -eq [uint32]$windowProcess.Id;
}
try {
  $clipboardBackup = Get-Clipboard -Raw -TextFormatType Text -ErrorAction Stop
  $hasClipboardBackup = $true
} catch {
  $clipboardBackup = $null
}
$targets = @(
  @{ Pattern = 'Codex'; ProcessName = $null },
  @{ Pattern = 'Windows PowerShell'; ProcessName = 'WindowsTerminal' },
  @{ Pattern = 'Terminal'; ProcessName = 'WindowsTerminal' },
  @{ Pattern = 'Visual Studio Code'; ProcessName = 'Code' }
);
$windows = Get-Process | Where-Object { $_.MainWindowTitle };
$targetWindow = $null;
foreach ($target in $targets) {
  $match = $windows | Where-Object {
    $_.MainWindowTitle -like "*$($target.Pattern)*" -and
    (-not $target.ProcessName -or $_.ProcessName -eq $target.ProcessName)
  } | Select-Object -First 1;
  if ($match) {
    $targetWindow = $match;
    break;
  }
}
if (-not $targetWindow) {
  throw 'I could not find a Codex window to focus. Open the Codex terminal or VS Code window first.'
}
if (-not $targetWindow.MainWindowHandle) {
  throw "I found a matching window, but it does not have an active window handle: $($targetWindow.MainWindowTitle)"
}
Set-Clipboard -Value $promptText;
$wshShell = New-Object -ComObject WScript.Shell;
$activated = $false;
for ($attempt = 0; $attempt -lt 5 -and -not $activated; $attempt++) {
  $targetWindow = Get-Process -Id $targetWindow.Id -ErrorAction Stop;
  if (-not $targetWindow.MainWindowHandle) {
    Start-Sleep -Milliseconds 180;
    continue;
  }

  $null = [System.Windows.Forms.SendKeys]::SendWait('%');
  Start-Sleep -Milliseconds 100;
  $null = [ForegroundWindow]::ShowWindowAsync($targetWindow.MainWindowHandle, 9);
  $null = [ForegroundWindow]::BringWindowToTop($targetWindow.MainWindowHandle);
  $null = [ForegroundWindow]::SetForegroundWindow($targetWindow.MainWindowHandle);

  try {
    $null = $wshShell.AppActivate([int]$targetWindow.Id);
  } catch {
  }

  if (-not (Test-IsForegroundTarget $targetWindow)) {
    try {
      $null = $wshShell.AppActivate($targetWindow.MainWindowTitle);
    } catch {
    }
  }

  Start-Sleep -Milliseconds 250;
  $activated = Test-IsForegroundTarget $targetWindow;
}

if (-not $activated) {
  throw "I found a window but could not activate it: $($targetWindow.MainWindowTitle)"
}

Start-Sleep -Milliseconds 220;
[System.Windows.Forms.SendKeys]::SendWait('^v');
${submit ? "Start-Sleep -Milliseconds 120; [System.Windows.Forms.SendKeys]::SendWait('~');" : ""}

if ($hasClipboardBackup) {
  Start-Sleep -Milliseconds 180;
  Set-Clipboard -Value $clipboardBackup;
}
Write-Output $targetWindow.MainWindowTitle
`;

  const { stdout } = await runPowerShell(command);
  return stdout.trim();
}

function tokenizeCommandText(commandText) {
  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  let match;

  while ((match = pattern.exec(commandText)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[0]);
  }

  return tokens;
}

function normalizeExecutableName(token) {
  return path.basename(String(token || ""), path.extname(String(token || ""))).toLowerCase();
}

function clipText(value, maxLength = 2000) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return "";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function runLocalCommand(command, args, options: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, {
      cwd: options.cwd || APP_ROOT,
      env: process.env,
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let completed = false;
    let didTimeout = false;
    const timeoutMs = options.timeoutMs || 20000;
    const timer = setTimeout(() => {
      if (!completed) {
        didTimeout = true;
        child.kill();
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      completed = true;
      reject(error);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (completed) {
        return;
      }

      completed = true;
      resolve({
        code: typeof code === "number" ? code : null,
        signal: signal || null,
        stdout,
        stderr,
        timedOut: didTimeout,
      });
    });
  });
}

async function runDeveloperCommand(commandText) {
  const tokens = tokenizeCommandText(commandText);
  if (!tokens.length) {
    throw new Error("I need a command to run.");
  }

  if (/[\\/]/.test(tokens[0]) || tokens[0].includes(":")) {
    throw new Error("Please use a tool name like npm, pnpm, python, or git rather than a direct executable path.");
  }

  const executable = normalizeExecutableName(tokens[0]);
  const args = tokens.slice(1);
  const allowedExecutables = new Set([
    "npm",
    "pnpm",
    "yarn",
    "node",
    "python",
    "python3",
    "py",
    "pip",
    "pip3",
    "git",
    "docker",
    "docker-compose",
    "npx",
    "pytest",
    "uv",
    "cargo",
  ]);
  const blockedExecutables = new Set(["cmd", "powershell", "pwsh", "bash", "sh", "wsl"]);
  const blockedGitSubcommands = new Set([
    "reset",
    "clean",
    "checkout",
    "switch",
    "merge",
    "rebase",
    "pull",
    "push",
    "commit",
    "cherry-pick",
    "revert",
    "stash",
  ]);

  if (blockedExecutables.has(executable) || !allowedExecutables.has(executable)) {
    throw new Error(
      "That command isn't enabled. I can run common developer tools like npm, pnpm, python, pip, git, docker, node, cargo, uv, and pytest."
    );
  }

  if (executable === "git" && blockedGitSubcommands.has(String(args[0] || "").toLowerCase())) {
    throw new Error("That git subcommand is blocked for safety.");
  }

  const result = await runLocalCommand(tokens[0], args, { timeoutMs: 20000 });
  const outputBlocks = [];

  if (result.stdout.trim()) {
    outputBlocks.push(`stdout:\n${clipText(result.stdout)}`);
  }

  if (result.stderr.trim()) {
    outputBlocks.push(`stderr:\n${clipText(result.stderr)}`);
  }

  if (!outputBlocks.length) {
    outputBlocks.push("No output.");
  }

  return [
    `Command: ${tokens.join(" ")}`,
    `Exit code: ${result.code ?? "unknown"}${result.timedOut ? " (timed out)" : ""}`,
    outputBlocks.join("\n\n"),
  ].join("\n\n");
}

function captureCpuSnapshot() {
  return os.cpus().map((cpu) => ({ ...cpu.times }));
}

function calculateCpuUsage(start, end) {
  let idleDelta = 0;
  let totalDelta = 0;

  for (let index = 0; index < start.length; index += 1) {
    const startTimes = start[index];
    const endTimes = end[index];
    const startTotal =
      startTimes.user + startTimes.nice + startTimes.sys + startTimes.idle + startTimes.irq;
    const endTotal =
      endTimes.user + endTimes.nice + endTimes.sys + endTimes.idle + endTimes.irq;

    idleDelta += endTimes.idle - startTimes.idle;
    totalDelta += endTotal - startTotal;
  }

  if (totalDelta <= 0) {
    return 0;
  }

  return ((totalDelta - idleDelta) / totalDelta) * 100;
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  if (hours) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

async function buildSystemInfoReport(scope = "summary") {
  const cpuStart = captureCpuSnapshot();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const cpuUsage = calculateCpuUsage(cpuStart, captureCpuSnapshot());
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const usedPercent = totalMemory > 0 ? (usedMemory / totalMemory) * 100 : 0;
  const cpuModel = os.cpus()[0]?.model || "Unknown CPU";
  const cpuSummary = `${cpuUsage.toFixed(1)}% across ${os.cpus().length} logical cores`;
  const memorySummary = `${formatBytes(usedMemory)} used of ${formatBytes(totalMemory)} (${usedPercent.toFixed(1)}%)`;

  if (scope === "cpu") {
    return `CPU usage is about ${cpuSummary}. Processor: ${cpuModel}.`;
  }

  if (scope === "memory") {
    return `Memory usage is ${memorySummary}.`;
  }

  return [
    `System: ${os.hostname()} on ${os.platform()} ${os.release()} (${os.arch()})`,
    `Uptime: ${formatDuration(os.uptime())}`,
    `CPU: ${cpuSummary}`,
    `Memory: ${memorySummary}`,
  ].join("\n");
}

async function openWindowsApp(target) {
  if (target === "spotify_web") {
    await openWebApp(SPOTIFY_WEB_URL);
    return;
  }

  const appCommands = {
    spotify: `
try {
  Start-Process 'spotify:' -ErrorAction Stop
} catch {
  $targetUrl = '${SPOTIFY_WEB_URL}';
  if (Get-Command chrome.exe -ErrorAction SilentlyContinue) {
    Start-Process chrome.exe "--app=$targetUrl"
  } elseif (Get-Command msedge.exe -ErrorAction SilentlyContinue) {
    Start-Process msedge.exe "--app=$targetUrl"
  } else {
    Start-Process $targetUrl
  }
}
`,
    notepad: "Start-Process notepad.exe",
    calculator: "Start-Process calc.exe",
    explorer: "Start-Process explorer.exe",
    chrome: "Start-Process chrome.exe",
    vscode: `
try {
  $codeCommand = Get-Command code -ErrorAction SilentlyContinue;
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\\Microsoft VS Code\\bin\\code.cmd'),
    (Join-Path $env:LOCALAPPDATA 'Programs\\Microsoft VS Code\\Code.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft VS Code\\bin\\code.cmd'),
    (Join-Path $env:ProgramFiles 'Microsoft VS Code\\Code.exe'),
    (Join-Path \${env:ProgramFiles(x86)} 'Microsoft VS Code\\bin\\code.cmd'),
    (Join-Path \${env:ProgramFiles(x86)} 'Microsoft VS Code\\Code.exe')
  ) | Where-Object { $_ -and (Test-Path $_) };
  $resolvedCode = if ($codeCommand) { $codeCommand.Source } else { $candidates | Select-Object -First 1 };
  if (-not $resolvedCode) {
    throw 'VS Code is not installed or the code launcher is unavailable.'
  }
  Start-Process -FilePath $resolvedCode
} catch {
  throw
}
`,
  };

  const command = appCommands[target];
  if (!command) {
    throw new Error(`Unsupported app target: ${target}`);
  }

  await runPowerShell(command);
}

function parseComputerControlRequest(message) {
  if (typeof message !== "string") {
    return null;
  }

  const trimmed = message.trim();
  const normalized = message.toLowerCase().trim();
  const pasteToCodexMatch = trimmed.match(
    /^(paste|write|send)\s+(?:this\s+prompt\s+)?(?:into|to)\s+codex(?:\s+window)?(?:\s+and\s+submit)?\s*[:\-]?\s*([\s\S]+)$/i
  );
  if (pasteToCodexMatch) {
    return {
      type: "paste_to_codex",
      promptText: pasteToCodexMatch[2].trim(),
      submit: /\band submit\b/i.test(trimmed),
    };
  }

  const submitToCodexMatch = trimmed.match(
    /^(submit)\s+(?:this\s+prompt\s+)?(?:into|to)\s+codex(?:\s+window)?\s*[:\-]?\s*([\s\S]+)$/i
  );
  if (submitToCodexMatch) {
    return {
      type: "paste_to_codex",
      promptText: submitToCodexMatch[2].trim(),
      submit: true,
    };
  }

  const wantsSpotifyWeb =
    /\bspotify\s+(?:web|web app|web player)\b|\bweb\s+spotify\b|\bspotify player\b/.test(
      normalized
    );
  const wantsToOpenSpotify =
    /^(open|launch|start)\s+(?:my\s+)?spotify\b/.test(normalized) ||
    /^(open|launch|start)\s+(?:my\s+)?web\s+spotify\b/.test(normalized);

  if (wantsToOpenSpotify) {
    return { type: "open_app", target: wantsSpotifyWeb ? "spotify_web" : "spotify" };
  }

  if (
    /(?:play|resume)\s+(?:music|spotify)|play music on spotify|start spotify music/.test(
      normalized
    )
  ) {
    return { type: "spotify_play", target: wantsSpotifyWeb ? "spotify_web" : "spotify" };
  }

  if (/pause\s+(?:music|spotify)|pause spotify/.test(normalized)) {
    return { type: "spotify_pause", target: wantsSpotifyWeb ? "spotify_web" : "spotify" };
  }

  if (/next\s+(?:song|track)|skip\s+(?:song|track)|spotify next/.test(normalized)) {
    return { type: "media_next", target: wantsSpotifyWeb ? "spotify_web" : "spotify" };
  }

  if (/previous\s+(?:song|track)|back\s+(?:song|track)|spotify previous/.test(normalized)) {
    return { type: "media_previous", target: wantsSpotifyWeb ? "spotify_web" : "spotify" };
  }

  if (/^(open|launch|start)\s+notepad\b/.test(normalized)) {
    return { type: "open_app", target: "notepad" };
  }

  if (/^(open|launch|start)\s+calculator\b/.test(normalized)) {
    return { type: "open_app", target: "calculator" };
  }

  if (/^(open|launch|start)\s+(?:file explorer|explorer)\b/.test(normalized)) {
    return { type: "open_app", target: "explorer" };
  }

  if (/^(open|launch|start)\s+chrome\b/.test(normalized)) {
    return { type: "open_app", target: "chrome" };
  }

  const openCurrentProjectInCodeMatch = normalized.match(
    /^(open|launch|start)\s+(?:this|current)\s+(?:project|folder|directory)\s+in\s+(?:vs\s*code|visual studio code|code)\b/
  );
  if (openCurrentProjectInCodeMatch) {
    return { type: "open_vscode", pathSpec: "this project" };
  }

  const openSpecificInCodeMatch = trimmed.match(
    /^(open|launch|start)\s+(?:project|folder|directory)\s+(.+?)\s+in\s+(?:vs\s*code|visual studio code|code)\s*$/i
  );
  if (openSpecificInCodeMatch) {
    return { type: "open_vscode", pathSpec: openSpecificInCodeMatch[1].trim() };
  }

  if (/^(open|launch|start)\s+(?:vs\s*code|visual studio code|code)\b/.test(normalized)) {
    return { type: "open_app", target: "vscode" };
  }

  if (
    /^(show|display|get)(?:\s+me)?\s+(?:system info(?:rmation)?|computer info(?:rmation)?|system status)\b/.test(
      normalized
    )
  ) {
    return { type: "system_info", scope: "summary" };
  }

  if (
    /\b(?:cpu|processor)\s+(?:usage|status|info(?:rmation)?)\b/.test(normalized) ||
    /^(show|display|get)(?:\s+me)?\s+cpu\b/.test(normalized)
  ) {
    return { type: "system_info", scope: "cpu" };
  }

  if (
    /\b(?:memory|ram)\s+(?:usage|status|info(?:rmation)?)\b/.test(normalized) ||
    /^(show|display|get)(?:\s+me)?\s+(?:memory|ram)\b/.test(normalized)
  ) {
    return { type: "system_info", scope: "memory" };
  }

  const runCommandMatch = trimmed.match(/^(run|execute)\s+(?:command\s+)?(.+)$/i);
  if (runCommandMatch) {
    return { type: "run_command", commandText: runCommandMatch[2].trim() };
  }

  return null;
}

function parseHomeAssistantRequest(message) {
  if (typeof message !== "string") {
    return null;
  }

  const trimmed = message.trim();

  const statusMatch = trimmed.match(
    /^(?:home assistant|ha)\s+(?:status|state|show state of|get state of)\s+([a-z0-9_]+\.[a-z0-9_]+)\s*$/i
  );
  if (statusMatch) {
    return { type: "home_assistant_state", entityId: statusMatch[1].toLowerCase() };
  }

  const listMatch = trimmed.match(
    /^(?:home assistant|ha)\s+(?:list|show)\s+(lights|switches|covers|locks|sensors|binary sensors|scenes|scripts)\s*$/i
  );
  if (listMatch) {
    const domainMap = {
      lights: "light",
      switches: "switch",
      covers: "cover",
      locks: "lock",
      sensors: "sensor",
      "binary sensors": "binary_sensor",
      scenes: "scene",
      scripts: "script",
    };

    return {
      type: "home_assistant_list",
      domain: domainMap[listMatch[1].toLowerCase()] || listMatch[1].toLowerCase(),
    };
  }

  const serviceMatch = trimmed.match(
    /^(?:home assistant|ha)\s+(?:call|service)\s+([a-z0-9_]+)\.([a-z0-9_]+)(?:\s+(?:with|for)\s+([\s\S]+))?\s*$/i
  );
  if (serviceMatch) {
    return {
      type: "home_assistant_service",
      domain: serviceMatch[1].toLowerCase(),
      service: serviceMatch[2].toLowerCase(),
      data: serviceMatch[3] || "",
    };
  }

  const turnMatch = trimmed.match(
    /^(?:home assistant|ha)\s+(turn on|turn off|toggle)\s+([a-z0-9_]+\.[a-z0-9_]+)\s*$/i
  );
  if (turnMatch) {
    const serviceMap = {
      "turn on": "turn_on",
      "turn off": "turn_off",
      toggle: "toggle",
    };
    const entityId = turnMatch[2].toLowerCase();

    return {
      type: "home_assistant_service",
      domain: entityId.split(".")[0],
      service: serviceMap[turnMatch[1].toLowerCase()],
      data: JSON.stringify({ entity_id: entityId }),
    };
  }

  const activateMatch = trimmed.match(
    /^(?:home assistant|ha)\s+activate\s+([a-z0-9_]+\.[a-z0-9_]+)\s*$/i
  );
  if (activateMatch) {
    const entityId = activateMatch[1].toLowerCase();
    return {
      type: "home_assistant_service",
      domain: entityId.split(".")[0],
      service: "turn_on",
      data: JSON.stringify({ entity_id: entityId }),
    };
  }

  const playRadioMatch = trimmed.match(
    /^(?:home assistant|ha)\s+play\s+(?:radio|station)\s+(.+?)(?:\s+on\s+([a-z0-9_]+\.[a-z0-9_]+))?\s*$/i
  );
  if (playRadioMatch) {
    return {
      type: "home_assistant_radio_play",
      query: playRadioMatch[1].trim(),
      entityId: playRadioMatch[2]?.toLowerCase() || "",
    };
  }

  const radioSearchMatch = trimmed.match(
    /^(?:home assistant|ha)\s+(?:find|search)\s+(?:radio|station)\s+(.+)\s*$/i
  );
  if (radioSearchMatch) {
    return {
      type: "home_assistant_radio_search",
      query: radioSearchMatch[1].trim(),
    };
  }

  return null;
}

async function executeComputerControl(action) {
  switch (action.type) {
    case "open_app":
      await openWindowsApp(action.target);
      return action.target === "spotify_web"
        ? "I opened Spotify Web."
        : action.target === "vscode"
          ? "I opened VS Code."
        : `I opened ${action.target}.`;
    case "open_vscode": {
      const resolvedPath = await openVsCode(action.pathSpec || "");
      return resolvedPath
        ? `I opened ${resolvedPath} in VS Code.`
        : "I opened VS Code.";
    }
    case "spotify_play":
      if (action.target === "spotify_web") {
        await controlSpotifyWebPlayback("play");
        return "I opened Spotify Web, focused the player window, and retried the play command.";
      }
      await openWindowsApp(action.target || "spotify");
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await sendMediaKey("0xB3");
      return "I opened Spotify and sent the play command.";
    case "spotify_pause":
      if (action.target === "spotify_web") {
        await controlSpotifyWebPlayback("pause");
        return "I focused Spotify Web and sent the pause command.";
      }
      await sendMediaKey("0xB3");
      return "I sent the Spotify play or pause media command.";
    case "media_next":
      if (action.target === "spotify_web") {
        await controlSpotifyWebPlayback("next");
        return "I focused Spotify Web and skipped to the next track.";
      }
      await sendMediaKey("0xB0");
      return "I skipped to the next track.";
    case "media_previous":
      if (action.target === "spotify_web") {
        await controlSpotifyWebPlayback("previous");
        return "I focused Spotify Web and went back to the previous track.";
      }
      await sendMediaKey("0xB1");
      return "I went back to the previous track.";
    case "run_command":
      return await runDeveloperCommand(action.commandText);
    case "system_info":
      return await buildSystemInfoReport(action.scope);
    case "paste_to_codex": {
      const targetWindowTitle = await pasteIntoCodexWindow(
        action.promptText,
        action.submit === true
      );
      return action.submit === true
        ? `I pasted the prompt into ${targetWindowTitle} and submitted it.`
        : `I pasted the prompt into ${targetWindowTitle}.`;
    }
    case "home_assistant_state": {
      const state = await getHomeAssistantState(action.entityId);
      const attributes = state?.attributes || {};
      const friendlyName = attributes.friendly_name || action.entityId;
      const details = [];

      if (attributes.unit_of_measurement) {
        details.push(`${state.state} ${attributes.unit_of_measurement}`.trim());
      } else {
        details.push(String(state.state || "unknown"));
      }

      if (attributes.current_temperature !== undefined) {
        details.push(`current temperature ${attributes.current_temperature}`);
      }

      return `${friendlyName} is ${details.join(", ")}.`;
    }
    case "home_assistant_list": {
      const entities = await listHomeAssistantEntities(action.domain);
      if (!entities.length) {
        return `I couldn't find any ${action.domain} entities in Home Assistant.`;
      }

      const summary = entities
        .map((entity) => {
          const friendlyName = entity?.attributes?.friendly_name || entity.entity_id;
          return `${friendlyName} (${entity.entity_id}) is ${entity.state}`;
        })
        .join("\n");

      return summary;
    }
    case "home_assistant_service": {
      const data = parseHomeAssistantDataInput(action.data);
      await callHomeAssistantService(action.domain, action.service, data);
      return `I called Home Assistant service ${action.domain}.${action.service}.`;
    }
    case "home_assistant_radio_search": {
      const stations = await searchRadioBrowserStations(action.query);
      if (!stations.length) {
        return `I couldn't find a Radio Browser station for "${action.query}".`;
      }

      return stations
        .map((station, index) => {
          const stationName = station.name || `Station ${index + 1}`;
          const extras = [station.country, station.language, station.codec]
            .filter(Boolean)
            .join(", ");
          return `${index + 1}. ${stationName}${extras ? ` (${extras})` : ""}`;
        })
        .join("\n");
    }
    case "home_assistant_radio_play": {
      const stations = await searchRadioBrowserStations(action.query);
      if (!stations.length) {
        return `I couldn't find a Radio Browser station for "${action.query}".`;
      }

      const station = stations[0];
      const mediaPlayerEntityId =
        action.entityId || homeAssistantConfig.defaultMediaPlayer || "";

      if (!mediaPlayerEntityId) {
        throw new Error(
          "No Home Assistant media player is configured. Set a default media player or say the player entity, for example: Home Assistant play radio Jazz FM on media_player.living_room."
        );
      }

      await callHomeAssistantService("media_player", "play_media", {
        entity_id: mediaPlayerEntityId,
        media_content_id: buildRadioBrowserMediaSource(station.stationuuid),
        media_content_type: "audio/mpeg",
        extra: {
          title: station.name || action.query,
        },
      });

      const stationName = station.name || action.query;
      return `I started ${stationName} on ${mediaPlayerEntityId} through Home Assistant Radio Browser.`;
    }
    default:
      throw new Error("Unsupported computer control action.");
  }
}

function wrapBase64(value, lineLength = 76) {
  return value.match(new RegExp(`.{1,${lineLength}}`, "g"))?.join("\r\n") || "";
}

function encodeMimeHeader(value) {
  if (!value) {
    return "";
  }

  return /[^\x20-\x7E]/.test(value)
    ? `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`
    : value;
}

function buildSmtpMessage({ to, subject, body, from }) {
  const messageId = `<${crypto.randomUUID()}@local-assistant>`;
  const encodedBody = wrapBase64(Buffer.from(body || "", "utf8").toString("base64"));

  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encodedBody,
  ].join("\r\n");
}

function createSmtpConnection({ host, port }): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
      },
      () => {
        resolve(socket);
      }
    );

    socket.once("error", reject);
  });
}

function createSmtpResponseReader(socket) {
  let buffer = "";
  let currentLines = [];
  let currentCode = "";
  const pending = [];
  const completed = [];

  function resolveResponse(response) {
    if (pending.length) {
      const next = pending.shift();
      next.resolve(response);
      return;
    }

    completed.push(response);
  }

  function rejectPending(error) {
    while (pending.length) {
      pending.shift().reject(error);
    }
  }

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");

    while (buffer.includes("\r\n")) {
      const delimiterIndex = buffer.indexOf("\r\n");
      const line = buffer.slice(0, delimiterIndex);
      buffer = buffer.slice(delimiterIndex + 2);

      const match = line.match(/^(\d{3})([ -])(.*)$/);
      if (!match) {
        continue;
      }

      const [, code, separator] = match;
      if (!currentCode) {
        currentCode = code;
      }

      currentLines.push(line);

      if (separator === " ") {
        resolveResponse({
          code: Number(code),
          lines: [...currentLines],
        });
        currentLines = [];
        currentCode = "";
      }
    }
  });

  socket.on("error", rejectPending);
  socket.on("close", () => {
    rejectPending(new Error("SMTP connection closed unexpectedly."));
  });

  function read(timeoutMs = 10000) {
    if (completed.length) {
      return Promise.resolve(completed.shift());
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Timed out waiting for SMTP response."));
      }, timeoutMs);

      pending.push({
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  return { read };
}

function assertSmtpCode(response, expectedCodes, step) {
  if (expectedCodes.includes(response.code)) {
    return;
  }

  throw new Error(`SMTP ${step} failed with ${response.lines.join(" | ")}`);
}

async function sendSmtpEmail({ to, subject, body }) {
  if (!smtpConfig.user || !smtpConfig.pass || !smtpConfig.from) {
    throw new Error(
      "SMTP is not fully configured. Set SMTP_USER, SMTP_PASS, and SMTP_FROM."
    );
  }

  const socket = await createSmtpConnection({
    host: smtpConfig.host,
    port: smtpConfig.port,
  });
  const reader = createSmtpResponseReader(socket);

  const sendLine = (line) => {
    socket.write(`${line}\r\n`);
  };

  const dataMessage = buildSmtpMessage({
    to,
    subject,
    body,
    from: smtpConfig.from,
  })
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");

  try {
    assertSmtpCode(await reader.read(), [220], "greeting");

    sendLine("EHLO localhost");
    assertSmtpCode(await reader.read(), [250], "EHLO");

    sendLine("AUTH LOGIN");
    assertSmtpCode(await reader.read(), [334], "AUTH LOGIN");

    sendLine(Buffer.from(smtpConfig.user, "utf8").toString("base64"));
    assertSmtpCode(await reader.read(), [334], "username");

    sendLine(Buffer.from(smtpConfig.pass, "utf8").toString("base64"));
    assertSmtpCode(await reader.read(), [235], "password");

    sendLine(`MAIL FROM:<${smtpConfig.from}>`);
    assertSmtpCode(await reader.read(), [250], "MAIL FROM");

    for (const recipient of to.split(",").map((entry) => entry.trim()).filter(Boolean)) {
      sendLine(`RCPT TO:<${recipient}>`);
      assertSmtpCode(await reader.read(), [250, 251], `RCPT TO ${recipient}`);
    }

    sendLine("DATA");
    assertSmtpCode(await reader.read(), [354], "DATA");

    socket.write(`${dataMessage}\r\n.\r\n`);
    assertSmtpCode(await reader.read(), [250], "message body");

    sendLine("QUIT");
    await reader.read().catch(() => null);
  } finally {
    socket.end();
    socket.destroySoon?.();
  }
}

async function fetchHomeAssistant(pathname, options: any = {}) {
  if (!homeAssistantConfig.baseUrl || !homeAssistantConfig.token) {
    throw new Error(
      "Home Assistant is not configured. Set the base URL and a long-lived access token first."
    );
  }

  const response = await fetch(`${homeAssistantConfig.baseUrl}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${homeAssistantConfig.token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const contentType = response.headers.get("content-type") || "";
  const rawBody = await response.text();
  let payload: any = rawBody;

  if (rawBody && contentType.includes("application/json")) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      if (looksLikeHtmlDocument(rawBody)) {
        throw new Error(
          "Home Assistant returned an HTML page instead of API JSON. Check that the saved base URL points to your Home Assistant instance root, for example http://homeassistant.local:8123, not a dashboard, reverse-proxy login page, or other web page."
        );
      }

      throw new Error(
        "Home Assistant returned invalid JSON. Check the base URL and confirm the API is reachable."
      );
    }
  } else if (looksLikeHtmlDocument(rawBody)) {
    throw new Error(
      "Home Assistant returned an HTML page instead of API JSON. Check that the saved base URL points to your Home Assistant instance root, for example http://homeassistant.local:8123, not a dashboard, reverse-proxy login page, or other web page."
    );
  }

  if (!response.ok) {
    const errorMessage =
      typeof payload === "string"
        ? payload.slice(0, 240).trim() || `Home Assistant request failed with status ${response.status}.`
        : payload?.message || payload?.error || "Home Assistant request failed.";
    throw new Error(errorMessage);
  }

  return payload;
}

async function getHomeAssistantState(entityId) {
  return await fetchHomeAssistant(`/api/states/${encodeURIComponent(entityId)}`, {
    method: "GET",
  });
}

async function listHomeAssistantEntities(domain) {
  const states = await fetchHomeAssistant("/api/states", { method: "GET" });
  const normalizedDomain = String(domain || "").toLowerCase();

  return (Array.isArray(states) ? states : [])
    .filter((entry) => String(entry?.entity_id || "").startsWith(`${normalizedDomain}.`))
    .slice(0, 12);
}

async function callHomeAssistantService(domain, service, data = {}) {
  return await fetchHomeAssistant(`/api/services/${domain}/${service}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

async function searchRadioBrowserStations(query) {
  const trimmedQuery = String(query || "").trim();
  if (!trimmedQuery) {
    return [];
  }

  const params = new URLSearchParams({
    name: trimmedQuery,
    limit: "5",
    hidebroken: "true",
    order: "votes",
    reverse: "true",
  });
  const response = await fetch(
    `${RADIO_BROWSER_API_BASE_URL}/stations/search?${params.toString()}`
  );
  const payload = await response.json();

  if (!response.ok) {
    throw new Error("Radio Browser search failed.");
  }

  return Array.isArray(payload) ? payload : [];
}

function buildRadioBrowserMediaSource(stationUuid) {
  return `media-source://radio_browser/${stationUuid}`;
}

function parseHomeAssistantDataInput(rawValue) {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    if (/^[a-z0-9_]+\.[a-z0-9_]+$/i.test(trimmed)) {
      return { entity_id: trimmed };
    }

    throw new Error(
      "Home Assistant service data must be valid JSON or a single entity id like light.kitchen."
    );
  }
}

async function searchInternet(query) {
  const trimmedQuery = typeof query === "string" ? query.trim() : "";

  if (!trimmedQuery) {
    return [];
  }

  const errors = [];

  try {
    const html = await fetchDuckDuckGoSearchPage(
      DUCKDUCKGO_HTML_SEARCH_URL,
      trimmedQuery
    );
    const htmlSources = parseDuckDuckGoHtmlResults(html);

    if (htmlSources.length) {
      return htmlSources;
    }
  } catch (error) {
    errors.push(error);
  }

  try {
    const liteHtml = await fetchDuckDuckGoSearchPage(
      DUCKDUCKGO_LITE_SEARCH_URL,
      trimmedQuery
    );
    const liteSources = parseDuckDuckGoLiteResults(liteHtml);

    if (liteSources.length) {
      return liteSources;
    }
  } catch (error) {
    errors.push(error);
  }

  if (errors.length) {
    throw new Error(errors.map((error) => error.message).join(" "));
  }

  return [];
}

function toUiModelList(payload) {
  const models = Array.isArray(payload?.data) ? payload.data : [];
  return models.map((model) => ({
    id: model.id,
    object: model.object,
    kind: /embed/i.test(model.id)
      ? "embedding"
      : /tts/i.test(model.id)
        ? "tts"
        : "chat",
  }));
}

function pickDefaultSpeechModel(models) {
  return (
    models.find((model) => model.id === DEFAULT_SPEECH_MODEL)?.id ||
    models.find((model) => model.kind === "tts")?.id ||
    null
  );
}

function pickDefaultChatModel(models) {
  const rankedModels = [...models].sort((left, right) => {
    const leftScore = scoreChatModel(left.id);
    const rightScore = scoreChatModel(right.id);
    return rightScore - leftScore;
  });

  return rankedModels.find((model) => model.kind === "chat")?.id || models[0]?.id || null;
}

function scoreChatModel(modelId) {
  const id = modelId.toLowerCase();
  let score = 0;

  if (/instruct|assistant|chat/.test(id)) {
    score += 20;
  }

  if (/llama|mistral|qwen/.test(id)) {
    score += 5;
  }

  if (/reason|r1|deepseek-r1/.test(id)) {
    score -= 30;
  }

  if (/embed|tts/.test(id)) {
    score -= 100;
  }

  return score;
}

async function fetchLmStudio(pathname, options: any = {}) {
  const url = `${lmStudioBaseUrl}${pathname}`;
  const requestOptions = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  };
  let lastError: any = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, requestOptions);

      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await response.json()
        : await response.text();

      if (!response.ok) {
        const errorMessage =
          typeof payload === "string"
            ? payload
            : payload?.error?.message || "LM Studio request failed.";

        throw new Error(errorMessage);
      }

      return payload;
    } catch (error: any) {
      lastError = error;

      if (attempt === 0 && shouldRetryLmStudioFetch(error)) {
        await delay(250);
        continue;
      }

      throw new Error(formatLmStudioFetchError(url, error));
    }
  }

  throw new Error(formatLmStudioFetchError(url, lastError));
}

function shouldRetryLmStudioFetch(error: any) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("socket hang up") ||
    message.includes("other side closed")
  );
}

function formatLmStudioFetchError(url: string, error: any) {
  const rawMessage = String(error?.message || "Unknown LM Studio error");
  const lowerMessage = rawMessage.toLowerCase();

  if (
    lowerMessage.includes("fetch failed") ||
    lowerMessage.includes("econnrefused") ||
    lowerMessage.includes("connect") ||
    lowerMessage.includes("socket hang up") ||
    lowerMessage.includes("other side closed")
  ) {
    return `Could not reach LM Studio at ${url}. Confirm the LM Studio Developer Server is running and that the saved endpoint is correct. Original error: ${rawMessage}`;
  }

  return rawMessage;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTranscriptionService(pathname: string, options: any = {}) {
  const url = `${transcriptionConfig.baseUrl}${pathname}`;
  const authorizationHeader = transcriptionConfig.apiKey
    ? { Authorization: `Bearer ${transcriptionConfig.apiKey}` }
    : {};
  let lastError: any = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...authorizationHeader,
          ...(options.headers || {}),
        },
      });
      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await response.json()
        : await response.text();

      if (!response.ok) {
        const errorMessage =
          typeof payload === "string"
            ? payload
            : payload?.error?.message ||
              payload?.message ||
              "Transcription request failed.";

        throw new Error(errorMessage);
      }

      return payload;
    } catch (error: any) {
      lastError = error;

      if (attempt === 0 && shouldRetryTranscriptionFetch(error)) {
        await delay(250);
        continue;
      }

      throw new Error(formatTranscriptionFetchError(url, error));
    }
  }

  throw new Error(formatTranscriptionFetchError(url, lastError));
}

function shouldRetryTranscriptionFetch(error: any) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("etimedout") ||
    message.includes("socket hang up") ||
    message.includes("other side closed")
  );
}

function formatTranscriptionFetchError(url: string, error: any) {
  const rawMessage = String(error?.message || "Unknown transcription error");
  const lowerMessage = rawMessage.toLowerCase();

  if (
    lowerMessage.includes("fetch failed") ||
    lowerMessage.includes("econnrefused") ||
    lowerMessage.includes("connect") ||
    lowerMessage.includes("socket hang up") ||
    lowerMessage.includes("other side closed")
  ) {
    return `Could not reach the transcription service at ${url}. Confirm LocalAI or your OpenAI-compatible speech-to-text server is running and that the saved transcription base URL is correct. Original error: ${rawMessage}`;
  }

  return rawMessage;
}

function normalizeScrapeUrl(value) {
  const rawValue = typeof value === "string" ? value.trim() : "";

  if (!rawValue) {
    return "";
  }

  const normalizedValue = /^[a-z]+:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`;

  try {
    const parsed = new URL(normalizedValue);

    if (!/^https?:$/i.test(parsed.protocol)) {
      return "";
    }

    return parsed.toString();
  } catch {
    return "";
  }
}

function stripHtmlNoise(html) {
  if (typeof html !== "string" || !html) {
    return "";
  }

  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function truncateText(value, maxLength = 240) {
  const text = normalizeWhitespace(String(value || ""));

  if (!text || text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function extractMetaContent(html, matcher) {
  const source = String(html || "");
  const patterns = [
    new RegExp(
      `<meta[^>]+${matcher}[^>]+content=["']([^"']+)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+${matcher}[^>]*>`,
      "i"
    ),
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);

    if (match?.[1]) {
      return cleanSearchText(match[1]);
    }
  }

  return "";
}

function extractTagTextList(html, tagName, limit = 5) {
  const source = stripHtmlNoise(html);
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  const results = [];
  let match;

  while ((match = pattern.exec(source)) !== null && results.length < limit) {
    const text = cleanSearchText(match[1]);

    if (text) {
      results.push(text);
    }
  }

  return results;
}

function extractHeadingList(html, limit = 8) {
  const source = stripHtmlNoise(html);
  const pattern = /<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const results = [];
  let match;

  while ((match = pattern.exec(source)) !== null && results.length < limit) {
    const text = cleanSearchText(match[2]);

    if (!text) {
      continue;
    }

    results.push({
      level: match[1].toLowerCase(),
      text,
    });
  }

  return results;
}

function resolveAbsoluteUrl(rawUrl, baseUrl) {
  const href = decodeHtmlEntities(String(rawUrl || "").trim());

  if (!href || href.startsWith("#") || /^javascript:/i.test(href)) {
    return "";
  }

  try {
    const resolvedUrl = new URL(href, baseUrl);

    if (!/^https?:$/i.test(resolvedUrl.protocol)) {
      return "";
    }

    return resolvedUrl.toString();
  } catch {
    return "";
  }
}

function extractLinkList(html, baseUrl, limit = 12) {
  const source = stripHtmlNoise(html);
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const results = [];
  const seenUrls = new Set();
  let match;

  while ((match = pattern.exec(source)) !== null && results.length < limit) {
    const url = resolveAbsoluteUrl(match[1], baseUrl);
    const text = cleanSearchText(match[2]) || url;

    if (!url || seenUrls.has(url)) {
      continue;
    }

    seenUrls.add(url);
    results.push({ text, url });
  }

  return results;
}

function extractImageList(html, baseUrl, limit = 8) {
  const source = stripHtmlNoise(html);
  const pattern = /<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
  const results = [];
  const seenUrls = new Set();
  let match;

  while ((match = pattern.exec(source)) !== null && results.length < limit) {
    const tag = match[0] || "";
    const url = resolveAbsoluteUrl(match[1], baseUrl);
    const altMatch = tag.match(/\balt=["']([^"']*)["']/i);
    const alt = cleanSearchText(altMatch?.[1] || "");

    if (!url || seenUrls.has(url)) {
      continue;
    }

    seenUrls.add(url);
    results.push({ alt, url });
  }

  return results;
}

function extractCanonicalUrl(html, baseUrl) {
  const source = String(html || "");
  const match = source.match(/<link\b[^>]*rel=["'][^"']*canonical[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/i);

  if (!match?.[1]) {
    return "";
  }

  return resolveAbsoluteUrl(match[1], baseUrl);
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeSchemaToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^.*[\/#]/, "");
}

function flattenJsonLdNodes(node, results = []) {
  if (!node) {
    return results;
  }

  if (Array.isArray(node)) {
    node.forEach((entry) => flattenJsonLdNodes(entry, results));
    return results;
  }

  if (typeof node !== "object") {
    return results;
  }

  results.push(node);

  if (Array.isArray(node["@graph"])) {
    flattenJsonLdNodes(node["@graph"], results);
  }

  return results;
}

function readSchemaTypes(node) {
  const typeValue = node?.["@type"];

  if (Array.isArray(typeValue)) {
    return typeValue.map(normalizeSchemaToken);
  }

  if (typeof typeValue === "string") {
    return [normalizeSchemaToken(typeValue)];
  }

  return [];
}

function extractJsonLdNodes(html) {
  const source = String(html || "");
  const pattern =
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const nodes = [];
  let match;

  while ((match = pattern.exec(source)) !== null) {
    const payload = safeJsonParse(match[1]?.trim());

    if (!payload) {
      continue;
    }

    flattenJsonLdNodes(payload, nodes);
  }

  return nodes;
}

function extractItemPropContent(html, propName) {
  const source = String(html || "");
  const patterns = [
    new RegExp(
      `<meta[^>]+itemprop=["']${propName}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<[^>]+itemprop=["']${propName}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<[^>]+itemprop=["']${propName}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`,
      "i"
    ),
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);

    if (match?.[1]) {
      return cleanSearchText(match[1]);
    }
  }

  return "";
}

function normalizePriceAmount(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const rawValue = String(value).replace(/,/g, "").trim();
  const numberMatch = rawValue.match(/-?\d+(?:\.\d+)?/);

  if (!numberMatch) {
    return "";
  }

  const amount = Number.parseFloat(numberMatch[0]);

  if (!Number.isFinite(amount)) {
    return "";
  }

  return amount.toFixed(amount % 1 === 0 ? 0 : 2);
}

function normalizeCurrencyCode(value) {
  const rawValue = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(rawValue) ? rawValue : "";
}

function formatProductPrice(amount, currency) {
  const normalizedAmount = normalizePriceAmount(amount);
  const normalizedCurrency = normalizeCurrencyCode(currency);

  if (!normalizedAmount) {
    return "";
  }

  if (normalizedCurrency) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: normalizedCurrency,
      }).format(Number.parseFloat(normalizedAmount));
    } catch {
      return `${normalizedCurrency} ${normalizedAmount}`;
    }
  }

  return normalizedAmount;
}

function extractPriceFromText(value) {
  const text = String(value || "");
  const directMatch = text.match(
    /\b(?:USD|EUR|GBP|CAD|AUD|JPY)\s?\d{1,3}(?:[,\d]{0,12})(?:\.\d{2})?|\$\s?\d{1,3}(?:[,\d]{0,12})(?:\.\d{2})?|€\s?\d{1,3}(?:[,\d]{0,12})(?:\.\d{2})?|£\s?\d{1,3}(?:[,\d]{0,12})(?:\.\d{2})?/i
  );

  return directMatch ? normalizeWhitespace(directMatch[0]) : "";
}

function findProductJsonLdNode(html) {
  const jsonLdNodes = extractJsonLdNodes(html);

  return (
    jsonLdNodes.find((node) => readSchemaTypes(node).includes("product")) || null
  );
}

function readOfferNode(productNode) {
  const offers = productNode?.offers;

  if (Array.isArray(offers)) {
    return offers.find((entry) => entry && typeof entry === "object") || null;
  }

  return offers && typeof offers === "object" ? offers : null;
}

function extractProductDetails({
  html,
  baseUrl,
  title,
  description,
  headings,
  paragraphs,
  plainText,
}) {
  const productNode = findProductJsonLdNode(html);
  const offerNode = readOfferNode(productNode);
  const metaPriceAmount =
    extractMetaContent(html, 'property=["\']product:price:amount["\']') ||
    extractMetaContent(html, 'property=["\']og:price:amount["\']') ||
    extractItemPropContent(html, "price");
  const metaCurrency =
    extractMetaContent(html, 'property=["\']product:price:currency["\']') ||
    extractMetaContent(html, 'property=["\']og:price:currency["\']') ||
    extractItemPropContent(html, "priceCurrency");
  const normalizedAmount =
    normalizePriceAmount(offerNode?.price) || normalizePriceAmount(metaPriceAmount);
  const normalizedCurrency =
    normalizeCurrencyCode(offerNode?.priceCurrency) ||
    normalizeCurrencyCode(metaCurrency);
  const formattedPrice =
    formatProductPrice(normalizedAmount, normalizedCurrency) ||
    extractPriceFromText(plainText);
  const productName =
    cleanSearchText(productNode?.name || "") ||
    extractItemPropContent(html, "name") ||
    headings?.[0]?.text ||
    title;
  const productDescription =
    cleanSearchText(productNode?.description || "") ||
    extractItemPropContent(html, "description") ||
    description ||
    paragraphs?.[0] ||
    "";
  const availability =
    cleanSearchText(offerNode?.availability || "") ||
    extractItemPropContent(html, "availability");
  const brand =
    cleanSearchText(productNode?.brand?.name || productNode?.brand || "") ||
    extractItemPropContent(html, "brand");
  const imageUrl = resolveAbsoluteUrl(
    productNode?.image?.[0] || productNode?.image || extractItemPropContent(html, "image"),
    baseUrl
  );

  const hasProductSignal = Boolean(
    productNode ||
      normalizedAmount ||
      formattedPrice ||
      extractMetaContent(html, 'property=["\']product:price:amount["\']') ||
      extractItemPropContent(html, "price")
  );

  return {
    isProductLike: hasProductSignal,
    name: productName || "",
    description: productDescription || "",
    price: formattedPrice || "",
    priceAmount: normalizedAmount || "",
    priceCurrency: normalizedCurrency || "",
    availability: availability || "",
    brand: brand || "",
    imageUrl: imageUrl || "",
    source: productNode ? "json-ld" : hasProductSignal ? "meta-or-heuristic" : "generic",
  };
}

function extractBodyText(html) {
  const cleanedHtml = stripHtmlNoise(html);
  const paragraphText = extractTagTextList(cleanedHtml, "p", 12);

  if (paragraphText.length) {
    return paragraphText;
  }

  const bodyMatch = cleanedHtml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const bodyText = cleanSearchText(bodyMatch?.[1] || cleanedHtml);

  if (!bodyText) {
    return [];
  }

  return bodyText
    .split(/(?<=[.!?])\s+/)
    .map((entry) => normalizeWhitespace(entry))
    .filter(Boolean)
    .slice(0, 12);
}

function countWordsInEntries(entries) {
  return entries
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
}

async function fetchScrapePayload(targetUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    });
    const html = await response.text();

    return { response, html };
  } finally {
    clearTimeout(timeout);
  }
}

function createResult(status, body) {
  return { status, body };
}

async function scrapeWebpageForAgent(url) {
  const result = await postScrapeResult({ url });

  if (result.status !== 200 || !result.body?.scrape) {
    throw new Error(result.body?.details || result.body?.error || "Web scraping failed.");
  }

  const scrape = result.body.scrape;
  const snippet = scrape.excerpt || scrape.description || "";

  return {
    result: `Scraped ${scrape.finalUrl} and extracted page details from "${scrape.title}".`,
    scrape,
    source: {
      title: scrape.title,
      url: scrape.finalUrl,
      snippet,
    },
  };
}

function rememberAgentMemory(text, tags = [], source = "agent") {
  const entry = getAgentGateway().rememberMemory({
    text,
    tags,
    source,
  });

  return {
    result: `Saved memory "${entry.text}"${entry.tags.length ? ` with tags ${entry.tags.join(", ")}.` : "."}`,
    entry,
  };
}

function recallAgentMemories(query, limit = 5) {
  const items = getAgentGateway().recallMemory(query, limit);

  return {
    result: items.length
      ? `Found ${items.length} memory item${items.length === 1 ? "" : "s"} related to "${query}".`
      : `No stored memory matched "${query}".`,
    items,
  };
}

function writeAgentJsonRecord(kind, label, data) {
  const record = getAgentGateway().writeJsonRecord({
    kind,
    label,
    data,
  });

  return {
    result: `Saved a ${record.kind} record to ${record.relativePath}.`,
    record,
  };
}

export async function postScrapeResult(body) {
  try {
    const requestedUrl = normalizeScrapeUrl(body?.url);

    if (!requestedUrl) {
      return createResult(400, {
        error: "A valid http or https URL is required for scraping.",
      });
    }

    const { response, html } = await fetchScrapePayload(requestedUrl);
    const finalUrl = normalizeScrapeUrl(response.url) || requestedUrl;
    const contentType = response.headers.get("content-type") || "";
    const title =
      extractTagTextList(html, "title", 1)[0] ||
      extractMetaContent(html, 'property=["\']og:title["\']') ||
      "Untitled page";
    const description =
      extractMetaContent(html, 'name=["\']description["\']') ||
      extractMetaContent(html, 'property=["\']og:description["\']');
    const headings = extractHeadingList(html, 8);
    const paragraphs = extractBodyText(html).slice(0, 8);
    const links = extractLinkList(html, finalUrl, 12);
    const images = extractImageList(html, finalUrl, 8);
    const canonicalUrl = extractCanonicalUrl(html, finalUrl) || finalUrl;
    const plainText = cleanSearchText(stripHtmlNoise(html));
    const wordCount = countWordsInEntries(paragraphs.length ? paragraphs : [plainText]);
    const product = extractProductDetails({
      html,
      baseUrl: finalUrl,
      title,
      description,
      headings,
      paragraphs,
      plainText,
    });
    const scrape = {
      requestedUrl,
      finalUrl,
      canonicalUrl,
      title,
      description,
      product,
      fetchedAt: new Date().toISOString(),
      status: response.status,
      ok: response.ok,
      contentType,
      wordCount,
      headings,
      paragraphs,
      links,
      images,
      excerpt: truncateText(paragraphs[0] || plainText, 320),
      counts: {
        headings: headings.length,
        paragraphs: paragraphs.length,
        links: links.length,
        images: images.length,
      },
    };

    return createResult(200, {
      message: `Scraped ${scrape.finalUrl} successfully.`,
      scrape,
    });
  } catch (error) {
    return createResult(502, {
      error: "Web scraping failed.",
      details: error.name === "AbortError" ? "The page took too long to respond." : error.message,
    });
  }
}

export async function getModelsResult() {
  try {
    const payload = await fetchLmStudio("/v1/models", { method: "GET" });
    const models = toUiModelList(payload);

    return createResult(200, {
      baseUrl: lmStudioBaseUrl,
      defaultModel: pickDefaultChatModel(models),
      defaultSpeechModel: pickDefaultSpeechModel(models),
      models,
    });
  } catch (error) {
    return createResult(502, {
      error: "Could not reach the LM Studio server.",
      details: error.message,
    });
  }
}

export async function postSpeakResult(body) {
  try {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const model =
      typeof body.model === "string" && body.model.trim()
        ? body.model.trim()
        : DEFAULT_SPEECH_MODEL;

    if (!text) {
      return createResult(400, { error: "Speech text is required." });
    }

    const payload = await fetchLmStudio("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model,
        messages: buildSpeechPolishMessages(text),
        temperature: 0.1,
        max_tokens: Math.min(180, Math.max(80, Math.ceil(text.length / 2))),
      }),
    });

    const rawContent = payload?.choices?.[0]?.message?.content || "";
    const spokenText = stripReasoningBlocks(rawContent) || text;

    return createResult(200, {
      text: spokenText,
      model,
      enhanced: spokenText !== text,
    });
  } catch (error) {
    return createResult(502, {
      error: "Speech preparation failed.",
      details: error.message,
    });
  }
}

export async function postMediaTranscriptionResult(formData: FormData) {
  try {
    const file = formData.get("file");
    const requestedLanguage = formData.get("language");
    const requestedPrompt = formData.get("prompt");
    const language =
      typeof requestedLanguage === "string" && requestedLanguage.trim()
        ? requestedLanguage.trim()
        : transcriptionConfig.language;
    const prompt =
      typeof requestedPrompt === "string" && requestedPrompt.trim()
        ? requestedPrompt.trim()
        : "";

    if (!(file instanceof File)) {
      return createResult(400, { error: "An audio or video file is required." });
    }

    if (!transcriptionConfig.baseUrl || !transcriptionConfig.model) {
      return createResult(400, {
        error:
          "Transcription is not configured yet. Save a transcription API base URL and model first.",
      });
    }

    const upstreamForm = new FormData();
    upstreamForm.append("file", file, file.name || "screen-capture.webm");
    upstreamForm.append("model", transcriptionConfig.model);

    if (language) {
      upstreamForm.append("language", language);
    }

    if (prompt) {
      upstreamForm.append("prompt", prompt);
    }

    const payload = await fetchTranscriptionService("/audio/transcriptions", {
      method: "POST",
      body: upstreamForm,
    });

    const text =
      typeof payload === "string"
        ? payload.trim()
        : typeof payload?.text === "string"
          ? payload.text.trim()
          : typeof payload?.transcript === "string"
            ? payload.transcript.trim()
            : "";

    if (!text) {
      return createResult(502, {
        error: "The transcription service returned an empty transcript.",
      });
    }

    return createResult(200, {
      text,
      model: transcriptionConfig.model,
      language: language || null,
      fileName: file.name || "screen-capture.webm",
    });
  } catch (error) {
    return createResult(502, {
      error: "Media transcription failed.",
      details: error.message,
    });
  }
}

async function executeAgentToolCall(toolCall, options) {
  const toolName = toolCall?.function?.name || "";
  const args = parseJsonObject(toolCall?.function?.arguments);

  switch (toolName) {
    case "get_current_datetime": {
      return {
        content: JSON.stringify({
          ok: true,
          ...formatDateTimeParts(new Date()),
        }),
        sources: [],
      };
    }
    case "search_internet": {
      if (!options.useInternet) {
        return {
          content: JSON.stringify({
            ok: false,
            error: "Internet search is not enabled for this request.",
          }),
          sources: [],
        };
      }

      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) {
        return {
          content: JSON.stringify({
            ok: false,
            error: "A search query is required.",
          }),
          sources: [],
        };
      }

      const sources = await searchInternet(query);
      return {
        content: JSON.stringify({
          ok: true,
          query,
          results: sources,
        }),
        sources,
      };
    }
    case "scrape_webpage": {
      const url = typeof args.url === "string" ? args.url.trim() : "";

      if (!url) {
        return {
          content: JSON.stringify({
            ok: false,
            error: "A webpage URL is required.",
          }),
          sources: [],
        };
      }

      const scraped = await scrapeWebpageForAgent(url);
      return {
        content: JSON.stringify({
          ok: true,
          url,
          result: scraped.result,
          scrape: scraped.scrape,
        }),
        sources: [scraped.source],
      };
    }
    case "computer_control_request": {
      const request = typeof args.request === "string" ? args.request.trim() : "";
      if (!request) {
        return {
          content: JSON.stringify({
            ok: false,
            error: "A computer control request is required.",
          }),
          sources: [],
        };
      }

      const action = parseComputerControlRequest(request);
      if (!action) {
        return {
          content: JSON.stringify({
            ok: false,
            error: "That computer action was not recognized.",
          }),
          sources: [],
        };
      }

      if (action.type === "run_command" || action.type === "paste_to_codex") {
        return {
          content: JSON.stringify({
            ok: false,
            error:
              "Agent mode does not allow arbitrary shell commands or Codex window automation.",
          }),
          sources: [],
        };
      }

      const result = await executeComputerControl(action);
      return {
        content: JSON.stringify({
          ok: true,
          request,
          action: action.type,
          result,
        }),
        sources: [],
      };
    }
    case "home_assistant_request": {
      const request = typeof args.request === "string" ? args.request.trim() : "";
      if (!request) {
        return {
          content: JSON.stringify({
            ok: false,
            error: "A Home Assistant request is required.",
          }),
          sources: [],
        };
      }

      const action = parseHomeAssistantRequest(request);
      if (!action) {
        return {
          content: JSON.stringify({
            ok: false,
            error: "That Home Assistant action was not recognized.",
          }),
          sources: [],
        };
      }

      const result = await executeComputerControl(action);
      return {
        content: JSON.stringify({
          ok: true,
          request,
          action: action.type,
          result,
        }),
        sources: [],
      };
    }
    case "send_email": {
      const intent = args.intent === "send" ? "send" : "draft";
      const to = typeof args.to === "string" ? args.to.trim() : "";
      const subject =
        typeof args.subject === "string" && args.subject.trim()
          ? args.subject.trim()
          : "Message from your local assistant";
      const body = typeof args.body === "string" ? args.body.trim() : "";

      if (!to) {
        return {
          content: JSON.stringify({
            ok: false,
            error: "An email recipient is required.",
          }),
          sources: [],
        };
      }

      const emailRequest = { intent, to, subject, body };
      if (intent === "send") {
        await sendSmtpEmail(emailRequest);
        return {
          content: JSON.stringify({
            ok: true,
            intent,
            to,
            subject,
            result: `I sent the email to ${to}.`,
          }),
          sources: [],
        };
      }

      openMailtoDraft(buildMailtoUrl(emailRequest));
      return {
        content: JSON.stringify({
          ok: true,
          intent,
          to,
          subject,
          result: `I opened an email draft to ${to}.`,
        }),
        sources: [],
      };
    }
    case "remember_memory": {
      const text = typeof args.text === "string" ? args.text.trim() : "";
      const tags = Array.isArray(args.tags)
        ? args.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
        : [];

      if (!text) {
        return {
          content: JSON.stringify({
            ok: false,
            error: "Memory text is required.",
          }),
          sources: [],
        };
      }

      const memory = rememberAgentMemory(text, tags);
      return {
        content: JSON.stringify({
          ok: true,
          result: memory.result,
          item: memory.entry,
        }),
        sources: [],
      };
    }
    case "recall_memory": {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      const limit = Number(args.limit) || 5;

      if (!query) {
        return {
          content: JSON.stringify({
            ok: false,
            error: "A memory query is required.",
          }),
          sources: [],
        };
      }

      const memory = recallAgentMemories(query, limit);
      return {
        content: JSON.stringify({
          ok: true,
          query,
          result: memory.result,
          items: memory.items,
        }),
        sources: [],
      };
    }
    case "write_json_record": {
      const kind = typeof args.kind === "string" ? args.kind.trim() : "";
      const label = typeof args.label === "string" ? args.label.trim() : "";
      const data =
        args.data && typeof args.data === "object" && !Array.isArray(args.data)
          ? args.data
          : null;

      if (!kind || !label || !data) {
        return {
          content: JSON.stringify({
            ok: false,
            error: "kind, label, and data are required to write a JSON record.",
          }),
          sources: [],
        };
      }

      const record = writeAgentJsonRecord(kind, label, data);
      return {
        content: JSON.stringify({
          ok: true,
          result: record.result,
          record: record.record,
        }),
        sources: [],
      };
    }
    default:
      return {
        content: JSON.stringify({
          ok: false,
          error: `Unsupported tool: ${toolName || "unknown"}.`,
        }),
        sources: [],
      };
  }
}

async function generateStandardChatResult({
  messages,
  model,
  useInternet,
  temperature,
  maxTokens,
  latestUserContent,
}) {
  let searchSources = [];
  const systemMessages = [ASSISTANT_GUARDRAIL, buildDateTimeContextMessage()];

  if (useInternet) {
    try {
      searchSources = await searchInternet(latestUserContent || "");
    } catch (error) {
      return createResult(200, {
        message: `Internet search is enabled, but I couldn't search right now: ${error.message}`,
        usage: null,
        sources: [],
      });
    }

    if (!searchSources.length) {
      return createResult(200, {
        message:
          "Internet search is enabled, but I couldn't find grounded results for that request.",
        usage: null,
        sources: [],
      });
    }

    systemMessages.push(buildInternetGroundingMessage(latestUserContent || "", searchSources));
  }

  const payload = await fetchLmStudio("/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model,
      messages: [...systemMessages, ...messages],
      temperature,
      max_tokens: maxTokens,
    }),
  });

  const content = getMessageTextContent(payload?.choices?.[0]?.message);

  if (!content) {
    return createResult(502, {
      error: "LM Studio returned an empty assistant response.",
      raw: payload,
    });
  }

  return createResult(200, {
    message: stripReasoningBlocks(content) || content,
    usage: payload.usage || null,
    sources: searchSources,
  });
}

async function callLmStudioMessages(messages, options) {
  const payload = await fetchLmStudio("/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model: options.model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
    }),
  });

  const content = getMessageTextContent(payload?.choices?.[0]?.message);

  if (!content) {
    throw new Error("LM Studio returned an empty response.");
  }

  return content;
}

function getMastraAgentOrchestrator() {
  if (!mastraAgentOrchestrator) {
    mastraAgentOrchestrator = createMastraAgentOrchestrator({
      appRoot: APP_ROOT,
      callModel: callLmStudioMessages,
      searchInternet,
      scrapeWebpage: scrapeWebpageForAgent,
      parseComputerControlRequest,
      parseHomeAssistantRequest,
      executeComputerControl,
      sendEmail: sendSmtpEmail,
      openMailtoDraft,
      buildMailtoUrl,
      getDirectDateTimeAnswer,
      rememberMemory: rememberAgentMemory,
      recallMemory: recallAgentMemories,
      writeJsonRecord: writeAgentJsonRecord,
      gateway: getAgentGateway(),
    });
  }

  return mastraAgentOrchestrator;
}

async function generateAgentChatResult({
  messages,
  model,
  useInternet,
  temperature,
  maxTokens,
}) {
  const agentMessages = [
    ASSISTANT_GUARDRAIL,
    buildDateTimeContextMessage(),
    buildAgentModeMessage(useInternet),
    ...messages,
  ];
  const tools = buildAgentToolDefinitions(useInternet);
  let gatheredSources = [];
  const reasoningTrace: AgentTraceStep[] = [];
  let traceStepNumber = 1;

  for (let step = 0; step < AGENT_LOOP_LIMIT; step += 1) {
    const payload = await fetchLmStudio("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model,
        messages: agentMessages,
        tools,
        tool_choice: "auto",
        temperature,
        max_tokens: maxTokens,
      }),
    });

    const assistantMessage = payload?.choices?.[0]?.message || {};
    const content = getMessageTextContent(assistantMessage);
    const toolCalls = Array.isArray(assistantMessage.tool_calls)
      ? assistantMessage.tool_calls.slice(0, AGENT_TOOL_CALL_LIMIT)
      : [];

    if (!toolCalls.length) {
      if (!content) {
        return createResult(502, {
          error: "LM Studio returned an empty agent response.",
          raw: payload,
        });
      }

      return createResult(200, {
        message: stripReasoningBlocks(content) || content,
        usage: payload.usage || null,
        sources: gatheredSources,
        reasoningTrace,
      });
    }

    const normalizedToolCalls = toolCalls.map((toolCall, index) => ({
      id:
        typeof toolCall?.id === "string" && toolCall.id.trim()
          ? toolCall.id
          : `tool_${step + 1}_${index + 1}_${crypto.randomUUID()}`,
      type: "function",
      function: {
        name: toolCall?.function?.name || "",
        arguments:
          typeof toolCall?.function?.arguments === "string"
            ? toolCall.function.arguments
            : "{}",
      },
    }));

    agentMessages.push({
      role: "assistant",
      content: content || "",
      tool_calls: normalizedToolCalls,
    });

    for (const toolCall of normalizedToolCalls) {
      const result = await executeAgentToolCall(toolCall, { useInternet });
      gatheredSources = mergeSearchSources(gatheredSources, result.sources || []);
      reasoningTrace.push(buildAgentTraceEntry(traceStepNumber, toolCall, result));
      traceStepNumber += 1;
      agentMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result.content,
      });
    }
  }

  return createResult(200, {
    message:
      "Agent mode reached its step limit before finishing. Please try again with a more specific request.",
    usage: null,
    sources: gatheredSources,
    reasoningTrace,
  });
}

export function getConfigResult() {
  return createResult(200, {
    baseUrl: lmStudioBaseUrl,
    smtp: {
      host: smtpConfig.host,
      port: smtpConfig.port,
      user: smtpConfig.user,
      from: smtpConfig.from,
      passwordSet: Boolean(smtpConfig.pass),
    },
    internet: {
      provider: INTERNET_SEARCH_PROVIDER,
      enabled: true,
    },
    homeAssistant: {
      baseUrl: homeAssistantConfig.baseUrl,
      tokenSet: Boolean(homeAssistantConfig.token),
      enabled: Boolean(homeAssistantConfig.baseUrl && homeAssistantConfig.token),
      defaultMediaPlayer: homeAssistantConfig.defaultMediaPlayer,
    },
    transcription: {
      baseUrl: transcriptionConfig.baseUrl,
      model: transcriptionConfig.model,
      language: transcriptionConfig.language,
      apiKeySet: Boolean(transcriptionConfig.apiKey),
      enabled: Boolean(transcriptionConfig.baseUrl && transcriptionConfig.model),
    },
  });
}

export async function postConfigResult(body) {
  try {
    const baseUrl =
      typeof body.baseUrl === "string" ? body.baseUrl.trim() : undefined;
    const smtp = body?.smtp && typeof body.smtp === "object" ? body.smtp : undefined;
    const homeAssistant =
      body?.homeAssistant && typeof body.homeAssistant === "object"
        ? body.homeAssistant
        : undefined;
    const transcription =
      body?.transcription && typeof body.transcription === "object"
        ? body.transcription
        : undefined;

    if (baseUrl !== undefined) {
      lmStudioBaseUrl = (baseUrl || DEFAULT_LM_STUDIO_BASE_URL).replace(/\/+$/, "");
    }

    if (smtp) {
      const nextHost =
        typeof smtp.host === "string" ? smtp.host.trim() : smtpConfig.host;
      const nextPort = smtp.port !== undefined ? Number(smtp.port) : smtpConfig.port;
      const nextUser =
        typeof smtp.user === "string" ? smtp.user.trim() : smtpConfig.user;
      const nextPass =
        typeof smtp.pass === "string" ? smtp.pass : undefined;
      const nextFrom =
        typeof smtp.from === "string" ? smtp.from.trim() : smtpConfig.from;

      if (!nextHost) {
        return createResult(400, { error: "SMTP host is required." });
      }

      if (!Number.isFinite(nextPort) || nextPort <= 0) {
        return createResult(400, { error: "SMTP port must be a valid number." });
      }

      smtpConfig.host = nextHost;
      smtpConfig.port = nextPort;
      smtpConfig.user = nextUser;
      smtpConfig.from = nextFrom || nextUser;

      if (nextPass !== undefined) {
        smtpConfig.pass = nextPass;
      }
    }

    if (homeAssistant) {
      const nextBaseUrl =
        typeof homeAssistant.baseUrl === "string"
          ? normalizeBaseUrl(homeAssistant.baseUrl)
          : homeAssistantConfig.baseUrl;
      const nextToken =
        typeof homeAssistant.token === "string" ? homeAssistant.token.trim() : undefined;
      const nextDefaultMediaPlayer =
        typeof homeAssistant.defaultMediaPlayer === "string"
          ? homeAssistant.defaultMediaPlayer.trim()
          : homeAssistantConfig.defaultMediaPlayer;

      if (!nextBaseUrl) {
        return createResult(400, { error: "Home Assistant base URL is required." });
      }

      homeAssistantConfig.baseUrl = nextBaseUrl;
      homeAssistantConfig.defaultMediaPlayer = nextDefaultMediaPlayer;

      if (nextToken !== undefined) {
        homeAssistantConfig.token = nextToken;
      }
    }

    if (transcription) {
      const nextBaseUrl =
        typeof transcription.baseUrl === "string"
          ? normalizeBaseUrl(transcription.baseUrl)
          : transcriptionConfig.baseUrl;
      const nextApiKey =
        typeof transcription.apiKey === "string"
          ? transcription.apiKey.trim()
          : undefined;
      const nextModel =
        typeof transcription.model === "string"
          ? transcription.model.trim()
          : transcriptionConfig.model;
      const nextLanguage =
        typeof transcription.language === "string"
          ? transcription.language.trim()
          : transcriptionConfig.language;

      if (!nextBaseUrl) {
        return createResult(400, {
          error: "Transcription API base URL is required.",
        });
      }

      if (!nextModel) {
        return createResult(400, {
          error: "Transcription model is required.",
        });
      }

      transcriptionConfig.baseUrl = nextBaseUrl;
      transcriptionConfig.model = nextModel;
      transcriptionConfig.language = nextLanguage;

      if (nextApiKey !== undefined) {
        transcriptionConfig.apiKey = nextApiKey;
      }
    }

    return createResult(200, {
      baseUrl: lmStudioBaseUrl,
      smtp: {
        host: smtpConfig.host,
        port: smtpConfig.port,
        user: smtpConfig.user,
        from: smtpConfig.from,
        passwordSet: Boolean(smtpConfig.pass),
      },
      homeAssistant: {
        baseUrl: homeAssistantConfig.baseUrl,
        tokenSet: Boolean(homeAssistantConfig.token),
        enabled: Boolean(homeAssistantConfig.baseUrl && homeAssistantConfig.token),
        defaultMediaPlayer: homeAssistantConfig.defaultMediaPlayer,
      },
      transcription: {
        baseUrl: transcriptionConfig.baseUrl,
        model: transcriptionConfig.model,
        language: transcriptionConfig.language,
        apiKeySet: Boolean(transcriptionConfig.apiKey),
        enabled: Boolean(transcriptionConfig.baseUrl && transcriptionConfig.model),
      },
    });
  } catch (error) {
    return createResult(400, {
      error: "Could not update the LM Studio endpoint.",
      details: error.message,
    });
  }
}

export async function postAgentApprovalResult(body) {
  try {
    const runId = typeof body?.runId === "string" ? body.runId.trim() : "";
    const decisions = Array.isArray(body?.decisions) ? body.decisions : [];

    if (!runId) {
      return createResult(400, { error: "A workflow run id is required." });
    }

    const response = await getMastraAgentOrchestrator().resume({
      runId,
      decisions: decisions.map((decision) => ({
        id: typeof decision?.id === "string" ? decision.id.trim() : "",
        decision: decision?.decision === "reject" ? "reject" : "approve",
        editedArgs:
          decision?.editedArgs && typeof decision.editedArgs === "object"
            ? decision.editedArgs
            : undefined,
      })),
    });

    return createResult(200, response);
  } catch (error) {
    return createResult(502, {
      error: "Agent approval failed.",
      details: error.message,
    });
  }
}

export async function postChatResult(body) {
  try {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const model = typeof body.model === "string" ? body.model : "";
    const useInternet = body.useInternet === true;
    const agentMode = body.agentMode === true;
    const temperature =
      typeof body.temperature === "number" ? body.temperature : 0.7;
    const maxTokens =
      typeof body.maxTokens === "number" ? body.maxTokens : 400;

    if (!model) {
      return createResult(400, { error: "A model must be selected." });
    }

    if (!messages.length) {
      return createResult(400, { error: "At least one message is required." });
    }

    const latestUserMessage = [...messages]
      .reverse()
      .find((message) => message?.role === "user" && typeof message.content === "string");

    const grammarCheckRequest = parseGrammarCheckRequest(latestUserMessage?.content);
    if (grammarCheckRequest) {
      const payload = await fetchLmStudio("/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model,
          messages: buildGrammarCheckMessages(grammarCheckRequest.text),
          temperature: 0.2,
          max_tokens: Math.min(
            700,
            Math.max(180, Math.ceil(grammarCheckRequest.text.length * 1.5))
          ),
        }),
      });

      const content = getMessageTextContent(payload?.choices?.[0]?.message);

      if (!content) {
        return createResult(502, {
          error: "LM Studio returned an empty grammar-check response.",
          raw: payload,
        });
      }

      return createResult(200, {
        message: stripReasoningBlocks(content) || content,
        usage: payload.usage || null,
        action: {
          type: "grammar_check",
          target: null,
        },
      });
    }

    if (agentMode) {
      try {
        const response = await getMastraAgentOrchestrator().start({
          model,
          messages,
          useInternet,
          temperature,
          maxTokens,
        });

        return createResult(200, response);
      } catch (_) {
        return await generateStandardChatResult({
          messages,
          model,
          useInternet,
          temperature,
          maxTokens,
          latestUserContent: latestUserMessage?.content || "",
        });
      }
    }

    const directDateTimeAnswer = getDirectDateTimeAnswer(latestUserMessage?.content);

    if (directDateTimeAnswer) {
      return createResult(200, {
        message: directDateTimeAnswer,
        usage: null,
      });
    }

    const emailRequest = parseEmailRequest(latestUserMessage?.content);
    if (emailRequest) {
      if (emailRequest.intent === "send") {
        try {
          await sendSmtpEmail(emailRequest);
          return createResult(200, {
            message: `I sent the email to ${emailRequest.to}.`,
            usage: null,
            action: {
              type: "email_send",
              to: emailRequest.to,
              subject: emailRequest.subject,
            },
          });
        } catch (error) {
          return createResult(200, {
            message: `I couldn't send the email: ${error.message}`,
            usage: null,
            action: {
              type: "email_error",
              to: emailRequest.to,
              subject: emailRequest.subject,
            },
          });
        }
      }

      const mailtoUrl = buildMailtoUrl(emailRequest);
      openMailtoDraft(mailtoUrl);

      return createResult(200, {
        message: `I opened an email draft to ${emailRequest.to}.`,
        usage: null,
        action: {
          type: "email_draft",
          to: emailRequest.to,
          subject: emailRequest.subject,
        },
      });
    }

    const homeAssistantRequest = parseHomeAssistantRequest(latestUserMessage?.content);
    if (homeAssistantRequest) {
      try {
        const actionMessage = await executeComputerControl(homeAssistantRequest);
        return createResult(200, {
          message: actionMessage,
          usage: null,
          action: {
            type: homeAssistantRequest.type,
            target: homeAssistantRequest.entityId
              ? homeAssistantRequest.entityId
              : homeAssistantRequest.domain && homeAssistantRequest.service
                ? `${homeAssistantRequest.domain}.${homeAssistantRequest.service}`
                : homeAssistantRequest.domain || null,
          },
        });
      } catch (error) {
        return createResult(200, {
          message: `I couldn't reach Home Assistant: ${error.message}`,
          usage: null,
          action: {
            type: "home_assistant_error",
            target: null,
          },
        });
      }
    }

    const computerControlRequest = parseComputerControlRequest(latestUserMessage?.content);
    if (computerControlRequest) {
      try {
        const actionMessage = await executeComputerControl(computerControlRequest);
        return createResult(200, {
          message: actionMessage,
          usage: null,
          action: {
            type: computerControlRequest.type,
            target: computerControlRequest.target || null,
          },
        });
      } catch (error) {
        return createResult(200, {
          message: `I couldn't control that app: ${error.message}`,
          usage: null,
          action: {
            type: "computer_control_error",
            target: computerControlRequest.target || null,
          },
        });
      }
    }

    return await generateStandardChatResult({
      messages,
      model,
      useInternet,
      temperature,
      maxTokens,
      latestUserContent: latestUserMessage?.content || "",
    });
  } catch (error) {
    return createResult(502, {
      error: "Chat request failed.",
      details: error.message,
    });
  }
}
