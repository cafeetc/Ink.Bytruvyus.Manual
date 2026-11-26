import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { JOINT_SPEC_MAP, REPO_DARKEST_PURPLE } from '../data/digitalRig';
import { GridConfig, PageId, TurnDirection } from '../types/canvas';
import { ArmatureState, ComputedJoint, JointId } from '../types/rig';
import {
  applyJointAngleConstraint,
  getPhysicsMultiplier,
  shortestAngleDelta,
  solveSpineCCDIK,
  solveTwoBoneIK,
} from '../utils/kinematics';
import {
  MEGAPYXL_PX,
  PAPER_HEIGHT,
  PAPER_WIDTH,
  PYXL_PX,
  REPOSITORY_ASSET_PATHS,
  SUBPYXL_PX,
  computeProportionalCanons,
  computeSymmetricalBorderLayout,
  computeSymmetricalRulerTicks,
  getPageMetadata,
} from '../utils/proportions';
import {
  ScreenFpsOption,
  remainingScreenFrameWaitMs,
  shouldEmitScreenFrame,
} from '../utils/frameThrottle';
import { saveTransparentModelImage } from '../utils/poseExport';
import { DigitalMannequin } from './DigitalMannequin';
import { ScanBorderLayer } from './ScanBorderLayer';

interface BookStageCanvasProps {
  pageId: PageId;
  grid: GridConfig;
  darkMode: boolean;
  screenFps: ScreenFpsOption;
  zoom: number;
  pan: { x: number; y: number };
  armature: ArmatureState;
  computedJoints: Record<JointId, ComputedJoint>;
  selectedJointId: JointId;
  hoveredJointId: JointId | null;
  onZoomChange: (nextZoom: number) => void;
  onPanChange: (nextPan: { x: number; y: number }) => void;
  onViewportResize: (size: { width: number; height: number }) => void;
  onCursorMove: (coords: { x: number; y: number } | null) => void;
  onTurnPage: (target: PageId, direction: TurnDirection) => void;
  onFitRequest: () => void;
  onCopyPoseData: () => Promise<unknown> | void;
  onSavePoseData: () => void;
  onSelectJoint: (id: JointId) => void;
  onHoverJoint: (id: JointId | null) => void;
  onUpdateArmature: (next: ArmatureState) => void;
  onCommitPoseHistory: () => void;
}

const INK_STRENGTH_OPACITY = {
  whisper: { sub: 0.04, pyxl: 0.095, mega: 0.19, axis: 0.26, guide: 0.24 },
  light: { sub: 0.065, pyxl: 0.145, mega: 0.28, axis: 0.36, guide: 0.34 },
  draft: { sub: 0.105, pyxl: 0.22, mega: 0.40, axis: 0.50, guide: 0.46 },
} as const;

type ActiveDragState =
  | {
      type: 'pan';
      startClientX: number;
      startClientY: number;
      startPanX: number;
      startPanY: number;
    }
  | {
      type: 'root_translate';
      offsetX: number;
      offsetY: number;
    }
  | {
      type: 'ik';
      jointId: JointId;
      offsetX: number;
      offsetY: number;
    }
  | {
      type: 'fk_rotate';
      targetJointId: JointId;
      pivotX: number;
      pivotY: number;
      lastCursorDeg: number | null;
      rawAngle: number;
    };

export const BookStageCanvas: React.FC<BookStageCanvasProps> = ({
  pageId,
  grid,
  darkMode,
  screenFps,
  zoom,
  pan,
  armature,
  computedJoints,
  selectedJointId,
  hoveredJointId,
  onZoomChange,
  onPanChange,
  onViewportResize,
  onCursorMove,
  onTurnPage,
  onFitRequest,
  onCopyPoseData,
  onSavePoseData,
  onSelectJoint,
  onHoverJoint,
  onUpdateArmature,
  onCommitPoseHistory,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1440, height: 820 });
  const [dragState, setDragState] = useState<ActiveDragState | null>(null);
  const dragRef = useRef<ActiveDragState | null>(null);

  const armatureRef = useRef(armature);
  armatureRef.current = armature;
  const computedJointsRef = useRef(computedJoints);
  computedJointsRef.current = computedJoints;
  const panRef = useRef(pan);
  panRef.current = pan;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const screenFpsRef = useRef<ScreenFpsOption>(screenFps);
  screenFpsRef.current = screenFps;
  const lastRightClickRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const lastLeftClickRef = useRef<{ time: number; x: number; y: number; count: number } | null>(null);
  const leftClickTimerRef = useRef<number | null>(null);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const [lastExportKind, setLastExportKind] = useState<'none' | 'clipboard' | 'pose' | 'png'>('none');

  const pendingUpdateRef = useRef<{
    hasCursor?: boolean;
    cursor?: { x: number; y: number } | null;
    pan?: { x: number; y: number };
    zoom?: number;
    armature?: ArmatureState;
  }>({});
  const lastScreenEmitMsRef = useRef<number>(-1);
  const screenTimerRef = useRef<number | null>(null);

  const [turnAnim, setTurnAnim] = useState<{
    key: number;
    direction: TurnDirection;
    fromPage: PageId;
    fromSubstrate: 'cover' | 'paper';
    toSubstrate: 'cover' | 'paper';
  } | null>(null);
  const prevPageRef = useRef<PageId>(pageId);
  const lastRequestedDirRef = useRef<TurnDirection>('next');
  const turnCounterRef = useRef(0);

  const meta = getPageMetadata(pageId);
  const isCover = meta.substrate === 'cover';
  // Back Cover (Page 22) hosts all circles, squares, light ink grids, rulers & procedural digital bones;
  // Soft Paper (Page 21) stays kept in the back as a clean backing paper leaf.
  const showCoverWorkspace = isCover;
  void onTurnPage;
  void onFitRequest;

  const flushScreenFrame = useCallback(
    (force = false) => {
      if (screenTimerRef.current !== null) {
        window.clearTimeout(screenTimerRef.current);
        screenTimerRef.current = null;
      }
      const now = performance.now();
      const fps = screenFpsRef.current;
      if (!force && !shouldEmitScreenFrame(lastScreenEmitMsRef.current, now, fps)) {
        const waitMs = remainingScreenFrameWaitMs(lastScreenEmitMsRef.current, now, fps);
        screenTimerRef.current = window.setTimeout(() => {
          screenTimerRef.current = null;
          flushScreenFrame(false);
        }, waitMs);
        return;
      }

      const pending = pendingUpdateRef.current;
      if (
        !pending.hasCursor &&
        pending.pan === undefined &&
        pending.zoom === undefined &&
        pending.armature === undefined
      ) {
        return;
      }
      pendingUpdateRef.current = {};
      lastScreenEmitMsRef.current = now;

      if (pending.hasCursor) {
        onCursorMove(pending.cursor ?? null);
      }
      if (pending.zoom !== undefined) {
        onZoomChange(pending.zoom);
      }
      if (pending.pan !== undefined) {
        onPanChange(pending.pan);
      }
      if (pending.armature !== undefined) {
        onUpdateArmature(pending.armature);
      }
    },
    [onCursorMove, onPanChange, onUpdateArmature, onZoomChange]
  );

  const enqueueScreenUpdate = useCallback(
    (patch: {
      hasCursor?: boolean;
      cursor?: { x: number; y: number } | null;
      pan?: { x: number; y: number };
      zoom?: number;
      armature?: ArmatureState;
    }) => {
      pendingUpdateRef.current = {
        ...pendingUpdateRef.current,
        ...patch,
      };
      if (screenTimerRef.current !== null) {
        return;
      }
      const now = performance.now();
      const fps = screenFpsRef.current;
      if (shouldEmitScreenFrame(lastScreenEmitMsRef.current, now, fps)) {
        flushScreenFrame(false);
      } else {
        const waitMs = remainingScreenFrameWaitMs(lastScreenEmitMsRef.current, now, fps);
        screenTimerRef.current = window.setTimeout(() => {
          screenTimerRef.current = null;
          flushScreenFrame(false);
        }, waitMs);
      }
    },
    [flushScreenFrame]
  );

  useEffect(() => {
    return () => {
      if (screenTimerRef.current !== null) {
        window.clearTimeout(screenTimerRef.current);
        screenTimerRef.current = null;
      }
      if (leftClickTimerRef.current !== null) {
        window.clearTimeout(leftClickTimerRef.current);
        leftClickTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const nextSize = { width: Math.round(rect.width), height: Math.round(rect.height) };
        setViewportSize(nextSize);
        onViewportResize(nextSize);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onViewportResize]);

  useEffect(() => {
    const prevPage = prevPageRef.current;
    if (prevPage === pageId) return;
    const prevMeta = getPageMetadata(prevPage);
    const currMeta = getPageMetadata(pageId);

    turnCounterRef.current += 1;
    setTurnAnim({
      key: turnCounterRef.current,
      direction: lastRequestedDirRef.current,
      fromPage: prevPage,
      fromSubstrate: prevMeta.substrate,
      toSubstrate: currMeta.substrate,
    });
    prevPageRef.current = pageId;

    const timer = window.setTimeout(() => {
      setTurnAnim(null);
    }, 480);
    return () => window.clearTimeout(timer);
  }, [pageId]);

  const borderLayout = useMemo(
    () => computeSymmetricalBorderLayout(viewportSize.width, viewportSize.height),
    [viewportSize.width, viewportSize.height]
  );

  const canons = useMemo(() => computeProportionalCanons(), []);
  const originOffset = useMemo(() => ({ x: PAPER_WIDTH / 2, y: PAPER_HEIGHT / 2 }), []);

  const endlessBounds = useMemo(() => {
    const overscan = Math.max(2200, 1600 / Math.max(0.1, zoom));
    const minX = -pan.x / zoom - overscan;
    const minY = -pan.y / zoom - overscan;
    const width = viewportSize.width / zoom + overscan * 2;
    const height = viewportSize.height / zoom + overscan * 2;
    return {
      minX,
      minY,
      width,
      height,
      maxX: minX + width,
      maxY: minY + height,
    };
  }, [pan.x, pan.y, zoom, viewportSize.width, viewportSize.height]);

  const rulerTicks = useMemo(() => {
    const edgeMargin = Math.max(46, borderLayout.cornerSize + 18);
    return {
      xTicks: computeSymmetricalRulerTicks(
        viewportSize.width,
        pan.x,
        zoom,
        originOffset.x,
        edgeMargin,
        edgeMargin,
        44
      ),
      yTicks: computeSymmetricalRulerTicks(
        viewportSize.height,
        pan.y,
        zoom,
        originOffset.y,
        edgeMargin,
        edgeMargin,
        24
      ),
    };
  }, [
    borderLayout.cornerSize,
    originOffset.x,
    originOffset.y,
    pan.x,
    pan.y,
    viewportSize.height,
    viewportSize.width,
    zoom,
  ]);

  const inkOpacity = INK_STRENGTH_OPACITY[grid.inkStrength];
  const subpyxlZoomOpacity = zoom < 0.25 ? 0.22 : zoom < 0.5 ? 0.55 : 1.0;

  // World SVG coordinates (same coordinate frame as originOffset = (PAPER_WIDTH/2, PAPER_HEIGHT/2))
  const clientToSvgWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: originOffset.x, y: originOffset.y };
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      return {
        x: (sx - panRef.current.x) / zoomRef.current,
        y: (sy - panRef.current.y) / zoomRef.current,
      };
    },
    [originOffset.x, originOffset.y]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 0.91;
      const curZoom = zoomRef.current;
      const curPan = panRef.current;
      const nextZoom = Math.max(0.1, Math.min(2.4, curZoom * factor));
      const worldX = (sx - curPan.x) / curZoom;
      const worldY = (sy - curPan.y) / curZoom;
      const nextPan = {
        x: sx - worldX * nextZoom,
        y: sy - worldY * nextZoom,
      };
      zoomRef.current = nextZoom;
      panRef.current = nextPan;
      enqueueScreenUpdate({ zoom: nextZoom, pan: nextPan });
    },
    [enqueueScreenUpdate]
  );

  const safeSetPointerCapture = useCallback((pointerId: number) => {
    try {
      svgRef.current?.setPointerCapture(pointerId);
    } catch {
      // Ignore synthetic/stale pointer IDs
    }
  }, []);

  const setActiveDrag = useCallback((next: ActiveDragState | null) => {
    dragRef.current = next;
    setDragState(next);
  }, []);

  const beginPanDrag = useCallback(
    (e: React.PointerEvent) => {
      safeSetPointerCapture(e.pointerId);
      setActiveDrag({
        type: 'pan',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: panRef.current.x,
        startPanY: panRef.current.y,
      });
    },
    [safeSetPointerCapture, setActiveDrag]
  );

  const startCumulativeFKRotate = useCallback(
    (e: React.PointerEvent, targetJointId: JointId) => {
      const curArmature = armatureRef.current;
      const runtime = curArmature.joints[targetJointId];
      const spec = JOINT_SPEC_MAP[targetJointId];
      if (!runtime || spec?.locked || runtime.mode === 'PIN' || runtime.physicsMode === 'rigid') {
        return;
      }
      const world = clientToSvgWorld(e.clientX, e.clientY);
      const pivot = computedJointsRef.current[targetJointId];
      const dist = Math.hypot(world.x - pivot.x, world.y - pivot.y);
      const lastCursorDeg =
        dist >= 4 ? (Math.atan2(world.y - pivot.y, world.x - pivot.x) * 180) / Math.PI : null;
      const rawAngle = targetJointId === 'pelvis' ? curArmature.rootRotation : runtime.localAngle;
      safeSetPointerCapture(e.pointerId);
      setActiveDrag({
        type: 'fk_rotate',
        targetJointId,
        pivotX: pivot.x,
        pivotY: pivot.y,
        lastCursorDeg,
        rawAngle,
      });
    },
    [clientToSvgWorld, safeSetPointerCapture, setActiveDrag]
  );

  const handlePointerDownStage = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.button !== 0 && e.button !== 1) return;
      beginPanDrag(e);
    },
    [beginPanDrag]
  );

  const handlePointerDownJoint = useCallback(
    (e: React.PointerEvent<SVGGElement>, jointId: JointId) => {
      e.stopPropagation();
      onSelectJoint(jointId);
      const curArmature = armatureRef.current;
      const joint = computedJointsRef.current[jointId];
      const spec = JOINT_SPEC_MAP[jointId];
      const world = clientToSvgWorld(e.clientX, e.clientY);

      if (joint.mode === 'ROOT' || jointId === 'pelvis') {
        if (curArmature.joints.pelvis.physicsMode === 'rigid') return;
        if (!curArmature.isAnchorPinned) {
          safeSetPointerCapture(e.pointerId);
          setActiveDrag({
            type: 'root_translate',
            offsetX: joint.x - world.x,
            offsetY: joint.y - world.y,
          });
        } else {
          startCumulativeFKRotate(e, 'pelvis');
        }
        return;
      }

      if (joint.mode === 'IK' && joint.spec.ikChain) {
        if (curArmature.joints[jointId].physicsMode === 'rigid') return;
        safeSetPointerCapture(e.pointerId);
        setActiveDrag({
          type: 'ik',
          jointId,
          offsetX: joint.x - world.x,
          offsetY: joint.y - world.y,
        });
        return;
      }

      let targetId: JointId =
        jointId === 'clavOuterR' ? 'braceR' : jointId === 'clavOuterL' ? 'braceL' : jointId;
      if (spec.isTip || spec.locked) {
        let cur: JointId | null = spec.parentId;
        while (cur && JOINT_SPEC_MAP[cur]?.locked) {
          cur = JOINT_SPEC_MAP[cur].parentId;
        }
        if (cur) targetId = cur;
      }
      const targetRt = curArmature.joints[targetId];
      if (!targetRt || targetRt.mode === 'PIN' || targetRt.physicsMode === 'rigid') return;
      startCumulativeFKRotate(e, targetId);
    },
    [
      clientToSvgWorld,
      onSelectJoint,
      safeSetPointerCapture,
      setActiveDrag,
      startCumulativeFKRotate,
    ]
  );

  const handlePointerDownBone = useCallback(
    (e: React.PointerEvent<SVGElement>, jointId: JointId) => {
      e.stopPropagation();
      onSelectJoint(jointId);
      // Dragging either half of the split collarbone folds it rotationally up or down
      const drivenJointId: JointId =
        jointId === 'clavOuterR' ? 'braceR' : jointId === 'clavOuterL' ? 'braceL' : jointId;
      const curArmature = armatureRef.current;
      const runtime = curArmature.joints[drivenJointId];
      if (!runtime || runtime.mode === 'PIN' || runtime.physicsMode === 'rigid') return;

      if (drivenJointId === 'pelvis' && !curArmature.isAnchorPinned) {
        const world = clientToSvgWorld(e.clientX, e.clientY);
        const pelvis = computedJointsRef.current.pelvis;
        safeSetPointerCapture(e.pointerId);
        setActiveDrag({
          type: 'root_translate',
          offsetX: pelvis.x - world.x,
          offsetY: pelvis.y - world.y,
        });
        return;
      }

      startCumulativeFKRotate(e, drivenJointId);
    },
    [
      clientToSvgWorld,
      onSelectJoint,
      safeSetPointerCapture,
      setActiveDrag,
      startCumulativeFKRotate,
    ]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const world = clientToSvgWorld(e.clientX, e.clientY);
      const cursorPatch = {
        hasCursor: true,
        cursor: {
          x: world.x - originOffset.x,
          y: world.y - originOffset.y,
        },
      };

      const activeDrag = dragRef.current;
      if (!activeDrag) {
        enqueueScreenUpdate(cursorPatch);
        return;
      }

      if (activeDrag.type === 'pan') {
        const nextPan = {
          x: activeDrag.startPanX + (e.clientX - activeDrag.startClientX),
          y: activeDrag.startPanY + (e.clientY - activeDrag.startClientY),
        };
        panRef.current = nextPan;
        enqueueScreenUpdate({ ...cursorPatch, pan: nextPan });
        return;
      }

      const curArmature = armatureRef.current;

      if (activeDrag.type === 'root_translate') {
        const nextArmature: ArmatureState = {
          ...curArmature,
          rootX: world.x + activeDrag.offsetX,
          rootY: world.y + activeDrag.offsetY,
        };
        armatureRef.current = nextArmature;
        enqueueScreenUpdate({ ...cursorPatch, armature: nextArmature });
        return;
      }

      if (activeDrag.type === 'ik') {
        const targetX = world.x + activeDrag.offsetX;
        const targetY = world.y + activeDrag.offsetY;
        const joint = computedJointsRef.current[activeDrag.jointId];
        const nextArmature =
          joint.spec.ikChain === 'spine'
            ? solveSpineCCDIK(curArmature, targetX, targetY, originOffset)
            : solveTwoBoneIK(curArmature, activeDrag.jointId, targetX, targetY, originOffset);
        armatureRef.current = nextArmature;
        enqueueScreenUpdate({ ...cursorPatch, armature: nextArmature });
        return;
      }

      if (activeDrag.type === 'fk_rotate') {
        const { targetJointId, pivotX, pivotY, lastCursorDeg, rawAngle } = activeDrag;
        const distFromPivot = Math.hypot(world.x - pivotX, world.y - pivotY);
        if (distFromPivot < 4) {
          enqueueScreenUpdate(cursorPatch);
          return;
        }
        const currDeg = (Math.atan2(world.y - pivotY, world.x - pivotX) * 180) / Math.PI;
        if (lastCursorDeg === null) {
          dragRef.current = { ...activeDrag, lastCursorDeg: currDeg };
          enqueueScreenUpdate(cursorPatch);
          return;
        }
        const deltaCursor = shortestAngleDelta(lastCursorDeg, currDeg);
        if (Math.abs(deltaCursor) < 1e-4) {
          enqueueScreenUpdate(cursorPatch);
          return;
        }

        const runtime = curArmature.joints[targetJointId];
        const mult = getPhysicsMultiplier(runtime);
        if (mult === 0) {
          enqueueScreenUpdate(cursorPatch);
          return;
        }

        const nextUnclamped = rawAngle + deltaCursor * mult;
        const isClosedTriangleSwivel =
          targetJointId === 'swivelR' ||
          targetJointId === 'swivelL' ||
          targetJointId === 'hipR' ||
          targetJointId === 'hipL' ||
          targetJointId === 'braceR' ||
          targetJointId === 'braceL';
        const swivelLimits = JOINT_SPEC_MAP[targetJointId]?.limits;
        const nextRawAngle =
          isClosedTriangleSwivel && swivelLimits
            ? Math.max(swivelLimits[0], Math.min(swivelLimits[1], nextUnclamped))
            : curArmature.continuousSpin
            ? nextUnclamped
            : Math.max(-180, Math.min(180, nextUnclamped));
        dragRef.current = {
          ...activeDrag,
          lastCursorDeg: currDeg,
          rawAngle: nextRawAngle,
        };

        const constrainedAngle = applyJointAngleConstraint(
          nextRawAngle,
          curArmature.continuousSpin
        );
        const nextLocalAngle =
          isClosedTriangleSwivel && swivelLimits
            ? Math.max(swivelLimits[0], Math.min(swivelLimits[1], constrainedAngle))
            : constrainedAngle;
        const nextArmature: ArmatureState =
          targetJointId === 'pelvis'
            ? {
                ...curArmature,
                rootRotation: nextLocalAngle,
              }
            : {
                ...curArmature,
                joints: {
                  ...curArmature.joints,
                  [targetJointId]: {
                    ...runtime,
                    localAngle: nextLocalAngle,
                  },
                },
              };
        armatureRef.current = nextArmature;
        enqueueScreenUpdate({ ...cursorPatch, armature: nextArmature });
      }
    },
    [clientToSvgWorld, enqueueScreenUpdate, originOffset]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (svgRef.current?.hasPointerCapture(e.pointerId)) {
        svgRef.current.releasePointerCapture(e.pointerId);
      }
      const activeDrag = dragRef.current;
      flushScreenFrame(true);
      if (
        activeDrag &&
        (activeDrag.type === 'fk_rotate' ||
          activeDrag.type === 'ik' ||
          activeDrag.type === 'root_translate')
      ) {
        onCommitPoseHistory();
      }
      setActiveDrag(null);
    },
    [flushScreenFrame, onCommitPoseHistory, setActiveDrag]
  );

  const inkRgb = darkMode ? '240, 234, 248' : '22, 0, 30';
  const inkHex = darkMode ? '#F0EAF8' : REPO_DARKEST_PURPLE;
  const paperBg = darkMode ? '#000000' : isCover ? '#CECAC2' : '#EFECE6';

  const eightHeadSpan = canons.eightHeadTotalPx;
  const eightHeadTopY = originOffset.y - eightHeadSpan / 2;

  const wsHalf = canons.workingSquareHalfPx;
  const wsX = originOffset.x - wsHalf;
  const wsY = originOffset.y - wsHalf;

  return (
    <div
      ref={containerRef}
      data-stage-viewport="true"
      data-page-id={pageId}
      data-substrate={meta.substrate}
      data-dark-mode={darkMode ? 'true' : 'false'}
      data-target-fps={screenFps}
      data-last-export={lastExportKind}
      data-vw={viewportSize.width}
      data-vh={viewportSize.height}
      className="relative flex-1 w-full h-full overflow-hidden select-none transition-colors duration-300"
      style={{
        backgroundColor: paperBg,
        cursor: dragState?.type === 'pan' ? 'grabbing' : 'crosshair',
      }}
    >
      {/* Kept-in-Back Soft Archival Paper Layer (z-0, rests underneath the Back Cover stack) */}
      <div
        aria-hidden="true"
        data-paper-surface="true"
        data-paper-role="backing-leaf"
        className="pointer-events-none absolute inset-0 z-0"
      >
        <img
          src={REPOSITORY_ASSET_PATHS.page21PaperPng}
          alt="Soft print paper leaf kept in the back"
          referrerPolicy="no-referrer"
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            darkMode ? 'invert opacity-[0.07]' : 'opacity-85'
          }`}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${REPOSITORY_ASSET_PATHS.analogPaperPng})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            opacity: darkMode ? 0.05 : 0.14,
            filter: darkMode ? 'invert(1)' : undefined,
            mixBlendMode: darkMode ? 'screen' : 'multiply',
          }}
        />
        {/* Clean Backing Paper Leaf caption when viewing Paper state */}
        {!isCover && (
          <div className="absolute inset-0 flex flex-col items-center justify-between py-14 px-6 text-center pointer-events-none">
            <div
              className={`font-typewriter text-[11px] tracking-[0.26em] uppercase ${
                darkMode ? 'text-[#EFEAF4]/55' : 'text-[#16001E]/55'
              }`}
            >
              Soft Paper · Backing Leaf
            </div>
            <div className="flex flex-col items-center gap-2 opacity-50">
              <div className={`w-16 h-px ${darkMode ? 'bg-[#EFEAF4]/40' : 'bg-[#16001E]/40'}`} />
              <div
                className={`font-vera text-[10px] tracking-[0.16em] uppercase ${
                  darkMode ? 'text-[#EFEAF4]/75' : 'text-[#16001E]/75'
                }`}
              >
                Soft Backing Paper · Cover Holds Grid &amp; Digital Bones
              </div>
              <div className={`w-16 h-px ${darkMode ? 'bg-[#EFEAF4]/40' : 'bg-[#16001E]/40'}`} />
            </div>
            <div
              className={`font-vera text-[10px] tracking-[0.14em] uppercase ${
                darkMode ? 'text-[#EFEAF4]/45' : 'text-[#16001E]/45'
              }`}
            >
              Archival Leaf · 1363 × 1800
            </div>
          </div>
        )}
      </div>

      {/* Primary Back Cover Backdrop (z-[1] — Active Backdrop on Load) */}
      {isCover && (
        <div
          aria-hidden="true"
          data-cover-surface="true"
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{ backgroundColor: darkMode ? '#000000' : '#CECAC2' }}
        >
          <img
            src={REPOSITORY_ASSET_PATHS.page22CoverPng}
            alt="Symmetrical mottled back cover texture traced from 1901 manual page 22"
            referrerPolicy="no-referrer"
            className={`absolute inset-0 w-full h-full object-cover transition-all duration-300 ${
              darkMode
                ? 'invert opacity-[0.09] contrast-125'
                : 'opacity-86 contrast-105'
            }`}
          />
          <div
            className="absolute inset-0"
            style={{
              boxShadow: darkMode
                ? 'inset 0 0 0 1px rgba(255, 255, 255, 0.16), inset 0 0 42px rgba(0, 0, 0, 0.85)'
                : 'inset 0 0 0 2px rgba(22, 0, 30, 0.24), inset 0 0 42px rgba(20, 16, 24, 0.22)',
            }}
          />
        </div>
      )}

      {/* Main Proportional SVG World Plane (Mounted onto the Back Cover Backdrop) */}
      <svg
        ref={svgRef}
        data-world-canvas="true"
        className={`relative z-[2] w-full h-full block touch-none transition-opacity duration-200 ${
          showCoverWorkspace ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDownCapture={(e) => {
          if (e.button === 0) {
            pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
          }
          if (e.button === 2) {
            e.preventDefault();
            e.stopPropagation();
            const now = performance.now();
            const prev = lastRightClickRef.current;
            if (
              prev &&
              now - prev.time <= 450 &&
              Math.hypot(e.clientX - prev.x, e.clientY - prev.y) <= 16
            ) {
              lastRightClickRef.current = null;
              const svgEl = svgRef.current;
              if (svgEl) {
                void saveTransparentModelImage(svgEl, computedJointsRef.current).then((res) => {
                  if (res) setLastExportKind('png');
                });
              }
            } else {
              lastRightClickRef.current = { time: now, x: e.clientX, y: e.clientY };
            }
          }
        }}
        onPointerDown={handlePointerDownStage}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          enqueueScreenUpdate({ hasCursor: true, cursor: null });
          flushScreenFrame(true);
        }}
        onClick={(e) => {
          if (e.button !== 0) return;
          const downPos = pointerDownPosRef.current;
          pointerDownPosRef.current = null;
          if (downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 6) {
            lastLeftClickRef.current = null;
            return;
          }
          const now = performance.now();
          const prev = lastLeftClickRef.current;
          const withinWindow =
            prev &&
            now - prev.time <= 380 &&
            Math.hypot(e.clientX - prev.x, e.clientY - prev.y) <= 16;
          const nextCount = withinWindow ? prev.count + 1 : 1;
          lastLeftClickRef.current = {
            time: now,
            x: e.clientX,
            y: e.clientY,
            count: nextCount,
          };

          if (leftClickTimerRef.current !== null) {
            window.clearTimeout(leftClickTimerRef.current);
            leftClickTimerRef.current = null;
          }

          if (nextCount >= 3) {
            lastLeftClickRef.current = null;
            onSavePoseData();
            setLastExportKind('pose');
          } else if (nextCount === 2) {
            leftClickTimerRef.current = window.setTimeout(() => {
              leftClickTimerRef.current = null;
              lastLeftClickRef.current = null;
              void Promise.resolve(onCopyPoseData()).then(() => {
                setLastExportKind('clipboard');
              });
            }, 250);
          }
        }}
      >
        <defs>
          <pattern
            id="grid-subpyxl"
            width={SUBPYXL_PX}
            height={SUBPYXL_PX}
            patternUnits="userSpaceOnUse"
            x={originOffset.x}
            y={originOffset.y}
          >
            <path
              d={`M ${SUBPYXL_PX} 0 L 0 0 0 ${SUBPYXL_PX}`}
              fill="none"
              stroke={`rgba(${inkRgb}, ${inkOpacity.sub})`}
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            />
          </pattern>
          <pattern
            id="grid-pyxl"
            width={PYXL_PX}
            height={PYXL_PX}
            patternUnits="userSpaceOnUse"
            x={originOffset.x}
            y={originOffset.y}
          >
            <path
              d={`M ${PYXL_PX} 0 L 0 0 0 ${PYXL_PX}`}
              fill="none"
              stroke={`rgba(${inkRgb}, ${inkOpacity.pyxl})`}
              strokeWidth={0.9}
              vectorEffect="non-scaling-stroke"
            />
          </pattern>
          <pattern
            id="grid-megapyxl"
            width={MEGAPYXL_PX}
            height={MEGAPYXL_PX}
            patternUnits="userSpaceOnUse"
            x={originOffset.x}
            y={originOffset.y}
          >
            <path
              d={`M ${MEGAPYXL_PX} 0 L 0 0 0 ${MEGAPYXL_PX}`}
              fill="none"
              stroke={`rgba(${inkRgb}, ${inkOpacity.mega})`}
              strokeWidth={1.35}
              vectorEffect="non-scaling-stroke"
            />
          </pattern>
        </defs>

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Endless proportional light ink grid layers */}
          {grid.showSubpyxl && (
            <rect
              x={endlessBounds.minX}
              y={endlessBounds.minY}
              width={endlessBounds.width}
              height={endlessBounds.height}
              fill="url(#grid-subpyxl)"
              opacity={subpyxlZoomOpacity}
              pointerEvents="none"
            />
          )}
          {grid.showPyxl && (
            <rect
              x={endlessBounds.minX}
              y={endlessBounds.minY}
              width={endlessBounds.width}
              height={endlessBounds.height}
              fill="url(#grid-pyxl)"
              pointerEvents="none"
            />
          )}
          {grid.showMegapyxl && (
            <rect
              x={endlessBounds.minX}
              y={endlessBounds.minY}
              width={endlessBounds.width}
              height={endlessBounds.height}
              fill="url(#grid-megapyxl)"
              pointerEvents="none"
            />
          )}

          {/* Symmetrical X / Y Datum Axes & Optical Center Reticle */}
          <g pointerEvents="none">
            <line
              x1={originOffset.x}
              y1={endlessBounds.minY}
              x2={originOffset.x}
              y2={endlessBounds.maxY}
              stroke={`rgba(${inkRgb}, ${inkOpacity.axis})`}
              strokeWidth={1.1}
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={endlessBounds.minX}
              y1={originOffset.y}
              x2={endlessBounds.maxX}
              y2={originOffset.y}
              stroke={`rgba(${inkRgb}, ${inkOpacity.axis})`}
              strokeWidth={1.1}
              vectorEffect="non-scaling-stroke"
            />
            <g transform={`translate(${originOffset.x}, ${originOffset.y}) scale(${1 / zoom})`}>
              <circle
                r={7}
                fill="none"
                stroke={`rgba(${inkRgb}, ${inkOpacity.axis + 0.18})`}
                strokeWidth={1.1}
              />
              <circle r={1.8} fill={`rgba(${inkRgb}, ${inkOpacity.axis + 0.3})`} />
            </g>
          </g>

          {/* Proportional Working Square */}
          {grid.showWorkingSquare && (
            <g pointerEvents="none">
              <rect
                x={wsX}
                y={wsY}
                width={canons.workingSquareSidePx}
                height={canons.workingSquareSidePx}
                fill="none"
                stroke={`rgba(${inkRgb}, ${inkOpacity.guide})`}
                strokeWidth={1.1}
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={wsX}
                y1={wsY}
                x2={wsX + canons.workingSquareSidePx}
                y2={wsY + canons.workingSquareSidePx}
                stroke={`rgba(${inkRgb}, ${inkOpacity.guide * 0.42})`}
                strokeWidth={0.75}
                strokeDasharray="4 6"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={wsX + canons.workingSquareSidePx}
                y1={wsY}
                x2={wsX}
                y2={wsY + canons.workingSquareSidePx}
                stroke={`rgba(${inkRgb}, ${inkOpacity.guide * 0.42})`}
                strokeWidth={0.75}
                strokeDasharray="4 6"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}

          {/* Vitruvian Classical Circle & Square Overlay */}
          {grid.showVitruvianGuide && (
            <g pointerEvents="none">
              <rect
                x={originOffset.x - canons.vitruvianSquareWidth / 2}
                y={originOffset.y - canons.vitruvianSquareHeight / 2}
                width={canons.vitruvianSquareWidth}
                height={canons.vitruvianSquareHeight}
                fill="none"
                stroke={`rgba(${inkRgb}, ${inkOpacity.guide})`}
                strokeWidth={1.1}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={originOffset.x}
                cy={originOffset.y}
                r={canons.vitruvianCircleRadius}
                fill="none"
                stroke={`rgba(${inkRgb}, ${inkOpacity.guide})`}
                strokeWidth={1.1}
                strokeDasharray="5 5"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}

          {/* 8-Head Horizontal Proportional Ruled Bands */}
          {grid.showEightHeadGuide && (
            <g pointerEvents="none">
              {Array.from({ length: 9 }).map((_, idx) => {
                const y = eightHeadTopY + idx * canons.headUnitPx;
                const halfBand = canons.vitruvianSquareWidth / 2;
                return (
                  <g key={`head-div-${idx}`}>
                    <line
                      x1={originOffset.x - halfBand}
                      y1={y}
                      x2={originOffset.x + halfBand}
                      y2={y}
                      stroke={`rgba(${inkRgb}, ${idx === 0 || idx === 8 ? 0.28 : 0.14})`}
                      strokeWidth={idx === 0 || idx === 8 ? 1.0 : 0.75}
                      strokeDasharray={idx === 4 ? undefined : '4 6'}
                      vectorEffect="non-scaling-stroke"
                    />
                    <text
                      x={originOffset.x - halfBand - 22}
                      y={y + 6}
                      textAnchor="end"
                      fill={`rgba(${inkRgb}, 0.48)`}
                      fontSize={16}
                      fontFamily="Bitstream Vera Sans Mono, monospace"
                    >
                      {idx}H
                    </text>
                  </g>
                );
              })}
            </g>
          )}

          {/* Cover Proportional Spec Caption */}
          {showCoverWorkspace && (
            <g pointerEvents="none">
              <text
                x={originOffset.x}
                y={originOffset.y - canons.vitruvianCircleRadius - 48}
                textAnchor="middle"
                fill={`rgba(${inkRgb}, 0.60)`}
                fontSize={22}
                fontFamily="UMTypewriter, monospace"
                letterSpacing="4"
              >
                BACK COVER · PROPORTIONAL CANVAS
              </text>
              <text
                x={originOffset.x}
                y={originOffset.y + canons.vitruvianCircleRadius + 48}
                textAnchor="middle"
                fill={`rgba(${inkRgb}, 0.52)`}
                fontSize={18}
                fontFamily="Bitstream Vera Sans Mono, monospace"
              >
                TORSO 1.25× HIPS · 1.00 PYX = 100 PX · R = 6.35 PYX
              </text>
            </g>
          )}

          {/* Pure Data Procedural SVG Digital Bones Puppet (#16001E Cave-Art Geometry) */}
          <DigitalMannequin
            armature={armature}
            computedJoints={computedJoints}
            selectedJointId={selectedJointId}
            hoveredJointId={hoveredJointId}
            zoom={zoom}
            darkMode={darkMode}
            isPanning={dragState?.type === 'pan'}
            onHoverJoint={onHoverJoint}
            onPointerDownJoint={handlePointerDownJoint}
            onPointerDownBone={handlePointerDownBone}
          />
        </g>
      </svg>

      {/* Symmetrical Edge Rulers (light ink ticks hugging all 4 inner borders symmetrically) */}
      {showCoverWorkspace && grid.showRulers && (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 w-full h-full z-[6]"
          viewBox={`0 0 ${viewportSize.width} ${viewportSize.height}`}
          preserveAspectRatio="none"
        >
          <g>
            {rulerTicks.xTicks.map((tick, idx) => (
              <React.Fragment key={`rx-${idx}`}>
                <g transform={`translate(${tick.screen}, ${borderLayout.edgeThickness})`}>
                  <line
                    x1={0}
                    y1={0}
                    x2={0}
                    y2={tick.tier === 'mega' ? 9 : tick.tier === 'major' ? 7 : 4}
                    stroke={`rgba(${inkRgb}, ${tick.tier === 'mega' ? 0.58 : tick.tier === 'major' ? 0.38 : 0.22})`}
                    strokeWidth={tick.tier === 'mega' ? 1.25 : 0.9}
                  />
                  {tick.label && (
                    <text
                      x={0}
                      y={19}
                      textAnchor="middle"
                      fill={inkHex}
                      fillOpacity={tick.tier === 'mega' ? 0.72 : 0.52}
                      fontSize={tick.tier === 'mega' ? 10 : 9}
                      fontWeight={tick.tier === 'mega' ? 700 : 400}
                      fontFamily="UMTypewriter, monospace"
                    >
                      {tick.label}
                    </text>
                  )}
                </g>
                <g transform={`translate(${tick.screen}, ${viewportSize.height - borderLayout.edgeThickness})`}>
                  <line
                    x1={0}
                    y1={0}
                    x2={0}
                    y2={-(tick.tier === 'mega' ? 9 : tick.tier === 'major' ? 7 : 4)}
                    stroke={`rgba(${inkRgb}, ${tick.tier === 'mega' ? 0.48 : tick.tier === 'major' ? 0.3 : 0.18})`}
                    strokeWidth={tick.tier === 'mega' ? 1.25 : 0.9}
                  />
                </g>
              </React.Fragment>
            ))}

            {rulerTicks.yTicks.map((tick, idx) => (
              <React.Fragment key={`ry-${idx}`}>
                <g transform={`translate(${borderLayout.edgeThickness}, ${tick.screen})`}>
                  <line
                    x1={0}
                    y1={0}
                    x2={tick.tier === 'mega' ? 9 : tick.tier === 'major' ? 7 : 4}
                    y2={0}
                    stroke={`rgba(${inkRgb}, ${tick.tier === 'mega' ? 0.58 : tick.tier === 'major' ? 0.38 : 0.22})`}
                    strokeWidth={tick.tier === 'mega' ? 1.25 : 0.9}
                  />
                  {tick.label && (
                    <text
                      x={13}
                      y={3}
                      textAnchor="start"
                      fill={inkHex}
                      fillOpacity={tick.tier === 'mega' ? 0.72 : 0.52}
                      fontSize={tick.tier === 'mega' ? 10 : 9}
                      fontWeight={tick.tier === 'mega' ? 700 : 400}
                      fontFamily="UMTypewriter, monospace"
                    >
                      {tick.label}
                    </text>
                  )}
                </g>
                <g transform={`translate(${viewportSize.width - borderLayout.edgeThickness}, ${tick.screen})`}>
                  <line
                    x1={0}
                    y1={0}
                    x2={-(tick.tier === 'mega' ? 9 : tick.tier === 'major' ? 7 : 4)}
                    y2={0}
                    stroke={`rgba(${inkRgb}, ${tick.tier === 'mega' ? 0.48 : tick.tier === 'major' ? 0.3 : 0.18})`}
                    strokeWidth={tick.tier === 'mega' ? 1.25 : 0.9}
                  />
                </g>
              </React.Fragment>
            ))}
          </g>
        </svg>
      )}

      {/* Turning Page/Board Overlay Plane */}
      {turnAnim && (
        <div
          key={`leaf-${turnAnim.key}`}
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 z-[8] ${
            turnAnim.fromSubstrate === 'cover' || turnAnim.toSubstrate === 'cover'
              ? turnAnim.direction === 'next'
                ? 'animate-cover-next'
                : 'animate-cover-prev'
              : turnAnim.direction === 'next'
              ? 'animate-paper-next'
              : 'animate-paper-prev'
          }`}
          style={{
            backgroundColor: darkMode
              ? 'rgba(10, 10, 14, 0.92)'
              : turnAnim.fromSubstrate === 'cover'
              ? 'rgba(206, 202, 194, 0.92)'
              : 'rgba(239, 236, 230, 0.90)',
            boxShadow: darkMode
              ? '0 0 42px rgba(255, 255, 255, 0.18)'
              : turnAnim.fromSubstrate === 'cover'
              ? '0 0 48px rgba(0, 0, 0, 0.42)'
              : '0 0 32px rgba(28, 20, 34, 0.22)',
          }}
        />
      )}

      {/* Symmetrical Scan-Edge Border & Edge Animation Engine */}
      <ScanBorderLayer
        vw={viewportSize.width}
        vh={viewportSize.height}
        substrate={meta.substrate}
        darkMode={darkMode}
        turnAnim={turnAnim}
      />
    </div>
  );
};
