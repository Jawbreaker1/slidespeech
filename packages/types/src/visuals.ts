import type { Slide, SlideVisualTone } from "./domain";

export interface SlideIllustrationDescriptor {
  title: string;
  prompt: string;
  caption?: string;
  accentColor?: string;
  tone?: SlideVisualTone;
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

export const createSlideIllustrationDataUri = (
  descriptor: SlideIllustrationDescriptor,
) => {
  const accent = normalizeHexColor(descriptor.accentColor);
  const palette = tonePalette(descriptor.tone, accent);
  const seed = hashString(`${descriptor.title}:${descriptor.prompt}`);
  const circleX = 90 + (seed % 120);
  const circleY = 86 + ((seed >> 3) % 70);
  const circleRadius = 42 + ((seed >> 5) % 26);
  const squareX = 210 + ((seed >> 7) % 80);
  const squareY = 52 + ((seed >> 9) % 66);
  const squareSize = 58 + ((seed >> 11) % 28);
  const lineOffset = 40 + ((seed >> 13) % 45);
  const title = escapeXml(shorten(descriptor.title, 42));
  const prompt = escapeXml(shorten(descriptor.prompt, 88));
  const caption = descriptor.caption
    ? escapeXml(shorten(descriptor.caption, 58))
    : "";

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
      <circle cx="${circleX}" cy="${circleY}" r="${circleRadius}" fill="${palette.accent}" fill-opacity="0.10"/>
      <rect x="${squareX}" y="${squareY}" width="${squareSize}" height="${squareSize}" rx="18" fill="${palette.accent}" fill-opacity="0.1"/>
      <path d="M64 ${236 - lineOffset} C180 ${176 - lineOffset}, 242 ${258 - lineOffset}, 352 ${188 - lineOffset}" stroke="${palette.accent}" stroke-width="8" stroke-linecap="round" stroke-opacity="0.75"/>
      <path d="M210 252 C268 214, 330 300, 402 232" stroke="#0F172A" stroke-width="5" stroke-linecap="round" stroke-opacity="0.18"/>
      <rect x="64" y="214" width="116" height="78" rx="18" fill="${palette.surface}" stroke="${palette.border}" stroke-width="1.5"/>
      <rect x="194" y="160" width="140" height="92" rx="18" fill="${palette.surface}" stroke="${palette.border}" stroke-width="1.5"/>
      <rect x="350" y="206" width="138" height="76" rx="18" fill="${palette.surface}" stroke="${palette.border}" stroke-width="1.5"/>
      <rect x="64" y="54" width="116" height="32" rx="16" fill="${palette.accent}" fill-opacity="0.1"/>
      <text x="82" y="75" fill="${palette.text}" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="700" letter-spacing="1.8">ILLUSTRATION</text>
      <text x="64" y="126" fill="#0F172A" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700">${title}</text>
      <foreignObject x="64" y="142" width="516" height="78">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Arial, Helvetica, sans-serif; font-size: 17px; line-height: 1.45; color: #334155;">
          ${prompt}
        </div>
      </foreignObject>
      ${
        caption
          ? `<text x="64" y="316" fill="${palette.text}" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="600">${caption}</text>`
          : ""
      }
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
    dataUri: createSlideIllustrationDataUri({
      title: primarySlot.altText || slide.title,
      prompt: primarySlot.prompt,
      ...(primarySlot.caption ? { caption: primarySlot.caption } : {}),
      accentColor: slide.visuals.accentColor,
      tone: primarySlot.tone,
    }),
  };
};
