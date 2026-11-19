import pytest
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


def _clip(path, size):
    import subprocess
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"testsrc=size={size}:rate=25:duration=12",
                    "-c:v", "libx264", "-preset", "ultrafast", "-g", "100", "-keyint_min", "100", "-sc_threshold", "0", str(path)], check=True)


def test_real_ffprobe_on_a_generated_clip(tmp_path):
    clip = tmp_path / "c.mp4"
    _clip(clip, "1920x1080")
    gap = media.probe_keyframe_gap(clip)
    assert gap is not None and 3.9 <= gap <= 4.1  # keyframe every 100 frames = 4 s
    out = tmp_path / "play.mp4"
    media.make_playback(clip, out, media.probe(clip))  # big with sparse keyframes: re-encoded, 1 keyframe a second
    assert media.probe_keyframe_gap(out) <= 1.1
    assert media.probe(out)["width"] == 1280


def test_a_small_clip_is_copied_untouched(tmp_path):
    clip, out = tmp_path / "c.mp4", tmp_path / "play.mp4"
    _clip(clip, "640x360")
    media.make_playback(clip, out, media.probe(clip))
    info = media.probe(out)
    assert (info["width"], info["height"]) == (640, 360) and media.probe_keyframe_gap(out) >= 3.9  # copied, not re-encoded


def test_playback_copy_is_scaled_down_to_at_most_1280_wide():
    info = {"vcodec": "hevc", "container": "mov,mp4", "fps": 25.0, "max_keyframe_gap_s": 2.0}
    cmd = media.build_playback_cmd(SRC, DEST, info)
    assert cmd[cmd.index("-vf") + 1] == media.PLAYBACK_SCALE and "min(1280,iw)" in media.PLAYBACK_SCALE


def test_small_h264_is_copied_even_with_sparse_keyframes():
    sparse = dict(max_keyframe_gap_s=10.0, width=1280, height=720)
    cmd = media.build_playback_cmd(SRC, DEST, info(**sparse))
    assert "copy" in cmd and "libx264" not in cmd
    assert "copy" in media.build_playback_cmd(SRC, DEST, info(max_keyframe_gap_s=None, width=640, height=360))
    assert "copy" in media.build_playback_cmd(SRC, DEST, info(max_keyframe_gap_s=10.0, width=720, height=1280))  # portrait


def test_big_or_unknown_size_is_still_reencoded_when_keyframes_are_sparse():
    assert "libx264" in media.build_playback_cmd(SRC, DEST, info(max_keyframe_gap_s=10.0, width=1920, height=1080))
    assert "libx264" in media.build_playback_cmd(SRC, DEST, info(max_keyframe_gap_s=10.0, width=1280, height=960))
    assert "libx264" in media.build_playback_cmd(SRC, DEST, info(max_keyframe_gap_s=10.0, width=None, height=None))


def test_small_but_not_h264_or_not_mp4_is_still_reencoded():
    small = dict(max_keyframe_gap_s=10.0, width=640, height=360)
    assert "libx264" in media.build_playback_cmd(SRC, DEST, info(vcodec="hevc", **small))
    assert "libx264" in media.build_playback_cmd(Path("a.avi"), DEST, info(container="avi", **small))


def test_keep_format_copies_h264_and_hevc_mp4_untouched():
    for codec in ("h264", "hevc"):
        cmd = media.build_playback_cmd(SRC, DEST, info(vcodec=codec, keep_format=True, max_keyframe_gap_s=10.0, width=3840, height=2160))
        assert cmd[cmd.index("-c:v") + 1] == "copy" and "libx264" not in cmd and "-vf" not in cmd
        if codec == "hevc":
            assert cmd[cmd.index("-tag:v") + 1] == "hvc1"
        else:
            assert "-tag:v" not in cmd
        assert cmd[cmd.index("-c:a") + 1] == "aac" and "+faststart" in cmd


def test_keep_format_still_converts_what_an_mp4_cannot_hold_as_it_is():
    assert "libx264" in media.build_playback_cmd(SRC, DEST, info(vcodec="mpeg4", keep_format=True))
    assert "libx264" in media.build_playback_cmd(Path("a.avi"), DEST, info(container="avi", keep_format=True, max_keyframe_gap_s=10.0))
    assert "libx264" in media.build_playback_cmd(SRC, DEST, info(vcodec="hevc", keep_format=False))  # setting off: today's behaviour


def test_real_hevc_clip_stays_hevc_when_the_format_is_kept(tmp_path):
    import subprocess
    clip, out = tmp_path / "h.mp4", tmp_path / "play.mp4"
    r = subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=25:duration=4", "-c:v", "libx265",
                        "-preset", "ultrafast", "-tag:v", "hev1", str(clip)], capture_output=True)
    if r.returncode != 0:
        pytest.skip("this ffmpeg has no HEVC encoder")
    p = media.probe(clip)
    media.make_playback(clip, out, {**p, "keep_format": True})
    q = media.probe(out)
    assert q["vcodec"] == "hevc" and (q["width"], q["height"]) == (1920, 1080)
    tag = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_tag_string", "-of", "csv=p=0", str(out)],
                         capture_output=True, text=True).stdout.strip()
    assert tag == "hvc1"


def test_probe_stream_reads_the_format_and_never_raises(tmp_path):
    clip = tmp_path / "c.mp4"
    _clip(clip, "640x360")
    got = media.probe_stream(clip)
    assert got["vcodec"] == "h264" and (got["width"], got["height"]) == (640, 360) and got["fps"] == 25.0
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"p")
    assert media.probe_stream(bad) is None and media.probe_stream(tmp_path / "missing.mp4") is None
