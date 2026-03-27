import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

import { Mastra } from "@mastra/core";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { LibSQLStore } from "@mastra/libsql";
import { z } from "zod";

import {
  AGENT_TOOL_NAME_VALUES,
  type AgentGateway,
  type AgentToolName,
  type AgentMemoryEntry,
  type AgentOutputRecord,
} from "@/lib/agent-gateway";

export type AgentLlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AgentTraceStep = {
  step: number;
  title: string;
  detail: string;
  status: "ok" | "error";
};

export type AgentSearchSource = {
  title: string;
  url: string;
  snippet?: string;
};

export type AgentWorkflowActionQueueItem = {
  id: string;
  owner: "research-agent" | "operations-agent";
  tool: AgentToolName;
  title: string;
  description: string;
  request: string;
  args: Record<string, any>;
  safetyTier: "safe" | "confirm" | "blocked";
  status:
    | "planned"
    | "pending_approval"
    | "approved"
    | "rejected"
    | "blocked"
    | "completed"
    | "failed"
    | "skipped";
  canEdit: boolean;
  result?: string;
  error?: string;
};

export type AgentWorkflowPendingApproval = {
  runId: string;
  actionCount: number;
  label: string;
};

export type AgentWorkflowResponse = {
  message: string;
  sources: AgentSearchSource[];
  reasoningTrace: AgentTraceStep[];
  actionQueue: AgentWorkflowActionQueueItem[];
  pendingApproval: AgentWorkflowPendingApproval | null;
  runId: string | null;
};

type AgentWorkflowDependencies = {
  appRoot: string;
  gateway: AgentGateway;
  callModel(messages: AgentLlmMessage[], options: {
    model: string;
    temperature: number;
    maxTokens: number;
  }): Promise<string>;
  searchInternet(query: string): Promise<AgentSearchSource[]>;
  scrapeWebpage(url: string): Promise<{
    result: string;
    scrape: Record<string, any>;
    source: AgentSearchSource;
  }>;
  parseComputerControlRequest(message: string): any;
  parseHomeAssistantRequest(message: string): any;
  executeComputerControl(action: any): Promise<string>;
  sendEmail(input: { to: string; subject: string; body: string }): Promise<void>;
  openMailtoDraft(mailtoUrl: string): void;
  buildMailtoUrl(input: { to: string; subject: string; body: string }): string;
  getDirectDateTimeAnswer(message: string): string | null;
  rememberMemory(text: string, tags?: string[], source?: string): {
    result: string;
    entry: AgentMemoryEntry;
  };
  recallMemory(query: string, limit?: number): {
    result: string;
    items: AgentMemoryEntry[];
  };
  writeJsonRecord(kind: string, label: string, data: Record<string, any>): {
    result: string;
    record: AgentOutputRecord;
  };
};

const plannerMessageSchema = z.object({
  goal: z.string().default(""),
  summary: z.string().default(""),
  actions: z
    .array(
      z.object({
        owner: z.enum(["research-agent", "operations-agent"]).default("research-agent"),
        tool: z.enum(AGENT_TOOL_NAME_VALUES),
        request: z.string().default(""),
        title: z.string().default(""),
        description: z.string().default(""),
        args: z.record(z.string(), z.any()).default({}),
      })
    )
    .max(6)
    .default([]),
});

const queueItemSchema = z.object({
  id: z.string(),
  owner: z.enum(["research-agent", "operations-agent"]),
  tool: z.enum(AGENT_TOOL_NAME_VALUES),
  title: z.string(),
  description: z.string(),
  request: z.string(),
  args: z.record(z.string(), z.any()).default({}),
  safetyTier: z.enum(["safe", "confirm", "blocked"]),
  status: z.enum([
    "planned",
    "pending_approval",
    "approved",
    "rejected",
    "blocked",
    "completed",
    "failed",
    "skipped",
  ]),
  canEdit: z.boolean().default(false),
  result: z.string().optional(),
  error: z.string().optional(),
});

const traceSchema = z.object({
  step: z.number(),
  title: z.string(),
  detail: z.string(),
  status: z.enum(["ok", "error"]),
});

const sourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string().default(""),
});

const workflowInputSchema = z.object({
  model: z.string().min(1),
  messages: z.array(
    z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string(),
    })
  ),
  useInternet: z.boolean().default(false),
  temperature: z.number().default(0.7),
  maxTokens: z.number().default(500),
});

const workflowStateSchema = z.object({
  goal: z.string().default(""),
  summary: z.string().default(""),
  actionQueue: z.array(queueItemSchema).default([]),
  reasoningTrace: z.array(traceSchema).default([]),
  sources: z.array(sourceSchema).default([]),
});

const workflowOutputSchema = z.object({
  message: z.string(),
  actionQueue: z.array(queueItemSchema),
  sources: z.array(sourceSchema),
  reasoningTrace: z.array(traceSchema),
});

const approvalDecisionSchema = z.object({
  id: z.string(),
  decision: z.enum(["approve", "reject"]),
  editedArgs: z.record(z.string(), z.any()).optional(),
});

const reviewOutputSchema = z.object({
  actionQueue: z.array(queueItemSchema),
});

function lastUserMessage(messages: AgentLlmMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user")?.content || "";
}

function compactText(value: unknown, maxLength = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function extractFirstUrl(value: string) {
  const match = String(value || "").match(/https?:\/\/[^\s<>"']+/i);
  return match?.[0] || "";
}

function extractJsonBlock(value: string) {
  const fencedMatch = value.match(/```json\s*([\s\S]*?)```/i) || value.match(/```\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const startIndex = value.indexOf("{");
  const endIndex = value.lastIndexOf("}");
  if (startIndex >= 0 && endIndex > startIndex) {
    return value.slice(startIndex, endIndex + 1);
  }

  return value.trim();
}

function parsePlannerOutput(value: string) {
  try {
    return plannerMessageSchema.parse(JSON.parse(extractJsonBlock(value)));
  } catch {
    return {
      goal: "",
      summary: "",
      actions: [],
    };
  }
}

function parseEditedArgs(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, any>;
}

function buildDeterministicPlan(
  input: z.infer<typeof workflowInputSchema>,
  deps: AgentWorkflowDependencies
) {
  const userText = lastUserMessage(input.messages).trim();
  const actions: Array<z.infer<typeof plannerMessageSchema>["actions"][number]> = [];
  const directDateTime = deps.getDirectDateTimeAnswer(userText);
  const computerAction = deps.parseComputerControlRequest(userText);
  const homeAssistantAction = deps.parseHomeAssistantRequest(userText);
  const firstUrl = extractFirstUrl(userText);
  const emailMatch = userText.match(
    /^(send|draft)\s+email\s+to\s+(.+?)(?:\s+subject\s+(.+?))?(?:\s+body\s+([\s\S]+))?$/i
  );

  if (directDateTime) {
    actions.push({
      owner: "research-agent",
      tool: "get_current_datetime",
      request: userText,
      title: "Check local date and time",
      description: "Use the local machine clock instead of guessing.",
      args: {},
    });
  }

  if (emailMatch) {
    actions.push({
      owner: "operations-agent",
      tool: "send_email",
      request: userText,
      title: /^draft/i.test(userText) ? "Draft email" : "Send email",
      description: "Prepare an email action from the user request.",
      args: {
        intent: /^draft/i.test(userText) ? "draft" : "send",
        to: emailMatch[2]?.trim() || "",
        subject: emailMatch[3]?.trim() || "Message from your local assistant",
        body: emailMatch[4]?.trim() || "",
      },
    });
  }

  if (
    firstUrl &&
    /\b(scrape|extract|summarize|inspect|analyze|page|website|webpage|site|url|link)\b/i.test(
      userText
    )
  ) {
    actions.push({
      owner: "research-agent",
      tool: "scrape_webpage",
      request: userText,
      title: "Extract webpage content",
      description: "Fetch and structure the linked webpage before answering.",
      args: {
        url: firstUrl,
      },
    });
  }

  if (homeAssistantAction) {
    actions.push({
      owner: "operations-agent",
      tool: "home_assistant_request",
      request: userText,
      title: "Handle Home Assistant request",
      description: "Run the parsed Home Assistant action requested by the user.",
      args: {
        request: userText,
      },
    });
  }

  if (computerAction) {
    actions.push({
      owner: "operations-agent",
      tool: "computer_control_request",
      request: userText,
      title: "Handle local computer action",
      description: "Run the parsed local computer control request.",
      args: {
        request: userText,
      },
    });
  }

  if (
    /\b(remember|save this|store this|memorize|note this|keep this preference)\b/i.test(userText)
  ) {
    actions.push({
      owner: "operations-agent",
      tool: "remember_memory",
      request: userText,
      title: "Save memory",
      description: "Store a useful fact or preference for future agent turns.",
      args: {
        text: userText
          .replace(/^(remember|save this|store this|memorize|note this)\s*[:\-]?\s*/i, "")
          .trim() || userText,
        tags: ["user-memory"],
      },
    });
  }

  if (/\b(recall|remembered|what do you know about|memory|saved note|saved preference)\b/i.test(userText)) {
    actions.push({
      owner: "research-agent",
      tool: "recall_memory",
      request: userText,
      title: "Recall memory",
      description: "Search long-term memory for related notes and preferences.",
      args: {
        query: userText,
        limit: 5,
      },
    });
  }

  if (/\b(save as json|store as json|write json|export json|persist this)\b/i.test(userText)) {
    actions.push({
      owner: "operations-agent",
      tool: "write_json_record",
      request: userText,
      title: "Write JSON output",
      description: "Persist structured output to the local JSON record store.",
      args: {
        kind: "agent-output",
        label: compactText(userText, 80) || "agent-output",
        data: {
          request: userText,
        },
      },
    });
  }

  if (
    !actions.length &&
    input.useInternet &&
    /\b(search|look up|find|latest|today|current|news|price|weather|compare)\b/i.test(userText)
  ) {
    actions.push({
      owner: "research-agent",
      tool: "search_internet",
      request: userText,
      title: "Search the web",
      description: "Gather current external information before answering.",
      args: {
        query: userText,
      },
    });
  }

  return {
    goal: userText,
    summary: actions.length ? "Prepared a deterministic action plan from the request." : "",
    actions,
  };
}

function buildPlannerPrompt(
  input: z.infer<typeof workflowInputSchema>,
  deps: AgentWorkflowDependencies
) {
  const userText = lastUserMessage(input.messages).trim();
  const recentMessages = input.messages
    .slice(-6)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");
  const systemPrompt =
    input.messages.find((message) => message.role === "system")?.content || "";
  const injectedContext = deps.gateway.buildInjectedContext({
    systemPrompt,
    useInternet: input.useInternet,
    trigger: "custom_prompt",
  });

  return [
    {
      role: "system" as const,
      content:
        "You are the planning stage for a local voice assistant. " +
        "Create a compact JSON action plan, not a final answer. " +
        "Available tools include date/time lookup, internet search, webpage extraction, local computer control, Home Assistant actions, email, memory read/write, and JSON output persistence. " +
        "Use research-agent for time, search, scraping, and memory lookup tasks. Use operations-agent for local computer, Home Assistant, email, memory writes, and JSON record writes. " +
        "Return JSON with keys goal, summary, and actions. Each action must contain owner, tool, request, title, description, and args. " +
        "If no tool is needed, return an empty actions array.\n\n" +
        injectedContext,
    },
    {
      role: "user" as const,
      content:
        `Use internet: ${input.useInternet ? "yes" : "no"}\n` +
        `Recent conversation:\n${recentMessages}\n\n` +
        `Latest user request:\n${userText}`,
    },
  ];
}

function mergeSources(current: AgentSearchSource[], next: AgentSearchSource[]) {
  const seen = new Set(current.map((source) => source.url));
  const merged = [...current];

  next.forEach((source) => {
    if (!source?.url || seen.has(source.url)) {
      return;
    }

    seen.add(source.url);
    merged.push(source);
  });

  return merged;
}

function createQueueItem(
  action: z.infer<typeof plannerMessageSchema>["actions"][number]
): AgentWorkflowActionQueueItem {
  return {
    id: crypto.randomUUID(),
    owner: action.owner,
    tool: action.tool,
    title: action.title || action.tool,
    description: action.description || action.request || action.tool,
    request: action.request || "",
    args: action.args || {},
    safetyTier: "safe",
    status: "planned",
    canEdit: false,
  };
}

function normalizeQueueItem(
  item: AgentWorkflowActionQueueItem,
  deps: AgentWorkflowDependencies
) {
  const nextItem = {
    ...item,
    args: { ...(item.args || {}) },
  };

  switch (item.tool) {
    case "get_current_datetime":
      nextItem.title = "Check local date and time";
      nextItem.description = "Use the computer clock for a grounded time answer.";
      nextItem.safetyTier = "safe";
      nextItem.status = "approved";
      return nextItem;
    case "search_internet": {
      const query =
        typeof nextItem.args.query === "string" && nextItem.args.query.trim()
          ? nextItem.args.query.trim()
          : nextItem.request;
      nextItem.args = { query };
      nextItem.title = nextItem.title || "Search the web";
      nextItem.description = nextItem.description || `Look up "${query}".`;
      nextItem.safetyTier = query ? "safe" : "blocked";
      nextItem.status = query ? "approved" : "blocked";
      nextItem.error = query ? undefined : "A search query is required.";
      return nextItem;
    }
    case "scrape_webpage": {
      const url =
        typeof nextItem.args.url === "string" && nextItem.args.url.trim()
          ? nextItem.args.url.trim()
          : extractFirstUrl(nextItem.request);
      nextItem.args = { url };
      nextItem.title = nextItem.title || "Extract webpage content";
      nextItem.description = nextItem.description || `Scrape and summarize ${url}.`;
      nextItem.safetyTier = url ? "safe" : "blocked";
      nextItem.status = url ? "approved" : "blocked";
      nextItem.error = url ? undefined : "A webpage URL is required.";
      return nextItem;
    }
    case "computer_control_request": {
      const request =
        typeof nextItem.args.request === "string" && nextItem.args.request.trim()
          ? nextItem.args.request.trim()
          : nextItem.request;
      const parsed = request ? deps.parseComputerControlRequest(request) : null;
      nextItem.args = { request };
      nextItem.title = nextItem.title || "Run local computer action";
      nextItem.description = nextItem.description || compactText(request);
      nextItem.canEdit = true;

      if (!request || !parsed) {
        nextItem.safetyTier = "blocked";
        nextItem.status = "blocked";
        nextItem.error = "That computer action was not recognized.";
        return nextItem;
      }

      if (parsed.type === "run_command" || parsed.type === "paste_to_codex") {
        nextItem.safetyTier = "blocked";
        nextItem.status = "blocked";
        nextItem.error =
          "Agent mode does not allow arbitrary shell commands or Codex window automation.";
        return nextItem;
      }

      nextItem.safetyTier = "confirm";
      nextItem.status = "pending_approval";
      return nextItem;
    }
    case "home_assistant_request": {
      const request =
        typeof nextItem.args.request === "string" && nextItem.args.request.trim()
          ? nextItem.args.request.trim()
          : nextItem.request;
      const parsed = request ? deps.parseHomeAssistantRequest(request) : null;
      nextItem.args = { request };
      nextItem.title = nextItem.title || "Run Home Assistant action";
      nextItem.description = nextItem.description || compactText(request);
      nextItem.canEdit = true;

      if (!request || !parsed) {
        nextItem.safetyTier = "blocked";
        nextItem.status = "blocked";
        nextItem.error = "That Home Assistant action was not recognized.";
        return nextItem;
      }

      const needsApproval =
        parsed.type === "home_assistant_service" &&
        /(turn_off|unlock|open|close|press|trigger|stop|shutdown|reboot|delete|remove|disarm)/i.test(
          `${parsed.domain || ""}.${parsed.service || ""}`
        );

      nextItem.safetyTier = needsApproval ? "confirm" : "safe";
      nextItem.status = needsApproval ? "pending_approval" : "approved";
      return nextItem;
    }
    case "send_email": {
      const intent = nextItem.args.intent === "draft" ? "draft" : "send";
      const to =
        typeof nextItem.args.to === "string" && nextItem.args.to.trim()
          ? nextItem.args.to.trim()
          : "";
      const subject =
        typeof nextItem.args.subject === "string" && nextItem.args.subject.trim()
          ? nextItem.args.subject.trim()
          : "Message from your local assistant";
      const body =
        typeof nextItem.args.body === "string" ? nextItem.args.body.trim() : "";
      nextItem.args = { intent, to, subject, body };
      nextItem.title = intent === "draft" ? "Draft email" : "Send email";
      nextItem.description = to
        ? `${intent === "draft" ? "Draft" : "Send"} email to ${to}.`
        : "Prepare an email action.";
      nextItem.canEdit = true;

      if (!to) {
        nextItem.safetyTier = "blocked";
        nextItem.status = "blocked";
        nextItem.error = "An email recipient is required.";
        return nextItem;
      }

      nextItem.safetyTier = "confirm";
      nextItem.status = "pending_approval";
      return nextItem;
    }
    case "remember_memory": {
      const text =
        typeof nextItem.args.text === "string" && nextItem.args.text.trim()
          ? nextItem.args.text.trim()
          : nextItem.request;
      const tags = Array.isArray(nextItem.args.tags)
        ? nextItem.args.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
        : [];
      nextItem.args = { text, tags };
      nextItem.title = nextItem.title || "Save memory";
      nextItem.description = nextItem.description || compactText(text);
      nextItem.canEdit = true;
      nextItem.safetyTier = text ? "safe" : "blocked";
      nextItem.status = text ? "approved" : "blocked";
      nextItem.error = text ? undefined : "Memory text is required.";
      return nextItem;
    }
    case "recall_memory": {
      const query =
        typeof nextItem.args.query === "string" && nextItem.args.query.trim()
          ? nextItem.args.query.trim()
          : nextItem.request;
      const limit = Number(nextItem.args.limit) || 5;
      nextItem.args = { query, limit };
      nextItem.title = nextItem.title || "Recall memory";
      nextItem.description = nextItem.description || `Search memory for "${query}".`;
      nextItem.safetyTier = query ? "safe" : "blocked";
      nextItem.status = query ? "approved" : "blocked";
      nextItem.error = query ? undefined : "A memory query is required.";
      return nextItem;
    }
    case "write_json_record": {
      const kind =
        typeof nextItem.args.kind === "string" && nextItem.args.kind.trim()
          ? nextItem.args.kind.trim()
          : "agent-output";
      const label =
        typeof nextItem.args.label === "string" && nextItem.args.label.trim()
          ? nextItem.args.label.trim()
          : compactText(nextItem.request, 80) || "agent-output";
      const data =
        nextItem.args.data && typeof nextItem.args.data === "object" && !Array.isArray(nextItem.args.data)
          ? nextItem.args.data
          : { request: nextItem.request };
      nextItem.args = { kind, label, data };
      nextItem.title = nextItem.title || "Write JSON output";
      nextItem.description = nextItem.description || `Persist a ${kind} JSON record.`;
      nextItem.canEdit = true;
      nextItem.safetyTier = "safe";
      nextItem.status = "approved";
      return nextItem;
    }
    default:
      return nextItem;
  }
}

async function executeQueueItem(
  item: AgentWorkflowActionQueueItem,
  deps: AgentWorkflowDependencies
): Promise<{ result: string; sources: AgentSearchSource[] }> {
  switch (item.tool) {
    case "get_current_datetime":
      return {
        result: deps.getDirectDateTimeAnswer(item.request || "") || new Date().toString(),
        sources: [],
      };
    case "search_internet": {
      const sources = sourceSchema
        .array()
        .parse(await deps.searchInternet(item.args.query || item.request || ""));
      return {
        result: sources.length
          ? `Found ${sources.length} web source${sources.length === 1 ? "" : "s"}.`
          : "I could not find grounded web sources for that request.",
        sources,
      };
    }
    case "scrape_webpage": {
      const scraped = await deps.scrapeWebpage(item.args.url || item.request || "");
      return {
        result: scraped.result,
        sources: [scraped.source],
      };
    }
    case "computer_control_request": {
      const action = deps.parseComputerControlRequest(item.args.request || item.request || "");
      if (!action) {
        throw new Error("That computer action was not recognized.");
      }

      return {
        result: await deps.executeComputerControl(action),
        sources: [],
      };
    }
    case "home_assistant_request": {
      const action = deps.parseHomeAssistantRequest(item.args.request || item.request || "");
      if (!action) {
        throw new Error("That Home Assistant action was not recognized.");
      }

      return {
        result: await deps.executeComputerControl(action),
        sources: [],
      };
    }
    case "send_email": {
      const to = String(item.args.to || "").trim();
      const subject = String(item.args.subject || "Message from your local assistant").trim();
      const body = String(item.args.body || "").trim();
      const intent = item.args.intent === "draft" ? "draft" : "send";

      if (intent === "draft") {
        deps.openMailtoDraft(deps.buildMailtoUrl({ to, subject, body }));
        return {
          result: `I opened an email draft to ${to}.`,
          sources: [],
        };
      }

      await deps.sendEmail({ to, subject, body });
      return {
        result: `I sent the email to ${to}.`,
        sources: [],
      };
    }
    case "remember_memory": {
      const memory = deps.rememberMemory(item.args.text || item.request || "", item.args.tags || []);
      return {
        result: memory.result,
        sources: [],
      };
    }
    case "recall_memory": {
      const memory = deps.recallMemory(item.args.query || item.request || "", item.args.limit || 5);
      return {
        result: memory.items.length
          ? `${memory.result}\n${memory.items
              .map((entry, index) => `${index + 1}. ${entry.text}`)
              .join("\n")}`
          : memory.result,
        sources: [],
      };
    }
    case "write_json_record": {
      const record = deps.writeJsonRecord(
        item.args.kind || "agent-output",
        item.args.label || "agent-output",
        item.args.data || {}
      );
      return {
        result: record.result,
        sources: [],
      };
    }
    default:
      throw new Error("Unsupported action.");
  }
}

function buildSummaryPrompt(params: {
  messages: AgentLlmMessage[];
  queue: AgentWorkflowActionQueueItem[];
  sources: AgentSearchSource[];
  gatewayContext: string;
}) {
  const actionSummary = params.queue
    .map((item) => {
      const parts = [
        `${item.title} [${item.owner}]`,
        `tier=${item.safetyTier}`,
        `status=${item.status}`,
      ];

      if (item.result) {
        parts.push(`result=${item.result}`);
      }

      if (item.error) {
        parts.push(`error=${item.error}`);
      }

      return parts.join(" | ");
    })
    .join("\n");

  const sourceSummary = params.sources
    .map((source, index) => `[${index + 1}] ${source.title} | ${source.url} | ${source.snippet}`)
    .join("\n");

  return [
    {
      role: "system" as const,
      content:
        "You are the summarizer for a local agent workflow. " +
        "Write the final answer for the user after the plan, review, and execution stages. " +
        "Be direct, mention blocked or rejected actions clearly, and cite web sources inline as [1], [2] when they were used.\n\n" +
        params.gatewayContext,
    },
    {
      role: "user" as const,
      content:
        `Conversation:\n${params.messages
          .slice(-6)
          .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
          .join("\n\n")}\n\n` +
        `Action queue:\n${actionSummary || "No actions were executed."}\n\n` +
        `Sources:\n${sourceSummary || "No web sources."}`,
    },
  ];
}

function pushTrace(
  trace: AgentTraceStep[],
  title: string,
  detail: string,
  status: "ok" | "error" = "ok"
) {
  return [
    ...trace,
    {
      step: trace.length + 1,
      title,
      detail,
      status,
    },
  ];
}

export function createMastraAgentOrchestrator(deps: AgentWorkflowDependencies) {
  const storageDir = path.join(deps.appRoot, ".mastra");
  fs.mkdirSync(storageDir, { recursive: true });

  const planStep = createStep({
    id: "plan-agent-actions",
    inputSchema: workflowInputSchema,
    outputSchema: plannerMessageSchema,
    stateSchema: workflowStateSchema,
    execute: async ({ inputData, state, setState }) => {
      const deterministic = buildDeterministicPlan(inputData, deps);
      let plan = deterministic;

      if (!plan.actions.length) {
        const plannerReply = await deps.callModel(buildPlannerPrompt(inputData, deps), {
          model: inputData.model,
          temperature: Math.min(0.4, inputData.temperature || 0.2),
          maxTokens: 600,
        });
        const parsedPlan = parsePlannerOutput(plannerReply);

        if (parsedPlan.actions.length || parsedPlan.summary) {
          plan = parsedPlan;
        }
      }

      await setState({
        ...state,
        goal: plan.goal || lastUserMessage(inputData.messages),
        summary: plan.summary || "",
        reasoningTrace: pushTrace(
          state.reasoningTrace || [],
          "Planned workflow actions",
          plan.actions.length
            ? `Prepared ${plan.actions.length} action${plan.actions.length === 1 ? "" : "s"} for review.`
            : "No tool actions were needed, so the workflow will move to summarizing.",
          "ok"
        ),
      });
      deps.gateway.appendHistory({
        trigger: "custom_prompt",
        stage: "plan",
        summary: plan.actions.length
          ? `Planned ${plan.actions.length} action${plan.actions.length === 1 ? "" : "s"} for ${plan.goal || lastUserMessage(inputData.messages)}.`
          : `No tool actions were needed for ${plan.goal || lastUserMessage(inputData.messages)}.`,
      });

      return plan;
    },
  });

  const reviewStep = createStep({
    id: "review-agent-actions",
    inputSchema: plannerMessageSchema,
    outputSchema: reviewOutputSchema,
    resumeSchema: z.object({
      decisions: z.array(approvalDecisionSchema).default([]),
    }),
    suspendSchema: z.object({
      queue: z.array(queueItemSchema),
      message: z.string(),
      actionCount: z.number(),
    }),
    stateSchema: workflowStateSchema,
    execute: async ({ inputData, resumeData, suspend, state, setState }) => {
      if (resumeData?.decisions?.length) {
        const decisions = new Map(
          resumeData.decisions.map((entry) => [
            entry.id,
            {
              decision: entry.decision,
              editedArgs: parseEditedArgs(entry.editedArgs),
            },
          ])
        );
        const updatedQueue = queueItemSchema.array().parse((state.actionQueue || []).map((item) => {
          if (item.status !== "pending_approval") {
            return item;
          }

          const decision = decisions.get(item.id);
          if (!decision) {
            return {
              ...item,
              status: "rejected",
              result: "Skipped because approval was not provided.",
            };
          }

          return {
            ...item,
            args: decision.editedArgs ? { ...item.args, ...decision.editedArgs } : item.args,
            status: decision.decision === "approve" ? "approved" : "rejected",
            result:
              decision.decision === "approve"
                ? "Approved for execution."
                : "Rejected during human review.",
          };
        }));

        const nextTrace = pushTrace(
          state.reasoningTrace || [],
          "Reviewed queued actions",
          `Processed ${resumeData.decisions.length} approval decision${resumeData.decisions.length === 1 ? "" : "s"}.`,
          "ok"
        );

        await setState({
          ...state,
          actionQueue: updatedQueue,
          reasoningTrace: nextTrace,
        });
        deps.gateway.appendHistory({
          trigger: "custom_prompt",
          stage: "review",
          summary: `Processed ${resumeData.decisions.length} approval decision${resumeData.decisions.length === 1 ? "" : "s"}.`,
        });

        return {
          actionQueue: updatedQueue,
        };
      }

      const normalizedQueue = queueItemSchema
        .array()
        .parse(
          inputData.actions.map(createQueueItem).map((item) => normalizeQueueItem(item, deps))
        );
      const confirmCount = normalizedQueue.filter(
        (item) => item.safetyTier === "confirm" && item.status === "pending_approval"
      ).length;
      const nextTrace = pushTrace(
        state.reasoningTrace || [],
        "Reviewed action safety",
        confirmCount
          ? `Marked ${confirmCount} action${confirmCount === 1 ? "" : "s"} for approval.`
          : "No human approvals were needed.",
        "ok"
      );

      await setState({
        ...state,
        actionQueue: normalizedQueue,
        reasoningTrace: nextTrace,
      });
      deps.gateway.appendHistory({
        trigger: "custom_prompt",
        stage: "review",
        summary: confirmCount
          ? `Prepared ${confirmCount} action${confirmCount === 1 ? "" : "s"} for approval.`
          : "Reviewed the plan and approved all safe actions automatically.",
      });

      if (confirmCount) {
        return await suspend(
          {
            queue: normalizedQueue,
            message: `I prepared ${normalizedQueue.length} action${normalizedQueue.length === 1 ? "" : "s"} and need approval for ${confirmCount} of them.`,
            actionCount: confirmCount,
          },
          { resumeLabel: "approval-review" }
        );
      }

      return {
        actionQueue: normalizedQueue,
      };
    },
  });

  const executeStep = createStep({
    id: "execute-agent-actions",
    inputSchema: reviewOutputSchema,
    outputSchema: z.object({
      actionQueue: z.array(queueItemSchema),
      sources: z.array(sourceSchema),
    }),
    stateSchema: workflowStateSchema,
    execute: async ({ inputData, state, setState }) => {
      let actionQueue = [...(inputData.actionQueue || [])];
      let sources = [...(state.sources || [])];
      let trace = [...(state.reasoningTrace || [])];

      for (let index = 0; index < actionQueue.length; index += 1) {
        const item = actionQueue[index];

        if (item.status === "blocked") {
          actionQueue[index] = {
            ...item,
            result: item.result || "Blocked by the workflow safety policy.",
          };
          continue;
        }

        if (item.status === "rejected") {
          actionQueue[index] = {
            ...item,
            result: item.result || "Skipped during review.",
          };
          continue;
        }

        if (item.status !== "approved") {
          actionQueue[index] = {
            ...item,
            status: "skipped",
            result: item.result || "Skipped because it was not approved for execution.",
          };
          continue;
        }

        try {
          const result = await executeQueueItem(item, deps);
          sources = mergeSources(sources, result.sources || []);
          actionQueue[index] = {
            ...item,
            status: "completed",
            result: result.result,
          };
          trace = pushTrace(
            trace,
            item.title,
            result.result || "Completed queued action.",
            "ok"
          );
          deps.gateway.appendHistory({
            trigger: "custom_prompt",
            stage: "execute",
            summary: `${item.title}: ${result.result || "Completed queued action."}`,
          });
        } catch (error: any) {
          actionQueue[index] = {
            ...item,
            status: "failed",
            error: error.message,
            result: "Execution failed.",
          };
          trace = pushTrace(
            trace,
            item.title,
            error.message || "Execution failed.",
            "error"
          );
          deps.gateway.appendHistory({
            trigger: "custom_prompt",
            stage: "execute",
            summary: `${item.title}: ${error.message || "Execution failed."}`,
          });
        }

        await setState({
          ...state,
          actionQueue,
          sources,
          reasoningTrace: trace,
        });
      }

      await setState({
        ...state,
        actionQueue,
        sources,
        reasoningTrace: trace,
      });

      return {
        actionQueue,
        sources,
      };
    },
  });

  const summarizeStep = createStep({
    id: "summarize-agent-run",
    inputSchema: z.object({
      actionQueue: z.array(queueItemSchema),
      sources: z.array(sourceSchema),
    }),
    outputSchema: workflowOutputSchema,
    stateSchema: workflowStateSchema,
    execute: async ({ inputData, getInitData, state, setState }) => {
      const initData = getInitData<z.infer<typeof workflowInputSchema>>();
      const summaryText = await deps.callModel(
        buildSummaryPrompt({
          messages: initData.messages,
          queue: inputData.actionQueue,
          sources: inputData.sources,
          gatewayContext: deps.gateway.buildInjectedContext({
            systemPrompt: initData.messages.find((message) => message.role === "system")?.content || "",
            useInternet: initData.useInternet,
            trigger: "custom_prompt",
          }),
        }),
        {
          model: initData.model,
          temperature: Math.min(0.5, initData.temperature || 0.2),
          maxTokens: Math.max(300, initData.maxTokens || 500),
        }
      );
      const finalTrace = pushTrace(
        state.reasoningTrace || [],
        "Summarized workflow result",
        "Prepared the final response after review and execution.",
        "ok"
      );

      await setState({
        ...state,
        actionQueue: inputData.actionQueue,
        sources: inputData.sources,
        reasoningTrace: finalTrace,
      });
      deps.gateway.appendHistory({
        trigger: "custom_prompt",
        stage: "summary",
        summary: compactText(summaryText, 360) || "Prepared a final workflow summary.",
      });

      return {
        message: summaryText.trim() || "I finished the workflow, but the final summary was empty.",
        actionQueue: inputData.actionQueue,
        sources: inputData.sources,
        reasoningTrace: finalTrace,
      };
    },
  });

  const workflow = createWorkflow({
    id: "controlled-agent-workflow",
    inputSchema: workflowInputSchema,
    outputSchema: workflowOutputSchema,
    stateSchema: workflowStateSchema,
  })
    .then(planStep)
    .then(reviewStep)
    .then(executeStep)
    .then(summarizeStep)
    .commit();

  const mastra = new Mastra({
    workflows: {
      controlledAgentWorkflow: workflow,
    },
    storage: new LibSQLStore({
      id: "assistant-agent-store",
      url: "file:.mastra/assistant-agent.db",
    }),
  });

  const controlledWorkflow = mastra.getWorkflow("controlledAgentWorkflow");

  function buildResponseFromResult(
    result: any,
    runId: string
  ): AgentWorkflowResponse {
    if (result.status === "suspended") {
      const queue = queueItemSchema
        .array()
        .parse(result.state?.actionQueue || result.suspendPayload?.queue || []);
      const trace = traceSchema.array().parse(result.state?.reasoningTrace || []);
      const sources = sourceSchema.array().parse(result.state?.sources || []);
      const pendingCount = queue.filter((item) => item.status === "pending_approval").length;
      return {
        message:
          result.suspendPayload?.message ||
          `I prepared an action plan and need approval for ${pendingCount} action${pendingCount === 1 ? "" : "s"}.`,
        actionQueue: queue,
        sources,
        reasoningTrace: trace,
        pendingApproval: pendingCount
          ? {
              runId,
              actionCount: pendingCount,
              label: "approval-review",
            }
          : null,
        runId,
      };
    }

    if (result.status === "success") {
      const payload = workflowOutputSchema.parse(result.result);
      return {
        ...payload,
        pendingApproval: null,
        runId,
      };
    }

    const queue = queueItemSchema.array().parse(result.state?.actionQueue || []);
    const trace = traceSchema.array().parse(result.state?.reasoningTrace || []);
    const sources = sourceSchema.array().parse(result.state?.sources || []);
    return {
      message:
        result?.error?.message ||
        "The agent workflow could not finish this request.",
      actionQueue: queue,
      sources,
      reasoningTrace: trace,
      pendingApproval: null,
      runId,
    };
  }

  return {
    async start(input: z.infer<typeof workflowInputSchema>) {
      const run = await controlledWorkflow.createRun({
        runId: crypto.randomUUID(),
      });
      const result = await run.start({
        inputData: input,
        initialState: {
          goal: "",
          summary: "",
          actionQueue: [],
          reasoningTrace: [],
          sources: [],
        },
        outputOptions: {
          includeState: true,
          includeResumeLabels: true,
        },
      });

      return buildResponseFromResult(result, run.runId);
    },
    async resume(input: {
      runId: string;
      decisions: Array<z.infer<typeof approvalDecisionSchema>>;
    }) {
      const run = await controlledWorkflow.createRun({
        runId: input.runId,
      });
      const result = await run.resume({
        label: "approval-review",
        resumeData: {
          decisions: input.decisions,
        },
        outputOptions: {
          includeState: true,
          includeResumeLabels: true,
        },
      });

      return buildResponseFromResult(result, run.runId);
    },
  };
}
