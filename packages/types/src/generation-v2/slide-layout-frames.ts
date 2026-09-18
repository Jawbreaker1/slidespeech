import type { SlideDesignSpec } from "./presentation";
import type { SlideLayoutFrame } from "./slide-scene";
import { createSlideFramePainter, type SlideFramePainter } from "./slide-frame-painter";
import { paintEditorialLayout } from "./slide-editorial-layouts";
import { paintSignalLayout } from "./slide-signal-layouts";

/** The writer and both renderers consume the same theme-resolved geometry. */
export function createSlideLayoutFrame(design: SlideDesignSpec, counts: { steps?: number; leftItems?: number; rightItems?: number } = {}, fonts = { heading: "Georgia", body: "Trebuchet MS" }): SlideLayoutFrame {
  const painter = createSlideFramePainter(design, counts, fonts);
  if (design.themeId === "editorial") paintEditorialLayout(painter);
  else if (design.themeId === "signal") paintSignalLayout(painter);
  else paintPaperLayout(painter);
  painter.text(["sourceLine"], 64, 676, 1152, 28, 14, fonts.body, painter.muted);
  return { background: painter.background, elements: painter.elements };
}

// Also retains the geometry for older designs without an explicit theme.
function paintPaperLayout(painter: SlideFramePainter) {
  const { layout, theme, heading, fonts, muted, rect, text, title, subtitle, count, image, counts } = painter;
  switch (layout.id) {
    case "image-opening": case "image-editorial":
      rect(64, 52, 56, 5, theme.accent);
      title(64, 86, 528, 174, 44); subtitle(64, 280, 528, 64);
      text(["content", "statement"], 64, 370, 528, 132, 30, heading);
      text(["content", "supportingText"], 64, 526, 528, 116, 22, fonts.body, muted);
      image(656, 72, 560, 544);
      text(["imageCredit"], 656, 626, 560, 32, 14, fonts.body, muted);
      break;
    case "image-left":
      image(64, 64, 620, 548);
      text(["imageCredit"], 64, 626, 620, 32, 14, fonts.body, muted);
      title(748, 82, 468, 174, 42); subtitle(748, 276, 468, 64);
      text(["content", "statement"], 748, 374, 468, 132, 30, heading);
      text(["content", "supportingText"], 748, 534, 468, 116, 22, fonts.body, muted);
      break;
    case "image-caption":
      title(64, 42, 1152, 68, 42); subtitle(64, 116, 1152, 38);
      image(64, 170, 1152, 332);
      text(["imageCredit"], 64, 510, 1152, 26, 14, fonts.body, muted);
      text(["content", "statement"], 64, 552, 664, 108, 28, heading);
      text(["content", "supportingText"], 784, 552, 432, 108, 22, fonts.body, muted);
      break;
    case "title-banner":
      title(64, 96, 1152, 226, 72); subtitle(64, 342, 1152, 64);
      rect(64, 446, 1152, 2, theme.secondary);
      text(["content", "statement"], 64, 480, 728, 152, 32, heading);
      text(["content", "supportingText"], 888, 486, 328, 150, 22, fonts.body, muted);
      break;
    case "title-minimal":
      subtitle(64, 68, 1040, 64);
      title(64, 224, 1056, 232, 68);
      text(["content", "statement"], 64, 500, 760, 120, 28, heading);
      text(["content", "supportingText"], 896, 500, 320, 120, 22, fonts.body, muted);
      break;
    case "statement-band":
      title(64, 64, 1152, 82, 36); subtitle(64, 164, 1152, 64);
      text(["content", "statement"], 64, 280, 1152, 244, 52, heading);
      text(["content", "supportingText"], 400, 560, 816, 96, 23, fonts.body, muted);
      break;
    case "statement-sidebar":
      title(64, 84, 320, 232, 40); subtitle(64, 362, 320, 140);
      rect(430, 80, 2, 548, theme.accent);
      text(["content", "statement"], 496, 96, 720, 282, 44, heading);
      text(["content", "supportingText"], 496, 432, 720, 204, 26, fonts.body, muted);
      break;
    case "comparison-bands":
      title(); subtitle();
      (["left", "right"] as const).forEach((side, index) => {
        const y = 304 + index * 180;
        rect(64, y, 1152, 2, index === 0 ? theme.accent : theme.secondary);
        text(["content", side, "heading"], 64, y + 20, 296, 130, 32, heading);
        for (let row = 0; row < count(side === "left" ? counts.leftItems : counts.rightItems); row++) text(["content", side, "items", row], 416, y + 18 + row * 46, 800, 42, 23);
      });
      break;
    case "comparison-ledger":
      title(64, 52, 1152, 112); subtitle(64, 180, 1152, 64);
      (["left", "right"] as const).forEach((side, index) => {
        const x = 64 + index * 608;
        text(["content", side, "heading"], x, 280, 544, 72, 34, heading);
        for (let row = 0; row < count(side === "left" ? counts.leftItems : counts.rightItems); row++) {
          rect(x, 366 + row * 72, 544, 1);
          text(["content", side, "items", row], x, 380 + row * 72, 544, 52, 23);
        }
      });
      break;
    case "process-vertical": {
      title(64, 72, 320, 220, 40); subtitle(64, 342, 320, 180);
      const steps = count(counts.steps), rowHeight = 552 / steps;
      for (let index = 0; index < steps; index++) {
        const y = 80 + index * rowHeight;
        text(String(index + 1).padStart(2, "0"), 440, y, 88, 72, 42, heading, theme.accent);
        text(["content", "steps", index, "label"], 556, y, 260, rowHeight - 24, 28, heading);
        text(["content", "steps", index, "description"], 864, y + 4, 352, rowHeight - 28, 23, fonts.body, muted);
        if (index < steps - 1) rect(440, y + rowHeight - 14, 776, 1);
      }
      break;
    }
    case "process-timeline": {
      title(); subtitle();
      const steps = count(counts.steps), width = 1152 / steps;
      rect(64, 396, 1152 - 32, 2, theme.secondary);
      for (let index = 0; index < steps; index++) {
        const x = 64 + index * width;
        text(["content", "steps", index, "label"], x, 306, width - 32, 76, 28, heading);
        rect(x, 388, 3, 18, theme.accent);
        text(["content", "steps", index, "description"], x, 432, width - 32, 198, 23, fonts.body, muted);
      }
      break;
    }
    case "quote-spotlight":
      title(64, 82, 288, 220, 34); subtitle(64, 330, 288, 132);
      text(["content", "attribution"], 64, 536, 288, 112, 21, fonts.body, muted);
      rect(410, 82, 2, 548, theme.secondary);
      text(["content", "quote"], 478, 126, 738, 492, 48, heading);
      break;
    case "closing-split":
      title(64, 90, 432, 190, 44); subtitle(64, 304, 432, 106);
      text(["content", "guidance"], 64, 458, 432, 182, 24, fonts.body, muted);
      rect(560, 90, 2, 534, theme.accent);
      text(["content", "question"], 632, 192, 584, 424, 48, heading);
      break;
    default:
      rect(64, 52, 56, 5, theme.accent);
      title(); subtitle();
      switch (layout.id) {
        case "editorial-opening": case "editorial-statement":
          rect(64, 320, 4, 244, theme.accent);
          text(["content", "statement"], 96, 318, 700, 246, 37, heading);
          text(["content", "supportingText"], 872, 324, 344, 260, 25, fonts.body, muted);
          break;
        case "split-comparison":
          (["left", "right"] as const).forEach((side, index) => {
            const x = 64 + index * 608;
            rect(x, 306, 544, 3, index === 0 ? theme.accent : theme.secondary);
            text(["content", side, "heading"], x, 330, 544, 64, 34, heading);
            for (let row = 0; row < count(side === "left" ? counts.leftItems : counts.rightItems); row++) text(["content", side, "items", row], x, 414 + row * 54, 544, 50, 23);
          });
          break;
        case "numbered-process": {
          const steps = count(counts.steps), width = 1152 / steps;
          for (let index = 0; index < steps; index++) {
            const x = 64 + width * index;
            text(String(index + 1).padStart(2, "0"), x, 304, width - 32, 92, 60, heading, theme.accent);
            rect(x, 396, width - 32, 2);
            text(["content", "steps", index, "label"], x, 420, width - 32, 68, 28, heading);
            text(["content", "steps", index, "description"], x, 504, width - 32, 128, 23, fonts.body, muted);
          }
          break;
        }
        case "editorial-quote":
          text(["content", "quote"], 112, 302, 1056, 256, 42, heading);
          text(["content", "attribution"], 112, 590, 1056, 48, 22, fonts.body, muted);
          break;
        case "closing-question":
          text(["content", "question"], 64, 316, 1032, 206, 48, heading);
          text(["content", "guidance"], 64, 564, 1032, 76, 24, fonts.body, muted);
          break;
        default: throw new Error("No implementation for selected layout.");
      }
  }
}
