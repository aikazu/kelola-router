export type HotPathMark = {
  name: string;
  atMs: number;
};

let enabled = false;
let marks: HotPathMark[] = [];

export function enableHotPathMetrics(): void {
  enabled = true;
  marks = [];
}

export function disableHotPathMetrics(): void {
  enabled = false;
  marks = [];
}

export function markHotPath(name: string): void {
  if (!enabled) {
    return;
  }
  marks.push({ name, atMs: performance.now() });
}

export function readHotPathMetrics(): HotPathMark[] {
  return [...marks];
}
