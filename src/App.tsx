import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlipHorizontal2,
  Grid3X3,
  Maximize2,
  Minus,
  Moon,
  Plus,
  RotateCcw,
  Ruler,
  Square,
  Sun,
} from 'lucide-react';
import { BookStageCanvas } from './components/BookStageCanvas';
import { JOINT_SPEC_MAP } from './data/digitalRig';
import { GridConfig, PageId } from './types/canvas';
import { ArmatureState, JointId, JointMode, PhysicsModeId, PosePresetId } from './types/rig';
import {
  POSE_PRESET_LABELS,
  applyJointAngleConstraint,
  computeArmature,
  createPosePreset,
  formatSignedDeg,
  getPhysicsMultiplier,
  mirrorPose,
} from './utils/kinematics';
import {
  PAPER_HEIGHT,
  PAPER_WIDTH,
  PYXL_PX,
  computeSymmetricalCenterPan,
  computeSymmetricalFitZoom,
  formatSignedNum,
} from './utils/proportions';
import {
  DEFAULT_SCREEN_FPS,
  ScreenFpsOption,
  getNextFpsOption,
} from './utils/frameThrottle';
import { copyPoseDataToClipboard, savePoseDataFile } from './utils/poseExport';

// Load directly with the Cover state as the active canvas backdrop
const INITIAL_PAGE: PageId = 'page-22';

export default function App() {
  const [pageId] = useState<PageId>(INITIAL_PAGE);
  const [darkMode, setDarkMode] = useState(false);
  const [screenFps, setScreenFps] = useState<ScreenFpsOption>(DEFAULT_SCREEN_FPS);
  const [viewportSize, setViewportSize] = useState({ width: 1440, height: 780 });
  const [zoom, setZoom] = useState<number>(() => computeSymmetricalFitZoom(1440, 780));
  const [pan, setPan] = useState<{ x: number; y: number }>(() =>
    computeSymmetricalCenterPan(
      1440,
      780,
      PAPER_WIDTH / 2,
      PAPER_HEIGHT / 2,
      computeSymmetricalFitZoom(1440, 780)
    )
  );
  const [cursorCoords, setCursorCoords] = useState<{ x: number; y: number } | null>(null);
  const [grid, setGrid] = useState<GridConfig>({
    showSubpyxl: true,
    showPyxl: true,
    showMegapyxl: true,
    showVitruvianGuide: true,
    showWorkingSquare: true,
    showEightHeadGuide: true,
    showRulers: true,
    inkStrength: 'light',
  });

  // 43-joint procedural digital puppet state
  const [armature, setArmature] = useState<ArmatureState>(() => createPosePreset('tpose'));
  const [activePreset, setActivePreset] = useState<PosePresetId | null>('tpose');
  const [selectedJointId, setSelectedJointId] = useState<JointId>('humerusR');
  const [hoveredJointId, setHoveredJointId] = useState<JointId | null>(null);
  const historyRef = useRef<ArmatureState[]>([]);
  const latestArmatureRef = useRef<ArmatureState>(armature);
  latestArmatureRef.current = armature;

  const userCameraEditedRef = useRef(false);

  const computedJoints = useMemo(
    () => computeArmature(armature, { x: PAPER_WIDTH / 2, y: PAPER_HEIGHT / 2 }),
    [armature]
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const fitSymmetricalView = useCallback(
    (size = viewportSize) => {
      const nextZoom = computeSymmetricalFitZoom(size.width, size.height);
      const nextPan = computeSymmetricalCenterPan(
        size.width,
        size.height,
        PAPER_WIDTH / 2,
        PAPER_HEIGHT / 2,
        nextZoom
      );
      setZoom(nextZoom);
      setPan(nextPan);
    },
    [viewportSize]
  );

  const handleViewportResize = useCallback(
    (nextSize: { width: number; height: number }) => {
      setViewportSize((prev) => {
        if (prev.width === nextSize.width && prev.height === nextSize.height) return prev;
        return nextSize;
      });
      if (!userCameraEditedRef.current) {
        const nextZoom = computeSymmetricalFitZoom(nextSize.width, nextSize.height);
        setZoom(nextZoom);
        setPan(
          computeSymmetricalCenterPan(
            nextSize.width,
            nextSize.height,
            PAPER_WIDTH / 2,
            PAPER_HEIGHT / 2,
            nextZoom
          )
        );
      } else {
        setPan((prevPan) => ({
          x: prevPan.x + (nextSize.width - viewportSize.width) / 2,
          y: prevPan.y + (nextSize.height - viewportSize.height) / 2,
        }));
      }
    },
    [viewportSize.height, viewportSize.width]
  );

  const handleZoomChange = useCallback((nextZoom: number) => {
    userCameraEditedRef.current = true;
    setZoom(nextZoom);
  }, []);

  const handlePanChange = useCallback((nextPan: { x: number; y: number }) => {
    userCameraEditedRef.current = true;
    setPan(nextPan);
  }, []);

  const handleZoomStep = useCallback(
    (factor: number) => {
      userCameraEditedRef.current = true;
      const nextZoom = Math.max(0.1, Math.min(2.4, zoom * factor));
      const cx = viewportSize.width / 2;
      const cy = viewportSize.height / 2;
      const worldX = (cx - pan.x) / zoom;
      const worldY = (cy - pan.y) / zoom;
      setZoom(nextZoom);
      setPan({
        x: cx - worldX * nextZoom,
        y: cy - worldY * nextZoom,
      });
    },
    [pan.x, pan.y, viewportSize.height, viewportSize.width, zoom]
  );

  const handleSetExactZoom = useCallback(
    (targetZoom: number) => {
      userCameraEditedRef.current = true;
      setZoom(targetZoom);
      setPan(
        computeSymmetricalCenterPan(
          viewportSize.width,
          viewportSize.height,
          PAPER_WIDTH / 2,
          PAPER_HEIGHT / 2,
          targetZoom
        )
      );
    },
    [viewportSize.height, viewportSize.width]
  );

  const handleFitClick = useCallback(() => {
    userCameraEditedRef.current = false;
    fitSymmetricalView(viewportSize);
  }, [fitSymmetricalView, viewportSize]);

  const handleTurnPage = useCallback((_target: PageId) => {
    // Page turning deferred until page-turn controls are re-enabled
  }, []);

  const handleCycleInk = useCallback(() => {
    setGrid((prev) => ({
      ...prev,
      inkStrength:
        prev.inkStrength === 'whisper'
          ? 'light'
          : prev.inkStrength === 'light'
          ? 'draft'
          : 'whisper',
    }));
  }, []);

  const handleCycleFps = useCallback(() => {
    setScreenFps((prev) => getNextFpsOption(prev));
  }, []);

  const commitPoseHistory = useCallback(() => {
    historyRef.current = [...historyRef.current.slice(-24), latestArmatureRef.current];
  }, []);

  const handleUpdateArmature = useCallback((next: ArmatureState) => {
    latestArmatureRef.current = next;
    setActivePreset(null);
    setArmature(next);
  }, []);

  const handleApplyPreset = useCallback(
    (preset: PosePresetId) => {
      commitPoseHistory();
      setActivePreset(preset);
      setArmature((prev) => createPosePreset(preset, prev));
    },
    [commitPoseHistory]
  );

  const handleMirrorPose = useCallback(() => {
    commitPoseHistory();
    setActivePreset(null);
    setArmature((prev) => mirrorPose(prev));
  }, [commitPoseHistory]);

  const handleResetPose = useCallback(() => {
    commitPoseHistory();
    setActivePreset('tpose');
    setArmature((prev) => createPosePreset('tpose', prev));
  }, [commitPoseHistory]);

  const handleCopyPoseData = useCallback(() => {
    const current = latestArmatureRef.current;
    const joints = computeArmature(current, { x: PAPER_WIDTH / 2, y: PAPER_HEIGHT / 2 });
    return copyPoseDataToClipboard(current, joints, activePreset);
  }, [activePreset]);

  const handleSavePoseData = useCallback(() => {
    const current = latestArmatureRef.current;
    const joints = computeArmature(current, { x: PAPER_WIDTH / 2, y: PAPER_HEIGHT / 2 });
    savePoseDataFile(current, joints, activePreset);
  }, [activePreset]);

  const handleNudgeSelectedJoint = useCallback(
    (deltaDeg: number) => {
      const targetId: JointId =
        selectedJointId === 'clavOuterR'
          ? 'braceR'
          : selectedJointId === 'clavOuterL'
          ? 'braceL'
          : selectedJointId;
      const spec = JOINT_SPEC_MAP[targetId];
      const runtime = armature.joints[targetId];
      if (!spec || spec.locked || !runtime || runtime.mode === 'PIN') return;
      const mult = getPhysicsMultiplier(runtime);
      if (mult === 0) return;

      commitPoseHistory();
      setActivePreset(null);
      if (targetId === 'pelvis') {
        setArmature((prev) => ({
          ...prev,
          rootRotation: applyJointAngleConstraint(
            prev.rootRotation + deltaDeg * mult,
            prev.continuousSpin
          ),
        }));
      } else {
        const isClosedTriangleSwivel =
          targetId === 'swivelR' ||
          targetId === 'swivelL' ||
          targetId === 'hipR' ||
          targetId === 'hipL' ||
          targetId === 'braceR' ||
          targetId === 'braceL';
        const limits = spec.limits;
        setArmature((prev) => {
          const rawNext = applyJointAngleConstraint(
            prev.joints[targetId].localAngle + deltaDeg * mult,
            prev.continuousSpin
          );
          const nextAngle =
            isClosedTriangleSwivel && limits
              ? Math.max(limits[0], Math.min(limits[1], rawNext))
              : rawNext;
          return {
            ...prev,
            joints: {
              ...prev.joints,
              [targetId]: {
                ...prev.joints[targetId],
                localAngle: nextAngle,
              },
            },
          };
        });
      }
    },
    [armature.joints, commitPoseHistory, selectedJointId]
  );

  const handleZeroSelectedJoint = useCallback(() => {
    const targetId: JointId =
      selectedJointId === 'clavOuterR'
        ? 'braceR'
        : selectedJointId === 'clavOuterL'
        ? 'braceL'
        : selectedJointId;
    const spec = JOINT_SPEC_MAP[targetId];
    if (!spec || spec.locked) return;
    commitPoseHistory();
    setActivePreset(null);
    if (targetId === 'pelvis') {
      setArmature((prev) => ({ ...prev, rootRotation: 0 }));
    } else {
      setArmature((prev) => ({
        ...prev,
        joints: {
          ...prev.joints,
          [targetId]: {
            ...prev.joints[targetId],
            localAngle: 0,
          },
        },
      }));
    }
  }, [commitPoseHistory, selectedJointId]);

  const handleCycleJointMode = useCallback(() => {
    const spec = JOINT_SPEC_MAP[selectedJointId];
    const rt = armature.joints[selectedJointId];
    if (!spec || spec.locked || !rt || selectedJointId === 'pelvis') return;
    const modes: JointMode[] = spec.ikChain ? ['IK', 'FK', 'PIN'] : ['FK', 'PIN'];
    const idx = modes.indexOf(rt.mode);
    const nextMode = modes[(idx + 1) % modes.length];
    setArmature((prev) => ({
      ...prev,
      joints: {
        ...prev.joints,
        [selectedJointId]: {
          ...prev.joints[selectedJointId],
          mode: nextMode,
        },
      },
    }));
  }, [armature.joints, selectedJointId]);

  const handleCyclePhysicsMode = useCallback(() => {
    const rt = armature.joints[selectedJointId];
    if (!rt) return;
    const order: PhysicsModeId[] = ['twins', 'elastic_rubber', 'damp', 'rigid'];
    const idx = order.indexOf(rt.physicsMode);
    const nextPhysics = order[(idx + 1) % order.length];
    setArmature((prev) => ({
      ...prev,
      joints: {
        ...prev.joints,
        [selectedJointId]: {
          ...prev.joints[selectedJointId],
          physicsMode: nextPhysics,
        },
      },
    }));
  }, [armature.joints, selectedJointId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        const last = historyRef.current[historyRef.current.length - 1];
        if (last) {
          e.preventDefault();
          historyRef.current = historyRef.current.slice(0, -1);
          setArmature(last);
        }
        return;
      }
      if (e.key === 'ArrowLeft' && e.shiftKey) {
        e.preventDefault();
        handleNudgeSelectedJoint(-5);
      } else if (e.key === 'ArrowRight' && e.shiftKey) {
        e.preventDefault();
        handleNudgeSelectedJoint(5);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleNudgeSelectedJoint]);

  const isCover = pageId === 'page-22';
  const gridAnyVisible = grid.showSubpyxl || grid.showPyxl || grid.showMegapyxl;
  const selectedComputed = computedJoints[selectedJointId];
  const selectedRuntime = armature.joints[selectedJointId];
  const selectedSpec = JOINT_SPEC_MAP[selectedJointId];

  const physicsLabel =
    selectedRuntime?.physicsMode === 'elastic_rubber'
      ? 'Elastic'
      : selectedRuntime?.physicsMode === 'damp'
      ? 'Damp'
      : selectedRuntime?.physicsMode === 'rigid'
      ? 'Rigid'
      : 'Twins';

  return (
    <div className="h-screen w-screen flex flex-col bg-[#16001E] text-[#EFEAF4] overflow-hidden">
      {/* Slim Top Editorial Bar */}
      <header className="h-11 px-3 sm:px-6 bg-[#16001E] border-b border-[#EBE0F5]/14 flex items-center justify-between gap-2 sm:gap-6 shrink-0 z-20">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            handleFitClick();
          }}
          className="font-typewriter font-bold text-xs sm:text-base tracking-wider text-[#F4EFF9] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#D8B4FE]"
        >
          Bitruvius
        </a>

        {/* Canvas, Grid & Dark Mode Controls */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <button
            type="button"
            disabled={!isCover}
            aria-pressed={gridAnyVisible}
            onClick={() =>
              setGrid((prev) => {
                const nextOn = !(prev.showSubpyxl || prev.showPyxl || prev.showMegapyxl);
                return {
                  ...prev,
                  showSubpyxl: nextOn,
                  showPyxl: nextOn,
                  showMegapyxl: nextOn,
                };
              })
            }
            title="Toggle proportional light ink grid"
            className={`px-1.5 sm:px-2 py-1 font-vera text-[10.5px] font-bold rounded-[2px] border flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
              gridAnyVisible && isCover
                ? 'bg-[#2C143B] border-[#D8B4FE]/35 text-[#FAF6FF]'
                : 'bg-[#1D1026] border-[#EBE0F5]/14 text-[#B8A9C9] hover:text-[#FAF6FF]'
            }`}
          >
            <Grid3X3 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Grid</span>
          </button>

          <button
            type="button"
            disabled={!isCover}
            aria-pressed={grid.showVitruvianGuide && grid.showWorkingSquare}
            onClick={() =>
              setGrid((prev) => {
                const nextOn = !(
                  prev.showVitruvianGuide ||
                  prev.showWorkingSquare ||
                  prev.showEightHeadGuide
                );
                return {
                  ...prev,
                  showVitruvianGuide: nextOn,
                  showWorkingSquare: nextOn,
                  showEightHeadGuide: nextOn,
                };
              })
            }
            title="Toggle Working Square, Vitruvian & 8-Head proportional guides"
            className={`px-1.5 sm:px-2 py-1 font-vera text-[10.5px] font-bold rounded-[2px] border flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
              (grid.showVitruvianGuide || grid.showWorkingSquare || grid.showEightHeadGuide) &&
              isCover
                ? 'bg-[#2C143B] border-[#D8B4FE]/35 text-[#FAF6FF]'
                : 'bg-[#1D1026] border-[#EBE0F5]/14 text-[#B8A9C9] hover:text-[#FAF6FF]'
            }`}
          >
            <Square className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Guides</span>
          </button>

          <button
            type="button"
            disabled={!isCover}
            aria-pressed={grid.showRulers}
            onClick={() => setGrid((prev) => ({ ...prev, showRulers: !prev.showRulers }))}
            title="Toggle symmetrical edge rulers"
            className={`hidden sm:flex px-2 py-1 font-vera text-[10.5px] font-bold rounded-[2px] border items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
              grid.showRulers && isCover
                ? 'bg-[#2C143B] border-[#D8B4FE]/35 text-[#FAF6FF]'
                : 'bg-[#1D1026] border-[#EBE0F5]/14 text-[#B8A9C9] hover:text-[#FAF6FF]'
            }`}
          >
            <Ruler className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Rulers</span>
          </button>

          <button
            type="button"
            disabled={!isCover}
            onClick={handleCycleInk}
            title="Cycle light ink density (Whisper · Light · Draft)"
            className="hidden md:inline-flex px-2 py-1 font-vera text-[10.5px] font-bold rounded-[2px] border bg-[#1D1026] border-[#EBE0F5]/14 text-[#D9CBE8] hover:text-[#FAF6FF] whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
          >
            Ink: {grid.inkStrength === 'whisper' ? 'Whisper' : grid.inkStrength === 'light' ? 'Light' : 'Draft'}
          </button>

          <button
            type="button"
            onClick={handleCycleFps}
            data-fps-toggle="true"
            title="Cycle screen FPS cap (12 · 15 · 24 · 30 FPS)"
            className="px-1.5 sm:px-2 py-1 font-vera text-[10.5px] font-bold rounded-[2px] border bg-[#1D1026] border-[#EBE0F5]/14 text-[#D9CBE8] hover:text-[#FAF6FF] whitespace-nowrap shrink-0 cursor-pointer tabular-nums"
          >
            {screenFps} FPS
          </button>

          <button
            type="button"
            aria-pressed={darkMode}
            onClick={() => setDarkMode((prev) => !prev)}
            title="Toggle Dark Mode (Black paper & white border)"
            className={`px-1.5 sm:px-2.5 py-1 font-vera text-[10.5px] font-bold rounded-[2px] border flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              darkMode
                ? 'bg-[#FAF6FF] border-white text-[#16001E]'
                : 'bg-[#1D1026] border-[#EBE0F5]/20 text-[#EFEAF4] hover:text-white'
            }`}
          >
            {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            <span>{darkMode ? 'Light' : 'Dark'}</span>
          </button>
        </div>
      </header>

      {/* Symmetrical Viewing Window Stage */}
      <main className="flex-1 min-h-0 flex flex-col relative">
        <BookStageCanvas
          pageId={pageId}
          grid={grid}
          darkMode={darkMode}
          screenFps={screenFps}
          zoom={zoom}
          pan={pan}
          armature={armature}
          computedJoints={computedJoints}
          selectedJointId={selectedJointId}
          hoveredJointId={hoveredJointId}
          onZoomChange={handleZoomChange}
          onPanChange={handlePanChange}
          onViewportResize={handleViewportResize}
          onCursorMove={setCursorCoords}
          onTurnPage={(target) => handleTurnPage(target)}
          onFitRequest={handleFitClick}
          onCopyPoseData={handleCopyPoseData}
          onSavePoseData={handleSavePoseData}
          onSelectJoint={setSelectedJointId}
          onHoverJoint={setHoveredJointId}
          onUpdateArmature={handleUpdateArmature}
          onCommitPoseHistory={commitPoseHistory}
        />
      </main>

      {/* Compact Predictable Puppet Control Strip (Shown on Back Cover workspace) */}
      {isCover && (
        <section
          aria-label="Digital puppet controls"
          className="h-9 px-3 sm:px-6 bg-[#1B0825] border-t border-[#EBE0F5]/14 flex items-center justify-between gap-2 shrink-0 z-20 text-[10.5px] overflow-x-auto"
        >
          {/* Pose Presets & Symmetry */}
          <div className="flex items-center gap-1 shrink-0">
            {(['tpose', 'vitruvian', 'contrapposto', 'striding'] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => handleApplyPreset(preset)}
                className={`px-2 py-0.5 font-vera font-bold rounded-[2px] border whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  activePreset === preset
                    ? 'bg-[#361547] border-[#D8B4FE]/45 text-[#FAF6FF]'
                    : 'bg-[#16001E] border-[#EBE0F5]/14 text-[#C8B2E0] hover:text-[#FAF6FF]'
                }`}
              >
                {POSE_PRESET_LABELS[preset]}
              </button>
            ))}
            <button
              type="button"
              onClick={handleMirrorPose}
              title="Mirror current puppet pose across midline"
              className="px-2 py-0.5 font-vera font-bold rounded-[2px] border bg-[#16001E] border-[#EBE0F5]/14 text-[#C8B2E0] hover:text-[#FAF6FF] flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FlipHorizontal2 className="w-3 h-3" />
              <span className="hidden sm:inline">Mirror</span>
            </button>
            <button
              type="button"
              onClick={handleResetPose}
              title="Reset puppet to canonical T-Pose"
              className="px-2 py-0.5 font-vera font-bold rounded-[2px] border bg-[#16001E] border-[#EBE0F5]/14 text-[#C8B2E0] hover:text-[#FAF6FF] flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span className="hidden sm:inline">Reset</span>
            </button>
          </div>

          {/* Selected Joint Control */}
          <div className="flex items-center gap-1.5 shrink-0 tabular-nums font-vera">
            <span className="text-[#D8B4FE] font-bold whitespace-nowrap">
              {selectedSpec?.shortCode ?? selectedJointId}
            </span>
            <span className="font-typewriter font-bold text-[#FAF6FF] min-w-[54px] text-right whitespace-nowrap">
              {selectedComputed ? formatSignedDeg(selectedComputed.localAngle) : '+0.00°'}
            </span>
            <button
              type="button"
              disabled={selectedSpec?.locked}
              onClick={() => handleNudgeSelectedJoint(-5)}
              title="Rotate selected joint -5°"
              className="px-1.5 py-0.5 bg-[#16001E] border border-[#EBE0F5]/16 rounded-[2px] text-[#E6DCF0] hover:bg-[#361547] disabled:opacity-35 cursor-pointer whitespace-nowrap"
            >
              -5°
            </button>
            <button
              type="button"
              disabled={selectedSpec?.locked}
              onClick={handleZeroSelectedJoint}
              title="Zero selected joint angle"
              className="px-1.5 py-0.5 bg-[#16001E] border border-[#EBE0F5]/16 rounded-[2px] text-[#C8B2E0] hover:bg-[#361547] disabled:opacity-35 cursor-pointer whitespace-nowrap"
            >
              0°
            </button>
            <button
              type="button"
              disabled={selectedSpec?.locked}
              onClick={() => handleNudgeSelectedJoint(5)}
              title="Rotate selected joint +5°"
              className="px-1.5 py-0.5 bg-[#16001E] border border-[#EBE0F5]/16 rounded-[2px] text-[#E6DCF0] hover:bg-[#361547] disabled:opacity-35 cursor-pointer whitespace-nowrap"
            >
              +5°
            </button>
            {selectedJointId !== 'pelvis' && !selectedSpec?.locked && (
              <button
                type="button"
                onClick={handleCycleJointMode}
                title="Cycle joint solver mode (FK / IK / PIN)"
                className="px-2 py-0.5 bg-[#2C143B] border border-[#D8B4FE]/35 rounded-[2px] font-bold text-[#FAF6FF] hover:bg-[#361547] cursor-pointer whitespace-nowrap"
              >
                {selectedRuntime?.mode ?? 'FK'}
              </button>
            )}
            <button
              type="button"
              onClick={handleCyclePhysicsMode}
              title="Cycle joint physics damping ratio"
              className="hidden md:inline-flex px-2 py-0.5 bg-[#16001E] border border-[#EBE0F5]/16 rounded-[2px] text-[#D9CBE8] hover:text-[#FAF6FF] cursor-pointer whitespace-nowrap"
            >
              {physicsLabel}
            </button>
          </div>
        </section>
      )}

      {/* Slim Bottom Coordinate & Symmetry Bar */}
      <footer className="h-9 px-3 sm:px-6 bg-[#16001E] border-t border-[#EBE0F5]/12 flex items-center justify-between gap-2 sm:gap-4 shrink-0 z-20 text-[11px]">
        <div className="flex items-center gap-3 min-w-0 overflow-hidden whitespace-nowrap font-vera tabular-nums">
          <span>
            <span className="text-[#9E8EB3] mr-1">X</span>
            <span className="font-typewriter font-bold text-[#FAF6FF]">
              {cursorCoords ? `${formatSignedNum(cursorCoords.x / PYXL_PX)} pyx` : '+0.00 pyx'}
            </span>
          </span>
          <span>
            <span className="text-[#9E8EB3] mr-1">Y</span>
            <span className="font-typewriter font-bold text-[#FAF6FF]">
              {cursorCoords ? `${formatSignedNum(cursorCoords.y / PYXL_PX)} pyx` : '+0.00 pyx'}
            </span>
          </span>
          <span className="hidden md:inline text-[#9E8EB3]">·</span>
          <span className="hidden md:inline text-[#C8B2E0]">
            Window {viewportSize.width} × {viewportSize.height}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0 tabular-nums">
          <button
            type="button"
            onClick={() => handleZoomStep(0.85)}
            aria-label="Zoom out"
            title="Zoom out"
            className="p-1.5 text-[#E6DCF0] hover:bg-[#2A1D36] rounded-[2px] cursor-pointer"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleSetExactZoom(1.0)}
            title="Set 100.00% scale"
            className="px-2 py-0.5 font-typewriter font-bold text-[11px] text-[#FAF6FF] hover:bg-[#2A1D36] rounded-[2px] cursor-pointer min-w-[48px] text-center whitespace-nowrap"
          >
            {(zoom * 100).toFixed(0)}%
          </button>
          <button
            type="button"
            onClick={() => handleZoomStep(1.18)}
            aria-label="Zoom in"
            title="Zoom in"
            className="p-1.5 text-[#E6DCF0] hover:bg-[#2A1D36] rounded-[2px] cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleFitClick}
            title="Fit symmetrically to window"
            className="px-2 py-0.5 font-vera font-bold text-[10.5px] text-[#D8B4FE] hover:bg-[#2A1D36] rounded-[2px] flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            <Maximize2 className="w-3 h-3" />
            <span>Fit</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
