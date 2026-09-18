import type { SlideFramePainter } from "./slide-frame-painter";

/** Magazine compositions: serif hierarchy, margin titles and image-led spreads. */
export function paintEditorialLayout(p: SlideFramePainter) {
  const { layout, theme, heading, fonts, muted, rect, text, title, subtitle, image, count, counts } = p;
  switch (layout.id) {
    case "editorial-opening": case "title-banner":
      title(64, 66, 1152, 214, layout.id === "title-banner" ? 82 : 74); subtitle(64, 302, 800, 64);
      rect(64, 398, 1152, 1, theme.secondary);
      text(["content", "statement"], 64, 434, 672, 198, 38, heading);
      text(["content", "supportingText"], 832, 438, 384, 194, 24, fonts.body, muted);
      break;
    case "title-minimal":
      subtitle(64, 98, 288, 152); title(448, 92, 768, 244, 68);
      text(["content", "statement"], 448, 390, 768, 162, 36, heading);
      text(["content", "supportingText"], 448, 576, 768, 80, 23, fonts.body, muted);
      break;
    case "editorial-statement":
      title(64, 72, 328, 174, 44); subtitle(64, 274, 328, 174);
      rect(440, 72, 1, 568);
      text(["content", "statement"], 504, 88, 712, 290, 48, heading);
      text(["content", "supportingText"], 504, 442, 712, 198, 26, fonts.body, muted);
      break;
    case "statement-sidebar":
      title(64, 80, 448, 244, 52); subtitle(64, 382, 448, 164);
      text(["content", "statement"], 640, 96, 576, 300, 42, heading);
      rect(640, 432, 576, 1);
      text(["content", "supportingText"], 640, 466, 576, 174, 25, fonts.body, muted);
      break;
    case "statement-band":
      title(64, 58, 1152, 100, 40); subtitle(64, 186, 1100, 64);
      text(["content", "statement"], 128, 302, 1088, 242, 54, heading);
      text(["content", "supportingText"], 128, 588, 920, 72, 25, fonts.body, muted);
      break;
    case "split-comparison":
      title(64, 92, 288, 224, 42); subtitle(64, 362, 288, 194);
      (["left", "right"] as const).forEach((side, column) => {
        const x = 448 + column * 416;
        text(["content", side, "heading"], x, 98, 352, 92, 36, heading);
        for (let row = 0; row < count(side === "left" ? counts.leftItems : counts.rightItems); row++) {
          rect(x, 214 + row * 104, 352, 1);
          text(["content", side, "items", row], x, 236 + row * 104, 352, 76, 24);
        }
      });
      break;
    case "comparison-bands":
      title(64, 54, 1152, 112, 48); subtitle(64, 190, 1152, 64);
      (["left", "right"] as const).forEach((side, index) => {
        const y = 300 + index * 184;
        text(["content", side, "heading"], 64, y, 352, 150, 38, heading);
        rect(448, y, 1, 150);
        for (let row = 0; row < count(side === "left" ? counts.leftItems : counts.rightItems); row++) text(["content", side, "items", row], 512, y + row * 48, 704, 44, 24);
      });
      break;
    case "comparison-ledger":
      title(64, 60, 768, 118, 48); subtitle(896, 68, 320, 110);
      (["left", "right"] as const).forEach((side, index) => {
        const x = 128 + index * 576;
        text(["content", side, "heading"], x, 248, 512, 72, 36, heading);
        for (let row = 0; row < count(side === "left" ? counts.leftItems : counts.rightItems); row++) {
          rect(x, 342 + row * 76, 512, 1);
          text(["content", side, "items", row], x, 358 + row * 76, 512, 56, 24);
        }
      });
      break;
    case "numbered-process": case "process-vertical": {
      const vertical = layout.id === "process-vertical";
      title(64, 72, vertical ? 352 : 1152, vertical ? 230 : 112, vertical ? 48 : 52);
      subtitle(64, vertical ? 342 : 204, vertical ? 352 : 1152, vertical ? 176 : 64);
      const steps = count(counts.steps), top = vertical ? 80 : 300, rowHeight = (648 - top) / steps;
      for (let index = 0; index < steps; index++) {
        const y = top + index * rowHeight, x = vertical ? 480 : 64;
        text(String(index + 1).padStart(2, "0"), x, y, 72, rowHeight - 12, 34, heading, theme.accent);
        text(["content", "steps", index, "label"], x + 100, y, vertical ? 240 : 304, rowHeight - 12, 28, heading);
        text(["content", "steps", index, "description"], vertical ? 912 : 544, y + 2, vertical ? 304 : 672, rowHeight - 14, 23, fonts.body, muted);
      }
      break;
    }
    case "process-timeline": {
      title(64, 64, 960, 120, 52); subtitle(64, 212, 1088, 64);
      const steps = count(counts.steps), width = 1152 / steps;
      rect(64, 342, 1120, 1, theme.secondary);
      for (let index = 0; index < steps; index++) {
        const x = 64 + index * width;
        rect(x, 334, 2, 18, theme.accent);
        text(["content", "steps", index, "label"], x, 384, width - 32, 92, 32, heading);
        text(["content", "steps", index, "description"], x, 514, width - 32, 138, 24, fonts.body, muted);
      }
      break;
    }
    case "editorial-quote":
      text(["content", "quote"], 64, 94, 768, 428, 58, heading);
      text(["content", "attribution"], 64, 578, 768, 78, 24, fonts.body, muted);
      title(928, 96, 288, 210, 34); subtitle(928, 360, 288, 184);
      break;
    case "quote-spotlight":
      title(64, 62, 1152, 96, 36); subtitle(64, 188, 1152, 64);
      text(["content", "quote"], 176, 298, 1040, 272, 54, heading);
      text(["content", "attribution"], 640, 612, 576, 48, 23, fonts.body, muted);
      break;
    case "closing-question":
      title(64, 58, 1152, 80, 34);
      text(["content", "question"], 64, 206, 1152, 286, 70, heading);
      subtitle(64, 556, 480, 100);
      text(["content", "guidance"], 640, 550, 576, 106, 24, fonts.body, muted);
      break;
    case "closing-split":
      title(64, 80, 480, 194, 48); subtitle(64, 320, 480, 76);
      text(["content", "question"], 672, 96, 544, 380, 54, heading);
      text(["content", "guidance"], 64, 458, 480, 174, 25, fonts.body, muted);
      break;
    case "image-opening": case "image-editorial":
      image(64, 80, 680, 514); text(["imageCredit"], 64, 614, 680, 32, 14, fonts.body, muted);
      title(808, 80, 408, 160, 44); subtitle(808, 270, 408, 64);
      text(["content", "statement"], 808, 366, 408, 148, 32, heading);
      text(["content", "supportingText"], 808, 546, 408, 112, 22, fonts.body, muted);
      break;
    case "image-left":
      title(64, 48, 1152, 96, 48); subtitle(64, 166, 1152, 44);
      image(64, 246, 600, 366); text(["imageCredit"], 64, 630, 600, 28, 14, fonts.body, muted);
      text(["content", "statement"], 744, 252, 472, 218, 36, heading);
      text(["content", "supportingText"], 744, 518, 472, 140, 24, fonts.body, muted);
      break;
    case "image-caption":
      title(64, 50, 1152, 78, 44); image(64, 156, 1152, 344);
      text(["imageCredit"], 64, 514, 1152, 28, 14, fonts.body, muted);
      subtitle(64, 564, 288, 90);
      text(["content", "statement"], 416, 564, 464, 100, 30, heading);
      text(["content", "supportingText"], 928, 564, 288, 100, 21, fonts.body, muted);
      break;
    default: {
      const unsupported: never = layout;
      throw new Error(`Editorial composition is missing: ${String(unsupported)}`);
    }
  }
}
