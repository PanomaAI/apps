/*
  Three word lists decide what a tour may click, and they are lists on purpose:
  a model would guess, and a guess that clicks "Delete account" on someone's
  running product is the one failure this package must make impossible. Every
  name is matched as whole words, case-insensitively, phrases included.

  The lists are ordered by what they cost when wrong. A missed verb costs a CTA
  the tour did not find; a missed chrome word costs a shot of a cookie banner; a
  missed destructive verb costs the user their data. So the destructive list is
  checked first and is never overridden by a verb match ("Add and pay" is
  destructive, whatever else it says).
*/

/** Things a visitor is invited to do. Matching one is the strongest CTA signal. */
export const VERBS: readonly string[] = [
  "get started",
  "getting started",
  "start",
  "try",
  "sign up",
  "signup",
  "install",
  "download",
  "create",
  "new",
  "add",
  "open",
  "docs",
  "documentation",
  "learn more",
  "see how",
  "see it",
  "explore",
  "demo",
  "watch",
  "read",
  "launch",
  "run",
  "play",
  "browse",
  "continue",
  "view",
  "discover",
  "join",
  "book",
  "go",
  "build",
  "generate",
  "quickstart",
  "guide",
  "tutorial",
];

/*
  Things the product's chrome asks, not the product itself: consent, sessions,
  menus, search, language. They earn no shot (role "chrome" in the recording) and
  they are never a call to action.
*/
export const CHROME: readonly string[] = [
  "accept",
  "accept all",
  "reject",
  "reject all",
  "decline",
  "cookie",
  "cookies",
  "consent",
  "close",
  "dismiss",
  "got it",
  "ok",
  "okay",
  "agree",
  "allow",
  "allow all",
  "preferences",
  "settings",
  "sign in",
  "signin",
  "log in",
  "login",
  "menu",
  "navigation",
  "search",
  "language",
  "skip",
  "skip to content",
  "toggle",
  "theme",
  "dark mode",
  "light mode",
  "back",
  "previous",
  "next",
  "share",
];

/*
  The words a consent banner uses, in the order a privacy-preserving visitor
  would pick them: decline first, accept last. The tour dismisses a banner with
  the first button it finds in this order.
*/
export const CONSENT_ORDER: readonly string[] = [
  "reject all",
  "reject",
  "decline",
  "only necessary",
  "necessary only",
  "essential only",
  "dismiss",
  "close",
  "got it",
  "ok",
  "okay",
  "accept all",
  "accept",
  "agree",
  "allow",
];

/*
  Never clicked, on any page, by any budget. Deleting, paying, sending,
  publishing, resetting, revoking — anything a person would want to be asked
  about — plus form submission, because the tour never types and a submitted
  empty form is still a submitted form.
*/
export const DESTRUCTIVE: readonly string[] = [
  "delete",
  "remove",
  "pay",
  "purchase",
  "buy",
  "checkout",
  "check out",
  "order",
  "send",
  "publish",
  "archive",
  "reset",
  "revoke",
  "unsubscribe",
  "subscribe",
  "submit",
  "log out",
  "logout",
  "sign out",
  "signout",
  "deactivate",
  "destroy",
  "drop",
  "erase",
  "clear",
  "wipe",
  "ban",
  "block",
  "transfer",
  "withdraw",
  "deposit",
  "upgrade",
  "confirm",
  "approve",
  "merge",
  "deploy",
  "invite",
  "post",
  "email",
  "call",
  "cancel",
  "disable",
  "uninstall",
  "leave",
  "report",
  "install",
  "uninstall",
  "run",
  "build",
  "execute",
  "start",
  "sign up",
  "signup",
  "register",
  "restore",
  "restart",
  "reboot",
  "force",
  "overwrite",
  "replace all",
  "empty",
  /*
    And the same list where the interface is not in English.

    The guarantee this repository publishes — "refused in the executor, not only in the
    prompt" — was English-only, and a Spanish product's "Eliminar proyecto" reached the
    model with `refused: undefined` beside it. What defends a page is what is written
    here; everything else is a request. These are the four European languages the studio
    actually meets (Spanish, French, German, Portuguese) plus the shared Latin stems, and
    the list is the honest limit: a Japanese or Arabic interface is defended by the brain's
    own `show.avoid` and by nothing in this file. docs/lesson.md says so.
  */
  "eliminar",
  "borrar",
  "suprimir",
  "quitar",
  "enviar",
  "pagar",
  "comprar",
  "publicar",
  "archivar",
  "restablecer",
  "revocar",
  "cancelar",
  "confirmar",
  "aprobar",
  "desactivar",
  "vaciar",
  "cerrar sesion",
  "cerrar sesión",
  "salir",
  "darse de baja",
  "suscribir",
  "instalar",
  "ejecutar",
  "guardar",
  "supprimer",
  "effacer",
  "envoyer",
  "payer",
  "acheter",
  "publier",
  "archiver",
  "annuler",
  "confirmer",
  "deconnexion",
  "déconnexion",
  "se deconnecter",
  "se déconnecter",
  "loschen",
  "löschen",
  "entfernen",
  "senden",
  "bezahlen",
  "kaufen",
  "veroffentlichen",
  "veröffentlichen",
  "abmelden",
  "bestatigen",
  "bestätigen",
  "excluir",
  "apagar",
  "enviar",
  "comprar",
  "publicar",
  "cancelar",
  "sair",
];

/*
  Controls that hand the work to another application.

  Found by filming a real product: the walk clicked "Open in Claude" on someone's
  live catalog and launched an agent on their machine. Nothing on the lists above
  stops it — "open" is one of the strongest verbs there is, and the control is
  neither destructive nor chrome. But it is not a step in a tour of THIS product
  either: whatever happens next happens outside the browser, off camera, on the
  machine of whoever is being filmed. A tour is allowed to be curious about a page.
  It is not allowed to start programs.

  The idiom is the same everywhere — "Open in VS Code", "Reveal in Finder", "Edit in
  Figma" — so the preposition is what is matched, not the application.
*/
export const EXTERNAL: readonly string[] = ["open in", "open with", "reveal in", "edit in", "launch in", "run in"];

/*
  Words on the destructive list that are also ordinary nouns.

  "Block" is on the list because of "Block user", and it refused "Regenerate the block" —
  a control that regenerates a block of text in a file. Same for "report", "post",
  "order", "call", "run", "start", "clear", "drop", "leave" and "email": every one of them
  is a verb somewhere and a noun somewhere else, and a lexicon that cannot tell them apart
  either presses something it should not or refuses half a product.

  The tell is position. Interface labels are verb-first — "Delete project", "Send
  invoice", "Block user" — so these count only when they OPEN the name. A noun in the
  middle of a phrase is a noun. Everything else on the list matches wherever it appears,
  because "Permanently delete" is still a delete.
*/
const AMBIGUOUS: ReadonlySet<string> = new Set([
  "block", "report", "post", "order", "call", "run", "start", "clear", "drop", "leave", "email",
  "transfer", "merge", "build", "force", "empty", "salir", "guardar", "apagar",
]);

function opensWith(name: string, phrase: string): boolean {
  return new RegExp(`^\\s*${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}($|[^a-z0-9])`, "i").test(name);
}

function phraseRegex(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i");
}

const compiled = new Map<readonly string[], RegExp[]>();

/** The first phrase of `list` found as whole words in `name` — or, for an ambiguous one, opening it — and null when none does. */
export function matchLexicon(name: string, list: readonly string[]): string | null {
  let regexes = compiled.get(list);
  if (!regexes) {
    regexes = list.map(phraseRegex);
    compiled.set(list, regexes);
  }
  for (let i = 0; i < list.length; i++) {
    if (!regexes[i].test(name)) continue;
    if (AMBIGUOUS.has(list[i]) && !opensWith(name, list[i])) continue;
    return list[i];
  }
  return null;
}

export const isDestructive = (name: string): string | null => matchLexicon(name, DESTRUCTIVE);
export const isExternal = (name: string): string | null => matchLexicon(name, EXTERNAL);
export const isChrome = (name: string): string | null => matchLexicon(name, CHROME);
export const verbOf = (name: string): string | null => matchLexicon(name, VERBS);
