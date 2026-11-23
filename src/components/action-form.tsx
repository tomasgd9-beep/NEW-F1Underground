"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

export type ActionResult = { error?: string; ok?: string } | null;
type Action = (prev: ActionResult, form: FormData) => Promise<ActionResult>;

/** A form wired to a server action that shows the action's error or success line. */
export function ActionForm({
  action,
  children,
  className,
  confirm,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
}) {
  const [state, run] = useActionState(action, null);
  return (
    <form
      action={run}
      className={className}
      onSubmit={(e) => {
        // A button can carry its own question (e.g. only "Send to everyone" asks first).
        const own = ((e.nativeEvent as SubmitEvent).submitter as HTMLElement | null)?.dataset.confirm;
        const ask = own ?? confirm;
        if (ask && !window.confirm(ask)) e.preventDefault();
      }}
    >
      {children}
      {state?.error && <p className="mt-1 text-xs text-down">{state.error}</p>}
      {state?.ok && <p className="mt-1 text-xs text-muted">{state.ok}</p>}
    </form>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  name,
  value,
  confirm,
}: {
  children: React.ReactNode;
  variant?: "primary" | "quiet";
  name?: string;
  value?: string;
  /** Ask this before submitting with this button. */
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  const base = "rounded px-2.5 py-1 text-sm font-semibold disabled:opacity-50 whitespace-nowrap";
  const look =
    variant === "primary"
      ? "bg-red text-white hover:brightness-110"
      : "border border-line text-ink hover:bg-black/5 dark:hover:bg-white/5";
  return (
    <button type="submit" disabled={pending} name={name} value={value} data-confirm={confirm} className={`${base} ${look}`}>
      {children}
    </button>
  );
}
