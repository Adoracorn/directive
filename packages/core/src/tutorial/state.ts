/**
 * Directive Tutorial progress (#4981).
 *
 * Lives in the person's user-preferences home (sidecar next to USER.md),
 * not in the product project and not only inside the practice sandbox.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { resolveUserMdPath } from "../user-config/resolve-user-md.js";

export const TUTORIAL_STATE_FILENAME = "tutorial-state.json";
export const TUTORIAL_CONTENT_VERSION = "1";

export const PROJECT_IDS = ["signal", "postcard", "echo"] as const;
export type TutorialProjectId = (typeof PROJECT_IDS)[number];

export type TutorialStatus =
  | "not_started"
  | "offered"
  | "in_progress"
  | "completed"
  | "skipped";

export interface TutorialBeatRef {
  readonly id: string;
  readonly wired: boolean;
}

export interface TutorialState {
  readonly status: TutorialStatus;
  readonly selectedProject: TutorialProjectId | null;
  readonly currentBeat: string | null;
  readonly completedBeats: readonly string[];
  readonly version: string;
  readonly content: string | null;
  readonly workItemPath: string | null;
  readonly repoPath: string | null;
  readonly checkPassed: boolean | null;
  readonly planConfirmed: boolean;
  readonly contentSeen: boolean;
  readonly offeredAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly skippedAt: string | null;
}

export interface AdvanceAction {
  readonly project?: string;
  readonly content?: string;
  readonly workItemPath?: string;
  readonly confirm?: boolean;
  readonly contentSeen?: boolean;
  readonly check?: "pass" | "fail";
  readonly complete?: boolean;
}

export interface TutorialStep {
  readonly ok: boolean;
  readonly message: string;
  readonly state: TutorialState;
  readonly beatId: string | null;
  /** True only on the call that records the one automatic offer. */
  readonly offerNow: boolean;
}

export function emptyTutorialState(): TutorialState {
  return {
    status: "not_started",
    selectedProject: null,
    currentBeat: null,
    completedBeats: [],
    version: TUTORIAL_CONTENT_VERSION,
    content: null,
    workItemPath: null,
    repoPath: null,
    checkPassed: null,
    planConfirmed: false,
    contentSeen: false,
    offeredAt: null,
    startedAt: null,
    completedAt: null,
    skippedAt: null,
  };
}

export function isProjectId(value: string): value is TutorialProjectId {
  return (PROJECT_IDS as readonly string[]).includes(value);
}

export function shouldOfferTutorial(state: TutorialState): boolean {
  return state.status === "not_started";
}

/** Sidecar next to the resolved USER.md path. */
export function tutorialStatePath(options: {
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
} = {}): string {
  const resolved = resolveUserMdPath(options);
  return join(dirname(resolved.path), TUTORIAL_STATE_FILENAME);
}

export function loadTutorialState(options: {
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDir?: string;
  path?: string;
} = {}): TutorialState {
  const path = options.path ?? tutorialStatePath(options);
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<TutorialState> & {
      declined?: boolean;
      deferred?: boolean;
      completed?: boolean;
      offered?: boolean;
      beaconLine?: string;
    };
    return normalizeState(raw);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return emptyTutorialState();
    throw err;
  }
}

function normalizeState(raw: Partial<TutorialState> & Record<string, unknown>): TutorialState {
  const empty = emptyTutorialState();
  let status: TutorialStatus = empty.status;
  if (
    raw.status === "not_started" ||
    raw.status === "offered" ||
    raw.status === "in_progress" ||
    raw.status === "completed" ||
    raw.status === "skipped"
  ) {
    status = raw.status;
  } else if (raw.completed === true) {
    status = "completed";
  } else if (raw.declined === true || raw.deferred === true) {
    status = "skipped";
  } else if (typeof raw.currentBeat === "string" && raw.currentBeat.length > 0) {
    status = "in_progress";
  } else if (raw.offered === true) {
    status = "offered";
  }

  const selected =
    typeof raw.selectedProject === "string" && isProjectId(raw.selectedProject)
      ? raw.selectedProject
      : null;

  const completedBeats = Array.isArray(raw.completedBeats)
    ? raw.completedBeats.filter((id): id is string => typeof id === "string")
    : [];

  const content =
    typeof raw.content === "string"
      ? raw.content
      : typeof raw.beaconLine === "string"
        ? raw.beaconLine
        : null;

  return {
    status,
    selectedProject: selected,
    currentBeat: typeof raw.currentBeat === "string" ? raw.currentBeat : null,
    completedBeats,
    version: typeof raw.version === "string" ? raw.version : TUTORIAL_CONTENT_VERSION,
    content,
    workItemPath: typeof raw.workItemPath === "string" ? raw.workItemPath : null,
    repoPath: typeof raw.repoPath === "string" ? raw.repoPath : null,
    checkPassed: raw.checkPassed === true ? true : raw.checkPassed === false ? false : null,
    planConfirmed: raw.planConfirmed === true,
    contentSeen: raw.contentSeen === true || raw.lineSeen === true,
    offeredAt: typeof raw.offeredAt === "string" ? raw.offeredAt : null,
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : null,
    completedAt: typeof raw.completedAt === "string" ? raw.completedAt : null,
    skippedAt: typeof raw.skippedAt === "string" ? raw.skippedAt : null,
  };
}

export function saveTutorialState(
  state: TutorialState,
  options: {
    projectRoot?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    homeDir?: string;
    path?: string;
  } = {},
): void {
  const path = options.path ?? tutorialStatePath(options);
  const root = dirname(path);
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(prefix)) {
    throw new Error("tutorial state path escapes the preferences home");
  }
  mkdirSync(root, { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function nowIso(): string {
  return new Date().toISOString();
}

function step(
  ok: boolean,
  message: string,
  state: TutorialState,
  beatId: string | null,
  offerNow = false,
): TutorialStep {
  return { ok, message, state, beatId, offerNow };
}

function wiredIds(beats: readonly TutorialBeatRef[]): string[] {
  return beats.filter((beat) => beat.wired).map((beat) => beat.id);
}

function nextWired(beats: readonly TutorialBeatRef[], current: string): string | null {
  const ids = wiredIds(beats);
  const index = ids.indexOf(current);
  if (index < 0) return null;
  return ids[index + 1] ?? null;
}

function withCompleted(state: TutorialState, beatId: string): TutorialState {
  if (state.completedBeats.includes(beatId)) return state;
  return { ...state, completedBeats: [...state.completedBeats, beatId] };
}

export function offerTutorial(state: TutorialState): TutorialStep {
  if (!shouldOfferTutorial(state)) {
    return step(true, "Do not offer the tutorial again.", state, state.currentBeat, false);
  }
  const next: TutorialState = {
    ...state,
    status: "offered",
    offeredAt: state.offeredAt ?? nowIso(),
  };
  return step(true, "Offer the Directive Tutorial once.", next, null, true);
}

/** First-offer skip (also covers legacy decline/defer). */
export function skipOffer(state: TutorialState): TutorialStep {
  if (state.currentBeat !== null || state.status === "in_progress") {
    return step(false, "The tutorial has already started.", state, state.currentBeat);
  }
  if (state.status === "completed") {
    return step(false, "The tutorial is already finished. Reset before skipping.", state, null);
  }
  const next: TutorialState = {
    ...state,
    status: "skipped",
    skippedAt: nowIso(),
    offeredAt: state.offeredAt ?? nowIso(),
  };
  return step(true, "Recorded skip. Explicit re-run still works.", next, null);
}

export function startTutorial(
  state: TutorialState,
  repoPath: string,
  beats: readonly TutorialBeatRef[],
  project?: string,
): TutorialStep {
  if (state.status === "completed" && state.currentBeat === null) {
    return step(false, "The tutorial is already finished. Reset before starting again.", state, null);
  }
  if (state.currentBeat !== null && state.status === "in_progress") {
    return step(true, "The tutorial is already in progress.", state, state.currentBeat);
  }
  const first = wiredIds(beats)[0];
  if (first === undefined) {
    return step(false, "The tutorial has no wired beat.", state, null);
  }
  const trimmed = repoPath.trim();
  if (trimmed.length === 0) {
    return step(false, "The practice project needs a disposable repository path.", state, null);
  }

  let selected: TutorialProjectId | null = state.selectedProject;
  if (project !== undefined) {
    const normalized = project.trim().toLowerCase();
    if (!isProjectId(normalized)) {
      return step(false, "Pick Signal, Postcard, or Echo.", state, null);
    }
    selected = normalized;
  }

  const next: TutorialState = {
    ...state,
    status: "in_progress",
    selectedProject: selected,
    currentBeat: first,
    repoPath: trimmed,
    startedAt: state.startedAt ?? nowIso(),
    offeredAt: state.offeredAt ?? nowIso(),
  };
  return step(true, "Practice sandbox is ready. Read this step aloud.", next, first);
}

export function resumeTutorial(state: TutorialState): TutorialStep {
  if (state.currentBeat === null) {
    return step(true, "The tutorial has not started.", state, null);
  }
  return step(true, "Resume this step. Read it aloud.", state, state.currentBeat);
}

export function resetTutorial(state: TutorialState): TutorialStep {
  const next: TutorialState = {
    ...emptyTutorialState(),
    // Reset clears progress; does not by itself re-fire the automatic offer.
    status: state.status === "not_started" ? "not_started" : "offered",
    offeredAt: state.offeredAt,
  };
  return step(true, "Progress cleared. This does not offer the tutorial again.", next, null);
}

/** Mid-tutorial skip to the next wired beat (does not finish the work). */
export function skipBeat(state: TutorialState, beats: readonly TutorialBeatRef[]): TutorialStep {
  if (state.currentBeat === null) {
    return skipOffer(state);
  }
  if (!wiredIds(beats).includes(state.currentBeat)) {
    return step(false, "This step is not wired.", state, state.currentBeat);
  }
  const following = nextWired(beats, state.currentBeat);
  if (following === null) {
    return step(false, "This is the last step. Skip does not finish the work.", state, state.currentBeat);
  }
  const next = withCompleted(
    { ...state, currentBeat: following, status: "in_progress" },
    state.currentBeat,
  );
  return step(
    true,
    "Skipped to the next step. The work is not finished.",
    next,
    following,
  );
}

export function advanceTutorial(
  state: TutorialState,
  beats: readonly TutorialBeatRef[],
  action: AdvanceAction,
): TutorialStep {
  if (state.currentBeat === null) {
    return step(false, "The tutorial has not started.", state, null);
  }
  if (!wiredIds(beats).includes(state.currentBeat)) {
    return step(false, "This step is not wired.", state, state.currentBeat);
  }

  const gate = gateAdvance(state, action);
  if (!gate.ok || gate.state === undefined) {
    return step(false, gate.message, state, state.currentBeat);
  }

  if (state.currentBeat === "result" && action.check === "fail") {
    return step(true, gate.message, gate.state, state.currentBeat);
  }

  if (state.currentBeat === "leave") {
    return step(true, gate.message, gate.state, "leave");
  }

  const following = nextWired(beats, state.currentBeat);
  if (following === null) {
    return step(false, "There is no next wired step.", gate.state, state.currentBeat);
  }
  const marked = withCompleted(gate.state, state.currentBeat);
  const next = { ...marked, currentBeat: following, status: "in_progress" as const };
  return step(true, "Read the next step aloud.", next, following);
}

function gateAdvance(
  state: TutorialState,
  action: AdvanceAction,
): { ok: boolean; message: string; state?: TutorialState } {
  switch (state.currentBeat) {
    case "choose": {
      const raw = action.project?.trim().toLowerCase() ?? "";
      if (!isProjectId(raw)) {
        return { ok: false, message: "Pick Signal, Postcard, or Echo before this step can move on." };
      }
      return {
        ok: true,
        message: "Practice project recorded.",
        state: { ...state, selectedProject: raw },
      };
    }
    case "write": {
      const content = action.content?.trim() ?? state.content?.trim() ?? "";
      if (content.length === 0) {
        return { ok: false, message: "The person has to supply the toy content before this step can move on." };
      }
      const workItemPath = action.workItemPath?.trim() ?? "";
      if (workItemPath.length === 0) {
        return { ok: false, message: "The proposed work file has to exist before this step can move on." };
      }
      if (action.confirm !== true) {
        return { ok: false, message: "The person has to say yes to the plan before this step can move on." };
      }
      return {
        ok: true,
        message: "Work file recorded.",
        state: { ...state, content, workItemPath },
      };
    }
    case "start": {
      if (action.confirm !== true) {
        return { ok: false, message: "The person has to say yes before this step can move on." };
      }
      return { ok: true, message: "Plan confirmed.", state: { ...state, planConfirmed: true } };
    }
    case "change": {
      if (action.contentSeen !== true) {
        return { ok: false, message: "The person has to see the toy work before this step can move on." };
      }
      return { ok: true, message: "Content seen.", state: { ...state, contentSeen: true } };
    }
    case "result": {
      if (action.check === "fail") {
        return {
          ok: true,
          message: "Stay on this step. Fix the mismatch and run the same check again.",
          state: { ...state, checkPassed: false },
        };
      }
      if (action.check === "pass") {
        return { ok: true, message: "Check passed.", state: { ...state, checkPassed: true } };
      }
      return { ok: false, message: "Say whether the check passed or failed." };
    }
    case "close": {
      if (state.checkPassed !== true) {
        return { ok: false, message: "The acceptance check must pass before the work can be closed." };
      }
      if (action.complete !== true && action.confirm !== true) {
        return { ok: false, message: "Confirm complete before this step can move on." };
      }
      return { ok: true, message: "Work closed.", state };
    }
    case "leave": {
      return {
        ok: true,
        message: "The practice sitting is finished.",
        state: {
          ...state,
          status: "completed",
          completedAt: nowIso(),
          currentBeat: "leave",
        },
      };
    }
    default:
      return { ok: false, message: "This step cannot advance." };
  }
}

/** @deprecated Use skipOffer / skipBeat. Kept for CLI alias compatibility. */
export const declineTutorial = skipOffer;
/** @deprecated Use skipOffer. */
export const deferTutorial = skipOffer;
/** @deprecated Use skipBeat. */
export const skipTutorial = skipBeat;
