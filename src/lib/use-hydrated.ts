import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

// False during server render and hydration, true once React runs in the browser.
// Forms handled in JS keep their submit button disabled until then, so an early
// click never falls back to a plain page reload.
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
