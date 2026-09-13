export function initialOf(name: string): string {
  return name.trim().slice(0, 1).toLocaleUpperCase("pt-BR");
}

type InitialsAvatarProps = {
  name: string;
  /** Diameter in pixels; the letter scales with it. */
  size?: number;
  inverted?: boolean;
};

/** Round monogram used by contact chips, the picker and the split rows. */
export function InitialsAvatar({ name, size = 28, inverted = false }: InitialsAvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-extrabold ${inverted ? "bg-primary text-on-primary" : "bg-primary-soft/60 text-primary-strong"}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initialOf(name)}
    </span>
  );
}
