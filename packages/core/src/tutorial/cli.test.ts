import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { type TutorialIo, tutorialMain } from "./cli.js";

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

describe("deft tutorial commands (#4981)", () => {
  it("prints the scripted step and does not offer again after skip", () => {
    const projectRoot = tempDir("deft-tutorial-cli-");
    const prefs = tempDir("deft-tutorial-prefs-");
    const repo = tempDir("deft-tutorial-repo-");
    const skipped = run(projectRoot, prefs, ["skip", "--json"]);
    expect(skipped.code).toBe(0);
    expect(skipped.out).toContain('"status": "skipped"');
    expect(run(projectRoot, prefs, ["offer", "--json"]).out).toContain('"offerNow": false');

    const started = run(projectRoot, prefs, [
      "start",
      "--repo",
      repo,
      "--project",
      "signal",
      "--json",
    ]);
    expect(started.code).toBe(0);
    const body = JSON.parse(started.out) as {
      beatText: string;
      state: { repoPath: string; selectedProject: string };
    };
    expect(body.state.repoPath).toBe(resolve(repo));
    expect(body.state.selectedProject).toBe("signal");
    expect(body.beatText).toContain("Welcome to the Directive Tutorial!");
    expect(body.beatText).toContain("4. Leave");
    expect(body.beatText).not.toContain("Next:");
    expect(body.beatText).not.toContain("{name}");
  });

  it("refuses to use the person's project as the sandbox", () => {
    const projectRoot = tempDir("deft-tutorial-cli-");
    const prefs = tempDir("deft-tutorial-prefs-");
    const refused = run(projectRoot, prefs, ["start", "--repo", projectRoot]);
    expect(refused.code).toBe(1);
    expect(`${refused.out}${refused.err}`).toContain("disposable repository");
  });

  it("refuses a subdirectory of the person's project as the sandbox", () => {
    const projectRoot = tempDir("deft-tutorial-cli-");
    const prefs = tempDir("deft-tutorial-prefs-");
    const nested = join(projectRoot, "nested-sandbox");
    const refused = run(projectRoot, prefs, ["start", "--repo", nested]);
    expect(refused.code).toBe(1);
    expect(`${refused.out}${refused.err}`).toContain("disposable repository");
  });

  it("records a passing retry when --check is supplied with try-again", () => {
    const projectRoot = tempDir("deft-tutorial-cli-");
    const prefs = tempDir("deft-tutorial-prefs-");
    const repo = tempDir("deft-tutorial-repo-");
    expect(run(projectRoot, prefs, ["start", "--repo", repo]).code).toBe(0);
    expect(run(projectRoot, prefs, ["advance", "--project", "signal"]).code).toBe(0);
    expect(run(projectRoot, prefs, ["advance", "--content", "Alex — on the bridge."]).code).toBe(0);
    expect(
      run(projectRoot, prefs, [
        "advance",
        "--confirm",
        "--work-item",
        "xbrief/proposed/signal.xbrief.json",
      ]).code,
    ).toBe(0);
    expect(run(projectRoot, prefs, ["advance", "--confirm"]).code).toBe(0);
    expect(run(projectRoot, prefs, ["advance", "--content-seen"]).code).toBe(0);
    expect(run(projectRoot, prefs, ["advance", "--check", "fail"]).code).toBe(0);
    const retried = run(projectRoot, prefs, [
      "advance",
      "--project",
      "1",
      "--check",
      "pass",
      "--json",
    ]);
    expect(retried.code).toBe(0);
    expect(JSON.parse(retried.out).state.checkPassed).toBe(true);
  });

  it("fills promote/activate and active work-file paths into start/verify commands", () => {
    const projectRoot = tempDir("deft-tutorial-cli-");
    const prefs = tempDir("deft-tutorial-prefs-");
    const repo = tempDir("deft-tutorial-repo-");
    expect(run(projectRoot, prefs, ["start", "--repo", repo, "--project", "signal"]).code).toBe(0);
    expect(run(projectRoot, prefs, ["advance", "--project", "1"]).code).toBe(0);
    expect(run(projectRoot, prefs, ["advance", "--project", "1"]).code).toBe(0);
    const planned = run(projectRoot, prefs, [
      "advance",
      "--confirm",
      "--work-item",
      "xbrief/proposed/signal.xbrief.json",
      "--json",
    ]);
    expect(planned.code).toBe(0);
    const startStep = run(projectRoot, prefs, ["inspect", "--json"]);
    const startBody = JSON.parse(startStep.out) as { command: string | null };
    expect(startBody.command).toContain(
      'deft scope:promote -- "xbrief/proposed/signal.xbrief.json"',
    );
    expect(startBody.command).toContain(
      'deft scope:activate -- "xbrief/proposed/signal.xbrief.json"',
    );
    expect(run(projectRoot, prefs, ["advance", "--confirm"]).code).toBe(0);
    expect(run(projectRoot, prefs, ["advance", "--content-seen"]).code).toBe(0);
    const prove = run(projectRoot, prefs, ["inspect", "--json"]);
    const proveBody = JSON.parse(prove.out) as { command: string | null };
    expect(proveBody.command).toContain('deft verify:ac "xbrief/active/signal.xbrief.json"');
    expect(proveBody.command).not.toContain("<active-work-file>");
  });

  it("walks choose → write → start → change → prove → close → leave", () => {
    const projectRoot = tempDir("deft-tutorial-cli-");
    const prefs = tempDir("deft-tutorial-prefs-");
    const repo = tempDir("deft-tutorial-repo-");
    expect(run(projectRoot, prefs, ["start", "--repo", repo]).code).toBe(0);
    expect(run(projectRoot, prefs, ["advance", "--project", "postcard"]).code).toBe(0);
    expect(run(projectRoot, prefs, ["advance", "--content", "Wish you were here."]).code).toBe(0);
    expect(
      run(projectRoot, prefs, [
        "advance",
        "--confirm",
        "--work-item",
        "xbrief/proposed/postcard.xbrief.json",
      ]).code,
    ).toBe(0);
    expect(run(projectRoot, prefs, ["advance", "--confirm"]).code).toBe(0);
    expect(run(projectRoot, prefs, ["advance", "--content-seen"]).code).toBe(0);
    const failed = run(projectRoot, prefs, ["advance", "--check", "fail", "--json"]);
    expect(failed.code).toBe(0);
    expect(JSON.parse(failed.out).state.currentBeat).toBe("result");
    expect(run(projectRoot, prefs, ["advance", "--check", "pass"]).code).toBe(0);
    expect(run(projectRoot, prefs, ["advance", "--project", "1"]).code).toBe(0);
    expect(run(projectRoot, prefs, ["advance", "--complete"]).code).toBe(0);
    const left = run(projectRoot, prefs, ["advance", "--json"]);
    expect(JSON.parse(left.out).state.status).toBe("completed");
  });
});
