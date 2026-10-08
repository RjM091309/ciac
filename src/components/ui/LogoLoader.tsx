import React, { useEffect, useRef, useState } from 'react';

// Animated CIAC logo, shown once right after signing in while the dashboard
// loads behind it. The real logo PNG is drawn in pieces, each revealed by its
// own mask (coordinates are the PNG's own pixels, 678×624), so the finished
// frame is exactly the logo:
//   1. the frame draws itself, 2. the four towers rise one by one,
//   3. the swoosh is drawn from its tail up, with the plane riding the head
//      of the line — always pointing the way it sits in the logo (no turning
//      or wobble) — and carrying straight on into its place. Line and plane
//      share one timer, so they stay together.

const LOGO = '/images/ciac-logo-only.png';
const W = 678;
const H = 624;
/** How long the overlay stays (ms) before it fades out. */
export const LOGO_LOADER_MS = 2600;

// Each tower's column (x range, top) — bottoms all sit at y≈550.
const TOWERS = [
  { x: 262, w: 92, top: 250 },
  { x: 345, w: 86, top: 180 },
  { x: 438, w: 90, top: 180 },
  { x: 516, w: 92, top: 250 },
];

// Swoosh centreline, bottom tail → up towards the plane.
const SWOOSH =
  'M 146 622 C 70 600, 30 560, 33 505 C 36 430, 120 330, 240 245 C 320 190, 410 140, 495 100';
// The plane's flight: the swoosh, then straight on to where the plane sits.
const FLIGHT = `${SWOOSH} L 590 25`;
// A point on the plane's body in the PNG — the spot that rides the line.
const PLANE_X = 590;
const PLANE_Y = 25;
// Zone around the swoosh where it cuts through the frame (the white tear is
// wider than the line and not centred on it, hence generous).
const GAP_W = 90;
// The frame's band (stroke centreline + width) in the PNG.
const BAND = { x: 208, y: 91, width: 452, height: 502, stroke: 26 };
const SWOOSH_START_MS = 850;
const SWOOSH_MS = 1050;
// The plane appears once the line is heading up-and-right, the way the plane
// points (along the tail it would be flying sideways).
const PLANE_FADE_IN: [number, number] = [0.45, 0.58];

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);


export function LogoLoader({ onDone }: { onDone?: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const reduceMotion =
    typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  // Latest callback in a ref: the timers start once, however often the
  // parent re-renders (a new inline onDone would otherwise restart them).
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const swooshRef = useRef<SVGPathElement | null>(null);
  const tearRef = useRef<SVGPathElement | null>(null);
  const flightRef = useRef<SVGPathElement | null>(null);
  const planeRef = useRef<SVGGElement | null>(null);

  // Swoosh + plane, frame by frame from one clock.
  useEffect(() => {
    const swoosh = swooshRef.current;
    const tear = tearRef.current;
    const flight = flightRef.current;
    const plane = planeRef.current;
    if (!swoosh || !tear || !flight || !plane) return;
    const swooshLen = swoosh.getTotalLength();
    const flightLen = flight.getTotalLength();
    swoosh.style.strokeDasharray = `${swooshLen}`;
    tear.style.strokeDasharray = `${swooshLen}`;

    const place = (progress: number) => {
      const d = progress * flightLen;
      const drawn = `${swooshLen - Math.min(d, swooshLen)}`;
      swoosh.style.strokeDashoffset = drawn;
      // The frame tears open right behind the plane, as the line passes.
      tear.style.strokeDashoffset = drawn;
      // Moves with the head of the line; never rotates.
      const at = flight.getPointAtLength(d);
      plane.setAttribute('transform', `translate(${at.x - PLANE_X} ${at.y - PLANE_Y})`);
      const [from, to] = PLANE_FADE_IN;
      plane.style.opacity = String(Math.min(1, Math.max(0, (progress - from) / (to - from))));
    };

    if (reduceMotion) {
      place(1);
      return;
    }
    place(0);
    const startAt = performance.now() + SWOOSH_START_MS;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - startAt) / SWOOSH_MS));
      place(easeInOut(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduceMotion]);

  useEffect(() => {
    const total = reduceMotion ? 600 : LOGO_LOADER_MS;
    const fade = window.setTimeout(() => setLeaving(true), total - 350);
    const done = window.setTimeout(() => onDoneRef.current?.(), total);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [reduceMotion]);

  return (
    <div
      className={`logo-loader fixed inset-0 z-[200] flex flex-col items-center justify-center gap-5 ${reduceMotion ? 'logo-loader-static' : ''}`}
      style={{
        backgroundColor: 'var(--background)',
        opacity: leaving ? 0 : 1,
        transition: 'opacity 350ms ease-out',
        pointerEvents: leaving ? 'none' : 'auto',
      }}
      role="status"
      aria-label="Loading"
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-32 h-auto sm:w-36" aria-hidden>
        <defs>
          {/* 1. Frame: a thick stroke around the square, drawn on. */}
          <mask id="ll-frame" maskUnits="userSpaceOnUse">
            <rect
              className="ll-draw ll-frame"
              x={208}
              y={91}
              width={452}
              height={502}
              fill="none"
              stroke="#fff"
              strokeWidth={44}
              pathLength={1}
            />
            {/* …minus where the swoosh crosses it (the patch below fills that in
                until the line tears through). */}
            <path d={SWOOSH} fill="none" stroke="#000" strokeWidth={GAP_W} strokeLinecap="round" />
            {/* The thin end of the swoosh above the frame comes with the plane. */}
            <rect x={478} y={0} width={200} height={74} fill="#000" />
          </mask>
          {/* Same frame draw-on, for the patch. */}
          <mask id="ll-framedraw" maskUnits="userSpaceOnUse">
            <rect
              className="ll-draw"
              x={BAND.x}
              y={BAND.y}
              width={BAND.width}
              height={BAND.height}
              fill="none"
              stroke="#fff"
              strokeWidth={44}
              pathLength={1}
            />
          </mask>
          {/* Patch: solid frame where the swoosh will cut it, erased along the
              line as it's drawn — so the white tear opens with the plane. */}
          <mask id="ll-patch" maskUnits="userSpaceOnUse">
            {/* A little wider than the hole in the frame, so no seam shows. */}
            <path d={SWOOSH} fill="none" stroke="#fff" strokeWidth={GAP_W + 12} strokeLinecap="round" />
            <path
              ref={tearRef}
              d={SWOOSH}
              fill="none"
              stroke="#000"
              strokeWidth={GAP_W + 40}
              strokeLinecap="round"
              style={{ strokeDasharray: 4000, strokeDashoffset: 4000 }}
            />
          </mask>
          {/* 2. Towers: each column grows up from the base. */}
          {TOWERS.map((t, i) => (
            <mask key={i} id={`ll-tower-${i}`} maskUnits="userSpaceOnUse">
              <rect
                className="ll-rise"
                style={{ animationDelay: `${350 + i * 130}ms` }}
                x={t.x}
                y={t.top}
                width={t.w}
                height={556 - t.top}
                fill="#fff"
              />
              {/* The swoosh passes over the tall towers' columns — it shows with the swoosh. */}
              <path d={SWOOSH} fill="none" stroke="#000" strokeWidth={70} strokeLinecap="round" />
            </mask>
          ))}
          {/* 3. Swoosh: a wide stroke along its centreline, drawn bottom → top. */}
          <mask id="ll-swoosh" maskUnits="userSpaceOnUse">
            <path
              ref={swooshRef}
              d={SWOOSH}
              fill="none"
              stroke="#fff"
              // At least the frame's cut-out zone, so everything hidden there comes back.
              strokeWidth={GAP_W + 16}
              strokeLinecap="round"
              // Hidden until the first frame sets the real lengths.
              style={{ strokeDasharray: 4000, strokeDashoffset: 4000 }}
            />
          </mask>
          {/* 4. Plane (top-right corner of the PNG). */}
          <mask id="ll-plane" maskUnits="userSpaceOnUse">
            {/* …with the thin end of the swoosh just under it (above the frame). */}
            <rect x={478} y={0} width={200} height={74} fill="#fff" />
          </mask>
        </defs>

        <image className="ll-logo" href={LOGO} width={W} height={H} mask="url(#ll-frame)" />
        <g mask="url(#ll-framedraw)">
          <rect
            className="ll-logo"
            x={BAND.x}
            y={BAND.y}
            width={BAND.width}
            height={BAND.height}
            fill="none"
            stroke="#000"
            strokeWidth={BAND.stroke}
            mask="url(#ll-patch)"
          />
        </g>
        {TOWERS.map((_, i) => (
          <image key={i} className="ll-logo" href={LOGO} width={W} height={H} mask={`url(#ll-tower-${i})`} />
        ))}
        <image className="ll-logo" href={LOGO} width={W} height={H} mask="url(#ll-swoosh)" />
        {/* Not drawn — only measured, for the plane's path. */}
        <path ref={flightRef} d={FLIGHT} fill="none" stroke="none" />
        <g ref={planeRef} style={{ opacity: 0 }}>
          <image className="ll-logo" href={LOGO} width={W} height={H} mask="url(#ll-plane)" />
        </g>
      </svg>
      <div className="ll-dots flex gap-1.5" aria-hidden>
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
