import Link from "next/link";

type PresenterHeaderProps = {
  title: string;
  summary: string;
  pptxExportUrl: string;
};

export const PresenterHeader = ({
  title,
  summary,
  pptxExportUrl,
}: PresenterHeaderProps) => (
  <div className="mb-6 flex flex-col gap-4 rounded-[30px] border border-white/10 bg-white/5 p-5 md:flex-row md:items-center md:justify-between">
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-paper/55">
        Presenter mode
      </p>
      <h1 className="mt-2 text-2xl font-semibold md:text-3xl">{title}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-paper/70">
        {summary}
      </p>
    </div>
    <div className="flex flex-wrap gap-3">
      <Link
        className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-paper transition hover:border-white/40"
        href="/workbench"
      >
        Open workbench
      </Link>
      <a
        className="rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white transition hover:brightness-95"
        href={pptxExportUrl}
      >
        Download PPTX
      </a>
    </div>
  </div>
);
