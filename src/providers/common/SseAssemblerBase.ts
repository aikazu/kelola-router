/**
 * SseAssemblerBase — abstract template-method skeleton for SSE assemblers.
 *
 * Concrete subclasses (Tasks 26 & 27):
 *   - KiroAnthropicAssembler     (TInput = KiroEvent)
 *   - OpenAIToAnthropicSSEAssembler (TInput = OpenAIStreamChunk)
 *
 * Both emit Anthropic SSE events:
 *   message_start
 *   (content_block_start / content_block_delta* / content_block_stop)*
 *   message_delta
 *   message_stop
 *
 * Shared state machine (concrete, NOT abstract):
 *   ensureStart()  — emits message_start once
 *   closeBlock()   — emits content_block_stop for the open block
 *   openBlock()    — close + incr index + emit content_block_start
 *
 * Subclass hooks (abstract — each assembler fills these in):
 *   createStartEvent()
 *   createBlockEvent(input)
 *   createDeltaEvent(input)
 *   createFinishEvent()
 *   getErrorEvent(err)
 */

import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface AnthropicEvent {
  event: string;
  data: Record<string, unknown>;
}

type BlockType = 'thinking' | 'text' | 'tool_use';

// ---------------------------------------------------------------------------
// Base class
// ---------------------------------------------------------------------------

export abstract class SseAssemblerBase<TInput> {
  // -- shared state machine --------------------------------------------------
  protected readonly messageId = `msg_${randomUUID().replace(/-/g, '')}`;
  protected readonly model: string;

  private started = false;
  private stopped = false;
  protected blockIndex = -1;
  protected current: BlockType | null = null;

  // -- output queue for async iteration --------------------------------------
  private readonly queue: AnthropicEvent[] = [];
  private readonly waiting: Array<(ev: AnthropicEvent) => void> = [];

  // ---------------------------------------------------------------------------
  // Subclass hooks (abstract — implement in concrete assembler)
  // ---------------------------------------------------------------------------

  /** Emit the message_start event payload. */
  protected abstract createStartEvent(): AnthropicEvent;

  /**
   * Emit a content_block_start event for the given input.
   * Return null to skip opening a block (e.g. no relevant content in input).
   */
  protected abstract createBlockEvent(input: TInput): AnthropicEvent | null;

  /**
   * Emit a content_block_delta event for the given input.
   * Return null when input carries no delta-worthy content.
   */
  protected abstract createDeltaEvent(input: TInput): AnthropicEvent | null;

  /** Emit message_delta + message_stop. */
  protected abstract createFinishEvent(): AnthropicEvent[];

  /** Wrap an upstream error as an Anthropic error event. */
  protected abstract getErrorEvent(err: unknown): AnthropicEvent;

  // ---------------------------------------------------------------------------
  // Shared state-machine methods (concrete — identical in both assemblers)
  // ---------------------------------------------------------------------------

  protected constructor(model: string) {
    this.model = model;
  }

  /** Emit message_start once (idempotent). */
  protected ensureStart(): void {
    if (this.started) return;
    this.started = true;
    this.push(this.createStartEvent());
  }

  /** Emit content_block_stop for the currently-open block. */
  protected closeBlock(): void {
    if (this.current === null) return;
    this.push({
      event: 'content_block_stop',
      data: { type: 'content_block_stop', index: this.blockIndex },
    });
    this.current = null;
  }

  /**
   * Close any open block, increment blockIndex, open a new block of the
   * given type with the given content_block payload.
   */
  protected openBlock(type: BlockType, contentBlock: Record<string, unknown>): void {
    this.closeBlock();
    this.blockIndex++;
    this.current = type;
    this.push({
      event: 'content_block_start',
      data: { type: 'content_block_start', index: this.blockIndex, content_block: contentBlock },
    });
  }

  // ---------------------------------------------------------------------------
  // Template-method orchestrator
  // ---------------------------------------------------------------------------

  /**
   * Process one input value into zero or more Anthropic events.
   * Calls hooks in the correct order so subclasses only supply the per-type logic.
   */
  public process(input: TInput): void {
    if (this.stopped) return;
    this.ensureStart();

    const blockEvent = this.createBlockEvent(input);
    if (blockEvent !== null) {
      this.push(blockEvent);
    }

    const deltaEvent = this.createDeltaEvent(input);
    if (deltaEvent !== null) {
      this.push(deltaEvent);
    }
  }

  /**
   * Finalize the stream — emit message_delta + message_stop (idempotent).
   * Call this when the upstream has completed.
   */
  public flush(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.ensureStart();
    this.closeBlock();
    for (const ev of this.createFinishEvent()) {
      this.push(ev);
    }
    // unblock any waiting iterator
    this._drainWaiting(true);
  }

  // ---------------------------------------------------------------------------
  // AsyncIterable<TOutput> — iterate emitted events
  // ---------------------------------------------------------------------------

  public async next(): Promise<IteratorResult<AnthropicEvent>> {
    if (this.queue.length > 0) {
      const ev = this.queue.shift()!;
      return { done: false, value: ev };
    }
    if (this.stopped) return { done: true, value: undefined };
    // wait for next event
    return new Promise<IteratorResult<AnthropicEvent>>((resolve) => {
      this.waiting.push((ev) =>
        resolve({ done: false, value: ev }),
      );
    });
  }

  public async return(): Promise<IteratorResult<AnthropicEvent>> {
    if (!this.stopped) this.flush();
    return { done: true, value: undefined };
  }

  public async throw(err: unknown): Promise<IteratorResult<AnthropicEvent>> {
    this.push(this.getErrorEvent(err));
    this.stopped = true;
    this._drainWaiting(false);
    return { done: true, value: undefined };
  }

  public [Symbol.asyncIterator](): AsyncIterator<AnthropicEvent> {
    return this;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private push(ev: AnthropicEvent): void {
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      resolve(ev);
      return;
    }
    this.queue.push(ev);
  }

  private _drainWaiting(final: boolean): void {
    for (const resolve of this.waiting) {
      resolve(
        final
          ? ({ event: 'message_stop', data: { type: 'message_stop' } } as AnthropicEvent)
          : (undefined as unknown as AnthropicEvent),
      );
    }
    this.waiting.length = 0;
  }
}
