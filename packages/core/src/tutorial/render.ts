/**
 * Directive Tutorial session messages (#4981).
 *
 * Stores: shared beats, glossary, and per-menu practice project files.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { TutorialProjectId } from "./state.js";

export interface GlossaryEntry {
  readonly term: string;
  readonly plain: string;
  readonly prevents: string;
}

export interface TutorialBeat {
  readonly id: string;
  readonly number: number;
  readonly name: string;
  readonly wired: boolean;
  readonly where: string;
  readonly about: string;
  readonly terms: readonly string[];
  readonly caveat: string;
  readonly output: string;
  readonly command: string | null;
  readonly next: string;
}

export interface PracticeProject {
  readonly id: TutorialProjectId | string;
  readonly title?: string;
  readonly pitch?: string;
  readonly fields: Readonly<Record<string, string>>;
}

export interface TutorialScript {
  readonly beats: readonly TutorialBeat[];
}

const TERM_HEADING = /^## (.+)$/;
const PLAIN_LINE = /^Plain: (.+)$/;
const PREVENTS_LINE = /^(?:Prevents|Why it matters): (.+)$/;

/** Parse the tutorial glossary. Unknown headings are ignored. */
export function parseGlossary(markdown: string): ReadonlyMap<string, GlossaryEntry> {
  const entries = new Map<string, GlossaryEntry>();
  let term: string | null = null;
  let plain: string | null = null;
  let prevents: string | null = null;
  let field: "plain" | "prevents" | null = null;

  const flush = (): void => {
    if (term !== null && plain !== null && prevents !== null) {
      entries.set(term, { term, plain, prevents });
    }
    term = null;
    plain = null;
    prevents = null;
    field = null;
  };

  const append = (current: string | null, extra: string): string => {
    const bit = extra.trim();
    if (current === null || current.length === 0) return bit;
    return `${current} ${bit}`;
  };

  for (const line of markdown.split("\n")) {
    const heading = TERM_HEADING.exec(line);
    if (heading !== null) {
      flush();
      term = heading[1]?.trim() ?? null;
      continue;
    }
    const plainMatch = PLAIN_LINE.exec(line);
    if (plainMatch !== null && term !== null) {
      plain = plainMatch[1]?.trim() ?? "";
      field = "plain";
      continue;
    }
    const preventsMatch = PREVENTS_LINE.exec(line);
    if (preventsMatch !== null && term !== null) {
      prevents = preventsMatch[1]?.trim() ?? "";
      field = "prevents";
      continue;
    }
    if (term !== null && field !== null && line.trim().length > 0) {
      if (field === "plain") plain = append(plain, line);
      if (field === "prevents") prevents = append(prevents, line);
    }
  }
  flush();
  return entries;
}

export function parseScript(json: string): TutorialScript {
  return JSON.parse(json) as TutorialScript;
}

export function parseProject(json: string): PracticeProject {
  return JSON.parse(json) as PracticeProject;
}

const FIELD_SLOT = /\{([A-Za-z0-9]+)\}/g;

/** Fill `{field}` slots from the practice project. Unknown slots throw. */
export function fillSlots(text: string, fields: Readonly<Record<string, string>>): string {
  return text.replace(FIELD_SLOT, (slot, key: string) => {
    const value = fields[key];
    if (value === undefined) {
      throw new Error(`tutorial project missing field: ${key}`);
    }
    return value;
  });
}

export function fillBeat(
  beat: TutorialBeat,
  fields: Readonly<Record<string, string>>,
): TutorialBeat {
  return {
    ...beat,
    where: fillSlots(beat.where, fields),
    about: fillSlots(beat.about, fields),
    caveat: fillSlots(beat.caveat, fields),
    output: fillSlots(beat.output, fields),
    command: beat.command === null ? null : fillSlots(beat.command, fields),
    next: fillSlots(beat.next, fields),
  };
}

export function loadTutorial(repoRoot: string): {
  glossary: ReadonlyMap<string, GlossaryEntry>;
  script: TutorialScript;
  projects: ReadonlyMap<string, PracticeProject>;
} {
  const dir = join(repoRoot, "content", "tutorial");
  const projectsDir = join(dir, "projects");
  const projects = new Map<string, PracticeProject>();
  for (const name of readdirSync(projectsDir)) {
    if (!name.endsWith(".json")) continue;
    const project = parseProject(readFileSync(join(projectsDir, name), "utf8"));
    projects.set(project.id, project);
  }
  return {
    glossary: parseGlossary(readFileSync(join(dir, "glossary.md"), "utf8")),
    script: parseScript(readFileSync(join(dir, "beats.json"), "utf8")),
    projects,
  };
}

export function projectFields(
  projects: ReadonlyMap<string, PracticeProject>,
  projectId: string | null,
): Readonly<Record<string, string>> {
  if (projectId === null) {
    // Choose step has no project yet — use Signal placeholders for shared tokens that appear later.
    const signal = projects.get("signal");
    return signal?.fields ?? {};
  }
  const project = projects.get(projectId);
  if (project === undefined) {
    throw new Error(`tutorial project not found: ${projectId}`);
  }
  return project.fields;
}

export function wiredBeats(script: TutorialScript): readonly TutorialBeat[] {
  return script.beats.filter((beat) => beat.wired);
}

export function beatById(script: TutorialScript, id: string): TutorialBeat {
  const beat = script.beats.find((item) => item.id === id);
  if (beat === undefined) {
    throw new Error(`tutorial beat not found: ${id}`);
  }
  return beat;
}

function termBlock(entry: GlossaryEntry): string {
  return `**${entry.term}** — ${entry.plain} ${entry.prevents}`;
}

/**
 * One session message. Glossary sentences are filled in here.
 * The keep-in-mind line is always in the message, before raw output.
 */
export function renderBeat(
  beat: TutorialBeat,
  glossary: ReadonlyMap<string, GlossaryEntry>,
  fields: Readonly<Record<string, string>> = {},
): string {
  const filled = fillBeat(beat, fields);
  const words = filled.terms.map((term) => {
    const entry = glossary.get(term);
    if (entry === undefined) {
      throw new Error(`tutorial glossary missing term: ${term}`);
    }
    return termBlock(entry);
  });
  const parts: string[] = [
    filled.where,
    "",
    filled.about,
    "",
    ...words.flatMap((word) => [word, ""]),
    `Something to keep in mind: ${filled.caveat}`,
    "",
  ];
  if (filled.output.trim().length > 0) {
    parts.push(filled.output, "");
  }
  parts.push(`Next: ${filled.next}`);
  return parts.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function renderWiredSession(
  script: TutorialScript,
  glossary: ReadonlyMap<string, GlossaryEntry>,
  fields: Readonly<Record<string, string>> = {},
): readonly string[] {
  return wiredBeats(script).map((beat) => renderBeat(beat, glossary, fields));
}
