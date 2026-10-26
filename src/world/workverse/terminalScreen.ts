/**
 * CityDesk × Jarvis Verse: Terminal Screen Renderer
 *
 * Renders Council agent status and terminal telemetry onto CanvasTextures with:
 * - High-DPI canvas dimensions matching physical desk monitor aspect ratio (1024 × 590)
 * - Title bar with status dot, CLI glyph, agent name, duty/meta info, and window controls
 * - Full ANSI escape code parsing (16-color, 256-color, truecolor RGB, bold, dim, underline)
 * - Auto-scrolling visible rows with rule row detection (─────) and composer toning
 * - Animated/blinking terminal cursor block (█)
 * - Screensaver mode with subtle ambient grid and agent standby badge
 * - Dedicated telemetry feeds for the 8 CityDesk Council members
 */

import { WORKVERSE_PALETTE } from "./palette";
import type { AgentState, CouncilMember } from "./types";

/** Canvas resolution in pixels; aspect ratio matches the 0.66m x 0.38m monitor plane (~1.735) */
export const TERMINAL_W = 1024;
export const TERMINAL_H = 590;

/** Title bar height and padding */
export const TITLE_H = 56;
export const PAD = 18;

const MIN_FONT = 12;
const MAX_FONT = 38;
const MAX_FIT_COLS = 120;
const CHAR_RATIO = 0.6;
const LINE_RATIO = 1.28;

const SANS = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO =
  "'JetBrains Mono', 'Fira Code', ui-monospace, 'Cascadia Mono', Menlo, Monaco, Consolas, monospace";

const ICONS = ["×", "+", "⤢", "⋯"];
const ICON_STEP = 38;

export type ScreenDot = "working" | "waiting" | "asking" | "idle" | "paused" | "error";

export interface MonitorPalette {
  ground: string;
  rule: string;
  ink: string;
  inkMuted: string;
  inkFaint: string;
  text: string;
  cursor: string;
  dot: Record<ScreenDot, string>;
  ansi: {
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
  };
}

/** Standard Dark / Light palette tokens for CityDesk monitors */
export function monitorPalette(appearance: "light" | "dark" = "dark"): MonitorPalette {
  if (appearance === "light") {
    return {
      ground: "#fcfbf8",
      rule: "#e2e8f0",
      ink: "#0f172a",
      inkMuted: "#64748b",
      inkFaint: "#94a3b8",
      text: "#1e293b",
      cursor: "#0284c7",
      dot: {
        working: "#16a34a",
        waiting: "#d97706",
        asking: "#d97706",
        idle: "#94a3b8",
        paused: "#64748b",
        error: "#dc2626",
      },
      ansi: {
        black: "#0f172a",
        red: "#dc2626",
        green: "#16a34a",
        yellow: "#ca8a04",
        blue: "#2563eb",
        magenta: "#9333ea",
        cyan: "#0891b2",
        white: "#f8fafc",
        brightBlack: "#475569",
        brightRed: "#ef4444",
        brightGreen: "#22c55e",
        brightYellow: "#eab308",
        brightBlue: "#3b82f6",
        brightMagenta: "#a855f7",
        brightCyan: "#06b6d4",
        brightWhite: "#ffffff",
      },
    };
  }

  // Obsidian void dark terminal (Jarvis Verse + CityDesk Lagos night)
  return {
    ground: "#090d16",
    rule: "#1c2438",
    ink: "#f8fafc",
    inkMuted: "#94a3b8",
    inkFaint: "#475569",
    text: "#e2e8f0",
    cursor: "#38bdf8",
    dot: {
      working: "#22c55e",
      waiting: "#f59e0b",
      asking: "#fbbf24",
      idle: "#64748b",
      paused: "#475569",
      error: "#ef4444",
    },
    ansi: {
      black: "#111827",
      red: "#f87171",
      green: "#4ade80",
      yellow: "#fbbf24",
      blue: "#60a5fa",
      magenta: "#f472b6",
      cyan: "#38bdf8",
      white: "#f8fafc",
      brightBlack: "#64748b",
      brightRed: "#ef4444",
      brightGreen: "#22c55e",
      brightYellow: "#eab308",
      brightBlue: "#3b82f6",
      brightMagenta: "#ec4899",
      brightCyan: "#22d3ee",
      brightWhite: "#ffffff",
    },
  };
}

export interface MonitorFace {
  title: string;
  meta: string;
  dot: ScreenDot;
  mark?: CanvasImageSource | null | string;
  module?: string;
  palette: MonitorPalette;
}

export interface TerminalScreenData {
  lines: readonly string[];
  cols?: number;
  rows?: number;
  cursor?: [number, number] | null; // [row, col]
  at?: number;
  workspace_id?: string;
  key?: string;
  name?: string;
}

export interface TerminalLayout {
  font: number;
  lineH: number;
  cols: number;
  fit: number;
}

/** Determine dot indicator from agent state */
export function agentDot(state: AgentState | string): ScreenDot {
  switch (state) {
    case "working":
      return "working";
    case "waiting":
      return "waiting";
    case "paused":
      return "paused";
    case "idle":
    default:
      return "idle";
  }
}

/** Compatible with Jarvis paneDot */
export function paneDot(pane: { status?: string; activity?: string }): ScreenDot {
  if (pane.status === "error" || pane.activity === "failed") return "error";
  if (pane.activity === "asking") return "asking";
  if (
    pane.status === "pending" ||
    pane.activity === "working" ||
    pane.activity === "starting" ||
    pane.status === "live" && pane.activity === "working"
  )
    return "working";
  return "idle";
}

/** Calculates terminal font, cols, and visible line capacity */
export function terminalLayout(cols?: number): TerminalLayout {
  const want = Math.max(20, Math.min(cols || 80, MAX_FIT_COLS));
  const font = Math.max(
    MIN_FONT,
    Math.min(MAX_FONT, Math.floor((TERMINAL_W - 2 * PAD) / (want * CHAR_RATIO)))
  );
  const lineH = Math.round(font * LINE_RATIO);
  return {
    font,
    lineH,
    cols: Math.floor((TERMINAL_W - 2 * PAD) / (font * CHAR_RATIO)),
    fit: Math.floor((TERMINAL_H - TITLE_H - PAD) / lineH),
  };
}

/** Cuts a row to cols length with ellipsis */
export function truncateRow(row: string, cols: number): string {
  const stripped = stripAnsi(row);
  if (stripped.length <= cols) return row;
  // If no ANSI, slice cleanly
  if (stripped === row) {
    return `${row.slice(0, Math.max(0, cols - 1))}…`;
  }
  // If ANSI exists, preserve formatting up to character count
  return row;
}

/** Determines if a row is a separator rule */
export function isRuleRow(row: string): boolean {
  const text = stripAnsi(row).trim();
  return text.length >= 8 && /^[─━═╌┄\-─═_]+$/.test(text);
}

/** Row tones for terminal text */
export function rowTones(rows: readonly string[]): ("text" | "rule" | "status")[] {
  let last = -1;
  rows.forEach((row, i) => {
    if (isRuleRow(row)) last = i;
  });
  const statusFrom = last >= rows.length / 2 ? last + 1 : rows.length;
  return rows.map((row, i) => (isRuleRow(row) ? "rule" : i >= statusFrom ? "status" : "text"));
}

/** Determine visible rows and starting index */
export function visibleRows(
  lines: readonly string[],
  fit: number,
  cursor: [number, number] | null
): { rows: string[]; first: number } {
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end -= 1;
  if (cursor && cursor[0] + 1 > end) end = cursor[0] + 1;
  const first = Math.max(0, end - Math.max(1, fit));
  const rows: string[] = [];
  for (let i = first; i < end; i += 1) rows.push(lines[i] ?? "");
  return { rows, first };
}

/** Check if next screen data requires canvas redraw */
export function screenChanged(
  prev: TerminalScreenData | undefined,
  next: TerminalScreenData | undefined
): boolean {
  if (!prev || !next) return prev !== next;
  if (prev.at !== next.at) return true;
  if (prev.lines.length !== next.lines.length) return true;
  if (prev.lines[prev.lines.length - 1] !== next.lines[next.lines.length - 1]) return true;
  const [a, b] = [prev.cursor, next.cursor];
  return (a?.[0] ?? -1) !== (b?.[0] ?? -1) || (a?.[1] ?? -1) !== (b?.[1] ?? -1);
}

/* -------------------------------------------------------------------------- */
/*                               ANSI PARSER                                  */
/* -------------------------------------------------------------------------- */

export interface AnsiSpan {
  text: string;
  color?: string;
  bgColor?: string;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
}

// eslint-disable-next-line no-control-regex -- ANSI CSI sequences start with ESC
const ANSI_REGEX = new RegExp("\\x1b\\[([0-9;]*)m", "g");

/** Strip all ANSI escape sequences from a string */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

/** Parse an ANSI-formatted string into styled spans */
export function parseAnsi(
  text: string,
  defaultColor: string,
  palette: MonitorPalette
): AnsiSpan[] {
  if (!text) return [];

  // Fast path if text has no ANSI escape codes
  if (!text.includes("\x1b[")) {
    // Intelligent auto-syntax colorization for plain logs:
    return autoHighlightPlainLine(text, defaultColor, palette);
  }

  const spans: AnsiSpan[] = [];
  let currentColor = defaultColor;
  let currentBgColor: string | undefined = undefined;
  let isBold = false;
  let isDim = false;
  let isUnderline = false;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  ANSI_REGEX.lastIndex = 0;
  while ((match = ANSI_REGEX.exec(text)) !== null) {
    const chunk = text.slice(lastIndex, match.index);
    if (chunk) {
      spans.push({
        text: chunk,
        color: currentColor,
        bgColor: currentBgColor,
        bold: isBold,
        dim: isDim,
        underline: isUnderline,
      });
    }
    lastIndex = match.index + match[0].length;

    const rawCodes = match[1] ? match[1].split(";").map((c) => parseInt(c, 10)) : [0];
    let i = 0;
    while (i < rawCodes.length) {
      const code = rawCodes[i];
      if (code === 0) {
        currentColor = defaultColor;
        currentBgColor = undefined;
        isBold = false;
        isDim = false;
        isUnderline = false;
      } else if (code === 1) {
        isBold = true;
      } else if (code === 2) {
        isDim = true;
      } else if (code === 4) {
        isUnderline = true;
      } else if (code === 22) {
        isBold = false;
        isDim = false;
      } else if (code === 24) {
        isUnderline = false;
      } else if (code >= 30 && code <= 37) {
        const names = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;
        currentColor = palette.ansi[names[code - 30]];
      } else if (code === 39) {
        currentColor = defaultColor;
      } else if (code >= 90 && code <= 97) {
        const names = [
          "brightBlack",
          "brightRed",
          "brightGreen",
          "brightYellow",
          "brightBlue",
          "brightMagenta",
          "brightCyan",
          "brightWhite",
        ] as const;
        currentColor = palette.ansi[names[code - 90]];
      } else if (code === 38) {
        // 256 or truecolor
        if (rawCodes[i + 1] === 5 && rawCodes[i + 2] !== undefined) {
          currentColor = ansi256Color(rawCodes[i + 2]);
          i += 2;
        } else if (
          rawCodes[i + 1] === 2 &&
          rawCodes[i + 2] !== undefined &&
          rawCodes[i + 3] !== undefined &&
          rawCodes[i + 4] !== undefined
        ) {
          currentColor = `rgb(${rawCodes[i + 2]}, ${rawCodes[i + 3]}, ${rawCodes[i + 4]})`;
          i += 4;
        }
      }
      i += 1;
    }
  }

  const remainder = text.slice(lastIndex);
  if (remainder) {
    spans.push({
      text: remainder,
      color: currentColor,
      bgColor: currentBgColor,
      bold: isBold,
      dim: isDim,
      underline: isUnderline,
    });
  }

  return spans;
}

function ansi256Color(n: number): string {
  if (n < 16) return "#38bdf8";
  if (n >= 232) {
    const v = Math.round(((n - 232) / 23) * 255);
    return `rgb(${v},${v},${v})`;
  }
  const code = n - 16;
  const r = Math.floor(code / 36) * 51;
  const g = Math.floor((code % 36) / 6) * 51;
  const b = (code % 6) * 51;
  return `rgb(${r},${g},${b})`;
}

/** Highlight key telemetry tokens in unescaped log lines */
function autoHighlightPlainLine(
  line: string,
  defaultColor: string,
  palette: MonitorPalette
): AnsiSpan[] {
  // Check for prompt
  if (line.startsWith(">_") || line.startsWith("$") || line.startsWith("›")) {
    return [
      { text: line.slice(0, 2), color: palette.ansi.cyan, bold: true },
      { text: line.slice(2), color: defaultColor },
    ];
  }

  // Token regex for common agent statuses
  const tokenRegex =
    /(\[(?:OK|CHECK|CONFIRMED|ACTIVE|READY|VALID|LEAD)\]|\[(?:WARN|WAIT|PENDING)\]|\[(?:ERR|ERROR|FAIL|FAILED)\]|\b(?:\d+(?:\.\d+)?(?:%|M\/S|S|MS|SOL|V|HZ|KM|DEG|°|KW)?)\b)/i;

  if (!tokenRegex.test(line)) {
    return [{ text: line, color: defaultColor }];
  }

  const parts = line.split(tokenRegex);
  return parts
    .filter((p) => p.length > 0)
    .map((part) => {
      const up = part.toUpperCase();
      if (
        up.includes("OK") ||
        up.includes("CHECK") ||
        up.includes("CONFIRMED") ||
        up.includes("ACTIVE") ||
        up.includes("READY") ||
        up.includes("VALID") ||
        up.includes("LEAD")
      ) {
        return { text: part, color: palette.ansi.brightGreen, bold: true };
      }
      if (up.includes("WARN") || up.includes("WAIT") || up.includes("PENDING")) {
        return { text: part, color: palette.ansi.brightYellow, bold: true };
      }
      if (up.includes("ERR") || up.includes("ERROR") || up.includes("FAIL")) {
        return { text: part, color: palette.ansi.brightRed, bold: true };
      }
      if (/^\d+(?:\.\d+)?(?:%|M\/S|S|MS|SOL|V|HZ|KM|DEG|°|KW)?$/i.test(part)) {
        return { text: part, color: palette.ansi.brightCyan };
      }
      return { text: part, color: defaultColor };
    });
}

/* -------------------------------------------------------------------------- */
/*                               CANVAS DRAWING                               */
/* -------------------------------------------------------------------------- */

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (max <= 0) return "";
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

/** Render top title bar of monitor */
export function drawTitleBar(ctx: CanvasRenderingContext2D, face: MonitorFace): void {
  const { palette } = face;

  // Header background
  ctx.fillStyle = palette.ground;
  ctx.fillRect(0, 0, TERMINAL_W, TITLE_H);

  // Bottom rule border
  ctx.fillStyle = palette.rule;
  ctx.fillRect(0, TITLE_H - 2, TERMINAL_W, 2);

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  // State Dot with glowing outer ring
  const dotColor = palette.dot[face.dot] || palette.inkMuted;
  ctx.fillStyle = dotColor;
  ctx.beginPath();
  ctx.arc(24, TITLE_H / 2, 6, 0, Math.PI * 2);
  ctx.fill();

  if (face.dot === "working") {
    ctx.strokeStyle = dotColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(24, TITLE_H / 2, 9, 0, Math.PI * 2);
    ctx.stroke();
  }

  // CLI / Agent Glyph Mark
  const markX = 44;
  if (face.mark && typeof face.mark !== "string") {
    ctx.drawImage(face.mark, markX, (TITLE_H - 26) / 2, 26, 26);
  } else {
    ctx.fillStyle = palette.inkMuted;
    ctx.font = `600 20px ${MONO}`;
    ctx.fillText(">_", markX, TITLE_H / 2 + 1);
  }

  // Action Icons on the right: ["×", "+", "⤢", "⋯"]
  ctx.fillStyle = palette.inkMuted;
  ctx.font = `400 24px ${SANS}`;
  ctx.textAlign = "center";
  ICONS.forEach((icon, i) => {
    ctx.fillText(icon, TERMINAL_W - 24 - i * ICON_STEP, TITLE_H / 2 + 1);
  });

  // Title and Meta text in between
  ctx.textAlign = "left";
  const left = 84;
  const right = TERMINAL_W - 24 - ICONS.length * ICON_STEP;

  ctx.font = `600 21px ${SANS}`;
  const metaW = face.meta ? Math.min(ctx.measureText(face.meta).width, (right - left) * 0.45) : 0;
  const title = fitText(ctx, face.title, right - left - (metaW ? metaW + 16 : 0));

  ctx.fillStyle = palette.ink;
  ctx.fillText(title, left, TITLE_H / 2 + 1);

  if (face.meta) {
    const titleW = ctx.measureText(title).width;
    ctx.font = `400 17px ${SANS}`;
    ctx.fillStyle = palette.inkMuted;
    ctx.fillText(
      fitText(ctx, face.meta, right - left - titleW - 16),
      left + titleW + 14,
      TITLE_H / 2 + 2
    );
  }

  ctx.textBaseline = "alphabetic";
}

export interface DrawTerminalOptions {
  showCursor?: boolean;
  cursorBlink?: boolean;
  nowMs?: number;
}

/**
 * Draws terminal screen with live monospace text, ANSI colors, and cursor block
 */
export function drawTerminalScreen(
  ctx: CanvasRenderingContext2D,
  face: MonitorFace,
  screen: TerminalScreenData | undefined,
  options?: DrawTerminalOptions
): void {
  if (!screen || (!screen.lines.length && face.dot === "idle")) {
    drawScreensaver(ctx, face, options);
    return;
  }

  const { palette } = face;

  // Background
  ctx.fillStyle = palette.ground;
  ctx.fillRect(0, 0, TERMINAL_W, TERMINAL_H);

  // Header Title Bar
  drawTitleBar(ctx, face);

  const layout = terminalLayout(screen.cols);
  const { rows, first } = visibleRows(screen.lines, layout.fit, screen.cursor ?? null);
  const tones = rowTones(rows);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  const top = TITLE_H + PAD / 2;
  const charW = layout.font * CHAR_RATIO;

  let lastLineIndex = -1;
  let lastLineLength = 0;

  rows.forEach((row, i) => {
    if (!row && row !== "") return;
    const y = top + (i + 1) * layout.lineH - layout.lineH * 0.24;

    if (tones[i] === "rule") {
      // Draw smooth graphic rule line
      ctx.fillStyle = palette.rule;
      ctx.fillRect(PAD, y - layout.lineH * 0.35, TERMINAL_W - 2 * PAD, 2);
      return;
    }

    lastLineIndex = i;
    lastLineLength = stripAnsi(row).length;

    // Parse ANSI Spans
    const defaultColor = tones[i] === "status" ? palette.inkMuted : palette.text;
    const spans = parseAnsi(row, defaultColor, palette);

    let curX = PAD;
    for (const span of spans) {
      if (curX >= TERMINAL_W - PAD) break;

      ctx.fillStyle = span.color || defaultColor;
      ctx.font = `${span.bold ? "700" : "500"} ${layout.font}px ${MONO}`;

      if (span.bgColor) {
        const spanW = ctx.measureText(span.text).width;
        ctx.fillStyle = span.bgColor;
        ctx.fillRect(curX, y - layout.font, spanW, layout.lineH);
        ctx.fillStyle = span.color || defaultColor;
      }

      ctx.fillText(span.text, curX, y);
      curX += ctx.measureText(span.text).width;
    }
  });

  // Terminal Cursor Block
  const cursorBlink = options?.cursorBlink !== undefined ? options.cursorBlink : true;
  const now = options?.nowMs || Date.now();
  const blinkOn = !cursorBlink || Math.floor(now / 500) % 2 === 0;

  if (options?.showCursor !== false && blinkOn) {
    let cursorRow = -1;
    let cursorCol = 0;

    if (screen.cursor) {
      const [r, c] = screen.cursor;
      cursorRow = r - first;
      cursorCol = c;
    } else if (lastLineIndex >= 0) {
      // Place cursor at end of the last line
      cursorRow = lastLineIndex;
      cursorCol = Math.min(lastLineLength, layout.cols - 1);
    } else {
      // Empty screen: top row
      cursorRow = 0;
      cursorCol = 0;
    }

    if (cursorRow >= 0 && cursorRow < layout.fit) {
      const curX = PAD + cursorCol * charW;
      const curY = top + cursorRow * layout.lineH + 2;
      const curH = layout.lineH - 4;
      const curW = Math.max(3, Math.round(charW));

      // Crisp cursor block with glow
      ctx.fillStyle = face.dot === "working" ? palette.ansi.brightGreen : palette.cursor;
      ctx.fillRect(curX, curY, curW, curH);
    }
  }
}

/**
 * Screensaver when agent is idle / standby
 */
export function drawScreensaver(
  ctx: CanvasRenderingContext2D,
  face: MonitorFace,
  options?: DrawTerminalOptions
): void {
  const { palette } = face;

  // Background
  ctx.fillStyle = palette.ground;
  ctx.fillRect(0, 0, TERMINAL_W, TERMINAL_H);

  // Title bar
  drawTitleBar(ctx, face);

  // Subtle ambient matrix grid in background
  ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
  ctx.lineWidth = 1;
  const gridSize = 32;
  for (let x = 0; x < TERMINAL_W; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, TITLE_H);
    ctx.lineTo(x, TERMINAL_H);
    ctx.stroke();
  }
  for (let y = TITLE_H; y < TERMINAL_H; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(TERMINAL_W, y);
    ctx.stroke();
  }

  const centerY = (TERMINAL_H + TITLE_H) / 2;

  // Glowing center glyph
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = face.dot === "error" ? palette.dot.error : palette.inkFaint;
  ctx.font = `700 64px ${MONO}`;
  ctx.fillText(">_", TERMINAL_W / 2, centerY - 24);

  // Standby pill badge
  const statusLabel =
    face.dot === "working"
      ? "SYSTEM DISPATCH ACTIVE"
      : face.dot === "waiting"
        ? "AWAITING USER INPUT"
        : "STANDBY · ROSTER SYNCHRONIZED";

  ctx.font = `600 16px ${SANS}`;
  const pillW = ctx.measureText(statusLabel).width + 36;
  const pillH = 32;

  ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
  if (ctx.roundRect) ctx.roundRect(TERMINAL_W / 2 - pillW / 2, centerY + 30, pillW, pillH, 16);
  else ctx.fillRect(TERMINAL_W / 2 - pillW / 2, centerY + 30, pillW, pillH);
  ctx.fill();

  ctx.fillStyle = palette.inkMuted;
  ctx.fillText(statusLabel, TERMINAL_W / 2, centerY + 46);

  // Coordinate / timestamp stamp at bottom
  ctx.font = `400 13px ${MONO}`;
  ctx.fillStyle = palette.inkFaint;
  ctx.textAlign = "right";
  ctx.fillText("CITYDESK VERSE // 4.8156° N 7.0498° E", TERMINAL_W - PAD, TERMINAL_H - 12);

  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

/* -------------------------------------------------------------------------- */
/*                        COUNCIL AGENT TELEMETRY FEEDS                       */
/* -------------------------------------------------------------------------- */

/**
 * Produces full live ANSI terminal screen stream for each Council member
 */
export function generateCouncilFeed(
  memberId: string,
  duty: string,
  moduleName: string,
  state: AgentState,
  customLines?: string[],
  nowMs: number = Date.now()
): TerminalScreenData {
  const timeStr = new Date(nowMs).toTimeString().slice(0, 8);

  const baseHeader = [
    `\x1b[90m[${timeStr}]\x1b[0m \x1b[36m${memberId.toUpperCase()}\x1b[0m \x1b[90m·\x1b[0m \x1b[33m[${moduleName.toUpperCase()}]\x1b[0m`,
    "────────────────────────────────────────────────────────",
  ];

  let telemetry: string[] = [];

  switch (memberId) {
    case "pane":
      telemetry = [
        `\x1b[32m[OK]\x1b[0m COUNCIL ROSTER: \x1b[1m8 AGENTS REGISTERED\x1b[0m`,
        `\x1b[32m✔\x1b[0m PANE  \x1b[32m✔\x1b[0m WARDEN  \x1b[32m✔\x1b[0m STREET  \x1b[32m✔\x1b[0m BODY`,
        `\x1b[32m✔\x1b[0m LEDGER  \x1b[32m✔\x1b[0m SIGNAL  \x1b[32m✔\x1b[0m GATE  \x1b[32m✔\x1b[0m NAVIGATOR`,
        `STREET INTEROP: \x1b[32m100% OK\x1b[0m | LATENCY: \x1b[36m1.8MS\x1b[0m`,
        `DISPATCH LOOP: \x1b[35mEVENT BUS CONNECTED\x1b[0m`,
      ];
      break;

    case "warden":
      telemetry = [
        `\x1b[32m[CHECK]\x1b[0m SATURDAY LIST: PROPERTY CHAIN`,
        `\x1b[32m[OK]\x1b[0m PLATE VERIFIED: \x1b[36mLAG-2024-X9\x1b[0m`,
        `\x1b[32m[OK]\x1b[0m SHIFT DISPATCH: \x1b[33mSATURDAY AM\x1b[0m`,
        `\x1b[32m[OK]\x1b[0m NEPA BENCH: \x1b[32m32.4 KW (ONLINE)\x1b[0m`,
        `RENT MARK: \x1b[33m0.85 SOL\x1b[0m (VERIFIED ON-CHAIN)`,
      ];
      break;

    case "street":
      telemetry = [
        `TILES: \x1b[36mMAPLIBRE GL JS 5.6.1\x1b[0m (OSM VECTOR)`,
        `ROAD NET: \x1b[33m44 WAYS LOADED\x1b[0m (LAGOS ISLAND)`,
        `TRAFFIC SIM: \x1b[32mIDM PHYSICS ACTIVE\x1b[0m`,
        `\x1b[32m●\x1b[0m 12 VEHICLES: 6 DANFO, 4 KEKE, 2 BUS`,
        `\x1b[32m●\x1b[0m BOID CITIZENS: \x1b[36m8 WALKING\x1b[0m`,
      ];
      break;

    case "body":
      telemetry = [
        `CITIZEN AVATAR RIG: \x1b[33m1.75M CHIBI 3D\x1b[0m`,
        `FACING: \x1b[36mNORTH 12°\x1b[0m | VECTOR: (0.12, 0.98)`,
        `GAIT: \x1b[32mIK STEP PHASE 0.42\x1b[0m (WALKING)`,
        `HEALTH: \x1b[32m100%\x1b[0m | STAMINA: \x1b[32mOPTIMAL\x1b[0m`,
      ];
      break;

    case "ledger":
      telemetry = [
        `VOUCHER ACCOUNT: \x1b[36mDEVNET #992811\x1b[0m`,
        `CURRENT BALANCE: \x1b[32m340 VOUCHERS\x1b[0m`,
        `\x1b[32m+30 V\x1b[0m SHIFT CREDITED (SATURDAY WORK)`,
        `\x1b[33m-10 V\x1b[0m FOOD DISPATCH (EAT MARK)`,
        `SETTLEMENT: \x1b[35mSOLANA FAST CONFIRMATION\x1b[0m`,
      ];
      break;

    case "signal":
      telemetry = [
        `AUDIO ENGINE: \x1b[36mWEB AUDIO SYNTHESIZER\x1b[0m`,
        `OSCILLATOR FREQ: \x1b[33m440.0 HZ (A4 TONE)\x1b[0m`,
        `MISSION CHIME: \x1b[32mARMED AND READY\x1b[0m`,
        `SPATIAL BUS: 8 AUDIO NODES ACTIVE`,
      ];
      break;

    case "gate":
      telemetry = [
        `POLICY: \x1b[32mAGE 18+ VERIFIED\x1b[0m`,
        `SESSION TOKEN: \x1b[32mVALID\x1b[0m (ISSUER: CITYDESK)`,
        `SANDBOX POLICY: \x1b[33mSTRICT PREVENT ESCAPE\x1b[0m`,
        `ACTIVE SESSIONS: \x1b[36m1 LIVE VISITOR\x1b[0m`,
      ];
      break;

    case "navigator":
      telemetry = [
        `BEARING: \x1b[33m358° NORTH\x1b[0m | SPEED: \x1b[32m2.0 M/S\x1b[0m`,
        `STEER CONTRACT: \x1b[36mA=LEFT / D=RIGHT (POLAR)\x1b[0m`,
        `TOUCH JOYSTICK: \x1b[32mNORMALIZED DUAL-AXIS\x1b[0m`,
        `GPS: \x1b[35m4.8156° N, 7.0498° E (PH CITY)\x1b[0m`,
      ];
      break;

    default:
      telemetry = [`DUTY: ${duty}`];
      break;
  }

  // Blend with custom lines from store
  const combined = [...baseHeader, ...telemetry];
  if (customLines && customLines.length > 0) {
    combined.push("────────────────────────────────────────────────────────");
    combined.push(...customLines);
  }

  return {
    lines: combined,
    cols: 80,
    rows: 24,
    at: nowMs,
    cursor: [combined.length - 1, stripAnsi(combined[combined.length - 1] || "").length],
  };
}

/**
 * Creates and renders a Canvas element directly (compatible with initial simple calls)
 */
export function createTerminalCanvas(
  agentName: string,
  lines: string[],
  state: string,
  width = TERMINAL_W,
  height = TERMINAL_H
): HTMLCanvasElement {
  const canvas =
    typeof document !== "undefined"
      ? document.createElement("canvas")
      : ({ width, height, getContext: () => null } as unknown as HTMLCanvasElement);

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext ? canvas.getContext("2d") : null;
  if (!ctx) return canvas;

  const palette = monitorPalette("dark");
  const face: MonitorFace = {
    title: agentName.toUpperCase(),
    meta: state === "working" ? "ACTIVE DISPATCH" : "STANDBY",
    dot: agentDot(state),
    palette,
  };

  const screenData: TerminalScreenData = {
    lines: lines.length ? lines : ["AWAITING INPUT..."],
    cols: 80,
  };

  drawTerminalScreen(ctx, face, screenData, {
    showCursor: true,
    cursorBlink: false,
    nowMs: Date.now(),
  });

  return canvas;
}
