import type { Camera } from "../../api";
import { Button } from "../ui/bits";
import CameraCard from "./CameraCard";

interface Props {
  cameras: Camera[];
  now: number;
  startingId: number | null;
  onAdd: () => void;
  onStart: (c: Camera, minutes: number) => void;
  onStop: (c: Camera) => void;
  onPreview: (c: Camera) => void;
  onEdit: (c: Camera) => void;
  onDelete: (c: Camera) => void;
}

export default function CameraStrip({ cameras, now, startingId, onAdd, onStart, onStop, onPreview, onEdit, onDelete }: Props) {
  if (cameras.length === 0) {
    return (
      <div className="camempty">
        <span>Save a camera for one-click recording.</span>
        <Button size="sm" onClick={onAdd}>+ Add camera</Button>
      </div>
    );
  }
  return (
    <section aria-labelledby="cams-h" className="stack" style={{ gap: "var(--s-2)" }}>
      <div className="row">
        <h2 id="cams-h" style={{ fontSize: "var(--fs-md)" }}>Cameras</h2>
        <span className="spacer" />
        <Button size="sm" onClick={onAdd}>+ Add camera</Button>
      </div>
      <div className="camgrid">
        {cameras.map((c) => (
          <CameraCard key={c.id} camera={c} now={now} starting={startingId === c.id}
            onStart={(m) => onStart(c, m)} onStop={() => onStop(c)} onPreview={() => onPreview(c)} onEdit={() => onEdit(c)} onDelete={() => onDelete(c)} />
        ))}
      </div>
    </section>
  );
}
