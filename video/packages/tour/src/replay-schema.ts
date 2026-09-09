/*
  The Chrome DevTools Recorder user-flow format, as types.

  This is the one recording format that is standard, free and replayable: a person
  records a flow in Chrome with nothing installed, an agent writes the JSON by hand,
  and both replay with @puppeteer/replay. panoma video adopts it as the tour's
  interchange format so a tour is never trapped in its own step type — `toUserFlow`
  writes it and `fromUserFlow` reads it (see flow.ts).

  The types below are copied from @puppeteer/replay, src/Schema.ts, reduced to the
  members the engine reads or writes. The two `enum`s of the original are string-literal
  unions here because this repository compiles with `erasableSyntaxOnly`; the values
  are the same strings, so the JSON is identical.

  Copyright 2022 Google LLC
  SPDX-License-Identifier: Apache-2.0
  Source: https://github.com/puppeteer/replay/blob/main/src/Schema.ts
*/

export type Target = string;
export type Pattern = string;
/** A string points at the element; an array lists ancestors first, target last. */
export type Selector = string | string[];
export type FrameSelector = number[];

/** `StepType` in the original. */
export type StepType =
  | "change"
  | "click"
  | "close"
  | "customStep"
  | "doubleClick"
  | "emulateNetworkConditions"
  | "hover"
  | "keyDown"
  | "keyUp"
  | "navigate"
  | "scroll"
  | "setViewport"
  | "waitForElement"
  | "waitForExpression";

export interface NavigationEvent {
  type: "navigation";
  url?: Pattern;
  title?: Pattern;
}

export type AssertedEvent = NavigationEvent;

export interface BaseStep {
  type: StepType;
  timeout?: number;
  assertedEvents?: AssertedEvent[];
}

export interface StepWithTarget extends BaseStep {
  /** Defaults to main. */
  target?: Target;
}

export interface StepWithFrame extends StepWithTarget {
  /** Defaults to main frame. */
  frame?: FrameSelector;
}

export interface StepWithSelectors extends StepWithFrame {
  /*
    Alternative selectors that lead to one element: CSS, `aria/`, `xpath/`,
    `pierce/` and `text/`. A replayer is expected to try them all, because some go
    stale over time.
  */
  selectors: Selector[];
}

export type PointerDeviceType = "mouse" | "pen" | "touch";
export type PointerButtonType = "primary" | "auxiliary" | "secondary" | "back" | "forward";

export interface ClickAttributes {
  deviceType?: PointerDeviceType;
  button?: PointerButtonType;
  /** In px, relative to the top-left corner of the element content box. */
  offsetX: number;
  offsetY: number;
  /** Delay (ms) between mouse down and mouse up. Defaults to 50. */
  duration?: number;
}

export interface DoubleClickStep extends ClickAttributes, StepWithSelectors {
  type: "doubleClick";
}

export interface ClickStep extends ClickAttributes, StepWithSelectors {
  type: "click";
}

export interface HoverStep extends StepWithSelectors {
  type: "hover";
}

export interface ChangeStep extends StepWithSelectors {
  type: "change";
  value: string;
}

export interface KeyDownStep extends StepWithTarget {
  type: "keyDown";
  key: string;
}

export interface KeyUpStep extends StepWithTarget {
  type: "keyUp";
  key: string;
}

export interface CloseStep extends StepWithTarget {
  type: "close";
}

export interface SetViewportStep extends StepWithTarget {
  type: "setViewport";
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  isLandscape: boolean;
}

export interface ScrollPageStep extends StepWithFrame {
  type: "scroll";
  /** Absolute scroll x position in px. Defaults to 0. */
  x?: number;
  /** Absolute scroll y position in px. Defaults to 0. */
  y?: number;
}

export type ScrollElementStep = ScrollPageStep & StepWithSelectors;

export type ScrollStep = ScrollPageStep | ScrollElementStep;

export interface NavigateStep extends StepWithTarget {
  type: "navigate";
  url: string;
}

export interface CustomStepParams {
  type: "customStep";
  name: string;
  parameters: unknown;
}

export type CustomStep = (CustomStepParams & StepWithTarget) | (CustomStepParams & StepWithFrame);

export interface WaitForExpressionStep extends StepWithFrame {
  type: "waitForExpression";
  expression: string;
}

export interface WaitForElementStep extends StepWithSelectors {
  type: "waitForElement";
  operator?: ">=" | "==" | "<=";
  count?: number;
  visible?: boolean;
}

export type UserStep =
  | ChangeStep
  | ClickStep
  | HoverStep
  | CloseStep
  | CustomStep
  | DoubleClickStep
  | KeyDownStep
  | KeyUpStep
  | NavigateStep
  | ScrollStep
  | SetViewportStep;

export type AssertionStep = WaitForElementStep | WaitForExpressionStep;

export type Step = UserStep | AssertionStep;

export interface UserFlow {
  /** Human-readable title describing the recorded user flow. */
  title: string;
  /** Timeout in milliseconds. */
  timeout?: number;
  /** Attribute to build selectors from instead of regular CSS, e.g. `data-testid`. */
  selectorAttribute?: string;
  steps: Step[];
}
