import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, Loader2 } from "lucide-react";
import { fmtBytes, fmtInt } from "@/lib/catalog-display";
import { cn } from "@/lib/utils";
import type { BundleIndexResponse, BundleSampleFiles } from "@/integrations/api/types";

function FileRow({ name, bytes }: { name: string; bytes: number }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1 pl-6 text-[12.5px]">
      <span className="inline-flex items-center gap-1.5 min-w-0 text-foreground/85">
        <FileText size={12} className="shrink-0 text-muted-foreground" />
        <span className="font-mono truncate">{name}</span>
      </span>
      <span className="font-mono tabular text-muted-foreground shrink-0">{fmtBytes(bytes)}</span>
    </li>
  );
}

function SampleNode({ sample }: { sample: BundleSampleFiles }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center justify-between gap-3 w-full py-1.5 text-[13px] hover:bg-secondary/60 rounded-sm px-1 -mx-1"
      >
        <span className="inline-flex items-center gap-1.5 min-w-0">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="font-mono text-foreground truncate">{sample.gsm_id}</span>
          <span className="text-muted-foreground">({sample.files.length} file{sample.files.length === 1 ? "" : "s"})</span>
        </span>
        <span className="font-mono tabular text-muted-foreground shrink-0">{fmtBytes(sample.total_bytes)}</span>
      </button>
      {open && (
        <ul>
          {sample.files.map((f) => (
            <FileRow key={f.path} name={f.path} bytes={f.bytes_compressed} />
          ))}
        </ul>
      )}
    </li>
  );
}

interface FileTreePanelProps {
  index: BundleIndexResponse | undefined;
  isLoading: boolean;
  isError: boolean;
}

/** "What's in the file" — compact tree over the bundle's manifest. Never a hard error. */
export function FileTreePanel({ index, isLoading, isError }: FileTreePanelProps) {
  if (isError) {
    return (
      <section className="mb-6" aria-labelledby="filetree-h">
        <h2 id="filetree-h" className="text-[18px] mb-2">What's in the file</h2>
        <p className="text-[13px] text-muted-foreground">File contents aren't available right now.</p>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className="mb-6" aria-labelledby="filetree-h">
        <h2 id="filetree-h" className="text-[18px] mb-2">What's in the file</h2>
        <p className="text-[13px] text-muted-foreground inline-flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> Reading the published file…
        </p>
      </section>
    );
  }

  if (!index) return null;

  const meta = [
    index.reference_build ? `Reference ${index.reference_build}` : null,
    index.singlet_version ? `pipeline ${index.singlet_version}` : null,
    index.created_at ? `packed ${index.created_at.slice(0, 10)}` : null,
  ].filter(Boolean);

  return (
    <section className="mb-6" aria-labelledby="filetree-h">
      <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
        <h2 id="filetree-h" className="text-[18px]">What's in the file</h2>
        <span className="text-[12px] text-muted-foreground tabular">
          {fmtBytes(index.bytes)} · {fmtInt(index.n_samples)} sample{index.n_samples === 1 ? "" : "s"}
          {meta.length > 0 && ` · ${meta.join(" · ")}`}
        </span>
      </div>
      <div className="surface px-2 py-2">
        {index.study_files.length > 0 && (
          <div className="mb-1.5">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground px-1 py-1">Study-level files</p>
            <ul>
              {index.study_files.map((f) => (
                <FileRow key={f.path} name={f.path} bytes={f.bytes_compressed} />
              ))}
            </ul>
          </div>
        )}
        {index.samples.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground px-1 py-1">
              Samples ({fmtInt(index.samples.length)})
            </p>
            <ul className={cn("divide-y divide-border/60")}>
              {index.samples.map((s) => (
                <SampleNode key={s.gsm_id} sample={s} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
