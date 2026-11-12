import { useEffect, useRef, useState } from "react";
import type { VirtualLine } from "../../lib/lines";
import LinesOverlay, { type BoxPx } from "./LinesOverlay";

/** A still image (the camera preview) with the lines drawn exactly over the picture. */
export default function ImageWithLines({ src, alt, lines, editing, selectedId, onSelect, onChange }: {
  src: string; alt: string; lines: VirtualLine[]; editing: boolean; selectedId: string | null;
  onSelect: (id: string | null) => void; onChange: (lines: VirtualLine[]) => void;
}) {
  const img = useRef<HTMLImageElement>(null);
  const [box, setBox] = useState<BoxPx>({ x: 0, y: 0, w: 0, h: 0 });
  useEffect(() => {
    const el = img.current; if (!el) return;
    const fit = () => setBox({ x: el.offsetLeft, y: el.offsetTop, w: el.clientWidth, h: el.clientHeight });
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [src]);
  return (
    <div className="img-lines">
      <img ref={img} className="rtsp-frame" src={src} alt={alt} draggable={false} onLoad={() => {
        const el = img.current; if (el) setBox({ x: el.offsetLeft, y: el.offsetTop, w: el.clientWidth, h: el.clientHeight });
      }} />
      {box.w > 0 && <LinesOverlay lines={lines} box={box} editing={editing} selectedId={selectedId} onSelect={onSelect} onChange={onChange} />}
    </div>
  );
}
