/* A promise earns its payoff through a continuous recording and explicitly selected presentation treatments. */
import { AbsoluteFill, useFrame } from "@panoma/video-engine";
import { type Brief, type Format, type Line } from "@panoma/video-core";
import type { SessionLog } from "@panoma/video-capture";
import { ProductWindow } from "../lib/ProductWindow.tsx";
import { PromoFocus, PromoRecap, PromoSideText, PromoSource } from "../lib/PromoEffects.tsx";
import { PromoTitle } from "../lib/PromoTitle.tsx";
import { GridTexture } from "../lib/GridTexture.tsx";
import { GridRecap } from "../lib/GridRecap.tsx";
import { useColor } from "../lib/theme-context.tsx";
import { cursorAtMs, cursorPathOf } from "./motion.ts";
import { cameraAt, cameraTransform, castFrame, gridOf, promoSectionAt, promoSourceAt, type CastShot, type PromoPlan } from "./timing.ts";
import { promoFocusOpacity, promoPanelLayout, promoRowState, promoTypedCount } from "./presentation.ts";
import { promoGridGround, promoThemeTokens } from "./editorial.ts";

export const ProductPromo: React.FC<{
  brief: Brief;
  hook: Line;
  lang: string;
  format: Format;
  session: SessionLog;
  plan: PromoPlan;
  shots: CastShot[];
}> = ({ brief, format, session, plan, shots }) => {
  const { frame, fps } = useFrame();
  const color = useColor();
  const section = promoSectionAt(plan, frame);
  const live = section.kind === "proof" || section.kind === "preview";
  const baseGround = live || section.from === 0 ? color : color.inverted;
  const ground = brief.promo?.theme === "grid" ? { ...baseGround, ...promoGridGround(baseGround) } : baseGround;
  /* This id belongs to the entire brief. Only the added editorial pieces read it;
     the recorded product keeps its existing direction, source clock and camera. */
  const design = promoThemeTokens(brief.promo?.theme, ground, color.accent);
  const camera = cameraAt(shots, frame, gridOf(brief).beatFrames);
  /* An old undersized take may have to sit below scale one. The general cast transform assumes fill. */
  const zoom = camera.framing.scale < 1 ? { scale: camera.framing.scale, dx: 0, dy: 0 } : cameraTransform(camera);
  const videoSec = promoSourceAt(plan, session, frame, fps);
  const split = section.kind === "proof" && section.treatment === "split";
  const panel = split ? promoPanelLayout(format, session.viewport, { isMobile: session.isMobile, videoRatio: session.videoRatio }) : undefined;
  const win = panel?.product ?? castFrame(format, session.viewport, { isMobile: session.isMobile });
  const focusOpacity = section.kind === "proof" ? promoFocusOpacity(section, shots, frame, fps) : 0;
  const pulseFrames = Math.max(6, Math.round(fps * 0.3));
  const press = section.kind === "proof" ? section.presses.map((p) => ({ p, age: (frame - p.frame) / pulseFrames })).find(({ age }) => age >= 0 && age < 1) : undefined;
  const pointer = section.kind === "proof" ? cursorAtMs(cursorPathOf(session, fps), session, fps, videoSec * 1000) : null;
  const give = press ? Math.exp(-(frame - press.p.frame) / 3) : 0;
  const sourceEntrance = section.kind === "terminal" || section.kind === "code"
    ? Math.max(0, Math.min(1, (frame - section.from) / Math.max(1, (section.typingFrom ?? section.from) - section.from))) : 1;

  return (
    <AbsoluteFill style={{ background: ground.paper }}>
      <div data-promo-theme={design.id} style={{ position: "absolute", inset: 0 }}>
      {design.id === "grid" && !live && <GridTexture format={format} ink={ground.ink} overProduct={false} />}
      {live ? (
        <ProductWindow
          format={format}
          lint="ignore"
          take={{ video: session.video, viewport: session.viewport, url: "" }}
          win={win}
          videoSec={videoSec}
          zoom={zoom}
          enter={1}
          tilt={camera.tilt}
          cursor={pointer ? { ...pointer, press: give } : null}
          ripple={press ? { x: press.p.x, y: press.p.y, age: press.age } : null}
          over={section.kind === "proof" && section.focusBox ? <PromoFocus box={section.focusBox} viewport={session.viewport} content={win.content} zoom={zoom} opacity={focusOpacity} /> : undefined}
        />
      ) : section.kind === "recap" ? (
        design.id === "grid" ? <GridRecap format={format} title={section.text} rows={section.rows.map((row, index) => ({ ...row, ...promoRowState(section.rows, index, frame, fps, design.id) }))} colors={ground} design={design} /> : <PromoRecap format={format} title={section.text} rows={section.rows.map((row, index) => ({ ...row, ...promoRowState(section.rows, index, frame, fps, design.id) }))} colors={ground} theme={design.id} />
      ) : section.kind === "terminal" || section.kind === "code" ? (
        <PromoSource format={format} kind={section.kind} text={section.text} source={section.source} visibleCount={promoTypedCount(section.text, section.typingFrom ?? section.from, section.typingTo, frame)} caret={frame <= section.typingTo} colors={ground} theme={design.id} entrance={1 - (1 - sourceEntrance) ** 3} />
      ) : (
        <PromoTitle format={format} text={section.text} role={section.kind} from={section.from} to={section.to} frame={frame} fps={fps} beatFrames={gridOf(brief).beatFrames} theme={design.id} design={design} ink={ground.ink} />
      )}
      {design.id === "grid" && live && <GridTexture format={format} ink={ground.ink} overProduct={true} />}
      {split && panel && section.kind === "proof" && section.text && <PromoSideText format={format} rect={panel.text} text={section.text} ink={ground.ink} colors={ground} theme={design.id} />}
      </div>
    </AbsoluteFill>
  );
};
