/**
 * Proof coverage for the Directive Tutorial (#4981).
 * Progress lives in preferences; practice work uses a disposable repo.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { tutorialMain, type TutorialIo } from "./cli.js";
import { loadTutorial, projectFields, renderWiredSession } from "./render.js";

const frameworkRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const temps: string[] = [];

afterEach(() => {
  for (const root of temps.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temps.push(root);
  return root;
}

function run(
  projectRoot: string,
  prefsHome: string,
  argv: readonly string[],
): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  const io: TutorialIo = {
    writeOut: (text) => {
      out += text;
    },
    writeErr: (text) => {
      err += text;
    },
  };
  const code = tutorialMain(
    [
      ...argv,
      "--project-root",
      projectRoot,
      "--framework-root",
      frameworkRoot,
      "--prefs-home",
      prefsHome,
    ],
    io,
  );
  return { code, out, err };
}

describe("Directive Tutorial proof (#4981)", () => {
  it("covers offer, skip, each menu project render, resume, retry, reset, and complete", () => {
    const { glossary, script, projects } = loadTutorial(frameworkRoot);
    for (const id of ["signal", "postcard", "echo"] as const) {
      const messages = renderWiredSession(script, glossary, projectFields(projects, id));
      expect(messages).toHaveLength(7);
      expect(messages[0]).toContain("Welcome to the Directive Tutorial!");
      expect(messages.join("\n")).toContain(projects.get(id)?.fields.name ?? id);
    }

    const projectRoot = tempDir("deft-tutorial-proof-");
    const prefs = tempDir("deft-tutorial-prefs-");
    const repo = tempDir("deft-tutorial-repo-");

    expect(run(projectRoot, prefs, ["offer", "--json"]).out).toContain('"offerNow": true');
    expect(run(projectRoot, prefs, ["skip", "--json"]).out).toContain('"status": "skipped"');
    expect(run(projectRoot, prefs, ["offer", "--json"]).out).toContain('"offerNow": false');

    expect(run(projectRoot, prefs, ["start", "--repo", repo, "--project", "echo"]).code).toBe(0);
    expect(run(projectRoot, prefs, ["advance", "--project", "echo"]).code).toBe(0);
    const resumed = run(projectRoot, prefs, ["resume", "--json"]);
    expect(JSON.parse(resumed.out).state.currentBeat).toBe("write");

    expect(
      run(projectRoot, prefs, [
        "advance",
        "--content",
        "Q: Hi? A: Hello.",
        "--work-item",
        "xbrief/proposed/echo.xbrief.json",
        "--confirm",
      ]).code,
    ).toBe(0);
    expect(run(projectRoot, prefs, ["advance", "--confirm"]).code).toBe(0);
    expect(run(projectRoot, prefs, ["advance", "--content-seen"]).code).toBe(0);
    expect(run(projectRoot, prefs, ["advance", "--check", "fail"]).code).toBe(0);
    expect(JSON.parse(run(projectRoot, prefs, ["inspect", "--json"]).out).state.currentBeat).toBe(
      "result",
    );
    expect(run(projectRoot, prefs, ["advance", "--check", "pass"]).code).toBe(0);
    expect(run(projectRoot, prefs, ["advance", "--complete"]).code).toBe(0);
    expect(run(projectRoot, prefs, ["advance"]).code).toBe(0);
    expect(JSON.parse(run(projectRoot, prefs, ["inspect", "--json"]).out).state.status).toBe(
      "completed",
    );

    expect(run(projectRoot, prefs, ["reset", "--json"]).out).toContain('"currentBeat": null');
    expect(run(projectRoot, prefs, ["offer", "--json"]).out).toContain('"offerNow": false');
  });
});
