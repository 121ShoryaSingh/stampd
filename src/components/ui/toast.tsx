"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Tone = "green" | "red" | "yellow";
type Item = { id: number; message: string; tone: Tone };
const Ctx = createContext<{ show: (message: string, tone?: Tone) => void }>({ show: () => {} });
const TONES: Record<Tone, string> = { green: "bg-green", red: "bg-red text-white", yellow: "bg-yellow" };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const show = useCallback((message: string, tone: Tone = "green") => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, message, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className={`border-brutal shadow-hard-sm pop px-4 py-2 font-bold ${TONES[t.tone]}`}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
