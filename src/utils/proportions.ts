import {
  PageId,
  PageMeta,
  ProportionalCanons,
  RulerTick,
  SymmetricalBorderLayout,
  SymmetricalBorderSlice,
  TurnDirection,
} from '../types/canvas';

export const PAPER_WIDTH = 1363;
export const PAPER_HEIGHT = 1800;

export const SUBPYXL_PX = 10;
export const PYXL_PX = 100;
export const MEGAPYXL_PX = 1000;
export const PUPPYT_TO_EVOLVED_SCALE = 0.14;

export const SRC_CORNER = 32;
export const SRC_EDGE = 32;

export const REPOSITORY_ASSET_PATHS = {
  vectorBorderSvg: '/assets/aistudio/Vector_paper_2dac36ce.svg',
  vectorPaperSvg: '/assets/aistudio/Vector_paper_png_2dac36ce.svg',
  analogPaperPng: '/assets/aistudio/Analog_paper_png_1a4024ad.png',
  page21PaperPng: '/assets/manual/page_21_paper.png',
  page22CoverPng: '/assets/manual/page_22_cover.png',
} as const;

export const PAGE_SEQUENCE: readonly PageId[] = ['page-21', 'page-22'];

export const PAGE_METADATA: Record<PageId, PageMeta> = {
  'page-21': {
    id: 'page-21',
    substrate: 'paper',
    folioLabel: 'Paper',
    shortLabel: 'Paper',
    folioNumber: 21,
    title: 'Soft Print Paper',
    subtitle: 'Manual Leaf · Light Ink Proportional Grid & Navel Datum',
    specNote: '1 pyx = 100 px · 10 subpyxl = 1 pyx · 10 pyx = 1 mpyx',
  },
  'page-22': {
    id: 'page-22',
    substrate: 'cover',
    folioLabel: 'Cover',
    shortLabel: 'Cover',
    folioNumber: 22,
    title: 'Hard Cover',
    subtitle: 'Traced Bookboard Paper · Rigid Cover Substrate',
    specNote: 'Traced 1901 manual back cover scan · 1363 × 1800',
  },
};

export function getPageMetadata(pageId: PageId): PageMeta {
  return PAGE_METADATA[pageId];
}

export function getAdjacentPage(current: PageId, _direction: TurnDirection): PageId {
  return current === 'page-21' ? 'page-22' : 'page-21';
}

export function formatSignedNum(val: number, decimals = 2): string {
  const rounded = Math.abs(val) < 1e-6 ? 0 : val;
  const sign = rounded >= 0 ? '+' : '-';
  return `${sign}${Math.abs(rounded).toFixed(decimals)}`;
}

/**
 * Computes exact symmetrical pan coordinates so that (originX, originY) in world space
 * sits at the exact symmetrical optical center (vw / 2, vh / 2) of the viewing window.
 */
export function computeSymmetricalCenterPan(
  vw: number,
  vh: number,
  originX = PAPER_WIDTH / 2,
  originY = PAPER_HEIGHT / 2,
  zoom = 0.36
): { x: number; y: number } {
  return {
    x: vw / 2 - originX * zoom,
    y: vh / 2 - originY * zoom,
  };
}

/**
 * Computes an optimal symmetrical zoom that cleanly frames the proportional Working Square
 * inside any viewing window size while preserving generous scan-border margins.
 */
export function computeSymmetricalFitZoom(
  vw: number,
  vh: number,
  targetSpanPx = 1232
): number {
  const safeW = Math.max(120, vw - 112);
  const safeH = Math.max(120, vh - 112);
  const raw = Math.min(safeW / targetSpanPx, safeH / targetSpanPx);
  return Math.max(0.1, Math.min(1.5, Number(raw.toFixed(4))));
}

/**
 * Computes a perfectly symmetrical 9-slice layout from the 1363x1800 scanned paper border.
 * Left/Right edges and Top/Bottom edges share identical thickness and mirror-matched geometry,
 * adapting seamlessly to any viewing window dimension (vw x vh).
 */
export function computeSymmetricalBorderLayout(
  vw: number,
  vh: number
): SymmetricalBorderLayout {
  const safeW = Math.max(2, vw);
  const safeH = Math.max(2, vh);

  const scale = Math.min(1, safeW / (SRC_CORNER * 2), safeH / (SRC_CORNER * 2));
  const cornerSize = SRC_CORNER * scale;
  const edgeThickness = SRC_EDGE * scale;

  const midW = Math.max(0, safeW - cornerSize * 2);
  const midH = Math.max(0, safeH - cornerSize * 2);

  const srcMidW = PAPER_WIDTH - SRC_CORNER * 2;
  const srcMidH = PAPER_HEIGHT - SRC_CORNER * 2;

  const slices: SymmetricalBorderSlice[] = [
    {
      id: 'corner-tl',
      x: 0,
      y: 0,
      w: cornerSize,
      h: cornerSize,
      viewBox: `0 0 ${SRC_CORNER} ${SRC_CORNER}`,
    },
    {
      id: 'corner-tr',
      x: safeW - cornerSize,
      y: 0,
      w: cornerSize,
      h: cornerSize,
      viewBox: `0 0 ${SRC_CORNER} ${SRC_CORNER}`,
      flipX: true,
    },
    {
      id: 'corner-bl',
      x: 0,
      y: safeH - cornerSize,
      w: cornerSize,
      h: cornerSize,
      viewBox: `0 0 ${SRC_CORNER} ${SRC_CORNER}`,
      flipY: true,
    },
    {
      id: 'corner-br',
      x: safeW - cornerSize,
      y: safeH - cornerSize,
      w: cornerSize,
      h: cornerSize,
      viewBox: `0 0 ${SRC_CORNER} ${SRC_CORNER}`,
      flipX: true,
      flipY: true,
    },
  ];

  if (midW > 0) {
    slices.push({
      id: 'edge-top',
      x: cornerSize,
      y: 0,
      w: midW,
      h: edgeThickness,
      viewBox: `${SRC_CORNER} 0 ${srcMidW} ${SRC_EDGE}`,
    });
    slices.push({
      id: 'edge-bottom',
      x: cornerSize,
      y: safeH - edgeThickness,
      w: midW,
      h: edgeThickness,
      viewBox: `${SRC_CORNER} 0 ${srcMidW} ${SRC_EDGE}`,
      flipY: true,
    });
  }

  if (midH > 0) {
    slices.push({
      id: 'edge-left',
      x: 0,
      y: cornerSize,
      w: edgeThickness,
      h: midH,
      viewBox: `0 ${SRC_CORNER} ${SRC_EDGE} ${srcMidH}`,
    });
    slices.push({
      id: 'edge-right',
      x: safeW - edgeThickness,
      y: cornerSize,
      w: edgeThickness,
      h: midH,
      viewBox: `0 ${SRC_CORNER} ${SRC_EDGE} ${srcMidH}`,
      flipX: true,
    });
  }

  return {
    vw: safeW,
    vh: safeH,
    cornerSize,
    edgeThickness,
    midW,
    midH,
    slices,
  };
}

/**
 * Derives the exact Bitruvian proportional system from the canonical 43-joint Puppyt landmarks
 * and PUPPYT_TO_EVOLVED_SCALE (0.14) without instantiating the mannequin rig.
 */
export function computeProportionalCanons(): ProportionalCanons {
  const pelvisY = 3382;
  const thoraxY = 2099.5;
  const neckY = 862.5;
  const headY = 595.5;
  const crownY = -260;
  const chinY = 612;
  const toeY = 7593;
  const pelvisX = 1257;
  const humerusRX = 566.5;
  const forearmRX = 491.5;
  const handRX = 493.5;

  const lumbarPx = (pelvisY - thoraxY) * PUPPYT_TO_EVOLVED_SCALE;
  const thoraxPx = (thoraxY - neckY) * PUPPYT_TO_EVOLVED_SCALE;
  const neckPx = (neckY - headY) * PUPPYT_TO_EVOLVED_SCALE;
  const headExtPx = (headY - crownY) * PUPPYT_TO_EVOLVED_SCALE;
  const headUnitPx = (chinY - crownY) * PUPPYT_TO_EVOLVED_SCALE;

  const spineUpPx = lumbarPx + thoraxPx + neckPx + headExtPx;
  const legDownPx = (toeY - pelvisY) * PUPPYT_TO_EVOLVED_SCALE;
  const verticalSpanPx = spineUpPx + legDownPx;

  const shoulderOffsetPx = (pelvisX - humerusRX) * PUPPYT_TO_EVOLVED_SCALE;
  const humerusPx = Math.hypot(humerusRX - forearmRX, 1150.5 - 2351.5) * PUPPYT_TO_EVOLVED_SCALE;
  const forearmPx = Math.hypot(forearmRX - handRX, 2351.5 - 3611) * PUPPYT_TO_EVOLVED_SCALE;
  const handPx = (4436 - 3611) * PUPPYT_TO_EVOLVED_SCALE;
  const armHalfSpan = shoulderOffsetPx + humerusPx + forearmPx + handPx;
  const horizontalSpanPx = armHalfSpan * 2;

  const workingSquareSidePx = Math.max(horizontalSpanPx, verticalSpanPx);
  const workingSquareHalfPx = workingSquareSidePx / 2;
  const modelRootOffsetY = (spineUpPx - legDownPx) / 2;

  return {
    subpyxlPx: SUBPYXL_PX,
    pyxlPx: PYXL_PX,
    megapyxlPx: MEGAPYXL_PX,
    paperWidth: PAPER_WIDTH,
    paperHeight: PAPER_HEIGHT,
    paperAspect: PAPER_WIDTH / PAPER_HEIGHT,
    puppytScale: PUPPYT_TO_EVOLVED_SCALE,
    headUnitPx,
    spineUpPx,
    legDownPx,
    verticalSpanPx,
    horizontalSpanPx,
    workingSquareSidePx,
    workingSquareHalfPx,
    modelRootOffsetY,
    vitruvianSquareWidth: 1070,
    vitruvianSquareHeight: 1060,
    vitruvianCircleRadius: 635,
    eightHeadTotalPx: headUnitPx * 8,
  };
}

/**
 * Generates collision-free symmetrical ruler ticks in pyxl and megapyxl units
 * inside the scanned edge border.
 */
export function computeSymmetricalRulerTicks(
  viewportLength: number,
  panCoord: number,
  zoom: number,
  originCoord: number,
  marginMin: number,
  marginMax: number,
  minLabelGap: number
): RulerTick[] {
  type RawTick = {
    screen: number;
    world: number;
    candidateLabel: string | null;
    label: string | null;
    tier: 'mega' | 'major' | 'minor';
  };

  const showMinorLabels = PYXL_PX * zoom >= 72;
  const showMajorLabels = 5 * PYXL_PX * zoom >= 90;

  const minWorld = -panCoord / zoom;
  const maxWorld = (viewportLength - panCoord) / zoom;
  const minK = Math.floor((minWorld - originCoord) / PYXL_PX);
  const maxK = Math.ceil((maxWorld - originCoord) / PYXL_PX);

  const raw: RawTick[] = [];
  for (let k = minK; k <= maxK; k++) {
    const world = originCoord + k * PYXL_PX;
    const screen = panCoord + world * zoom;
    if (screen < marginMin || screen > viewportLength - marginMax) continue;

    const isMega = k % 10 === 0;
    const isMajor = !isMega && k % 5 === 0;
    let candidateLabel: string | null = null;
    if (isMega) {
      candidateLabel = k === 0 ? '0' : formatSignedNum(k / 10, 1);
    } else if (isMajor && showMajorLabels) {
      candidateLabel = formatSignedNum(k, 0);
    } else if (!isMajor && showMinorLabels) {
      candidateLabel = formatSignedNum(k, 0);
    }

    raw.push({
      screen,
      world,
      candidateLabel,
      label: null,
      tier: isMega ? 'mega' : isMajor ? 'major' : 'minor',
    });
  }

  const placed: number[] = [];
  for (const tier of ['mega', 'major', 'minor'] as const) {
    for (const tick of raw) {
      if (tick.tier !== tier || !tick.candidateLabel) continue;
      const collides = placed.some((pos) => Math.abs(pos - tick.screen) < minLabelGap);
      if (!collides) {
        tick.label = tick.candidateLabel;
        placed.push(tick.screen);
      }
    }
  }

  return raw.map(({ screen, world, label, tier }) => ({
    screen,
    world,
    label,
    tier,
  }));
}
