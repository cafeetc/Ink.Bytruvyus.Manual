import React, { useMemo } from 'react';
import { SubstrateType, TurnDirection } from '../types/canvas';
import {
  PAPER_HEIGHT,
  PAPER_WIDTH,
  REPOSITORY_ASSET_PATHS,
  SRC_CORNER,
  SRC_EDGE,
  computeSymmetricalBorderLayout,
} from '../utils/proportions';

interface ScanBorderLayerProps {
  vw: number;
  vh: number;
  substrate: SubstrateType;
  darkMode?: boolean;
  turnAnim: {
    key: number;
    direction: TurnDirection;
    fromSubstrate: SubstrateType;
    toSubstrate: SubstrateType;
  } | null;
  borderOpacity?: number;
}

export const ScanBorderLayer: React.FC<ScanBorderLayerProps> = ({
  vw,
  vh,
  substrate,
  darkMode = false,
  turnAnim,
  borderOpacity = 1,
}) => {
  const layout = useMemo(() => computeSymmetricalBorderLayout(vw, vh), [vw, vh]);
  const { cornerSize: c, edgeThickness: e, midH } = layout;
  const srcMidH = PAPER_HEIGHT - SRC_CORNER * 2;

  const isHardCover = substrate === 'cover';
  const rimAlpha = darkMode ? 0.94 : isHardCover ? 0.94 : 0.86;
  const vignetteStrength = darkMode ? 0.24 : isHardCover ? 0.34 : 0.14;
  const filterId = darkMode ? 'scan-border-rim-white' : 'scan-border-rim';

  return (
    <div
      aria-hidden="true"
      data-scan-border-layer="true"
      data-border-color={darkMode ? 'white' : 'ink'}
      data-border-corner={c.toFixed(1)}
      data-border-edge={e.toFixed(1)}
      className="pointer-events-none absolute inset-0 overflow-hidden z-[10]"
    >
      {/* Symmetrical inner paper/cover scan edge vignette */}
      <div
        className="absolute inset-0 transition-opacity duration-300"
        style={{
          boxShadow: darkMode
            ? `inset 0 0 ${Math.round(e * 1.9)}px rgba(255, 255, 255, 0.08), inset 0 0 ${Math.round(
                e * 0.65
              )}px rgba(255, 255, 255, 0.14)`
            : `inset 0 0 ${Math.round(e * 2.1)}px rgba(19, 14, 22, ${vignetteStrength}), inset 0 0 ${Math.round(
                e * 0.65
              )}px rgba(19, 14, 22, ${vignetteStrength * 1.45})`,
        }}
      />

      {/* Symmetrical 9-slice scanned vector rim adapted to exact vw x vh */}
      <svg
        className="absolute inset-0 w-full h-full block"
        viewBox={`0 0 ${layout.vw} ${layout.vh}`}
        preserveAspectRatio="none"
      >
        <defs>
          <filter id="scan-border-rim" colorInterpolationFilters="sRGB">
            <feColorMatrix type="saturate" values="0" result="gray" />
            <feColorMatrix
              in="gray"
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -6 0 0 0 4"
              result="rimAlpha"
            />
            <feComposite in="rimAlpha" in2="SourceGraphic" operator="in" />
          </filter>

          {/* Reversed White Border filter for Dark Mode (Black Paper + White Border) */}
          <filter id="scan-border-rim-white" colorInterpolationFilters="sRGB">
            <feColorMatrix type="saturate" values="0" result="gray" />
            <feColorMatrix
              in="gray"
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -6 0 0 0 4"
              result="rimAlpha"
            />
            <feComposite in="rimAlpha" in2="SourceGraphic" operator="in" result="maskedRim" />
            <feFlood floodColor="#FFFFFF" floodOpacity="1" result="whiteFill" />
            <feComposite in="whiteFill" in2="maskedRim" operator="in" />
          </filter>
        </defs>

        <g opacity={borderOpacity * rimAlpha} filter={`url(#${filterId})`}>
          {layout.slices.map((slice) => {
            const scaleX = slice.flipX ? -1 : 1;
            const scaleY = slice.flipY ? -1 : 1;

            return (
              <svg
                key={slice.id}
                x={slice.x}
                y={slice.y}
                width={slice.w}
                height={slice.h}
                viewBox={slice.viewBox}
                preserveAspectRatio="none"
              >
                {slice.flipX || slice.flipY ? (
                  <g
                    transform={(() => {
                      const [vbX, vbY, vbW, vbH] = slice.viewBox.split(' ').map(Number);
                      const cx = vbX + vbW / 2;
                      const cy = vbY + vbH / 2;
                      return `translate(${cx}, ${cy}) scale(${scaleX}, ${scaleY}) translate(${-cx}, ${-cy})`;
                    })()}
                  >
                    <image
                      href={REPOSITORY_ASSET_PATHS.vectorBorderSvg}
                      x={0}
                      y={0}
                      width={PAPER_WIDTH}
                      height={PAPER_HEIGHT}
                    />
                  </g>
                ) : (
                  <image
                    href={REPOSITORY_ASSET_PATHS.vectorBorderSvg}
                    x={0}
                    y={0}
                    width={PAPER_WIDTH}
                    height={PAPER_HEIGHT}
                  />
                )}
              </svg>
            );
          })}
        </g>

        {/* Subtle inner hairline rule aligning symmetrically inside the scan edge */}
        <rect
          x={e + 0.5}
          y={e + 0.5}
          width={Math.max(0, layout.vw - e * 2 - 1)}
          height={Math.max(0, layout.vh - e * 2 - 1)}
          fill="none"
          stroke={
            darkMode
              ? 'rgba(255, 255, 255, 0.24)'
              : isHardCover
              ? 'rgba(22, 0, 30, 0.20)'
              : 'rgba(28, 20, 34, 0.14)'
          }
          strokeWidth={1}
        />
      </svg>

      {/* Edge-as-Border Animation Overlay during Page / Cover Turn */}
      {turnAnim && (
        <div
          key={turnAnim.key}
          className={`absolute inset-0 pointer-events-none ${
            turnAnim.direction === 'next' ? 'animate-edge-sweep-next' : 'animate-edge-sweep-prev'
          }`}
        >
          <div
            className="absolute inset-y-0 left-1/2 -translate-x-1/2"
            style={{
              width:
                turnAnim.fromSubstrate === 'cover' || turnAnim.toSubstrate === 'cover'
                  ? Math.max(44, e * 2.4)
                  : Math.max(56, e * 3.2),
              background: darkMode
                ? 'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.22) 48%, rgba(255,255,255,0.45) 50%, rgba(255,255,255,0.18) 56%, rgba(255,255,255,0) 100%)'
                : turnAnim.fromSubstrate === 'cover' || turnAnim.toSubstrate === 'cover'
                ? 'linear-gradient(90deg, rgba(14,10,18,0) 0%, rgba(14,10,18,0.48) 48%, rgba(255,255,255,0.12) 52%, rgba(14,10,18,0) 100%)'
                : 'linear-gradient(90deg, rgba(24,18,30,0) 0%, rgba(24,18,30,0.22) 44%, rgba(255,252,246,0.52) 50%, rgba(24,18,30,0.16) 58%, rgba(24,18,30,0) 100%)',
            }}
          />

          {midH > 0 && (
            <svg
              className="absolute inset-y-0 left-1/2 -translate-x-1/2 h-full"
              style={{ width: Math.max(18, e * 1.15) }}
              viewBox={`0 0 ${SRC_EDGE} ${layout.vh}`}
              preserveAspectRatio="none"
            >
              <g filter={`url(#${filterId})`} opacity={0.9}>
                <svg
                  x={0}
                  y={c}
                  width={SRC_EDGE}
                  height={midH}
                  viewBox={`0 ${SRC_CORNER} ${SRC_EDGE} ${srcMidH}`}
                  preserveAspectRatio="none"
                >
                  <image
                    href={REPOSITORY_ASSET_PATHS.vectorBorderSvg}
                    x={0}
                    y={0}
                    width={PAPER_WIDTH}
                    height={PAPER_HEIGHT}
                  />
                </svg>
              </g>
            </svg>
          )}
        </div>
      )}
    </div>
  );
};
