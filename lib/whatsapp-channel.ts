import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export type WhatsAppConversationRole = "user" | "assistant";

export type WhatsAppConversationMessage = {
  role: WhatsAppConversationRole;
  content: string;
  timestamp: string;
  requestSid?: string;
};

type TwilioParamValue = string | string[];

const DEFAULT_HISTORY_LIMIT = 12;
const DEFAULT_REPLY_CHUNK_LENGTH = 1500;

function isWhatsAppConversationMessage(
  value: WhatsAppConversationMessage | null
): value is WhatsAppConversationMessage {
  return Boolean(value);
}

function ensureDirectoryExists(directoryPath: string) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function normalizeSenderFileName(sender: string) {
  const normalized = String(sender || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "unknown-sender";
}

function getConversationFilePath(appRoot: string, sender: string) {
  return path.join(
    appRoot,
    ".lumen-agent",
    "whatsapp",
    "conversations",
    `${normalizeSenderFileName(sender)}.jsonl`
  );
}

function toSingleLineText(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function loadWhatsAppConversation(
  appRoot: string,
  sender: string,
  limit = DEFAULT_HISTORY_LIMIT
) {
  const filePath = getConversationFilePath(appRoot, sender);

  if (!fs.existsSync(filePath)) {
    return [];
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);

  return lines
    .map((line) => {
      try {
        const parsed = JSON.parse(line);

        if (
          (parsed?.role === "user" || parsed?.role === "assistant") &&
          typeof parsed?.content === "string" &&
          parsed.content.trim()
        ) {
          return {
            role: parsed.role,
            content: parsed.content.trim(),
            timestamp:
              typeof parsed.timestamp === "string"
                ? parsed.timestamp
                : new Date().toISOString(),
            requestSid:
              typeof parsed.requestSid === "string" ? parsed.requestSid : undefined,
          } satisfies WhatsAppConversationMessage;
        }
      } catch {}

      return null;
    })
    .filter(isWhatsAppConversationMessage)
    .slice(-Math.max(1, limit));
}

export function appendWhatsAppConversation(
  appRoot: string,
  sender: string,
  messages: Array<{
    role: WhatsAppConversationRole;
    content: string;
    requestSid?: string;
  }>
) {
  const filePath = getConversationFilePath(appRoot, sender);
  ensureDirectoryExists(path.dirname(filePath));

  const serialized = messages
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim()
    )
    .map((message) =>
      JSON.stringify({
        role: message.role,
        content: message.content.trim(),
        timestamp: new Date().toISOString(),
        requestSid:
          typeof message.requestSid === "string" ? message.requestSid : undefined,
      })
    )
    .join("\n");

  if (!serialized) {
    return;
  }

  fs.appendFileSync(filePath, `${serialized}\n`, "utf8");
}

function xmlEscape(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function splitWhatsAppReply(text: string, maxLength = DEFAULT_REPLY_CHUNK_LENGTH) {
  const normalized = String(text || "").trim();

  if (!normalized) {
    return [];
  }

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let currentChunk = "";

  const pushPart = (part: string) => {
    const cleanedPart = toSingleLineText(part);

    if (!cleanedPart) {
      return;
    }

    if (cleanedPart.length > maxLength) {
      const words = cleanedPart.split(/\s+/);
      let overflowChunk = "";

      words.forEach((word) => {
        const nextChunk = overflowChunk ? `${overflowChunk} ${word}` : word;

        if (nextChunk.length <= maxLength) {
          overflowChunk = nextChunk;
          return;
        }

        if (overflowChunk) {
          chunks.push(overflowChunk);
        }

        overflowChunk = word;
      });

      if (overflowChunk) {
        chunks.push(overflowChunk);
      }

      return;
    }

    const nextChunk = currentChunk ? `${currentChunk}\n\n${cleanedPart}` : cleanedPart;

    if (nextChunk.length <= maxLength) {
      currentChunk = nextChunk;
      return;
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    currentChunk = cleanedPart;
  };

  paragraphs.forEach(pushPart);

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks.length ? chunks : [normalized.slice(0, maxLength)];
}

export function buildWhatsAppTwimlResponse(messages: string[]) {
  const messageNodes = messages
    .filter((message) => typeof message === "string" && message.trim())
    .map((message) => `<Message>${xmlEscape(message)}</Message>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?><Response>${messageNodes || "<Message>Sorry, I could not generate a reply.</Message>"}</Response>`;
}

function normalizeTwilioParamEntries(params: Record<string, TwilioParamValue>) {
  return Object.keys(params)
    .sort()
    .flatMap((key) => {
      const value = params[key];

      if (Array.isArray(value)) {
        return [...value].sort().map((entry) => `${key}${entry}`);
      }

      return `${key}${value}`;
    })
    .join("");
}

export function verifyTwilioSignature({
  authToken,
  signature,
  url,
  params,
}: {
  authToken: string;
  signature: string;
  url: string;
  params: Record<string, TwilioParamValue>;
}) {
  const normalizedToken = String(authToken || "").trim();
  const normalizedSignature = String(signature || "").trim();
  const normalizedUrl = String(url || "").trim();

  if (!normalizedToken || !normalizedSignature || !normalizedUrl) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha1", normalizedToken)
    .update(`${normalizedUrl}${normalizeTwilioParamEntries(params)}`, "utf8")
    .digest("base64");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const actualBuffer = Buffer.from(normalizedSignature, "utf8");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}
