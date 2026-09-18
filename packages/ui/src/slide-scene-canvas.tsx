import React from "react";
import { SLIDE_CANVAS, assertSlideTextLayout, type LaidOutSlideScene } from "@slidespeech/types";

/** A single coordinate system, including in thumbnails. Quote font families so numeric names remain valid CSS. */
export function SlideSceneCanvas({ scene }: { scene: LaidOutSlideScene }) {
  assertSlideTextLayout(scene);
  return <svg viewBox={`0 0 ${SLIDE_CANVAS.width} ${SLIDE_CANVAS.height}`} role="img" aria-label={scene.title} style={{ display: "block", width: "100%", aspectRatio: "16 / 9", background: `#${scene.background}` }}>
    {scene.elements.map((element, index) => element.kind === "rectangle"
      ? <rect key={index} x={element.x} y={element.y} width={element.width} height={element.height} fill={`#${element.fill}`} />
      : element.kind === "image" ? <image key={index} x={element.x} y={element.y} width={element.width} height={element.height} href={element.dataUrl} preserveAspectRatio="xMidYMid meet"><title>{element.alt}</title></image>
      : <g key={index} fontFamily={JSON.stringify(element.font)} fontSize={element.size} fontWeight={element.bold ? 700 : 400} fill={`#${element.color}`}>
        {element.textLayout.lines.map((line, lineIndex) => <text key={lineIndex} x={element.x + line.xOffset} y={element.y + line.top + line.baseline} xmlSpace="preserve">{line.text}</text>)}
      </g>)}
  </svg>;
}
