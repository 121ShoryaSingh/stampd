"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { Button } from "./button";
import { Modal } from "./modal";

export type ConfirmOptions = {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  // "danger" paints the confirm button red, for things that cannot be undone.
  tone?: "danger" | "default";
};

// In-app replacement for window.confirm: same question, our own dialog. Cancel has focus, so Enter never destroys anything.
export function ConfirmDialog({ open, onConfirm, onCancel, title, message, confirmLabel = "OK", cancelLabel = "Cancel", tone = "default" }: ConfirmOptions & { open: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button type="button" onClick={onCancel} data-autofocus>
            {cancelLabel}
          </Button>
          <Button type="button" variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-2">{typeof message === "string" ? <p>{message}</p> : message}</div>
    </Modal>
  );
}

// const [confirm, dialog] = useConfirm(); ... if (await confirm({ title, message })) ...; render {dialog} once.
export function useConfirm() {
  const [ask, setAsk] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const confirm = useCallback((o: ConfirmOptions) => {
    resolver.current?.(false);
    setAsk(o);
    return new Promise<boolean>((resolve) => (resolver.current = resolve));
  }, []);
  const answer = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setAsk(null);
  };
  const dialog = ask && <ConfirmDialog open {...ask} onConfirm={() => answer(true)} onCancel={() => answer(false)} />;
  return [confirm, dialog] as const;
}

// A submit button for server-action forms that asks first; the form is only sent after "confirm".
export function ConfirmSubmit({ children, confirm: ask, variant = "default", size, icon }: { children: ReactNode; confirm: ConfirmOptions; variant?: "default" | "danger" | "primary"; size?: "sm" | "md" | "lg"; icon?: ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button ref={ref} type="button" variant={variant} size={size} icon={icon} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <ConfirmDialog
        open={open}
        {...ask}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          ref.current?.form?.requestSubmit();
        }}
      />
    </>
  );
}
