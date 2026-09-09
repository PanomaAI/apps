/*
  One request, any provider.

  Every video model on the market takes a sentence, a duration and an aspect ratio, and
  then disagrees about everything else: some accept a first frame, fewer a last one, some
  make their own sound, some only make clips of four, six or eight seconds, and the
  parameter names share no vocabulary at all. A storyboard that was written against one
  vendor's shape would have to be rewritten when the vendor changed — and these change
  every few months, which is why model ids in this repository are configuration and never
  constants.

  So a shot is described in the language of a SHOT (size, movement, subject, action,
  duration, what it opens on) and an adapter turns that into whatever its API accepts.
  The part that matters is the other direction: what the adapter could NOT honour comes
  back on the clip in `ignored`, so the report says "you asked for 5 s and this model
  makes 4 or 6, so it made 6" rather than the film quietly differing from the board.
*/

export type Aspect = "16:9" | "9:16" | "1:1";

/*
  A picture handed to a model as the frame a shot opens (or ends) on.

  Named for what it is on the wire rather than what it is on the board: the board's own
  `Still` is a file with a hash and a provenance record, and this is the bytes of one on
  their way into a request body.
*/
export type ImageInput = { bytes: Buffer; mimeType: string };

export type GenRequest = {
  prompt: string;
  /** What the shot asks for. The adapter picks the nearest thing its model will make. */
  seconds: number;
  aspect: Aspect;
  negative?: string;
  /** Same seed, same prompt, same clip — where a provider supports it, which is how a re-run costs nothing new. */
  seed?: number;
  first?: ImageInput;
  last?: ImageInput;
  /*
    Up to three pictures conditioning the LOOK rather than a frame of the clip.

    Kept separate from `first`/`last` because on every provider that has both they are
    mutually exclusive, and because they are the field somebody reaches for to make a
    generated shot "look like the product". The adapters refuse that combination rather
    than discovering it as a 400 after the submit was accepted.
  */
  references?: ImageInput[];
};

export type Clip = {
  bytes: Buffer;
  /** Seconds actually produced, which is not always what was asked for. */
  seconds: number;
  provider: string;
  model: string;
  /** Everything the request asked for that this provider does not do. Never silent. */
  ignored: string[];
  /** Dollars, from the provider's published rate and the seconds it actually billed. */
  cost: number;
};

export type Capability = {
  /** The durations this model will make. Empty means "any number of seconds". */
  seconds: readonly number[];
  aspects: readonly Aspect[];
  /** Image-to-video: the shot opens on a picture we supply. */
  firstFrame: boolean;
  /** The shot ENDS on a picture we supply — rarer, and the strongest constraint on drift there is. */
  lastFrame: boolean;
  /** Style/subject conditioning that is not a frame of the clip. */
  references: number;
  /*
    Durations this model will make ONCE a picture is attached.

    Its own row because it is not the same set. Veo makes four, six or eight seconds of
    text-to-video and exactly eight of anything image-conditioned — which is simultaneously
    the most expensive duration and the one that drifts most, and a board that did not know
    would quote a price it cannot buy at.
  */
  conditionedSeconds: readonly number[];
  negative: boolean;
  seed: boolean;
  /** The model generates its own audio. When false the film's own sound is all there is. */
  audio: boolean;
  /** Dollars per second of output, so a board can be priced before anybody says yes. */
  perSecond: number;
  /** Where the number came from, because these change and a stale price is worse than none. */
  pricedAt: string;
};

export type Generator = {
  provider: string;
  model: string;
  can: Capability;
  make(req: GenRequest): Promise<Clip>;
};

/**
 * The duration this model will actually make, nearest to what was asked.
 *
 * Rounding UP on a tie, because a shot that is a beat too long is trimmed by the edit and
 * a shot that is a beat too short leaves a hole the edit has to fill with a freeze.
 */
export function nearestSeconds(want: number, allowed: readonly number[]): number {
  if (allowed.length === 0) return want;
  return [...allowed].sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || b - a)[0];
}

/**
 * What a request asks for that a model cannot do, in words a report can print.
 *
 * Called by every adapter before it sends anything, so the list is the same sentence
 * whoever is asked. An adapter may add its own.
 */
export function unhonoured(req: GenRequest, can: Capability): string[] {
  const out: string[] = [];
  const grid = gridFor(req, can);
  const seconds = nearestSeconds(req.seconds, grid);
  if (seconds !== req.seconds) out.push(`asked for ${req.seconds}s; this model makes ${grid.join(", ")}s here, so it made ${seconds}s`);
  if (!can.aspects.includes(req.aspect)) out.push(`asked for ${req.aspect}; this model makes ${can.aspects.join(", ")}`);
  if (req.negative && !can.negative) out.push("a negative prompt was written and this model does not take one");
  if (req.seed !== undefined && !can.seed) out.push("a seed was set and this model does not take one, so a re-run will not repeat");
  if (req.first && !can.firstFrame) out.push("the shot was to open on a real frame and this model does not take one");
  if (req.last && !can.lastFrame) out.push("the shot was to end on a real frame and this model does not take one, so only its opening is true");
  if (req.references && req.references.length > can.references)
    out.push(`${req.references.length} reference pictures were attached and this model takes ${can.references}`);
  return out;
}

/**
 * The durations available for THIS request, which depends on what is attached to it.
 *
 * Conditioning a clip on a picture narrows the grid on every provider that offers both,
 * and on Veo it collapses it to a single value. A caller that priced against the wide grid
 * and then submitted a conditioned request would be quoting a number the API will not sell
 * at, so the grid is a function of the request and never a constant.
 */
export function gridFor(req: GenRequest, can: Capability): readonly number[] {
  const conditioned = req.first !== undefined || req.last !== undefined || (req.references?.length ?? 0) > 0;
  return conditioned && can.conditionedSeconds.length > 0 ? can.conditionedSeconds : can.seconds;
}

/*
  How much a board costs before a cent of it is spent.

  This is the number a person says yes or no to, and it is the reason the storyboard is
  a file rather than a function call. Generation is the only stage in panoma video that
  spends per SECOND of output rather than per call, so a run that quietly picked a
  duration would be a run that quietly picked a bill.
*/
export function priceOf(seconds: readonly number[], can: Capability, opts: { conditioned?: boolean } = {}): { seconds: number; dollars: number } {
  const grid = opts.conditioned && can.conditionedSeconds.length > 0 ? can.conditionedSeconds : can.seconds;
  const billed = seconds.reduce((n, s) => n + nearestSeconds(s, grid), 0);
  return { seconds: billed, dollars: Math.round(billed * can.perSecond * 100) / 100 };
}
