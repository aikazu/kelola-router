import { useState } from 'preact/hooks';

const COLLAPSE_THRESHOLD = 2048;
const PREVIEW_LENGTH = 1992;

export function CollapsibleText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  if (text.length <= COLLAPSE_THRESHOLD) {
    return <span>{text}</span>;
  }
  return (
    <span>
      <span>{expanded ? text : `${text.slice(0, PREVIEW_LENGTH)}...`}</span>{' '}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        class="mono"
        style={{
          background: 'none',
          border: 0,
          padding: 0,
          color: 'var(--gold)',
          cursor: 'pointer',
          fontSize: 11,
        }}
      >
        {expanded ? 'show less' : 'show more'}
      </button>
    </span>
  );
}
