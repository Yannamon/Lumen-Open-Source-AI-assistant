const http = require("node:http");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const tls = require("node:tls");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 3000);
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
const INTERNET_SEARCH_PROVIDER = "DuckDuckGo";
const DUCKDUCKGO_HTML_SEARCH_URL = "https://html.duckduckgo.com/html/";
const DUCKDUCKGO_LITE_SEARCH_URL = "https://lite.duckduckgo.com/lite/";
const DEFAULT_SPEECH_MODEL = "tts2-emo-qwen3-8b-192k";
const SPOTIFY_WEB_URL = "https://open.spotify.com/";
const AGENT_LOOP_LIMIT = 4;
const AGENT_TOOL_CALL_LIMIT = 4;
const PUBLIC_DIR = path.join(__dirname, "public");
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
      "Use tools instead of guessing when the task needs the current date or time, internet research, email, or local computer control. " +
      "Only take actions that directly help with the user's request. Do not run arbitrary shell commands, automate external prompt windows, or take destructive actions. " +
      `${useInternet ? "Internet search is available for this request. " : "Internet search is not enabled for this request. "}` +
      "You may make multiple tool calls, then provide one concise final answer.",
  };
}

function buildAgentToolDefinitions(useInternet) {
  const tools = [
    {
      type: "function",
      function: {
        name: "get_current_datetime",
        description: "Get the current local date and time from the computer.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "computer_control_request",
        description:
          "Perform a safe local computer action like opening an app, controlling Spotify playback, opening VS Code, or reading system info. Do not use this for arbitrary shell commands.",
        parameters: {
          type: "object",
          properties: {
            request: {
              type: "string",
              description:
                "A natural-language request such as 'open VS Code', 'pause Spotify', or 'show system info'.",
            },
          },
          required: ["request"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "send_email",
        description:
          "Send an email through configured SMTP or open a local email draft.",
        parameters: {
          type: "object",
          properties: {
            intent: {
              type: "string",
              enum: ["send", "draft"],
              description: "Use 'send' to send immediately or 'draft' to open a local draft.",
            },
            to: {
              type: "string",
              description: "One or more email addresses separated by commas.",
            },
            subject: {
              type: "string",
              description: "The email subject line.",
            },
            body: {
              type: "string",
              description: "The plain-text email body.",
            },
          },
          required: ["intent", "to"],
          additionalProperties: false,
        },
      },
    },
  ];

  if (useInternet) {
    tools.unshift({
      type: "function",
      function: {
        name: "search_internet",
        description:
          "Search the web for grounded information and return source snippets and links.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query to look up on the internet.",
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
    });
  }

  return tools;
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
    case "computer_control_request":
      return "Used local computer control";
    case "home_assistant_request":
      return "Queried Home Assistant";
    case "send_email":
      return "Prepared email action";
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
    case "computer_control_request":
      return payload?.result || payload?.request || args?.request || "Completed a local computer action.";
    case "home_assistant_request":
      return payload?.result || payload?.request || args?.request || "Completed a Home Assistant action.";
    case "send_email":
      return payload?.result
        || (payload?.to ? `Prepared an email action for ${payload.to}.` : "")
        || (args?.to ? `Prepared an email action for ${args.to}.` : "Prepared an email action.");
    default:
      return payload?.result || payload?.message || "Completed a tool action.";
  }
}

function buildAgentTraceEntry(stepNumber, toolCall, result) {
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

function runPowerShell(command) {
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
    return __dirname;
  }

  if (/^(this|current)\s+(project|folder|directory)$/i.test(cleaned) || /^here$/i.test(cleaned)) {
    return __dirname;
  }

  const candidates = [];

  if (path.isAbsolute(cleaned)) {
    candidates.push(path.normalize(cleaned));
  } else {
    candidates.push(path.resolve(__dirname, cleaned));
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
Add-Type -AssemblyName Microsoft.VisualBasic;
Add-Type -AssemblyName System.Windows.Forms;
$promptText = '${safePromptText}';
$clipboardBackup = $null;
try {
  $clipboardBackup = Get-Clipboard -Raw -TextFormatType Text -ErrorAction Stop
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
Set-Clipboard -Value $promptText;
$activated = [Microsoft.VisualBasic.Interaction]::AppActivate($targetWindow.Id);
if (-not $activated) {
  throw "I found a window but could not activate it: $($targetWindow.MainWindowTitle)"
}
Start-Sleep -Milliseconds 250;
[System.Windows.Forms.SendKeys]::SendWait('^v');
${submit ? "[System.Windows.Forms.SendKeys]::SendWait('~');" : ""}
if ($null -ne $clipboardBackup) {
  Start-Sleep -Milliseconds 200;
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

function runLocalCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, {
      cwd: options.cwd || __dirname,
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

function createSmtpConnection({ host, port }) {
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

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function sendFile(response, filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extension] || "application/octet-stream";

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        sendJson(response, 404, { error: "File not found." });
        return;
      }

      sendJson(response, 500, { error: "Failed to read file." });
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    response.end(content);
  });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    request.on("data", (chunk) => {
      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body."));
      }
    });

    request.on("error", reject);
  });
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

async function fetchLmStudio(pathname, options = {}) {
  const url = `${lmStudioBaseUrl}${pathname}`;
  const requestOptions = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  };
  let lastError = null;

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
    } catch (error) {
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

function shouldRetryLmStudioFetch(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("socket hang up") ||
    message.includes("other side closed")
  );
}

function formatLmStudioFetchError(url, error) {
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryTranscriptionFetch(error) {
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

function formatTranscriptionFetchError(url, error) {
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

async function handleModels(response) {
  try {
    const payload = await fetchLmStudio("/v1/models", { method: "GET" });
    const models = toUiModelList(payload);

    sendJson(response, 200, {
      baseUrl: lmStudioBaseUrl,
      defaultModel: pickDefaultChatModel(models),
      defaultSpeechModel: pickDefaultSpeechModel(models),
      models,
    });
  } catch (error) {
    sendJson(response, 502, {
      error: "Could not reach the LM Studio server.",
      details: error.message,
    });
  }
}

async function fetchTranscriptionService(pathname, options = {}) {
  const url = `${transcriptionConfig.baseUrl}${pathname}`;
  const authorizationHeader = transcriptionConfig.apiKey
    ? { Authorization: `Bearer ${transcriptionConfig.apiKey}` }
    : {};
  let lastError = null;

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
    } catch (error) {
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

async function handleSpeak(request, response) {
  try {
    const body = await readJsonBody(request);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const model =
      typeof body.model === "string" && body.model.trim()
        ? body.model.trim()
        : DEFAULT_SPEECH_MODEL;

    if (!text) {
      sendJson(response, 400, { error: "Speech text is required." });
      return;
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

    sendJson(response, 200, {
      text: spokenText,
      model,
      enhanced: spokenText !== text,
    });
  } catch (error) {
    sendJson(response, 502, {
      error: "Speech preparation failed.",
      details: error.message,
    });
  }
}

function handleConfigGet(response) {
  sendJson(response, 200, {
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
  });
}

async function handleConfigPost(request, response) {
  try {
    const body = await readJsonBody(request);
    const baseUrl =
      typeof body.baseUrl === "string" ? body.baseUrl.trim() : undefined;
    const smtp = body?.smtp && typeof body.smtp === "object" ? body.smtp : undefined;

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
        sendJson(response, 400, { error: "SMTP host is required." });
        return;
      }

      if (!Number.isFinite(nextPort) || nextPort <= 0) {
        sendJson(response, 400, { error: "SMTP port must be a valid number." });
        return;
      }

      smtpConfig.host = nextHost;
      smtpConfig.port = nextPort;
      smtpConfig.user = nextUser;
      smtpConfig.from = nextFrom || nextUser;

      if (nextPass !== undefined) {
        smtpConfig.pass = nextPass;
      }
    }

    sendJson(response, 200, {
      baseUrl: lmStudioBaseUrl,
      smtp: {
        host: smtpConfig.host,
        port: smtpConfig.port,
        user: smtpConfig.user,
        from: smtpConfig.from,
        passwordSet: Boolean(smtpConfig.pass),
      },
    });
  } catch (error) {
    sendJson(response, 400, {
      error: "Could not update the LM Studio endpoint.",
      details: error.message,
    });
  }
}

async function executeAgentToolCall(toolCall, options) {
  const toolName = toolCall?.function?.name || "";
  const args = parseJsonObject(toolCall?.function?.arguments);

  switch (toolName) {
    case "get_current_datetime":
      return {
        content: JSON.stringify({
          ok: true,
          ...formatDateTimeParts(new Date()),
        }),
        sources: [],
      };
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

async function buildStandardChatPayload({
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
    searchSources = await searchInternet(latestUserContent || "");
    if (!searchSources.length) {
      return {
        status: 200,
        body: {
          message:
            "Internet search is enabled, but I couldn't find grounded results for that request.",
          usage: null,
          sources: [],
        },
      };
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
    return {
      status: 502,
      body: {
        error: "LM Studio returned an empty assistant response.",
        raw: payload,
      },
    };
  }

  return {
    status: 200,
    body: {
      message: stripReasoningBlocks(content) || content,
      usage: payload.usage || null,
      sources: searchSources,
    },
  };
}

async function buildAgentChatPayload({
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
  const reasoningTrace = [];
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
        return {
          status: 502,
          body: {
            error: "LM Studio returned an empty agent response.",
            raw: payload,
          },
        };
      }

      return {
        status: 200,
        body: {
          message: stripReasoningBlocks(content) || content,
          usage: payload.usage || null,
          sources: gatheredSources,
          reasoningTrace,
        },
      };
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

  return {
    status: 200,
    body: {
      message:
        "Agent mode reached its step limit before finishing. Please try again with a more specific request.",
      usage: null,
      sources: gatheredSources,
      reasoningTrace,
    },
  };
}

async function handleChat(request, response) {
  try {
    const body = await readJsonBody(request);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const model = typeof body.model === "string" ? body.model : "";
    const useInternet = body.useInternet === true;
    const agentMode = body.agentMode === true;
    const temperature =
      typeof body.temperature === "number" ? body.temperature : 0.7;
    const maxTokens =
      typeof body.maxTokens === "number" ? body.maxTokens : 400;

    if (!model) {
      sendJson(response, 400, { error: "A model must be selected." });
      return;
    }

    if (!messages.length) {
      sendJson(response, 400, { error: "At least one message is required." });
      return;
    }

    const latestUserMessage = [...messages]
      .reverse()
      .find((message) => message?.role === "user" && typeof message.content === "string");
    const directDateTimeAnswer = getDirectDateTimeAnswer(latestUserMessage?.content);

    if (directDateTimeAnswer) {
      sendJson(response, 200, {
        message: directDateTimeAnswer,
        usage: null,
      });
      return;
    }

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
        sendJson(response, 502, {
          error: "LM Studio returned an empty grammar-check response.",
          raw: payload,
        });
        return;
      }

      sendJson(response, 200, {
        message: stripReasoningBlocks(content) || content,
        usage: payload.usage || null,
        action: {
          type: "grammar_check",
          target: null,
        },
      });
      return;
    }

    const emailRequest = parseEmailRequest(latestUserMessage?.content);
    if (emailRequest) {
      if (emailRequest.intent === "send") {
        try {
          await sendSmtpEmail(emailRequest);
          sendJson(response, 200, {
            message: `I sent the email to ${emailRequest.to}.`,
            usage: null,
            action: {
              type: "email_send",
              to: emailRequest.to,
              subject: emailRequest.subject,
            },
          });
        } catch (error) {
          sendJson(response, 200, {
            message: `I couldn't send the email: ${error.message}`,
            usage: null,
            action: {
              type: "email_error",
              to: emailRequest.to,
              subject: emailRequest.subject,
            },
          });
        }
        return;
      }

      const mailtoUrl = buildMailtoUrl(emailRequest);
      openMailtoDraft(mailtoUrl);

      sendJson(response, 200, {
        message: `I opened an email draft to ${emailRequest.to}.`,
        usage: null,
        action: {
          type: "email_draft",
          to: emailRequest.to,
          subject: emailRequest.subject,
        },
      });
      return;
    }

    const computerControlRequest = parseComputerControlRequest(latestUserMessage?.content);
    if (computerControlRequest) {
      try {
        const actionMessage = await executeComputerControl(computerControlRequest);
        sendJson(response, 200, {
          message: actionMessage,
          usage: null,
          action: {
            type: computerControlRequest.type,
            target: computerControlRequest.target || null,
          },
        });
      } catch (error) {
        sendJson(response, 200, {
          message: `I couldn't control that app: ${error.message}`,
          usage: null,
          action: {
            type: "computer_control_error",
            target: computerControlRequest.target || null,
          },
        });
      }
      return;
    }

    if (agentMode) {
      try {
        const result = await buildAgentChatPayload({
          messages,
          model,
          useInternet,
          temperature,
          maxTokens,
        });
        sendJson(response, result.status, result.body);
        return;
      } catch (_) {
        // Fall back to standard chat below.
      }
    }

    try {
      const result = await buildStandardChatPayload({
        messages,
        model,
        useInternet,
        temperature,
        maxTokens,
        latestUserContent: latestUserMessage?.content || "",
      });
      sendJson(response, result.status, result.body);
      return;
    } catch (error) {
      if (useInternet) {
        sendJson(response, 200, {
          message: `Internet search is enabled, but I couldn't search right now: ${error.message}`,
          usage: null,
          sources: [],
        });
        return;
      }

      throw error;
    }
  } catch (error) {
    sendJson(response, 502, {
      error: "Chat request failed.",
      details: error.message,
    });
  }
}

function handleStatic(requestPath, response) {
  const normalizedPath =
    requestPath === "/" ? "/index.html" : decodeURIComponent(requestPath);
  const safePath = path.normalize(normalizedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(response, 403, { error: "Forbidden." });
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    sendFile(response, filePath);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && url.pathname === "/api/models") {
    await handleModels(response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/config") {
    handleConfigGet(response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/config") {
    await handleConfigPost(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/chat") {
    await handleChat(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/speak") {
    await handleSpeak(request, response);
    return;
  }

  if (request.method === "GET") {
    handleStatic(url.pathname, response);
    return;
  }

  sendJson(response, 405, { error: "Method not allowed." });
});

server.listen(PORT, () => {
  console.log(
    `Personal assistant running at http://localhost:${PORT} using ${lmStudioBaseUrl}`
  );
});
