/*
  The scene model: a scene is a pure function of the frame, expressed as a React tree
  and rendered to static HTML in Node. React here is a templating library with
  composition and context — no DOM, no state, no effects, and therefore nothing that
  could make frame 141 render differently twice.
*/
import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Format } from "@panoma/video-core";

export type FrameInfo = {
  frame: number;
  fps: number;
  durationInFrames: number;
  format: Format;
};

const FrameContext = createContext<FrameInfo | null>(null);

export function useFrame(): FrameInfo {
  const info = useContext(FrameContext);
  if (!info) throw new Error("useFrame() outside a rendered composition — is this element under renderFrameHtml()?");
  return info;
}

/**
 * A slice of time. Children exist only inside [from, from + durationInFrames), and
 * for them the clock restarts at zero — a scene written for "my first 12 frames"
 * composes anywhere on the timeline without knowing where it sits.
 */
export const Sequence: React.FC<{
  from?: number;
  durationInFrames?: number;
  name?: string;
  children: ReactNode;
}> = ({ from = 0, durationInFrames = Infinity, children }) => {
  const parent = useFrame();
  const local = parent.frame - from;
  if (local < 0 || local >= durationInFrames) return null;
  return (
    <FrameContext.Provider
      value={{
        ...parent,
        frame: local,
        durationInFrames: Number.isFinite(durationInFrames) ? durationInFrames : parent.durationInFrames - from,
      }}
    >
      {children}
    </FrameContext.Provider>
  );
};

/** The workhorse container: fills the canvas, stacks children in normal flow. */
export const AbsoluteFill: React.FC<{ style?: CSSProperties; children?: ReactNode }> = ({ style, children }) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      display: "flex",
      flexDirection: "column",
      ...style,
    }}
  >
    {children}
  </div>
);

/** A file from the composition's asset directory, by the URL the rasterizer serves. */
export function asset(path: string): string {
  return `/assets/${path.replace(/^\/+/, "")}`;
}

/** A recorded-session file (video, log) from the sessions mount. */
export function sessionAsset(path: string): string {
  return `/sessions/${path.replace(/^\/+/, "")}`;
}

/** One frame of one composition, as the HTML the rasterizer will paint. */
export function renderFrameHtml(element: ReactNode, info: FrameInfo): string {
  return renderToStaticMarkup(<FrameContext.Provider value={info}>{element}</FrameContext.Provider>);
}
