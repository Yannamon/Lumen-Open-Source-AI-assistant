import * as childProcess from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as tls from "node:tls";

export type SearchSource = {
  title: string;
  url: string;
  snippet: string;
};

export type ApiResult<T> = {
  status: number;
  body: T;
};

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
const DEFAULT_TRANSCRIPTION_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
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
    return { type: "spotify_pause" };
  }

  if (/next\s+(?:song|track)|skip\s+(?:song|track)|spotify next/.test(normalized)) {
    return { type: "media_next" };
  }

  if (/previous\s+(?:song|track)|back\s+(?:song|track)|spotify previous/.test(normalized)) {
    return { type: "media_previous" };
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
      await openWindowsApp(action.target || "spotify");
      await new Promise((resolve) =>
        setTimeout(resolve, action.target === "spotify_web" ? 2200 : 1200)
      );
      await sendMediaKey("0xB3");
      return action.target === "spotify_web"
        ? "I opened Spotify Web and sent the play command."
        : "I opened Spotify and sent the play command.";
    case "spotify_pause":
      await sendMediaKey("0xB3");
      return "I sent the Spotify play or pause media command.";
    case "media_next":
      await sendMediaKey("0xB0");
      return "I skipped to the next track.";
    case "media_previous":
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
  const response = await fetch(`${lmStudioBaseUrl}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
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
        : payload?.error?.message || "LM Studio request failed.";

    throw new Error(errorMessage);
  }

  return payload;
}

async function fetchTranscriptionService(pathname: string, options: any = {}) {
  const response = await fetch(`${transcriptionConfig.baseUrl}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${transcriptionConfig.apiKey}`,
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
}

function createResult(status, body) {
  return { status, body };
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

    if (!transcriptionConfig.baseUrl || !transcriptionConfig.model || !transcriptionConfig.apiKey) {
      return createResult(400, {
        error:
          "Transcription is not configured yet. Save a transcription API base URL, model, and API key first.",
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
      enabled: Boolean(
        transcriptionConfig.baseUrl &&
          transcriptionConfig.model &&
          transcriptionConfig.apiKey
      ),
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
        enabled: Boolean(
          transcriptionConfig.baseUrl &&
            transcriptionConfig.model &&
            transcriptionConfig.apiKey
        ),
      },
    });
  } catch (error) {
    return createResult(400, {
      error: "Could not update the LM Studio endpoint.",
      details: error.message,
    });
  }
}

export async function postChatResult(body) {
  try {
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const model = typeof body.model === "string" ? body.model : "";
    const useInternet = body.useInternet === true;
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

    let searchSources = [];
    const systemMessages = [ASSISTANT_GUARDRAIL, buildDateTimeContextMessage()];

    if (useInternet) {
      try {
        searchSources = await searchInternet(latestUserMessage?.content || "");
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

      systemMessages.push(
        buildInternetGroundingMessage(latestUserMessage?.content || "", searchSources)
      );
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

    const content = payload?.choices?.[0]?.message?.content;

    if (!content) {
      return createResult(502, {
        error: "LM Studio returned an empty assistant response.",
        raw: payload,
      });
    }

    return createResult(200, {
      message: content,
      usage: payload.usage || null,
      sources: searchSources,
    });
  } catch (error) {
    return createResult(502, {
      error: "Chat request failed.",
      details: error.message,
    });
  }
}
