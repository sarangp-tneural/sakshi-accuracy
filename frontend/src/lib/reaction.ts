/** mark_time = video_time - reaction_delay * playback_rate, clamped to 0. */
export function markTime(videoTime: number, reactionDelay: number, playbackRate: number): number {
  return Math.max(0, videoTime - reactionDelay * playbackRate);
}
