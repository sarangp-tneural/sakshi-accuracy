import { useEffect, useRef } from "react";

/** Calls fn at most every `ms` using requestAnimationFrame. Never causes a React render by itself. */
export function useTick(fn: () => void, ms = 100) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let raf = 0, last = 0;
    const loop = (t: number) => {
      if (t - last >= ms) { last = t; ref.current(); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ms]);
}
