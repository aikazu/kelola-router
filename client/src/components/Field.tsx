import type { JSX } from 'preact';

interface FieldProps {
  id: string;
  label: string;
  value: string;
  onInput: (value: string) => void;
  type?: 'text' | 'number' | 'email' | 'password' | 'search' | 'url';
  name?: string;
  autocomplete?: string;
  placeholder?: string;
  required?: boolean;
  inputMode?: JSX.HTMLAttributes<HTMLInputElement>['inputMode'];
  spellcheck?: boolean;
  hint?: string;
}

/**
 * Label + text/number input with guaranteed htmlFor/id association.
 * Consolidates the repeated form-field boilerplate (audit finding G1).
 * Selects and textareas keep their own markup — Field is text-input only.
 */
export function Field({
  id,
  label,
  value,
  onInput,
  type = 'text',
  name,
  autocomplete,
  placeholder,
  required,
  inputMode,
  spellcheck,
  hint,
}: FieldProps) {
  return (
    <div class="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        name={name}
        value={value}
        onInput={(e) => onInput((e.target as HTMLInputElement).value)}
        autocomplete={autocomplete}
        placeholder={placeholder}
        required={required}
        inputMode={inputMode}
        spellcheck={spellcheck}
        class="input"
      />
      {hint && <span class="field-hint">{hint}</span>}
    </div>
  );
}
