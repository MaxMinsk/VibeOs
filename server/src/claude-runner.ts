import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_BIN } from "./config.js";
import { getSystemPrompt } from "./prompt-builder.js";

export interface RunOpts {
  /** The user/turn prompt (launch brief or follow-up action). */
  prompt: string;
  /** Resume an existing app session (per-window continuity). */
  resumeSessionId?: string;
  /** Override the model (e.g. a fast model for patches). Empty → default. */
  model?: string;
  /** Called with each streamed text chunk. */
  onDelta?: (chunk: string) => void;
}

export interface RunResult {
  text: string;
  /** Claude Code session id — store it to resume this app window later. */
  sessionId: string | null;
  /** Tokens read from the prompt cache (for observability). */
  cacheReadTokens?: number;
}

/**
 * Run one app-generation turn through local Claude Code. Tools are disabled: we
 * want pure UI text generation, not a coding agent. Our Design System contract
 * fully replaces the default system prompt.
 */
export async function runApp(opts: RunOpts): Promise<RunResult> {
  const options: Options = {
    systemPrompt: getSystemPrompt(),
    permissionMode: "bypassPermissions",
    allowedTools: [],
    // Isolation: don't load the user's settings, CLAUDE.md, skills, or MCP
    // servers. We only want a clean UI generator — no corporate MCP gateways.
    settingSources: [],
    strictMcpConfig: true,
    includePartialMessages: true, // emit token-level deltas for live preview
    pathToClaudeCodeExecutable: CLAUDE_BIN,
    ...(opts.model ? { model: opts.model } : {}),
    ...(opts.resumeSessionId ? { resume: opts.resumeSessionId } : {}),
  };

  let text = "";
  let sessionId: string | null = opts.resumeSessionId ?? null;
  let cacheReadTokens: number | undefined;

  for await (const message of query({ prompt: opts.prompt, options })) {
    const m = message as any;
    if (m.session_id) sessionId = m.session_id;
    const usage = m.usage || m.message?.usage;
    if (usage?.cache_read_input_tokens != null)
      cacheReadTokens = usage.cache_read_input_tokens;

    // Token-level streaming events → live preview deltas.
    if (m.type === "stream_event") {
      const ev = m.event;
      if (
        ev?.type === "content_block_delta" &&
        ev.delta?.type === "text_delta" &&
        ev.delta.text
      ) {
        opts.onDelta?.(ev.delta.text);
      }
      continue;
    }

    // Final assistant message → authoritative text.
    if (m.type === "assistant" && m.message?.content) {
      for (const part of m.message.content) {
        if (part.type === "text" && part.text) text += part.text;
      }
    }

    if (m.type === "result" && m.subtype && m.subtype !== "success") {
      throw new Error(`Claude run failed: ${m.subtype}`);
    }
  }

  return { text, sessionId, cacheReadTokens };
}
