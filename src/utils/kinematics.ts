import {
  PUPPYT_LANDMARKS,
  JOINT_SPECS,
  JOINT_SPEC_MAP,
  CANONICAL_RIG_PARENTS,
  SVG_MODEL_CONSTANTS,
} from '../data/digitalRig';
import {
  ANGLE_PRECISION_STEP,
  ArmatureState,
  BONE_SCALE_MAX,
  BONE_SCALE_MIN,
  CaveArtLine,
  CaveArtPolygon,
  CaveArtRigGeometry,
  ComputedJoint,
  EnvironmentalAnchorId,
  JointId,
  JointMode,
  JointRuntimeState,
  JointSpec,
  PhysicsModeId,
  Point2D,
  PosePresetId,
  RigHierarchyAuditReport,
} from '../types/rig';
import { PAPER_HEIGHT, PAPER_WIDTH, PUPPYT_TO_EVOLVED_SCALE } from './proportions';

export type Affine2D = readonly [number, number, number, number, number, number];

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export function mulAffine(a: Affine2D, b: Affine2D): Affine2D {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function applyAffine(m: Affine2D, x: number, y: number): Point2D {
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5],
  };
}

export function composeBoneMatrix(
  originX: number,
  originY: number,
  worldDeg: number,
  lenScale: number,
  widScale: number,
  restVecDeg: number,
  pivotX: number,
  pivotY: number
): Affine2D {
  const wr = worldDeg * DEG_TO_RAD;
  const rr = -restVecDeg * DEG_TO_RAD;
  const cw = Math.cos(wr);
  const sw = Math.sin(wr);
  const cr = Math.cos(rr);
  const sr = Math.sin(rr);

  const tOrigin: Affine2D = [1, 0, 0, 1, originX, originY];
  const rWorld: Affine2D = [cw, sw, -sw, cw, 0, 0];
  const scale: Affine2D = [lenScale, 0, 0, widScale, 0, 0];
  const rRestInv: Affine2D = [cr, sr, -sr, cr, 0, 0];
  const tPivotInv: Affine2D = [1, 0, 0, 1, -pivotX, -pivotY];

  return mulAffine(tOrigin, mulAffine(rWorld, mulAffine(scale, mulAffine(rRestInv, tPivotInv))));
}

const SVG_TO_PUPPYT_AFFINE: Affine2D = [
  SVG_MODEL_CONSTANTS.puppytScaleFactor,
  0,
  0,
  SVG_MODEL_CONSTANTS.puppytScaleFactor,
  SVG_MODEL_CONSTANTS.pelvisPuppytPivot[0] -
    SVG_MODEL_CONSTANTS.midX * SVG_MODEL_CONSTANTS.puppytScaleFactor,
  SVG_MODEL_CONSTANTS.pelvisPuppytPivot[1] -
    SVG_MODEL_CONSTANTS.waistY * SVG_MODEL_CONSTANTS.puppytScaleFactor,
];

const SVG_MIRROR_X_AFFINE: Affine2D = [-1, 0, 0, 1, SVG_MODEL_CONSTANTS.midX * 2, 0];

/**
 * Maps SVG coordinates from body_pose_full_b3b6bf24.svg directly through a joint's live
 * affine bone matrix into stage coordinates, optionally mirrored across the SVG midline.
 */
export function computeSvgBoneMatrix(boneMatrix: Affine2D, mirrorX = false): Affine2D {
  const local = mirrorX
    ? mulAffine(SVG_TO_PUPPYT_AFFINE, SVG_MIRROR_X_AFFINE)
    : SVG_TO_PUPPYT_AFFINE;
  return mulAffine(boneMatrix, local);
}

function vecAngleDeg(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.atan2(b[1] - a[1], b[0] - a[0]) * RAD_TO_DEG;
}

export const PHYSICS_MODE_INFO: Record<
  PhysicsModeId,
  { label: string; shortLabel: string; ratio: number | null; description: string }
> = {
  twins: {
    label: 'Twins',
    shortLabel: '1.00×',
    ratio: 1.0,
    description: '1:1 direct rotational input response',
  },
  elastic_rubber: {
    label: 'Elastic',
    shortLabel: '1.50×',
    ratio: 1.5,
    description: '150% amplified sweep ratio',
  },
  damp: {
    label: 'Damp',
    shortLabel: '0.50×',
    ratio: 0.5,
    description: '50% precision resistance ratio',
  },
  rigid: {
    label: 'Rigid',
    shortLabel: '0.00×',
    ratio: 0.0,
    description: '0% locked freeze preventing angular change',
  },
  mode_e: {
    label: 'Mode E',
    shortLabel: 'Gear',
    ratio: null,
    description: 'Custom steering gear ratio (0.50× to 1.50×)',
  },
};

export const MODE_E_MIN = 0.5;
export const MODE_E_MAX = 1.5;

export const POSE_PRESET_LABELS: Record<PosePresetId, string> = {
  tpose: 'T-Pose',
  vitruvian: 'Vitruvian',
  contrapposto: 'Contrapposto',
  striding: 'Striding',
};

export function auditRigHierarchy(
  specs: readonly JointSpec[] = JOINT_SPECS
): RigHierarchyAuditReport {
  const byId = new Map<JointId, JointSpec>();
  const idxById = new Map<JointId, number>();
  specs.forEach((s, i) => {
    byId.set(s.id, s);
    idxById.set(s.id, i);
  });

  const orphanNodes: string[] = [];
  const cycles: string[] = [];
  const topologicalViolations: string[] = [];
  const aimOrderViolations: string[] = [];
  const parentMismatches: Array<{ id: string; expected: string | null; actual: string | null }> = [];

  specs.forEach((s, i) => {
    if (s.parentId) {
      if (!byId.has(s.parentId)) {
        orphanNodes.push(s.id);
      } else if ((idxById.get(s.parentId) ?? -1) >= i) {
        topologicalViolations.push(s.id);
      }
    }
    if (s.aimTarget?.to) {
      const tIdx = idxById.get(s.aimTarget.to);
      if (tIdx === undefined) {
        orphanNodes.push(s.id);
      } else if (tIdx >= i) {
        aimOrderViolations.push(s.id);
      }
    }
    const expectedParent = CANONICAL_RIG_PARENTS[s.id];
    if (expectedParent !== s.parentId) {
      parentMismatches.push({
        id: s.id,
        expected: expectedParent,
        actual: s.parentId,
      });
    }
    const seen = new Set<JointId>([s.id]);
    let cur = s.parentId ? byId.get(s.parentId) : undefined;
    while (cur) {
      if (seen.has(cur.id)) {
        cycles.push(s.id);
        break;
      }
      seen.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  });

  return {
    valid:
      specs.length === 43 &&
      orphanNodes.length === 0 &&
      cycles.length === 0 &&
      topologicalViolations.length === 0 &&
      aimOrderViolations.length === 0 &&
      parentMismatches.length === 0,
    totalJoints: specs.length,
    orphanNodes,
    cycles,
    topologicalViolations,
    aimOrderViolations,
    parentMismatches,
  };
}

export function snapAnglePrecision(deg: number, step = ANGLE_PRECISION_STEP): number {
  return Math.round(deg / step) * step;
}

export function clampAngle180(deg: number): number {
  return Math.max(-180, Math.min(180, deg));
}

export function normalizeAngleDeg(deg: number): number {
  let a = (((deg + 180) % 360) + 360) % 360 - 180;
  if (a === -180) a = 180;
  return Math.abs(a) < 1e-6 ? 0 : a;
}

/**
 * Shortest-path angular wrapping formula:
 * Δθ = ((θ_target - θ_current + 540°) mod 360°) - 180°
 */
export function shortestAngleDelta(currentDeg: number, targetDeg: number): number {
  return ((((targetDeg - currentDeg + 540) % 360) + 360) % 360) - 180;
}

export function applyJointAngleConstraint(deg: number, continuousSpin: boolean): number {
  const snapped = snapAnglePrecision(deg);
  return continuousSpin ? snapped : clampAngle180(snapped);
}

export function clampModeERatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 1.0;
  return Math.max(MODE_E_MIN, Math.min(MODE_E_MAX, Math.round(ratio * 100) / 100));
}

export function getPhysicsMultiplier(runtime: JointRuntimeState): number {
  switch (runtime.physicsMode) {
    case 'twins':
      return 1.0;
    case 'elastic_rubber':
      return 1.5;
    case 'damp':
      return 0.5;
    case 'rigid':
      return 0.0;
    case 'mode_e':
      return clampModeERatio(runtime.modeERatio);
  }
}

export function formatSignedDeg(deg: number): string {
  const abs = Math.abs(deg).toFixed(2);
  const sign = deg < -0.005 ? '-' : '+';
  return `${sign}${abs}°`;
}

export function createPosePreset(
  preset: PosePresetId,
  existingState?: ArmatureState
): ArmatureState {
  const joints = {} as Record<JointId, JointRuntimeState>;
  for (const spec of JOINT_SPECS) {
    const prev = existingState?.joints[spec.id];
    joints[spec.id] = {
      localAngle: spec.defaultLocalAngle,
      mode: prev?.mode ?? spec.defaultMode,
      physicsMode: prev?.physicsMode ?? 'twins',
      modeERatio: prev?.modeERatio ?? 1.0,
      scaleLength: prev?.scaleLength ?? 1.0,
      scaleWidth: prev?.scaleWidth ?? 1.0,
    };
  }

  const base: ArmatureState = {
    rootX: existingState?.rootX ?? PAPER_WIDTH / 2,
    rootY: existingState?.rootY ?? PAPER_HEIGHT / 2,
    rootRotation: 0,
    continuousSpin: existingState?.continuousSpin ?? true,
    internalKeystone: existingState?.internalKeystone ?? 'navel',
    environmentalAnchor: existingState?.environmentalAnchor ?? 'navel',
    isAnchorPinned: existingState?.isAnchorPinned ?? true,
    joints,
  };

  if (preset === 'tpose') {
    // Matches uploaded body_pose_full_b3b6bf24.svg rest pose (horizontal T-pose arms + wide A-stance legs + outward feet)
  } else if (preset === 'contrapposto') {
    base.rootRotation = 4;
    base.joints.lumbar.localAngle = -5;
    base.joints.thorax.localAngle = -3;
    base.joints.neck.localAngle = 4;
    base.joints.head.localAngle = 4;
    base.joints.swivelR.localAngle = 6;
    base.joints.swivelL.localAngle = -2;
    base.joints.braceR.localAngle = 15;
    base.joints.braceL.localAngle = -8;
    base.joints.humerusR.localAngle = -68;
    base.joints.forearmR.localAngle = 36;
    base.joints.handR.localAngle = 10;
    base.joints.humerusL.localAngle = 68;
    base.joints.forearmL.localAngle = -36;
    base.joints.handL.localAngle = -10;
    base.joints.hipR.localAngle = 4;
    base.joints.femurR.localAngle = -16;
    base.joints.shinR.localAngle = -6;
    base.joints.footR.localAngle = 6;
    base.joints.hipL.localAngle = -4;
    base.joints.femurL.localAngle = 12;
    base.joints.shinL.localAngle = 14;
    base.joints.footL.localAngle = -6;
  } else if (preset === 'striding') {
    base.rootRotation = -4;
    base.joints.lumbar.localAngle = 5;
    base.joints.thorax.localAngle = 4;
    base.joints.neck.localAngle = -4;
    base.joints.head.localAngle = -2;
    base.joints.swivelR.localAngle = 4;
    base.joints.swivelL.localAngle = -6;
    base.joints.braceR.localAngle = 10;
    base.joints.braceL.localAngle = -14;
    base.joints.humerusR.localAngle = -56;
    base.joints.forearmR.localAngle = -32;
    base.joints.handR.localAngle = -10;
    base.joints.humerusL.localAngle = 82;
    base.joints.forearmL.localAngle = 30;
    base.joints.handL.localAngle = 10;
    base.joints.femurR.localAngle = 4;
    base.joints.shinR.localAngle = -24;
    base.joints.footR.localAngle = 16;
    base.joints.femurL.localAngle = -38;
    base.joints.shinL.localAngle = 22;
    base.joints.footL.localAngle = -12;
  } else {
    // Classical Vitruvian X/Y reach inside the circle & square
    base.joints.swivelR.localAngle = 5;
    base.joints.swivelL.localAngle = -5;
    base.joints.braceR.localAngle = 12;
    base.joints.braceL.localAngle = -12;
    base.joints.humerusR.localAngle = 20;
    base.joints.forearmR.localAngle = 3;
    base.joints.handR.localAngle = 0;
    base.joints.humerusL.localAngle = -20;
    base.joints.forearmL.localAngle = -3;
    base.joints.handL.localAngle = 0;
    base.joints.femurR.localAngle = -4;
    base.joints.shinR.localAngle = 2;
    base.joints.footR.localAngle = 0;
    base.joints.femurL.localAngle = 4;
    base.joints.shinL.localAngle = -2;
    base.joints.footL.localAngle = 0;
  }

  return base;
}

function evaluateRawArmature(state: ArmatureState): Record<JointId, ComputedJoint> {
  const computed = {} as Record<JointId, ComputedJoint>;

  for (const spec of JOINT_SPECS) {
    const runtime = state.joints[spec.id] ?? {
      localAngle: spec.defaultLocalAngle,
      mode: spec.defaultMode,
      physicsMode: 'twins' as PhysicsModeId,
      modeERatio: 1.0,
      scaleLength: 1.0,
      scaleWidth: 1.0,
    };

    const scaleLen = Math.max(BONE_SCALE_MIN, Math.min(BONE_SCALE_MAX, runtime.scaleLength));
    const scaleWid = Math.max(BONE_SCALE_MIN, Math.min(BONE_SCALE_MAX, runtime.scaleWidth));
    const effLocalAngle = spec.locked ? 0 : runtime.localAngle;

    if (spec.parentId === null) {
      const restWorldDeg = spec.restTip ? vecAngleDeg(spec.restPivot, spec.restTip) : -90;
      const pelvisMatrix = composeBoneMatrix(
        state.rootX,
        state.rootY,
        state.rootRotation,
        PUPPYT_TO_EVOLVED_SCALE * scaleWid,
        PUPPYT_TO_EVOLVED_SCALE * scaleLen,
        0,
        spec.restPivot[0],
        spec.restPivot[1]
      );
      const endPt = spec.restTip
        ? applyAffine(pelvisMatrix, spec.restTip[0], spec.restTip[1])
        : { x: state.rootX, y: state.rootY };

      computed[spec.id] = {
        id: spec.id,
        spec,
        x: state.rootX,
        y: state.rootY,
        endX: endPt.x,
        endY: endPt.y,
        parentX: null,
        parentY: null,
        localAngle: state.rootRotation,
        worldAngle: restWorldDeg + state.rootRotation,
        restWorldDeg,
        cumulativeDeltaDeg: state.rootRotation,
        effectiveLengthPx: Math.hypot(endPt.x - state.rootX, endPt.y - state.rootY),
        effectiveWidthScale: scaleWid,
        mode: runtime.mode,
        boneMatrix: pelvisMatrix,
      };
      continue;
    }

    const parent = computed[spec.parentId];
    const originPt = applyAffine(parent.boneMatrix, spec.restPivot[0], spec.restPivot[1]);
    const restWorldDeg = spec.restTip
      ? vecAngleDeg(spec.restPivot, spec.restTip)
      : parent.restWorldDeg;

    if (spec.aimTarget) {
      const targetJoint = computed[spec.aimTarget.to];
      const aimDx = targetJoint.x - originPt.x;
      const aimDy = targetJoint.y - originPt.y;
      const dist = Math.hypot(aimDx, aimDy);
      const restDist =
        Math.hypot(
          targetJoint.spec.restPivot[0] - spec.restPivot[0],
          targetJoint.spec.restPivot[1] - spec.restPivot[1]
        ) * PUPPYT_TO_EVOLVED_SCALE;

      // Keep collarbone/aim bones rigidly locked onto their target socket so the triangle never breaks
      const worldAimDeg =
        dist > 1e-3
          ? Math.atan2(aimDy, aimDx) * RAD_TO_DEG
          : restWorldDeg + parent.cumulativeDeltaDeg;
      const cumulativeDeltaDeg = normalizeAngleDeg(worldAimDeg - restWorldDeg);
      const stretchRatio =
        restDist > 1e-3 ? dist / (restDist * Math.max(0.5, scaleWid)) : 1;
      const isStrained =
        stretchRatio < spec.aimTarget.minRatio || stretchRatio > spec.aimTarget.maxRatio;

      const dynamicLenScale =
        restDist > 1e-3 ? Math.max(0.4, Math.min(2.0, dist / restDist)) : scaleLen;

      const matrix = composeBoneMatrix(
        originPt.x,
        originPt.y,
        worldAimDeg,
        PUPPYT_TO_EVOLVED_SCALE * dynamicLenScale,
        PUPPYT_TO_EVOLVED_SCALE * scaleWid,
        restWorldDeg,
        spec.restPivot[0],
        spec.restPivot[1]
      );

      computed[spec.id] = {
        id: spec.id,
        spec,
        x: originPt.x,
        y: originPt.y,
        endX: targetJoint.x,
        endY: targetJoint.y,
        parentX: parent.x,
        parentY: parent.y,
        localAngle: 0,
        worldAngle: worldAimDeg,
        restWorldDeg,
        cumulativeDeltaDeg,
        effectiveLengthPx: dist,
        effectiveWidthScale: scaleWid,
        mode: runtime.mode,
        boneMatrix: matrix,
        isStrained,
        tensionRatio: stretchRatio,
      };
      continue;
    }

    if (spec.id === 'braceR' || spec.id === 'braceL') {
      const isRight = spec.id === 'braceR';
      const thorax = computed.thorax;
      const lumbar = computed.lumbar;
      const acromion = computed[isRight ? 'acromionR' : 'acromionL'];
      const halfClavLen =
        Math.hypot(
          (spec.restTip?.[0] ?? spec.restPivot[0]) - spec.restPivot[0],
          (spec.restTip?.[1] ?? spec.restPivot[1]) - spec.restPivot[1]
        ) * PUPPYT_TO_EVOLVED_SCALE;

      const dx = acromion.x - thorax.x;
      const dy = acromion.y - thorax.y;
      const chordDist = Math.hypot(dx, dy);
      const safeDist = Math.max(1e-4, Math.min(halfClavLen * 2, chordDist));
      const ux = chordDist > 1e-4 ? dx / chordDist : isRight ? -1 : 1;
      const uy = chordDist > 1e-4 ? dy / chordDist : 0;

      // Choose perpendicular normal pointing toward the head/neck (+spine axis) for UP fold
      const spineDx = thorax.x - lumbar.x;
      const spineDy = thorax.y - lumbar.y;
      const n1x = -uy;
      const n1y = ux;
      const dotUp = n1x * spineDx + n1y * spineDy;
      const upNx = dotUp >= 0 ? n1x : -n1x;
      const upNy = dotUp >= 0 ? n1y : -n1y;

      const foldInput = Math.max(-65, Math.min(65, effLocalAngle));
      // Negative braceR (screen left CCW) folds DOWN, >=0 folds UP; positive braceL (screen right CW) folds DOWN, <=0 folds UP
      const foldSign = isRight ? (foldInput < -1e-4 ? -1 : 1) : foldInput > 1e-4 ? -1 : 1;
      const h = Math.sqrt(Math.max(0, halfClavLen * halfClavLen - (safeDist * 0.5) ** 2));

      const midX = thorax.x + ux * (safeDist * 0.5) + foldSign * h * upNx;
      const midY = thorax.y + uy * (safeDist * 0.5) + foldSign * h * upNy;

      const worldAngle = Math.atan2(midY - thorax.y, midX - thorax.x) * RAD_TO_DEG;
      const cumulativeDeltaDeg = normalizeAngleDeg(worldAngle - restWorldDeg);
      const matrix = composeBoneMatrix(
        thorax.x,
        thorax.y,
        worldAngle,
        PUPPYT_TO_EVOLVED_SCALE,
        PUPPYT_TO_EVOLVED_SCALE * scaleWid,
        restWorldDeg,
        spec.restPivot[0],
        spec.restPivot[1]
      );

      computed[spec.id] = {
        id: spec.id,
        spec,
        x: thorax.x,
        y: thorax.y,
        endX: midX,
        endY: midY,
        parentX: parent.x,
        parentY: parent.y,
        localAngle: foldInput,
        worldAngle,
        restWorldDeg,
        cumulativeDeltaDeg,
        effectiveLengthPx: halfClavLen,
        effectiveWidthScale: scaleWid,
        mode: runtime.mode,
        boneMatrix: matrix,
      };
      continue;
    }

    if (spec.id === 'clavOuterR' || spec.id === 'clavOuterL') {
      const isRight = spec.id === 'clavOuterR';
      const acromion = computed[isRight ? 'acromionR' : 'acromionL'];
      const halfClavLen =
        Math.hypot(
          (spec.restTip?.[0] ?? spec.restPivot[0]) - spec.restPivot[0],
          (spec.restTip?.[1] ?? spec.restPivot[1]) - spec.restPivot[1]
        ) * PUPPYT_TO_EVOLVED_SCALE;

      const worldAngle =
        Math.atan2(acromion.y - originPt.y, acromion.x - originPt.x) * RAD_TO_DEG;
      const cumulativeDeltaDeg = normalizeAngleDeg(worldAngle - restWorldDeg);
      const hingeAngle = normalizeAngleDeg(cumulativeDeltaDeg - parent.cumulativeDeltaDeg);
      const matrix = composeBoneMatrix(
        originPt.x,
        originPt.y,
        worldAngle,
        PUPPYT_TO_EVOLVED_SCALE,
        PUPPYT_TO_EVOLVED_SCALE * scaleWid,
        restWorldDeg,
        spec.restPivot[0],
        spec.restPivot[1]
      );

      computed[spec.id] = {
        id: spec.id,
        spec,
        x: originPt.x,
        y: originPt.y,
        endX: acromion.x,
        endY: acromion.y,
        parentX: parent.x,
        parentY: parent.y,
        localAngle: hingeAngle,
        worldAngle,
        restWorldDeg,
        cumulativeDeltaDeg,
        effectiveLengthPx: halfClavLen,
        effectiveWidthScale: scaleWid,
        mode: runtime.mode,
        boneMatrix: matrix,
      };
      continue;
    }

    let bondedLocalAngle = effLocalAngle;
    if (spec.id === 'swivelR' || spec.id === 'swivelL') {
      const isRight = spec.id === 'swivelR';
      const thorax = computed.thorax;
      const thoraxTilt = thorax ? thorax.localAngle : (state.joints.thorax?.localAngle ?? 0);
      const [minLim, maxLim] = spec.limits ?? [-16, 16];
      bondedLocalAngle = Math.max(minLim, Math.min(maxLim, effLocalAngle + thoraxTilt * 0.35));

      // Enforce non-stretching rotational two-piece collarbone limit via circle-circle intersection
      const braceSpec = JOINT_SPEC_MAP[isRight ? 'braceR' : 'braceL'];
      const braceRuntime = state.joints[isRight ? 'braceR' : 'braceL'];
      const halfClavLen =
        Math.hypot(
          (braceSpec.restTip?.[0] ?? braceSpec.restPivot[0]) - braceSpec.restPivot[0],
          (braceSpec.restTip?.[1] ?? braceSpec.restPivot[1]) - braceSpec.restPivot[1]
        ) * PUPPYT_TO_EVOLVED_SCALE;
      const maxReach = halfClavLen * 2;
      const foldInputDeg = Math.max(-65, Math.min(65, braceRuntime?.localAngle ?? 0));
      const allowedChord = Math.max(
        halfClavLen * 0.45,
        maxReach * Math.cos(Math.abs(foldInputDeg) * DEG_TO_RAD)
      );

      const swivelRadius =
        Math.hypot(
          (spec.restTip?.[0] ?? spec.restPivot[0]) - spec.restPivot[0],
          (spec.restTip?.[1] ?? spec.restPivot[1]) - spec.restPivot[1]
        ) *
        PUPPYT_TO_EVOLVED_SCALE *
        scaleLen;
      const desiredWorldDeg = restWorldDeg + parent.cumulativeDeltaDeg + bondedLocalAngle;
      const desiredWorldRad = desiredWorldDeg * DEG_TO_RAD;
      const desiredAcroX = originPt.x + swivelRadius * Math.cos(desiredWorldRad);
      const desiredAcroY = originPt.y + swivelRadius * Math.sin(desiredWorldRad);
      const desiredChordDist = Math.hypot(desiredAcroX - thorax.x, desiredAcroY - thorax.y);

      if (desiredChordDist > allowedChord + 1e-4) {
        const sx = thorax.x - originPt.x;
        const sy = thorax.y - originPt.y;
        const dSpine = Math.hypot(sx, sy);
        if (dSpine > 1e-4) {
          const ux = sx / dSpine;
          const uy = sy / dSpine;
          const latX = isRight ? uy : -uy;
          const latY = isRight ? -ux : ux;
          const a = Math.max(
            -swivelRadius,
            Math.min(
              swivelRadius,
              (swivelRadius * swivelRadius - allowedChord * allowedChord + dSpine * dSpine) /
                (2 * dSpine)
            )
          );
          const h = Math.sqrt(Math.max(0, swivelRadius * swivelRadius - a * a));
          const clampedAcroX = originPt.x + a * ux + h * latX;
          const clampedAcroY = originPt.y + a * uy + h * latY;
          const clampedWorldDeg =
            Math.atan2(clampedAcroY - originPt.y, clampedAcroX - originPt.x) * RAD_TO_DEG;
          bondedLocalAngle = normalizeAngleDeg(
            clampedWorldDeg - restWorldDeg - parent.cumulativeDeltaDeg
          );
        }
      }
    } else if (spec.id === 'hipR' || spec.id === 'hipL') {
      const [minLim, maxLim] = spec.limits ?? [-16, 16];
      bondedLocalAngle = Math.max(minLim, Math.min(maxLim, effLocalAngle));
    }

    const cumulativeDeltaDeg =
      spec.id === 'lumbar'
        ? bondedLocalAngle
        : parent.cumulativeDeltaDeg + bondedLocalAngle;
    const worldAngle = restWorldDeg + cumulativeDeltaDeg;

    const matrix = composeBoneMatrix(
      originPt.x,
      originPt.y,
      worldAngle,
      PUPPYT_TO_EVOLVED_SCALE * scaleLen,
      PUPPYT_TO_EVOLVED_SCALE * scaleWid,
      restWorldDeg,
      spec.restPivot[0],
      spec.restPivot[1]
    );

    const endPt = spec.restTip
      ? applyAffine(matrix, spec.restTip[0], spec.restTip[1])
      : { x: originPt.x, y: originPt.y };

    computed[spec.id] = {
      id: spec.id,
      spec,
      x: originPt.x,
      y: originPt.y,
      endX: endPt.x,
      endY: endPt.y,
      parentX: parent.x,
      parentY: parent.y,
      localAngle: bondedLocalAngle,
      worldAngle,
      restWorldDeg,
      cumulativeDeltaDeg,
      effectiveLengthPx: Math.hypot(endPt.x - originPt.x, endPt.y - originPt.y),
      effectiveWidthScale: scaleWid,
      mode: runtime.mode,
      boneMatrix: matrix,
    };
  }

  return computed;
}

export function getEnvironmentalAnchorPoint(
  computed: Record<JointId, ComputedJoint>,
  anchor: EnvironmentalAnchorId
): Point2D {
  switch (anchor) {
    case 'bottom_of_spine':
      return { x: computed.pelvis.x, y: computed.pelvis.y };
    case 'feet':
      return {
        x: (computed.footR.endX + computed.footL.endX) / 2,
        y: Math.max(computed.footR.endY, computed.footL.endY),
      };
    case 'navel':
      return { x: computed.lumbar.x, y: computed.lumbar.y };
    case 'clavicle':
      return { x: computed.thorax.x, y: computed.thorax.y };
    case 'neck':
      return { x: computed.neck.x, y: computed.neck.y };
    case 'crown':
      return { x: computed.head.endX, y: computed.head.endY };
  }
}

export function computeArmature(
  state: ArmatureState,
  canvasOrigin: Point2D = { x: PAPER_WIDTH / 2, y: PAPER_HEIGHT / 2 }
): Record<JointId, ComputedJoint> {
  const raw = evaluateRawArmature(state);
  if (!state.isAnchorPinned) {
    return raw;
  }

  const anchorPt = getEnvironmentalAnchorPoint(raw, state.environmentalAnchor);
  const shiftX = canvasOrigin.x - anchorPt.x;
  const shiftY = canvasOrigin.y - anchorPt.y;

  const pinned = {} as Record<JointId, ComputedJoint>;
  for (const spec of JOINT_SPECS) {
    const j = raw[spec.id];
    const m = j.boneMatrix;
    pinned[spec.id] = {
      ...j,
      x: j.x + shiftX,
      y: j.y + shiftY,
      endX: j.endX + shiftX,
      endY: j.endY + shiftY,
      parentX: j.parentX !== null ? j.parentX + shiftX : null,
      parentY: j.parentY !== null ? j.parentY + shiftY : null,
      boneMatrix: [m[0], m[1], m[2], m[3], m[4] + shiftX, m[5] + shiftY],
    };
  }
  return pinned;
}

export function solveTwoBoneIK(
  state: ArmatureState,
  endId: JointId,
  targetX: number,
  targetY: number,
  canvasOrigin: Point2D = { x: PAPER_WIDTH / 2, y: PAPER_HEIGHT / 2 }
): ArmatureState {
  const endSpec = JOINT_SPEC_MAP[endId];
  if (!endSpec.ikChain || endSpec.ikChain === 'spine') return state;
  const [rootId, midId] = endSpec.ikChain;

  const computed = computeArmature(state, canvasOrigin);
  const rootJoint = computed[rootId];
  const midJoint = computed[midId];
  const endJoint = computed[endId];

  const L1 = Math.hypot(midJoint.x - rootJoint.x, midJoint.y - rootJoint.y);
  const L2 = Math.hypot(endJoint.x - midJoint.x, endJoint.y - midJoint.y);

  const dx = targetX - rootJoint.x;
  const dy = targetY - rootJoint.y;
  const rawDist = Math.hypot(dx, dy);
  const minDist = Math.abs(L1 - L2) + 2;
  const maxDist = Math.max(minDist + 1, L1 + L2 - 0.5);
  const d = Math.max(minDist, Math.min(maxDist, rawDist));

  const baseAngle = Math.atan2(dy, dx);
  const cosAlpha = Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)));
  const alpha = Math.acos(cosAlpha);
  const cosBeta = Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2)));
  const beta = Math.acos(cosBeta);

  const bendDir = endSpec.bendDirection ?? 1;
  const desiredWorld1 = ((baseAngle + bendDir * alpha) * 180) / Math.PI;
  const desiredWorld2 =
    ((baseAngle + bendDir * alpha - bendDir * (Math.PI - beta)) * 180) / Math.PI;

  const multRoot = getPhysicsMultiplier(state.joints[rootId]);
  const multMid = getPhysicsMultiplier(state.joints[midId]);

  const rawDeltaRoot = shortestAngleDelta(rootJoint.worldAngle, desiredWorld1);
  const nextRootLocal = applyJointAngleConstraint(
    state.joints[rootId].localAngle + rawDeltaRoot * multRoot,
    state.continuousSpin
  );
  const appliedDeltaRoot = nextRootLocal - state.joints[rootId].localAngle;

  const midWorldAfterRoot = midJoint.worldAngle + appliedDeltaRoot;
  const rawDeltaMid = shortestAngleDelta(midWorldAfterRoot, desiredWorld2);
  const nextMidLocal = applyJointAngleConstraint(
    state.joints[midId].localAngle + rawDeltaMid * multMid,
    state.continuousSpin
  );

  return {
    ...state,
    joints: {
      ...state.joints,
      [rootId]: { ...state.joints[rootId], localAngle: nextRootLocal },
      [midId]: { ...state.joints[midId], localAngle: nextMidLocal },
    },
  };
}

export function solveSpineCCDIK(
  state: ArmatureState,
  targetX: number,
  targetY: number,
  canvasOrigin: Point2D = { x: PAPER_WIDTH / 2, y: PAPER_HEIGHT / 2 }
): ArmatureState {
  const chain: JointId[] = ['lumbar', 'thorax', 'neck', 'head'];
  let current: ArmatureState = {
    ...state,
    joints: { ...state.joints },
  };

  for (let iter = 0; iter < 8; iter++) {
    for (let i = chain.length - 1; i >= 0; i--) {
      const jointId = chain[i];
      const runtime = current.joints[jointId];
      if (runtime.mode === 'PIN' || runtime.physicsMode === 'rigid') continue;

      const computed = computeArmature(current, canvasOrigin);
      const pivot = computed[jointId];
      const effectorX = computed.head.endX;
      const effectorY = computed.head.endY;

      const aEff = Math.atan2(effectorY - pivot.y, effectorX - pivot.x);
      const aTgt = Math.atan2(targetY - pivot.y, targetX - pivot.x);
      let deltaDeg = ((aTgt - aEff) * 180) / Math.PI;
      deltaDeg = normalizeAngleDeg(deltaDeg);
      deltaDeg = Math.max(-16, Math.min(16, deltaDeg * 0.6)) * getPhysicsMultiplier(runtime);

      current = {
        ...current,
        joints: {
          ...current.joints,
          [jointId]: {
            ...runtime,
            localAngle: applyJointAngleConstraint(
              runtime.localAngle + deltaDeg,
              current.continuousSpin
            ),
          },
        },
      };
    }
  }

  return current;
}

export function solveBoneAimRotation(
  state: ArmatureState,
  pivotJointId: JointId,
  targetX: number,
  targetY: number,
  canvasOrigin: Point2D = { x: PAPER_WIDTH / 2, y: PAPER_HEIGHT / 2 }
): ArmatureState {
  const computed = computeArmature(state, canvasOrigin);
  const pivot = computed[pivotJointId];
  const dx = targetX - pivot.x;
  const dy = targetY - pivot.y;
  if (Math.hypot(dx, dy) < 1e-3) return state;

  const targetWorldDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

  if (pivotJointId === 'pelvis') {
    const mult = getPhysicsMultiplier(state.joints.pelvis);
    if (mult === 0) return state;
    const rawDelta = shortestAngleDelta(pivot.worldAngle, targetWorldDeg);
    const nextRootRot = applyJointAngleConstraint(
      state.rootRotation + rawDelta * mult,
      state.continuousSpin
    );
    return { ...state, rootRotation: nextRootRot };
  }

  const spec = JOINT_SPEC_MAP[pivotJointId];
  if (spec.locked) return state;
  const runtime = state.joints[pivotJointId];
  const mult = getPhysicsMultiplier(runtime);
  if (mult === 0) return state;

  const rawDelta = shortestAngleDelta(pivot.worldAngle, targetWorldDeg);
  const nextLocal = applyJointAngleConstraint(
    runtime.localAngle + rawDelta * mult,
    state.continuousSpin
  );

  return {
    ...state,
    joints: {
      ...state.joints,
      [pivotJointId]: {
        ...runtime,
        localAngle: nextLocal,
      },
    },
  };
}

export function mirrorPose(state: ArmatureState): ArmatureState {
  const nextJoints = { ...state.joints };
  const bilateralPairs: [JointId, JointId][] = [
    ['ribR', 'ribL'],
    ['swivelR', 'swivelL'],
    ['swivelTipR', 'swivelTipL'],
    ['acromionR', 'acromionL'],
    ['braceR', 'braceL'],
    ['clavOuterR', 'clavOuterL'],
    ['humerusR', 'humerusL'],
    ['forearmR', 'forearmL'],
    ['handR', 'handL'],
    ['thumbR', 'thumbL'],
    ['thumbTipR', 'thumbTipL'],
    ['fingerR', 'fingerL'],
    ['fingerTipR', 'fingerTipL'],
    ['hipR', 'hipL'],
    ['femurR', 'femurL'],
    ['shinR', 'shinL'],
    ['footR', 'footL'],
    ['toeR', 'toeL'],
  ];

  for (const [rId, lId] of bilateralPairs) {
    const r = state.joints[rId];
    const l = state.joints[lId];
    nextJoints[rId] = {
      ...r,
      localAngle: applyJointAngleConstraint(-l.localAngle, state.continuousSpin),
    };
    nextJoints[lId] = {
      ...l,
      localAngle: applyJointAngleConstraint(-r.localAngle, state.continuousSpin),
    };
  }

  const spineIds: JointId[] = ['lumbar', 'thorax', 'neck', 'head', 'lip', 'chinTip'];
  for (const id of spineIds) {
    const rt = state.joints[id];
    nextJoints[id] = {
      ...rt,
      localAngle: applyJointAngleConstraint(-rt.localAngle, state.continuousSpin),
    };
  }

  return {
    ...state,
    rootRotation: applyJointAngleConstraint(-state.rootRotation, state.continuousSpin),
    joints: nextJoints,
  };
}

export function setJointMode(
  state: ArmatureState,
  jointId: JointId,
  mode: JointMode
): ArmatureState {
  return {
    ...state,
    joints: {
      ...state.joints,
      [jointId]: { ...state.joints[jointId], mode },
    },
  };
}

// ============================================================================
// Pure Procedural Cave-Art Geometry Builder (Line-to-Line Angular Shapes)
// ============================================================================

function ptDist(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lerpPt(a: Point2D, b: Point2D, t: number): Point2D {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function unitAxis(a: Point2D, b: Point2D): { ux: number; uy: number; len: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) return { ux: 0, uy: -1, len: 0 };
  return { ux: dx / len, uy: dy / len, len };
}

function offsetPt(p: Point2D, nx: number, ny: number, dist: number): Point2D {
  return { x: p.x + nx * dist, y: p.y + ny * dist };
}

function makeTrapezoid(
  a: Point2D,
  b: Point2D,
  halfWidthA: number,
  halfWidthB: number
): Point2D[] {
  const { ux, uy } = unitAxis(a, b);
  const nx = -uy;
  const ny = ux;
  return [
    offsetPt(a, nx, ny, -halfWidthA),
    offsetPt(a, nx, ny, halfWidthA),
    offsetPt(b, nx, ny, halfWidthB),
    offsetPt(b, nx, ny, -halfWidthB),
  ];
}

function makeDiamondSquare(center: Point2D, nx: number, ny: number, halfSpan: number): Point2D[] {
  const tx = -ny;
  const ty = nx;
  return [
    offsetPt(offsetPt(center, nx, ny, -halfSpan), tx, ty, -halfSpan),
    offsetPt(offsetPt(center, nx, ny, halfSpan), tx, ty, -halfSpan),
    offsetPt(offsetPt(center, nx, ny, halfSpan), tx, ty, halfSpan),
    offsetPt(offsetPt(center, nx, ny, -halfSpan), tx, ty, halfSpan),
  ];
}

function makeTriangle(baseCenter: Point2D, apex: Point2D, baseHalfWidth: number): Point2D[] {
  const { ux, uy } = unitAxis(baseCenter, apex);
  const nx = -uy;
  const ny = ux;
  return [
    offsetPt(baseCenter, nx, ny, -baseHalfWidth),
    offsetPt(baseCenter, nx, ny, baseHalfWidth),
    apex,
  ];
}

/**
 * Derives procedural mannequin bounding geometry & metrics from the 41-joint rig
 * (no Prometheus wings).
 */
export function buildCaveArtGeometry(
  computed: Record<JointId, ComputedJoint>
): CaveArtRigGeometry {
  const pelvis = computed.pelvis;
  const lumbar = computed.lumbar;
  const thorax = computed.thorax;
  const ribR = computed.ribR;
  const ribL = computed.ribL;
  const neck = computed.neck;
  const head = computed.head;
  const lip = computed.lip;
  const chin = computed.chinTip;

  const swivelR = computed.swivelR;
  const swivelTipR = computed.swivelTipR;
  const acromionR = computed.acromionR;
  const braceR = computed.braceR;
  const clavOuterR = computed.clavOuterR;
  const humerusR = computed.humerusR;
  const forearmR = computed.forearmR;
  const handR = computed.handR;
  const thumbR = computed.thumbR;
  const thumbTipR = computed.thumbTipR;
  const fingerR = computed.fingerR;
  const fingerTipR = computed.fingerTipR;

  const swivelL = computed.swivelL;
  const swivelTipL = computed.swivelTipL;
  const acromionL = computed.acromionL;
  const braceL = computed.braceL;
  const clavOuterL = computed.clavOuterL;
  const humerusL = computed.humerusL;
  const forearmL = computed.forearmL;
  const handL = computed.handL;
  const thumbL = computed.thumbL;
  const thumbTipL = computed.thumbTipL;
  const fingerL = computed.fingerL;
  const fingerTipL = computed.fingerTipL;

  const hipR = computed.hipR;
  const femurR = computed.femurR;
  const shinR = computed.shinR;
  const footR = computed.footR;
  const toeR = computed.toeR;

  const hipL = computed.hipL;
  const femurL = computed.femurL;
  const shinL = computed.shinL;
  const footL = computed.footL;
  const toeL = computed.toeL;

  const templeR = applyAffine(
    head.boneMatrix,
    PUPPYT_LANDMARKS.skullTempleR[0],
    PUPPYT_LANDMARKS.skullTempleR[1]
  );
  const templeL = applyAffine(
    head.boneMatrix,
    PUPPYT_LANDMARKS.skullTempleL[0],
    PUPPYT_LANDMARKS.skullTempleL[1]
  );
  const crestR = applyAffine(
    hipR.boneMatrix,
    PUPPYT_LANDMARKS.hipRTip[0],
    PUPPYT_LANDMARKS.hipRTip[1]
  );
  const crestL = applyAffine(
    hipL.boneMatrix,
    PUPPYT_LANDMARKS.hipLTip[0],
    PUPPYT_LANDMARKS.hipLTip[1]
  );

  // Model-derived hip base width from iliac crest landmarks (120.96 px at rest)
  const hipWidthPx = Math.max(24, ptDist(crestR, crestL));
  // Strict 1.25x torso-to-hip ratio built directly upon the model's hip baseline
  const torsoWidthPx = hipWidthPx * 1.25;

  // Upper spine frame: thorax (upper/lower spine meeting point) -> neck
  const thoraxPt: Point2D = { x: thorax.x, y: thorax.y };
  const neckPt: Point2D = { x: neck.x, y: neck.y };
  const { ux: uThoraxX, uy: uThoraxY } = unitAxis(thoraxPt, neckPt);
  // Lateral Left (+X when upright) and Right (-X when upright) perpendiculars
  const latLX = -uThoraxY;
  const latLY = uThoraxX;
  const latRX = -latLX;
  const latRY = -latLY;

  const upperTopCenter = lerpPt(thoraxPt, neckPt, 0.88);
  const upperMidCenter = lerpPt(thoraxPt, neckPt, 0.44);

  const ribChordPx = ptDist({ x: ribR.endX, y: ribR.endY }, { x: ribL.endX, y: ribL.endY });
  const midTorsoWidthPx = Math.max(
    hipWidthPx * 0.68,
    Math.min(torsoWidthPx * 0.86, ribChordPx)
  );

  const torsoTopR = offsetPt(upperTopCenter, latRX, latRY, torsoWidthPx / 2);
  const torsoTopL = offsetPt(upperTopCenter, latLX, latLY, torsoWidthPx / 2);
  const torsoMidR = offsetPt(upperMidCenter, latRX, latRY, midTorsoWidthPx / 2);
  const torsoMidL = offsetPt(upperMidCenter, latLX, latLY, midTorsoWidthPx / 2);

  // Lower spine thinner triangle from upper/lower spine meeting point (thorax) down to brought-in pelvic top
  const pelvisPt: Point2D = { x: pelvis.x, y: pelvis.y };
  const pelvisTopCenter = lerpPt(thoraxPt, pelvisPt, 0.86);
  const femurSpanPx = ptDist({ x: femurR.x, y: femurR.y }, { x: femurL.x, y: femurL.y });
  const lowerSpineBaseWidthPx = Math.min(femurSpanPx * 0.64, hipWidthPx * 0.4);
  const { ux: uLumX, uy: uLumY } = unitAxis(thoraxPt, pelvisPt);
  const lumLatLX = uLumY;
  const lumLatLY = -uLumX;
  const lumLatRX = -lumLatLX;
  const lumLatRY = -lumLatLY;
  const lowerSpineBaseR = offsetPt(pelvisTopCenter, lumLatRX, lumLatRY, lowerSpineBaseWidthPx / 2);
  const lowerSpineBaseL = offsetPt(pelvisTopCenter, lumLatLX, lumLatLY, lowerSpineBaseWidthPx / 2);

  // Cranium trapezoid above temple chord -> crown
  const crownPt: Point2D = { x: head.endX, y: head.endY };
  const templeMid = lerpPt(templeR, templeL, 0.5);
  const { ux: uHeadX, uy: uHeadY } = unitAxis(templeMid, crownPt);
  const headLatLX = -uHeadY;
  const headLatLY = uHeadX;
  const crownHalfW = ptDist(templeR, templeL) * 0.32;
  const crownTopR = offsetPt(crownPt, -headLatLX, -headLatLY, crownHalfW);
  const crownTopL = offsetPt(crownPt, headLatLX, headLatLY, crownHalfW);

  // Neck trapezoid
  const headPt: Point2D = { x: head.x, y: head.y };
  const neckTrapezoid = makeTrapezoid(
    neckPt,
    headPt,
    torsoWidthPx * 0.145,
    ptDist(templeR, templeL) * 0.24
  );

  const svgPelvisM = computeSvgBoneMatrix(pelvis.boneMatrix);
  const pelvisTopCenterR = applyAffine(svgPelvisM, 824, 953);
  const pelvisTopR = applyAffine(svgPelvisM, 735, 1032);
  const pelvisBotR = applyAffine(svgPelvisM, 735, 1085);
  const pelvisBotCenterR = applyAffine(svgPelvisM, 824, 1140);

  const pelvisTopCenterL = applyAffine(svgPelvisM, 824, 953);
  const pelvisTopL = applyAffine(svgPelvisM, 918, 1032);
  const pelvisBotL = applyAffine(svgPelvisM, 918, 1085);
  const pelvisBotCenterL = applyAffine(svgPelvisM, 824, 1140);

  // Bilateral Arm & Hand shapes
  const humerusRPoly = makeTrapezoid(humerusR, forearmR, 14, 9.5);
  const forearmRPoly = makeTrapezoid(forearmR, handR, 9.5, 6);
  const elbowRVerts = (() => {
    const { ux, uy } = unitAxis(humerusR, forearmR);
    return makeDiamondSquare(forearmR, -uy, ux, 7.5);
  })();
  const palmRPoly = makeTrapezoid(handR, fingerR, 7.5, 6.5);
  const thumbRPoly = makeTriangle(thumbR, thumbTipR, 4.2);
  const fingerRPoly = makeTriangle(fingerR, fingerTipR, 5.2);

  const humerusLPoly = makeTrapezoid(humerusL, forearmL, 14, 9.5);
  const forearmLPoly = makeTrapezoid(forearmL, handL, 9.5, 6);
  const elbowLVerts = (() => {
    const { ux, uy } = unitAxis(humerusL, forearmL);
    return makeDiamondSquare(forearmL, -uy, ux, 7.5);
  })();
  const palmLPoly = makeTrapezoid(handL, fingerL, 7.5, 6.5);
  const thumbLPoly = makeTriangle(thumbL, thumbTipL, 4.2);
  const fingerLPoly = makeTriangle(fingerL, fingerTipL, 5.2);

  // Clean Lower Body & Leg shapes
  const femurRPoly = makeTrapezoid(femurR, shinR, 16.5, 10.5);
  const kneeRVerts = (() => {
    const { ux, uy } = unitAxis(femurR, shinR);
    return makeDiamondSquare(shinR, -uy, ux, 9.5);
  })();
  const shinRPoly = makeTrapezoid(shinR, footR, 10.5, 6.2);
  const footMidR = lerpPt(footR, toeR, 0.34);
  const heelRPoly = makeTrapezoid(footR, footMidR, 8.2, 6.8);
  const footRPoly = makeTriangle(footMidR, toeR, 6.8);

  const femurLPoly = makeTrapezoid(femurL, shinL, 16.5, 10.5);
  const kneeLVerts = (() => {
    const { ux, uy } = unitAxis(femurL, shinL);
    return makeDiamondSquare(shinL, -uy, ux, 9.5);
  })();
  const shinLPoly = makeTrapezoid(shinL, footL, 10.5, 6.2);
  const footMidL = lerpPt(footL, toeL, 0.34);
  const heelLPoly = makeTrapezoid(footL, footMidL, 8.2, 6.8);
  const footLPoly = makeTriangle(footMidL, toeL, 6.8);

  const polygons: CaveArtPolygon[] = [
    // Middle Pelvic Trapezoid (no Prometheus wings)
    {
      id: 'pelvis-hip-r',
      jointId: 'hipR',
      shapeKind: 'trapezoid',
      points: [pelvisTopCenterR, pelvisTopR, pelvisBotR, pelvisBotCenterR],
      layer: 'pelvis',
      fillOpacity: 0.9,
    },
    {
      id: 'pelvis-hip-l',
      jointId: 'hipL',
      shapeKind: 'trapezoid',
      points: [pelvisTopCenterL, pelvisTopL, pelvisBotL, pelvisBotCenterL],
      layer: 'pelvis',
      fillOpacity: 0.9,
    },
    // Lower spine thinner triangle from upper/lower spine meeting point (thorax) down to pelvic top
    {
      id: 'lower-spine-triangle',
      jointId: 'lumbar',
      shapeKind: 'triangle',
      points: [thoraxPt, lowerSpineBaseL, lowerSpineBaseR],
      layer: 'torso',
      fillOpacity: 0.88,
    },
    // Upper torso: triangle converging to thorax + trapezoid on top (1.25x hip width)
    {
      id: 'upper-torso-triangle',
      jointId: 'thorax',
      shapeKind: 'triangle',
      points: [torsoMidR, torsoMidL, thoraxPt],
      layer: 'torso',
      fillOpacity: 0.9,
    },
    {
      id: 'upper-torso-trapezoid',
      jointId: 'thorax',
      shapeKind: 'trapezoid',
      points: [torsoTopR, torsoTopL, torsoMidL, torsoMidR],
      layer: 'torso',
      fillOpacity: 0.92,
    },
    // Neck & Head
    {
      id: 'neck-trapezoid',
      jointId: 'neck',
      shapeKind: 'trapezoid',
      points: neckTrapezoid,
      layer: 'head',
      fillOpacity: 0.86,
    },
    {
      id: 'jaw-triangle',
      jointId: 'lip',
      shapeKind: 'triangle',
      points: [templeR, templeL, { x: chin.x, y: chin.y }],
      layer: 'head',
      fillOpacity: 0.88,
    },
    {
      id: 'cranium-trapezoid',
      jointId: 'head',
      shapeKind: 'trapezoid',
      points: [crownTopR, crownTopL, templeL, templeR],
      layer: 'head',
      fillOpacity: 0.92,
    },
    // Clean Lower Body & Legs
    {
      id: 'femur-r',
      jointId: 'femurR',
      shapeKind: 'trapezoid',
      points: femurRPoly,
      layer: 'limb',
      fillOpacity: 0.88,
    },
    {
      id: 'shin-r',
      jointId: 'shinR',
      shapeKind: 'trapezoid',
      points: shinRPoly,
      layer: 'limb',
      fillOpacity: 0.88,
    },
    {
      id: 'knee-r',
      jointId: 'shinR',
      shapeKind: 'square',
      points: kneeRVerts,
      layer: 'cap',
      fillOpacity: 0.94,
    },
    {
      id: 'heel-r',
      jointId: 'footR',
      shapeKind: 'trapezoid',
      points: heelRPoly,
      layer: 'limb',
      fillOpacity: 0.9,
    },
    {
      id: 'foot-r',
      jointId: 'footR',
      shapeKind: 'triangle',
      points: footRPoly,
      layer: 'limb',
      fillOpacity: 0.88,
    },
    {
      id: 'femur-l',
      jointId: 'femurL',
      shapeKind: 'trapezoid',
      points: femurLPoly,
      layer: 'limb',
      fillOpacity: 0.88,
    },
    {
      id: 'shin-l',
      jointId: 'shinL',
      shapeKind: 'trapezoid',
      points: shinLPoly,
      layer: 'limb',
      fillOpacity: 0.88,
    },
    {
      id: 'knee-l',
      jointId: 'shinL',
      shapeKind: 'square',
      points: kneeLVerts,
      layer: 'cap',
      fillOpacity: 0.94,
    },
    {
      id: 'heel-l',
      jointId: 'footL',
      shapeKind: 'trapezoid',
      points: heelLPoly,
      layer: 'limb',
      fillOpacity: 0.9,
    },
    {
      id: 'foot-l',
      jointId: 'footL',
      shapeKind: 'triangle',
      points: footLPoly,
      layer: 'limb',
      fillOpacity: 0.88,
    },
    // Arms & Hands
    {
      id: 'humerus-r',
      jointId: 'humerusR',
      shapeKind: 'trapezoid',
      points: humerusRPoly,
      layer: 'limb',
      fillOpacity: 0.88,
    },
    {
      id: 'forearm-r',
      jointId: 'forearmR',
      shapeKind: 'trapezoid',
      points: forearmRPoly,
      layer: 'limb',
      fillOpacity: 0.88,
    },
    {
      id: 'elbow-r',
      jointId: 'forearmR',
      shapeKind: 'square',
      points: elbowRVerts,
      layer: 'cap',
      fillOpacity: 0.94,
    },
    {
      id: 'palm-r',
      jointId: 'handR',
      shapeKind: 'trapezoid',
      points: palmRPoly,
      layer: 'limb',
      fillOpacity: 0.9,
    },
    {
      id: 'thumb-r',
      jointId: 'thumbR',
      shapeKind: 'triangle',
      points: thumbRPoly,
      layer: 'limb',
      fillOpacity: 0.86,
    },
    {
      id: 'finger-r',
      jointId: 'fingerR',
      shapeKind: 'triangle',
      points: fingerRPoly,
      layer: 'limb',
      fillOpacity: 0.86,
    },
    {
      id: 'humerus-l',
      jointId: 'humerusL',
      shapeKind: 'trapezoid',
      points: humerusLPoly,
      layer: 'limb',
      fillOpacity: 0.88,
    },
    {
      id: 'forearm-l',
      jointId: 'forearmL',
      shapeKind: 'trapezoid',
      points: forearmLPoly,
      layer: 'limb',
      fillOpacity: 0.88,
    },
    {
      id: 'elbow-l',
      jointId: 'forearmL',
      shapeKind: 'square',
      points: elbowLVerts,
      layer: 'cap',
      fillOpacity: 0.94,
    },
    {
      id: 'palm-l',
      jointId: 'handL',
      shapeKind: 'trapezoid',
      points: palmLPoly,
      layer: 'limb',
      fillOpacity: 0.9,
    },
    {
      id: 'thumb-l',
      jointId: 'thumbL',
      shapeKind: 'triangle',
      points: thumbLPoly,
      layer: 'limb',
      fillOpacity: 0.86,
    },
    {
      id: 'finger-l',
      jointId: 'fingerL',
      shapeKind: 'triangle',
      points: fingerLPoly,
      layer: 'limb',
      fillOpacity: 0.86,
    },
  ];

  // Functional line-to-line mechanical connections across all 43 joints
  const functionalLines: CaveArtLine[] = [
    // Axial spine axis
    { id: 'ln-lumbar', jointId: 'lumbar', x1: lumbar.x, y1: lumbar.y, x2: thorax.x, y2: thorax.y, role: 'axis', overlayLight: true },
    { id: 'ln-thorax', jointId: 'thorax', x1: thorax.x, y1: thorax.y, x2: neck.x, y2: neck.y, role: 'axis', overlayLight: true },
    { id: 'ln-neck', jointId: 'neck', x1: neck.x, y1: neck.y, x2: head.x, y2: head.y, role: 'axis', overlayLight: true },
    { id: 'ln-head-crown', jointId: 'head', x1: head.x, y1: head.y, x2: head.endX, y2: head.endY, role: 'axis', overlayLight: true },
    { id: 'ln-head-lip', jointId: 'lip', x1: head.x, y1: head.y, x2: lip.x, y2: lip.y, role: 'skull', overlayLight: true },
    { id: 'ln-lip-chin', jointId: 'lip', x1: lip.x, y1: lip.y, x2: chin.x, y2: chin.y, role: 'skull', overlayLight: true },
    { id: 'ln-brow', jointId: 'head', x1: templeR.x, y1: templeR.y, x2: templeL.x, y2: templeL.y, role: 'skull', overlayLight: true },

    // Torso shoulder-top structural tie-lines to acromions & ribs
    { id: 'ln-torso-shoulder-r', jointId: 'acromionR', x1: torsoTopR.x, y1: torsoTopR.y, x2: acromionR.x, y2: acromionR.y, role: 'girdle' },
    { id: 'ln-torso-shoulder-l', jointId: 'acromionL', x1: torsoTopL.x, y1: torsoTopL.y, x2: acromionL.x, y2: acromionL.y, role: 'girdle' },
    { id: 'ln-rib-r', jointId: 'ribR', x1: ribR.x, y1: ribR.y, x2: ribR.endX, y2: ribR.endY, role: 'rib', overlayLight: true },
    { id: 'ln-rib-l', jointId: 'ribL', x1: ribL.x, y1: ribL.y, x2: ribL.endX, y2: ribL.endY, role: 'rib', overlayLight: true },
    { id: 'ln-rib-chord', jointId: 'thorax', x1: torsoMidR.x, y1: torsoMidR.y, x2: torsoMidL.x, y2: torsoMidL.y, role: 'rib', overlayLight: true },

    // Closed-chain Shoulder Girdle (swivel -> acromion -> humerus, collarbone brace)
    { id: 'ln-swivel-r', jointId: 'swivelR', x1: swivelR.x, y1: swivelR.y, x2: acromionR.x, y2: acromionR.y, role: 'girdle', dashed: true },
    { id: 'ln-swivel-l', jointId: 'swivelL', x1: swivelL.x, y1: swivelL.y, x2: acromionL.x, y2: acromionL.y, role: 'girdle', dashed: true },
    { id: 'ln-swiveltip-r', jointId: 'swivelR', x1: acromionR.x, y1: acromionR.y, x2: swivelTipR.x, y2: swivelTipR.y, role: 'girdle' },
    { id: 'ln-swiveltip-l', jointId: 'swivelL', x1: acromionL.x, y1: acromionL.y, x2: swivelTipL.x, y2: swivelTipL.y, role: 'girdle' },
    { id: 'ln-brace-r', jointId: 'braceR', x1: braceR.x, y1: braceR.y, x2: braceR.endX, y2: braceR.endY, role: 'girdle' },
    { id: 'ln-clav-outer-r', jointId: 'clavOuterR', x1: clavOuterR.x, y1: clavOuterR.y, x2: clavOuterR.endX, y2: clavOuterR.endY, role: 'girdle' },
    { id: 'ln-brace-l', jointId: 'braceL', x1: braceL.x, y1: braceL.y, x2: braceL.endX, y2: braceL.endY, role: 'girdle' },
    { id: 'ln-clav-outer-l', jointId: 'clavOuterL', x1: clavOuterL.x, y1: clavOuterL.y, x2: clavOuterL.endX, y2: clavOuterL.endY, role: 'girdle' },
    { id: 'ln-acro-hum-r', jointId: 'acromionR', x1: acromionR.x, y1: acromionR.y, x2: humerusR.x, y2: humerusR.y, role: 'girdle' },
    { id: 'ln-acro-hum-l', jointId: 'acromionL', x1: acromionL.x, y1: acromionL.y, x2: humerusL.x, y2: humerusL.y, role: 'girdle' },

    // Clean Pelvic structural lines inside trapezoid
    { id: 'ln-hip-femur-bar', jointId: 'pelvis', x1: femurR.x, y1: femurR.y, x2: femurL.x, y2: femurL.y, role: 'pelvis', overlayLight: true },
    { id: 'ln-hip-r-strut', jointId: 'hipR', x1: pelvis.x, y1: pelvis.y, x2: femurR.x, y2: femurR.y, role: 'pelvis', overlayLight: true },
    { id: 'ln-hip-l-strut', jointId: 'hipL', x1: pelvis.x, y1: pelvis.y, x2: femurL.x, y2: femurL.y, role: 'pelvis', overlayLight: true },
    { id: 'ln-pelvis-axis', jointId: 'pelvis', x1: pelvisTopCenterR.x, y1: pelvisTopCenterR.y, x2: pelvisBotCenterR.x, y2: pelvisBotCenterR.y, role: 'pelvis', overlayLight: true },

    // Arms & Digits functional axes
    { id: 'ln-r-humerus', jointId: 'humerusR', x1: humerusR.x, y1: humerusR.y, x2: forearmR.x, y2: forearmR.y, role: 'limb', overlayLight: true },
    { id: 'ln-r-forearm', jointId: 'forearmR', x1: forearmR.x, y1: forearmR.y, x2: handR.x, y2: handR.y, role: 'limb', overlayLight: true },
    { id: 'ln-r-hand', jointId: 'handR', x1: handR.x, y1: handR.y, x2: fingerR.x, y2: fingerR.y, role: 'digit', overlayLight: true },
    { id: 'ln-r-thumb', jointId: 'thumbR', x1: handR.x, y1: handR.y, x2: thumbTipR.x, y2: thumbTipR.y, role: 'digit' },
    { id: 'ln-r-finger', jointId: 'fingerR', x1: fingerR.x, y1: fingerR.y, x2: fingerTipR.x, y2: fingerTipR.y, role: 'digit', overlayLight: true },

    { id: 'ln-l-humerus', jointId: 'humerusL', x1: humerusL.x, y1: humerusL.y, x2: forearmL.x, y2: forearmL.y, role: 'limb', overlayLight: true },
    { id: 'ln-l-forearm', jointId: 'forearmL', x1: forearmL.x, y1: forearmL.y, x2: handL.x, y2: handL.y, role: 'limb', overlayLight: true },
    { id: 'ln-l-hand', jointId: 'handL', x1: handL.x, y1: handL.y, x2: fingerL.x, y2: fingerL.y, role: 'digit', overlayLight: true },
    { id: 'ln-l-thumb', jointId: 'thumbL', x1: handL.x, y1: handL.y, x2: thumbTipL.x, y2: thumbTipL.y, role: 'digit' },
    { id: 'ln-l-finger', jointId: 'fingerL', x1: fingerL.x, y1: fingerL.y, x2: fingerTipL.x, y2: fingerTipL.y, role: 'digit', overlayLight: true },

    // Clean Legs & Feet functional axes (matching arm line clarity)
    { id: 'ln-r-femur', jointId: 'femurR', x1: femurR.x, y1: femurR.y, x2: shinR.x, y2: shinR.y, role: 'limb', overlayLight: true },
    { id: 'ln-r-shin', jointId: 'shinR', x1: shinR.x, y1: shinR.y, x2: footR.x, y2: footR.y, role: 'limb', overlayLight: true },
    { id: 'ln-r-foot', jointId: 'footR', x1: footR.x, y1: footR.y, x2: toeR.x, y2: toeR.y, role: 'limb', overlayLight: true },

    { id: 'ln-l-femur', jointId: 'femurL', x1: femurL.x, y1: femurL.y, x2: shinL.x, y2: shinL.y, role: 'limb', overlayLight: true },
    { id: 'ln-l-shin', jointId: 'shinL', x1: shinL.x, y1: shinL.y, x2: footL.x, y2: footL.y, role: 'limb', overlayLight: true },
    { id: 'ln-l-foot', jointId: 'footL', x1: footL.x, y1: footL.y, x2: toeL.x, y2: toeL.y, role: 'limb', overlayLight: true },
  ];

  return {
    polygons,
    functionalLines,
    metrics: {
      hipWidthPx,
      torsoWidthPx,
      torsoToHipRatio: torsoWidthPx / hipWidthPx,
      lowerSpineBaseWidthPx,
      upperLowerSpineMeetingPoint: thoraxPt,
    },
  };
}
