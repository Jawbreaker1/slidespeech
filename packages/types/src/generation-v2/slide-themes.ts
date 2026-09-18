import type { PresentationThemeId } from "../presentation-themes";

export type SlideTheme = {
  label: string; description: string; heading: "serif" | "sans";
  page: { background: string; ink: string; muted: string };
  cover: { background: string; ink: string; muted: string };
  accent: string; secondary: string; rule: string;
};

/** Shared author/rendering tokens. These do not select themes by subject. */
export const SLIDE_THEMES: Record<PresentationThemeId, SlideTheme> = {
  editorial: {
    label: "Editorial", description: "Magazine spreads: literary serif headlines, margin titles, asymmetric columns and image-led storytelling.", heading: "serif",
    page: { background: "F7F4EA", ink: "193E35", muted: "526A62" },
    cover: { background: "193E35", ink: "F7F4EA", muted: "C3D4C4" },
    accent: "C16C43", secondary: "779D86", rule: "B7C8B9",
  },
  paper: {
    label: "Paper", description: "An airy report: restrained sans-serif headings, clear top-down hierarchy, balanced columns and fine rules.", heading: "sans",
    page: { background: "FFFFFF", ink: "242424", muted: "626262" },
    cover: { background: "FFFFFF", ink: "242424", muted: "626262" },
    accent: "B63C28", secondary: "242424", rule: "D5D2CD",
  },
  signal: {
    label: "Signal", description: "Typographic posters: oversized sans-serif statements, offset titles, bold scale contrasts and compact step grids.", heading: "sans",
    page: { background: "F2F5FC", ink: "132652", muted: "4E6081" },
    cover: { background: "153BC8", ink: "FFFFFF", muted: "DCE5FF" },
    accent: "A94B14", secondary: "5178CD", rule: "B9C9E7",
  },
};
