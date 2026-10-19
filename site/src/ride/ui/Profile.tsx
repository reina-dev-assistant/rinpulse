import { useMemo } from "react";

import type { RouteDef } from "../routes.ts";
import { profileOf } from "../track.ts";

interface ProfileProps {
  route: RouteDef;
  /** Rider position in metres; omit for a static preview. */
  positionM?: number;
  ghostPositionM?: number | null;
  /** Other riders (pacer bots), metres. */
  otherPositionsM?: readonly number[];
  /** Show the sprint and KOM bands. */
  segments?: boolean;
  label: string;
  className?: string;
}

const W = 1000;
const H = 200;
const PAD_TOP = 18;
const PAD_BOTTOM = 8;

/** The route's elevation profile as an SVG area, with the rider (and ghost) positioned on it. */
export function Profile({ route, positionM, ghostPositionM, otherPositionsM, segments = false, label, className }: ProfileProps) {
  const geometry = useMemo(() => {
    const points = profileOf(route, Math.max(20, route.lengthM / 240));
    const elevations = points.map((p) => p.e);
    const min = Math.min(...elevations);
    const max = Math.max(...elevations);
    const span = Math.max(20, max - min);
    const lo = min - span * 0.08;
    const x = (d: number) => (d / route.lengthM) * W;
    const y = (e: number) => PAD_TOP + (1 - (e - lo) / (span * 1.16)) * (H - PAD_TOP - PAD_BOTTOM);
    const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.d).toFixed(1)} ${y(p.e).toFixed(1)}`).join("");
    return { points, line, x, y, min, max };
  }, [route]);

  const { points, line, x, y } = geometry;
  const at = (d: number) => {
    const clamped = Math.min(route.lengthM, Math.max(0, d));
    let i = 0;
    while (i < points.length - 2 && points[i + 1]!.d < clamped) i++;
    const a = points[i]!;
    const b = points[i + 1]!;
    const t = b.d === a.d ? 0 : (clamped - a.d) / (b.d - a.d);
    return { px: x(clamped), py: y(a.e + (b.e - a.e) * t) };
  };

  const rider = positionM === undefined ? null : at(positionM);
  const ghost = ghostPositionM == null ? null : at(ghostPositionM);
  const clipId = `rd-clip-${route.id}`;

  const pct = (p: { px: number; py: number }) => ({ left: `${(p.px / W) * 100}%`, top: `${(p.py / H) * 100}%` });

  return (
    <div className={`rd-prof ${className ?? ""}`}>
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      {segments &&
        route.segments.map((seg) => (
          <rect
            key={seg.id}
            x={x(seg.startM)}
            y={0}
            width={x(seg.endM) - x(seg.startM)}
            height={H}
            className={seg.kind === "kom" ? "rd-prof-kom" : "rd-prof-sprint"}
          />
        ))}
      <path d={`${line}L${W} ${H}L0 ${H}Z`} className="rd-prof-area" />
      {rider && (
        <>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={rider.px} height={H} />
          </clipPath>
          <path d={`${line}L${W} ${H}L0 ${H}Z`} className="rd-prof-done" clipPath={`url(#${clipId})`} />
        </>
      )}
      <path d={line} className="rd-prof-line" vectorEffect="non-scaling-stroke" fill="none" />
      {ghost && <line x1={ghost.px} x2={ghost.px} y1={ghost.py} y2={H} className="rd-prof-ghost" vectorEffect="non-scaling-stroke" />}
      {rider && <line x1={rider.px} x2={rider.px} y1={rider.py} y2={H} className="rd-prof-rider-stem" vectorEffect="non-scaling-stroke" />}
    </svg>
      {otherPositionsM?.map((m, i) => (m >= 0 && m <= route.lengthM ? <i key={i} className="rd-prof-dot rd-prof-dot-bot" style={pct(at(m))} /> : null))}
      {ghost && <i className="rd-prof-dot rd-prof-dot-ghost" style={pct(ghost)} />}
      {rider && <i className="rd-prof-dot rd-prof-dot-rider" style={pct(rider)} />}
    </div>
  );
}
