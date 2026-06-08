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
        onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
      />
      <span class="switch-track">
        <span class="switch-thumb" />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}
