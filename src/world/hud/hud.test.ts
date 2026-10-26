import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EMBOSS_TOKENS, embossTokensCss, hapticFeedback } from "./embossTokens.ts";
import { evaluateNeeds, primaryNeedAction, type NeedKey } from "./needsChips.ts";
import { bindHotkeys } from "./hotkeys.ts";

describe("embossTokens", () => {
  it("EMBOSS_TOKENS has required design tokens", () => {
    const required = ["--e-bg", "--e-surface", "--e-hi", "--e-lo", "--e-accent", "--e-fg", "--e-shadow-out", "--e-shadow-in"];
    for (const key of required) {
      assert.ok(key in EMBOSS_TOKENS, `Missing token ${key}`);
      assert.ok(EMBOSS_TOKENS[key].length > 0, `Token ${key} must not be empty`);
    }
  });

  it("embossTokensCss produces valid :root block", () => {
    const css = embossTokensCss();
    assert.ok(css.startsWith(":root {"), "Must start with :root {");
    assert.ok(css.includes("--e-bg:"), "Must include --e-bg");
    assert.ok(css.includes("--e-accent:"), "Must include --e-accent");
    assert.ok(css.endsWith("}"), "Must end with }");
  });

  it("hapticFeedback does not throw without navigator", () => {
    // In Node, navigator is undefined — should be a silent no-op
    assert.doesNotThrow(() => hapticFeedback("tap"));
    assert.doesNotThrow(() => hapticFeedback("press"));
    assert.doesNotThrow(() => hapticFeedback("warning"));
  });
});

describe("needsChips", () => {
  it("evaluateNeeds: critical when value < 25", () => {
    const result = evaluateNeeds({ hunger: 20, energy: 80, hygiene: 90, social: 70, comfort: 60, health: 50 });
    const hunger = result.chips.find((c) => c.key === "hunger")!;
    assert.equal(hunger.critical, true);
    assert.equal(hunger.warning, false);
    assert.equal(result.urgentActionRequired, true);
    assert.equal(result.lowestNeed?.key, "hunger");
  });

  it("evaluateNeeds: warning when 25 <= value < 45", () => {
    const result = evaluateNeeds({ hunger: 30, energy: 80, hygiene: 90, social: 70, comfort: 60, health: 50 });
    const hunger = result.chips.find((c) => c.key === "hunger")!;
    assert.equal(hunger.critical, false);
    assert.equal(hunger.warning, true);
    assert.equal(result.urgentActionRequired, false);
  });

  it("evaluateNeeds: no warnings when all needs >= 45", () => {
    const result = evaluateNeeds({ hunger: 80, energy: 80, hygiene: 90, social: 70, comfort: 60, health: 50 });
    assert.equal(result.urgentActionRequired, false);
    for (const chip of result.chips) {
      assert.equal(chip.critical, false);
      assert.equal(chip.warning, false);
    }
  });

  it("evaluateNeeds: lowestNeed picks the smallest value", () => {
    const result = evaluateNeeds({ hunger: 50, energy: 10, hygiene: 90, social: 70, comfort: 60, health: 50 });
    assert.equal(result.lowestNeed?.key, "energy");
    assert.equal(result.lowestNeed?.value, 10);
  });

  it("evaluateNeeds: clamps values to [0, 100]", () => {
    const result = evaluateNeeds({ hunger: -10, energy: 150, hygiene: 50, social: 50, comfort: 50, health: 50 });
    const hunger = result.chips.find((c) => c.key === "hunger")!;
    const energy = result.chips.find((c) => c.key === "energy")!;
    assert.equal(hunger.value, 0);
    assert.equal(energy.value, 100);
  });

  it("evaluateNeeds: missing keys default to 100", () => {
    const result = evaluateNeeds({});
    assert.equal(result.urgentActionRequired, false);
    for (const chip of result.chips) {
      assert.equal(chip.value, 100);
    }
  });

  it("primaryNeedAction returns correct mapping per need key", () => {
    const keys: NeedKey[] = ["hunger", "energy", "hygiene", "social", "comfort", "health"];
    const expected: Record<NeedKey, string> = {
      hunger: "stall",
      energy: "bench",
      hygiene: "standpipe",
      social: "walker",
      comfort: "bench",
      health: "chemist",
    };
    for (const key of keys) {
      const action = primaryNeedAction({ key, value: 10, critical: true, warning: false, label: key });
      assert.equal(action.targetKind, expected[key], `${key} should target ${expected[key]}`);
      assert.ok(action.actionLabel.length > 0, `${key} should have an action label`);
    }
  });

  it("primaryNeedAction: null lowest returns All good", () => {
    const action = primaryNeedAction(null);
    assert.equal(action.actionLabel, "All good");
    assert.equal(action.voucherCost, 0);
  });
});

describe("hotkeys", () => {
  it("bindHotkeys returns a cleanup function", () => {
    const unbind = bindHotkeys({});
    assert.equal(typeof unbind, "function");
    // Should not throw
    unbind();
  });

  it("bindHotkeys calls handlers for correct keys", () => {
    // Simulate minimal globalThis.window for Node
    const listeners: ((e: KeyboardEvent) => void)[] = [];
    const origWindow = globalThis.window;
    globalThis.window = {
      addEventListener: ((_: string, fn: (e: KeyboardEvent) => void) => listeners.push(fn)) as any,
      removeEventListener: () => {},
    } as any;

    let hudToggled = 0;
    let cameraCycled = 0;
    let dismissed = 0;

    const unbind = bindHotkeys({
      onToggleHud: () => hudToggled++,
      onCycleCamera: () => cameraCycled++,
      onDismiss: () => dismissed++,
    });

    assert.equal(listeners.length, 1);
    const fire = (key: string) => listeners[0]({ key, target: { tagName: "DIV" } } as unknown as KeyboardEvent);

    fire("h");
    assert.equal(hudToggled, 1);
    fire("H");
    assert.equal(hudToggled, 2);
    fire("c");
    assert.equal(cameraCycled, 1);
    fire("Escape");
    assert.equal(dismissed, 1);

    // Input element should be ignored
    listeners[0]({ key: "h", target: { tagName: "INPUT" } } as unknown as KeyboardEvent);
    assert.equal(hudToggled, 2, "Should not fire inside INPUT");

    unbind();
    globalThis.window = origWindow;
  });
});
