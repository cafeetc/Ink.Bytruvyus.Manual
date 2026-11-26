import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEGAPYXL_PX,
  PAPER_HEIGHT,
  PAPER_WIDTH,
  PYXL_PX,
  SUBPYXL_PX,
  computeProportionalCanons,
  computeSymmetricalBorderLayout,
  computeSymmetricalCenterPan,
  computeSymmetricalFitZoom,
  computeSymmetricalRulerTicks,
  getAdjacentPage,
} from './proportions';

test('symmetrical 9-slice border preserves left/right and top/bottom symmetry across viewports', () => {
  const sizes = [
    [1440, 900],
    [390, 844],
    [800, 800],
    [120, 90],
  ] as const;

  for (const [vw, vh] of sizes) {
    const layout = computeSymmetricalBorderLayout(vw, vh);
    assert.equal(layout.cornerSize, layout.edgeThickness);

    const tl = layout.slices.find((s) => s.id === 'corner-tl');
    const tr = layout.slices.find((s) => s.id === 'corner-tr');
    const bl = layout.slices.find((s) => s.id === 'corner-bl');
    const br = layout.slices.find((s) => s.id === 'corner-br');

    assert.ok(tl && tr && bl && br);
    assert.equal(tl.w, tr.w);
    assert.equal(tl.h, bl.h);
    assert.equal(tr.x + tr.w, vw);
    assert.equal(bl.y + bl.h, vh);
    assert.equal(br.x + br.w, vw);
    assert.equal(br.y + br.h, vh);

    const top = layout.slices.find((s) => s.id === 'edge-top');
    const bottom = layout.slices.find((s) => s.id === 'edge-bottom');
    if (top && bottom) {
      assert.equal(top.h, bottom.h);
      assert.equal(top.w, bottom.w);
      assert.equal(top.x, bottom.x);
      assert.equal(bottom.y + bottom.h, vh);
    }

    const left = layout.slices.find((s) => s.id === 'edge-left');
    const right = layout.slices.find((s) => s.id === 'edge-right');
    if (left && right) {
      assert.equal(left.w, right.w);
      assert.equal(left.h, right.h);
      assert.equal(left.y, right.y);
      assert.equal(right.x + right.w, vw);
    }
  }
});

test('symmetrical center pan locks world origin to exact optical center', () => {
  const zoom = 0.42;
  const originX = PAPER_WIDTH / 2;
  const originY = PAPER_HEIGHT / 2;
  const pan = computeSymmetricalCenterPan(1440, 900, originX, originY, zoom);
  assert.ok(Math.abs(pan.x + originX * zoom - 720) < 1e-6);
  assert.ok(Math.abs(pan.y + originY * zoom - 450) < 1e-6);
});

test('proportional canons stay consistent with Pyxl and Puppyt scale', () => {
  const canons = computeProportionalCanons();
  assert.equal(canons.subpyxlPx, SUBPYXL_PX);
  assert.equal(canons.pyxlPx, PYXL_PX);
  assert.equal(canons.megapyxlPx, MEGAPYXL_PX);
  assert.equal(canons.vitruvianSquareWidth, 1070);
  assert.equal(canons.vitruvianSquareHeight, 1060);
  assert.equal(canons.vitruvianCircleRadius, 635);
  assert.ok(canons.workingSquareSidePx >= canons.verticalSpanPx);
  assert.ok(canons.workingSquareSidePx >= canons.horizontalSpanPx);
  assert.ok(canons.headUnitPx > 110 && canons.headUnitPx < 130);
});

test('page turn sequence turns cleanly between Page 21 (Paper) and Page 22 (Cover) on both left and right', () => {
  assert.equal(getAdjacentPage('page-21', 'next'), 'page-22');
  assert.equal(getAdjacentPage('page-21', 'prev'), 'page-22');
  assert.equal(getAdjacentPage('page-22', 'prev'), 'page-21');
  assert.equal(getAdjacentPage('page-22', 'next'), 'page-21');
});

test('symmetrical fit zoom and ruler ticks stay bounded and collision-free', () => {
  const fitDesktop = computeSymmetricalFitZoom(1440, 900);
  const fitStage = computeSymmetricalFitZoom(1440, 784);
  const fitMobile = computeSymmetricalFitZoom(390, 844);
  assert.ok(fitDesktop > fitMobile);
  assert.ok(fitMobile >= 0.1);
  assert.ok(Math.abs(fitStage - (672 / 1540) * 1.25) < 1e-3);

  const ticks = computeSymmetricalRulerTicks(1440, 400, 0.5, PAPER_WIDTH / 2, 40, 40, 44);
  const labeled = ticks.filter((t) => t.label !== null);
  for (let i = 1; i < labeled.length; i++) {
    assert.ok(Math.abs(labeled[i].screen - labeled[i - 1].screen) >= 44);
  }
});
