import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { Field } from '../Field';

describe('Field', () => {
  it('associates the label with the input via htmlFor/id', () => {
    render(<Field id="email" label="Email" value="" onInput={() => {}} type="email" />);
    const input = screen.getByLabelText('Email');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('id', 'email');
    expect(input).toHaveAttribute('type', 'email');
  });

  it('forwards name, autocomplete, placeholder, required', () => {
    render(
      <Field
        id="key"
        label="API key"
        value=""
        onInput={() => {}}
        name="api_key"
        autocomplete="off"
        placeholder="mm_…"
        required
      />
    );
    const input = screen.getByLabelText('API key');
    expect(input).toHaveAttribute('name', 'api_key');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('placeholder', 'mm_…');
    expect(input).toBeRequired();
  });

  it('calls onInput with the new value', () => {
    const onInput = vi.fn();
    render(<Field id="n" label="Name" value="" onInput={onInput} />);
    fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'abc' } });
    expect(onInput).toHaveBeenCalledWith('abc');
  });
});
