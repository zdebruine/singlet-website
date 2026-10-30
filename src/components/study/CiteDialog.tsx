import { useState } from "react";
import { Check, Copy, Quote } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Link } from "react-router-dom";
import { CodeBlock } from "@/components/CodeBlock";
import { RELEASE_NAME, atlasCitation, today } from "../../../functions/_shared/citation";

interface CiteDialogProps {
  gseId: string;
  title: string | null;
  year: number | null;
  pubmedIds: string[];
  doi: string | null;
  /** The pipeline release that produced the file (`singlet_version`), when the file records one. */
  pipelineVersion?: string | null;
}

/**
 * "Cite" button + dialog. Only cites facts we actually have (accession, title,
 * year, PubMed id(s), DOI). Never invents authors or a journal name — falls
 * back to citing the dataset itself (`@misc`) when no publication DOI exists.
 * Below it, the singlet.bio citation (functions/_shared/citation.ts), which a paper cites alongside the study.
 */
export function CiteDialog({ gseId, title, year, pubmedIds, doi, pipelineVersion }: CiteDialogProps) {
  const [open, setOpen] = useState(false);
  const safeTitle = title ?? gseId;
  const url = `https://singlet.bio/study/${gseId}`;
  const yearStr = year ? String(year) : "n.d.";
  const pubmedLine = pubmedIds.length
    ? `PubMed: ${pubmedIds.join(", ")} (https://pubmed.ncbi.nlm.nih.gov/${pubmedIds[0]}/)`
    : null;
  const doiLine = doi ? `DOI: https://doi.org/${doi}` : null;
  const pipeline = pipelineVersion && pipelineVersion !== "unknown" ? `, pipeline ${pipelineVersion}` : "";
  const reprocessed = `reprocessed by singlet.bio (${RELEASE_NAME}${pipeline})`;

  const text = [
    `${safeTitle}. ${gseId}${year ? ` (${year})` : ""}.`,
    `${reprocessed[0].toUpperCase()}${reprocessed.slice(1)} from the public GEO record; data are CC0.`,
    pubmedLine,
    doiLine,
    `Available at ${url} (originally deposited as ${gseId} on NCBI GEO).`,
  ]
    .filter(Boolean)
    .join(" ");

  const bibtexKey = gseId.toLowerCase();
  const bibtex = [
    `@misc{${bibtexKey},`,
    `  title        = {${safeTitle}},`,
    `  howpublished = {singlet.bio},`,
    `  year         = {${yearStr}},`,
    `  note         = {GEO accession ${gseId}; ${reprocessed}; data CC0}${pubmedIds.length || doi ? "," : ""}`,
    ...(pubmedIds.length ? [`  eprint       = {${pubmedIds[0]}},\n  eprinttype   = {pubmed}${doi ? "," : ""}`] : []),
    ...(doi ? [`  doi          = {${doi}}`] : []),
    `  url          = {${url}}`,
    `}`,
  ].join("\n");

  const ris = [
    `TY  - DATA`,
    `TI  - ${safeTitle}`,
    ...(year ? [`PY  - ${year}`] : []),
    `PB  - singlet.bio`,
    `UR  - ${url}`,
    ...(pubmedIds.map((id) => `AN  - PMID:${id}`)),
    ...(doi ? [`DO  - ${doi}`] : []),
    `N1  - GEO accession ${gseId}; ${reprocessed}; data CC0`,
    `ER  - `,
  ].join("\n");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="btn-secondary btn-sm inline-flex items-center gap-1.5">
          <Quote size={13} /> Cite
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[17px]">Cite {gseId}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Citation text</p>
            <div className="surface px-3 py-2.5 text-[13px] leading-relaxed flex items-start justify-between gap-3">
              <p className="text-foreground/90">{text}</p>
              <CopyIcon text={text} />
            </div>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">BibTeX</p>
            <CodeBlock code={bibtex} label="BibTeX" compact wrap />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">RIS</p>
            <CodeBlock code={ris} label="RIS" compact wrap />
          </div>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            We only cite what GEO and PubMed report for {gseId}; if this study has a specific journal citation we haven't
            captured, please cite that directly.
          </p>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Also cite singlet.bio</p>
            <div className="surface px-3 py-2.5 text-[13px] leading-relaxed flex items-start justify-between gap-3">
              <p className="text-foreground/90">{atlasCitation(today())}</p>
              <CopyIcon text={atlasCitation(today())} />
            </div>
          </div>
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            BibTeX, RIS and the Python and R package citations:{" "}
            <Link to="/about#cite" onClick={() => setOpen(false)} className="text-primary hover:underline">How to cite</Link>.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CopyIcon({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        })
      }
      className="shrink-0 text-muted-foreground hover:text-foreground mt-0.5"
      aria-label="Copy citation text"
      title="Copy citation text"
    >
      {copied ? <Check size={13} className="text-primary" /> : <Copy size={13} />}
    </button>
  );
}
