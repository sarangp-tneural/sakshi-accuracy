import type { RefObject } from "react";
import { parseTime } from "../lib/parseTime";

/** "go to 1:23" box. Typing here pauses the single-key shortcuts; Enter seeks and hands focus back to the player. */
export default function GoToTime({ videoRef, duration, onDone }: { videoRef: RefObject<HTMLVideoElement | null>; duration: number; onDone: () => void }) {
  return (
    <form className="goto" onSubmit={(e) => {
      e.preventDefault();
      const input = e.currentTarget.elements.namedItem("goto") as HTMLInputElement;
      const t = parseTime(input.value);
      if (t === null || !videoRef.current) { input.setAttribute("aria-invalid", "true"); return; }
      input.removeAttribute("aria-invalid");
      videoRef.current.currentTime = Math.min(t, duration || t);
      input.value = ""; input.blur(); onDone();
    }}>
      <label className="sr-only" htmlFor="goto">Go to time (m:ss or seconds)</label>
      <input id="goto" name="goto" type="text" placeholder="go to 1:23" autoComplete="off" />
    </form>
  );
}
