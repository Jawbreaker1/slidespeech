interface DebugPanelProps {
  title: string;
  children: React.ReactNode;
}

export const DebugPanel = ({ title, children }: DebugPanelProps) => (
  <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-panel">
    <div className="mb-4 flex items-center justify-between">
      <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
        {title}
      </h3>
    </div>
    {children}
  </section>
);

