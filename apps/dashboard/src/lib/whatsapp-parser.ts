/**
 * Parser de exports de chat de WhatsApp en español.
 * Soporta los dos formatos comunes:
 *   iOS: `[5/3/26, 14:32:11] Vendedor: Hola amor`
 *   Android: `5/3/26, 14:32 - Vendedor: Hola amor`
 * Mensajes sin separador `:` se descartan (system messages: "X creó este grupo", "Cifrado de extremo a extremo").
 * Líneas que no matchean el patrón se concatenan al mensaje anterior (multi-línea).
 */

export type ParsedMessage = {
  speaker: string;
  text: string;
  /** ISO datetime aprox. Si no se puede parsear, queda null y usamos el orden del archivo. */
  timestamp: string | null;
};

export type ParsedExport = {
  messages: ParsedMessage[];
  speakers: Array<{ name: string; count: number; charCount: number }>;
};

// iOS: [5/3/26, 14:32:11] Speaker: text
const IOS_LINE = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?\s?m\.?)?)\]\s+(.+?):\s?(.*)$/i;
// Android: 5/3/26, 14:32 - Speaker: text   (a veces con NBSP)
const ANDROID_LINE = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?\s?m\.?)?)?\s*-\s+(.+?):\s?(.*)$/i;

const SYSTEM_MARKERS = [
  "<multimedia omitido>",
  "<media omitted>",
  "image omitted",
  "audio omitted",
  "video omitted",
  "documento omitido",
  "documento adjunto",
  "imagen omitida",
  "audio omitido",
  "video omitido",
  "sticker omitido",
  "gif omitido",
  "ubicación:",
  "ubicacion:",
  "este mensaje fue eliminado",
  "se eliminó este mensaje",
  "messages and calls are end-to-end encrypted",
  "los mensajes y llamadas están cifrados"
];

const isSystemContent = (text: string): boolean => {
  const lower = text.toLowerCase().trim();
  return SYSTEM_MARKERS.some((m) => lower.includes(m));
};

const tryParseTimestamp = (date: string, time?: string): string | null => {
  try {
    const parts = date.split("/").map((s) => s.trim());
    if (parts.length !== 3) return null;
    let [d, m, y] = parts;
    if (y.length === 2) y = `20${y}`;
    const dd = d.padStart(2, "0");
    const mm = m.padStart(2, "0");
    const t = (time ?? "00:00").trim();
    const isPM = /p\.?\s?m\.?/i.test(t);
    const isAM = /a\.?\s?m\.?/i.test(t);
    const cleaned = t.replace(/\s?[ap]\.?\s?m\.?/i, "").trim();
    let [hh, mn, ss] = cleaned.split(":");
    let hour = parseInt(hh ?? "0", 10);
    if (isPM && hour < 12) hour += 12;
    if (isAM && hour === 12) hour = 0;
    const hhStr = String(hour).padStart(2, "0");
    const mnStr = (mn ?? "00").padStart(2, "0");
    const ssStr = (ss ?? "00").padStart(2, "0");
    return `${y}-${mm}-${dd}T${hhStr}:${mnStr}:${ssStr}`;
  } catch {
    return null;
  }
};

export function parseWhatsappExport(content: string): ParsedExport {
  const lines = content
    .replace(/\r\n/g, "\n")
    .replace(/‎/g, "")
    .split("\n");

  const messages: ParsedMessage[] = [];
  let last: ParsedMessage | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/ /g, " ").trimEnd();
    if (!line) {
      if (last) last.text += "\n";
      continue;
    }
    const ios = line.match(IOS_LINE);
    const android = !ios ? line.match(ANDROID_LINE) : null;
    const match = ios ?? android;

    if (match) {
      const [, date, time, speaker, text] = match;
      const sp = speaker.trim();
      const tx = (text ?? "").trim();
      if (!tx) {
        last = null;
        continue;
      }
      if (isSystemContent(tx)) {
        last = null;
        continue;
      }
      const msg: ParsedMessage = {
        speaker: sp,
        text: tx,
        timestamp: tryParseTimestamp(date, time)
      };
      messages.push(msg);
      last = msg;
    } else if (last) {
      last.text += "\n" + line;
    }
  }

  // Limpiamos texto final.
  for (const m of messages) m.text = m.text.trim();

  const counts = new Map<string, { count: number; charCount: number }>();
  for (const m of messages) {
    const cur = counts.get(m.speaker) ?? { count: 0, charCount: 0 };
    cur.count += 1;
    cur.charCount += m.text.length;
    counts.set(m.speaker, cur);
  }
  const speakers = Array.from(counts.entries())
    .map(([name, v]) => ({ name, count: v.count, charCount: v.charCount }))
    .sort((a, b) => b.count - a.count);

  return { messages, speakers };
}
