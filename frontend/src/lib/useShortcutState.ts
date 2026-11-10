import { useEffect, useState } from "react";
import { capture } from "../keys/capture";
import { isTypingTarget } from "./keyEvents";

/** true while single-key shortcuts are paused (typing in a field, or waiting for a key in the rebinding UI). */
export function useShortcutsPaused(): boolean {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const compute = () => setPaused(capture.active || isTypingTarget(document.activeElement));
    const later = () => setTimeout(compute, 0);
    document.addEventListener("focusin", compute);
    document.addEventListener("focusout", later);
    window.addEventListener("sv-capture", compute);
    compute();
    return () => {
      document.removeEventListener("focusin", compute);
      document.removeEventListener("focusout", later);
      window.removeEventListener("sv-capture", compute);
    };
  }, []);
  return paused;
}

/** After clicks on buttons/seek bar/list, hand focus back to the player. Text fields keep their focus. */
export function shouldRefocus(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) return false;
  if (tag === "INPUT") return ["range", "checkbox", "radio", "button"].includes((el as HTMLInputElement).type);
  return true;
}
