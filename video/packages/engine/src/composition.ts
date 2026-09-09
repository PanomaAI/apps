/*
  What the engine renders. A composition owns its clock (fps, duration), its canvas
  (the Format), its audio clips, and an element factory. The factory is called once;
  the element is re-rendered against a different FrameInfo per frame — components
  read the clock through useFrame(), never through props that could go stale.
*/
import type { ReactNode } from "react";
import type { Format } from "@panoma/video-core";
import type { AudioClip } from "./encoder.ts";

export type CompositionDef = {
  id: string;
  format: Format;
  fps: number;
  durationInFrames: number;
  /** Musical clock exposed to Studio; recipes still own their timing arithmetic. */
  timeline?: {
    bpm: number;
    beatFrames: number;
    tickFrames: number;
    start: number;
  };
  audio: AudioClip[];
  element: () => ReactNode;
};
