import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  beatById,
  fillBeat,
  loadTutorial,
  projectFields,
  renderBeat,
  renderWiredSession,
  wiredBeats,
} from "./render.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("Directive Tutorial session messages (#4981)", () => {
  const { glossary, script, projects } = loadTutorial(repoRoot);
  const fields = projectFields(projects, "signal");

  it("reads the version-1 glossary terms", () => {
    expect([...glossary.keys()]).toEqual([
      "Directive",
      "work file",
      "work item",
      "proposed",
      "ready",
      "in progress",
      "done",
      "acceptance",
      "branch",
      "check",
      "evidence",
      "in-scope files",
    ]);
  });

  it("loads the three menu projects", () => {
    expect([...projects.keys()].sort()).toEqual(["echo", "postcard", "signal"]);
  });

  it("wires all seven shared steps", () => {
    expect(wiredBeats(script).map((beat) => beat.id)).toEqual([
      "choose",
      "write",
      "start",
      "change",
      "result",
      "close",
      "leave",
    ]);
  });

  it("welcomes on step 1 and names the menu", () => {
    const message = renderBeat(beatById(script, "choose"), glossary, fields);
    expect(message).toContain("Welcome to the Directive Tutorial!");
    expect(message).toContain("Step 1 of 7.");
    expect(message).toContain("First, a quick word on Directive");
    expect(message).toContain("1. Signal");
    expect(message).toContain("2. Postcard");
    expect(message).toContain("3. Echo");
    expect(message).toContain("4. Leave");
    expect(message).not.toContain("**Directive** —");
    expect(message).toContain("Something to keep in mind:");
    expect(message).not.toContain("Next:");
  });

  it("fills project slots on later steps without leaking commands into learner text", () => {
    const write = renderBeat(beatById(script, "write"), glossary, fields);
    expect(write).toContain("Signal");
    expect(write).toContain("Do Plan and Done look right?");
    expect(write).toContain("1. Yes");
    expect(write).toContain("2. No");
    expect(write).toContain("3. Leave");
    expect(write).not.toContain("Next:");
    expect(write).not.toContain("Kristen — on the bridge.");
    expect(write).not.toContain("{name}");
    expect(write).not.toContain("Command:");

    const afterPlan = renderBeat(beatById(script, "write"), glossary, fields, {
      planAccepted: true,
    });
    expect(afterPlan).toContain("Kristen — on the bridge.");
    expect(afterPlan).toContain("Now supply the toy content");
    expect(afterPlan).toContain("Reply with the status line Signal should print");
    expect(afterPlan).not.toContain("question and answer");
    expect(afterPlan).not.toContain("**work file**");
    expect(afterPlan).not.toContain("Something to keep in mind:");

    const start = renderBeat(beatById(script, "start"), glossary, fields);
    expect(start).not.toContain("Command:");
    expect(fillBeat(beatById(script, "start"), fields).command).toContain("feat/signal-prints-this-line");
  });

  it("renders the full wired session for a chosen project", () => {
    const messages = renderWiredSession(script, glossary, fields);
    expect(messages).toHaveLength(7);
    expect(messages[0]).toContain("Step 1 of 7.");
    expect(messages[6]).toContain("Step 7 of 7.");
  });
});
