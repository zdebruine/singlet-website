# Landing page: who arrives, what they need, and in what order

The home page is written for someone who has never heard of singlet.bio. They arrive from a talk, a colleague's
Slack message, a paper's methods section, a search result or an AI assistant's answer. We assume about 15 seconds
in the hero and 15 to 30 more for the rest of the page.

## Who arrives

**1. Wet-lab scientist** (grad student, postdoc, PI; biology or medicine at a university, institute or hospital)
- Knows GEO from submitting their own data. Has downloaded a supplementary matrix and could not open it, or found
  only a processed `.rds` with no explanation of how it was made.
- Asks questions about biology: "is there single-cell data on microglia in aging mice?", "how many human
  kidney donors exist?", "can I check my gene in a public dataset before I spend money on an experiment?".
- Wants: an answer in plain words, sample metadata they recognise (tissue, disease, treatment, donor), a
  sense of whether the data is any good, and a way to hand it to the bioinformatician in their lab or open it
  themselves. Increasingly asks ChatGPT or Claude first.
- Does not want: pipelines, file formats, accounts, fees, a learning curve.

**2. Computational biologist / bioinformatician** (core facility, dry lab, methods developer)
- Already knows CELLxGENE, Single Cell Portal, scBaseCount, the Human Cell Atlas, and how much work it is to
  reprocess GEO. Sceptical by default: "is this one more portal with author-processed matrices?"
- Wants to know, quickly: is it realigned from raw reads, with which reference and pipeline; is QC applied and
  documented; what is in the file (counts, introns, cell calls); can it be loaded as AnnData or
  SingleCellExperiment in one line; is there an API; what is the licence; can it be cited and reproduced.
- Cares about scale (studies, samples, cells, species) only as evidence that the corpus is worth learning.

Both are at public institutions: no budget for a subscription, used to open data, careful about provenance,
and short on time.

## What each second of attention must do

**Hero, about 15 s.** Three answers, in reading order:
1. *What is it?* "AI-ready single-cell data" and a subline that names GEO, raw reads and QC.
2. *Is it big and real?* Live numbers next to the search: studies, samples, cells, species.
3. *Is it easy?* A search box with a real example query, and the 10 s demo: a notebook loads a study, then
   Claude finds and loads one. Free, CC0, no account to download.

**Rest of the page, 15 to 30 s.** Each section is one screen at most, with a title that carries the message on
its own for someone who reads only titles:
1. *Built for how you work*: two short columns, one per audience, each with one link.
2. *Everything about a study, one click away*: a real study (GSE138867) laid out as the site shows it, with
   four plain callouts: metadata, per-sample QC, the counts, provenance. Details stay on the study page.
3. *Rigorous quality control*: the three live QC numbers.
4. *Three ways in*: the browser, Python or R, Claude. One tab open at a time.
5. *Start from a topic*: live tissue and disease hubs for the biologist who does not have a query yet.
6. *Open by default*: CC0 data, MIT code, no account to download, a citation.
7. A last call to action that returns to the search box.

## Rules
- Every number is live from `/api/stats` or `/api/facets`, or is a real record (GSE138867). Nothing is invented.
- Short, factual copy. No "best" or "revolutionary"; the numbers and the demo make the case.
- One search input per page (the hero). The last call to action scrolls back to it.
- Motion is quiet: sections fade in once as they scroll into view; none with `prefers-reduced-motion`.
- Works at phone width with no horizontal scroll.
