import { prisma } from "../../../../packages/db/src";

export type StyleProfile = {
  tenantId: string;
  avgLength: number;
  emojiDensity: number;
  formality: "voseo" | "tuteo" | "usted" | "mixed" | "unknown";
  topGreetings: string[];
  topClosings: string[];
  topEmojis: string[];
  catchphrases: string[];
  usesAbbreviations: boolean;
  sampleCount: number;
  computedAt: Date;
};

const EMOJI_REGEX =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}]/gu;

const VOSEO_VERBS = [
  "tenes",
  "tenés",
  "queres",
  "querés",
  "sabes vos",
  "sos",
  "podes",
  "podés",
  "vos",
  "che"
];
const TUTEO_VERBS = ["tienes", "quieres", "puedes", "sabes", "eres", "tu "];
const USTED_PHRASES = ["usted", "ustedes", "le aviso", "le confirmo", "le envio", "le envío"];
const ABBREVIATION_HINTS = [
  /\bq\b/i,
  /\bxq\b/i,
  /\bpq\b/i,
  /\btb\b/i,
  /\bx\b/i,
  /\bdnd\b/i,
  /\bxfa\b/i,
  /\bxfis\b/i
];

const MIN_LENGTH = 6;
const MAX_LENGTH = 800;
const SAMPLE_TARGET = 600;
const TOP_K = 5;

export class StyleProfileService {
  async recompute(tenantId: string): Promise<StyleProfile> {
    const messages = await prisma.message.findMany({
      where: { tenantId, direction: "outgoing" },
      orderBy: { createdAt: "desc" },
      take: SAMPLE_TARGET,
      select: { message: true }
    });

    const samples = messages
      .map((m: { message: string }) => m.message?.trim() ?? "")
      .filter((m: string) => m.length >= MIN_LENGTH && m.length <= MAX_LENGTH);

    const profile = this.buildProfile(tenantId, samples);
    await this.persist(profile);
    return profile;
  }

  private buildProfile(tenantId: string, samples: string[]): StyleProfile {
    if (samples.length === 0) {
      return {
        tenantId,
        avgLength: 0,
        emojiDensity: 0,
        formality: "unknown",
        topGreetings: [],
        topClosings: [],
        topEmojis: [],
        catchphrases: [],
        usesAbbreviations: false,
        sampleCount: 0,
        computedAt: new Date()
      };
    }

    const totalLen = samples.reduce((sum, s) => sum + s.length, 0);
    const avgLength = Math.round(totalLen / samples.length);

    const emojiCount = samples.reduce(
      (sum, s) => sum + (s.match(EMOJI_REGEX)?.length ?? 0),
      0
    );
    const emojiDensity = Math.round((emojiCount / Math.max(1, totalLen)) * 1000) / 10;

    const formality = this.detectFormality(samples);
    const topGreetings = this.topPhrases(samples, "head", TOP_K);
    const topClosings = this.topPhrases(samples, "tail", TOP_K);
    const topEmojis = this.topEmojis(samples, TOP_K);
    const catchphrases = this.topNgrams(samples, 3, TOP_K);
    const usesAbbreviations = this.hasAbbreviations(samples);

    return {
      tenantId,
      avgLength,
      emojiDensity,
      formality,
      topGreetings,
      topClosings,
      topEmojis,
      catchphrases,
      usesAbbreviations,
      sampleCount: samples.length,
      computedAt: new Date()
    };
  }

  private detectFormality(samples: string[]): StyleProfile["formality"] {
    let voseo = 0;
    let tuteo = 0;
    let usted = 0;
    for (const raw of samples) {
      const text = raw.toLowerCase();
      if (VOSEO_VERBS.some((v) => text.includes(v))) voseo++;
      if (TUTEO_VERBS.some((v) => text.includes(v))) tuteo++;
      if (USTED_PHRASES.some((v) => text.includes(v))) usted++;
    }
    const max = Math.max(voseo, tuteo, usted);
    if (max === 0) return "unknown";
    const second = [voseo, tuteo, usted].sort((a, b) => b - a)[1];
    if (second >= max * 0.6) return "mixed";
    if (max === voseo) return "voseo";
    if (max === tuteo) return "tuteo";
    return "usted";
  }

  private topPhrases(
    samples: string[],
    side: "head" | "tail",
    k: number
  ): string[] {
    const counts = new Map<string, number>();
    for (const raw of samples) {
      const cleaned = raw.replace(/[¡¿]/g, "").trim();
      const tokens = cleaned.split(/\s+/);
      if (tokens.length < 2) continue;
      const slice =
        side === "head" ? tokens.slice(0, 2) : tokens.slice(-2);
      const phrase = slice
        .join(" ")
        .toLowerCase()
        .replace(/[.,!?]+$/g, "")
        .trim();
      if (phrase.length < 3) continue;
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([phrase]) => phrase);
  }

  private topEmojis(samples: string[], k: number): string[] {
    const counts = new Map<string, number>();
    for (const s of samples) {
      const matches = s.match(EMOJI_REGEX) ?? [];
      for (const e of matches) counts.set(e, (counts.get(e) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([e]) => e);
  }

  private topNgrams(samples: string[], n: number, k: number): string[] {
    const counts = new Map<string, number>();
    for (const raw of samples) {
      const tokens = raw
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter(Boolean);
      for (let i = 0; i + n <= tokens.length; i++) {
        const ngram = tokens.slice(i, i + n).join(" ");
        if (ngram.length < 6) continue;
        counts.set(ngram, (counts.get(ngram) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .filter(([, c]) => c >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([phrase]) => phrase);
  }

  private hasAbbreviations(samples: string[]): boolean {
    let hits = 0;
    for (const s of samples) {
      if (ABBREVIATION_HINTS.some((re) => re.test(s))) hits++;
      if (hits >= 3) return true;
    }
    return false;
  }

  private async persist(profile: StyleProfile): Promise<void> {
    await prisma.tenantStyleProfile.upsert({
      where: { tenantId: profile.tenantId },
      create: {
        tenantId: profile.tenantId,
        avgLength: profile.avgLength,
        emojiDensity: profile.emojiDensity,
        formality: profile.formality,
        topGreetings: profile.topGreetings as any,
        topClosings: profile.topClosings as any,
        topEmojis: profile.topEmojis as any,
        catchphrases: profile.catchphrases as any,
        usesAbbreviations: profile.usesAbbreviations,
        sampleCount: profile.sampleCount,
        computedAt: profile.computedAt
      },
      update: {
        avgLength: profile.avgLength,
        emojiDensity: profile.emojiDensity,
        formality: profile.formality,
        topGreetings: profile.topGreetings as any,
        topClosings: profile.topClosings as any,
        topEmojis: profile.topEmojis as any,
        catchphrases: profile.catchphrases as any,
        usesAbbreviations: profile.usesAbbreviations,
        sampleCount: profile.sampleCount,
        computedAt: profile.computedAt
      }
    });
  }

  async load(tenantId: string): Promise<StyleProfile | null> {
    const row = await prisma.tenantStyleProfile.findUnique({
      where: { tenantId }
    });
    if (!row) return null;
    return {
      tenantId: row.tenantId,
      avgLength: row.avgLength,
      emojiDensity: row.emojiDensity,
      formality: row.formality as StyleProfile["formality"],
      topGreetings: (row.topGreetings as unknown as string[]) ?? [],
      topClosings: (row.topClosings as unknown as string[]) ?? [],
      topEmojis: (row.topEmojis as unknown as string[]) ?? [],
      catchphrases: (row.catchphrases as unknown as string[]) ?? [],
      usesAbbreviations: row.usesAbbreviations,
      sampleCount: row.sampleCount,
      computedAt: row.computedAt
    };
  }
}
