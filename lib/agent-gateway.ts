import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

type JsonSchema = Record<string, any>;

export const AGENT_TOOL_NAME_VALUES = [
  "get_current_datetime",
  "search_internet",
  "scrape_webpage",
  "computer_control_request",
  "home_assistant_request",
  "send_email",
  "remember_memory",
  "recall_memory",
  "write_json_record",
  "list_json_records",
  "read_json_record",
  "get_session_snapshot",
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAME_VALUES)[number];

export type AgentToolSchemaDefinition = {
  name: AgentToolName;
  description: string;
  parameters: JsonSchema;
};

export type AgentMemoryEntry = {
  id: string;
  text: string;
  tags: string[];
  source: string;
  createdAt: string;
};

export type AgentHistoryEntry = {
  id: string;
  createdAt: string;
  trigger: string;
  stage: string;
  summary: string;
  metadata?: Record<string, any>;
};

export type AgentOutputRecord = {
  id: string;
  kind: string;
  label: string;
  relativePath: string;
  createdAt: string;
};

type StoredAgentOutputRecord = AgentOutputRecord & {
  size?: number;
};

const TOOL_SCHEMAS: AgentToolSchemaDefinition[] = [
  {
    name: "get_current_datetime",
    description: "Get the current local date and time from the computer.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "search_internet",
    description: "Search the web for grounded information and return source snippets and links.",
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
  {
    name: "scrape_webpage",
    description:
      "Fetch and extract structured details from a webpage URL, including title, excerpt, links, and page text summary.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The absolute http or https URL to fetch and extract.",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
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
  {
    name: "home_assistant_request",
    description:
      "Run a Home Assistant action or lookup, such as checking an entity state, listing entities, calling a service, or playing radio.",
    parameters: {
      type: "object",
      properties: {
        request: {
          type: "string",
          description:
            "A natural-language Home Assistant request such as 'Home Assistant status light.kitchen' or 'Home Assistant play radio Jazz FM'.",
        },
      },
      required: ["request"],
      additionalProperties: false,
    },
  },
  {
    name: "send_email",
    description: "Send an email through configured SMTP or open a local email draft.",
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
  {
    name: "remember_memory",
    description: "Persist a useful fact, preference, instruction, or summary into local long-term memory.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The memory text to store for later retrieval.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags such as preference, work, shopping, project, or reminder.",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "recall_memory",
    description: "Search local long-term memory for relevant notes, preferences, or prior summaries.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The memory search query, topic, or phrase to recall.",
        },
        limit: {
          type: "number",
          description: "Optional maximum number of memory items to return.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "write_json_record",
    description: "Write a structured JSON artifact to local storage for later reuse or export.",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          description: "A short category such as plan, research, contact, output, or report.",
        },
        label: {
          type: "string",
          description: "A human-readable label for the saved record.",
        },
        data: {
          type: "object",
          description: "The structured JSON payload to save.",
        },
      },
      required: ["kind", "label", "data"],
      additionalProperties: false,
    },
  },
  {
    name: "list_json_records",
    description:
      "List recently saved local JSON artifacts so the agent can reuse prior structured outputs.",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          description: "Optional kind filter such as plan, research, output, or report.",
        },
        limit: {
          type: "number",
          description: "Optional maximum number of records to return.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "read_json_record",
    description:
      "Read a previously saved local JSON artifact by relative path, id, or label so the agent can continue prior work.",
    parameters: {
      type: "object",
      properties: {
        relativePath: {
          type: "string",
          description: "Preferred relative path from .lumen-agent/outputs, if known.",
        },
        id: {
          type: "string",
          description: "Optional saved record id.",
        },
        label: {
          type: "string",
          description: "Optional human-readable label to match.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_session_snapshot",
    description:
      "Inspect recent agent history, memory, and saved outputs for continuity before taking the next step.",
    parameters: {
      type: "object",
      properties: {
        historyLimit: {
          type: "number",
          description: "Optional maximum number of recent history items.",
        },
        memoryLimit: {
          type: "number",
          description: "Optional maximum number of recent memory items.",
        },
        outputLimit: {
          type: "number",
          description: "Optional maximum number of recent saved outputs.",
        },
      },
      additionalProperties: false,
    },
  },
];

function ensureDirectory(directoryPath: string) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function sanitizeFileToken(value: string, fallback = "record") {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || fallback;
}

function compactText(value: unknown, maxLength = 220) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function readJsonlEntries<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf8");
  if (!content.trim()) {
    return [];
  }

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as T];
      } catch {
        return [];
      }
    });
}

function appendJsonlEntry(filePath: string, value: Record<string, any>) {
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function scoreMemoryMatch(entry: AgentMemoryEntry, query: string) {
  const haystack = `${entry.text} ${entry.tags.join(" ")}`.toLowerCase();
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (!tokens.length) {
    return 0;
  }

  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

export function createAgentGateway(appRoot: string) {
  const baseDir = path.join(appRoot, ".lumen-agent");
  const historyPath = path.join(baseDir, "history.jsonl");
  const memoryPath = path.join(baseDir, "memory.jsonl");
  const outputsIndexPath = path.join(baseDir, "outputs.jsonl");
  const outputsDir = path.join(baseDir, "outputs");

  ensureDirectory(baseDir);
  ensureDirectory(outputsDir);

  function getToolSchemas() {
    return [...TOOL_SCHEMAS];
  }

  function appendHistory(entry: {
    trigger?: string;
    stage: string;
    summary: string;
    metadata?: Record<string, any>;
  }) {
    const payload: AgentHistoryEntry = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      trigger: entry.trigger || "custom_prompt",
      stage: entry.stage,
      summary: compactText(entry.summary, 360),
      metadata: entry.metadata,
    };
    appendJsonlEntry(historyPath, payload);
    return payload;
  }

  function getRecentHistory(limit = 10) {
    const entries = readJsonlEntries<AgentHistoryEntry>(historyPath);
    return entries.slice(-limit);
  }

  function getPromptHistory(limit = 10) {
    const entries = readJsonlEntries<AgentHistoryEntry>(historyPath);
    return entries
      .filter((entry) => entry?.stage !== "summary")
      .slice(-limit);
  }

  function rememberMemory(input: {
    text: string;
    tags?: string[];
    source?: string;
  }) {
    const entry: AgentMemoryEntry = {
      id: crypto.randomUUID(),
      text: compactText(input.text, 1000),
      tags: Array.isArray(input.tags)
        ? input.tags.map((tag) => compactText(tag, 60)).filter(Boolean)
        : [],
      source: compactText(input.source || "agent", 80) || "agent",
      createdAt: new Date().toISOString(),
    };
    appendJsonlEntry(memoryPath, entry);
    return entry;
  }

  function recallMemory(query: string, limit = 5) {
    const entries = readJsonlEntries<AgentMemoryEntry>(memoryPath);
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 5, 12));
    const normalizedQuery = String(query || "").trim();

    if (!normalizedQuery) {
      return entries.slice(-normalizedLimit).reverse();
    }

    return entries
      .map((entry) => ({
        entry,
        score: scoreMemoryMatch(entry, normalizedQuery),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return right.entry.createdAt.localeCompare(left.entry.createdAt);
      })
      .slice(0, normalizedLimit)
      .map((item) => item.entry);
  }

  function writeJsonRecord(input: {
    kind: string;
    label: string;
    data: Record<string, any>;
  }) {
    const kind = sanitizeFileToken(input.kind, "output");
    const label = sanitizeFileToken(input.label, "record");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${timestamp}-${kind}-${label}.json`;
    const filePath = path.join(outputsDir, fileName);
    const record: AgentOutputRecord = {
      id: crypto.randomUUID(),
      kind,
      label: compactText(input.label, 120) || "record",
      relativePath: path.join(".lumen-agent", "outputs", fileName).replace(/\\/g, "/"),
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(filePath, `${JSON.stringify(input.data, null, 2)}\n`, "utf8");
    appendJsonlEntry(outputsIndexPath, {
      ...record,
      size: Buffer.byteLength(JSON.stringify(input.data), "utf8"),
    });

    return record;
  }

  function listJsonRecords(input: { kind?: string; limit?: number } = {}) {
    const normalizedKind = String(input.kind || "")
      .trim()
      .toLowerCase();
    const normalizedLimit = Math.max(1, Math.min(Number(input.limit) || 10, 20));

    return readJsonlEntries<StoredAgentOutputRecord>(outputsIndexPath)
      .filter((entry) => !normalizedKind || entry.kind === normalizedKind)
      .slice(-normalizedLimit)
      .reverse();
  }

  function readJsonRecord(input: {
    relativePath?: string;
    id?: string;
    label?: string;
  }) {
    const relativePath = String(input.relativePath || "")
      .trim()
      .replace(/\\/g, "/");
    const id = String(input.id || "").trim();
    const label = String(input.label || "")
      .trim()
      .toLowerCase();
    const entries = readJsonlEntries<StoredAgentOutputRecord>(outputsIndexPath);
    const record =
      entries.find((entry) => relativePath && entry.relativePath === relativePath) ||
      entries.find((entry) => id && entry.id === id) ||
      entries.find((entry) => label && entry.label.toLowerCase() === label) ||
      null;

    if (!record) {
      return null;
    }

    const filePath = path.join(appRoot, record.relativePath);
    if (!fs.existsSync(filePath)) {
      return {
        record,
        data: null,
        error: `The saved file for ${record.label} is no longer available.`,
      };
    }

    try {
      return {
        record,
        data: JSON.parse(fs.readFileSync(filePath, "utf8")),
        error: null,
      };
    } catch (error: any) {
      return {
        record,
        data: null,
        error: error?.message || "The saved JSON record could not be parsed.",
      };
    }
  }

  function getSessionSnapshot(input: {
    historyLimit?: number;
    memoryLimit?: number;
    outputLimit?: number;
  } = {}) {
    const history = getPromptHistory(input.historyLimit || 6);
    const memories = recallMemory("", input.memoryLimit || 5);
    const outputs = listJsonRecords({ limit: input.outputLimit || 5 });

    return {
      history,
      memories,
      outputs,
      counts: {
        history: history.length,
        memories: memories.length,
        outputs: outputs.length,
      },
    };
  }

  function buildInjectedContext(input: {
    systemPrompt?: string;
    trigger?: string;
    useInternet: boolean;
    historyLimit?: number;
    memoryLimit?: number;
  }) {
    const recentHistory = getPromptHistory(input.historyLimit || 8);
    const recentMemories = recallMemory("", input.memoryLimit || 5);
    const toolSummary = getToolSchemas()
      .map((tool) => `- ${tool.name}: ${tool.description}`)
      .join("\n");
    const historySummary = recentHistory.length
      ? recentHistory
          .map((entry) =>
            JSON.stringify({
              createdAt: entry.createdAt,
              trigger: entry.trigger,
              stage: entry.stage,
              summary: entry.summary,
            })
          )
          .join("\n")
      : "[]";
    const memorySummary = recentMemories.length
      ? recentMemories
          .map((entry) =>
            JSON.stringify({
              createdAt: entry.createdAt,
              text: entry.text,
              tags: entry.tags,
              source: entry.source,
            })
          )
          .join("\n")
      : "[]";

    return [
      "Gateway context injected on every agent turn.",
      `Trigger: ${input.trigger || "custom_prompt"}`,
      `Internet enabled: ${input.useInternet ? "yes" : "no"}`,
      input.systemPrompt ? `System prompt:\n${input.systemPrompt}` : "System prompt:\n<none provided>",
      `Tool schemas:\n${toolSummary}`,
      `Recent agent history, excluding final replies:\n${historySummary}`,
      `Recent memory entries:\n${memorySummary}`,
      "Outputs can be persisted through write_json_record and memory can be updated through remember_memory.",
    ].join("\n\n");
  }

  return {
    paths: {
      baseDir,
      historyPath,
      memoryPath,
      outputsDir,
      outputsIndexPath,
    },
    getToolSchemas,
    appendHistory,
    getRecentHistory,
    rememberMemory,
    recallMemory,
    writeJsonRecord,
    listJsonRecords,
    readJsonRecord,
    getSessionSnapshot,
    buildInjectedContext,
  };
}

export type AgentGateway = ReturnType<typeof createAgentGateway>;
