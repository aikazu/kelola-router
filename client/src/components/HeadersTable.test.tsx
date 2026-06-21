import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { HeadersTable, maskHeaderValue } from './HeadersTable';

describe('maskHeaderValue', () => {
  it('masks authorization with scheme prefix + 4 chars', () => {
    expect(maskHeaderValue('authorization', 'Bearer sk-abc123456')).toBe('Bearer sk-a****');
  });
  it('does not mask content-type', () => {
    expect(maskHeaderValue('content-type', 'application/json')).toBe('application/json');
  });
  it('handles short sensitive values', () => {
    expect(maskHeaderValue('x-api-key', 'abc')).toBe('abc****');
  });
});

describe('HeadersTable', () => {
  it('renders masked sensitive + plain values sorted', () => {
    render(
      <HeadersTable
        headers={{
          'content-type': 'application/json',
          authorization: 'Bearer secret-token',
        }}
      />
    );
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(2);
    expect(screen.getByText('Bearer secr****')).toBeTruthy();
    expect(screen.getByText('application/json')).toBeTruthy();
  });
  it('shows empty message when no headers', () => {
    render(<HeadersTable headers={null} />);
    expect(screen.getByText(/No headers recorded/i)).toBeTruthy();
  });
});
