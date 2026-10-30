import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  BadgeCheck,
  Briefcase,
  Building2,
  CalendarClock,
  ChevronLeft,
  ShieldCheck,
  ChevronRight,
  Cpu,
  Pause,
  Play,
  RotateCcw,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { cn } from '../../lib/utils';

// Workflow Topology (System Settings; shown to the roles given it in Control
// Panel): an animated top-down map
// (network-topology style) of how an application moves through the system —
// who acts at each step, what status it ends in, what the system does on its
// own, and where the loops go back to. Static content that
// mirrors the server workflow (see .claude/skills/ciac-project/SKILL.md).

type LaneId = 'bdo2' | 'bdo1' | 'locator' | 'ao1' | 'ao2' | 'co' | 'system';

const LANES: Record<LaneId, { label: string; sub: string; color: string }> = {
  bdo2: { label: 'BDO', sub: '', color: '#3b82f6' },
  bdo1: { label: 'BDO', sub: 'Manager', color: '#6366f1' },
  locator: { label: 'Locator', sub: 'Portal', color: '#f59e0b' },
  ao1: { label: 'Account Officer', sub: 'Manager', color: '#10b981' },
  ao2: { label: 'Account Officer', sub: '', color: '#14b8a6' },
  co: { label: 'Compliance Officer', sub: 'Inspections', color: '#f43f5e' },
  system: { label: 'System', sub: 'Automatic', color: '#94a3b8' },
};

/** "BDO", "BDO - MANAGER", "Locator · Portal". */
function laneTitle(lane: { label: string; sub: string }) {
  if (!lane.sub) return lane.label;
  return lane.sub === 'Manager' ? `${lane.label.toUpperCase()} - MANAGER` : `${lane.label} · ${lane.sub}`;
}

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
  id: 'new' | 'renewal' | 'compliance';
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
        auto: ["Generates the application number (NEW-year-…; older ones are APP-year-…).", "Seeds the requirements checklist for the industry type and type of contract.", "Refuses a second application for the same locator.", "On submit: activates the locator’s login and emails a temporary password; emails them that the application was filed."],
        status: 'SUBMITTED',
        where: 'Proponent Accounts',
        details: [
          'One step: login account, business profile and the application together.',
          'One application per locator — a second one is refused.',
          'Submitting activates the locator and emails their login.',
        ],
        notifies: 'BDO - MANAGER, the locator (email)',
      },
      {
        lane: 'bdo1',
        title: 'Assign evaluator',
        auto: ["Moves the stage to ASSIGNED.", "Shows the application to that evaluator only — hidden from the other BDOs, in lists and notifications.", "Sends the evaluator a “New assignment” pop-up.", "When the evaluator opens it, the stage moves to IN_REVIEW and the locator sees “In review”."],
        status: 'UNASSIGNED → ASSIGNED',
        where: 'Evaluation Queue',
        details: [
          'The Manager sees every new application; a BDO sees nothing until it is assigned to them.',
          'Only BDO users (not the Manager) are offered as evaluators.',
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
        title: 'Encode proponent information',
        auto: [
          "Saves to the locator's own record — the same details show on Registered Locator once it's approved (nothing is re-typed).",
          'Only the assigned evaluator can edit, while the review is open; the Manager sees it read-only.',
          'Locked once the review is submitted.',
        ],
        status: 'IN_REVIEW',
        where: 'Evaluation Queue · Proponent Information / Performance Commitment / Stockholders / GIS',
        details: [
          'Proponent Information: business name, principal and lease address, location, land use, proposed lease term, contact no., business activities, contact person and authorized signatory.',
          'Performance Commitment: the investment and number of employees committed. The Actual figures are the Account Officer’s once it’s a Registered Locator.',
          'Stockholders / GIS: the stockholders and the SEC registration details (capital, purposes, SEC contact person, latest GIS filing). The Ref. Code is set later on Registered Locator; the GIS file itself stays a Compliance document.',
        ],
      },
      {
        lane: 'bdo2',
        title: 'Verify / reject documents',
        auto: ["Records the decision and remarks per requirement.", "Keeps Verify / Reject locked until the locator has uploaded a file.", "Tells the locator when a requirement is rejected, so they can re-upload."],
        status: 'IN_REVIEW',
        where: 'Evaluation Queue · Compliance',
        details: [
          'Verify or reject each uploaded requirement, with remarks and a discussion thread with the locator.',
          'The terms can be negotiated while documents are still coming in.',
        ],
        notifies: 'The locator, when a requirement is rejected',
      },
      {
        lane: 'bdo2',
        title: 'Terms & conditions → send',
        auto: ["Saves the terms as a draft the locator can't see yet.", "On Send: version 1, 2, … each time; emails and notifies the locator.", "Editing terms already sent or agreed puts them back to draft — they must be sent and agreed again."],
        status: 'Terms SENT',
        where: 'Evaluation Queue · Terms',
        details: [
          'The evaluator writes the terms and conditions negotiated with the locator, then sends them.',
          'The locator needs a portal login to see them.',
        ],
        notifies: 'The locator (email + in-app)',
      },
      {
        lane: 'locator',
        title: 'Agree to the terms',
        auto: ["Records the answer and the version agreed to.", "Emails and notifies the evaluator: agreed → make the contract; changes → their remarks."],
        status: 'AGREED · or changes requested',
        where: 'Locator portal · My Applications · Terms',
        details: [
          'The locator reads the terms and clicks I agree, or Request changes with remarks.',
          'Only agreed terms unlock the contract.',
        ],
        notifies: 'The evaluator (email + in-app)',
      },
      {
        lane: 'bdo2',
        title: 'Contract: record → print → sign → upload',
        auto: ["Generates the contract number and renders the contract PDF; creates the contract permit — hidden from the locator until approved.", "Open contract package: one PDF with the contract, the agreed terms, an attachments list and every requirement the locator uploaded.", "Locks the terms once the contract is recorded.", "Accepts only a file uploaded to this same application as the signed copy."],
        status: 'Signed contract uploaded',
        where: 'Evaluation Queue · Contract',
        details: [
          'Record the contract (effective dates), open the package and print it.',
          'Have it signed, scan it to PDF and upload the signed copy.',
        ],
      },
      {
        lane: 'bdo2',
        title: 'Submit review',
        auto: ["Blocks the submit until every uploaded requirement is checked and the signed contract is uploaded.", "Moves the stage to FOR_RECOMMENDATION.", "Tells the Manager the review is waiting."],
        status: 'FOR_RECOMMENDATION',
        where: 'Evaluation Queue · Recommendation',
        details: [
          'Summary of the review; the signed contract goes to the Manager with it.',
          'Requirements still to follow (not uploaded yet) can be noted in the remarks.',
        ],
        notifies: 'BDO - MANAGER',
      },
      {
        lane: 'bdo1',
        title: 'Check → Approve',
        auto: ["Starts the approval and assigns it to that Manager.", "Keeps Approve locked until the signed contract is there; asks to confirm if mandatory requirements aren’t all verified (to follow).", "On Approve: status APPROVED; the locator is emailed the decision and now sees the contract and permit. A new application goes to the Approved Queue."],
        status: 'FOR_APPROVAL → APPROVED',
        where: 'Evaluation Queue · approval panel',
        details: [
          'Clicking the row sends it For Approval and opens the approval panel.',
          'The Manager checks the uploads, the terms and the signed contract (read-only), then Approves.',
          'Something wrong: Return to Evaluator sends it back to the evaluator with remarks.',
        ],
        notifies: 'ACCOUNT OFFICER - MANAGER (pop-up + email)',
      },
      {
        // The outcome of BDO Level 1's Approve, so it sits on their row.
        lane: 'bdo1',
        title: 'Approved Queue',
        auto: ["Lists approved new applications without an Account Officer, newest first.", "Tells ACCOUNT OFFICER - MANAGERS it’s waiting (pop-up + email)."],
        status: 'Waiting for an Account Officer',
        where: 'Approved Queue',
        details: ['Newest approvals on top, until the ACCOUNT OFFICER - MANAGER assigns an Account Officer.'],
      },
      {
        lane: 'ao1',
        title: 'Assign Account Officer',
        auto: ["Sets the locator’s Account Officer and takes it off the Approved Queue.", "Sends the Account Officer a “New locator assigned” pop-up and email."],
        status: 'Account Officer assigned',
        where: 'Approved Queue',
        details: ['Only the Manager can assign. The Account Officer becomes the locator\'s Account Officer.', 'Reassigning later (Registered Locator) emails both the new and the previous officer.'],
        notifies: 'The assigned Account Officer (pop-up + email)',
      },
      {
        lane: 'ao2',
        title: 'Registered Locator',
        auto: ["Adds the locator to Registered Locator (one row), with the lease term from the contract; from now on it's shown by its LOC-… Ref No (also on Proponent Accounts).", "Scopes it so an Account Officer sees only their own locators.", "Counts the permit down to expiry; within 6 months it shows on Renewal Tracking and in Needs Attention.", "At 6 months left, emails the locator to renew (and tells the Account Officer), then a follow-up every month until the renewal is filed — each one logged."],
        status: 'One row per locator',
        where: 'Registered Locator',
        details: [
          'The locator now appears in Registered Locator; an Account Officer sees only their own locators.',
          'The Account Officer types the lease’s Ref. Code (never reused) and Date Signed under Lease Agreements; the proponent details the BDO encoded are already there.',
          'Lease Agreements shows the current lease; past leases are folded under “View past leases”, and each opens read only (its terms and property schedule) in a panel over the locator.',
          'Sub-Lease: each sub-lessee is a locator of its own — added (or linked) from the Sub-Lessees card of the locator it sub-leases from, and opened in its own panel over that locator.',
          'Stockholders tab: stockholders, SEC Registration Information (capital, purposes, SEC contact person) and GIS — the latest GIS filing date, with the locator’s GIS document from Compliance shown read only.',
          'The contract permit counts down to expiry — it shows on Renewal Tracking once expiring (6 months left).',
          'The locator gets a renewal reminder email then, and monthly after that, until the renewal is filed.',
          'The locator can still upload requirements that were to follow.',
        ],
      },
    ],
    loops: [
      { from: 3, to: 2, label: 'Rejected → re-upload', local: true },
      { from: 5, to: 4, label: 'Changes requested', local: true },
      { from: 8, to: 6, label: 'Return to Evaluator' },
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
        auto: ["Works out each permit’s status from its expiry date (Valid / Expiring within 6 months / Expired).", "Lists only expiring and expired permits on Renewal Tracking; flags them in Needs Attention.", "Emails the locator a renewal reminder at 6 months left, then monthly (logged in the Audit Log and the locator's activity)."],
        status: 'EXPIRING · EXPIRED',
        where: 'Renewal Tracking',
        details: [
          'Renewal Tracking lists only expiring (within 6 months) and expired permits and contracts.',
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
          'Account Officers only; each only for their own locators. One open renewal at a time.',
          'Goes straight to the locator\'s own Account Officer — no BDO, no assigning step.',
          'The locator\'s Ref No reads REN-… instead of LOC-… (same number) until the renewal is decided.',
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
        title: 'Verify / reject documents',
        auto: ["Keeps the renewal away from the BDO (queues and notifications).", "Tells the locator when a requirement is rejected."],
        status: 'IN_REVIEW',
        where: 'Renewal Queue · Compliance',
        details: ['Same review screen as the BDO\'s Evaluation Queue, scoped to renewals.'],
        notifies: 'The locator, when a requirement is rejected',
      },
      {
        lane: 'ao2',
        title: 'Terms & conditions → send',
        auto: ["Saves the terms as a draft the locator can't see yet.", "On Send: version 1, 2, … each time; emails and notifies the locator.", "Editing terms already sent or agreed puts them back to draft — they must be sent and agreed again."],
        status: 'Terms SENT',
        where: 'Renewal Queue · Terms',
        details: [
          'The evaluator writes the terms and conditions negotiated with the locator, then sends them.',
          'The locator needs a portal login to see them.',
        ],
        notifies: 'The locator (email + in-app)',
      },
      {
        lane: 'locator',
        title: 'Agree to the terms',
        auto: ["Records the answer and the version agreed to.", "Emails and notifies the evaluator: agreed → make the contract; changes → their remarks."],
        status: 'AGREED · or changes requested',
        where: 'Locator portal · My Applications · Terms',
        details: [
          'The locator reads the terms and clicks I agree, or Request changes with remarks.',
          'Only agreed terms unlock the contract.',
        ],
        notifies: 'The evaluator (email + in-app)',
      },
      {
        lane: 'ao2',
        title: 'Contract: record → print → sign → upload',
        auto: ["Generates the contract number and renders the contract PDF; creates the contract permit — hidden from the locator until approved.", "Open contract package: one PDF with the contract, the agreed terms, an attachments list and every requirement the locator uploaded.", "Locks the terms once the contract is recorded.", "Accepts only a file uploaded to this same application as the signed copy."],
        status: 'Signed contract uploaded',
        where: 'Renewal Queue · Contract',
        details: [
          'Record the contract (effective dates), open the package and print it.',
          'Have it signed, scan it to PDF and upload the signed copy.',
        ],
      },
      {
        lane: 'ao2',
        title: 'Submit review',
        auto: ["Blocks the submit until every uploaded requirement is checked and the signed contract is uploaded.", "Moves the stage to FOR_RECOMMENDATION.", "Tells the Manager the review is waiting."],
        status: 'FOR_RECOMMENDATION',
        where: 'Renewal Queue · Recommendation',
        details: [
          'Summary of the review; the signed contract goes to the Manager with it.',
          'Requirements still to follow (not uploaded yet) can be noted in the remarks.',
        ],
        notifies: 'ACCOUNT OFFICER - MANAGER',
      },
      {
        lane: 'ao1',
        title: 'Check → Approve',
        auto: ["Starts the approval and assigns it to that Manager.", "Keeps Approve locked until the signed contract is there; asks to confirm if mandatory requirements aren’t all verified (to follow).", "On Approve: status APPROVED; the locator is emailed the decision and now sees the contract and permit. The old permit becomes RENEWED."],
        status: 'FOR_APPROVAL → APPROVED',
        where: 'Renewal Queue · approval panel',
        details: [
          'Clicking the row sends it For Approval and opens the approval panel.',
          'The Manager checks the uploads, the terms and the signed contract (read-only), then Approves.',
          'Something wrong: Return to Evaluator sends it back to the evaluator with remarks.',
        ],
        notifies: 'The locator (email: decision)',
      },
      {
        lane: 'system',
        title: 'Renewed',
        auto: ["Updates the locator’s Registered Locator row with the new contract and term.", "Starts a new lease under Lease Agreements: the earlier one becomes history, the property schedule is copied over to edit, and the new lease needs its own Ref. Code (never reused).", "The old permit (marked RENEWED at approval) drops off Renewal Tracking.", "Does not send the renewal to the Approved Queue."],
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
      { from: 5, to: 4, label: 'Changes requested', local: true },
      { from: 8, to: 6, label: 'Return to Evaluator' },
    ],
  },
  {
    id: 'compliance',
    label: 'Compliance',
    lanes: ['locator', 'co', 'system'],
    steps: [
      {
        lane: 'locator',
        title: 'Upload compliance document',
        auto: [
          "Checks the file (PDF, Word or Excel, up to 50 MB; content must match the type).",
          "Files it under the locator's own folder (locators/<Ref No>/compliance/).",
          "Keeps every earlier upload as history — nothing is overwritten.",
          "Sets the checklist item to SUBMITTED with today's date and the validity entered.",
          "Alerts every Compliance Officer and admin (in-app).",
        ],
        status: 'SUBMITTED',
        where: 'Locator portal · Compliance',
        details: [
          'Checklist grouped as Compliance, Permits & Clearances and Performance Commitment.',
          'Upload or re-upload per item, with optional Valid from / Valid until.',
          'The locator also sees its standing, inspections, findings and corrective actions (view only).',
        ],
        notifies: 'Compliance Officers and admins',
      },
      {
        lane: 'co',
        title: 'Review document',
        auto: [
          "Complied stamps the latest submitted file ACCEPTED; Not complied stamps it REJECTED with the remarks.",
          "Records the change in the locator's checklist activity and the Audit Log.",
        ],
        status: 'COMPLIED · NOT_COMPLIED',
        where: 'Compliance & Inspection · locator checklist',
        details: [
          'Opens the locator’s file (and its earlier uploads) from the checklist row.',
          'Update → Complied or Not complied, with remarks the locator can see.',
          'Per locator, marks an item Not applicable (with a reason) — it moves to its own list and doesn’t count toward compliance, reminders or the alarm.',
          'Can also upload a document for the locator (walk-in, emailed or paper copy) and mark it Complied right away; it joins the same history.',
        ],
        notifies: 'The locator (in-app: Complied / Not complied, with the remarks)',
      },
      {
        lane: 'co',
        title: 'Inspect · findings · corrective actions',
        auto: [
          "Works out each locator’s standing: At Risk (failed inspection or overdue action), Monitoring (open findings/actions), else Compliant.",
          "Tells the locator (in-app) when an inspection is assigned and when it’s completed.",
        ],
        status: 'COMPLIANT · MONITORING · AT RISK',
        where: 'Compliance & Inspection',
        details: [
          'Schedules and records inspections, findings and corrective actions with due dates.',
          'The locator sees them on its Compliance page.',
        ],
        notifies: 'The locator (inspection assigned / completed)',
      },
      {
        lane: 'system',
        title: 'Expiry reminders · dashboard alarm',
        auto: [
          "Every 12 hours: finds checklist items whose Valid until is 6 months, 3 months or 1 month away, or just lapsed.",
          "Emails the locator once per stage (one email listing all due items) plus an in-app notice.",
          "Alerts every Compliance Officer and admin in-app, saying whether the email went out.",
          "Dashboard: red alarm banner while anything is expired, due within 30 days, or a corrective action is overdue.",
          "A renewed document (new Valid until) starts its own 6/3/1 series; logged in the Audit Log.",
        ],
        status: '6 MO · 3 MO · 1 MO · EXPIRED',
        where: 'Email · notifications · dashboard',
        details: [
          'Compliance section on the admin and Compliance Officer dashboards: expiry buckets, awaiting review, upcoming inspections.',
        ],
        notifies: 'The locator (email + in-app), Compliance Officers and admins',
      },
      {
        lane: 'system',
        title: 'Compliant',
        auto: [
          "When every active compliance requirement is Complied, the locator’s APPROVED application shows as COMPLIANT (label only — the status stays APPROVED).",
        ],
        status: 'APPROVED → COMPLIANT',
        where: 'Locator portal · dashboards',
        details: ['Approval, Reports and Permits keep working on APPROVED unchanged.'],
      },
    ],
    loops: [
      { from: 1, to: 0, label: 'Not complied → re-upload', local: true },
      { from: 3, to: 0, label: 'Expiring → renew document' },
    ],
  },
];

// Diagram geometry (SVG user units) — a top-down tree: the steps run down
// one spine, each step's automatic actions branch off to the right, and the
// loops back run up the left side.
const CARD_H = 78;
const EDGE_H = 104; // the connector into a card (room for two pills)
const STEP_H = CARD_H + EDGE_H;
const START_R = 30;
const TOP = 12 + START_R * 2;

/** Horizontal geometry. The SVG scales to its container, so on a phone the
 * wide layout's empty margins would shrink the text to ~6px; the compact
 * one drops them and narrows the card so the labels stay readable. */
function layout(compact: boolean) {
  const CARD_W = compact ? 236 : 260;
  const LOOP_GAP = compact ? 22 : 30;
  const loopInset = compact ? 22 : 46; // card edge → first loop line
  const autoOffset = compact ? 40 : 70; // card edge → centre of the "auto" bubbles
  const AUTO_R = compact ? 22 : 27;
  // Room on the left for two loop lines and their vertical pills.
  const SPINE_X = compact ? loopInset + LOOP_GAP + 14 + CARD_W / 2 : 330;
  const AUTO_X = SPINE_X + CARD_W / 2 + autoOffset;
  return {
    SPINE_X,
    CARD_W,
    AUTO_X,
    AUTO_R,
    LOOP_X: SPINE_X - CARD_W / 2 - loopInset, // first loop line; more go further left
    LOOP_GAP,
    VIEW_W: AUTO_X + AUTO_R + (compact ? 8 : 30),
    ICON: compact ? 36 : 44,
    PAD: compact ? 10 : 14,
  };
}

const COMPACT_QUERY = '(max-width: 639px)'; // below Tailwind's `sm`

function useCompact() {
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(COMPACT_QUERY).matches),
  );
  useEffect(() => {
    const mq = window.matchMedia?.(COMPACT_QUERY);
    if (!mq) return;
    const onChange = () => setCompact(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return compact;
}

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
  co: ShieldCheck,
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
  const [rawStep, setStep] = useState(0);
  // Never past the current scenario's last step: switching from New Locator
  // (9 steps) to Renewal (6) on step 7+ used to render a step that doesn't
  // exist and blank the page until the reset below ran.
  const step = Math.min(rawStep, scn.steps.length - 1);
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

  const compact = useCompact();
  const { SPINE_X, CARD_W, AUTO_X, AUTO_R, LOOP_X, LOOP_GAP, VIEW_W, ICON, PAD } = layout(compact);
  const detailRef = useRef<HTMLDivElement>(null);

  const n = scn.steps.length;
  const height = cardBottom(n - 1) + 24;
  const current = scn.steps[step];
  const lane = LANES[current.lane];
  const go = (i: number) => {
    setPlaying(false);
    setStep(i);
  };
  /** Tapping a step in the diagram: on a phone its details sit below the
   * tall diagram, so bring them into view. */
  const open = (i: number) => {
    go(i);
    if (compact) detailRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
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
              onClick={() => {
                setStep(0);
                setScenarioId(s.id);
              }}
              className={cn('px-3 py-1.5 rounded-full text-[12px] font-semibold cursor-pointer transition-colors', scenarioId === s.id ? '' : 'text-secondary')}
              style={scenarioId === s.id ? { backgroundColor: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' } : undefined}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1 sm:ml-auto">
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
        <div className="glass-card p-1.5 sm:p-4 !border-transparent" style={{ backgroundColor: 'var(--background)' }}>
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
              const laneText = st.lane === 'system' ? LANES[st.lane].label : laneTitle(LANES[st.lane]);
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
                <g key={`auto-${i}`} onClick={() => open(i)} style={{ cursor: 'pointer' }}>
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
                <g key={`card-${i}`} onClick={() => open(i)} style={{ cursor: 'pointer' }}>
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
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', gap: PAD - 2, padding: `0 ${PAD}px`, fontFamily: 'inherit' }}>
                      <div
                        style={{
                          width: ICON,
                          height: ICON,
                          flexShrink: 0,
                          borderRadius: 8,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`,
                          color,
                        }}
                      >
                        <Icon size={ICON / 2} />
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
        <div ref={detailRef} className="space-y-4 scroll-mt-4 lg:sticky lg:top-4">
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
                {laneTitle(lane)}
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
