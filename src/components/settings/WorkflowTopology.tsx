import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  BadgeCheck,
  Briefcase,
  Building2,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Pause,
  Play,
  RotateCcw,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { cn } from '../../lib/utils';

// Workflow Topology (System Settings, admin only): an animated top-down map
// (network-topology style) of how an application moves through the system —
// who acts at each step, what status it ends in, what the system does on its
// own, and where the loops go back to. Static content that
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
        auto: ["Records the decision and remarks per requirement.", "Keeps Verify / Reject locked until the locator has uploaded a file.", "Tells the locator when a requirement is rejected, so they can re-upload."],
        status: 'IN_REVIEW',
        where: 'Evaluation Queue · Compliance',
        details: [
          'Verify or reject each uploaded requirement, with remarks and a discussion thread with the locator.',
          'Nothing to verify until the locator uploads it.',
        ],
        notifies: 'The locator, when a requirement is rejected',
      },
      {
        lane: 'bdo2',
        title: 'Submit review',
        auto: ["Blocks the submit while any uploaded requirement is still unchecked (Pending).", "Moves the stage to FOR_RECOMMENDATION.", "Tells Level 1 the review is waiting."],
        status: 'FOR_RECOMMENDATION',
        where: 'Evaluation Queue · Recommendation',
        details: [
          'Summary only. Every uploaded requirement must be verified or rejected first.',
          'Requirements still to follow (not uploaded yet) can be noted in the remarks.',
        ],
        notifies: 'BDO Level 1',
      },
      {
        lane: 'bdo1',
        title: 'For Approval → contract → Approve',
        auto: ["Starts the approval and assigns it to that Level 1.", "Saving the contract generates the contract number, renders the certificate PDF and creates the contract permit — hidden from the locator, Registered Locator and Renewal Tracking until approved.", "Keeps Approve locked until the contract exists; asks to confirm if mandatory requirements aren’t all verified (to follow).", "On Approve: status APPROVED; the locator is emailed the decision and now sees the contract and permit. A new application is queued for an Account Officer; a renewal marks the old permit RENEWED."],
        status: 'FOR_APPROVAL → APPROVED',
        where: 'Evaluation Queue · approval panel',
        details: [
          'Clicking the row sends it For Approval and opens the approval panel.',
          'Compliance tab to review what the locator uploaded; Approval tab: save the contract, then Approve.',
          'Approve stays locked until the contract is saved. Saving it creates the contract permit.',
          'The locator sees the contract only after Approve.',
          'Approving with mandatory requirements still unverified needs a confirmation (requirements to follow).',
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
          'The locator can still upload requirements that were to follow.',
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
          'Registered Locator shows "Renewal in process" until it\'s decided.',
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
        auto: ["Starts the approval and assigns it to that Level 1.", "Saving the contract generates the contract number, renders the certificate PDF and creates the contract permit — hidden from the locator, Registered Locator and Renewal Tracking until approved.", "Keeps Approve locked until the contract exists; asks to confirm if mandatory requirements aren’t all verified (to follow).", "On Approve: status APPROVED; the locator is emailed the decision and now sees the contract and permit. A new application is queued for an Account Officer; a renewal marks the old permit RENEWED."],
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
          'The locator keeps its one Registered Locator row, now with the new contract and term (only once approved).',
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

// Diagram geometry (SVG user units) — a top-down tree: the steps run down
// one spine, each step's automatic actions branch off to the right, and the
// loops back run up the left side.
const SPINE_X = 330;
const CARD_W = 260;
const CARD_H = 78;
const EDGE_H = 104; // the connector into a card (room for two pills)
const STEP_H = CARD_H + EDGE_H;
const START_R = 30;
const TOP = 12 + START_R * 2;
const AUTO_X = SPINE_X + CARD_W / 2 + 70; // centre of the "auto" bubbles
const AUTO_R = 27;
const LOOP_X = SPINE_X - CARD_W / 2 - 46; // first loop line; more go further left
const LOOP_GAP = 30;
const VIEW_W = AUTO_X + AUTO_R + 30;
const ACCENT = '#14b8a6';
// Not-yet-reached lines/pills and card edges — mixed from the muted text
// colour so they stay visible on both the light and dark surface.
const INACTIVE = 'color-mix(in oklab, var(--text-muted, #94a3b8) 45%, transparent)';

const SPEEDS = { Slow: 4200, Normal: 2800, Fast: 1600 } as const;
type Speed = keyof typeof SPEEDS;

const LANE_ICON: Record<LaneId, typeof Briefcase> = {
  bdo2: Briefcase,
  bdo1: Briefcase,
  locator: Building2,
  ao1: UserCheck,
  ao2: UserCheck,
  system: Cpu,
};

const cardTop = (i: number) => TOP + EDGE_H + i * STEP_H;
const cardBottom = (i: number) => cardTop(i) + CARD_H;

/** Rough label width (SVG text isn't measured) for the pill behind it. */
const pillWidth = (text: string, fontSize = 11) =>
  Math.round([...text].reduce((w, ch) => w + (/[A-Z_]/.test(ch) ? 0.7 : 0.55), 0) * fontSize) + 22;

function Pill({ x, y, text, on, color = ACCENT }: { x: number; y: number; text: string; on: boolean; color?: string }) {
  const w = pillWidth(text);
  return (
    <g>
      <rect
        x={x - w / 2}
        y={y - 10}
        width={w}
        height={20}
        rx={10}
        fill="var(--surface)"
        stroke={on ? color : INACTIVE}
        strokeWidth={1.5}
        style={{ transition: 'stroke .4s' }}
      />
      <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill={on ? 'var(--text)' : 'var(--text-muted, #94a3b8)'}>
        {text}
      </text>
    </g>
  );
}

/** Dots flowing along a line toward where it leads (like traffic on a
 * network map). Static at the start of the line when motion is reduced. */
function FlowDots({ path, reduceMotion, count = 2, dur = 1.8 }: { path: string; reduceMotion: boolean; count?: number; dur?: number }) {
  if (reduceMotion) return null;
  return (
    <g style={{ pointerEvents: 'none' }}>
      {Array.from({ length: count }).map((_, k) => (
        <circle key={k} r={3.5} fill={ACCENT} stroke="var(--surface)" strokeWidth={1.5}>
          <animateMotion dur={`${dur}s`} begin={`${(-dur * k) / count}s`} repeatCount="indefinite" path={path} />
        </circle>
      ))}
    </g>
  );
}

export function WorkflowTopology() {
  const [scenarioId, setScenarioId] = useState<Scenario['id']>('new');
  const scn = useMemo(() => SCENARIOS.find((s) => s.id === scenarioId)!, [scenarioId]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<Speed>('Normal');
  const reduceMotion =
    typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    setStep(0);
  }, [scenarioId]);

  useEffect(() => {
    if (!playing) return;
    const t = window.setTimeout(() => setStep((s) => (s + 1) % scn.steps.length), SPEEDS[speed]);
    return () => window.clearTimeout(t);
  }, [playing, step, speed, scn.steps.length]);

  const n = scn.steps.length;
  const height = cardBottom(n - 1) + 24;
  const current = scn.steps[step];
  const lane = LANES[current.lane];
  const go = (i: number) => {
    setPlaying(false);
    setStep(i);
  };
  const StartIcon = scenarioId === 'renewal' ? CalendarClock : UserPlus;

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
          <IconButton label="Previous step" onClick={() => go((step - 1 + n) % n)}>
            <ChevronLeft size={16} />
          </IconButton>
          <IconButton label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)} primary>
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </IconButton>
          <IconButton label="Next step" onClick={() => go((step + 1) % n)}>
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

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,640px)_minmax(0,1fr)] gap-4 items-start">
        {/* Diagram — on the page background so the borderless cards float. */}
        <div className="glass-card p-3 sm:p-4 !border-transparent" style={{ backgroundColor: 'var(--background)' }}>
          <svg
            viewBox={`0 0 ${VIEW_W} ${height}`}
            className="block mx-auto"
            style={{ width: '100%', maxWidth: VIEW_W, height: 'auto' }}
            role="img"
            aria-label={`${scn.label} workflow: ${scn.steps.map((s) => s.title).join(', then ')}`}
          >
            <defs>
              {/* Soft blur for the shadow shapes drawn under cards and bubbles. */}
              <filter id="wf-float" x="-30%" y="-100%" width="160%" height="300%">
                <feGaussianBlur stdDeviation="5" />
              </filter>
              <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-muted, #94a3b8)" />
              </marker>
              <marker id="wf-arrow-loop" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" />
              </marker>
            </defs>

            {/* Start node */}
            <g onClick={() => go(0)} style={{ cursor: 'pointer' }}>
              <circle cx={SPINE_X} cy={12 + START_R} r={START_R} fill={ACCENT} />
              <foreignObject x={SPINE_X - 14} y={12 + START_R - 14} width={28} height={28} style={{ pointerEvents: 'none' }}>
                <StartIcon size={28} color="#fff" strokeWidth={1.8} />
              </foreignObject>
              <circle cx={SPINE_X + START_R * 0.72} cy={12 + START_R * 1.72} r={10} fill="var(--surface)" />
              <foreignObject x={SPINE_X + START_R * 0.72 - 9} y={12 + START_R * 1.72 - 9} width={18} height={18} style={{ pointerEvents: 'none' }}>
                <BadgeCheck size={18} color={ACCENT} fill="var(--surface)" />
              </foreignObject>
            </g>

            {/* Connectors into each card, with who acts and the status as pills */}
            {scn.steps.map((st, i) => {
              const y1 = i === 0 ? TOP : cardBottom(i - 1);
              const y2 = cardTop(i);
              const reached = i <= step;
              const color = LANES[st.lane].color;
              const laneText = `${LANES[st.lane].label}${st.lane === 'system' ? '' : ` · ${LANES[st.lane].sub.replace('Level ', 'L')}`}`;
              return (
                <g key={`edge-${i}`}>
                  <line
                    x1={SPINE_X}
                    y1={y1}
                    x2={SPINE_X}
                    y2={y2}
                    stroke={reached ? ACCENT : INACTIVE}
                    strokeWidth={2}
                    style={{ transition: 'stroke .4s' }}
                  />
                  {reached ? <FlowDots path={`M ${SPINE_X} ${y1} V ${y2}`} reduceMotion={reduceMotion} /> : null}
                  <Pill x={SPINE_X} y={y1 + (y2 - y1) / 2 - 12} text={laneText} on={i === step} color={color} />
                  {st.status ? (
                    <Pill x={SPINE_X} y={y1 + (y2 - y1) / 2 + 14} text={st.status} on={i === step} color={color} />
                  ) : null}
                </g>
              );
            })}

            {/* Each step's automatic actions: a bubble branching off to the right */}
            {scn.steps.map((st, i) => {
              if (!st.auto?.length) return null;
              // Branches off the connector into this step, beside its pills.
              const top = i === 0 ? TOP : cardBottom(i - 1);
              const by = top + 18;
              const cy = top + EDGE_H / 2 + 8;
              const on = i === step;
              return (
                <g key={`auto-${i}`} onClick={() => go(i)} style={{ cursor: 'pointer' }}>
                  <title>{`Step ${i + 1}: ${st.auto.length} automatic action${st.auto.length === 1 ? '' : 's'}`}</title>
                  <path
                    d={`M ${SPINE_X} ${by} H ${AUTO_X} V ${cy - AUTO_R}`}
                    fill="none"
                    stroke={on || i < step ? ACCENT : INACTIVE}
                    strokeWidth={2}
                    style={{ transition: 'stroke .4s' }}
                  />
                  {on || i < step ? (
                    <FlowDots path={`M ${SPINE_X} ${by} H ${AUTO_X} V ${cy - AUTO_R}`} reduceMotion={reduceMotion} dur={2.2} />
                  ) : (
                    <>
                      <circle cx={SPINE_X} cy={by} r={3.5} fill={INACTIVE} />
                      <circle cx={AUTO_X} cy={by} r={3.5} fill={INACTIVE} />
                    </>
                  )}
                  {/* Floating: no border, a shadow under the bottom only. */}
                  <ellipse
                    cx={AUTO_X}
                    cy={cy + AUTO_R - 2}
                    rx={AUTO_R * 0.8}
                    ry={5}
                    fill={on ? ACCENT : '#0f172a'}
                    opacity={on ? 0.45 : 0.22}
                    filter="url(#wf-float)"
                  />
                  <circle cx={AUTO_X} cy={cy} r={AUTO_R} fill="var(--surface)" />
                  <foreignObject x={AUTO_X - 18} y={cy - 15} width={36} height={18} style={{ pointerEvents: 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, color: 'var(--text)', fontSize: 11, fontWeight: 700 }}>
                      <Cpu size={13} />
                      {st.auto.length}
                    </div>
                  </foreignObject>
                  <text x={AUTO_X} y={cy + 13} textAnchor="middle" fontSize={9.5} fill="var(--text-muted, #94a3b8)">
                    Auto
                  </text>
                </g>
              );
            })}

            {/* Loops back: dashed, up the left side */}
            {scn.loops.map((loop, k) => {
              const x = LOOP_X - k * LOOP_GAP;
              const yFrom = cardTop(loop.from) + CARD_H / 2;
              const yTo = cardTop(loop.to) + CARD_H / 2 + (k % 2 ? -10 : 10);
              const left = SPINE_X - CARD_W / 2;
              const active = step === loop.from;
              const text = `↺ ${loop.label}`;
              const w = pillWidth(text, 10.5);
              const midY = (yFrom + yTo) / 2;
              return (
                <g key={`loop-${k}`}>
                  <path
                    d={`M ${left} ${yFrom} H ${x} V ${yTo} H ${left}`}
                    fill="none"
                    stroke={active ? '#f59e0b' : 'var(--text-muted, #94a3b8)'}
                    strokeOpacity={active ? 1 : 0.5}
                    strokeWidth={1.5}
                    strokeDasharray="5 5"
                    markerEnd={`url(#${active ? 'wf-arrow-loop' : 'wf-arrow'})`}
                    style={{ transition: 'stroke .4s' }}
                  >
                    {active && !reduceMotion ? (
                      <animate attributeName="stroke-dashoffset" from="20" to="0" dur="0.8s" repeatCount="indefinite" />
                    ) : null}
                  </path>
                  {/* Vertical pill on the line so it fits the narrow margin. */}
                  <g transform={`rotate(-90 ${x} ${midY})`}>
                    <rect
                      x={x - w / 2}
                      y={midY - 9}
                      width={w}
                      height={18}
                      rx={9}
                      fill="var(--surface)"
                      stroke={active ? '#f59e0b' : INACTIVE}
                    />
                    <text x={x} y={midY + 4} textAnchor="middle" fontSize={10.5} fontWeight={600} fill={active ? '#f59e0b' : 'var(--text-muted, #94a3b8)'}>
                      {text}
                    </text>
                  </g>
                </g>
              );
            })}

            {/* Step cards */}
            {scn.steps.map((st, i) => {
              const y = cardTop(i);
              const x = SPINE_X - CARD_W / 2;
              const isCurrent = i === step;
              const done = i < step;
              const color = LANES[st.lane].color;
              const Icon = LANE_ICON[st.lane];
              return (
                <g key={`card-${i}`} onClick={() => go(i)} style={{ cursor: 'pointer' }}>
                  {/* Floating: no border, a shadow under the bottom only (tinted
                      with the lane colour on the current step). */}
                  <rect
                    x={x + 12}
                    y={y + CARD_H - 12}
                    width={CARD_W - 24}
                    height={14}
                    rx={7}
                    fill={isCurrent ? color : '#0f172a'}
                    opacity={isCurrent ? 0.5 : 0.2}
                    filter="url(#wf-float)"
                    style={{ transition: 'fill .4s, opacity .4s' }}
                  />
                  <rect x={x} y={y} width={CARD_W} height={CARD_H} rx={6} fill="var(--surface)" />
                  <foreignObject x={x} y={y} width={CARD_W} height={CARD_H} style={{ pointerEvents: 'none' }}>
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px', fontFamily: 'inherit' }}>
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          flexShrink: 0,
                          borderRadius: 8,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`,
                          color,
                        }}
                      >
                        <Icon size={22} />
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                          <span
                            style={{
                              width: 7,
                              height: 7,
                              marginTop: 5,
                              borderRadius: 999,
                              flexShrink: 0,
                              backgroundColor: done || isCurrent ? ACCENT : INACTIVE,
                            }}
                          />
                          <span
                            title={st.title}
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              lineHeight: '16px',
                              color: 'var(--text)',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                              wordBreak: 'break-word',
                            }}
                          >
                            {st.title}
                          </span>
                        </div>
                        <div
                          title={st.where}
                          style={{
                            marginTop: 4,
                            fontSize: 11,
                            lineHeight: '14px',
                            color: 'var(--text-muted, #94a3b8)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {st.where}
                        </div>
                      </div>
                    </div>
                  </foreignObject>
                  {/* Step number, like the badge on a device card */}
                  <circle cx={x + CARD_W - 12} cy={y + 12} r={9} fill={done || isCurrent ? color : 'var(--control-bg)'} />
                  <text x={x + CARD_W - 12} y={y + 15.5} textAnchor="middle" fontSize={10} fontWeight={700} fill={done || isCurrent ? '#fff' : 'var(--text-muted, #94a3b8)'}>
                    {i + 1}
                  </text>
                </g>
              );
            })}

            {/* The moving token: travels down the connector into the current step */}
            <circle key={`tok-${scenarioId}-${step}`} r={6} fill={lane.color} stroke="var(--surface)" strokeWidth={2}>
              <animateMotion
                dur={reduceMotion ? '0.01s' : '1s'}
                fill="freeze"
                path={`M ${SPINE_X} ${step === 0 ? TOP : cardBottom(step - 1)} V ${cardTop(step) - 6}`}
              />
            </circle>
          </svg>
        </div>

        {/* Current step + all steps (sticky beside the tall diagram) */}
        <div className="space-y-4 lg:sticky lg:top-4">
          <motion.div
            key={`${scenarioId}-${step}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="glass-card p-4 !border-transparent space-y-2"
            style={{ backgroundColor: 'var(--surface)' }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-widest text-secondary">
                Step {step + 1} of {n}
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
                    onClick={() => go(i)}
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
