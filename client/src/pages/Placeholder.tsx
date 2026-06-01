export function Placeholder({ name }: { name: string }) {
  return (
    <div class="empty">
      <h3>{name}</h3>
      <p>Coming soon.</p>
    </div>
  );
}
