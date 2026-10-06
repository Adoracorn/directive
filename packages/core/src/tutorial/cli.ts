/**
 * `deft tutorial:*` (#4981). The agent runs these. The person still chooses
 * the project, supplies content, says yes, runs the check, and sees the result.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  advanceTutorial,
  loadTutorialState,
  leaveTutorial,
  offerTutorial,
  resetTutorial,
  resumeTutorial,
  saveTutorialState,
  skipBeat,
  skipOffer,
  startTutorial,
  type AdvanceAction,
  type TutorialStep,
} from "./state.js";
import { loadTutorial, renderBeat, fillBeat, projectFields, type TutorialBeat } from "./render.js";

export interface TutorialIo {
  writeOut: (text: string) => void;
  writeErr: (text: string) => void;
}

const SUBCOMMANDS = [
  "offer",
  "start",
  "inspect",
  "advance",
  "resume",
  "skip",
  "leave",
  "reset",
  "decline",
  "defer",
] as const;

type Subcommand = (typeof SUBCOMMANDS)[number];

function isSubcommand(value: string): value is Subcommand {
  return (SUBCOMMANDS as readonly string[]).includes(value);
}

export function findFrameworkRoot(start: string): string | null {
  let dir = resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      if (statSync(join(dir, "content", "tutorial", "beats.json")).isFile()) return dir;
    } catch {
      // keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function defaultFrameworkRoot(): string {
  return findFrameworkRoot(dirname(fileURLToPath(import.meta.url))) ?? resolve(".");
}

function flagValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.lastIndexOf(name);
  if (index < 0) return undefined;
  return argv[index + 1];
}

function hasFlag(argv: readonly string[], name: string): boolean {
  return argv.includes(name);
}

function samePath(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

function ensureRepo(projectRoot: string, requested: string | undefined, projectId: string | null): string {
  if (requested !== undefined && requested.trim().length > 0) {
    const repo = resolve(requested);
    if (samePath(repo, projectRoot)) {
      throw new Error("The practice project must run in a disposable repository, not the person's project.");
    }
    return repo;
  }
  const prefix = projectId ? `${projectId}-` : "tutorial-";
  const repo = mkdtempSync(join(tmpdir(), prefix));
  if (samePath(repo, projectRoot)) {
    throw new Error("The practice project must run in a disposable repository, not the person's project.");
  }
  execFileSync("git", ["init", "-q"], { cwd: repo });
  return repo;
}

function beatById(beats: readonly TutorialBeat[], id: string): TutorialBeat | undefined {
  return beats.find((beat) => beat.id === id);
}

function payload(
  step: TutorialStep,
  beatText: string | null,
  command: string | null,
): string {
  return `${JSON.stringify({ ...step, beatText, command }, null, 2)}\n`;
}

function actionFrom(argv: readonly string[]): AdvanceAction {
  const check = flagValue(argv, "--check");
  return {
    project: flagValue(argv, "--project"),
    content: flagValue(argv, "--content") ?? flagValue(argv, "--line"),
    workItemPath: flagValue(argv, "--work-item"),
    confirm: hasFlag(argv, "--confirm"),
    contentSeen: hasFlag(argv, "--content-seen") || hasFlag(argv, "--line-seen"),
    check: check === "pass" || check === "fail" ? check : undefined,
    complete: hasFlag(argv, "--complete"),
  };
}

export function tutorialMain(argv: readonly string[], io: TutorialIo = consoleIo()): number {
  const [subcommand, ...rest] = argv;
  if (subcommand === undefined || !isSubcommand(subcommand)) {
    io.writeErr(
      "usage: deft tutorial:offer|start|inspect|advance|resume|skip|leave|reset [--project signal|postcard|echo|1|2|3] [--json]\n",
    );
    return 1;
  }

  const projectRoot = resolve(flagValue(rest, "--project-root") ?? ".");
  const frameworkRoot = resolve(flagValue(rest, "--framework-root") ?? defaultFrameworkRoot());
  const prefsHome = flagValue(rest, "--prefs-home");
  const statePath = prefsHome !== undefined ? join(resolve(prefsHome), "tutorial-state.json") : undefined;
  const asJson = hasFlag(rest, "--json");
  const stateOpts = { projectRoot, path: statePath };

  let tutorial;
  try {
    tutorial = loadTutorial(frameworkRoot);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    io.writeErr(`tutorial: cannot read the beats (${message})\n`);
    return 1;
  }

  const beats = tutorial.script.beats;
  let state = loadTutorialState(stateOpts);
  let step: TutorialStep;

  try {
    switch (subcommand) {
      case "offer":
        step = offerTutorial(state);
        break;
      case "decline":
      case "defer":
        step = skipOffer(state);
        break;
      case "start": {
        const projectFlag = flagValue(rest, "--project");
        step = startTutorial(
          state,
          state.currentBeat === null || state.status !== "in_progress"
            ? ensureRepo(projectRoot, flagValue(rest, "--repo"), projectFlag ?? state.selectedProject)
            : (state.repoPath ?? ""),
          beats,
          projectFlag,
        );
        break;
      }
      case "inspect":
        step = resumeTutorial(state);
        break;
      case "resume":
        step = resumeTutorial(state);
        break;
      case "skip":
        step = skipBeat(state, beats);
        break;
      case "leave":
        step = leaveTutorial(state);
        break;
      case "reset":
        step = resetTutorial(state);
        break;
      case "advance": {
        const projectFlag = flagValue(rest, "--project")?.trim().toLowerCase();
        const leavePick =
          projectFlag === "leave" ||
          (state.currentBeat === "choose" && projectFlag === "4") ||
          (state.currentBeat === "write" &&
            !state.planAccepted &&
            projectFlag === "3") ||
          (state.currentBeat === "write" &&
            state.planAccepted &&
            (projectFlag === "2" || projectFlag === "3")) ||
          ((state.currentBeat === "start" ||
            state.currentBeat === "change" ||
            state.currentBeat === "close") &&
            projectFlag === "2") ||
          (state.currentBeat === "result" && projectFlag === "2" && !hasFlag(rest, "--check")) ||
          (state.currentBeat === "result" && projectFlag === "3");
        if (leavePick) {
          step = leaveTutorial(state);
          break;
        }
        // Write step menu: 1 Yes / 2 No / 3 Leave (before Plan/Done is accepted).
        if (state.currentBeat === "write" && !state.planAccepted) {
          if (projectFlag === "2" || projectFlag === "no") {
            step = {
              ok: false,
              message: "Plan or Done was not accepted. Stay on this step and adjust with the person.",
              state,
              beatId: state.currentBeat,
              offerNow: false,
            };
            break;
          }
          if (projectFlag === "1" || projectFlag === "yes") {
            step = advanceTutorial(state, beats, { ...actionFrom(rest), confirm: true });
            break;
          }
        }
        // Start: 1 Yes → confirm
        if (state.currentBeat === "start" && (projectFlag === "1" || projectFlag === "yes")) {
          step = advanceTutorial(state, beats, { ...actionFrom(rest), confirm: true });
          break;
        }
        // Change: 1 Go → content seen
        if (state.currentBeat === "change" && (projectFlag === "1" || projectFlag === "go")) {
          step = advanceTutorial(state, beats, { ...actionFrom(rest), contentSeen: true });
          break;
        }
        // Result: agent runs the check, then records --check pass|fail (numbered verdict menu).
        // Close: 1 Go → complete
        if (state.currentBeat === "close" && (projectFlag === "1" || projectFlag === "go")) {
          step = advanceTutorial(state, beats, { ...actionFrom(rest), complete: true });
          break;
        }
        step = advanceTutorial(state, beats, actionFrom(rest));
        break;
      }
      default:
        return 1;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    io.writeErr(`tutorial: ${message}\n`);
    return 1;
  }

  if (step.ok) {
    saveTutorialState(step.state, stateOpts);
  }

  const beat = step.beatId === null ? undefined : beatById(beats, step.beatId);
  const fields = projectFields(tutorial.projects, step.state.selectedProject);
  const filled = beat === undefined ? null : fillBeat(beat, fields);
  const beatText =
    beat === undefined
      ? null
      : renderBeat(beat, tutorial.glossary, fields, {
          planAccepted: step.state.planAccepted,
        });
  const command = filled?.command ?? null;

  if (asJson) {
    io.writeOut(payload(step, beatText, command));
  } else {
    io.writeOut(`${step.message}\n`);
    if (beatText !== null) {
      io.writeOut(`\n${beatText}\n`);
    }
  }
  return step.ok ? 0 : 1;
}

function consoleIo(): TutorialIo {
  return {
    writeOut: (text) => {
      process.stdout.write(text);
    },
    writeErr: (text) => {
      process.stderr.write(text);
    },
  };
}
