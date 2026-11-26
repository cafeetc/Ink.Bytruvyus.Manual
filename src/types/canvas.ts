export type PageId = 'page-21' | 'page-22';

export type SubstrateType = 'paper' | 'cover';

export type TurnDirection = 'prev' | 'next';

export interface GridConfig {
  showSubpyxl: boolean;     // 10 px = 0.10 pyx
  showPyxl: boolean;        // 100 px = 1.00 pyx
  showMegapyxl: boolean;    // 1,000 px = 10.00 pyx
  showVitruvianGuide: boolean;
  showWorkingSquare: boolean;
  showEightHeadGuide: boolean;
  showRulers: boolean;
  inkStrength: 'whisper' | 'light' | 'draft';
}

export interface PageMeta {
  id: PageId;
  substrate: SubstrateType;
  folioLabel: string;
  shortLabel: string;
  folioNumber: number;
  title: string;
  subtitle: string;
  specNote: string;
}

export interface SymmetricalBorderSlice {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  viewBox: string;
  flipX?: boolean;
  flipY?: boolean;
}

export interface SymmetricalBorderLayout {
  vw: number;
  vh: number;
  cornerSize: number;
  edgeThickness: number;
  midW: number;
  midH: number;
  slices: SymmetricalBorderSlice[];
}

export interface RulerTick {
  screen: number;
  world: number;
  label: string | null;
  tier: 'mega' | 'major' | 'minor';
}

export interface ProportionalCanons {
  subpyxlPx: number;
  pyxlPx: number;
  megapyxlPx: number;
  paperWidth: number;
  paperHeight: number;
  paperAspect: number;
  puppytScale: number;
  headUnitPx: number;
  spineUpPx: number;
  legDownPx: number;
  verticalSpanPx: number;
  horizontalSpanPx: number;
  workingSquareSidePx: number;
  workingSquareHalfPx: number;
  modelRootOffsetY: number;
  vitruvianSquareWidth: number;
  vitruvianSquareHeight: number;
  vitruvianCircleRadius: number;
  eightHeadTotalPx: number;
}
