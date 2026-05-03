import type { Deck } from "@slidespeech/types";

type GroundingPanelProps = {
  source: Deck["source"];
};

export const GroundingPanel = ({ source }: GroundingPanelProps) => (
  <section className="rounded-[28px] border border-white/10 bg-white/5 p-5">
    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-paper/55">
      Grounding
    </p>
    <p className="mt-3 text-sm leading-6 text-paper/70">
      Source type: {source.type}
    </p>
    <div className="mt-3 space-y-2">
      {source.sourceIds.length > 0 ? (
        source.sourceIds.map((sourceUrl) => (
          <a
            className="block break-all text-sm text-coral underline-offset-2 hover:underline"
            href={sourceUrl}
            key={sourceUrl}
            rel="noreferrer"
            target="_blank"
          >
            {sourceUrl}
          </a>
        ))
      ) : (
        <p className="text-sm leading-6 text-paper/60">
          No external sources were attached to this session.
        </p>
      )}
    </div>
  </section>
);
