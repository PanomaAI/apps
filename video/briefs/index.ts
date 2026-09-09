/*
  The briefs that exist. Each one is an idea; the render matrix turns it into files.
  Hooks are plural on purpose — virality is a search problem, and the feed votes.
*/
import type { Brief } from "@panoma/video-core";

export const briefs: Brief[] = [
  {
    id: "name-ten",
    recipe: "KineticQuote",
    langs: ["en", "es"],
    bpm: 120,
    fps: 30,
    hooks: [
      {
        id: "count",
        text: {
          en: "You have 47 projects on this laptop. Name ten.",
          es: "Tienes 47 proyectos en este portátil. Di diez.",
        },
      },
      {
        id: "stop",
        text: {
          en: "Stop grepping your disk to remember what you built.",
          es: "Deja de grepear tu disco para recordar lo que construiste.",
        },
      },
    ],
    lines: [
      { id: "finds", text: { en: "One command finds them all.", es: "Un comando los encuentra todos." } },
      { id: "local", text: { en: "Catalogued. Local. Yours.", es: "Catalogados. En local. Tuyos." } },
      { id: "brand", text: { en: "panoma", es: "panoma" } },
    ],
    music: { file: "demo/bed.mp3" },
  },
  {
    id: "march-project",
    recipe: "ScreenDemo",
    langs: ["en", "es"],
    bpm: 120,
    fps: 30,
    shots: "demo",
    hooks: [
      {
        id: "pov",
        text: {
          en: "POV: you need that side project from March",
          es: "POV: necesitas aquel proyecto de marzo",
        },
      },
    ],
    lines: [
      { id: "scan", text: { en: "panoma scans your whole disk", es: "panoma recorre tu disco entero" } },
      { id: "all", text: { en: "every project, one catalog", es: "cada proyecto, un catálogo" } },
      { id: "off", text: { en: "works with the wifi off", es: "funciona sin wifi" } },
    ],
    music: { file: "demo/bed.mp3" },
  },
  {
    id: "speedrun",
    recipe: "TerminalRun",
    langs: ["en", "es"],
    bpm: 120,
    fps: 30,
    hooks: [
      {
        id: "clock",
        text: {
          en: "Cataloguing a whole disk before your coffee cools",
          es: "Catalogar el disco entero antes de que se enfríe el café",
        },
      },
    ],
    lines: [
      { id: "cmd", text: { en: "panoma scan --save", es: "panoma scan --save" } },
      { id: "o1", text: { en: "reading ~/Dev … 214 folders", es: "leyendo ~/Dev … 214 carpetas" } },
      { id: "o2", text: { en: "detecting stacks … ts · go · rust · py", es: "detectando stacks … ts · go · rust · py" } },
      { id: "o3", text: { en: "reading git history … 4,812 commits", es: "leyendo historial git … 4.812 commits" } },
      { id: "o4", text: { en: "writing catalog … done", es: "escribiendo catálogo … hecho" } },
      { id: "sum", text: { en: "47 projects catalogued in 9.4s", es: "47 proyectos catalogados en 9,4 s" } },
    ],
    music: { file: "demo/bed.mp3" },
    tags: ["terminal", "panoma"],
  },
  {
    id: "radar",
    recipe: "Loop",
    langs: ["en", "es"],
    bpm: 120,
    fps: 30,
    hooks: [
      { id: "scan", text: { en: "projects found", es: "proyectos encontrados" } },
    ],
    lines: [{ id: "brand", text: { en: "panoma — your disk, catalogued", es: "panoma — tu disco, catalogado" } }],
    params: { count: 47 },
    tags: ["panoma"],
  },
  /*
    The tutorial. Its shape is not in this file: the steps come from the marks of
    session "panoma-start", and how long each one lasts comes from how long its
    sentence takes to say. What is written here is only what a person hears — which
    is the point, and why a tutorial is the cheapest thing in this repository to
    write and the most expensive to fake.

    Two hooks, because they ask for different people: one names the pain, one names
    the absence. The feed decides which was right.
  */
  {
    id: "start",
    recipe: "Tutorial",
    langs: ["en", "es"],
    bpm: 120,
    fps: 30,
    session: "panoma-start",
    voice: "gOupLcAkjEnguROwi4oS",
    /* Read for someone following along in another window, not for a listener. */
    voiceSpeed: 0.92,
    hooks: [
      {
        id: "tired",
        text: {
          en: "Tired of opening folders to remember what you built?",
          es: "¿Cansado de abrir carpetas para acordarte de lo que has hecho?",
        },
      },
      {
        id: "front",
        text: {
          en: "Your disk has no front door. Let me show you one.",
          es: "Tu disco no tiene puerta de entrada. Deja que te enseñe una.",
        },
      },
    ],
    lines: [
      {
        id: "copy",
        mark: "copy",
        label: { en: "Copy the command", es: "Copia el comando" },
        text: {
          en: "Come with me. One command, and nothing gets installed — copy this line.",
          es: "Ven conmigo. Un comando, y no se instala nada: copia esta línea.",
        },
      },
      {
        id: "question",
        mark: "question",
        label: { en: "One question", es: "Una pregunta" },
        text: {
          en: "Then answer the page's question. What is the front door to your projects?",
          es: "Y responde a la pregunta de la página. ¿Cuál es la puerta de entrada a tus proyectos?",
        },
      },
      {
        id: "door",
        mark: "door",
        label: { en: "The front door", es: "La puerta" },
        text: {
          en: "Watch this. Forty folders. And a door appears where there wasn't one.",
          es: "Mira esto. Cuarenta carpetas. Y aparece una puerta donde no había ninguna.",
        },
      },
      {
        id: "memory",
        mark: "memory",
        label: { en: "What agents read", es: "Lo que leen los agentes" },
        text: {
          en: "Each project keeps a memory that updates itself. Your agents read it before they touch a line.",
          es: "Cada proyecto guarda una memoria que se actualiza sola. Tus agentes la leen antes de tocar una línea.",
        },
      },
      /* No mark, so it is the closing card rather than a step. */
      {
        id: "cta",
        text: {
          en: "Run it on your own disk. Nothing ever leaves the machine.",
          es: "Pruébalo en tu propio disco. No sale nada de la máquina.",
        },
      },
    ],
    music: { file: "demo/bed.mp3" },
    tags: ["panoma", "tutorial"],
  },
  {
    id: "tour",
    recipe: "ScreenCast",
    langs: ["en", "es"],
    bpm: 120,
    fps: 30,
    session: "panoma-tour",
    hooks: [
      {
        id: "see",
        text: {
          en: "Your whole disk, catalogued — watch",
          es: "Tu disco entero, catalogado — mira",
        },
      },
    ],
    lines: [
      { id: "cta", text: { en: "panoma · local · free", es: "panoma · local · gratis" } },
    ],
    music: { file: "demo/bed.mp3" },
    tags: ["panoma", "demo"],
  },
];
