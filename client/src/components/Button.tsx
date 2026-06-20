import type { ComponentChildren, JSX } from 'preact';

type Variant = 'primary' | 'ghost' | 'danger' | 'link';
type Size = 'sm' | 'md';

export interface ButtonProps {
  children: ComponentChildren;
  onClick?: (e: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  variant?: Variant;
  size?: Size;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  title?: string;
  'aria-label'?: string;
  'aria-pressed'?: boolean | 'true' | 'false' | 'mixed';
  style?: JSX.CSSProperties;
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  type = 'button',
  disabled,
  title,
  'aria-label': ariaLabel,
  'aria-pressed': ariaPressed,
  style,
}: ButtonProps) {
  const classes = [
    'btn',
    variant === 'ghost' && 'btn-ghost',
    variant === 'danger' && 'btn-danger',
    size === 'sm' && 'btn-sm',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type={type}
      class={classes}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      style={style}
    >
      {children}
    </button>
  );
}
