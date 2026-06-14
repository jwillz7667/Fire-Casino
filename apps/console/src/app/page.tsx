import { cn } from "@aureus/ui";

export default function HomePage(): React.ReactElement {
  return (
    <main className={cn("mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-4 p-8")}>
      <h1 className="font-display text-4xl font-semibold text-[color:var(--color-gold)]">
        Fire Casino — Console
      </h1>
      <p className="text-[color:var(--color-text-mid)]">
        Back-office for operators across the distribution tree. Scaffold online — domain screens
        arrive in Phase 11.
      </p>
    </main>
  );
}
