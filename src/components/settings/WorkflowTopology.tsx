import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react';
import { cn } from '../../lib/utils';

// Workflow Topology (System Settings, admin only): an animated swimlane map
// of how an application moves through the system — who acts at each step,
// what status it ends in, and where the loops go back to. Static content that
// mirrors the server workflow (see .claude/skills/ciac-project/SKILL.md).

type LaneId = 'bdo2' | 'bdo1' | 'locator' | 'ao1' | 'ao2' | 'system';

const LANES: Record<LaneId, { label: string; sub: string; color: string }> = {
  bdo2: { label: 'BDO', sub: 'Level 2', color: '#3b82f6' },
  bdo1: { label: 'BDO', sub: 'Level 1', color: '#6366f1' },
  locator: { label: 'Locator', sub: 'Portal', color: '#f59e0b' },
  ao1: { label: 'Account Officer', sub: 'Level 1', color: '#10b981' },
  ao2: { label: 'Account Officer', sub: 'Level 2', color: '#14b8a6' },
  system: { label: 'System', sub: 'Automatic', color: '#94a3b8' },
};

type Step = {
  lane: LaneId;
  title: string;
  /** Short line under the title in the node. */
  status?: string;
  where: string;
  details: string[];
  notifies?: string;
  /** What the system does on its own at this step. */
  auto?: string[];
  /** Diagram column; defaults to the step's index. Two steps sharing a
   * column happen at the same time (e.g. assigning and uploading). */
  col?: number;
};

/** A way back. `local` loops are drawn straight between the two cards
 * (e.g. a rejected requirement going back to the locator); the others arc
 * below the lanes. */
type Loop = { from: number; to: number; label: string; local?: boolean };

type Scenario = {
  id: 'new' | 'renewal';
  label: string;
  lanes: LaneId[];
  steps: Step[];
  loops: Loop[];
  /** Forward arrows as [from, to]; defaults to each step → the next. */
  edges?: [number, number][];
};

const SCENARIOS: Scenario[] = [
  {
    id: 'new',
    label: 'New Locator',
    lanes: ['bdo2', 'bdo1', 'locator', 'ao1', 'ao2', 'system'],
    steps: [
      {
        lane: 'bdo2',
        title: 'Create locator + application',
        auto: ["Generates the application number (APP-year-…).", "Seeds the requirements checklist for the industry type and type of contract.", "Refuses a second application for the same locator.", "On submit: activates the locator’s login and emails a temporary password; emails them that the application was filed."],
        status: 'SUBMITTED',
        where: 'Locator Accounts',
        details: [
          'One step: login account, business profile and the application together.',
          'One application per locator — a second one is refused.',
          'Submitting activates the locator and emails their login.',
        ],
        notifies: 'BDO Level 1, the locator (email)',
      },
      {
        lane: 'bdo1',
        title: 'Assign evaluator',
        auto: ["Moves the stage to ASSIGNED.", "Shows the application to that Level 2 only — hidden from other Level 2s, in lists and notifications.", "Sends the evaluator a “New assignment” pop-up."],
        status: 'UNASSIGNED → ASSIGNED',
        where: 'Evaluation Queue',
        details: [
          'Level 1 sees every new application; Level 2 sees nothing until it is assigned to them.',
          'Only Level 2 BDO users are offered as evaluators.',
        ],
        notifies: 'The evaluator (pop-up)',
      },
      {
        lane: 'locator',
        title: 'Upload requirements',
        auto: ["Checks each file’s real type (not just its extension) and rejects anything else.", "A re-upload on a rejected requirement resets it to Pending.", "Tells the evaluator — “re-uploaded”, with the earlier rejection remarks."],
        status: 'Portal',
        where: 'Locator portal · My Applications',
        details: [
          'Uploads each requirement on the checklist; can reply on a requirement thread.',
          'Re-uploading a rejected requirement sets it back to Pending.',
        ],
        notifies: 'The evaluator ("uploaded" / "re-uploaded" with the rejection remarks)',
      },
      {
        lane: 'bdo2',
        title: 'Verify / reject documents',
        auto: ["Records the decision and remarks per requirement.", "Tells the locator when a requirement is rejected, so they can re-upload."],
        status: 'IN_REVIEW',
        where: 'Evaluation Queue · Compliance',
        details: ['Verify or reject each requirement, with remarks and a discussion thread with the locator.'],
        notifies: 'The locator, when a requirement is rejected',
      },
      {
        lane: 'bdo2',
        title: 'Submit review',
        auto: ["Moves the stage to FOR_RECOMMENDATION.", "Tells Level 1 the review is waiting."],
        status: 'FOR_RECOMMENDATION',
        where: 'Evaluation Queue · Recommendation',
        details: ['Summary only. Requirements still to follow can be noted in the remarks.'],
        notifies: 'BDO Level 1',
      },
      {
        lane: 'bdo1',
        title: 'For Approval → contract → Approve',
        auto: ["Starts the approval and assigns it to that Level 1.", "Saving the contract generates the contract number, renders the certificate PDF and creates the contract permit.", "Keeps Approve locked until the contract exists.", "On Approve: status APPROVED and the locator is emailed the decision. A new application is queued for an Account Officer; a renewal marks the old permit RENEWED."],
        status: 'FOR_APPROVAL → APPROVED',
        where: 'Evaluation Queue · approval panel',
        details: [
          'Clicking the row sends it For Approval and opens the approval panel.',
          'Compliance tab to review what the locator uploaded; Approval tab: save the contract, then Approve.',
          'Approve stays locked until the contract is saved. Saving it creates the contract permit.',
        ],
        notifies: 'Account Officer Level 1 (pop-up)',
      },
      {
        // The outcome of BDO Level 1's Approve, so it sits on their row.
        lane: 'bdo1',
        title: 'Approved Queue',
        auto: ["Lists approved new applications without an Account Officer, newest first.", "Tells Level 1 Account Officers it’s waiting."],
        status: 'Waiting for an Account Officer',
        where: 'Approved Queue',
        details: ['Newest approvals on top, until Level 1 Account Officer assigns a Level 2.'],
      },
      {
        lane: 'ao1',
        title: 'Assign Account Officer',
        auto: ["Sets the locator’s Account Officer and takes it off the Approved Queue.", "Sends the Level 2 Account Officer a “New locator assigned” pop-up."],
        status: 'Level 2 assigned',
        where: 'Approved Queue',
        details: ['Only Level 1 can assign. The Level 2 becomes the locator\'s Account Officer.'],
        notifies: 'The Level 2 Account Officer (pop-up)',
      },
      {
        lane: 'ao2',
        title: 'Registered Locator',
        auto: ["Adds the locator to Registered Locator (one row), with the lease term from the contract.", "Scopes it so a Level 2 Account Officer sees only their own locators.", "Counts the permit down to expiry; within a year it shows on Renewal Tracking and in Needs Attention."],
        status: 'One row per locator',
        where: 'Registered Locator',
        details: [
          'The locator now appears in Registered Locator; a Level 2 Account Officer sees only their own locators.',
          'The contract permit counts down to expiry — it shows on Renewal Tracking once expiring.',
        ],
      },
    ],
    loops: [
      { from: 3, to: 2, label: 'Rejected → re-upload', local: true },
      { from: 5, to: 3, label: 'Return to Evaluator' },
    ],
  },
  {
    id: 'renewal',
    label: 'Renewal',
    lanes: ['locator', 'ao1', 'ao2', 'system'],
    steps: [
      {
        lane: 'system',
        title: 'Permit expiring / expired',
        auto: ["Works out each permit’s status from its expiry date (Valid / Expiring within a year / Expired).", "Lists only expiring and expired permits on Renewal Tracking; flags them in Needs Attention."],
        status: 'EXPIRING · EXPIRED',
        where: 'Renewal Tracking',
        details: [
          'Renewal Tracking lists only expiring (within a year) and expired permits and contracts.',
          'They also show in the dashboard\'s Needs Attention.',
        ],
      },
      {
        lane: 'ao2',
        title: 'Renew (one confirmation)',
        auto: ["Generates the renewal number (REN-year-…).", "Copies the industry type and type of contract from the latest approved application; links the renewal to the permit.", "Seeds the renewal requirements checklist.", "Checks it’s the locator’s own Account Officer and that no renewal is already open.", "Assigns it straight to the locator’s Account Officer and emails the locator."],
        status: 'REN-… SUBMITTED',
        where: 'Renewal Tracking',
        details: [
          'Files and submits the renewal for that permit\'s locator — no form.',
          'Account Officers only; a Level 2 only for their own locators. One open renewal at a time.',
          'Goes straight to the locator\'s own Account Officer — no BDO, no assigning step.',
        ],
        notifies: 'The locator (email: renewal filed)',
      },
      {
        lane: 'locator',
        title: 'Upload renewal requirements',
        auto: ["Same file checks and re-upload handling as the first application.", "Tells the Account Officer."],
        status: 'Portal',
        where: 'Locator portal · My Applications',
        details: ['Same portal as the first application, with the renewal checklist.'],
        notifies: 'Their Account Officer',
      },
      {
        lane: 'ao2',
        title: 'Verify / reject, submit review',
        auto: ["Keeps the renewal away from the BDO (queues and notifications).", "On submit: stage FOR_RECOMMENDATION and tells Account Officer Level 1."],
        status: 'IN_REVIEW → FOR_RECOMMENDATION',
        where: 'Renewal Queue',
        details: ['Same review screen as the BDO\'s Evaluation Queue, scoped to renewals.'],
        notifies: 'Account Officer Level 1',
      },
      {
        lane: 'ao1',
        title: 'For Approval → contract → Approve',
        auto: ["Starts the approval and assigns it to that Level 1.", "Saving the contract generates the contract number, renders the certificate PDF and creates the contract permit.", "Keeps Approve locked until the contract exists.", "On Approve: status APPROVED and the locator is emailed the decision. A new application is queued for an Account Officer; a renewal marks the old permit RENEWED."],
        status: 'FOR_APPROVAL → APPROVED',
        where: 'Renewal Queue · approval panel',
        details: [
          'Same approval panel: Compliance review, save the new contract, Approve.',
          'Disapprove closes it; a new renewal can then be filed.',
        ],
      },
      {
        lane: 'system',
        title: 'Renewed',
        auto: ["Updates the locator’s Registered Locator row with the new contract and term.", "The old permit (marked RENEWED at approval) drops off Renewal Tracking.", "Does not send the renewal to the Approved Queue."],
        status: 'Old permit RENEWED · new VALID',
        where: 'Registered Locator · Renewal Tracking',
        details: [
          'The old contract permit becomes RENEWED and drops off Renewal Tracking.',
          'The locator keeps its one Registered Locator row, now with the new contract and term.',
          'The renewal does not go to the Approved Queue.',
        ],
      },
    ],
    loops: [
      { from: 3, to: 2, label: 'Rejected → re-upload', local: true },
      { from: 4, to: 3, label: 'Return to Evaluator' },
    ],
  },
];

// Diagram geometry (SVG user units).
const LABEL_W = 150;
const COL_W = 182;
const LANE_H = 100;
const NODE_W = 160;
const NODE_H = 70;
const PAD = 18;

const SPEEDS = { Slow: 4200, Normal: 2800, Fast: 1600 } as const;
type Speed = keyof typeof SPEEDS;

const colOf = (scn: Scenario, i: number) => scn.steps[i].col ?? i;
const edgesOf = (scn: Scenario): [number, number][] =>
  scn.edges ?? scn.steps.slice(0, -1).map((_, i) => [i, i + 1] as [number, number]);
/** The arrow the token travels into step `i` (from the previous step when there is one). */
const incomingEdge = (scn: Scenario, i: number) => {
  const into = edgesOf(scn).filter(([, to]) => to === i);
  return into.find(([from]) => from === i - 1) ?? into[0] ?? null;
};

function nodeCenter(scn: Scenario, i: number) {
  const laneIndex = scn.lanes.indexOf(scn.steps[i].lane);
  return { x: LABEL_W + PAD + colOf(scn, i) * COL_W + NODE_W / 2, y: laneIndex * LANE_H + LANE_H / 2 };
}

/** Orthogonal path from step a's right edge to step b's left edge. */
function edgePath(scn: Scenario, a: number, b: number) {
  const p = nodeCenter(scn, a);
  const q = nodeCenter(scn, b);
  const x1 = p.x + NODE_W / 2;
  const x2 = q.x - NODE_W / 2;
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${p.y} H ${mx} V ${q.y} H ${x2}`;
}

/** A local loop: from the side of `from`'s card, straight up/down to the
 * level of `to`, then into `to`'s right edge (just below the forward edge). */
function localLoopPath(scn: Scenario, loop: Loop) {
  const p = nodeCenter(scn, loop.from);
  const q = nodeCenter(scn, loop.to);
  const x = p.x - NODE_W / 2 + 22;
  const down = q.y > p.y;
  const y1 = down ? p.y + NODE_H / 2 : p.y - NODE_H / 2;
  const y2 = q.y + (down ? -12 : 12);
  return { d: `M ${x} ${y1} V ${y2} H ${q.x + NODE_W / 2}`, labelX: x - 6, labelY: (y1 + y2) / 2 };
}

/** Loop back from `from` to `to`, arcing below the lanes. */
function loopPath(scn: Scenario, loop: Loop, offset: number) {
  const p = nodeCenter(scn, loop.from);
  const q = nodeCenter(scn, loop.to);
  const bottom = scn.lanes.length * LANE_H + 14 + offset;
  return `M ${p.x} ${p.y + NODE_H / 2} V ${bottom} H ${q.x} V ${q.y + NODE_H / 2}`;
}

export function WorkflowTopology() {
  const [scenarioId, setScenarioId] = useState<Scenario['id']>('new');
  const scn = useMemo(() => SCENARIOS.find((s) => s.id === scenarioId)!, [scenarioId]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<Speed>('Normal');
  const reduceMotion =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    setStep(0);
  }, [scenarioId]);

  useEffect(() => {
    if (!playing) return;
    const t = window.setTimeout(() => setStep((s) => (s + 1) % scn.steps.length), SPEEDS[speed]);
    return () => window.clearTimeout(t);
  }, [playing, step, speed, scn.steps.length]);

  const cols = Math.max(...scn.steps.map((_, i) => colOf(scn, i))) + 1;
  const width = LABEL_W + PAD * 2 + cols * COL_W - (COL_W - NODE_W);
  const height = scn.lanes.length * LANE_H + 14 + scn.loops.filter((l) => !l.local).length * 22 + 20;
  const current = scn.steps[step];
  const lane = LANES[current.lane];

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="glass-card p-3 sm:p-4 !border-transparent flex flex-wrap items-center gap-2" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex rounded-full p-0.5" style={{ backgroundColor: 'var(--control-bg)' }}>
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setScenarioId(s.id)}
              className={cn('px-3 py-1.5 rounded-full text-[12px] font-semibold cursor-pointer transition-colors', scenarioId === s.id ? '' : 'text-secondary')}
              style={scenarioId === s.id ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' } : undefined}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <IconButton label="Previous step" onClick={() => { setPlaying(false); setStep((s) => (s - 1 + scn.steps.length) % scn.steps.length); }}>
            <ChevronLeft size={16} />
          </IconButton>
          <IconButton label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)} primary>
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </IconButton>
          <IconButton label="Next step" onClick={() => { setPlaying(false); setStep((s) => (s + 1) % scn.steps.length); }}>
            <ChevronRight size={16} />
          </IconButton>
          <IconButton label="Restart" onClick={() => { setStep(0); setPlaying(true); }}>
            <RotateCcw size={15} />
          </IconButton>
          <div className="flex rounded-full p-0.5 ml-1" style={{ backgroundColor: 'var(--control-bg)' }}>
            {(Object.keys(SPEEDS) as Speed[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={cn('px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer', speed === s ? '' : 'text-secondary')}
                style={speed === s ? { backgroundColor: 'var(--surface)', color: 'var(--text)' } : undefined}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Diagram */}
      <div className="glass-card p-3 sm:p-4 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="block"
            style={{ minWidth: Math.min(width, 980), width: '100%', height: 'auto' }}
            role="img"
            aria-label={`${scn.label} workflow: ${scn.steps.map((s) => s.title).join(', then ')}`}
          >
            <defs>
              {/* Card shadow: offset downward so the card looks lifted off the lane. */}
              <filter id="wf-card-shadow" x="-10%" y="-10%" width="120%" height="140%">
                <feDropShadow dx="0" dy="4" stdDeviation="3" floodColor="#0f172a" floodOpacity="0.16" />
              </filter>
              <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-muted, #94a3b8)" />
              </marker>
              <marker id="wf-arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text)" />
              </marker>
            </defs>

            {/* Lanes */}
            {scn.lanes.map((id, i) => (
              <g key={id}>
                <rect
                  x={0}
                  y={i * LANE_H + 3}
                  width={width}
                  height={LANE_H - 6}
                  rx={12}
                  fill={LANES[id].color}
                  fillOpacity={current.lane === id ? 0.12 : 0.05}
                  style={{ transition: 'fill-opacity .4s' }}
                />
                <rect x={10} y={i * LANE_H + LANE_H / 2 - 14} width={4} height={28} rx={2} fill={LANES[id].color} />
                <text x={22} y={i * LANE_H + LANE_H / 2 - 2} fontSize={13} fontWeight={700} fill="var(--text)">
                  {LANES[id].label}
                </text>
                <text x={22} y={i * LANE_H + LANE_H / 2 + 14} fontSize={11} fill="var(--text-muted, #94a3b8)">
                  {LANES[id].sub}
                </text>
              </g>
            ))}

            {/* Forward edges */}
            {edgesOf(scn).map(([from, to]) => {
              const done = to <= step && from < step;
              return (
                <path
                  key={`e${from}-${to}`}
                  d={edgePath(scn, from, to)}
                  fill="none"
                  stroke={done ? 'var(--text)' : 'var(--text-muted, #94a3b8)'}
                  strokeOpacity={done ? 0.85 : 0.45}
                  strokeWidth={done ? 2 : 1.5}
                  markerEnd={`url(#${done ? 'wf-arrow-active' : 'wf-arrow'})`}
                  style={{ transition: 'stroke .4s, stroke-opacity .4s' }}
                />
              );
            })}

            {/* Loops back */}
            {scn.loops.map((loop, idx) => {
              const active = step === loop.from;
              if (loop.local) {
                const { d, labelX, labelY } = localLoopPath(scn, loop);
                return (
                  <g key={`l${idx}`}>
                    <path
                      d={d}
                      fill="none"
                      stroke={active ? '#ef4444' : 'var(--text-muted, #94a3b8)'}
                      strokeOpacity={active ? 0.95 : 0.45}
                      strokeWidth={1.5}
                      strokeDasharray="5 5"
                      markerEnd="url(#wf-arrow)"
                      style={{ transition: 'stroke .4s' }}
                    >
                      {active && !reduceMotion ? (
                        <animate attributeName="stroke-dashoffset" from="20" to="0" dur="0.8s" repeatCount="indefinite" />
                      ) : null}
                    </path>
                    <text x={labelX} y={labelY} textAnchor="end" fontSize={10.5} fill={active ? '#ef4444' : 'var(--text-muted, #94a3b8)'}>
                      ↺ {loop.label}
                    </text>
                  </g>
                );
              }
              const k = scn.loops.filter((l) => !l.local).indexOf(loop);
              const d = loopPath(scn, loop, k * 22);
              const p = nodeCenter(scn, loop.to);
              const q = nodeCenter(scn, loop.from);
              const y = scn.lanes.length * LANE_H + 14 + k * 22;
              return (
                <g key={`l${idx}`}>
                  <path
                    d={d}
                    fill="none"
                    stroke={active ? '#f59e0b' : 'var(--text-muted, #94a3b8)'}
                    strokeOpacity={active ? 0.95 : 0.4}
                    strokeWidth={1.5}
                    strokeDasharray="5 5"
                    markerEnd="url(#wf-arrow)"
                    style={{ transition: 'stroke .4s' }}
                  >
                    {active && !reduceMotion ? (
                      <animate attributeName="stroke-dashoffset" from="20" to="0" dur="0.8s" repeatCount="indefinite" />
                    ) : null}
                  </path>
                  <text x={(p.x + q.x) / 2} y={y - 4} textAnchor="middle" fontSize={10.5} fill={active ? '#f59e0b' : 'var(--text-muted, #94a3b8)'}>
                    ↺ {loop.label}
                  </text>
                </g>
              );
            })}

            {/* Nodes */}
            {scn.steps.map((s, i) => {
              const c = nodeCenter(scn, i);
              const isCurrent = i === step;
              const done = i < step;
              const color = LANES[s.lane].color;
              return (
                <g
                  key={`n${i}`}
                  onClick={() => { setPlaying(false); setStep(i); }}
                  style={{ cursor: 'pointer' }}
                >
                  <rect
                    x={c.x - NODE_W / 2}
                    y={c.y - NODE_H / 2}
                    width={NODE_W}
                    height={NODE_H}
                    rx={0}
                    filter="url(#wf-card-shadow)"
                    fill="var(--surface)"
                    stroke={isCurrent || done ? color : 'var(--border-subtle, #cbd5e1)'}
                    strokeWidth={isCurrent ? 2 : 1.2}
                  />
                  <circle cx={c.x - NODE_W / 2 + 13} cy={c.y - NODE_H / 2 + 13} r={9} fill={done || isCurrent ? color : 'var(--control-bg)'} />
                  <text
                    x={c.x - NODE_W / 2 + 13}
                    y={c.y - NODE_H / 2 + 17}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={700}
                    fill={done || isCurrent ? '#fff' : 'var(--text-muted, #94a3b8)'}
                  >
                    {i + 1}
                  </text>
                  {/* HTML inside the card so the browser wraps/clamps the text
                      (SVG text doesn't wrap and was spilling out of the card). */}
                  <foreignObject
                    x={c.x - NODE_W / 2 + 26}
                    y={c.y - NODE_H / 2 + 5}
                    width={NODE_W - 32}
                    height={NODE_H - 10}
                    style={{ pointerEvents: 'none' }}
                  >
                    <div
                      style={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        fontFamily: 'inherit',
                      }}
                    >
                      <div
                        title={s.title}
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          lineHeight: '14px',
                          color: 'var(--text)',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          wordBreak: 'break-word',
                        }}
                      >
                        {s.title}
                      </div>
                      {s.status ? (
                        <div
                          title={s.status}
                          style={{
                            fontSize: 9.5,
                            fontWeight: 600,
                            lineHeight: '12px',
                            color,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {s.status}
                        </div>
                      ) : null}
                    </div>
                  </foreignObject>
                </g>
              );
            })}

            {/* System lane: a ⚙ chip under every step the system also acts on */}
            {scn.lanes.includes('system')
              ? scn.steps.map((st, i) => {
                  if (!st.auto?.length || st.lane === 'system') return null;
                  // Steps sharing a column (happening together) get their chips side by side.
                  const peers = scn.steps
                    .map((_, j) => j)
                    .filter((j) => colOf(scn, j) === colOf(scn, i) && scn.steps[j].auto?.length && scn.steps[j].lane !== 'system');
                  const cx = nodeCenter(scn, i).x + (peers.indexOf(i) - (peers.length - 1) / 2) * 66;
                  const cy = scn.lanes.indexOf('system') * LANE_H + LANE_H / 2;
                  const on = i === step;
                  return (
                    <g key={`auto${i}`} onClick={() => { setPlaying(false); setStep(i); }} style={{ cursor: 'pointer' }}>
                      <title>{`Step ${i + 1}: ${st.auto.length} automatic action${st.auto.length === 1 ? '' : 's'}`}</title>
                      <rect
                        x={cx - 30}
                        y={cy - 13}
                        width={60}
                        height={26}
                        rx={13}
                        fill={on ? LANES.system.color : 'var(--surface)'}
                        stroke={LANES.system.color}
                        strokeOpacity={on ? 1 : 0.6}
                        strokeDasharray={on ? undefined : '3 3'}
                        style={{ transition: 'fill .3s' }}
                      />
                      <text x={cx} y={cy + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={on ? '#fff' : 'var(--text)'}>
                        ⚙ {st.auto.length}
                      </text>
                    </g>
                  );
                })
              : null}

            {/* The moving token: travels the edge into the current step */}
            {incomingEdge(scn, step) ? (
              <circle key={`tok-${scenarioId}-${step}`} r={7} fill={lane.color} stroke="var(--surface)" strokeWidth={2}>
                <animateMotion
                  dur={reduceMotion ? '0.01s' : '1.1s'}
                  fill="freeze"
                  path={edgePath(scn, incomingEdge(scn, step)![0], incomingEdge(scn, step)![1])}
                />
              </circle>
            ) : (
              <circle
                key={`tok-${scenarioId}-start`}
                cx={nodeCenter(scn, 0).x - NODE_W / 2}
                cy={nodeCenter(scn, 0).y}
                r={7}
                fill={lane.color}
                stroke="var(--surface)"
                strokeWidth={2}
              />
            )}
          </svg>
        </div>
      </div>

      {/* Current step */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <motion.div
          key={`${scenarioId}-${step}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="glass-card p-4 !border-transparent lg:col-span-2 space-y-2"
          style={{ backgroundColor: 'var(--surface)' }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-widest text-secondary">
              Step {step + 1} of {scn.steps.length}
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: `color-mix(in oklab, ${lane.color} 16%, transparent)`, color: lane.color }}
            >
              {lane.label} · {lane.sub}
            </span>
          </div>
          <div className="text-[16px] font-bold" style={{ color: 'var(--text)' }}>{current.title}</div>
          {current.status ? (
            <div className="text-[12px]">
              <span className="text-secondary">Status: </span>
              <span className="font-semibold" style={{ color: 'var(--text)' }}>{current.status}</span>
            </div>
          ) : null}
          <div className="text-[12px]">
            <span className="text-secondary">Where: </span>
            <span className="font-semibold" style={{ color: 'var(--text)' }}>{current.where}</span>
          </div>
          <ul className="list-disc pl-5 space-y-1 text-[12.5px]" style={{ color: 'var(--text)' }}>
            {current.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          {current.notifies ? (
            <div className="text-[12px]">
              <span className="text-secondary">Notifies: </span>
              <span style={{ color: 'var(--text)' }}>{current.notifies}</span>
            </div>
          ) : null}
          {current.auto?.length ? (
            <div
              className="rounded-lg border px-3 py-2 mt-1"
              style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'color-mix(in oklab, #94a3b8 8%, transparent)' }}
            >
              <div className="text-[11px] font-bold uppercase tracking-widest text-secondary mb-1">⚙ System does automatically</div>
              <ul className="list-disc pl-5 space-y-0.5 text-[12px]" style={{ color: 'var(--text)' }}>
                {current.auto.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </motion.div>

        <div className="glass-card p-4 !border-transparent" style={{ backgroundColor: 'var(--surface)' }}>
          <div className="text-[11px] font-bold uppercase tracking-widest text-secondary mb-2">{scn.label} steps</div>
          <ol className="space-y-1">
            {scn.steps.map((s, i) => (
              <li key={s.title}>
                <button
                  type="button"
                  onClick={() => { setPlaying(false); setStep(i); }}
                  className="w-full text-left flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] cursor-pointer transition-colors"
                  style={i === step ? { backgroundColor: 'var(--control-bg)' } : undefined}
                >
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: LANES[s.lane].color, opacity: i <= step ? 1 : 0.35 }} />
                  <span className={cn('truncate', i === step ? 'font-semibold' : 'text-secondary')} style={i === step ? { color: 'var(--text)' } : undefined}>
                    {i + 1}. {s.title}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="mt-3 pt-3 border-t text-[11px] text-secondary space-y-1" style={{ borderColor: 'var(--border-subtle)' }}>
            {scn.loops.map((l) => (
              <div key={l.label}>
                <span style={{ color: '#f59e0b' }}>↺</span> {l.label}: step {l.from + 1} → step {l.to + 1}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  primary,
  children,
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="h-8 w-8 rounded-full flex items-center justify-center cursor-pointer transition-opacity hover:opacity-80"
      style={
        primary
          ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' }
          : { backgroundColor: 'var(--control-bg)', color: 'var(--text)' }
      }
    >
      {children}
    </button>
  );
}
