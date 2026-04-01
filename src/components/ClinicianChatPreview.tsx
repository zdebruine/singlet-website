const ClinicianChatPreview = () => {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-lg">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-muted/30">
        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
          <span className="text-primary text-xs font-bold">PGI</span>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">Singlet AI PGI</p>
          <p className="text-[10px] text-muted-foreground">Clinical Genomics Intelligence</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-[10px] text-muted-foreground">Online</span>
        </div>
      </div>

      {/* Chat body */}
      <div className="p-5 space-y-4 max-h-[420px]">
        {/* Clinician message */}
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-xl rounded-tr-sm bg-primary/10 border border-primary/20 px-4 py-3">
            <p className="text-sm text-foreground">
              My patient has a novel missense variant in <span className="font-semibold text-primary">BMPR1B</span> with craniofacial anomalies. What cell types are affected and what's the mechanism?
            </p>
          </div>
        </div>

        {/* AI response */}
        <div className="flex justify-start">
          <div className="max-w-[92%] space-y-3">
            {/* Cell type result */}
            <div className="rounded-xl rounded-tl-sm bg-muted/50 border border-border px-4 py-3 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                <span className="text-xs font-semibold text-primary uppercase tracking-wider">Cell-Type Resolution</span>
              </div>
              <p className="text-sm text-foreground leading-relaxed">
                This variant disrupts <span className="font-semibold text-primary">BMP signaling</span> in <span className="font-semibold">cranial neural crest cells</span> (CNCCs) during craniofacial morphogenesis.
              </p>

              {/* Mechanism box */}
              <div className="rounded-lg bg-background border border-border/60 p-3">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Developmental Mechanism</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  BMPR1B is required for CNCC migration from the dorsal neural tube into the pharyngeal arches (BA1/BA2). Loss-of-function disrupts <span className="text-foreground font-medium">SMAD1/5/8 phosphorylation</span> → impaired osteoblast differentiation in the mandibular and maxillary prominences → craniofacial skeletal hypoplasia.
                </p>
              </div>

              {/* Anatomical pathway */}
              <div className="rounded-lg bg-background border border-border/60 p-3">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Anatomical Pathway</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Neural plate border → premigratory CNCC → migratory CNCC → pharyngeal arch mesenchyme → mandible/maxilla osteoprogenitors. Disruption at migration stage consistent with <span className="text-foreground font-medium">BA1 hypoplasia phenotype</span>.
                </p>
              </div>

              {/* Citations */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-[10px] text-primary font-medium">
                  Prescott et al., 2015, Cell
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-[10px] text-primary font-medium">
                  Zhang et al., 2023, Nature
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-[10px] text-primary font-medium">
                  Bi et al., 2024, Dev Cell
                </span>
              </div>

              <div className="flex items-center gap-3 pt-1 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  HIGH confidence
                </span>
                <span>14 datasets</span>
                <span>3 species</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Input bar */}
      <div className="px-5 py-3 border-t border-border bg-muted/20">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-2.5">
          <span className="text-xs text-muted-foreground flex-1">Ask about a variant, gene, or phenotype…</span>
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center">
            <span className="text-primary-foreground text-xs">→</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClinicianChatPreview;
