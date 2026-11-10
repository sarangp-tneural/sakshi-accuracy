import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, streamUrl, type Mark, type Video } from "../api";
import { useSettings } from "../SettingsContext";
import { COUNT_ACTIONS, SPEEDS } from "../keys/registry";
import { capture } from "../keys/capture";
import { decideKey, nextRepeat } from "../lib/keyEvents";
import { markTime } from "../lib/reaction";
import { nearestIndex } from "../lib/nearest";
import { shouldRefocus, useShortcutsPaused } from "../lib/useShortcutState";
import { Button, LoadError, Spinner } from "../components/ui/bits";
import { useToast } from "../components/ui/Toast";
import Popup, { type PopupHandle } from "../components/Popup";
import Counters, { type CountersHandle } from "../components/Counters";
import ControllerBar from "../components/ControllerBar";
import Legend from "../components/Legend";
import MarksList, { type MarkPatch } from "../components/MarksList";
import SakshiComparison from "../components/Comparison";
import SettingsDrawer from "../components/SettingsDrawer";
import ExportDialog from "../components/ExportDialog";

type LocalMark = Mark & { pending?: boolean };
let tempId = -1;
const NEAR_WINDOW_S = 3;

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.05;
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.04);
    setTimeout(() => ctx.close(), 200);
  } catch { /* no audio */ }
}

export default function Count() {
  const id = Number(useParams().id);
  const { settings, update } = useSettings();
  const toast = useToast();
  const [video, setVideo] = useState<Video | null>(null);
  const [projectName, setProjectName] = useState("");
  const [load, setLoad] = useState<"loading" | "ok" | "error">("loading");
  const [loadErr, setLoadErr] = useState("");
  const [marks, setMarks] = useState<LocalMark[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [version, setVersion] = useState(0);
  const [nearestId, setNearestId] = useState<number | null>(null);
  const vref = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const popup = useRef<PopupHandle>(null);
  const counters = useRef<CountersHandle>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const lastRepeat = useRef<ReturnType<typeof nextRepeat> | null>(null);
  const slowTimer = useRef<number | undefined>(undefined);
  const restoreRate = useRef<number | null>(null);
  const S = useRef(settings); S.current = settings;
  const paused = useShortcutsPaused();

  // dark surface for the whole Count screen
  useEffect(() => {
    document.documentElement.classList.add("theme-dark");
    return () => document.documentElement.classList.remove("theme-dark");
  }, []);

  const focusStage = useCallback(() => stage.current?.focus({ preventScroll: true }), []);

  // serialize every mark write so undo/edit/delete stay in order with creates
  const enqueue = useCallback((fn: () => Promise<unknown>) => {
    queue.current = queue.current.then(fn).catch((e) => toast.error(e));
    return queue.current;
  }, [toast]);

  const fetchAll = useCallback(() => {
    setLoad("loading");
    Promise.all([api.video(id), api.marks(id)])
      .then(([v, m]) => { setVideo(v); setMarks(m); setDuration(v.duration_s ?? 0); setLoad("ok"); api.projects().then((ps) => setProjectName(ps.find((p) => p.id === v.project_id)?.name ?? "")).catch(() => {}); })
      .catch((e) => { setLoadErr(e.message); setLoad("error"); });
  }, [id]);
  useEffect(fetchAll, [fetchAll]);

  const counts = useMemo(() => {
    const c = { in: 0, out: 0, male: 0, female: 0, total: marks.length };
    for (const m of marks) { c[m.direction]++; if (m.gender !== "unknown") c[m.gender]++; }
    return c;
  }, [marks]);

  // nearest mark to the playhead (4x per second, only re-renders when the answer changes)
  const byTime = useMemo(() => [...marks].sort((a, b) => a.time_s - b.time_s), [marks]);
  const times = useMemo(() => byTime.map((m) => m.time_s), [byTime]);
  useEffect(() => {
    const t = setInterval(() => {
      const v = vref.current;
      if (!v) return;
      const i = nearestIndex(times, v.currentTime, NEAR_WINDOW_S);
      setNearestId(i < 0 ? null : byTime[i].id);
    }, 250);
    return () => clearInterval(t);
  }, [times, byTime]);

  const setSpeed = useCallback((r: number) => {
    const v = vref.current; if (!v) return;
    v.playbackRate = r; setRate(r);
    restoreRate.current = null; clearTimeout(slowTimer.current);
  }, []);

  const addMark = useCallback((action: string) => {
    const v = vref.current; if (!v) return;
    const def = COUNT_ACTIONS[action];
    // read the time straight from the element, at the moment of the press
    const t = markTime(v.currentTime, S.current.reaction_delay_s, v.playbackRate);
    const now = Date.now();
    lastRepeat.current = nextRepeat(lastRepeat.current, action, now);
    popup.current?.show({ kind: def.direction, text: def.popup, gender: def.gender, times: lastRepeat.current.n });
    counters.current?.flash([def.direction, ...(def.gender !== "unknown" ? [def.gender] : []), "total"]);
    if (S.current.sound_enabled) beep();
    const tmp: LocalMark = { id: tempId--, video_id: id, time_s: t, direction: def.direction, gender: def.gender, pending: true };
    setMarks((m) => [...m, tmp]);
    enqueue(async () => {
      try {
        const saved = await api.addMark(id, { time_s: t, direction: def.direction, gender: def.gender });
        setMarks((m) => m.map((x) => (x.id === tmp.id ? saved : x)));
        setVersion((x) => x + 1);
      } catch (e) {
        setMarks((m) => m.filter((x) => x.id !== tmp.id));
        throw e;
      }
    });
  }, [id, enqueue]);

  const undo = useCallback(() => {
    // most recently created = highest saved id; pending (negative) marks are newer than any saved one
    setMarks((cur) => {
      if (!cur.length) return cur;
      const real = cur.filter((m) => m.id > 0);
      const pending = cur.filter((m) => m.id < 0);
      const victim = pending.length ? pending[pending.length - 1] : real.reduce((a, b) => (b.id > a.id ? b : a));
      popup.current?.show({ kind: "undo", text: `UNDO: ${victim.gender === "unknown" ? "" : victim.gender.toUpperCase() + " "}${victim.direction.toUpperCase()}`, gender: victim.gender });
      return cur.filter((m) => m !== victim);
    });
    lastRepeat.current = null;
    enqueue(async () => { try { await api.undo(id); setVersion((x) => x + 1); } catch (e) { if ((e as { status?: number }).status !== 404) throw e; } });
  }, [id, enqueue]);

  const jumpBack = useCallback(() => {
    const v = vref.current; if (!v) return;
    v.currentTime = Math.max(0, v.currentTime - 3);
    if (S.current.slow_after_jump && restoreRate.current === null && v.playbackRate !== 1) {
      restoreRate.current = v.playbackRate; v.playbackRate = 1; setRate(1);
      slowTimer.current = window.setTimeout(() => {
        if (restoreRate.current !== null && vref.current) { vref.current.playbackRate = restoreRate.current; setRate(restoreRate.current); }
        restoreRate.current = null;
      }, 5000);
    }
  }, []);

  const togglePlay = useCallback(() => { const v = vref.current; if (!v) return; if (v.paused) void v.play(); else v.pause(); }, []);
  const fps = video?.fps;
  const step = useCallback((dir: 1 | -1) => {
    const v = vref.current; if (!v) return;
    v.pause();
    const frame = 1 / (fps || 30);
    v.currentTime = Math.min(Math.max(0, v.currentTime + dir * frame), v.duration || Infinity);
  }, [fps]);

  // single global key handler; reads current bindings from the ref so rebinding applies immediately
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = decideKey(e, S.current.key_bindings, { capturing: capture.active });
      if (d.type === "ignore") return;
      e.preventDefault();
      if (d.type === "swallow") return;
      const a = d.action;
      if (a in COUNT_ACTIONS) addMark(a);
      else if (a in SPEEDS) setSpeed(SPEEDS[a]);
      else if (a === "play_pause") togglePlay();
      else if (a === "undo") undo();
      else if (a === "jump_back") jumpBack();
      else if (a === "step_back") step(-1);
      else if (a === "step_forward") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addMark, setSpeed, togglePlay, undo, jumpBack, step]);

  useEffect(() => () => clearTimeout(slowTimer.current), []);

  const patchMark = useCallback((m: LocalMark, patch: MarkPatch) => {
    if (m.id < 0) return;
    const prev = m;
    setMarks((cur) => cur.map((x) => (x.id === m.id ? { ...x, ...patch } : x)));
    enqueue(async () => {
      try {
        const saved = await api.patchMark(m.id, patch);
        setMarks((cur) => cur.map((x) => (x.id === m.id ? saved : x)));
        setVersion((x) => x + 1);
      } catch (e) { setMarks((cur) => cur.map((x) => (x.id === m.id ? prev : x))); throw e; }
    });
  }, [enqueue]);

  const removeMark = useCallback((m: LocalMark) => {
    if (m.id < 0) return;
    setMarks((cur) => cur.filter((x) => x.id !== m.id));
    enqueue(async () => { await api.deleteMark(m.id); setVersion((x) => x + 1); });
    toast.info("Mark deleted", {
      label: "Undo",
      run: () => enqueue(async () => {
        const saved = await api.addMark(id, { time_s: m.time_s, direction: m.direction, gender: m.gender });
        setMarks((cur) => [...cur, saved]); setVersion((x) => x + 1);
      }),
    });
  }, [enqueue, toast, id]);

  const seekTo = useCallback((m: LocalMark) => { if (vref.current) vref.current.currentTime = m.time_s; }, []);
  const tickMarks = useMemo(() => marks.map((m) => ({ time_s: m.time_s, direction: m.direction })), [marks]);
  const refocus = (e: React.SyntheticEvent) => { if (shouldRefocus(e.target)) setTimeout(focusStage, 0); };

  if (load === "loading") return <main className="page"><Spinner /> Loading video…</main>;
  if (load === "error" || !video) return <main className="page"><LoadError message={loadErr || "Could not load the video"} onRetry={fetchAll} /><Link to="/">← Back</Link></main>;
  if (video.status !== "ready" && video.status !== "partial")
    return <main className="page"><p>This video is <b>{video.status}</b>{video.status_reason ? `: ${video.status_reason}` : ""}.</p><Link to={`/projects/${video.project_id}`}>← Back to videos</Link></main>;

  return (
    <div className="count-wrap">
      <div className="count-screen" onClick={refocus} onPointerUp={refocus}>
        <div className="stage-col">
          <div className="count-head">
            <nav className="crumbs" aria-label="Breadcrumb">
              <Link to="/">Projects</Link>/<Link to={`/projects/${video.project_id}`}>{projectName || "Project"}</Link>/<b>{video.name}</b>
            </nav>
            {video.status === "partial" && <span className="badge partial" title={video.status_reason ?? ""}>partial recording</span>}
            <span className="spacer" />
            <span className={`kbd-state ${paused ? "off" : "on"}`} role="status">
              {paused ? "⏸ Shortcuts paused — click the video to resume" : "⌨ Shortcuts on"}
            </span>
            <Button size="sm" aria-pressed={settings.sound_enabled} onClick={() => update({ sound_enabled: !settings.sound_enabled }).catch(toast.error)} title="Click sound">{settings.sound_enabled ? "🔊" : "🔇"} Sound</Button>
            <a className="btn sm" href="#result">↓ Result</a>
            <Button size="sm" onClick={() => setShowSettings(true)}>⚙ Settings</Button>
          </div>
          <div className="stage" ref={stage} tabIndex={-1} aria-label="Video player">
            <video ref={vref} src={streamUrl(id)} preload="auto" playsInline
              onLoadedMetadata={(e) => { if (e.currentTarget.duration) setDuration(e.currentTarget.duration); }}
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onClick={togglePlay} />
            <Popup ref={popup} />
          </div>
          <ControllerBar videoRef={vref} duration={duration} playing={playing} rate={rate} marks={tickMarks}
            onTogglePlay={togglePlay} onStep={step} onJumpBack={jumpBack} onSetSpeed={setSpeed} />
        </div>

        <aside className="side">
          <Counters ref={counters} counts={counts} />
          <section className="card marks">
            <h3>Marks ({marks.length}) <span className="small muted">newest first</span></h3>
            <MarksList marks={marks} currentId={nearestId} onSeek={seekTo} onPatch={patchMark} onDelete={removeMark} onDone={focusStage} />
          </section>
          <Legend bindings={settings.key_bindings} />
        </aside>

        {showSettings && <SettingsDrawer onClose={() => { setShowSettings(false); setTimeout(focusStage, 0); }} />}
      </div>

      <div className="result-wrap">
        <SakshiComparison videoId={id} marksVersion={version} onExport={() => setShowExport(true)} />
      </div>
      {showExport && <ExportDialog videoId={id} videoName={video.name} onClose={() => { setShowExport(false); setTimeout(focusStage, 0); }} />}
    </div>
  );
}
