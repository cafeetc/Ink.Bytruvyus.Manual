import React, { useMemo } from 'react';
import {
  REPO_FACE_PURPLE,
  REPO_GREEN_GLOW_DARK,
  REPO_GREEN_GLOW_LIGHT,
  REPO_GREEN_JOINT_DARK,
  REPO_GREEN_JOINT_LIGHT,
  REPO_SVG_PURPLE,
} from '../data/digitalRig';
import { ArmatureState, ComputedJoint, JointId } from '../types/rig';
import { applyAffine, computeSvgBoneMatrix } from '../utils/kinematics';

interface DigitalMannequinProps {
  armature: ArmatureState;
  computedJoints: Record<JointId, ComputedJoint>;
  selectedJointId: JointId;
  hoveredJointId: JointId | null;
  zoom: number;
  darkMode: boolean;
  isPanning: boolean;
  onHoverJoint: (id: JointId | null) => void;
  onPointerDownJoint: (e: React.PointerEvent<SVGGElement>, jointId: JointId) => void;
  onPointerDownBone: (e: React.PointerEvent<SVGElement>, jointId: JointId) => void;
}

function toMatrixAttr(m: readonly [number, number, number, number, number, number]): string {
  return `matrix(${m[0].toFixed(5)} ${m[1].toFixed(5)} ${m[2].toFixed(5)} ${m[3].toFixed(5)} ${m[4].toFixed(2)} ${m[5].toFixed(2)})`;
}

function makeBridgePoints(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  halfWidth: number
): string {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) {
    return `${ax - halfWidth},${ay - halfWidth} ${ax + halfWidth},${ay - halfWidth} ${ax + halfWidth},${ay + halfWidth} ${ax - halfWidth},${ay + halfWidth}`;
  }
  const nx = (-dy / len) * halfWidth;
  const ny = (dx / len) * halfWidth;
  return `${(ax + nx).toFixed(2)},${(ay + ny).toFixed(2)} ${(ax - nx).toFixed(2)},${(ay - ny).toFixed(2)} ${(bx - nx).toFixed(2)},${(by - ny).toFixed(2)} ${(bx + nx).toFixed(2)},${(by + ny).toFixed(2)}`;
}

export const DigitalMannequin: React.FC<DigitalMannequinProps> = ({
  armature,
  computedJoints,
  selectedJointId,
  hoveredJointId,
  zoom,
  darkMode,
  isPanning,
  onHoverJoint,
  onPointerDownJoint,
  onPointerDownBone,
}) => {
  const selectedJoint = computedJoints[selectedJointId];
  const bodyFill = REPO_SVG_PURPLE; // #2a0033
  const faceFill = REPO_FACE_PURPLE; // #5f0080
  const greenJoint = darkMode ? REPO_GREEN_JOINT_DARK : REPO_GREEN_JOINT_LIGHT;
  const greenGlow = darkMode ? REPO_GREEN_GLOW_DARK : REPO_GREEN_GLOW_LIGHT;
  const hoverAccent = greenGlow;
  const activeAccent = greenGlow;

  const svgMatrices = useMemo(() => {
    const m = (id: JointId, mirrorX = false) =>
      computeSvgBoneMatrix(computedJoints[id].boneMatrix, mirrorX);

    return {
      pelvis: m('pelvis'),
      lumbar: m('lumbar'),
      thorax: m('thorax'),
      neck: m('neck'),
      head: m('head'),
      lip: m('lip'),
      swivelR: m('swivelR', true),
      swivelL: m('swivelL', false),
      braceR: m('braceR', true),
      clavOuterR: m('clavOuterR', true),
      braceL: m('braceL', false),
      clavOuterL: m('clavOuterL', false),
      humerusR: m('humerusR', true),
      humerusL: m('humerusL', false),
      forearmR: m('forearmR', true),
      forearmL: m('forearmL', false),
      handR: m('handR', true),
      thumbR: m('thumbR', true),
      handL: m('handL', false),
      thumbL: m('thumbL', false),
      hipR: m('hipR', false),
      hipL: m('hipL', true),
      femurR: m('femurR', false),
      femurL: m('femurL', true),
      shinR: m('shinR', false),
      shinL: m('shinL', true),
      footR: m('footR', false),
      footL: m('footL', true),
    };
  }, [computedJoints]);

  // 25 interactive green joints centered squarely over each joint radius, swivels & body centers
  const jointHandles = useMemo(() => {
    const pelvisCenter = applyAffine(svgMatrices.pelvis, 824, 1040);
    const spineSwivelCenter = applyAffine(svgMatrices.lumbar, 824, 819);
    const shoulderSwivelRCenter = applyAffine(svgMatrices.swivelR, 873.5, 821.5);
    const shoulderSwivelLCenter = applyAffine(svgMatrices.swivelL, 873.5, 821.5);
    const clavMidRCenter = applyAffine(svgMatrices.clavOuterR, 873.5, 685.5);
    const clavMidLCenter = applyAffine(svgMatrices.clavOuterL, 873.5, 685.5);
    const hipSwivelRCenter = applyAffine(svgMatrices.hipR, 808.5, 1015.9);
    const hipSwivelLCenter = applyAffine(svgMatrices.hipL, 808.5, 1015.9);

    const list: Array<{ id: JointId; x: number; y: number; radiusName: string }> = [
      { id: 'lip', x: computedJoints.lip.x, y: computedJoints.lip.y, radiusName: 'face' },
      { id: 'neck', x: computedJoints.neck.x, y: computedJoints.neck.y, radiusName: 'neck-collar' },
      { id: 'thorax', x: computedJoints.thorax.x, y: computedJoints.thorax.y, radiusName: 'clavicle' },
      { id: 'lumbar', x: spineSwivelCenter.x, y: spineSwivelCenter.y, radiusName: 'spine-swivel' },
      { id: 'swivelR', x: shoulderSwivelRCenter.x, y: shoulderSwivelRCenter.y, radiusName: 'shoulder-swivel-r' },
      { id: 'swivelL', x: shoulderSwivelLCenter.x, y: shoulderSwivelLCenter.y, radiusName: 'shoulder-swivel-l' },
      { id: 'clavOuterR', x: clavMidRCenter.x, y: clavMidRCenter.y, radiusName: 'clavicle-mid-r' },
      { id: 'clavOuterL', x: clavMidLCenter.x, y: clavMidLCenter.y, radiusName: 'clavicle-mid-l' },
      { id: 'pelvis', x: pelvisCenter.x, y: pelvisCenter.y, radiusName: 'waist' },
      { id: 'hipR', x: hipSwivelRCenter.x, y: hipSwivelRCenter.y, radiusName: 'hip-swivel-r' },
      { id: 'hipL', x: hipSwivelLCenter.x, y: hipSwivelLCenter.y, radiusName: 'hip-swivel-l' },
      { id: 'humerusR', x: computedJoints.humerusR.x, y: computedJoints.humerusR.y, radiusName: 'shoulder-r' },
      { id: 'forearmR', x: computedJoints.forearmR.x, y: computedJoints.forearmR.y, radiusName: 'elbow-r' },
      { id: 'handR', x: computedJoints.handR.x, y: computedJoints.handR.y, radiusName: 'wrist-r' },
      { id: 'thumbR', x: computedJoints.thumbR.x, y: computedJoints.thumbR.y, radiusName: 'thumb-r' },
      { id: 'humerusL', x: computedJoints.humerusL.x, y: computedJoints.humerusL.y, radiusName: 'shoulder-l' },
      { id: 'forearmL', x: computedJoints.forearmL.x, y: computedJoints.forearmL.y, radiusName: 'elbow-l' },
      { id: 'handL', x: computedJoints.handL.x, y: computedJoints.handL.y, radiusName: 'wrist-l' },
      { id: 'thumbL', x: computedJoints.thumbL.x, y: computedJoints.thumbL.y, radiusName: 'thumb-l' },
      { id: 'femurR', x: computedJoints.femurR.x, y: computedJoints.femurR.y, radiusName: 'hip-r' },
      { id: 'shinR', x: computedJoints.shinR.x, y: computedJoints.shinR.y, radiusName: 'knee-r' },
      { id: 'footR', x: computedJoints.footR.x, y: computedJoints.footR.y, radiusName: 'ankle-r' },
      { id: 'femurL', x: computedJoints.femurL.x, y: computedJoints.femurL.y, radiusName: 'hip-l' },
      { id: 'shinL', x: computedJoints.shinL.x, y: computedJoints.shinL.y, radiusName: 'knee-l' },
      { id: 'footL', x: computedJoints.footL.x, y: computedJoints.footL.y, radiusName: 'ankle-l' },
    ];
    return list;
  }, [
    computedJoints,
    svgMatrices.clavOuterL,
    svgMatrices.clavOuterR,
    svgMatrices.hipL,
    svgMatrices.hipR,
    svgMatrices.lumbar,
    svgMatrices.pelvis,
    svgMatrices.swivelL,
    svgMatrices.swivelR,
  ]);

  const segStroke = (jointId: JointId) => {
    if (selectedJointId === jointId) return activeAccent;
    if (hoveredJointId === jointId) return hoverAccent;
    return 'none';
  };

  const segStrokeWidth = (jointId: JointId) => {
    if (selectedJointId === jointId) return 1.8;
    if (hoveredJointId === jointId) return 1.5;
    return 0;
  };

  const segStrokeOpacity = (jointId: JointId) => {
    if (selectedJointId === jointId) return darkMode ? 0.62 : 0.56;
    if (hoveredJointId === jointId) return darkMode ? 0.45 : 0.4;
    return 0;
  };

  const bindSegment = (jointId: JointId) => ({
    'data-joint-id': jointId,
    strokeOpacity: segStrokeOpacity(jointId),
    style: { cursor: isPanning ? 'grabbing' : 'pointer' } as React.CSSProperties,
    onPointerEnter: () => onHoverJoint(jointId),
    onPointerLeave: () => onHoverJoint(null),
    onPointerDown: (e: React.PointerEvent<SVGElement>) => onPointerDownBone(e, jointId),
  });

  return (
    <g
      data-digital-bones="true"
      data-model-style="svg-pose-full"
      data-model-color={bodyFill}
      data-selection-glow={greenGlow}
      data-prometheus-wings="removed"
      style={
        darkMode
          ? { filter: 'drop-shadow(0 0 1.4px rgba(216, 206, 224, 0.5))' }
          : undefined
      }
    >
      <defs>
        <filter
          id="bitruvius-ink-bleed"
          x="-6%"
          y="-6%"
          width="112%"
          height="112%"
          colorInterpolationFilters="sRGB"
        >
          {/* Slight organic capillary edge feathering like ink bleed */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.065"
            numOctaves="2"
            seed="7"
            result="paperNoise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="paperNoise"
            scale="2.2"
            xChannelSelector="R"
            yChannelSelector="G"
            result="bleedDisplaced"
          />
          <feGaussianBlur
            in="bleedDisplaced"
            stdDeviation="2.4"
            result="bleedHalo"
          />
          <feComponentTransfer in="bleedHalo" result="bleedSoft">
            <feFuncA type="linear" slope={darkMode ? 0.42 : 0.34} />
          </feComponentTransfer>
          <feGaussianBlur
            in="SourceGraphic"
            stdDeviation="0.65"
            result="featheredCore"
          />
          <feMerge>
            <feMergeNode in="bleedSoft" />
            <feMergeNode in="featheredCore" />
          </feMerge>
        </filter>
      </defs>

      {/* Selected joint parent reference axis ray */}
      {selectedJoint && selectedJoint.parentX !== null && selectedJoint.parentY !== null && (
        <line
          x1={selectedJoint.parentX}
          y1={selectedJoint.parentY}
          x2={
            selectedJoint.parentX +
            Math.cos(((selectedJoint.worldAngle - selectedJoint.localAngle) * Math.PI) / 180) * 68
          }
          y2={
            selectedJoint.parentY +
            Math.sin(((selectedJoint.worldAngle - selectedJoint.localAngle) * Math.PI) / 180) * 68
          }
          stroke={greenGlow}
          strokeOpacity={0.48}
          strokeWidth={1.1}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}

      {/* Body silhouette with subtle edge feathering / ink bleed */}
      <g data-ink-bleed-body="true" filter="url(#bitruvius-ink-bleed)">
      {/* Pelvis / Waist Bulb (Root, solid bodyFill matching other bones) */}
      <g
        transform={toMatrixAttr(svgMatrices.pelvis)}
        fill={bodyFill}
        stroke={segStroke('pelvis')}
        strokeWidth={segStrokeWidth('pelvis')}
        {...bindSegment('pelvis')}
      >
        <path
          data-shape-id="waist"
          d="M824,953 C808,958 790,968 770,985 C745,1008 735,1032 735,1058 C736,1090 752,1118 780,1132 C800,1140 812,1140 825,1140 C842,1140 862,1138 880,1126 C905,1110 918,1085 918,1058 C918,1030 905,1005 880,980 C862,964 842,956 824,953 Z"
          vectorEffect="non-scaling-stroke"
        />
      </g>

      {/* Right Leg (Anatomical R -> screen left) */}
      <g>
        <g
          transform={toMatrixAttr(svgMatrices.femurR)}
          fill={bodyFill}
          stroke={segStroke('femurR')}
          strokeWidth={segStrokeWidth('femurR')}
          {...bindSegment('femurR')}
        >
          {/* Hip ball radius centered squarely on femurR pivot (787, 1100) */}
          <circle cx="787" cy="1100" r="38" vectorEffect="non-scaling-stroke" />
          <polygon
            data-shape-id="femur-r"
            points="821.4,1116.2 671.8,1357.1 650.2,1346.9 752.6,1083.8"
            vectorEffect="non-scaling-stroke"
          />
          <circle cx="661" cy="1352" r="12" vectorEffect="non-scaling-stroke" />
        </g>
        <g
          transform={toMatrixAttr(svgMatrices.shinR)}
          fill={bodyFill}
          stroke={segStroke('shinR')}
          strokeWidth={segStrokeWidth('shinR')}
          {...bindSegment('shinR')}
        >
          {/* Knee circle radius centered squarely on shinR pivot (661, 1352) */}
          <circle cx="661" cy="1352" r="24" vectorEffect="non-scaling-stroke" />
          <polygon
            data-shape-id="shin-r"
            points="683.4,1360.5 557.4,1651.2 540.6,1644.8 638.6,1343.5"
            vectorEffect="non-scaling-stroke"
          />
        </g>
        <g
          transform={toMatrixAttr(svgMatrices.footR)}
          fill={bodyFill}
          stroke={segStroke('footR')}
          strokeWidth={segStrokeWidth('footR')}
          {...bindSegment('footR')}
        >
          {/* Ankle ball radius centered squarely on footR pivot (548, 1650) */}
          <circle cx="548" cy="1650" r="22" vectorEffect="non-scaling-stroke" />
          <polygon
            data-shape-id="foot-r"
            points="367.9,1629.9 545.0,1671.8 551.0,1628.2 370.1,1614.1"
            vectorEffect="non-scaling-stroke"
          />
          <circle cx="369" cy="1622" r="8" vectorEffect="non-scaling-stroke" />
        </g>
      </g>

      {/* Left Leg (Anatomical L -> screen right, mirrored around x = 824) */}
      <g>
        <g
          transform={toMatrixAttr(svgMatrices.femurL)}
          fill={bodyFill}
          stroke={segStroke('femurL')}
          strokeWidth={segStrokeWidth('femurL')}
          {...bindSegment('femurL')}
        >
          <circle cx="787" cy="1100" r="38" vectorEffect="non-scaling-stroke" />
          <polygon
            data-shape-id="femur-l"
            points="821.4,1116.2 671.8,1357.1 650.2,1346.9 752.6,1083.8"
            vectorEffect="non-scaling-stroke"
          />
          <circle cx="661" cy="1352" r="12" vectorEffect="non-scaling-stroke" />
        </g>
        <g
          transform={toMatrixAttr(svgMatrices.shinL)}
          fill={bodyFill}
          stroke={segStroke('shinL')}
          strokeWidth={segStrokeWidth('shinL')}
          {...bindSegment('shinL')}
        >
          <circle cx="661" cy="1352" r="24" vectorEffect="non-scaling-stroke" />
          <polygon
            data-shape-id="shin-l"
            points="683.4,1360.5 557.4,1651.2 540.6,1644.8 638.6,1343.5"
            vectorEffect="non-scaling-stroke"
          />
        </g>
        <g
          transform={toMatrixAttr(svgMatrices.footL)}
          fill={bodyFill}
          stroke={segStroke('footL')}
          strokeWidth={segStrokeWidth('footL')}
          {...bindSegment('footL')}
        >
          <circle cx="548" cy="1650" r="22" vectorEffect="non-scaling-stroke" />
          <polygon
            data-shape-id="foot-l"
            points="367.9,1629.9 545.0,1671.8 551.0,1628.2 370.1,1614.1"
            vectorEffect="non-scaling-stroke"
          />
          <circle cx="369" cy="1622" r="8" vectorEffect="non-scaling-stroke" />
        </g>
      </g>

      {/* Active Spineless Hip Swivel Engine (faceFill accent layered above solid pelvis bulb) */}
      <g
        fill={faceFill}
        stroke={segStroke('pelvis')}
        strokeWidth={segStrokeWidth('pelvis')}
        {...bindSegment('pelvis')}
      >
        <polygon
          data-shape-id="pelvis-bridge"
          points={makeBridgePoints(
            computedJoints.femurR.x,
            computedJoints.femurR.y,
            computedJoints.femurL.x,
            computedJoints.femurL.y,
            5.5
          )}
          vectorEffect="non-scaling-stroke"
        />
      </g>
      <g
        transform={toMatrixAttr(svgMatrices.hipR)}
        fill={faceFill}
        stroke={segStroke('hipR')}
        strokeWidth={segStrokeWidth('hipR')}
        {...bindSegment('hipR')}
      >
        <circle cx="824" cy="955" r="10" vectorEffect="non-scaling-stroke" />
        <polygon
          data-shape-id="hip-r"
          points="833.7,957.3 795.7,1102.3 778.3,1097.7 816.3,952.7"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx="787" cy="1100" r="14" vectorEffect="non-scaling-stroke" />
      </g>
      <g
        transform={toMatrixAttr(svgMatrices.hipL)}
        fill={faceFill}
        stroke={segStroke('hipL')}
        strokeWidth={segStrokeWidth('hipL')}
        {...bindSegment('hipL')}
      >
        <circle cx="824" cy="955" r="10" vectorEffect="non-scaling-stroke" />
        <polygon
          data-shape-id="hip-l"
          points="833.7,957.3 795.7,1102.3 778.3,1097.7 816.3,952.7"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx="787" cy="1100" r="14" vectorEffect="non-scaling-stroke" />
      </g>

      {/* Torso Shield (solid bodyFill matching other bones, layered behind active swivels) */}
      <g
        transform={toMatrixAttr(svgMatrices.lumbar)}
        fill={bodyFill}
        stroke={segStroke('lumbar')}
        strokeWidth={segStrokeWidth('lumbar')}
        {...bindSegment('lumbar')}
      >
        <path
          data-shape-id="torso"
          d="M824,652 L844,654 C880,664 912,700 916,760 C919,800 905,860 880,910 C858,945 840,968 824,968 C808,968 790,945 768,910 C743,860 729,800 732,760 C736,700 768,664 804,654 Z"
          vectorEffect="non-scaling-stroke"
        />
      </g>

      {/* Active Spine Swivel Column & Clavicle Hub (faceFill accent) */}
      <g
        transform={toMatrixAttr(svgMatrices.lumbar)}
        fill={faceFill}
        stroke={segStroke('lumbar')}
        strokeWidth={segStrokeWidth('lumbar')}
        {...bindSegment('lumbar')}
      >
        <circle cx="824" cy="955" r="14" vectorEffect="non-scaling-stroke" />
        <rect
          data-shape-id="spine-swivel"
          x="816"
          y="668"
          width="16"
          height="290"
          rx="8"
          vectorEffect="non-scaling-stroke"
        />
      </g>
      <g
        transform={toMatrixAttr(svgMatrices.thorax)}
        fill={faceFill}
        stroke={segStroke('thorax')}
        strokeWidth={segStrokeWidth('thorax')}
        {...bindSegment('thorax')}
      >
        <circle data-shape-id="clavicle-hub" cx="824" cy="683" r="13" vectorEffect="non-scaling-stroke" />
      </g>

      {/* Active Shoulder Swivel Braces (faceFill accent layered on top of solid torso) */}
      <g
        transform={toMatrixAttr(svgMatrices.swivelR)}
        fill={faceFill}
        stroke={segStroke('swivelR')}
        strokeWidth={segStrokeWidth('swivelR')}
        {...bindSegment('swivelR')}
      >
        <circle cx="824" cy="955" r="11" vectorEffect="non-scaling-stroke" />
        <polygon
          data-shape-id="swivel-r"
          points="815.5,953.2 830.5,958.8 930.5,690.8 915.5,685.2"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx="923" cy="688" r="14" vectorEffect="non-scaling-stroke" />
      </g>
      <g
        transform={toMatrixAttr(svgMatrices.swivelL)}
        fill={faceFill}
        stroke={segStroke('swivelL')}
        strokeWidth={segStrokeWidth('swivelL')}
        {...bindSegment('swivelL')}
      >
        <circle cx="824" cy="955" r="11" vectorEffect="non-scaling-stroke" />
        <polygon
          data-shape-id="swivel-l"
          points="815.5,953.2 830.5,958.8 930.5,690.8 915.5,685.2"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx="923" cy="688" r="14" vectorEffect="non-scaling-stroke" />
      </g>

      {/* Right Arm (Anatomical R -> screen left, mirrored from SVG armR) */}
      <g>
        <g
          transform={toMatrixAttr(svgMatrices.braceR)}
          fill={bodyFill}
          stroke={segStroke('braceR')}
          strokeWidth={segStrokeWidth('braceR')}
          {...bindSegment('braceR')}
        >
          <circle cx="824" cy="683" r="11.5" vectorEffect="non-scaling-stroke" />
          <polygon
            data-shape-id="clav-inner-r"
            points={makeBridgePoints(824, 683, 873.5, 685.5, 11.5)}
            vectorEffect="non-scaling-stroke"
          />
          <circle cx="873.5" cy="685.5" r="11.5" vectorEffect="non-scaling-stroke" />
        </g>
        <g
          transform={toMatrixAttr(svgMatrices.clavOuterR)}
          fill={bodyFill}
          stroke={segStroke('clavOuterR')}
          strokeWidth={segStrokeWidth('clavOuterR')}
          {...bindSegment('clavOuterR')}
        >
          <circle cx="873.5" cy="685.5" r="11.5" vectorEffect="non-scaling-stroke" />
          <polygon
            data-shape-id="clav-outer-r"
            points={makeBridgePoints(873.5, 685.5, 923, 688, 11.5)}
            vectorEffect="non-scaling-stroke"
          />
          <circle cx="923" cy="688" r="12" vectorEffect="non-scaling-stroke" />
        </g>
        <g
          transform={toMatrixAttr(svgMatrices.humerusR)}
          fill={bodyFill}
          stroke={segStroke('humerusR')}
          strokeWidth={segStrokeWidth('humerusR')}
          {...bindSegment('humerusR')}
        >
          <circle cx="923" cy="688" r="24" vectorEffect="non-scaling-stroke" />
          <path
            data-shape-id="upper-r"
            d="M916,686 C940,664 1000,655 1060,658 C1090,660 1110,672 1118,688 C1110,704 1090,716 1060,718 C1000,721 940,712 916,686 Z"
            vectorEffect="non-scaling-stroke"
          />
        </g>
        <g
          transform={toMatrixAttr(svgMatrices.forearmR)}
          fill={bodyFill}
          stroke={segStroke('forearmR')}
          strokeWidth={segStrokeWidth('forearmR')}
          {...bindSegment('forearmR')}
        >
          <circle cx="1113" cy="688" r="14" vectorEffect="non-scaling-stroke" />
          <path
            data-shape-id="fore-r"
            d="M1100,688 C1104,678 1112,672 1126,670 L1262,676 C1278,680 1288,684 1290,688 C1288,692 1278,696 1262,700 L1126,706 C1112,704 1104,698 1100,688 Z"
            vectorEffect="non-scaling-stroke"
          />
        </g>
        <g
          transform={toMatrixAttr(svgMatrices.handR)}
          fill={bodyFill}
          stroke={segStroke('handR')}
          strokeWidth={segStrokeWidth('handR')}
          {...bindSegment('handR')}
        >
          <circle cx="1283" cy="688" r="10" vectorEffect="non-scaling-stroke" />
          <path
            data-shape-id="hand-r"
            d="M1280,688 C1284,680 1292,676 1305,677 L1392,681 L1405,688 L1392,695 L1305,699 C1292,700 1284,696 1280,688 Z"
            vectorEffect="non-scaling-stroke"
          />
        </g>
        <g
          transform={toMatrixAttr(svgMatrices.thumbR)}
          fill="#3E2448"
          stroke={segStroke('thumbR')}
          strokeWidth={segStrokeWidth('thumbR')}
          {...bindSegment('thumbR')}
        >
          <path
            data-shape-id="hand-r-thumb"
            d="M1280,688 C1284,680 1292,676 1305,677 L1355,682 L1368,688 L1355,694 L1305,699 C1292,700 1284,696 1280,688 Z"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </g>

      {/* Left Arm (Anatomical L -> screen right) */}
      <g>
        <g
          transform={toMatrixAttr(svgMatrices.braceL)}
          fill={bodyFill}
          stroke={segStroke('braceL')}
          strokeWidth={segStrokeWidth('braceL')}
          {...bindSegment('braceL')}
        >
          <circle cx="824" cy="683" r="11.5" vectorEffect="non-scaling-stroke" />
          <polygon
            data-shape-id="clav-inner-l"
            points={makeBridgePoints(824, 683, 873.5, 685.5, 11.5)}
            vectorEffect="non-scaling-stroke"
          />
          <circle cx="873.5" cy="685.5" r="11.5" vectorEffect="non-scaling-stroke" />
        </g>
        <g
          transform={toMatrixAttr(svgMatrices.clavOuterL)}
          fill={bodyFill}
          stroke={segStroke('clavOuterL')}
          strokeWidth={segStrokeWidth('clavOuterL')}
          {...bindSegment('clavOuterL')}
        >
          <circle cx="873.5" cy="685.5" r="11.5" vectorEffect="non-scaling-stroke" />
          <polygon
            data-shape-id="clav-outer-l"
            points={makeBridgePoints(873.5, 685.5, 923, 688, 11.5)}
            vectorEffect="non-scaling-stroke"
          />
          <circle cx="923" cy="688" r="12" vectorEffect="non-scaling-stroke" />
        </g>
        <g
          transform={toMatrixAttr(svgMatrices.humerusL)}
          fill={bodyFill}
          stroke={segStroke('humerusL')}
          strokeWidth={segStrokeWidth('humerusL')}
          {...bindSegment('humerusL')}
        >
          <circle cx="923" cy="688" r="24" vectorEffect="non-scaling-stroke" />
          <path
            data-shape-id="upper-l"
            d="M916,686 C940,664 1000,655 1060,658 C1090,660 1110,672 1118,688 C1110,704 1090,716 1060,718 C1000,721 940,712 916,686 Z"
            vectorEffect="non-scaling-stroke"
          />
        </g>
        <g
          transform={toMatrixAttr(svgMatrices.forearmL)}
          fill={bodyFill}
          stroke={segStroke('forearmL')}
          strokeWidth={segStrokeWidth('forearmL')}
          {...bindSegment('forearmL')}
        >
          <circle cx="1113" cy="688" r="14" vectorEffect="non-scaling-stroke" />
          <path
            data-shape-id="fore-l"
            d="M1100,688 C1104,678 1112,672 1126,670 L1262,676 C1278,680 1288,684 1290,688 C1288,692 1278,696 1262,700 L1126,706 C1112,704 1104,698 1100,688 Z"
            vectorEffect="non-scaling-stroke"
          />
        </g>
        <g
          transform={toMatrixAttr(svgMatrices.handL)}
          fill={bodyFill}
          stroke={segStroke('handL')}
          strokeWidth={segStrokeWidth('handL')}
          {...bindSegment('handL')}
        >
          <circle cx="1283" cy="688" r="10" vectorEffect="non-scaling-stroke" />
          <path
            data-shape-id="hand-l"
            d="M1280,688 C1284,680 1292,676 1305,677 L1392,681 L1405,688 L1392,695 L1305,699 C1292,700 1284,696 1280,688 Z"
            vectorEffect="non-scaling-stroke"
          />
        </g>
        <g
          transform={toMatrixAttr(svgMatrices.thumbL)}
          fill="#3E2448"
          stroke={segStroke('thumbL')}
          strokeWidth={segStrokeWidth('thumbL')}
          {...bindSegment('thumbL')}
        >
          <path
            data-shape-id="hand-l-thumb"
            d="M1280,688 C1284,680 1292,676 1305,677 L1355,682 L1368,688 L1355,694 L1305,699 C1292,700 1284,696 1280,688 Z"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </g>

      {/* Neck & Head Stack */}
      <g>
        <g
          transform={toMatrixAttr(svgMatrices.neck)}
          fill={bodyFill}
          stroke={segStroke('neck')}
          strokeWidth={segStrokeWidth('neck')}
          {...bindSegment('neck')}
        >
          <rect x="800" y="618" width="48" height="62" rx="20" vectorEffect="non-scaling-stroke" />
        </g>
        <g
          transform={toMatrixAttr(svgMatrices.head)}
          fill={bodyFill}
          stroke={segStroke('head')}
          strokeWidth={segStrokeWidth('head')}
          {...bindSegment('head')}
        >
          <rect x="789" y="565" width="70" height="45" rx="22" vectorEffect="non-scaling-stroke" />
          <path
            data-shape-id="skull"
            d="M824,468 C870,468 878,520 878,545 C878,590 866,612 850,620 C840,625 832,626 824,626 C816,626 808,625 798,620 C782,612 770,590 770,545 C770,520 778,468 824,468 Z"
            vectorEffect="non-scaling-stroke"
          />
          <rect x="818" y="540" width="12" height="82" rx="6" vectorEffect="non-scaling-stroke" />
        </g>
        <g
          transform={toMatrixAttr(svgMatrices.lip)}
          fill={faceFill}
          stroke={segStroke('lip')}
          strokeWidth={segStrokeWidth('lip')}
          {...bindSegment('lip')}
        >
          <circle data-shape-id="face-medallion" cx="824" cy="540" r="30" vectorEffect="non-scaling-stroke" />
        </g>
      </g>
      </g>

      {/* Interactive Tiny Translucent Green Joint Dots Centered Squarely Over Each Radius */}
      <g data-joint-handles="true">
        {jointHandles.map((handle) => {
          const joint = computedJoints[handle.id];
          const runtime = armature.joints[handle.id];
          const isSelected = selectedJointId === handle.id;
          const isHovered = hoveredJointId === handle.id;
          const isRigid = runtime?.physicsMode === 'rigid';
          const isPinned = joint.mode === 'PIN';
          const canDrag = !isPinned && !isRigid;

          return (
            <g
              key={`joint-dot-${handle.id}`}
              data-joint-dot={handle.id}
              data-radius-center={handle.radiusName}
              transform={`translate(${handle.x}, ${handle.y}) scale(${1 / zoom})`}
              onPointerEnter={() => onHoverJoint(handle.id)}
              onPointerLeave={() => onHoverJoint(null)}
              onPointerDown={(e) => onPointerDownJoint(e, handle.id)}
              style={{
                cursor: isPanning
                  ? 'grabbing'
                  : !canDrag
                  ? 'not-allowed'
                  : 'pointer',
              }}
            >
              <circle r={6} fill="transparent" />
              {(isSelected || isHovered) && (
                <circle
                  r={isSelected ? 4.8 : 4.4}
                  fill="none"
                  stroke={greenGlow}
                  strokeOpacity={0.72}
                  strokeWidth={isSelected ? 1.25 : 1.05}
                />
              )}
              <circle
                r={2.1}
                fill={greenJoint}
                fillOpacity={isSelected || isHovered ? 0.68 : 0.42}
              />
            </g>
          );
        })}
      </g>
    </g>
  );
};
