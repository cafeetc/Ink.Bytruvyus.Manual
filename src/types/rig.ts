export type JointMode = 'IK' | 'FK' | 'PIN' | 'ROOT';

/**
 * Canonical 43-joint articulated digital puppet IDs (split folding collarbones, no Prometheus wings).
 */
export type JointId =
  | 'pelvis'
  | 'lumbar'
  | 'thorax'
  | 'ribR'
  | 'ribL'
  | 'neck'
  | 'head'
  | 'lip'
  | 'chinTip'
  | 'swivelR'
  | 'swivelTipR'
  | 'acromionR'
  | 'braceR'
  | 'clavOuterR'
  | 'humerusR'
  | 'forearmR'
  | 'handR'
  | 'thumbR'
  | 'thumbTipR'
  | 'fingerR'
  | 'fingerTipR'
  | 'swivelL'
  | 'swivelTipL'
  | 'acromionL'
  | 'braceL'
  | 'clavOuterL'
  | 'humerusL'
  | 'forearmL'
  | 'handL'
  | 'thumbL'
  | 'thumbTipL'
  | 'fingerL'
  | 'fingerTipL'
  | 'hipR'
  | 'femurR'
  | 'shinR'
  | 'footR'
  | 'toeR'
  | 'hipL'
  | 'femurL'
  | 'shinL'
  | 'footL'
  | 'toeL';

export type PuppytJointRole =
  | 'root'
  | 'spine'
  | 'ribcage'
  | 'head_facial'
  | 'shoulder_girdle'
  | 'accessory_rig'
  | 'limb_arm'
  | 'hand_digit'
  | 'limb_leg'
  | 'foot_digit';

export type BodyPartCategory =
  | 'pelvis'
  | 'thighs'
  | 'calves'
  | 'feet'
  | 'spine'
  | 'ribs'
  | 'girdle'
  | 'upper_arms'
  | 'forearms'
  | 'hands'
  | 'digits'
  | 'neck'
  | 'head';

export type KeystoneOrigin = 'navel' | 'crown';

export type EnvironmentalAnchorId =
  | 'bottom_of_spine'
  | 'feet'
  | 'navel'
  | 'clavicle'
  | 'neck'
  | 'crown';

export type PhysicsModeId =
  | 'twins'
  | 'elastic_rubber'
  | 'damp'
  | 'rigid'
  | 'mode_e';

export type PosePresetId = 'tpose' | 'vitruvian' | 'contrapposto' | 'striding';

export interface AimConstraintSpec {
  to: JointId;
  minRatio: number;
  maxRatio: number;
}

export interface JointSpec {
  id: JointId;
  label: string;
  shortCode: string;
  subtitle: string;
  parentId: JointId | null;
  role: PuppytJointRole;
  side: 'center' | 'right' | 'left';
  restPivot: readonly [number, number];
  restTip?: readonly [number, number];
  lengthPx: number;
  endExtensionPx?: number;
  bodyPartCategory: BodyPartCategory;
  isSpine?: boolean;
  isTip?: boolean;
  locked?: boolean;
  isGhost?: boolean;
  aimTarget?: AimConstraintSpec;
  limits?: readonly [number, number];
  defaultLocalAngle: number;
  defaultMode: JointMode;
  ikChain?: [JointId, JointId, JointId] | 'spine';
  bendDirection?: 1 | -1;
}

export interface JointRuntimeState {
  localAngle: number;
  mode: JointMode;
  physicsMode: PhysicsModeId;
  modeERatio: number;
  scaleLength: number;
  scaleWidth: number;
}

export interface ComputedJoint {
  id: JointId;
  spec: JointSpec;
  x: number;
  y: number;
  endX: number;
  endY: number;
  parentX: number | null;
  parentY: number | null;
  localAngle: number;
  worldAngle: number;
  restWorldDeg: number;
  cumulativeDeltaDeg: number;
  effectiveLengthPx: number;
  effectiveWidthScale: number;
  mode: JointMode;
  boneMatrix: readonly [number, number, number, number, number, number];
  isStrained?: boolean;
  tensionRatio?: number;
}

export interface RigHierarchyAuditReport {
  valid: boolean;
  totalJoints: number;
  orphanNodes: string[];
  cycles: string[];
  topologicalViolations: string[];
  aimOrderViolations: string[];
  parentMismatches: Array<{ id: string; expected: string | null; actual: string | null }>;
}

export interface ArmatureState {
  rootX: number;
  rootY: number;
  rootRotation: number;
  continuousSpin: boolean;
  internalKeystone: KeystoneOrigin;
  environmentalAnchor: EnvironmentalAnchorId;
  isAnchorPinned: boolean;
  joints: Record<JointId, JointRuntimeState>;
}

export interface Point2D {
  x: number;
  y: number;
}

export type CaveArtShapeKind = 'triangle' | 'trapezoid' | 'square';

export type CaveArtPartId =
  | 'cranium-trapezoid'
  | 'jaw-triangle'
  | 'neck-trapezoid'
  | 'upper-torso-trapezoid'
  | 'upper-torso-triangle'
  | 'lower-spine-triangle'
  | 'pelvis-hip-r'
  | 'pelvis-hip-l'
  | 'humerus-r'
  | 'forearm-r'
  | 'elbow-r'
  | 'palm-r'
  | 'thumb-r'
  | 'finger-r'
  | 'humerus-l'
  | 'forearm-l'
  | 'elbow-l'
  | 'palm-l'
  | 'thumb-l'
  | 'finger-l'
  | 'femur-r'
  | 'knee-r'
  | 'shin-r'
  | 'heel-r'
  | 'foot-r'
  | 'femur-l'
  | 'knee-l'
  | 'shin-l'
  | 'heel-l'
  | 'foot-l';

export interface CaveArtPolygon {
  id: CaveArtPartId;
  jointId: JointId;
  shapeKind: CaveArtShapeKind;
  points: readonly Point2D[];
  layer: 'back' | 'torso' | 'pelvis' | 'limb' | 'cap' | 'head';
  fillOpacity: number;
}

export interface CaveArtLine {
  id: string;
  jointId: JointId;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  role: 'axis' | 'girdle' | 'rib' | 'pelvis' | 'limb' | 'digit' | 'skull' | 'strained';
  dashed?: boolean;
  overlayLight?: boolean;
}

export interface CaveArtRigGeometry {
  polygons: CaveArtPolygon[];
  functionalLines: CaveArtLine[];
  metrics: {
    hipWidthPx: number;
    torsoWidthPx: number;
    torsoToHipRatio: number;
    lowerSpineBaseWidthPx: number;
    upperLowerSpineMeetingPoint: Point2D;
  };
}

export const ANGLE_PRECISION_STEP = 0.25;
export const BONE_SCALE_MIN = 0.5;
export const BONE_SCALE_MAX = 2.0;
