import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JOINT_SPECS,
  REPO_GREEN_GLOW_DARK,
  REPO_GREEN_GLOW_LIGHT,
} from '../data/digitalRig';
import {
  DEFAULT_SCREEN_FPS,
  FPS_OPTIONS,
  getFrameIntervalMs,
  getNextFpsOption,
  remainingScreenFrameWaitMs,
  shouldEmitScreenFrame,
} from './frameThrottle';
import {
  buildSavedPosePayload,
  computeUncutExportViewBox,
} from './poseExport';
import {
  applyAffine,
  auditRigHierarchy,
  buildCaveArtGeometry,
  computeArmature,
  computeSvgBoneMatrix,
  createPosePreset,
  mirrorPose,
  shortestAngleDelta,
  solveBoneAimRotation,
  solveTwoBoneIK,
} from './kinematics';

test('43-joint rig hierarchy passes strict topological & closed-chain audit without Prometheus wings', () => {
  const report = auditRigHierarchy(JOINT_SPECS);
  assert.equal(report.totalJoints, 43);
  assert.equal(report.valid, true);
  assert.deepEqual(report.orphanNodes, []);
  assert.deepEqual(report.cycles, []);
  assert.deepEqual(report.topologicalViolations, []);
  assert.deepEqual(report.aimOrderViolations, []);
  assert.deepEqual(report.parentMismatches, []);

  const ids = new Set(JOINT_SPECS.map((s) => s.id as string));
  assert.equal(ids.has('wingR'), false, 'wingR removed');
  assert.equal(ids.has('wingL'), false, 'wingL removed');
});

test('all pose presets evaluate all 41 joints cleanly without NaN and pin waist/navel to canvas origin', () => {
  const origin = { x: 681.5, y: 900 };
  for (const preset of ['tpose', 'vitruvian', 'contrapposto', 'striding'] as const) {
    const state = createPosePreset(preset);
    const computed = computeArmature(state, origin);

    for (const spec of JOINT_SPECS) {
      const j = computed[spec.id];
      assert.ok(Number.isFinite(j.x) && Number.isFinite(j.y), `${preset}.${spec.id} x/y finite`);
      assert.ok(Number.isFinite(j.endX) && Number.isFinite(j.endY), `${preset}.${spec.id} end finite`);
    }

    assert.ok(Math.abs(computed.lumbar.x - origin.x) < 1e-4, `${preset} lumbar pinned x`);
    assert.ok(Math.abs(computed.lumbar.y - origin.y) < 1e-4, `${preset} lumbar pinned y`);
  }
});

test('default pose matches uploaded SVG model (horizontal arms, wide A-stance legs, outward feet, no wings)', () => {
  const state = createPosePreset('tpose');
  const computed = computeArmature(state);
  const geom = buildCaveArtGeometry(computed);

  // Horizontal arms straight out left and right
  assert.ok(Math.abs(computed.humerusR.y - computed.forearmR.y) < 1e-4);
  assert.ok(Math.abs(computed.forearmR.y - computed.handR.y) < 1e-4);
  assert.ok(Math.abs(computed.humerusL.y - computed.forearmL.y) < 1e-4);
  assert.ok(Math.abs(computed.forearmL.y - computed.handL.y) < 1e-4);

  // Wide symmetrical A-stance legs and outward horizontal feet
  assert.ok(computed.pelvis.x - computed.femurR.x > 25);
  assert.ok(computed.femurR.x - computed.shinR.x > 90);
  assert.ok(computed.shinR.x - computed.footR.x > 80);
  assert.ok(computed.footR.x - computed.toeR.x > 130);
  assert.ok(Math.abs((computed.footR.x - computed.pelvis.x) + (computed.footL.x - computed.pelvis.x)) < 1e-4);

  // Zero Prometheus wing polygons or lines
  assert.equal(geom.polygons.some((p) => (p.id as string).includes('wing')), false);
  assert.equal(geom.functionalLines.some((l) => l.id.includes('wing')), false);
});

test('pink joints remain dead-center over every circular joint radius in rest and bent poses', () => {
  const state = createPosePreset('contrapposto');
  const computed = computeArmature(state);

  const checks: Array<{ id: keyof typeof computed; mirrorX: boolean; svgCx: number; svgCy: number }> = [
    { id: 'lip', mirrorX: false, svgCx: 824, svgCy: 540 },
    { id: 'humerusR', mirrorX: true, svgCx: 923, svgCy: 688 },
    { id: 'humerusL', mirrorX: false, svgCx: 923, svgCy: 688 },
    { id: 'forearmR', mirrorX: true, svgCx: 1113, svgCy: 688 },
    { id: 'forearmL', mirrorX: false, svgCx: 1113, svgCy: 688 },
    { id: 'handR', mirrorX: true, svgCx: 1283, svgCy: 688 },
    { id: 'handL', mirrorX: false, svgCx: 1283, svgCy: 688 },
    { id: 'femurR', mirrorX: false, svgCx: 787, svgCy: 1100 },
    { id: 'femurL', mirrorX: true, svgCx: 787, svgCy: 1100 },
    { id: 'shinR', mirrorX: false, svgCx: 661, svgCy: 1352 },
    { id: 'shinL', mirrorX: true, svgCx: 661, svgCy: 1352 },
    { id: 'footR', mirrorX: false, svgCx: 548, svgCy: 1650 },
    { id: 'footL', mirrorX: true, svgCx: 548, svgCy: 1650 },
  ];

  for (const c of checks) {
    const j = computed[c.id];
    const m = computeSvgBoneMatrix(j.boneMatrix, c.mirrorX);
    const radiusCenter = applyAffine(m, c.svgCx, c.svgCy);
    const err = Math.hypot(radiusCenter.x - j.x, radiusCenter.y - j.y);
    assert.ok(err < 1e-4, `${String(c.id)} pink joint off-center from radius by ${err}`);
  }
});

test('two-bone IK, FK bone aim rotation, mirror symmetry, and shortest-path wrap work predictably', () => {
  assert.equal(shortestAngleDelta(170, -170), 20);
  assert.equal(shortestAngleDelta(-170, 170), -20);

  const base = createPosePreset('tpose');
  const before = computeArmature(base);
  const targetX = before.handR.x + 28;
  const targetY = before.handR.y - 65;

  const afterIK = solveTwoBoneIK(base, 'handR', targetX, targetY);
  const solved = computeArmature(afterIK);
  const distBefore = Math.hypot(before.handR.x - targetX, before.handR.y - targetY);
  const distAfter = Math.hypot(solved.handR.x - targetX, solved.handR.y - targetY);
  assert.ok(distAfter < distBefore, `IK moved handR closer (${distBefore} -> ${distAfter})`);

  const rotated = solveBoneAimRotation(base, 'humerusL', before.humerusL.x + 80, before.humerusL.y - 80);
  assert.notEqual(rotated.joints.humerusL.localAngle, base.joints.humerusL.localAngle);

  const mirrored = mirrorPose(afterIK);
  assert.equal(mirrored.joints.humerusL.localAngle, -afterIK.joints.humerusR.localAngle);
  assert.equal(mirrored.joints.forearmL.localAngle, -afterIK.joints.forearmR.localAngle);
});

test('split two-piece collarbones fold up/down rotationally with zero stretch and half-width segments', () => {
  const rest = computeArmature(createPosePreset('tpose'));
  const fullSpanR = Math.hypot(rest.acromionR.x - rest.thorax.x, rest.acromionR.y - rest.thorax.y);
  const fullSpanL = Math.hypot(rest.acromionL.x - rest.thorax.x, rest.acromionL.y - rest.thorax.y);

  // Half width each, exact same width combined at rest
  assert.ok(Math.abs(rest.braceR.effectiveLengthPx - fullSpanR / 2) < 1e-4);
  assert.ok(Math.abs(rest.clavOuterR.effectiveLengthPx - fullSpanR / 2) < 1e-4);
  assert.ok(Math.abs(rest.braceR.effectiveLengthPx + rest.clavOuterR.effectiveLengthPx - fullSpanR) < 1e-4);
  assert.ok(Math.abs(rest.braceL.effectiveLengthPx - fullSpanL / 2) < 1e-4);
  assert.ok(Math.abs(rest.clavOuterL.effectiveLengthPx - fullSpanL / 2) < 1e-4);
  assert.ok(Math.abs(rest.braceL.effectiveLengthPx + rest.clavOuterL.effectiveLengthPx - fullSpanL) < 1e-4);

  // Fold UP on right (braceR = +28) and DOWN on left (braceL = +28)
  const folded = createPosePreset('tpose');
  folded.joints.lumbar.localAngle = -18;
  folded.joints.thorax.localAngle = 22;
  folded.joints.braceR.localAngle = 28;
  folded.joints.braceL.localAngle = 28;
  folded.joints.swivelR.localAngle = 6;
  folded.joints.swivelL.localAngle = -14;

  const computed = computeArmature(folded);

  // Exact zero stretch on every segment in folded pose
  assert.ok(Math.abs(Math.hypot(computed.braceR.endX - computed.braceR.x, computed.braceR.endY - computed.braceR.y) - rest.braceR.effectiveLengthPx) < 1e-4);
  assert.ok(Math.abs(Math.hypot(computed.clavOuterR.endX - computed.clavOuterR.x, computed.clavOuterR.endY - computed.clavOuterR.y) - rest.clavOuterR.effectiveLengthPx) < 1e-4);
  assert.ok(Math.abs(Math.hypot(computed.braceL.endX - computed.braceL.x, computed.braceL.endY - computed.braceL.y) - rest.braceL.effectiveLengthPx) < 1e-4);
  assert.ok(Math.abs(Math.hypot(computed.clavOuterL.endX - computed.clavOuterL.x, computed.clavOuterL.endY - computed.clavOuterL.y) - rest.clavOuterL.effectiveLengthPx) < 1e-4);

  // Exact continuous chain connections (thorax -> inner -> outer -> acromion) & rigid SVG matrix tips
  const braceRSvgTip = applyAffine(computeSvgBoneMatrix(computed.braceR.boneMatrix, true), 873.5, 685.5);
  const clavOuterRSvgTip = applyAffine(computeSvgBoneMatrix(computed.clavOuterR.boneMatrix, true), 923, 688);
  const braceLSvgTip = applyAffine(computeSvgBoneMatrix(computed.braceL.boneMatrix, false), 873.5, 685.5);
  const clavOuterLSvgTip = applyAffine(computeSvgBoneMatrix(computed.clavOuterL.boneMatrix, false), 923, 688);

  assert.ok(Math.hypot(computed.braceR.x - computed.thorax.x, computed.braceR.y - computed.thorax.y) < 1e-4);
  assert.ok(Math.hypot(braceRSvgTip.x - computed.clavOuterR.x, braceRSvgTip.y - computed.clavOuterR.y) < 1e-4);
  assert.ok(Math.hypot(clavOuterRSvgTip.x - computed.acromionR.x, clavOuterRSvgTip.y - computed.acromionR.y) < 1e-4);
  assert.ok(Math.hypot(computed.braceL.x - computed.thorax.x, computed.braceL.y - computed.thorax.y) < 1e-4);
  assert.ok(Math.hypot(braceLSvgTip.x - computed.clavOuterL.x, braceLSvgTip.y - computed.clavOuterL.y) < 1e-4);
  assert.ok(Math.hypot(clavOuterLSvgTip.x - computed.acromionL.x, clavOuterLSvgTip.y - computed.acromionL.y) < 1e-4);

  // Fold UP check vs Fold DOWN check at neutral spine
  const foldUpDown = createPosePreset('tpose');
  foldUpDown.joints.braceR.localAngle = 25; // UP
  foldUpDown.joints.braceL.localAngle = 25; // DOWN
  const cUpDown = computeArmature(foldUpDown);
  assert.ok(cUpDown.clavOuterR.y < cUpDown.thorax.y - 8, 'braceR +25 folds UP above thorax');
  assert.ok(cUpDown.clavOuterL.y > cUpDown.thorax.y + 8, 'braceL +25 folds DOWN below thorax');
});

test('spineless hip swivel engine clamps hipR/hipL bounds, keeps inter-hip bridge intact, and stays independent of spine', () => {
  const extreme = createPosePreset('tpose');
  extreme.joints.lumbar.localAngle = -28;
  extreme.joints.thorax.localAngle = 36;
  extreme.joints.hipR.localAngle = 65;
  extreme.joints.hipL.localAngle = -65;

  const computedExtreme = computeArmature(extreme);
  assert.equal(computedExtreme.hipR.localAngle, 16);
  assert.equal(computedExtreme.hipL.localAngle, -16);
  assert.ok(computedExtreme.femurL.x - computedExtreme.femurR.x > 40, 'hips never invert or collapse');

  // Spineless independence: bending lumbar/thorax does not alter hip swivel angles or hip world coords
  const upright = createPosePreset('tpose');
  upright.joints.hipR.localAngle = 10;
  upright.joints.hipL.localAngle = -8;
  const bentSpine = createPosePreset('tpose');
  bentSpine.joints.lumbar.localAngle = -25;
  bentSpine.joints.thorax.localAngle = 30;
  bentSpine.joints.hipR.localAngle = 10;
  bentSpine.joints.hipL.localAngle = -8;

  const cUpright = computeArmature(upright);
  const cBent = computeArmature(bentSpine);
  assert.equal(cBent.hipR.localAngle, cUpright.hipR.localAngle);
  assert.equal(cBent.hipL.localAngle, cUpright.hipL.localAngle);
  assert.ok(Math.hypot(cBent.femurR.x - cUpright.femurR.x, cBent.femurR.y - cUpright.femurR.y) < 1e-4);
  assert.ok(Math.hypot(cBent.femurL.x - cUpright.femurL.x, cBent.femurL.y - cUpright.femurL.y) < 1e-4);

  // Legs track hipR/hipL swivel rotation cleanly
  const rest = computeArmature(createPosePreset('tpose'));
  assert.ok(Math.hypot(cUpright.footR.x - rest.footR.x, cUpright.footR.y - rest.footR.y) > 40);
  assert.ok(Math.hypot(cUpright.footL.x - rest.footL.x, cUpright.footL.y - rest.footL.y) > 40);
});

test('rotating waist (pelvis) rotates bottom half cleanly at waist joint without moving torso or upper body', () => {
  const restState = createPosePreset('tpose');
  const rest = computeArmature(restState);

  const waistTurned = createPosePreset('tpose');
  waistTurned.rootRotation = 28;
  const turned = computeArmature(waistTurned);

  // Bottom half rotates around waist pivot (pelvis/lumbar origin)
  assert.ok(Math.hypot(turned.femurR.x - rest.femurR.x, turned.femurR.y - rest.femurR.y) > 40);
  assert.ok(Math.hypot(turned.femurL.x - rest.femurL.x, turned.femurL.y - rest.femurL.y) > 40);
  assert.ok(Math.hypot(turned.footR.x - rest.footR.x, turned.footR.y - rest.footR.y) > 200);
  assert.ok(Math.hypot(turned.footL.x - rest.footL.x, turned.footL.y - rest.footL.y) > 200);

  // Waist pivot and entire upper torso/arms/head remain completely stationary
  const upperJoints = [
    'lumbar',
    'thorax',
    'neck',
    'head',
    'lip',
    'swivelR',
    'swivelL',
    'braceR',
    'clavOuterR',
    'braceL',
    'clavOuterL',
    'humerusR',
    'handR',
    'humerusL',
    'handL',
  ] as const;

  for (const id of upperJoints) {
    const err = Math.hypot(turned[id].x - rest[id].x, turned[id].y - rest[id].y);
    assert.ok(err < 1e-4, `upper body joint ${id} moved by ${err} when waist rotated`);
    assert.ok(
      Math.abs(turned[id].worldAngle - rest[id].worldAngle) < 1e-4,
      `upper body joint ${id} angle shifted when waist rotated`
    );
  }
});

function hexSaturation(hex: string): number {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return 0;
  const d = max - min;
  return l > 0.5 ? d / (2 - max - min) : d / (max + min);
}

test('thumbs articulate independently, selection glow is greatly desaturated, and FPS cap defaults to 24 with 12/15/24/30 cycle', () => {
  const pose = createPosePreset('tpose');
  pose.joints.thumbL.localAngle = -25;
  const computed = computeArmature(pose, { x: 681.5, y: 900 });
  assert.ok(Math.abs(computed.thumbL.localAngle - -25) < 1e-4);
  assert.ok(Math.abs(computed.handL.localAngle) < 1e-4);

  assert.ok(hexSaturation(REPO_GREEN_GLOW_LIGHT) <= 0.12);
  assert.ok(hexSaturation(REPO_GREEN_GLOW_DARK) <= 0.12);

  assert.equal(DEFAULT_SCREEN_FPS, 24);
  assert.deepEqual(FPS_OPTIONS, [12, 15, 24, 30]);
  assert.equal(getNextFpsOption(24), 30);
  assert.equal(getNextFpsOption(30), 12);
  assert.equal(getNextFpsOption(12), 15);
  assert.equal(getNextFpsOption(15), 24);

  assert.ok(Math.abs(getFrameIntervalMs(24) - 1000 / 24) < 1e-6);
  assert.equal(shouldEmitScreenFrame(-1, 100, 24), true);
  assert.equal(shouldEmitScreenFrame(100, 120, 24), false);
  assert.equal(shouldEmitScreenFrame(100, 142, 24), true);
  assert.equal(shouldEmitScreenFrame(100, 142, 12), false);
  assert.equal(shouldEmitScreenFrame(100, 184, 12), true);
  assert.equal(shouldEmitScreenFrame(100, 134, 30), true);
  assert.ok(remainingScreenFrameWaitMs(100, 120, 24) > 20);
  assert.equal(remainingScreenFrameWaitMs(100, 145, 24), 0);
});

test('double-click pose export payload and double-right-click model export viewBox stay uncut and unskewed', () => {
  const pose = createPosePreset('contrapposto');
  const computed = computeArmature(pose, { x: 681.5, y: 900 });
  const fixedDate = new Date('2026-11-26T09:05:00.000Z');
  const payload = buildSavedPosePayload(pose, computed, 'contrapposto', fixedDate);

  assert.equal(payload.savedAt, '2026-11-26T09:05:00.000Z');
  assert.equal(payload.savedDate, '2026-11-26');
  assert.equal(payload.preset, 'contrapposto');
  assert.ok(payload.joints.pelvis && Number.isFinite(payload.joints.pelvis.x));

  const vb = computeUncutExportViewBox({ x: 250, y: 310, width: 920, height: 1120 }, computed, 48);
  assert.ok(vb.x <= 202 && vb.y <= 262);
  assert.ok(vb.x + vb.width >= 1218 && vb.y + vb.height >= 1478);
  const aspectViewBox = vb.width / vb.height;
  const aspectExport = vb.exportWidth / vb.exportHeight;
  assert.ok(Math.abs(aspectViewBox - aspectExport) < 0.01, 'export dimensions must preserve aspect ratio without skew');
});
