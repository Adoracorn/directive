import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  advanceTutorial,
  emptyTutorialState,
  loadTutorialState,
  offerTutorial,
  resetTutorial,
  resumeTutorial,
  saveTutorialState,
  shouldOfferTutorial,
  skipBeat,
  skipOffer,
  startTutorial,
  type TutorialBeatRef,
  type TutorialState,
} from "./state.js";

const beats: readonly TutorialBeatRef[] = [
  { id: "choose", wired: true },
  { id: "write", wired: true },
  { id: "start", wired: true },
  { id: "change", wired: true },
  { id: "result", wired: true },
  { id: "close", wired: true },
  { id: "leave", wired: true },
];

const temps: string[] = [];
afterEach(() => {
  for (const root of temps.splice(0)) rmSync(root, { recursive: true, force: true });
});

function prefsHome(): string {
  const root = mkdtempSync(join(tmpdir(), "deft-tutorial-prefs-"));
  temps.push(root);
  return root;
}

function begin(): TutorialState {
  return startTutorial(emptyTutorialState(), "/tmp/signal-sandbox", beats).state;
}

describe("Directive Tutorial state (#4981)", () => {
  it("offers once, and skip does not offer again", () => {
    const offered = offerTutorial(emptyTutorialState());
    expect(offered.offerNow).toBe(true);
    expect(offered.state.status).toBe("offered");
    expect(shouldOfferTutorial(offered.state)).toBe(false);
    expect(offerTutorial(offered.state).offerNow).toBe(false);

    const skipped = skipOffer(emptyTutorialState());
    expect(skipped.state.status).toBe("skipped");
    expect(shouldOfferTutorial(skipped.state)).toBe(false);
  });

  it("allows explicit start after skip", () => {
    const skipped = skipOffer(emptyTutorialState());
    const started = startTutorial(skipped.state, "/tmp/signal-sandbox", beats, "signal");
    expect(started.ok).toBe(true);
    expect(started.state.status).toBe("in_progress");
    expect(started.state.currentBeat).toBe("choose");
    expect(started.state.selectedProject).toBe("signal");
  });

  it("stores progress in the preferences home and resumes", () => {
    const home = prefsHome();
    const path = join(home, "tutorial-state.json");
    let state = startTutorial(emptyTutorialState(), "/tmp/signal-sandbox", beats).state;
    state = advanceTutorial(state, beats, { project: "signal" }).state;
    saveTutorialState(state, { path });
    const loaded = loadTutorialState({ path });
    const resumed = resumeTutorial(loaded);
    expect(resumed.state.currentBeat).toBe("write");
    expect(resumed.state.selectedProject).toBe("signal");
  });

  it("keeps a failed check on prove-it and advances only after a pass", () => {
    let state = begin();
    state = advanceTutorial(state, beats, { project: "postcard" }).state;
    state = advanceTutorial(state, beats, {
      content: "Wish you were here.",
      workItemPath: "xbrief/proposed/postcard.xbrief.json",
      confirm: true,
    }).state;
    state = advanceTutorial(state, beats, { confirm: true }).state;
    state = advanceTutorial(state, beats, { contentSeen: true }).state;
    expect(state.currentBeat).toBe("result");

    const failed = advanceTutorial(state, beats, { check: "fail" });
    expect(failed.ok).toBe(true);
    expect(failed.state.currentBeat).toBe("result");
    expect(failed.state.checkPassed).toBe(false);

    const passed = advanceTutorial(failed.state, beats, { check: "pass" });
    expect(passed.state.currentBeat).toBe("close");
    expect(passed.state.checkPassed).toBe(true);
  });

  it("closes only after a passed check, then completes on leave", () => {
    let state = begin();
    state = advanceTutorial(state, beats, { project: "echo" }).state;
    state = advanceTutorial(state, beats, {
      content: "Q: Hi? A: Hello.",
      workItemPath: "xbrief/proposed/echo.xbrief.json",
      confirm: true,
    }).state;
    state = advanceTutorial(state, beats, { confirm: true }).state;
    state = advanceTutorial(state, beats, { contentSeen: true }).state;
    state = advanceTutorial(state, beats, { check: "pass" }).state;
    expect(state.currentBeat).toBe("close");

    const closed = advanceTutorial(state, beats, { complete: true });
    expect(closed.state.currentBeat).toBe("leave");

    const left = advanceTutorial(closed.state, beats, {});
    expect(left.state.status).toBe("completed");
    expect(left.state.completedAt).not.toBeNull();
  });

  it("reset clears progress without re-arming the automatic offer", () => {
    const started = begin();
    const reset = resetTutorial(started);
    expect(reset.state.currentBeat).toBeNull();
    expect(reset.state.selectedProject).toBeNull();
    expect(shouldOfferTutorial(reset.state)).toBe(false);
    expect(reset.state.status).toBe("offered");
  });

  it("mid-tutorial skip moves one step without finishing", () => {
    let state = begin();
    state = advanceTutorial(state, beats, { project: "signal" }).state;
    const skipped = skipBeat(state, beats);
    expect(skipped.ok).toBe(true);
    expect(skipped.state.currentBeat).toBe("start");
    expect(skipped.state.status).toBe("in_progress");
  });
});
