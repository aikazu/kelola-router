/**
 * Format conversion between OpenAI and Anthropic request/response shapes.
 *
 * Why: hermes-agent and claude-code use Anthropic SDK natively; many other
 * clients (OpenAI SDK, raw OpenAI compat) use OpenAI shapes. The router must
 * keep both shapes working regardless of which upstream it picks.
 *
 * Scope: bodies + non-stream responses. Stream chunk conversion is
 * deferred (passthrough preserves the upstream shape end-to-end).
 */

const OPENAI_ONLY_PARAMS = [
  "n", "logprobs", "frequency_penalty", "presence_penalty", "logit_bias",
  "top_logprobs", "response_format", "service_tier", "store", "parallel_tool_calls",
  "user",
] as const;

const ANTHROPIC_ONLY_PARAMS = [
  "metadata", "mcp_servers", "context_management", "container", "stop_sequences",
  "top_k",
] as const;

/* ──────────────── Body: OpenAI → Anthropic ──────────────── */

export function bodyOpenAIToAnthropic(body: any): any {
  const out: any = { ...body };

  // max_completion_tokens is OpenAI's preferred name; Anthropic uses max_tokens.
  if (out.max_completion_tokens !== undefined && out.max_tokens === undefined) {
    out.max_tokens = out.max_completion_tokens;
  }
  delete out.max_completion_tokens;

  // Drop OpenAI-only params.
  for (const k of OPENAI_ONLY_PARAMS) delete out[k];

  // tools: unwrap {type:"function", function:{...}} → {name, description, input_schema}
  if (Array.isArray(out.tools)) {
    out.tools = out.tools.map((t: any) => {
      if (t && t.type === "function" && t.function) {
        const { name, description, parameters, ...rest } = t.function;
        return { name, description, input_schema: parameters ?? { type: "object" }, ...stripUndef(rest) };
      }
      return t;
    });
  }

  // tool_choice: string|object → Anthropic object
  if (typeof out.tool_choice === "string") {
    out.tool_choice = { type: out.tool_choice === "required" ? "any" : out.tool_choice };
  } else if (out.tool_choice && typeof out.tool_choice === "object") {
    if (out.tool_choice.type === "function" && out.tool_choice.function?.name) {
      out.tool_choice = { type: "tool", name: out.tool_choice.function.name };
    }
  }

  return out;
}

/* ──────────────── Body: Anthropic → OpenAI ──────────────── */

export function bodyAnthropicToOpenAI(body: any): any {
  const out: any = { ...body };

  // Drop Anthropic-only top-level params.
  for (const k of ANTHROPIC_ONLY_PARAMS) delete out[k];

  // System prompt moves into messages[0] (Anthropic has it top-level).
  if (typeof out.system === "string" || Array.isArray(out.system)) {
    const messages = Array.isArray(out.messages) ? [...out.messages] : [];
    messages.unshift({ role: "system", content: out.system });
    out.messages = messages;
    delete out.system;
  }

  // tools: {name, description, input_schema} → {type:"function", function:{...}}
  if (Array.isArray(out.tools)) {
    out.tools = out.tools.map((t: any) => {
      if (!t) return t;
      const { name, description, input_schema, ...rest } = t;
      return {
        type: "function",
        function: {
          name,
          description,
          parameters: input_schema ?? { type: "object" },
          ...stripUndef(rest),
        },
      };
    });
  }

  // tool_choice: Anthropic object → OpenAI string|object
  if (out.tool_choice && typeof out.tool_choice === "object") {
    const tc = out.tool_choice;
    if (tc.type === "auto" || tc.type === "none") {
      out.tool_choice = tc.type;
    } else if (tc.type === "any") {
      out.tool_choice = "required";
    } else if (tc.type === "tool" && tc.name) {
      out.tool_choice = { type: "function", function: { name: tc.name } };
    }
  }

  // max_tokens: mirror to max_completion_tokens (OpenAI preferred, accepted alongside max_tokens)
  if (typeof out.max_tokens === "number" && out.max_completion_tokens === undefined) {
    out.max_completion_tokens = out.max_tokens;
  }

  return out;
}

/* ──────────────── Response: OpenAI → Anthropic ──────────────── */

const FINISH_REASON_TO_STOP: Record<string, string> = {
  stop: "end_turn",
  length: "max_tokens",
  content_filter: "refusal",
  tool_calls: "tool_use",
  function_call: "tool_use", // legacy
};

export function responseOpenAIToAnthropic(resp: any): any {
  const choice = resp?.choices?.[0];
  if (!choice) return resp;
  const msg = choice.message ?? {};
  const blocks: any[] = [];

  if (msg.reasoning_content) {
    blocks.push({ type: "thinking", thinking: msg.reasoning_content });
  }
  if (msg.content) {
    blocks.push({ type: "text", text: msg.content });
  }
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    for (const tc of msg.tool_calls) {
      const fn = tc.function ?? {};
      let input: any = {};
      try { input = JSON.parse(fn.arguments ?? "{}"); } catch { input = { _raw: fn.arguments }; }
      blocks.push({ type: "tool_use", id: tc.id, name: fn.name, input });
    }
  }

  return {
    id: resp.id,
    type: "message",
    role: "assistant",
    model: resp.model,
    content: blocks,
    stop_reason: FINISH_REASON_TO_STOP[choice.finish_reason] ?? "end_turn",
    stop_sequence: null,
    usage: resp.usage ? openAIToAnthropicUsage(resp.usage) : undefined,
  };
}

function openAIToAnthropicUsage(u: any): any {
  return {
    input_tokens: u.prompt_tokens ?? 0,
    output_tokens: u.completion_tokens ?? 0,
    cache_creation_input_tokens: u.cache_creation_tokens ?? 0,
    cache_read_input_tokens: u.prompt_tokens_details?.cached_tokens ?? 0,
  };
}

/* ──────────────── Response: Anthropic → OpenAI ──────────────── */

const STOP_REASON_TO_FINISH: Record<string, string> = {
  end_turn: "stop",
  max_tokens: "length",
  refusal: "content_filter",
  tool_use: "tool_calls",
};

export function responseAnthropicToOpenAI(resp: any): any {
  const content = Array.isArray(resp?.content) ? resp.content : [];
  const textParts: string[] = [];
  const reasoningParts: string[] = [];
  const toolCalls: any[] = [];
  for (const block of content) {
    if (!block) continue;
    if (block.type === "text") textParts.push(block.text ?? "");
    else if (block.type === "thinking") reasoningParts.push(block.thinking ?? "");
    else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      });
    }
  }
  return {
    id: resp.id,
    object: "chat.completion",
    created: resp.created ?? Math.floor(Date.now() / 1000),
    model: resp.model,
    choices: [{
      index: 0,
      finish_reason: STOP_REASON_TO_FINISH[resp.stop_reason] ?? "stop",
      message: {
        role: "assistant",
        content: textParts.join("") || null,
        ...(reasoningParts.length > 0 ? { reasoning_content: reasoningParts.join("") } : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
    }],
    usage: resp.usage ? anthropicToOpenAIUsage(resp.usage) : undefined,
  };
}

function anthropicToOpenAIUsage(u: any): any {
  return {
    prompt_tokens: u.input_tokens ?? 0,
    completion_tokens: u.output_tokens ?? 0,
    total_tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
    cache_creation_tokens: u.cache_creation_input_tokens ?? 0,
    prompt_tokens_details: u.cache_read_input_tokens
      ? { cached_tokens: u.cache_read_input_tokens }
      : undefined,
  };
}

/* ──────────────── OpenAI stream: auto-include_usage ──────────────── */

/**
 * Ensure OpenAI streaming requests include `stream_options.include_usage=true`
 * so the final chunk carries usage. Idempotent: respects an explicit
 * client choice (even false) by not overwriting.
 */
export function bodyAddsOpenAIStreamUsage(body: any): any {
  if (body?.stream !== true) return body;
  if (body.stream_options && "include_usage" in body.stream_options) return body;
  return { ...body, stream_options: { ...(body.stream_options ?? {}), include_usage: true } };
}

/* ──────────────── util ──────────────── */

function stripUndef(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) if (o[k] !== undefined) out[k] = o[k];
  return out;
}
