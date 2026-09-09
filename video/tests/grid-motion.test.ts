import assert from "node:assert/strict";
import { test } from "node:test";
import { makeGrid, type Brief } from "@panoma/video-core";
import { promoAssemblyParts, promoAssemblyMotion, promoPlan, promoTitleEnterFrames, promoTitleSettledFrame, type TakeWithAssets } from "@panoma/video-render/timing";
import { promoRowArrivalFrames } from "../apps/render/src/recipes/presentation.ts";

test("phrase assembly preserves exact Unicode copy and shares a bounded tick clock at ordinary and prime tempos", () => {
  const lines = ["Cada proyecto, en su lugar.", "  Tu trabajo\nse reúne aquí.  ", "Código 👩🏽‍💻 y café", "Panoma", "", "A single extraordinarilylongword"];
  for (const fps of [24, 30, 60]) for (const beatFrames of [10, 13, 14, 15, 20, 30, 60]) {
    const grid = makeGrid({ fps, bpm: fps * 60 / beatFrames });
    const from = beatFrames * 2;
    const to = from + fps * 5;
    for (const text of lines) {
      const parts = promoAssemblyParts(text, from, to, grid);
      assert.equal(parts.map((part) => part.text).join(""), text, "no scramble, invented glyph, lost accent or whitespace");
      assert.ok(parts.length >= 1 && parts.length <= 3);
      const settled = promoTitleSettledFrame("grid", "benefit", from, to, fps, beatFrames);
      assert.ok(settled - from <= fps * 0.50, "slow music reduces arrivals instead of prolonging the effect");
      assert.equal(settled - from, promoTitleEnterFrames("grid", "benefit", fps, beatFrames));
      for (const [index, part] of parts.entries()) {
        assert.equal((part.from - from) % grid.tickFrames, 0);
        assert.ok(Number.isInteger(part.from) && Number.isInteger(part.settledAt) && part.settledAt <= settled);
        const rest = promoAssemblyMotion(part, index, settled);
        assert.equal(rest.opacity, 1);
        assert.equal(Math.abs(rest.x) + Math.abs(rest.y) + Math.abs(rest.rotate), 0);
        for (let frame = from; frame < to; frame++) {
          const state = promoAssemblyMotion(part, index, frame);
          assert.ok(Object.values(state).every(Number.isFinite));
          assert.ok(Math.abs(state.x) <= 0.085 && Math.abs(state.y) <= 0.08 && Math.abs(state.rotate) <= 11 && state.scale >= 0.8 && state.scale <= 1);
          if (frame >= settled) assert.deepEqual(state, rest, "no recurring drift interrupts reading");
        }
      }
      for (const [index, part] of promoAssemblyParts(text, 0, to, grid).entries()) {
        assert.equal(part.from, 0); assert.equal(part.settledAt, 0);
        assert.equal(promoAssemblyMotion(part, index, 0).opacity, 1, "first poster is fully composed");
      }
    }
  }
});

test("Grid brings a recap in as a quick cascade and budgets shared reading after every card lands", () => {
  const source: TakeWithAssets = { viewport: { width: 1920, height: 1080 }, durationMs: 9000, fps: 25, videoRatio: 2,
    marks: [{ name: "one", t: 1000 }, { name: "two", t: 5000 }],
    events: [{ kind: "click", t: 1400, x: 500, y: 300 }, { kind: "click", t: 5400, x: 700, y: 400 }],
  };
  for (const beatFrames of [13, 15, 20]) {
    const brief: Brief = { id: "deck", recipe: "ProductPromo", langs: ["es"], bpm: 1800 / beatFrames, fps: 30,
      hooks: [{ id: "hook", mode: "type", text: { es: "Tu proyecto, a mano" } }],
      lines: [{ id: "one", mark: "one", mode: "type", text: { es: "Encuentra tus proyectos" } }, { id: "two", mark: "two", mode: "type", text: { es: "Conserva el contexto de cada proyecto" } }, { id: "brand", mode: "type", text: { es: "Acme" } }, { id: "end", mode: "type", text: { es: "acme.example" } }],
      promo: { theme: "grid", opening: "promise", pace: "crisp", recap: true, evidence: { one: { mark: "one", facts: ["ui.one"] }, two: { mark: "two", facts: ["ui.two"] } } },
    };
    const grid = makeGrid({ fps: 30, bpm: brief.bpm });
    const recap = promoPlan(source, brief, brief.hooks[0], "es").sections.find((section) => section.kind === "recap")!;
    const ordinary = promoPlan(source, { ...brief, promo: { ...brief.promo!, theme: "flat" } }, brief.hooks[0], "es").sections.find((section) => section.kind === "recap")!;
    const gap = recap.rows[1].from - recap.rows[0].from;
    assert.ok(gap <= 30 * 0.5, "the second card arrives promptly instead of waiting for another reading interval");
    assert.equal(gap % grid.tickFrames, 0);
    assert.equal(recap.from % beatFrames, 0); assert.equal(recap.to % beatFrames, 0);
    const settled = recap.rows.at(-1)!.from + promoRowArrivalFrames(30, "grid");
    assert.ok((recap.to - settled) / 30 >= Math.max(1.2, ...recap.rows.map((row) => [...row.text].length / 22)), "speed comes from overlapping arrivals, not stealing the final reading hold");
    assert.ok(recap.to - recap.from < ordinary.to - ordinary.from, "a recalled pair does not pay two full sequential reading pauses");
  }
});

test("the automatic Grid timeline budgets reading after assembly and preserves continuous proof actions", () => {
  const source: TakeWithAssets = { viewport: { width: 1920, height: 1080 }, durationMs: 7000, fps: 25, videoRatio: 2,
    marks: [{ name: "open", t: 1000 }], events: [{ kind: "click", t: 1400, x: 500, y: 300 }],
    macros: [{ mark: "open", file: "open.png", pixelRatio: 4, box: { x: 400, y: 250, width: 200, height: 80 }, change: { box: { x: 200, y: 150, width: 900, height: 600 }, share: 0.3, boxShare: 0.5 }, resultAtMs: 1800 }],
  };
  const brief: Brief = { id: "grid", recipe: "ProductPromo", job: "sell", langs: ["es"], bpm: 1800 / 13, fps: 30,
    hooks: [{ id: "hook", mode: "type", text: { es: "Tu proyecto, a mano" } }],
    lines: [{ id: "open", mark: "open", mode: "type", text: { es: "Conserva el contexto de cada proyecto" } }, { id: "brand", mode: "type", text: { es: "Acme" } }, { id: "end", mode: "type", text: { es: "acme.example" } }],
    promo: { theme: "grid", opening: "promise", pace: "measured", evidence: { open: { mark: "open", facts: ["ui.open"] } } },
  };
  const grid = makeGrid({ fps: 30, bpm: brief.bpm });
  const plan = promoPlan(source, brief, brief.hooks[0], "es");
  const flat = promoPlan(source, { ...brief, promo: { ...brief.promo!, theme: "flat" } }, brief.hooks[0], "es");
  for (const section of plan.sections) {
    assert.equal(section.from % 13, 0); assert.equal(section.to % 13, 0);
    if (section.kind === "hook" || section.kind === "benefit" || section.kind === "end") {
      const readFrom = promoTitleSettledFrame("grid", section.kind, section.from, section.to, 30, grid.beatFrames);
      assert.ok([...section.text].length / ((section.to - readFrom) / 30) <= 22);
    }
    if (section.kind === "proof") {
      const original = flat.sections.find((part) => part.kind === "proof")!;
      assert.equal(original.kind, "proof");
      if (original.kind === "proof") for (const key of ["sourceFrom", "sourceTo", "playRate", "resultSource"] as const) assert.equal(section[key], original[key]);
      assert.ok(section.presses.every((press) => press.frame >= section.from && press.frame < section.to));
    }
  }
});
