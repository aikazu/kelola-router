import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { CollapsibleText } from './CollapsibleText';

describe('CollapsibleText', () => {
  it('renders short text fully without collapse', () => {
    const { container } = render(<CollapsibleText text="short" />);
    expect(container.textContent).toBe('short');
    expect(screen.queryByText('show more')).toBeNull();
  });

  it('collapses text over 2KB and shows toggle', () => {
    const long = 'x'.repeat(3000);
    const { container } = render(<CollapsibleText text={long} />);
    expect(container.textContent).toContain('...');
    expect(screen.getByText('show more')).toBeTruthy();
  });

  it('expands full text on click', () => {
    const long = 'x'.repeat(3000);
    const { container } = render(<CollapsibleText text={long} />);
    fireEvent.click(screen.getByText('show more'));
    expect(container.textContent).not.toContain('...');
    expect(screen.getByText('show less')).toBeTruthy();
  });
});
