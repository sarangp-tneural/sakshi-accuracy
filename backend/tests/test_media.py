from pathlib import Path

from app import media

SRC, DEST = Path("a.mp4"), Path("out.mp4")


def pk(*pairs):
    return list(pairs)


def test_gap_between_keyframes():
    # 25 fps, keyframe every 25 frames
    packets = [(i / 25, i % 25 == 0) for i in range(100)]
    assert media.max_keyframe_gap(packets) == 1.0


def test_gap_uses_longest_and_ignores_order():
    packets = [(0.0, True), (1.0, True), (4.0, True), (4.5, False), (0.5, False)]  # B-frame ordering is not monotonic
    assert media.max_keyframe_gap(packets) == 3.0


def test_single_keyframe_means_at_least_the_sample_span():
    packets = [(0.0, True)] + [(i * 0.04, False) for i in range(1, 600)]
    assert media.max_keyframe_gap(packets) > 20


def test_no_keyframe_is_unknown():
    assert media.max_keyframe_gap([(0.0, False), (0.04, False)]) is None


def info(**kw):
    base = {"vcodec": "h264", "container": "mov,mp4,m4a,3gp,3g2,mj2", "fps": 25.0, "max_keyframe_gap_s": 1.0}
    base.update(kw)
    return base


def test_remux_only_when_h264_mp4_with_frequent_keyframes():
    cmd = media.build_playback_cmd(SRC, DEST, info())
    assert "copy" in cmd and "libx264" not in cmd


def test_sparse_keyframes_are_reencoded_with_about_one_per_second():
    cmd = media.build_playback_cmd(SRC, DEST, info(max_keyframe_gap_s=10.0, fps=30.0))
    assert "libx264" in cmd and "copy" not in cmd
    assert cmd[cmd.index("-g") + 1] == "30" and cmd[cmd.index("-keyint_min") + 1] == "30"
    assert cmd[cmd.index("-sc_threshold") + 1] == "0"


def test_unknown_keyframe_gap_is_reencoded():
    assert "libx264" in media.build_playback_cmd(SRC, DEST, info(max_keyframe_gap_s=None))


def test_other_formats_are_reencoded_and_missing_fps_defaults_to_25():
    cmd = media.build_playback_cmd(Path("a.avi"), DEST, info(vcodec="mpeg4", container="avi", fps=None))
    assert "libx264" in cmd and cmd[cmd.index("-g") + 1] == "25"
    assert "libx264" in media.build_playback_cmd(Path("a.mov"), DEST, info())  # not .mp4 -> encode
    assert "libx264" in media.build_playback_cmd(SRC, DEST, info(vcodec="hevc"))


def test_real_ffprobe_on_a_generated_clip(tmp_path):
    import subprocess
    clip = tmp_path / "c.mp4"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=25:duration=12",
                    "-c:v", "libx264", "-g", "100", "-keyint_min", "100", "-sc_threshold", "0", str(clip)], check=True)
    gap = media.probe_keyframe_gap(clip)
    assert gap is not None and 3.9 <= gap <= 4.1  # keyframe every 100 frames = 4 s
    out = tmp_path / "play.mp4"
    media.make_playback(clip, out, media.probe(clip))
    assert media.probe_keyframe_gap(out) <= 1.1


def test_playback_copy_is_scaled_down_to_at_most_1280_wide():
    info = {"vcodec": "hevc", "container": "mov,mp4", "fps": 25.0, "max_keyframe_gap_s": 2.0}
    cmd = media.build_playback_cmd(SRC, DEST, info)
    assert cmd[cmd.index("-vf") + 1] == media.PLAYBACK_SCALE and "min(1280,iw)" in media.PLAYBACK_SCALE
