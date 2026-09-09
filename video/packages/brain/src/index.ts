/*
  @panoma/video-brain — the judgement in the automatic path, pluggable and bounded.

  `openBrain` finds a driver (the claude or codex agent on the machine, or an
  Anthropic or OpenAI key), and `ask` turns one of the ten questions into a validated,
  cached, capped, logged answer. The questions are the whole interface: what the
  product is, what to click, what to say, how to fix a failing cut, how to post it.
  What the brain writes is audited downstream against the fact sheet, in the director,
  where an agent's patch is audited too.
*/
export { openBrain, detectBrain, BrainDeclined, BrainAnswerInvalid, BRAIN_CALL_CAP, BRAIN_CHOICES, BRAIN_TIMEOUT_MS, DRIVERS } from "./brain.ts";
export type { Brain, BrainChoice, Asked, Answer, Ledger, LedgerEntry, Detected, OpenBrainOptions } from "./brain.ts";
export { DRIVER_NAMES, DriverAnswerInvalid, onPath, modelFor, spawnWithStdin, parseJsonLoosely } from "./driver.ts";
export type { Driver, DriverName, Ask, Completion, Availability, Effort } from "./driver.ts";
export { claude, claudeArgs, CLAUDE_DEFAULT_MODEL } from "./drivers/claude.ts";
export { codex, codexArgs, CODEX_DEFAULT_MODEL } from "./drivers/codex.ts";
export { anthropic, anthropicRequest, ANTHROPIC_DEFAULT_MODEL, ANTHROPIC_URL } from "./drivers/anthropic.ts";
export { openai, openaiRequest, OPENAI_DEFAULT_MODEL, OPENAI_URL } from "./drivers/openai.ts";
export { QUESTION_VERSION, ThesisShape, RerankShape, WrittenShape, FixedShape, KitCopyShape, RouteShape, SlateShape, BrollShape, DirectShape, thesisQuestion, rerankQuestion, writeQuestion, fixQuestion, kitQuestion, lessonQuestion, slateQuestion, brollQuestion, directQuestion } from "./questions.ts";
export type { Thesis, ThesisInput, Rerank, RerankInput, Written, WriteInput, Fixed, FixInput, KitCopy, KitInput, Route, LessonInput, Slate, SlateInput, Broll, BrollInput, Direct, DirectInput, FactRow, BriefView, MomentView } from "./questions.ts";
export { PromoShape, promoQuestion } from "./questions.ts";
export type { Promo, PromoInput } from "./questions.ts";

export { appSpend, appCallCap, reserveAppCall } from "./app-spend.ts";
