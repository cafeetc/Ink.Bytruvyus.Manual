export const FPS_OPTIONS = [12, 15, 24, 30] as const;
export type ScreenFpsOption = (typeof FPS_OPTIONS)[number];

export const DEFAULT_SCREEN_FPS: ScreenFpsOption = 24;
export const SCREEN_FPS_CAP = DEFAULT_SCREEN_FPS;
export const SCREEN_FRAME_INTERVAL_MS = 1000 / DEFAULT_SCREEN_FPS;

export function getFrameIntervalMs(fps: ScreenFpsOption = DEFAULT_SCREEN_FPS): number {
  return 1000 / fps;
}

export function getNextFpsOption(current: ScreenFpsOption): ScreenFpsOption {
  const idx = FPS_OPTIONS.indexOf(current);
  if (idx === -1) return DEFAULT_SCREEN_FPS;
  return FPS_OPTIONS[(idx + 1) % FPS_OPTIONS.length];
}

export function shouldEmitScreenFrame(
  lastEmitMs: number,
  nowMs: number,
  fps: ScreenFpsOption = DEFAULT_SCREEN_FPS
): boolean {
  if (!Number.isFinite(lastEmitMs) || lastEmitMs < 0) return true;
  return nowMs - lastEmitMs >= getFrameIntervalMs(fps);
}

export function remainingScreenFrameWaitMs(
  lastEmitMs: number,
  nowMs: number,
  fps: ScreenFpsOption = DEFAULT_SCREEN_FPS
): number {
  if (!Number.isFinite(lastEmitMs) || lastEmitMs < 0) return 0;
  return Math.max(0, getFrameIntervalMs(fps) - (nowMs - lastEmitMs));
}
