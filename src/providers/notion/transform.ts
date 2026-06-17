/**
 * Notion transformer — build the JSON body for `runInferenceTranscript` from
 * an OpenAI-format chat-completion request.
 *
 * Per docs/notion/wire-format.md §2.2, the request body is a single JSON
 * object with `traceId`, `spaceId`, `transcript[]`, and `patches[]`. The
 * transcript contains records describing the conversation state:
 *   - config (feature flags + model selection)
 *   - agent-instruction-state (root conversation metadata)
 *   - agent-turn-full-record-map (parent for this turn)
 *   - attachment (one per image/file attached)
 *   - agent-inference (one per message)
 *
 * Output is JSON-stringified and sent as the request body. The router streams
 * back the NDJSON response via extract.ts.
 */
import { randomUUID } from 'node:crypto';
import { NOTION_MODEL_TABLE } from './constants.js';

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface NotionAttachment {
  fileUrl: string;
  fileName: string;
  contentType: string;
  width?: number;
  height?: number;
  fileSizeBytes?: number;
  numPages?: number;
}

export interface BuildPayloadOptions {
  openaiMessages: OpenAIMessage[];
  internalModelId: string;
  spaceId: string;
  attachments?: NotionAttachment[];
  /** Override the user-facing alias (for logging only). */
  aliasHint?: string;
}

export interface BuildPayloadResult {
  body: string;
  traceId: string;
}

/**
 * Default feature flags copied from capture. Notion validates these against
 * the user's account tier (some require enterprise plan).
 */
function buildConfigRecord(modelId: string) {
  // Suppress unused-import warning while keeping the model table reachable
  // for future capability-based flag selection.
  void NOTION_MODEL_TABLE;
  return {
    id: randomUUID(),
    type: 'config',
    value: {
      type: 'workflow',
      model: modelId,
      modelFromUser: true,
      enableAgentAutomations: true,
      enableAgentIntegrations: true,
      enableCustomAgents: true,
      enableExperimentalIntegrations: false,
      enableAgentDiffs: true,
      enableCsvAttachmentSupport: true,
      enableAgentThreadTools: false,
      enableCrdtOperations: false,
      enableAgentCardCustomization: true,
      enableSystemPromptAsPage: false,
      enableUserSessionContext: false,
      enableLargeToolResultComputerOffload: false,
      enableScriptAgentAdvanced: false,
      enableScriptAgent: true,
      enableScriptAgentSearchConnectorsInCustomAgent: false,
      enableScriptAgentGoogleDriveInCustomAgent: false,
      enableScriptAgentGoogleDriveOAuthInCustomAgent: false,
      enableScriptAgentSlack: true,
      enableScriptAgentMcpServers: false,
      enableScriptAgentGtm: false,
      enableComputer: true,
      enableCreateAndRunThread: true,
      enableSoftwareFactoryPage: false,
      enableAgentGenerateImage: true,
      enableQueryCalendar: false,
      enableQueryMail: false,
      enableMailExplicitToolCalls: true,
      enableMailNotificationPreferences: false,
      enableMailAgentMultiProviderSupport: false,
      useRulePrioritization: true,
      availableConnectors: [],
      searchScopes: [{ type: 'everything' }],
      useWebSearch: true,
      isHipaa: false,
      internetAccess: false,
      useReadOnlyMode: false,
      writerMode: false,
    },
  };
}

function buildInstructionStateRecord() {
  return {
    id: randomUUID(),
    type: 'agent-instruction-state',
    owner: 'regular',
    root: { type: 'none' },
    sources: [],
    selectedSkillPageIds: [],
    trackedInstructionTreePages: [],
  };
}

function buildTurnMapRecord() {
  return {
    id: randomUUID(),
    type: 'agent-turn-full-record-map',
    value: {},
  };
}

function buildAttachmentRecord(att: NotionAttachment) {
  const metadata: Record<string, unknown> = {
    moderation: { status: 'passed' },
    guardrail: { attachmentRisk: 'skipped', inferenceId: randomUUID() },
  };
  if (att.width !== undefined) metadata.width = att.width;
  if (att.height !== undefined) metadata.height = att.height;
  if (att.fileSizeBytes !== undefined) metadata.fileSizeBytes = att.fileSizeBytes;
  if (att.numPages !== undefined) metadata.numPages = att.numPages;
  if (att.fileSizeBytes !== undefined) {
    metadata.aiTraceId = randomUUID();
  }
  return {
    id: randomUUID(),
    type: 'attachment',
    fileUrl: att.fileUrl,
    fileName: att.fileName,
    contentType: att.contentType,
    metadata,
  };
}

function buildInferenceRecord(role: string, content: string, traceId: string) {
  const now = Date.now();
  return {
    id: randomUUID(),
    type: 'agent-inference',
    value: [{ type: 'text', content }],
    traceId: role === 'user' ? traceId : randomUUID(),
    startedAt: now,
    previousAttemptValues: [],
  };
}

export function buildNotionPayload(opts: BuildPayloadOptions): BuildPayloadResult {
  const traceId = randomUUID();
  const transcript: unknown[] = [];

  transcript.push(buildConfigRecord(opts.internalModelId));
  transcript.push(buildInstructionStateRecord());
  transcript.push(buildTurnMapRecord());

  if (opts.attachments) {
    for (const att of opts.attachments) {
      transcript.push(buildAttachmentRecord(att));
    }
  }

  for (const msg of opts.openaiMessages) {
    transcript.push(buildInferenceRecord(msg.role, msg.content, traceId));
  }

  const body = JSON.stringify({
    traceId,
    spaceId: opts.spaceId,
    transcript,
    patches: [],
  });

  return { body, traceId };
}
