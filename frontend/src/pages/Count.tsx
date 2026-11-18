import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, streamUrl, type Mark, type MarkingType, type Roi, type Video } from "../api";
import { useSettings } from "../SettingsContext";
import { SPEEDS } from "../keys/registry";
import { countMarks, markingIdOf, markLabel, typesById, withMarkingKeys } from "../lib/markings";
import { capture } from "../keys/capture";
import { decideKey, nextRepeat } from "../lib/keyEvents";
import { markTime } from "../lib/reaction";
import type { VirtualLine } from "../lib/lines";
import { fmtTime } from "../lib/format";
import { nearestIndex } from "../lib/nearest";
import { nextKept, prevKept, stillSpans, type Keyframes, type StillsState } from "../lib/stills";
import { shouldRefocus, useShortcutsPaused } from "../lib/useShortcutState";
import { useTick } from "../lib/useTick";
import { Button, Crumbs, LoadError, Spinner } from "../components/ui/bits";
import { useToast } from "../components/ui/Toast";
import Popup, { type PopupHandle } from "../components/Popup";
import Counters, { type CountersHandle } from "../components/Counters";
import ControllerBar from "../components/ControllerBar";
import VideoViewport, { type PointMark, type ViewportHandle } from "../components/VideoViewport";
import type { TimelineMark } from "../components/Timeline";
import Legend from "../components/Legend";
import MarksList, { type MarkPatch } from "../components/MarksList";
import SakshiComparison from "../components/Comparison";
import EvaluationPanel from "../components/Evaluation";
import GoToTime from "../components/GoToTime";
import SettingsDrawer from "../components/SettingsDrawer";
import ExportDialog from "../components/ExportDialog";
import VideoUnavailable from "../components/VideoUnavailable";
import LinesPanel from "../components/lines/LinesPanel";

type LocalMark = Mark & { pending?: boolean };
let tempId = -1;
const NEAR_WINDOW_S = 3;
const HOLD_TO_REPEAT = ["step_back", "step_forward"]; // holding these keeps stepping; counting keys count once per press

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
  const [types, setTypes] = useState<MarkingType[]>([]); // the project's markings, removed ones included
  const T = useRef(types); T.current = types;
  const byType = useMemo(() => typesById(types), [types]);
  const [showSettings, setShowSettings] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [version, setVersion] = useState(0);
  const [resultVersion, setResultVersion] = useState(0); // bumps when the Sakshi result is saved
  const [nearestId, setNearestId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pickFor, setPickFor] = useState<number | null>(null);
  const [showPoints, setShowPoints] = useState(() => { try { return localStorage.getItem("sv_points") !== "0"; } catch { return true; } });
  // virtual lines: shown on the video always, editable here (this video only; the camera and other videos are not touched)
  const [lines, setLines] = useState<VirtualLine[]>([]);
  const [editLines, setEditLines] = useState(false);
  // focus area: changes elsewhere in the picture are ignored when looking for still moments
  const [roi, setRoi] = useState<Roi | null>(null);
  const [editRoi, setEditRoi] = useState(false);
  const [stillsKey, setStillsKey] = useState(0); // bump to fetch the index again (it is redone after the focus area changes)
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [linesSaving, setLinesSaving] = useState<"idle" | "saving" | "error">("idle");
  const pendingLines = useRef<VirtualLine[] | null>(null);
  const linesTimer = useRef<number | undefined>(undefined);
  const flushLines = useCallback(() => {
    window.clearTimeout(linesTimer.current);
    const next = pendingLines.current; if (!next) return Promise.resolve();
    pendingLines.current = null;
    setLinesSaving("saving");
    return api.putVideoLines(id, next).then(() => setLinesSaving((s) => (pendingLines.current ? s : "idle"))).catch((e) => { setLinesSaving("error"); toast.error(e); });
  }, [id, toast]);
  const changeLines = useCallback((next: VirtualLine[]) => {
    setLines(next);
    pendingLines.current = next;
    window.clearTimeout(linesTimer.current);
    linesTimer.current = window.setTimeout(() => void flushLines(), 500); // typing a name sends once, not per key
  }, [flushLines]);
  useEffect(() => () => { void flushLines(); }, [flushLines]); // leaving the page saves what is pending
  const vref = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [muted, setMuted] = useState(() => { try { return localStorage.getItem("sv_video_muted") === "1"; } catch { return false; } });
  const toggleMute = useCallback(() => setMuted((m) => { try { localStorage.setItem("sv_video_muted", m ? "0" : "1"); } catch { /* ignore */ } return !m; }), []);
  const viewport = useRef<ViewportHandle>(null);
  const stopAt = useRef<number | null>(null);
  const popup = useRef<PopupHandle>(null);
  const counters = useRef<CountersHandle>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const lastRepeat = useRef<ReturnType<typeof nextRepeat> | null>(null);
  const slowTimer = useRef<number | undefined>(undefined);
  const restoreRate = useRef<number | null>(null);
  const S = useRef(settings); S.current = settings;
  const paused = useShortcutsPaused();
  const noVideo = !!video?.video_removed_at; // only the file is gone: marks, counts and results remain

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
      .then(async ([v, m]) => { setTypes(await api.markingTypes(v.project_id)); return [v, m] as const; })
      .then(([v, m]) => { setVideo(v); setLines(v.lines ?? []); setRoi(v.roi ?? null); setMarks(m); setDuration(v.duration_s ?? 0); setLoad("ok"); api.projects().then((ps) => setProjectName(ps.find((p) => p.id === v.project_id)?.name ?? "")).catch(() => {}); })
      .catch((e) => { setLoadErr(e.message); setLoad("error"); });
  }, [id]);
  useEffect(fetchAll, [fetchAll]);

  const counts = useMemo(() => countMarks(marks, types), [marks, types]);

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

  const addMark = useCallback((typeId: number) => {
    const v = vref.current; if (!v) return;
    const type = T.current.find((t) => t.id === typeId && !t.archived); if (!type) return;
    // read the time straight from the element, at the moment of the press
    const t = markTime(v.currentTime, S.current.reaction_delay_s, v.playbackRate);
    const now = Date.now();
    lastRepeat.current = nextRepeat(lastRepeat.current, "mt:" + typeId, now);
    popup.current?.show({ kind: type.direction ?? "mark", text: type.label.toUpperCase(), color: type.color ?? undefined, times: lastRepeat.current.n });
    counters.current?.flash([...(type.direction ? [type.direction] : []), "t:" + typeId, "total"]);
    if (S.current.sound_enabled) beep();
    const tmp: LocalMark = { id: tempId--, video_id: id, time_s: t, direction: type.direction, marking_type_id: typeId, x: null, y: null, pending: true };
    setMarks((m) => [...m, tmp]);
    enqueue(async () => {
      try {
        const saved = await api.addMark(id, { time_s: t, marking_type_id: typeId });
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
      popup.current?.show({ kind: "undo", text: `UNDO: ${markLabel(victim, typesById(T.current)).toUpperCase()}` });
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
  // frame step lives in the viewport: it knows the measured frame gap (variable frame rate) and snaps to frame centres
  // Left/Right (and the step buttons) move as many frames as the playback speed: 1x = 1 frame, 4x = 4 frames
  // "Skip Still Moments": Left/Right jump between the moments the server found worth looking at, instead of single frames
  const [skipStills, setSkipStills] = useState(() => { try { return localStorage.getItem("sv_skipstills") === "1"; } catch { return false; } });
  const [stills, setStills] = useState<Keyframes | null>(null); // the moments, once found
  const [stillsState, setStillsState] = useState<StillsState>("none");
  const stillsRef = useRef({ skip: skipStills, kept: stills?.kept });
  stillsRef.current = { skip: skipStills, kept: stills?.kept };
  // Finding still moments is manual: a button starts it, and it can be cancelled while it runs.
  const changeRoi = useCallback((next: Roi | null) => {
    const prev = roi, had = stillsState === "ready" || stillsState === "running"; // the server redoes the analysis only if there was one
    setRoi(next);
    if (had) { setStills(null); setStillsState("running"); }
    api.putVideoRoi(id, next).then(() => setStillsKey((k) => k + 1)).catch((e) => { setRoi(prev); setStillsKey((k) => k + 1); toast.error(e); });
  }, [id, roi, stillsState, toast]);
  useEffect(() => { // ask where it is; while it runs, ask again every few seconds
    if (!video || noVideo || (video.status !== "ready" && video.status !== "partial")) return;
    let alive = true, timer: number | undefined;
    const poll = () => api.keyframes(id).then((k) => {
      if (!alive) return;
      setStillsState(k.state);
      setStills(k.state === "ready" ? (k as Keyframes) : null);
      if (k.state === "running") timer = window.setTimeout(poll, 5000);
    }, () => { /* the feature just stays off */ });
    poll();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [id, video?.status, noVideo, stillsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const findStills = () => { setStillsState("running"); api.analyzeStills(id).then(() => setStillsKey((k) => k + 1)).catch((e) => { toast.error(e); setStillsKey((k) => k + 1); }); };
  const cancelStills = () => { setStillsState("none"); api.cancelStills(id).then(() => setStillsKey((k) => k + 1)).catch(toast.error); };
  // while playing, jump over the skipped stretches too (not only on Left/Right)
  const skipSpans = useMemo(() => (stills ? stillSpans(stills.kept, stills.duration_s, stills.sample_fps) : []), [stills]);
  useTick(() => {
    const v = vref.current;
    if (!skipStills || !v || v.paused || v.seeking || !skipSpans.length) return;
    const t = v.currentTime;
    const span = skipSpans.find(([from, to]) => t >= from && t < to);
    if (span) v.currentTime = span[1];
  }, 50);
  const step = useCallback((dir: 1 | -1) => {
    const v = vref.current, { skip, kept } = stillsRef.current;
    if (skip && kept?.length && v) {
      const target = dir === 1 ? nextKept(kept, v.currentTime) : prevKept(kept, v.currentTime);
      if (target !== null) v.currentTime = target;
      return;
    }
    viewport.current?.step(dir, Math.max(1, Math.round(v?.playbackRate ?? 1)));
  }, []);

  // single global key handler; reads current bindings from the ref so rebinding applies immediately
  useEffect(() => {
    if (noVideo) return; // counting and playback keys need a video
    const onKey = (e: KeyboardEvent) => {
      const d = decideKey(e, withMarkingKeys(S.current.key_bindings, T.current), { capturing: capture.active, repeatable: HOLD_TO_REPEAT });
      if (d.type === "ignore") return;
      e.preventDefault();
      if (d.type === "swallow") return;
      const a = d.action;
      const typeId = markingIdOf(a);
      if (typeId !== null) addMark(typeId);
      else if (a in SPEEDS) setSpeed(SPEEDS[a]);
      else if (a === "play_pause") togglePlay();
      else if (a === "undo") undo();
      else if (a === "jump_back") jumpBack();
      else if (a === "step_back") step(-1);
      else if (a === "step_forward") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addMark, setSpeed, togglePlay, undo, jumpBack, step, noVideo]);

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
    if (m.marking_type_id === null) { toast.info("Mark deleted"); return; }
    toast.info("Mark deleted", {
      label: "Undo",
      run: () => enqueue(async () => {
        const saved = await api.addMark(id, { time_s: m.time_s, marking_type_id: m.marking_type_id! });
        setMarks((cur) => [...cur, saved]); setVersion((x) => x + 1);
      }),
    });
  }, [enqueue, toast, id]);

  const seekTo = useCallback((m: LocalMark) => { setSelectedId(m.id); if (vref.current) vref.current.currentTime = m.time_s; }, []);
  const timelineMarks = useMemo<TimelineMark[]>(() => byTime.map((m) => ({ id: m.id, time_s: m.time_s, direction: m.direction, color: (m.marking_type_id !== null ? byType.get(m.marking_type_id)?.color : null) ?? null, label: markLabel(m, byType), hasPoint: m.x !== null && m.y !== null })), [byTime, byType]);
  const pointMarks = useMemo<PointMark[]>(() => byTime.filter((m) => m.x !== null && m.y !== null).map((m) => ({ id: m.id, time_s: m.time_s, direction: m.direction, color: (m.marking_type_id !== null ? byType.get(m.marking_type_id)?.color : null) ?? null, label: markLabel(m, byType), x: m.x!, y: m.y! })), [byTime, byType]);

  // ---- points: pause on the mark's frame, click the picture ----
  const startPick = useCallback((m: LocalMark) => {
    if (m.id < 0) return;
    const v = vref.current; if (!v) return;
    v.pause(); stopAt.current = null; v.currentTime = m.time_s;
    setSelectedId(m.id); setPickFor(m.id);
    setTimeout(focusStage, 0);
  }, [focusStage]);
  useEffect(() => {
    if (pickFor === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setPickFor(null); setTimeout(focusStage, 0); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickFor, focusStage]);
  const placePoint = useCallback((x: number, y: number) => {
    const id0 = pickFor; setPickFor(null);
    setTimeout(focusStage, 0);
    if (id0 === null) return;
    const prev = marks.find((m) => m.id === id0);
    setMarks((cur) => cur.map((m) => (m.id === id0 ? { ...m, x, y } : m)));
    enqueue(async () => {
      try { const saved = await api.setPoint(id0, x, y); setMarks((cur) => cur.map((m) => (m.id === id0 ? saved : m))); toast.success("Point placed"); }
      catch (e) { setMarks((cur) => cur.map((m) => (m.id === id0 ? { ...m, x: prev?.x ?? null, y: prev?.y ?? null } : m))); throw e; }
    });
  }, [pickFor, marks, enqueue, toast, focusStage]);
  const clearPoint = useCallback((m: LocalMark) => {
    if (m.id < 0) return;
    const { x, y } = m;
    setMarks((cur) => cur.map((k) => (k.id === m.id ? { ...k, x: null, y: null } : k)));
    enqueue(async () => {
      try { await api.clearPoint(m.id); } catch (e) { setMarks((cur) => cur.map((k) => (k.id === m.id ? { ...k, x, y } : k))); throw e; }
    });
  }, [enqueue]);

  // ---- replay a mark: play from 2 s before to 2 s after, then pause ----
  const replay = useCallback((m: LocalMark) => {
    const v = vref.current; if (!v) return;
    setSelectedId(m.id);
    v.currentTime = Math.max(0, m.time_s - 2);
    stopAt.current = m.time_s + 2;
    void v.play();
  }, []);
  useTick(() => {
    const v = vref.current;
    if (v && stopAt.current !== null && v.currentTime >= stopAt.current) { stopAt.current = null; v.pause(); }
  }, 50);
  const refocus = (e: React.SyntheticEvent) => { if (shouldRefocus(e.target)) setTimeout(focusStage, 0); };

  if (load === "loading") return <main className="page"><Spinner /> Loading video…</main>;
  if (load === "error" || !video) return <main className="page"><LoadError message={loadErr || "Could not load the video"} onRetry={fetchAll} /><Link to="/">← Back</Link></main>;
  if (video.status !== "ready" && video.status !== "partial")
    return <main className="page"><p>This video is <b>{video.status}</b>{video.status_reason ? `: ${video.status_reason}` : ""}.</p><Link to={`/projects/${video.project_id}`}>← Back to videos</Link></main>;

  return (
    <div className="count-wrap">
      <div className="count-screen" onClick={refocus} onPointerUp={refocus}>
        <div className="stage-col">
          <header className="count-head">
            <div className="head-id">
              <Crumbs items={[
                { label: "Projects", to: "/", icon: "⌂" },
                { label: projectName || "Project", to: `/projects/${video.project_id}` },
                { label: video.name },
              ]} />
              <span className="vmeta">
                {duration > 0 && <span className="num">{fmtTime(duration)}</span>}
                <span>{video.source === "rtsp" ? "RTSP recording" : "upload"}</span>
                {noVideo && <span className="vremoved" title="The video file was deleted to free space">Video removed</span>}
                {video.status === "partial" && <span className="badge partial" title={video.status_reason ?? ""}>partial recording</span>}
              </span>
            </div>
            <div className="head-tools">
              {!noVideo && <span className={`kbd-state ${paused ? "off" : "on"}`} role="status"
                title={paused ? "Single-key shortcuts are paused while you type or rebind. Click the video to resume." : "Counting keys are active"}>
                {paused ? "⏸ Shortcuts paused" : "⌨ Shortcuts on"}
              </span>}
              {!noVideo && <GoToTime videoRef={vref} duration={duration} onDone={focusStage} />}
              <div className="tool-group" role="group" aria-label="Display and sound">
                {!noVideo && <Button size="sm" variant="ghost" aria-pressed={showPoints} title="Show points on the video"
                  onClick={() => setShowPoints((p) => { try { localStorage.setItem("sv_points", p ? "0" : "1"); } catch { /* ignore */ } return !p; })}>
                  <span aria-hidden>📍</span><span className="tl-label"> Points</span></Button>}
                {!noVideo && stillsState === "ready" && <Button size="sm" variant="ghost" aria-pressed={skipStills}
                  title="Left/Right and playback jump between moments where something changes (the original video is not changed)"
                  onClick={() => { setSkipStills((s) => { try { localStorage.setItem("sv_skipstills", s ? "0" : "1"); } catch { /* ignore */ } return !s; }); setTimeout(focusStage, 0); }}>
                  <span aria-hidden>⏭</span><span className="tl-label"> Skip still moments</span></Button>}
                {!noVideo && (stillsState === "none" || stillsState === "failed") && <Button size="sm" variant="ghost"
                  title={stillsState === "failed" ? "It did not finish. Try again." : "Look through the video once for moments where something changes, so you can skip the rest"}
                  onClick={findStills}><span aria-hidden>🔎</span><span className="tl-label"> {stillsState === "failed" ? "Retry finding still moments" : "Find still moments"}</span></Button>}
                {!noVideo && stillsState === "running" && <>
                  <Button size="sm" variant="ghost" disabled><Spinner label="Finding still moments" /><span className="tl-label"> Finding still moments…</span></Button>
                  <Button size="sm" variant="ghost" title="Stop looking. The video is not changed." onClick={cancelStills}><span aria-hidden>✕</span><span className="tl-label"> Cancel</span></Button></>}
                {!noVideo && <Button size="sm" variant="ghost" aria-pressed={editRoi} title="Mark the area to watch, so changes elsewhere are ignored when skipping still moments"
                  onClick={() => { setEditRoi((e) => !e); setEditLines(false); setTimeout(focusStage, 0); }}>
                  <span aria-hidden>🎯</span><span className="tl-label"> Focus area{roi ? " ✓" : ""}</span></Button>}
                {!noVideo && <Button size="sm" variant="ghost" aria-pressed={editLines} title="Draw or edit the virtual lines on this video"
                  onClick={() => { setEditLines((e) => !e); setEditRoi(false); setSelectedLineId(null); setTimeout(focusStage, 0); }}>
                  <span aria-hidden>📏</span><span className="tl-label"> Lines{lines.length ? ` (${lines.length})` : ""}</span></Button>}
                <Button size="sm" variant="ghost" aria-pressed={settings.sound_enabled} onClick={() => update({ sound_enabled: !settings.sound_enabled }).catch(toast.error)}
                  title="Beep on each mark (not the video audio)"><span aria-hidden>{settings.sound_enabled ? "🔔" : "🔕"}</span><span className="tl-label"> Click sound</span></Button>
              </div>
              <a className="btn sm" href="#result" title="Sakshi result and comparison"><span aria-hidden>↓</span> Result</a>
              <Button size="sm" onClick={() => setShowSettings(true)}><span aria-hidden>⚙</span> Settings</Button>
            </div>
          </header>
          {noVideo ? (
            <>
              <VideoUnavailable removedAt={video.video_removed_at} />
              <div className="count-notice" role="status">Counting needs the video. You can still review and edit marks, enter the Sakshi result and export.</div>
            </>
          ) : (<>
          <VideoViewport ref={viewport} videoRef={vref} stageRef={stage} src={streamUrl(id)} fps={video.fps}
            points={pointMarks} selectedId={selectedId} showPoints={showPoints} muted={muted} pickMode={pickFor !== null}
            roi={roi} editRoi={editRoi && pickFor === null} onRoiChange={changeRoi}
            lines={lines} editLines={editLines && pickFor === null} selectedLineId={selectedLineId} onSelectLine={setSelectedLineId} onLinesChange={changeLines}
            onPick={placePoint} onToggle={togglePlay}
            onLoadedMetadata={(v) => { if (v.duration) setDuration(v.duration); }}
            onPlay={() => setPlaying(true)} onPause={() => { stopAt.current = null; setPlaying(false); }}>
            <Popup ref={popup} />
          </VideoViewport>
          <ControllerBar videoRef={vref} duration={duration} playing={playing} rate={rate} muted={muted} onToggleMute={toggleMute} marks={timelineMarks}
            selectedId={selectedId} onSelect={setSelectedId}
            stills={stills} skipStills={skipStills && !!stills}
            onTogglePlay={togglePlay} onStep={step} onJumpBack={jumpBack} onSetSpeed={setSpeed} />
          </>)}
        </div>

        <aside className="side">
          <Counters ref={counters} counts={counts} />
          {editRoi && !noVideo && (
            <section className="card">
              <h3>Focus area</h3>
              <p className="small muted">Drag on the picture to draw it, drag inside to move it, drag a corner to resize. Only changes inside it count when finding still moments. If you have not found them yet, use Find still moments afterwards.</p>
              <Button size="sm" disabled={!roi} onClick={() => changeRoi(null)}>Use the whole picture</Button>
            </section>
          )}
          {editLines && !noVideo && (
            <section className="card">
              <h3>Lines <span className="small muted">{linesSaving === "saving" ? "saving…" : linesSaving === "error" ? "not saved" : "saved"}</span></h3>
              <LinesPanel lines={lines} selectedId={selectedLineId} onSelect={setSelectedLineId} onChange={changeLines} />
            </section>
          )}
          <section className="card marks">
            <h3>Marks ({marks.length}) <span className="small muted">newest first</span></h3>
            <MarksList marks={marks} types={types} currentId={nearestId} selectedId={selectedId} pickingId={pickFor}
              onSeek={seekTo} onPatch={patchMark} onDelete={removeMark} onPlacePoint={startPick} onClearPoint={clearPoint} onReplay={replay} onDone={focusStage} noVideo={noVideo} />
          </section>
          {!noVideo && <Legend bindings={settings.key_bindings} types={types} />}
        </aside>

        {showSettings && <SettingsDrawer projectId={video.project_id} onMarkingsChange={setTypes} onClose={() => { setShowSettings(false); setTimeout(focusStage, 0); }} />}
      </div>

      <div className="result-wrap">
        <SakshiComparison videoId={id} types={types} marksVersion={version} onExport={() => setShowExport(true)} onSaved={() => setResultVersion((x) => x + 1)} />
        <EvaluationPanel videoId={id} version={version + resultVersion} />
      </div>
      {showExport && <ExportDialog videoId={id} videoName={video.name} onClose={() => { setShowExport(false); setTimeout(focusStage, 0); }} />}
    </div>
  );
}
