import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Logo } from "@/components/Logo";
import { usePageMeta } from "@/hooks/usePageMeta";

const COLORS = [
  ["Paper", "#F7F9F8"], ["Surface", "#FFFFFF"], ["Ink", "#0F1F1D"], ["Ink 2", "#2B3F3C"], ["Muted", "#5B6B68"], ["Line", "#D8E1DE"], ["Cell", "#BFCFCA"],
  ["Teal 50", "#EAF6F3"], ["Teal 100", "#D2EDE7"], ["Teal 200", "#A9DCD3"], ["Teal 300", "#74C6BA"], ["Teal 400", "#3FAE9F"], ["Teal 500", "#0E8C7E"], ["Teal 600", "#0B7A6E"], ["Teal 700", "#0B6F64"], ["Teal 800", "#0A5A52"], ["Teal 900", "#083F3A"],
  ["AI violet", "#7C5CFF"], ["Caveat amber", "#B45309"], ["Error red", "#B42318"],
];
const ASSETS = [
  ["Mark — light", "/brand/singlet-mark-light.svg"], ["Mark — dark", "/brand/singlet-mark-dark.svg"], ["Wordmark — light", "/brand/singlet-wordmark-light.svg"], ["Wordmark — dark", "/brand/singlet-wordmark-dark.svg"], ["Lockup — light", "/brand/singlet-lockup-light.svg"], ["Lockup — dark", "/brand/singlet-lockup-dark.svg"], ["Stacked — light", "/brand/singlet-stacked-light.svg"], ["Stacked — dark", "/brand/singlet-stacked-dark.svg"], ["Avatar", "/brand/avatar-512.svg"], ["App icon", "/brand/app-icon-dark.svg"],
];

export default function Brand() {
  usePageMeta({ title: "Brand", description: "singlet.bio logo assets, color tokens, typography, and usage rules.", path: "/brand" });
  return <div className="min-h-screen flex flex-col bg-background"><Navbar />
    <main className="container-site flex-1 py-12 md:py-16">
      <header className="max-w-[66ch] mb-12"><p className="type-label text-primary mb-3">Brand system</p><h1 className="type-h1">singlet.bio identity</h1><p className="mt-3 text-muted-foreground">A restrained identity for an open single-cell atlas: one cell is highlighted in a population, with no gradients and no decoration that competes with the data.</p></header>
      <section className="mb-12" aria-labelledby="logos"><h2 id="logos" className="type-h2 mb-4">Logo</h2><div className="grid md:grid-cols-2 gap-3">
        <div className="surface p-8 min-h-48 flex items-center justify-center"><Logo variant="lockup" height={64} link={false} /></div>
        <div className="p-8 min-h-48 flex items-center justify-center bg-[var(--dark-surface)] rounded"><Logo variant="lockup" theme="dark" height={64} link={false} /></div>
        <div className="surface p-8 min-h-64 flex items-center justify-center"><Logo variant="stacked" height={150} link={false} /></div>
        <div className="p-8 min-h-64 flex items-center justify-center bg-[var(--dark-surface)] rounded"><Logo variant="stacked" theme="dark" height={150} link={false} /></div>
      </div></section>
      <section className="mb-12" aria-labelledby="assets"><h2 id="assets" className="type-h2 mb-4">Download assets</h2><div className="surface overflow-hidden"><ul className="divide-y divide-border">{ASSETS.map(([label, href]) => <li key={href} className="flex items-center justify-between gap-4 px-4 py-3"><span>{label}</span><a className="btn-secondary btn-sm" href={href} download>Download SVG</a></li>)}</ul></div></section>
      <section className="mb-12" aria-labelledby="colors"><h2 id="colors" className="type-h2 mb-4">Color tokens</h2><div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">{COLORS.map(([name, hex]) => <div className="surface overflow-hidden" key={name}><div className="h-20 border-b border-border" style={{backgroundColor:hex}} /><div className="p-3"><p className="type-small font-medium">{name}</p><p className="type-mono text-muted-foreground">{hex}</p></div></div>)}</div></section>
      <section className="mb-12" aria-labelledby="type"><h2 id="type" className="type-h2 mb-4">Typography</h2><div className="surface p-6 space-y-6"><div><span className="type-label text-muted-foreground">Display · IBM Plex Sans 600</span><p className="type-display mt-2">Find single-cell data.</p></div><div><span className="type-label text-muted-foreground">Body · IBM Plex Sans 400</span><p className="mt-2">Every public scRNA-seq study on GEO, reprocessed the same way.</p></div><div><span className="type-label text-muted-foreground">Mono · IBM Plex Mono 500</span><p className="type-mono mt-2">GSE296768 · 12,480 cells · exon_counts.1pz</p></div></div></section>
      <section className="grid md:grid-cols-2 gap-8 mb-12"><div><h2 className="type-h2 mb-3">Usage rules</h2><ul className="space-y-2 text-muted-foreground"><li>Clear space: at least one cell width on every side.</li><li>Minimum size: 16px for the mark; 20px for the wordmark.</li><li>Keep exactly one lit cell.</li><li>Never recolor the lit cell, add gradients, or rotate the mark.</li></ul></div><div><h2 className="type-h2 mb-3">Licensing</h2><p className="text-muted-foreground">Atlas data is dedicated to the public domain under CC0. The singlet software is released under the MIT License.</p></div></section>
    </main><Footer /></div>;
}
