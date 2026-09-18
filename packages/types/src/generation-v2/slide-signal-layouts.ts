import type { SlideFramePainter } from "./slide-frame-painter";

/** Typographic posters: large sans headlines, offset hierarchy and compact sequences. */
export function paintSignalLayout(p: SlideFramePainter) {
  const { layout, theme, heading, fonts, muted, rect, text, title, subtitle, image, count, counts } = p;
  switch (layout.id) {
    case "editorial-opening":
      text(["content", "statement"], 64, 92, 288, 288, 34, heading);
      title(448, 80, 768, 356, 92); subtitle(448, 478, 768, 64);
      text(["content", "supportingText"], 448, 574, 768, 84, 24, fonts.body, muted);
      break;
    case "title-banner":
      title(64, 80, 1152, 284, 92); subtitle(64, 398, 1152, 80);
      text(["content", "statement"], 64, 536, 720, 124, 36, heading);
      text(["content", "supportingText"], 888, 538, 328, 122, 22, fonts.body, muted);
      break;
    case "title-minimal":
      subtitle(64, 72, 672, 96); title(64, 264, 1152, 244, 84);
      text(["content", "statement"], 64, 556, 760, 104, 34, heading);
      text(["content", "supportingText"], 896, 556, 320, 104, 22, fonts.body, muted);
      break;
    case "editorial-statement":
      title(64, 58, 1152, 134, 60); subtitle(64, 228, 1152, 64);
      text(["content", "statement"], 64, 338, 1152, 182, 52, heading);
      text(["content", "supportingText"], 432, 570, 784, 88, 26, fonts.body, muted);
      break;
    case "statement-sidebar": case "statement-band":
      title(64, 68, 288, 236, 44); subtitle(64, 366, 288, 176);
      text(["content", "statement"], 448, 96, 768, 330, layout.id === "statement-band" ? 64 : 56, heading);
      text(["content", "supportingText"], 448, 506, 768, 150, 26, fonts.body, muted);
      break;
    case "split-comparison":
      title(64, 452, 360, 194, 46); subtitle(64, 80, 360, 152);
      (["left", "right"] as const).forEach((side, index) => {
        const x = 512 + index * 376;
        text(["content", side, "heading"], x, 84, 328, 112, 44, heading);
        for (let row = 0; row < count(side === "left" ? counts.leftItems : counts.rightItems); row++) text(["content", side, "items", row], x, 256 + row * 94, 328, 78, 25);
      });
      break;
    case "comparison-bands":
      title(64, 54, 1152, 112, 60); subtitle(64, 202, 1152, 64);
      (["left", "right"] as const).forEach((side, index) => {
        const y = 316 + index * 180;
        text(["content", side, "heading"], 64, y, 352, 138, 42, heading);
        for (let row = 0; row < count(side === "left" ? counts.leftItems : counts.rightItems); row++) text(["content", side, "items", row], 512, y + row * 46, 704, 42, 25);
      });
      break;
    case "comparison-ledger":
      (["left", "right"] as const).forEach((side, index) => {
        const x = 64 + index * 608;
        text(["content", side, "heading"], x, 64, 544, 88, 44, heading);
        rect(x, 182, 544, 2, theme.secondary);
        for (let row = 0; row < count(side === "left" ? counts.leftItems : counts.rightItems); row++) text(["content", side, "items", row], x, 218 + row * 76, 544, 60, 26);
      });
      title(64, 554, 816, 108, 46); subtitle(960, 556, 256, 100);
      break;
    case "numbered-process": {
      title(64, 54, 1152, 118, 60); subtitle(64, 208, 1152, 64);
      const steps = count(counts.steps), columns = Math.min(2, steps), width = 1152 / columns, rows = Math.ceil(steps / columns), rowHeight = 356 / rows;
      for (let index = 0; index < steps; index++) {
        const x = 64 + index % columns * width, y = 304 + Math.floor(index / columns) * rowHeight;
        text(String(index + 1).padStart(2, "0"), x, y, 116, 126, 84, heading, theme.accent);
        text(["content", "steps", index, "label"], x + 148, y, width - 180, 50, 30, heading);
        text(["content", "steps", index, "description"], x + 148, y + 74, width - 180, rowHeight - 82, 24, fonts.body, muted);
      }
      break;
    }
    case "process-vertical": {
      title(64, 76, 448, 230, 64); subtitle(64, 370, 448, 154);
      const steps = count(counts.steps), rowHeight = 576 / steps;
      for (let index = 0; index < steps; index++) {
        const y = 72 + index * rowHeight;
        text(String(index + 1).padStart(2, "0"), 576, y, 112, 96, 62, heading, theme.accent);
        text(["content", "steps", index, "label"], 744, y, 472, 48, 32, heading);
        text(["content", "steps", index, "description"], 744, y + 66, 472, rowHeight - 78, 24, fonts.body, muted);
      }
      break;
    }
    case "process-timeline": {
      title(64, 76, 352, 242, 52); subtitle(64, 380, 352, 168);
      const steps = count(counts.steps), width = 704 / steps;
      rect(512, 386, 680, 2, theme.secondary);
      for (let index = 0; index < steps; index++) {
        const x = 512 + index * width;
        text(["content", "steps", index, "label"], x, 232, width - 24, 120, 28, heading);
        rect(x, 378, 3, 20, theme.accent);
        text(["content", "steps", index, "description"], x, 434, width - 24, 214, 24, fonts.body, muted);
      }
      break;
    }
    case "editorial-quote":
      subtitle(64, 48, 1152, 36);
      text(["content", "quote"], 64, 122, 1152, 352, 70, heading);
      title(64, 550, 624, 108, 40);
      text(["content", "attribution"], 832, 554, 384, 104, 24, fonts.body, muted);
      break;
    case "quote-spotlight":
      title(64, 72, 304, 224, 44); subtitle(64, 362, 304, 176);
      text(["content", "quote"], 448, 88, 768, 426, 60, heading);
      text(["content", "attribution"], 448, 584, 768, 72, 24, fonts.body, muted);
      break;
    case "closing-question":
      title(64, 50, 1152, 60, 32);
      text(["content", "question"], 64, 172, 1152, 322, 80, heading);
      subtitle(64, 566, 400, 92);
      text(["content", "guidance"], 576, 566, 640, 92, 28, fonts.body, muted);
      break;
    case "closing-split":
      text(["content", "question"], 64, 82, 736, 424, 70, heading);
      title(896, 80, 320, 216, 40); subtitle(896, 358, 320, 142);
      text(["content", "guidance"], 64, 566, 1152, 92, 30, fonts.body, muted);
      break;
    case "image-opening": case "image-editorial":
      text(["content", "statement"], 64, 90, 552, 212, 44, heading);
      subtitle(64, 338, 552, 72); title(64, 460, 552, 110, 48);
      text(["content", "supportingText"], 64, 598, 552, 62, 22, fonts.body, muted);
      image(704, 64, 512, 538); text(["imageCredit"], 704, 628, 512, 30, 14, fonts.body, muted);
      break;
    case "image-left":
      image(64, 64, 520, 548); text(["imageCredit"], 64, 632, 520, 28, 14, fonts.body, muted);
      title(672, 64, 544, 162, 58); subtitle(672, 264, 544, 72);
      text(["content", "statement"], 672, 384, 544, 132, 40, heading);
      text(["content", "supportingText"], 672, 554, 544, 106, 24, fonts.body, muted);
      break;
    case "image-caption":
      image(64, 64, 784, 520); text(["imageCredit"], 64, 604, 784, 28, 14, fonts.body, muted);
      subtitle(64, 636, 784, 34);
      title(928, 64, 288, 180, 44);
      text(["content", "statement"], 928, 302, 288, 166, 30, heading);
      text(["content", "supportingText"], 928, 516, 288, 144, 22, fonts.body, muted);
      break;
    default: {
      const unsupported: never = layout;
      throw new Error(`Signal composition is missing: ${String(unsupported)}`);
    }
  }
}
