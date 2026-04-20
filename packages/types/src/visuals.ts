import type { Slide, SlideLayoutTemplate, SlideVisualTone } from "./domain";

export interface SlideIllustrationDescriptor {
  title: string;
  prompt: string;
  caption?: string;
  accentColor?: string;
  tone?: SlideVisualTone;
  layoutTemplate?: SlideLayoutTemplate;
}

const FALLBACK_ACCENT = "1C7C7D";

const normalizeHexColor = (value?: string) => {
  const normalized = value?.trim().replace(/^#/, "").toUpperCase();
  return normalized && /^[0-9A-F]{6}$/.test(normalized) ? normalized : FALLBACK_ACCENT;
};

const tonePalette = (tone: SlideVisualTone | undefined, accent: string) => {
  switch (tone) {
    case "success":
      return {
        surface: "#ECFDF5",
        border: "#10B981",
        text: "#064E3B",
        accent: "#10B981",
      };
    case "warning":
      return {
        surface: "#FFFBEB",
        border: "#F59E0B",
        text: "#78350F",
        accent: "#F59E0B",
      };
    case "info":
      return {
        surface: "#EFF6FF",
        border: "#3B82F6",
        text: "#1E3A8A",
        accent: "#3B82F6",
      };
    case "neutral":
      return {
        surface: "#F8FAFC",
        border: "#CBD5E1",
        text: "#1F2937",
        accent: `#${accent}`,
      };
    case "accent":
    default:
      return {
        surface: "#F8FAFC",
        border: `#${accent}`,
        text: "#0F172A",
        accent: `#${accent}`,
      };
  }
};

const hashString = (value: string) => {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
};

const shorten = (value: string, maxLength: number) =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const encodeSvg = (svg: string) =>
  `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;

type IllustrationMotif =
  | "workflow"
  | "analysis"
  | "network"
  | "spotlight"
  | "people";

const chooseIllustrationMotif = (
  descriptor: SlideIllustrationDescriptor,
  seed: number,
): IllustrationMotif => {
  switch (descriptor.layoutTemplate) {
    case "three-step-flow":
      return "workflow";
    case "two-column-callouts":
      return "analysis";
    case "summary-board":
      return "network";
    case "hero-focus":
    default:
      return seed % 2 === 0 ? "spotlight" : "people";
  }
};

const renderWorkflowMotif = (palette: ReturnType<typeof tonePalette>, seed: number) => {
  const nodeY = 182 + ((seed >> 2) % 10) - 5;
  const nodeRadius = 26 + ((seed >> 5) % 7);
  const bridgeY = nodeY + 4;

  return `
    <circle cx="156" cy="${nodeY}" r="${nodeRadius}" fill="${palette.accent}" fill-opacity="0.14" stroke="${palette.border}" stroke-width="3" />
    <circle cx="322" cy="${nodeY}" r="${nodeRadius}" fill="${palette.accent}" fill-opacity="0.10" stroke="${palette.border}" stroke-width="3" />
    <circle cx="488" cy="${nodeY}" r="${nodeRadius}" fill="${palette.accent}" fill-opacity="0.14" stroke="${palette.border}" stroke-width="3" />
    <path d="M188 ${bridgeY} C232 ${bridgeY - 18}, 248 ${bridgeY - 18}, 292 ${bridgeY}" stroke="${palette.accent}" stroke-width="8" stroke-linecap="round" stroke-opacity="0.82" />
    <path d="M354 ${bridgeY} C398 ${bridgeY + 18}, 414 ${bridgeY + 18}, 458 ${bridgeY}" stroke="${palette.accent}" stroke-width="8" stroke-linecap="round" stroke-opacity="0.82" />
    <rect x="108" y="226" width="96" height="42" rx="18" fill="${palette.surface}" stroke="${palette.border}" stroke-width="2" />
    <rect x="274" y="226" width="96" height="42" rx="18" fill="${palette.surface}" stroke="${palette.border}" stroke-width="2" />
    <rect x="440" y="226" width="96" height="42" rx="18" fill="${palette.surface}" stroke="${palette.border}" stroke-width="2" />
  `.trim();
};

const renderAnalysisMotif = (palette: ReturnType<typeof tonePalette>, seed: number) => {
  const barA = 54 + ((seed >> 1) % 28);
  const barB = 92 + ((seed >> 4) % 34);
  const barC = 136 + ((seed >> 7) % 28);

  return `
    <rect x="124" y="112" width="392" height="180" rx="28" fill="white" stroke="${palette.border}" stroke-width="2.5" />
    <path d="M158 248 L158 150" stroke="${palette.border}" stroke-width="6" stroke-linecap="round" />
    <path d="M238 248 L238 ${248 - barA}" stroke="${palette.accent}" stroke-width="34" stroke-linecap="round" stroke-opacity="0.78" />
    <path d="M318 248 L318 ${248 - barB}" stroke="${palette.accent}" stroke-width="34" stroke-linecap="round" stroke-opacity="0.58" />
    <path d="M398 248 L398 ${248 - barC}" stroke="${palette.accent}" stroke-width="34" stroke-linecap="round" stroke-opacity="0.88" />
    <path d="M174 176 C242 132, 312 142, 392 104" stroke="#0F172A" stroke-width="7" stroke-linecap="round" stroke-opacity="0.18" />
    <circle cx="392" cy="104" r="10" fill="${palette.accent}" fill-opacity="0.9" />
    <rect x="422" y="138" width="66" height="24" rx="12" fill="${palette.accent}" fill-opacity="0.14" />
    <rect x="422" y="174" width="82" height="24" rx="12" fill="${palette.accent}" fill-opacity="0.1" />
  `.trim();
};

const renderNetworkMotif = (palette: ReturnType<typeof tonePalette>, seed: number) => {
  const centerX = 322 + ((seed >> 2) % 20) - 10;
  const centerY = 176 + ((seed >> 5) % 16) - 8;

  return `
    <circle cx="${centerX}" cy="${centerY}" r="48" fill="${palette.accent}" fill-opacity="0.13" stroke="${palette.border}" stroke-width="3" />
    <circle cx="168" cy="118" r="28" fill="${palette.surface}" stroke="${palette.border}" stroke-width="3" />
    <circle cx="490" cy="128" r="30" fill="${palette.surface}" stroke="${palette.border}" stroke-width="3" />
    <circle cx="152" cy="256" r="26" fill="${palette.surface}" stroke="${palette.border}" stroke-width="3" />
    <circle cx="500" cy="248" r="32" fill="${palette.surface}" stroke="${palette.border}" stroke-width="3" />
    <path d="M210 132 C250 146, 270 154, ${centerX - 50} ${centerY - 20}" stroke="${palette.accent}" stroke-width="6" stroke-linecap="round" stroke-opacity="0.76" />
    <path d="M460 145 C424 156, 406 162, ${centerX + 50} ${centerY - 12}" stroke="${palette.accent}" stroke-width="6" stroke-linecap="round" stroke-opacity="0.68" />
    <path d="M180 240 C228 224, 250 214, ${centerX - 54} ${centerY + 28}" stroke="${palette.accent}" stroke-width="6" stroke-linecap="round" stroke-opacity="0.68" />
    <path d="M468 234 C426 220, 404 212, ${centerX + 54} ${centerY + 22}" stroke="${palette.accent}" stroke-width="6" stroke-linecap="round" stroke-opacity="0.82" />
    <circle cx="${centerX}" cy="${centerY}" r="11" fill="${palette.accent}" />
  `.trim();
};

const renderSpotlightMotif = (palette: ReturnType<typeof tonePalette>, seed: number) => {
  const glowX = 214 + ((seed >> 3) % 42);
  const glowY = 154 + ((seed >> 6) % 38);

  return `
    <rect x="104" y="88" width="432" height="208" rx="30" fill="white" stroke="${palette.border}" stroke-width="2.5" />
    <circle cx="${glowX}" cy="${glowY}" r="82" fill="${palette.accent}" fill-opacity="0.12" />
    <circle cx="418" cy="150" r="54" fill="${palette.accent}" fill-opacity="0.08" />
    <rect x="146" y="120" width="166" height="118" rx="26" fill="${palette.surface}" stroke="${palette.border}" stroke-width="2" />
    <rect x="338" y="120" width="156" height="26" rx="13" fill="${palette.accent}" fill-opacity="0.15" />
    <rect x="338" y="160" width="124" height="22" rx="11" fill="${palette.accent}" fill-opacity="0.10" />
    <rect x="338" y="196" width="144" height="22" rx="11" fill="${palette.accent}" fill-opacity="0.10" />
    <path d="M182 258 C228 232, 274 232, 320 258" stroke="${palette.accent}" stroke-width="7" stroke-linecap="round" stroke-opacity="0.72" />
  `.trim();
};

const renderPeopleMotif = (palette: ReturnType<typeof tonePalette>, seed: number) => {
  const boardWidth = 164 + ((seed >> 4) % 24);

  return `
    <rect x="224" y="84" width="${boardWidth}" height="98" rx="22" fill="white" stroke="${palette.border}" stroke-width="2.5" />
    <rect x="248" y="112" width="${boardWidth - 48}" height="16" rx="8" fill="${palette.accent}" fill-opacity="0.16" />
    <rect x="248" y="140" width="${boardWidth - 82}" height="14" rx="7" fill="${palette.accent}" fill-opacity="0.1" />
    <circle cx="166" cy="214" r="26" fill="${palette.surface}" stroke="${palette.border}" stroke-width="3" />
    <circle cx="322" cy="238" r="28" fill="${palette.accent}" fill-opacity="0.12" stroke="${palette.border}" stroke-width="3" />
    <circle cx="478" cy="214" r="26" fill="${palette.surface}" stroke="${palette.border}" stroke-width="3" />
    <path d="M140 272 C148 244, 184 244, 192 272" stroke="${palette.border}" stroke-width="14" stroke-linecap="round" />
    <path d="M292 304 C300 270, 344 270, 352 304" stroke="${palette.accent}" stroke-width="16" stroke-linecap="round" stroke-opacity="0.62" />
    <path d="M452 272 C460 244, 496 244, 504 272" stroke="${palette.border}" stroke-width="14" stroke-linecap="round" />
  `.trim();
};

export const createSlideIllustrationDataUri = (
  descriptor: SlideIllustrationDescriptor,
) => {
  const accent = normalizeHexColor(descriptor.accentColor);
  const palette = tonePalette(descriptor.tone, accent);
  const seed = hashString(`${descriptor.title}:${descriptor.prompt}`);
  const motif = chooseIllustrationMotif(descriptor, seed);
  const motifMarkup = (() => {
    switch (motif) {
      case "workflow":
        return renderWorkflowMotif(palette, seed);
      case "analysis":
        return renderAnalysisMotif(palette, seed);
      case "network":
        return renderNetworkMotif(palette, seed);
      case "people":
        return renderPeopleMotif(palette, seed);
      case "spotlight":
      default:
        return renderSpotlightMotif(palette, seed);
    }
  })();

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" fill="none">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="640" y2="360" gradientUnits="userSpaceOnUse">
          <stop stop-color="${palette.surface}"/>
          <stop offset="1" stop-color="#F8FAFC"/>
        </linearGradient>
        <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
          <stop stop-color="${palette.accent}"/>
          <stop offset="1" stop-color="#0F172A"/>
        </linearGradient>
        <radialGradient id="glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(490 64) rotate(116.565) scale(212 306.24)">
          <stop stop-color="${palette.accent}" stop-opacity="0.18"/>
          <stop offset="1" stop-color="${palette.accent}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="640" height="360" rx="28" fill="url(#bg)"/>
      <rect x="20" y="20" width="600" height="320" rx="24" fill="white" stroke="${palette.border}" stroke-width="2"/>
      <rect x="20" y="20" width="600" height="320" rx="24" fill="url(#glow)"/>
      <rect x="54" y="52" width="132" height="18" rx="9" fill="${palette.accent}" fill-opacity="0.08"/>
      <circle cx="548" cy="76" r="10" fill="${palette.accent}" fill-opacity="0.14"/>
      <circle cx="578" cy="76" r="10" fill="${palette.accent}" fill-opacity="0.10"/>
      ${motifMarkup}
    </svg>
  `.trim();

  return encodeSvg(svg);
};

export const getPrimarySlideIllustration = (slide: Slide) => {
  const primarySlot = slide.visuals.imageSlots[0];

  if (!primarySlot) {
    return null;
  }

  return {
    ...primarySlot,
    kind: "curated" as const,
    dataUri: createSlideIllustrationDataUri({
      title: primarySlot.altText || slide.title,
      prompt: primarySlot.prompt,
      ...(primarySlot.caption ? { caption: primarySlot.caption } : {}),
      accentColor: slide.visuals.accentColor,
      tone: primarySlot.tone,
      layoutTemplate: slide.visuals.layoutTemplate,
    }),
  };
};
