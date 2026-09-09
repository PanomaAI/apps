/*
  Text that came from a project may carry a credential. A settings page, a README
  with a pasted example, a commit subject — any of it can end up on screen, in a fact
  sheet, in a tool result an agent reads and repeats. This is one pass, browser-safe,
  applied wherever project text enters panoma video: the aria snapshot the tour reads, the
  values a fact carries, the summaries a tool returns. It masks by shape, keeps the
  first four characters so a person can still recognise what was there, and counts
  what it did so a report can say "redactions: 2" instead of hiding the fact.

  It is a heuristic. The honest line for the docs: a product that shows secrets in
  plain text needs a fixture account, not a filter.
*/

const PATTERNS: RegExp[] = [
  /* Provider-prefixed tokens: Stripe, GitHub, GitLab, Slack, AWS, Google, JWT header. */
  /\b(?:sk|pk|rk)[-_](?:live|test)?[-_]?[A-Za-z0-9]{16,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[abp]-[A-Za-z0-9-]{20,}\b/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /\bAIza[A-Za-z0-9_-]{30,}\b/g,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /* Bearer headers and key=value assignments naming a secret. */
  /\b(Bearer\s+)[A-Za-z0-9._-]{20,}/g,
  /\b((?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*["']?)[^\s"']{8,}/gi,
  /* Long hex or base64 runs: hashes are fine to show, keys are not; 40+ is past a sha1. */
  /\b[A-Fa-f0-9]{40,}\b/g,
];

export type Redacted = { text: string; redactions: number };

function maskToken(token: string): string {
  const keep = Math.min(4, token.length);
  return token.slice(0, keep) + "•".repeat(Math.max(4, Math.min(12, token.length - keep)));
}

export function redact(text: string): Redacted {
  let redactions = 0;
  let out = text;
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, (match, prefix?: string) => {
      redactions++;
      /* Patterns with a capture keep their prefix ("Bearer ", "token=") and mask the rest. */
      if (typeof prefix === "string" && match.startsWith(prefix)) return prefix + maskToken(match.slice(prefix.length));
      return maskToken(match);
    });
  }
  /* Control characters have no place in anything a video or an agent reads. */
  out = out.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  return { text: out, redactions };
}

const CREDENTIAL_SOURCE = /(?:[•*]{4,}|\[(?:redacted|masked)\]|<(?:redacted|masked)>|\b(?:[A-Za-z_][\w-]*[_-])?(?:api[_-]?key|secret|token|password|passwd|pwd)\s*["']?\s*[:=]|--?(?:api[_-]?key|secret|token|password|passwd|pwd)(?:[=:\s]|$)|BEGIN [A-Z ]*PRIVATE KEY)/i;

/**
 * A verbatim source card cannot substitute masked text for the documented example.
 * Refuse the whole excerpt when credential shapes, placeholders or controls would
 * change it. This is a conservative display filter, never an execution-safety claim.
 */
export function isDisplayableSource(text: string): boolean {
  return !CREDENTIAL_SOURCE.test(text) && redact(text).text === text;
}

/** Files whose contents are never a fact, whatever they contain. */
export const NEVER_A_SOURCE = /(^|\/)(\.env(\.[A-Za-z0-9_-]+)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|id_rsa.*|.*credentials.*\.json)$/i;
