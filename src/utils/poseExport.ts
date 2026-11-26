import { ArmatureState, ComputedJoint, JointId, PosePresetId } from '../types/rig';

export interface ExportBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExportViewBoxResult extends ExportBBox {
  exportWidth: number;
  exportHeight: number;
}

export interface SavedPosePayload {
  app: 'Bitruvius Canvas';
  version: 1;
  savedAt: string;
  savedDate: string;
  preset: PosePresetId | 'custom';
  armature: ArmatureState;
  joints: Record<
    JointId,
    {
      x: number;
      y: number;
      localAngle: number;
      worldAngle: number;
    }
  >;
}

export const SAVED_POSE_STORAGE_KEY = 'bitruvius.savedPose';

export function formatExportTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}`;
}

export function buildSavedPosePayload(
  armature: ArmatureState,
  computedJoints: Record<JointId, ComputedJoint>,
  preset: PosePresetId | null,
  date: Date = new Date()
): SavedPosePayload {
  const savedAt = date.toISOString();
  const savedDate = savedAt.slice(0, 10);
  const joints = {} as SavedPosePayload['joints'];
  for (const id of Object.keys(computedJoints) as JointId[]) {
    const j = computedJoints[id];
    joints[id] = {
      x: Number(j.x.toFixed(3)),
      y: Number(j.y.toFixed(3)),
      localAngle: Number(j.localAngle.toFixed(3)),
      worldAngle: Number(j.worldAngle.toFixed(3)),
    };
  }
  return {
    app: 'Bitruvius Canvas',
    version: 1,
    savedAt,
    savedDate,
    preset: preset ?? 'custom',
    armature,
    joints,
  };
}

export function computeUncutExportViewBox(
  geometryBBox: ExportBBox | null,
  computedJoints: Record<JointId, ComputedJoint>,
  padding = 42,
  maxDimension = 4096
): ExportViewBoxResult {
  const jointValues = Object.values(computedJoints);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  if (
    geometryBBox &&
    Number.isFinite(geometryBBox.x) &&
    Number.isFinite(geometryBBox.y) &&
    geometryBBox.width > 0 &&
    geometryBBox.height > 0
  ) {
    minX = geometryBBox.x - padding;
    minY = geometryBBox.y - padding;
    maxX = geometryBBox.x + geometryBBox.width + padding;
    maxY = geometryBBox.y + geometryBBox.height + padding;
  }

  for (const j of jointValues) {
    if (!Number.isFinite(j.x) || !Number.isFinite(j.y)) continue;
    const jointMargin = 55;
    minX = Math.min(minX, j.x - jointMargin);
    minY = Math.min(minY, j.y - jointMargin);
    maxX = Math.max(maxX, j.x + jointMargin);
    maxY = Math.max(maxY, j.y + jointMargin);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || maxX <= minX || maxY <= minY) {
    minX = 0;
    minY = 0;
    maxX = 1000;
    maxY = 1400;
  }

  const width = Math.ceil(maxX - minX);
  const height = Math.ceil(maxY - minY);
  const x = Math.floor(minX);
  const y = Math.floor(minY);

  // Preserve exact aspect ratio (1:1 pixel ratio scaled 2x, clamped uniformly if above maxDimension)
  const desiredScale = 2;
  const maxSide = Math.max(width, height);
  const scale = maxSide * desiredScale > maxDimension ? maxDimension / maxSide : desiredScale;
  const exportWidth = Math.max(1, Math.round(width * scale));
  const exportHeight = Math.max(1, Math.round(height * scale));

  return {
    x,
    y,
    width,
    height,
    exportWidth,
    exportHeight,
  };
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function savePoseDataFile(
  armature: ArmatureState,
  computedJoints: Record<JointId, ComputedJoint>,
  preset: PosePresetId | null,
  now: Date = new Date()
): { filename: string; payload: SavedPosePayload } {
  const payload = buildSavedPosePayload(armature, computedJoints, preset, now);
  const filename = `bitruvius-pose-${formatExportTimestamp(now)}.json`;
  try {
    window.localStorage.setItem(SAVED_POSE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  triggerBlobDownload(blob, filename);
  return { filename, payload };
}

export async function copyPoseDataToClipboard(
  armature: ArmatureState,
  computedJoints: Record<JointId, ComputedJoint>,
  preset: PosePresetId | null,
  now: Date = new Date()
): Promise<{ copied: boolean; payload: SavedPosePayload; json: string }> {
  const payload = buildSavedPosePayload(armature, computedJoints, preset, now);
  const json = JSON.stringify(payload, null, 2);
  try {
    window.localStorage.setItem(SAVED_POSE_STORAGE_KEY, json);
  } catch {
    // Ignore storage quota errors
  }

  let copied = false;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(json);
      copied = true;
    } catch {
      copied = false;
    }
  }

  if (!copied && typeof document !== 'undefined') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = json;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.select();
      copied = document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch {
      copied = false;
    }
  }

  return { copied, payload, json };
}

export function stripSelectionFromClonedBody(bodyClone: Element): void {
  const segments = bodyClone.querySelectorAll('[data-joint-id]');
  segments.forEach((seg) => {
    seg.removeAttribute('stroke');
    seg.removeAttribute('stroke-width');
    seg.removeAttribute('stroke-opacity');
    seg.removeAttribute('style');
  });
}

export async function saveTransparentModelImage(
  worldSvg: SVGSVGElement,
  computedJoints: Record<JointId, ComputedJoint>,
  now: Date = new Date()
): Promise<{ filename: string; width: number; height: number } | null> {
  const bodyGroup = worldSvg.querySelector('[data-ink-bleed-body="true"]') as SVGGElement | null;
  if (!bodyGroup) return null;

  let rawBBox: ExportBBox | null = null;
  try {
    const b = bodyGroup.getBBox();
    rawBBox = { x: b.x, y: b.y, width: b.width, height: b.height };
  } catch {
    rawBBox = null;
  }

  const viewBox = computeUncutExportViewBox(rawBBox, computedJoints, 48);

  const svgNs = 'http://www.w3.org/2000/svg';
  const exportSvg = document.createElementNS(svgNs, 'svg');
  exportSvg.setAttribute('xmlns', svgNs);
  exportSvg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
  exportSvg.setAttribute('width', String(viewBox.exportWidth));
  exportSvg.setAttribute('height', String(viewBox.exportHeight));
  exportSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const inkBleedFilter = worldSvg.querySelector('#bitruvius-ink-bleed');
  if (inkBleedFilter) {
    const defs = document.createElementNS(svgNs, 'defs');
    defs.appendChild(inkBleedFilter.cloneNode(true));
    exportSvg.appendChild(defs);
  }

  const bodyClone = bodyGroup.cloneNode(true) as SVGGElement;
  stripSelectionFromClonedBody(bodyClone);
  exportSvg.appendChild(bodyClone);

  const serializer = new XMLSerializer();
  const svgMarkup = serializer.serializeToString(exportSvg);
  const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = (err) => reject(err);
      image.src = svgUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = viewBox.exportWidth;
    canvas.height = viewBox.exportHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const pngBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((blob) => resolve(blob), 'image/png')
    );
    if (!pngBlob) return null;

    const filename = `bitruvius-model-${formatExportTimestamp(now)}.png`;
    triggerBlobDownload(pngBlob, filename);
    return { filename, width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
