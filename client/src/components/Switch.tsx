export interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}
export function Switch({ checked, onChange, label }: SwitchProps) {
  return (
    <label class="switch">
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        aria-label={label || 'Toggle'}
        onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
      />
      <span class="switch-track">
        <span class="switch-thumb" />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}
