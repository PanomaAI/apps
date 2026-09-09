/*
  A product film assembled from the product's own pixels, used.

  One camera over the page. Every sprite — the 2x frame, the 8x clip of a control,
  the 5x clip of the menu it opened — is pinned to its CSS box of the viewport and
  drawn through one framing, so a zoom from a chevron to the menu hanging under it
  is a single move and never a cut. Pushed past the page's own pixels, the page
  dissolves into the dark stage and the control stands alone on a lit plate; pulled
  back, the page returns around it. That is how the reference launch films
  (Diffusion Studio, Scenivia) are built, and it is the whole difference between a
  film and a slideshow with mockups in it.

  ONE THING ON SCREEN AT A TIME. Each feature is a card and a shot: a bar of the
  claim alone on the stage, then two bars of the product alone — the control framed,
  the pointer arriving and at rest on it a beat before it presses, the push, the press
  on the beat, the result on the next downbeat, a menu unfolding from the control's
  own box or the page changing behind it, and the camera at rest on cause and effect
  while the shot runs out. Nothing is written over the product, and the product is not
  behind the words. Product first, the name inside five seconds, the exact logo last on
  a card of the opposite polarity.

  And nothing casts a shadow. No glow around a plate, no halo behind a letter, no
  vignette closing in on the frame: the eye is held by what moves and what is lit, and
  tests/house-style.test.ts fails a build that draws one.

  Nothing on screen is invented. The frames and clips are the page's own rendering
  (@panoma/video-capture); the words are the brief's lines; the result under a claim is the
  heading the interface answered with, quoted by fact id. The pointer follows the take's
  own click; a phone take has no pointer, and a tap blooms instead. The clock and every
  framing are arithmetic in timing.ts; this file only draws.
*/
import { AbsoluteFill, asset, interpolate, sessionAsset, spring, useFrame } from "@panoma/video-engine";
import type { Brief, Format, Line } from "@panoma/video-core";
import type { SessionLog } from "@panoma/video-capture";
import { Stage, cardSize, titleSize, typeScale } from "../lib/layout.tsx";
import { Arrive, Cursor, Ripple, SpotStage, Tap, hexRgba } from "../lib/Stagecraft.tsx";
import { useColor, useVeil } from "../lib/theme-context.tsx";
import {
  cursorArc,
  frameBox,
  framePoint,
  gridOf,
  keyFraming,
  keyRect,
  mixKey,
  pageArrival,
  spotlightSectionAt,
  unfoldProgress,
  unitCamera,
  type CameraKey,
  type CastBox,
  type CastStill,
  type PlaneFraming,
  type SpotlightPlan,
  type SpotlightUnit,
} from "./timing.ts";
import { danceWithin } from "./motion.ts";
import { dancedScale, pulseAt, type Pulse } from "./pulse.ts";

export type SpotlightTheme = {
  paper: string;
  card: string;
  ink: string;
  muted: string;
  faint: string;
  line: string;
  accent: string;
  good: string;
  inverted: { paper: string; ink: string; muted: string };
  fonts: { display: string; body: string; mono: string; editorial: string; wide: string };
  branded: { colors: boolean; accent: boolean };
};

export type SpotlightBrand = { name: string; theme: SpotlightTheme; logo?: string };

const textOf = (line: Line | undefined, lang: string) => (line ? (line.text[lang] ?? line.text[Object.keys(line.text)[0]] ?? "") : "");
const resultOf = (line: Line | undefined, lang: string) => (line?.result ? (line.result[lang] ?? line.result[Object.keys(line.result)[0]] ?? "") : "");
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeInOut = (t: number) => {
  const u = clamp01(t);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
};
const lerpBox = (a: CastBox, b: CastBox, t: number): CastBox => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  width: a.width + (b.width - a.width) * t,
  height: a.height + (b.height - a.height) * t,
});

/** A file of the page's pixels pinned to its CSS box, drawn through a framing, relative to `origin`. */
const Sprite: React.FC<{ file: string; box: CastBox; framing: PlaneFraming; origin: { x: number; y: number }; opacity: number; clip?: string }> = ({ file, box, framing, origin, opacity, clip }) => {
  if (opacity <= 0.001) return null;
  const b = frameBox(framing, box);
  return (
    <img
      src={sessionAsset(file)}
      style={{ position: "absolute", left: b.x - origin.x, top: b.y - origin.y, width: b.width, height: b.height, display: "block", opacity, clipPath: clip }}
    />
  );
};

export const FeatureSpotlight: React.FC<{
  brief: Brief;
  hook: Line;
  lang: string;
  format: Format;
  session: SessionLog;
  desktop?: SessionLog;
  mobile?: SessionLog;
  plan: SpotlightPlan;
  brand: SpotlightBrand;
  /** The music's pulse (pulse.ts), when the brief brought a track. Absent, the piece is exactly what it was. */
  pulse?: Pulse;
}> = ({ brief, hook, lang, format, session, plan, brand, pulse }) => {
  const { frame, fps } = useFrame();
  const grid = gridOf(brief);
  const beat = grid.beatFrames;
  const tick = grid.tickFrames;
  const section = spotlightSectionAt(plan, frame);
  const local = frame - section.from;
  const span = section.to - section.from;
  /* The beat, this frame. The spotlight is wordless, so it dances at full gain. */
  const at = pulseAt(pulse, frame);
  /*
    The brand still supplies the NAME, the logo and the fonts — the things a
    measurement of the product can give and a derivation cannot. Every colour comes
    from the direction, which knows which swatch it is allowed to trust.
  */
  const film = useColor();
  const { pop } = useVeil();
  const theme = { ...brand.theme, accent: film.accent };
  const unit = typeScale(format);
  const cu = Math.min(format.width, format.height) / 100;

  /*
    The stage is the DIRECTION's, which is the product's own ground pushed just far
    enough away from itself that its recorded pixels have an edge on it.

    Until 2026-09-03 this line read `isDark(theme.paper) ? theme : theme.inverted`: a
    light product was inverted and its film shot on near-black, because a light
    interface on a light stage disappears. That was true when the stage was a copy of
    the product's background; the direction's separation rule solved the same problem
    without throwing the colour away, and shooting a light product's film dark is the
    one thing this whole movement exists to stop. The close still flips polarity, as
    the reference films do — that is an ending, not a ground.
  */
  const stage = { paper: film.paper, ink: film.ink, muted: film.muted };
  /*
    And a CARD is the opposite polarity, as the close already was.

    Not decoration: with the claim, the product and the wordmark all on one light-grey
    ground, ninety per cent of every frame in the piece was the same colour — so the
    cuts between them scored 5.8 to 9.5 on scdet against a threshold of 10, and the
    review said, correctly, that a cut the plan declared was not visible in the file. A
    card that flips the ground is a cut nobody can miss, and it gives the piece the
    dark-light-dark rhythm the reference films are built on.
  */
  const closing = film.inverted;
  const card = section.kind === "card" || section.kind === "end";
  const viewport: CastBox = { x: 0, y: 0, width: session.viewport.width, height: session.viewport.height };
  const vw = viewport.width;
  const vh = viewport.height;
  const name = brand.name || textOf(hook, lang).replace(/\s+v?\d.*$/i, "");
  const radius = cu * 1.4;

  const logoTile = (size: number) =>
    brand.logo ? (
      <div
        style={{
          width: size,
          height: size,
          margin: `0 auto ${size * 0.32}px`,
          padding: size * 0.18,
          boxSizing: "border-box",
          borderRadius: size * 0.26,
          background: theme.paper,
        }}
      >
        <img src={asset(brand.logo)} style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} />
      </div>
    ) : null;

  /** The accent rule that grows under a card's words. A bar of light, not a glowing one. */
  const rule = (at: number) => (
    <div
      style={{
        width: interpolate(at, [0, beat * 2], [unit * 2, unit * 16], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        height: Math.max(3, unit * 0.42),
        margin: `${unit * 3.4}px auto 0`,
        borderRadius: 999,
        background: card ? closing.ink : theme.accent,
      }}
    />
  );

  /** The page, full canvas, through a key: the open and the kicker. */
  const pageWide = (still: CastStill | undefined, key: CameraKey, scrim: number) =>
    still ? (
      <>
        <Sprite file={still.file} box={viewport} framing={keyFraming(key)} origin={{ x: 0, y: 0 }} opacity={1} />
        {scrim > 0.001 ? <AbsoluteFill style={{ background: hexRgba(stage.paper, scrim) }} /> : null}
      </>
    ) : null;

  /* ---------- one use ---------- */

  /*
    The product, alone. Nothing is written over a use: not the claim, not the
    interface's own answer on a chip, not a counter. The card before it said what
    this is; this shot proves it, and the frame belongs to the product for as long
    as it lasts.
  */
  const use = (u: SpotlightUnit) => {
    /*
      And it does not spring in. Every use is cut to from its own card, and a plate that
      scales up over a beat turns that cut into a dissolve — the one soft edge in a piece
      whose energy is its cuts. The camera's own arrival push is the movement.
    */
    const { key } = unitCamera(u, frame, beat);
    const F = keyFraming(key);
    const rect = keyRect(key);
    const origin = { x: rect.x, y: rect.y };
    const macro = u.macro;
    const pressAge = frame - u.press;

    /* Which frame of the page is under the camera, and how much of it shows at this scale. */
    const pageStill = frame < u.result ? u.before : (u.after ?? u.before);
    let page = pageArrival(u, key.k, frame, beat);
    if (u.form === "menu") page = 0;

    /*
      The control's own plane: its clip, then — on the frame of the press, as one
      swap — its after-state; gone once the page carries the same pixels. The menu
      unfolds once the camera is down to its clip's own pixels, never before
      (timing.ts, unfoldFrom).
    */
    const pressedIn = u.clicked && macro?.afterControl && pressAge >= 0 ? 1 : 0;
    let plane = 1 - page;
    if (u.form === "menu") plane = 1;
    const unfold = unfoldProgress(u, frame, beat);
    if (u.form === "menu" && frame >= u.unfoldFrom) plane *= 1 - clamp01((unfold - 0.12) / 0.3);
    /* The plate gives under the press and comes back. */
    const pressBump = u.clicked && pressAge >= 0 ? 1 - 0.02 * Math.exp(-pressAge / 3) : 1;

    /* The after-state of a menu unfolds from the control's own box outward. */
    let afterPlane: React.ReactNode = null;
    if (u.form === "menu" && macro?.after && frame >= u.unfoldFrom && key.k <= macro.after.pixelRatio + 1e-9) {
      const visible = lerpBox(macro.box, macro.after.box, unfold);
      const box = macro.after.box;
      const inset = [visible.y - box.y, box.x + box.width - (visible.x + visible.width), box.y + box.height - (visible.y + visible.height), visible.x - box.x].map((v) => `${(Math.max(0, v) * F.k).toFixed(2)}px`);
      /* In over a beat from nothing, not on a frame: its pixels are the control's at another ratio, and a fifth of a menu on one frame reads as a cut. */
      const alpha = clamp01((frame - u.unfoldFrom) / beat);
      afterPlane = <Sprite file={macro.after.file} box={box} framing={F} origin={origin} opacity={alpha} clip={`inset(${inset.join(" ")})`} />;
    }

    /*
      The pointer: in from below the plate, on the control a beat before the press,
      and it stays there. It used to be teleported into place from the second use on,
      because the travel that ended the previous use had carried it here; there is no
      travel any more, so every use brings its own pointer in and the arrival is the
      same shot every time.
    */
    const w = vw;
    const h = vh;
    const target = framePoint(F, u.fx * w, u.fy * h);
    const pointerSize = Math.min(cu * 16, Math.max(cu * 2.4, key.k * 20));
    let pointer: { x: number; y: number; opacity: number } | null = null;
    if (u.clicked && !session.isMobile && frame >= u.pointerFrom) {
      const start = { x: rect.x + rect.width * 0.92 + cu * 6, y: rect.y + rect.height + cu * 10 };
      const go = spring({ frame: frame - u.pointerFrom, fps, durationInFrames: Math.max(6, u.pushFrom - u.pointerFrom - tick), config: { damping: 15, stiffness: 90, mass: 1 } });
      pointer = { ...cursorArc(start, target, clamp01(go)), opacity: clamp01((frame - u.pointerFrom) / tick) };
    }
    /* The pointer gives on the press frame and springs back over the next few: the tutorial's curve, so a press looks the same in every recipe. */
    const pressed = u.clicked && pressAge >= 0 ? (pressAge < 2 ? (pressAge + 1) / 2 : Math.exp(-(pressAge - 2) / 3)) : 0;
    /* A finger has no travel to show: it gathers over the control from the moment a pointer would set off, and lifts a beat after the press. */
    const tapIn = u.clicked && session.isMobile ? clamp01((frame - u.pointerFrom) / Math.max(1, u.press - u.pointerFrom)) * (pressAge < beat ? 1 : clamp01(1 - (pressAge - beat) / tick)) : 0;

    /*
      And the plate pumps with the kick — as far as the files on it have room. The plan
      keeps every key at or under the ratio of what it draws (tests/timing.test.ts walks
      every frame for it), and a two per cent pump on top of a control at its own 8x would
      draw it past its pixels. So the dance is bounded by the tightest ratio on screen this
      frame: at the press, where the clip is at its ratio exactly, it is nothing; on the
      page at rest it has the room the drift left.
    */
    const ratios = [
      ...(pageStill && page > 0.001 ? [pageStill.pixelRatio] : []),
      ...(macro && plane > 0.001 ? [macro.pixelRatio] : []),
      ...(afterPlane && macro?.after ? [macro.after.pixelRatio] : []),
    ];
    const dance = danceWithin(dancedScale(at), key.k, ratios);

    return (
      <div
        style={{
          position: "absolute",
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          borderRadius: Math.min(radius, rect.width / 2, rect.height / 2),
          overflow: "hidden",
          background: hexRgba(theme.paper, page),
          transform: `scale(${(pressBump * dance).toFixed(4)})`,
          transformOrigin: "50% 50%",
          /*
            A hairline, drawn inside: the plate needs an edge against the stage, and an
            `inset` box-shadow is a border that does not resize the box its sprites are
            pinned to. What used to be here as well — an accent glow that breathed
            through the beats and a soft dark drop under the plate — is gone. Nothing
            in this film casts a shadow (tests/house-style.test.ts).
          */
          boxShadow: `inset 0 0 0 1px ${pop(0.14)}`,
        }}
      >
        {pageStill ? <Sprite file={pageStill.file} box={viewport} framing={F} origin={origin} opacity={page} /> : null}
        {macro ? <Sprite file={macro.file} box={macro.box} framing={F} origin={origin} opacity={plane * (1 - pressedIn)} /> : null}
        {macro?.afterControl ? <Sprite file={macro.afterControl.file} box={macro.box} framing={F} origin={origin} opacity={plane * pressedIn} /> : null}
        {afterPlane}
        {/* The pointer, the tap and the ring live in the page's space too, and the plate clips them like everything else on it. */}
        {u.clicked ? <Ripple x={target.x - origin.x} y={target.y - origin.y} size={pointerSize * 1.6} age={pressAge / beat} color={theme.accent} /> : null}
        {tapIn > 0 ? <Tap x={target.x - origin.x} y={target.y - origin.y} size={pointerSize * (1.9 - 0.5 * tapIn)} opacity={tapIn * (pressAge >= 0 ? 1 : 0.85)} /> : null}
        {pointer ? <Cursor x={pointer.x - origin.x} y={pointer.y - origin.y} size={pointerSize} press={pressed} opacity={pointer.opacity} /> : null}
      </div>
    );
  };

  /* ---------- the piece ---------- */

  return (
    <AbsoluteFill style={{ background: card ? closing.paper : stage.paper, overflow: "hidden" }}>
      {card ? null : <SpotStage paper={stage.paper} accent={theme.accent} intensity={section.kind === "unit" ? 0.85 : 1} {...(pulse ? { pulse: { beat: at.beat, energy: at.energy } } : {})} />}

      {section.kind === "open" &&
        pageWide(section.still, mixKey(section.camera.from, section.camera.to, easeInOut(local / Math.max(1, span))), 0.8 * clamp01((local - (span - beat)) / beat))}

      {section.kind === "kicker" && (
        <>
          {pageWide(section.still, section.camera, 0.8)}
          <Stage format={format} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: "100%", textAlign: "center" }}>
              {logoTile(unit * 10)}
              <Arrive text={textOf(hook, lang)} frame={local} from={0} step={tick} font={theme.fonts.display} size={titleSize(format, textOf(hook, lang))} color={stage.ink} align="center" weight={900} />
              {rule(local)}
            </div>
          </Stage>
        </>
      )}

      {/*
        The card: the claim, alone. The sweep is the cut's own light and the only
        motion the frame needs; the rule grows under the words while they land, and
        the interface's own answer — when the brief quoted one — sits under it in the
        small type, so the shot that follows can be nothing but the product.
      */}
      {section.kind === "card" &&
        (() => {
          const line = brief.lines.find((l) => l.id === section.id);
          const claim = textOf(line, lang);
          const result = resultOf(line, lang);
          /*
            And it moves. A card holds for two beats after its last word lands, and a
            card that is a perfect freeze is what the review counts as duplicate frames
            — rightly: it is a slide. The house rule that type does not move once it has
            landed is about type laid OVER a picture; here the type IS the picture, which
            is the exemption `KineticQuote` already takes. Two per cent across the card.
          */
          /* And with a track, the type pumps with the kick: the same impulse the camera gets, on the card's scale. */
          const drift = (1 + 0.022 * clamp01(local / Math.max(1, span))) * dancedScale(at);
          return (
            <>
              <Stage format={format} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ width: "100%", textAlign: "center", transform: `scale(${drift.toFixed(4)})` }}>
                  {/*
                    The whole claim on the frame of the cut, not a word per tick.

                    `Arrive` keeps every word's space from the first frame so the line
                    never reflows under itself, which over footage is exactly right — the
                    words arrive into a picture that is already there. On a card there is
                    no picture: for the first second the frame was one word sitting left
                    of centre in an empty field, waiting for a line that had not arrived.
                    The card IS the cut, and the line is what the cut delivers.
                  */}
                  <Arrive text={claim} frame={local} from={0} step={0} font={theme.fonts.display} size={cardSize(format, claim)} color={closing.ink} align="center" weight={900} />
                  {result ? (
                    <div
                      style={{
                        marginTop: unit * 2.4,
                        fontFamily: theme.fonts.mono,
                        fontSize: Math.round(unit * 2.2),
                        fontWeight: 650,
                        letterSpacing: "0.14em",
                        textTransform: "uppercase",
                        color: closing.muted,
                        opacity: clamp01((local - beat) / tick),
                      }}
                    >
                      {result}
                    </div>
                  ) : null}
                  {rule(local)}
                </div>
              </Stage>
            </>
          );
        })()}

      {section.kind === "unit" && use(section)}

      {section.kind === "end" &&
        (() => {
          const endLine = brief.lines.find((line) => line.id === section.id);
          const address = textOf(endLine, lang);
          const typed = address.slice(0, Math.round(interpolate(local, [tick, beat * 2], [0, address.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })));
          return (
            <Stage format={format} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ textAlign: "center", width: "100%", transform: `scale(${dancedScale(at).toFixed(4)})` }}>
                {logoTile(unit * 12)}
                <div style={{ fontFamily: theme.fonts.display, fontSize: titleSize(format, name), fontWeight: 900, letterSpacing: "-0.045em", color: closing.ink }}>{name}</div>
                {address ? (
                  <div style={{ marginTop: unit * 2.6, fontFamily: theme.fonts.mono, fontSize: unit * 2.6, letterSpacing: "0.04em", color: closing.muted, minHeight: unit * 3.4 }}>
                    {typed}
                    <span style={{ opacity: Math.floor(local / 8) % 2 === 0 && typed.length < address.length ? 1 : 0 }}>_</span>
                  </div>
                ) : null}
                <div style={{ width: unit * 8, height: Math.max(3, unit * 0.5), borderRadius: 999, margin: `${unit * 3.4}px auto 0`, background: closing.ink }} />
              </div>
            </Stage>
          );
        })()}
    </AbsoluteFill>
  );
};
