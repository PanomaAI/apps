/*
  The board, on screen.

  Every other recipe here renders a film out of things the engine owns: a recording it made, a
  voice it generated, type on a stage. This one renders a BOARD, and some of its shots are
  clips that do not exist yet — because a video model bills per second and the whole point
  of a storyboard is that it is read, and watched, before anything is bought.

  So the same component is both halves of the workflow:

  - THE ANIMATIC. With no clips on disk, a commissioned shot renders as its own PANEL: the
    real frame the model was going to be conditioned on, held, with the move written across
    it. That is not a placeholder — it is the first frame of the shot, exactly, because the
    panel is the conditioning image. Everything around it is already final. What you watch
    is the finished film with its unshot moves standing still, which is what an animatic has
    always been and why every production makes one before it books a camera.
  - THE FILM. With clips on disk the panels are replaced by the clips and nothing else about
    the piece changes.

  What was here before and is gone: the plate — a generated room painted behind an inset
  screenshot. Two layers with two light sources read as a sticker on wallpaper however good
  the room is, and it was the wrong answer to the right question. A shot that wants movement
  on the product now gets it the honest way: the model is handed the real frame at one mark
  and the real frame at the next, and asked only to move the camera between them.
*/
import { AbsoluteFill, asset, useFrame } from "@panoma/video-engine";
import type { Brief, Format } from "@panoma/video-core";
import { SCENE_MATERIALS } from "@panoma/video-core/theme";
import type { SessionLog } from "@panoma/video-capture";
import type { Shot, Board } from "@panoma/video-gen";
import { display, mono } from "../lib/fonts.ts";
import { KineticCaptions, type Word } from "../lib/captions.tsx";
import { KineticTitle } from "../lib/KineticTitle.tsx";
import { ProductWindow } from "../lib/ProductWindow.tsx";
import { Stage, captionSize, cardSize } from "../lib/layout.tsx";
import { useColor, useVeil } from "../lib/theme-context.tsx";
import { boardShotAt, boardSourceAt, castFrame, cameraTransform, gridOf, type BoardPlan } from "./timing.ts";

export const Storyboard: React.FC<{
  brief: Brief;
  lang: string;
  format: Format;
  board: Board;
  plan: BoardPlan;
  /** The recording the captured shots play. */
  session?: SessionLog;
  /*
    The clips that exist, by shot number, as paths RELATIVE to the assets mount.

    Not absolute paths: the rasterizer paints inside a page served from the asset server's
    own origin, and a browser will not load a `file://` from there — it fails with "video
    failed" and no other explanation, which is exactly how the first five commissioned shots
    were bought and then not rendered.
  */
  clips?: Record<number, string>;
  /** Panel pictures, by shot number, relative to the same mount. The animatic's material. */
  panels?: Record<number, string>;
  voiced?: { words: Word[] };
}> = ({ brief, lang, format, board, plan, session, clips, panels, voiced }) => {
  const color = useColor();
  const veil = useVeil();
  const grid = gridOf(brief);
  const { frame, fps } = useFrame();
  const unit = Math.min(format.width, format.height) / 100;
  const cap = captionSize(format);

  const at = boardShotAt(plan, frame);
  const shot: Shot | undefined = at ? board.shots.find((s) => s.n === at.n) : undefined;
  if (!at || !shot) return <AbsoluteFill style={{ background: color.paper }} />;

  const local = frame - at.from;
  const second = boardSourceAt(at, frame, fps);
  /* A card is the opposite polarity of the shot beside it — the house rule, and the cut. */
  const inverted = { paper: color.inverted.paper, ink: color.inverted.ink, muted: color.inverted.muted };
  const isCard = shot.origin === "card";
  const ground = isCard ? inverted.paper : color.paper;
  const clip = clips?.[shot.n];
  const panel = panels?.[shot.n];

  /*
    A bought shot fills the frame and nothing is written over it.

    It is the one picture in the film whose middle nobody can vouch for — the model redraws
    the interface between the two real frames it was given — so it is never also carrying a
    claim. The words go on the shots that are photographs.
  */
  const bought = shot.origin === "generated" && clip !== undefined && (
    <AbsoluteFill style={{ background: SCENE_MATERIALS.generatedMatte }}>
      <canvas
        data-video={asset(clip)}
        data-seek={second.toFixed(4)}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
      />
    </AbsoluteFill>
  );

  /*
    The panel, standing in for the shot that has not been bought.

    It is the real conditioning frame, held, with the notation over it — so the animatic
    shows the truth of the shot and marks only what is missing, which is the movement. A
    slate with a sentence on it would have told you less than the picture already does.
  */
  const still = shot.origin === "generated" && clip === undefined && panel !== undefined && (
    <AbsoluteFill style={{ background: SCENE_MATERIALS.generatedMatte }}>
      <img src={asset(panel)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      {/*
        The notation sits on the film's OWN stage, not on a scrim over the panel.

        A scrim is for contrast against footage whose brightness you do not control, and it
        fails here in the one case that matters: a light interface under a light product's
        scrim leaves light type on light type. The film's stage and its ink are a pair that
        is legible by construction, because every other frame in the piece already uses it.

        And it sits at the TOP, because the caption is at the bottom and the animatic is the
        one place in the film where both are on screen at once.
      */}
      <Stage format={format} style={{ display: "flex", flexDirection: "column", justifyContent: "flex-start", paddingTop: unit * 5 }}>
        <div style={{ background: veil.ground(0.93), padding: `${unit * 2}px ${unit * 2.4}px`, borderRadius: unit * 0.8, alignSelf: "flex-start", maxWidth: "78%" }}>
          <div style={{ fontFamily: mono, fontSize: unit * 1.5, letterSpacing: "0.14em", color: color.accent, marginBottom: unit * 1.2 }}>
            {`SHOT ${shot.n} · ${shot.panels.map((p) => p.id).join(" → ")} · NOT BOUGHT · ${shot.gen?.seconds ?? 0}s AT ${shot.move.toUpperCase()}`}
          </div>
          <div style={{ fontFamily: display, fontWeight: 800, fontSize: unit * 3.2, lineHeight: 1.15, color: color.ink, textWrap: "balance" }}>
            {shot.gen?.motion ?? shot.subject}
          </div>
          <div style={{ width: unit * 8, height: Math.max(3, unit * 0.4), borderRadius: 999, background: color.accent, marginTop: unit * 1.8 }} />
        </div>
      </Stage>
    </AbsoluteFill>
  );

  /* The product: the film's evidence, on the film's own stage, played from its mark. */
  const win = session ? castFrame(format, session.viewport, { isMobile: session.isMobile }) : null;
  /*
    And the engine's own camera moves on it. A push is what a viewer reads as "look here", and on
    a captured shot it is arithmetic over pixels that are real — which is why it stays here
    and is not something the film pays a model for.
  */
  const through = Math.min(1, Math.max(0, local / Math.max(1, at.to - at.from)));
  const push = 1.04 + 0.05 * through;
  const product = shot.origin === "captured" && session && win && (
    <ProductWindow
      format={format}
      take={session}
      win={win}
      videoSec={second}
      zoom={cameraTransform({ framing: { fx: 0.5, fy: 0.45, scale: push }, tilt: { rx: 0, ry: 0 }, entering: 1, enter: "cut", shot: at.n })}
      enter={1}
    />
  );

  const card = isCard && shot.text && (
    <Stage format={format} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "100%", textAlign: "center" }}>
        <KineticTitle
          text={shot.text[lang] ?? Object.values(shot.text)[0] ?? ""}
          size={cardSize(format, shot.text[lang] ?? Object.values(shot.text)[0] ?? "")}
          voice="editorial"
          step={0}
          from={at.from}
          color={inverted.ink}
          plate={false}
        />
      </div>
    </Stage>
  );

  return (
    <AbsoluteFill style={{ background: ground }}>
      {bought}
      {still}
      {product}
      {card}
      {/*
        Captions run over the product and over a bought shot, and never over a card — a card
        IS the sentence, and captioning it is the same words twice. The same rule the
        tutorial follows, for the same measured reason.
      */}
      {!isCard && voiced ? <KineticCaptions words={voiced.words} at={0.8} size={cap} /> : null}
      {void grid}
    </AbsoluteFill>
  );
};
