/**
 * Notion stream extractor — parses NDJSON response from `runInferenceTranscript`
 * and yields text/tool-call deltas for OpenAI streaming output.
 *
 * Per docs/notion/wire-format.md §2.3, the response is NDJSON of
 * `{type, data?, v?}` operations. The stream builds up a state object
 * representing the response document; we track each `agent-inference` record's
 * `value[0].content` field and emit a delta whenever that content grows.
 *
 * `agent-tool-result` records are emitted as `toolCall` deltas (tool name +
 * input args + result).
 *
 * Implementation note: We implement a minimal JSON-Patch subset (just `a`
 * append and `x` patch-value) sufficient for Notion's stream. The full
 * fast-json-patch library is not required.
 */

export interface TextDelta {
  delta: string;
  done: boolean;
  toolCall?: {
    id: string;
    name: string;
    arguments: string;
  };
}

interface AgentInferenceValue {
  type: 'text';
  content: string;
}

interface AgentInferenceRecord {
  id: string;
  type: 'agent-inference';
  value: AgentInferenceValue[];
  traceId?: string;
}

interface AgentToolResultRecord {
  id: string;
  type: 'agent-tool-result';
  toolName: string;
  toolType: string;
  traceId?: string;
  input?: { function?: string; args?: unknown };
  state?: string;
  result?: { output?: string };
}

type StateRecord = AgentInferenceRecord | AgentToolResultRecord | { id: string; type: string; [k: string]: unknown };

interface NotionState {
  s: StateRecord[];
}

/**
 * Apply a single JSON-Patch op to state. Supports only the ops Notion emits:
 * - `o: "a"` (append) at path `p`
 * - `o: "x"` (patch value) at path `p` with `v`
 */
function applyPatchOp(state: NotionState, op: { o: string; p: string; v?: unknown }): void {
  const path = op.p;
  if (op.o === 'a') {
    // Append: /s/- → push v onto s array
    if (path === '/s/-' && op.v !== undefined) {
      state.s.push(op.v as StateRecord);
      return;
    }
    // Append at deeper path: /s/<idx>/<key>/-
    const m = path.match(/^\/s\/(\d+)\/(.+)\/-$/);
    if (m) {
      const idx = Number(m[1]);
      const keyPath = m[2];
      const target = getNested(state.s[idx], keyPath);
      if (Array.isArray(target) && op.v !== undefined) {
        target.push(op.v);
      }
      return;
    }
  }
  if (op.o === 'x') {
    // Patch value at path: /s/<idx>/<...key path>
    const m = path.match(/^\/s\/(\d+)\/(.+)$/);
    if (m) {
      const idx = Number(m[1]);
      const keyPath = m[2];
      setNested(state.s[idx], keyPath, op.v);
      return;
    }
  }
}

function getNested(obj: unknown, keyPath: string): unknown {
  const parts = keyPath.split('/');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function setNested(obj: unknown, keyPath: string, value: unknown): void {
  const parts = keyPath.split('/');
  let cur: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur || typeof cur !== 'object') return;
    cur = (cur as Record<string, unknown>)[parts[i]!];
  }
  if (!cur || typeof cur !== 'object') return;
  (cur as Record<string, unknown>)[parts[parts.length - 1]!] = value;
}

/** Read a NDJSON response body line-by-line and apply patches. */
export async function* extractNotionStream(response: Response): AsyncIterable<TextDelta> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const state: NotionState = { s: [] };

  const processPatchOps = (ops: Array<{ o: string; p: string; v?: unknown }>): TextDelta[] => {
    const out: TextDelta[] = [];
    for (const op of ops) {
      const beforeContents = snapshotInferenceContents(state.s);
      applyPatchOp(state, op);
      for (const d of emitContentDiffs(state.s, beforeContents)) out.push(d);
      for (const d of emitToolResults(state.s)) out.push(d);
    }
    return out;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        if (buffer.trim()) {
          const trimmed = buffer.trim();
          buffer = '';
          const ev = parseLine(trimmed);
          if (ev && ev.type === 'patch' && Array.isArray(ev.v)) {
            for (const d of processPatchOps(ev.v)) yield d;
          } else if (ev && ev.type === 'done') {
            yield { delta: '', done: true };
            return;
          }
        }
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let obj: unknown;
        try {
          obj = JSON.parse(trimmed);
        } catch {
          continue;
        }
        const ev = obj as { type?: string; data?: { s?: StateRecord[] }; v?: Array<{ o: string; p: string; v?: unknown }>; version?: number };

        if (ev.type === 'patch-start' && ev.data?.s) {
          state.s = ev.data.s;
          continue;
        }
        if (ev.type === 'patch' && Array.isArray(ev.v)) {
          for (const d of processPatchOps(ev.v)) yield d;
          continue;
        }
        if (ev.type === 'done') {
          yield { delta: '', done: true };
          return;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseLine(line: string): { type: string; v?: Array<{ o: string; p: string; v?: unknown }> } | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function snapshotInferenceContents(s: StateRecord[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const rec of s) {
    if (rec.type === 'agent-inference' && Array.isArray(rec.value)) {
      const inf = rec as AgentInferenceRecord;
      const content = inf.value[0]?.content ?? '';
      out.set(inf.id, content);
    }
  }
  return out;
}

function* emitContentDiffs(s: StateRecord[], before: Map<string, string>): Generator<TextDelta> {
  for (const rec of s) {
    if (rec.type !== 'agent-inference') continue;
    const inf = rec as AgentInferenceRecord;
    const prev = before.get(inf.id) ?? '';
    const next = inf.value[0]?.content ?? '';
    if (next !== prev && next.startsWith(prev)) {
      const delta = next.slice(prev.length);
      if (delta) yield { delta, done: false };
    } else if (next !== prev) {
      // Non-prefix change (rare; e.g. reset). Emit the new content as delta.
      yield { delta: next, done: false };
    }
  }
}

function* emitToolResults(s: StateRecord[]): Generator<TextDelta> {
  for (const rec of s) {
    if (rec.type !== 'agent-tool-result') continue;
    const tool = rec as AgentToolResultRecord;
    const name = tool.input?.function ?? tool.toolName;
    yield {
      delta: '',
      done: false,
      toolCall: {
        id: rec.id,
        name,
        arguments: JSON.stringify(tool.input?.args ?? {}),
      },
    };
  }
}