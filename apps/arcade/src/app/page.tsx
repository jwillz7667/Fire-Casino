import { cn } from "@aureus/ui";

export default function HomePage(): React.ReactElement {
  return (
    <main className={cn("mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6")}>
      <h1 className="font-display text-4xl font-semibold text-[color:var(--color-gold)]">
        Fire Casino
      </h1>
      <p className="text-[color:var(--color-text-mid)]">
        Player arcade. Scaffold online — lobby, games, wallet and cash-out arrive in Phase 12.
      </p>
    </main>
  );
}
