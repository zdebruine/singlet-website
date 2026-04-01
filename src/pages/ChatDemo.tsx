import { useState, useRef, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import {
  ArrowUp,
  RotateCcw,
  Dna,
  ChevronDown,
  ChevronRight,
  BookOpen,
  FlaskConical,
  FileText,
  Activity,
  Download,
  ExternalLink,
  Microscope,
  AlertTriangle,
  Lightbulb,
  BarChart3,
} from "lucide-react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pgi-chat`;

const EXAMPLE_QUERIES = [
  "Novel missense in BMPR1B — craniofacial anomalies",
  "PCSK9 inhibitor off-target cell types?",
  "SCN5A loss-of-function — cardiac effects",
  "CFTR dysfunction across airway epithelium",
];

async function streamChat({
  messages,
  onDelta,
  onDone,
  signal,
}: {
  messages: Message[];
  onDelta: (text: string) => void;
  onDone: () => void;
  signal?: AbortSignal;
}) {
  const resp = await fetch(CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!resp.ok || !resp.body) {
    const errText = await resp.text().catch(() => "");
    let errorMsg = "Failed to get response";
    try {
      const parsed = JSON.parse(errText);
      errorMsg = parsed.error || errorMsg;
    } catch { /* ignore */ }
    throw new Error(errorMsg);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;

  while (!done) {
    const { done: readerDone, value } = await reader.read();
    if (readerDone) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.startsWith(":") || line.trim() === "") continue;
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") { done = true; break; }
      try {
        const parsed = JSON.parse(jsonStr);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) onDelta(content);
      } catch {
        buffer = line + "\n" + buffer;
        break;
      }
    }
  }

  if (buffer.trim()) {
    for (let raw of buffer.split("\n")) {
      if (!raw) continue;
      if (raw.endsWith("\r")) raw = raw.slice(0, -1);
      if (!raw.startsWith("data: ")) continue;
      const jsonStr = raw.slice(6).trim();
      if (jsonStr === "[DONE]") continue;
      try {
        const parsed = JSON.parse(jsonStr);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) onDelta(content);
      } catch { /* skip */ }
    }
  }

  onDone();
}

/* ── Collapsible Section ─────────────────────────────────────── */
const CollapsibleSection = ({
  icon: Icon,
  title,
  badge,
  children,
  defaultOpen = false,
}: {
  icon: React.ElementType;
  title: string;
  badge?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden my-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
      >
        <Icon size={16} className="text-primary flex-shrink-0" />
        <span className="text-sm font-semibold text-foreground flex-1">{title}</span>
        {badge && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary">{badge}</span>
        )}
        {open ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
      </button>
      {open && <div className="px-4 pb-4 border-t border-border/50">{children}</div>}
    </div>
  );
};

/* ── Citation Card ────────────────────────────────────────────── */
const CitationCard = ({ index, text }: { index: number; text: string }) => {
  // Try to extract a PMID or DOI
  const pmidMatch = text.match(/PMID[:\s]*(\d+)/i);
  const doiMatch = text.match(/doi[:\s]*(10\.\S+)/i);
  const link = pmidMatch
    ? `https://pubmed.ncbi.nlm.nih.gov/${pmidMatch[1]}/`
    : doiMatch
      ? `https://doi.org/${doiMatch[1]}`
      : null;

  return (
    <div className="flex gap-3 items-start py-2.5 px-3 rounded-lg bg-muted/50 border border-border/50">
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center mt-0.5">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground leading-relaxed">{text}</p>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline mt-1"
          >
            <ExternalLink size={10} /> View source
          </a>
        )}
      </div>
    </div>
  );
};

/* ── Mock chart for cell-type / tissue effect visualizations ── */
const CellTypeChart = ({ data }: { data: { label: string; value: number; color: string }[] }) => {
  const maxVal = Math.max(...data.map((d) => d.value));
  return (
    <div className="space-y-2 py-2">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground w-36 text-right truncate flex-shrink-0">{d.label}</span>
          <div className="flex-1 h-5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${(d.value / maxVal) * 100}%`,
                backgroundColor: d.color,
              }}
            />
          </div>
          <span className="text-xs font-mono text-foreground w-10 text-right">{d.value}%</span>
        </div>
      ))}
    </div>
  );
};

/* ── Parse structured blocks from markdown content ────────────── */
function parseStructuredContent(content: string) {
  // Detect citation blocks: lines starting with [N] or numbered references
  const citationRegex = /^\[(\d+)\]\s*(.+)$/gm;
  const citations: { index: number; text: string }[] = [];
  let match;
  while ((match = citationRegex.exec(content)) !== null) {
    citations.push({ index: parseInt(match[1]), text: match[2] });
  }

  // Detect cell-type effect patterns like "**Cell Type**: value%" or similar
  const cellTypeRegex = /[-•]\s*\*{0,2}([^*:]+)\*{0,2}\s*[:–—]\s*(\d+(?:\.\d+)?)\s*%/g;
  const cellTypeData: { label: string; value: number; color: string }[] = [];
  const tealShades = [
    "hsl(195, 70%, 38%)",
    "hsl(195, 60%, 48%)",
    "hsl(195, 50%, 58%)",
    "hsl(195, 45%, 65%)",
    "hsl(195, 40%, 72%)",
    "hsl(200, 35%, 78%)",
    "hsl(200, 30%, 82%)",
  ];
  let cellMatch;
  while ((cellMatch = cellTypeRegex.exec(content)) !== null) {
    cellTypeData.push({
      label: cellMatch[1].trim(),
      value: parseFloat(cellMatch[2]),
      color: tealShades[cellTypeData.length % tealShades.length],
    });
  }

  // Detect section headers that could be collapsible: ## Mechanism, ## Clinical, etc.
  const sections: { type: string; title: string; startIdx: number; endIdx: number }[] = [];
  const sectionRegex = /^#{2,3}\s+(.+)$/gm;
  const sectionMatches: { title: string; idx: number }[] = [];
  let sMatch;
  while ((sMatch = sectionRegex.exec(content)) !== null) {
    sectionMatches.push({ title: sMatch[1], idx: sMatch.index });
  }

  for (let i = 0; i < sectionMatches.length; i++) {
    const start = sectionMatches[i].idx;
    const end = i + 1 < sectionMatches.length ? sectionMatches[i + 1].idx : content.length;
    const title = sectionMatches[i].title;
    let type = "general";
    const lower = title.toLowerCase();
    if (lower.includes("mechanism") || lower.includes("pathway") || lower.includes("molecular")) type = "mechanism";
    else if (lower.includes("clinical") || lower.includes("summary") || lower.includes("interpretation")) type = "clinical";
    else if (lower.includes("reference") || lower.includes("citation") || lower.includes("literature")) type = "references";
    else if (lower.includes("cell") || lower.includes("tissue") || lower.includes("expression")) type = "celltype";
    else if (lower.includes("recommendation") || lower.includes("action") || lower.includes("next")) type = "action";
    else if (lower.includes("caveat") || lower.includes("limitation") || lower.includes("caution")) type = "caveat";
    sections.push({ type, title, startIdx: start, endIdx: end });
  }

  return { citations, cellTypeData, sections };
}

const sectionIcons: Record<string, React.ElementType> = {
  mechanism: FlaskConical,
  clinical: Activity,
  references: BookOpen,
  celltype: Microscope,
  action: Lightbulb,
  caveat: AlertTriangle,
  general: FileText,
};

const sectionBadges: Record<string, string> = {
  mechanism: "Molecular",
  clinical: "Clinical",
  references: "Literature",
  celltype: "Expression",
  action: "Next Steps",
  caveat: "Caveats",
};

/* ── Rich Response Renderer ───────────────────────────────────── */
const RichResponse = ({ content }: { content: string }) => {
  const { citations, cellTypeData, sections } = useMemo(() => parseStructuredContent(content), [content]);

  const hasSections = sections.length >= 2;
  const hasCellData = cellTypeData.length >= 2;
  const hasCitations = citations.length > 0;

  // If structured content detected, render with collapsible sections
  if (hasSections) {
    // Render content before first section as top-level prose
    const preContent = content.slice(0, sections[0].startIdx).trim();

    return (
      <div className="space-y-1">
        {preContent && (
          <div className="prose prose-sm max-w-none text-foreground prose-headings:font-display prose-headings:text-foreground prose-headings:tracking-tight prose-p:text-muted-foreground prose-p:leading-relaxed prose-strong:text-foreground prose-li:text-muted-foreground prose-a:text-primary">
            <ReactMarkdown>{preContent}</ReactMarkdown>
          </div>
        )}

        {sections.map((sec, i) => {
          const sectionContent = content.slice(
            sec.startIdx + content.slice(sec.startIdx).indexOf("\n") + 1,
            sec.endIdx
          ).trim();
          const Icon = sectionIcons[sec.type] || FileText;

          // References section: render citation cards
          if (sec.type === "references" && hasCitations) {
            return (
              <CollapsibleSection
                key={i}
                icon={Icon}
                title={sec.title}
                badge={`${citations.length} sources`}
                defaultOpen={false}
              >
                <div className="space-y-2 mt-3">
                  {citations.map((c) => (
                    <CitationCard key={c.index} index={c.index} text={c.text} />
                  ))}
                </div>
              </CollapsibleSection>
            );
          }

          // Cell type section: include chart
          if (sec.type === "celltype" && hasCellData) {
            return (
              <CollapsibleSection
                key={i}
                icon={Icon}
                title={sec.title}
                badge={`${cellTypeData.length} cell types`}
                defaultOpen={true}
              >
                <CellTypeChart data={cellTypeData} />
                <div className="prose prose-sm max-w-none mt-3 text-foreground prose-p:text-muted-foreground prose-p:leading-relaxed prose-strong:text-foreground prose-li:text-muted-foreground">
                  <ReactMarkdown>{sectionContent}</ReactMarkdown>
                </div>
              </CollapsibleSection>
            );
          }

          // Clinical summary: always open
          const isFirstClinical = sec.type === "clinical" && i === sections.findIndex((s) => s.type === "clinical");

          return (
            <CollapsibleSection
              key={i}
              icon={Icon}
              title={sec.title}
              badge={sectionBadges[sec.type]}
              defaultOpen={isFirstClinical || i === 0}
            >
              <div className="prose prose-sm max-w-none mt-3 text-foreground prose-headings:font-display prose-headings:text-foreground prose-headings:tracking-tight prose-p:text-muted-foreground prose-p:leading-relaxed prose-strong:text-foreground prose-li:text-muted-foreground prose-a:text-primary prose-code:text-primary prose-code:bg-primary/5 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs">
                <ReactMarkdown>{sectionContent}</ReactMarkdown>
              </div>
            </CollapsibleSection>
          );
        })}

        {/* Report generation button */}
        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/50">
          <button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
            <Download size={13} /> Generate Report
          </button>
          <button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
            <BarChart3 size={13} /> Expand Visualizations
          </button>
        </div>
      </div>
    );
  }

  // Fallback: plain markdown with inline citation highlighting + bottom citation cards
  return (
    <div>
      <div className="prose prose-sm max-w-none text-foreground prose-headings:font-display prose-headings:text-foreground prose-headings:tracking-tight prose-headings:mt-6 prose-headings:mb-3 prose-p:text-muted-foreground prose-p:leading-relaxed prose-strong:text-foreground prose-li:text-muted-foreground prose-a:text-primary prose-code:text-primary prose-code:bg-primary/5 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-normal">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>

      {hasCellData && (
        <CollapsibleSection icon={BarChart3} title="Cell-Type Expression Profile" badge={`${cellTypeData.length} types`} defaultOpen>
          <CellTypeChart data={cellTypeData} />
        </CollapsibleSection>
      )}

      {hasCitations && (
        <CollapsibleSection icon={BookOpen} title="References" badge={`${citations.length} sources`} defaultOpen={false}>
          <div className="space-y-2 mt-3">
            {citations.map((c) => (
              <CitationCard key={c.index} index={c.index} text={c.text} />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {(hasCitations || content.length > 500) && (
        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/50">
          <button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
            <Download size={13} /> Generate Report
          </button>
        </div>
      )}
    </div>
  );
};

/* ── Main Chat Component ──────────────────────────────────────── */
const ChatDemo = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "24px";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 200) + "px";
    }
  }, [input]);

  const send = async (text: string) => {
    if (!text.trim() || isLoading) return;
    const userMsg: Message = { role: "user", content: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let assistantSoFar = "";

    const upsert = (chunk: string) => {
      assistantSoFar += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      await streamChat({
        messages: [...messages, userMsg],
        onDelta: upsert,
        onDone: () => setIsLoading(false),
        signal: controller.signal,
      });
    } catch (e: any) {
      if (e.name !== "AbortError") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `**Error:** ${e.message}` },
        ]);
      }
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 flex-shrink-0 border-b border-border/50">
        <Link to="/" className="font-display font-bold text-base tracking-tightest text-foreground">
          Singlet AI
        </Link>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20">
            <Dna size={14} className="text-primary" />
            <span className="text-xs font-semibold text-primary">PGI Clinical</span>
          </div>
          {hasMessages && (
            <button
              onClick={() => { setMessages([]); abortRef.current?.abort(); setIsLoading(false); }}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="New conversation"
            >
              <RotateCcw size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {!hasMessages ? (
          <div className="h-full flex flex-col items-center justify-center px-6">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-6">
              <Dna size={28} className="text-primary" />
            </div>
            <h1 className="font-display text-2xl md:text-3xl font-bold text-foreground tracking-tightest mb-2 text-center">
              Personal Genomics Intelligence
            </h1>
            <p className="text-sm text-muted-foreground max-w-md text-center mb-10">
              Ask about any variant, gene, or phenotype. Responses include cell-type mechanisms, pathway analysis, and grounded literature citations.
            </p>

            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {EXAMPLE_QUERIES.map((q, i) => (
                <button
                  key={i}
                  onClick={() => send(q)}
                  className="px-4 py-2.5 rounded-xl border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-primary/5 transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-6 py-6 space-y-8">
            {messages.map((msg, i) => (
              <div key={i}>
                {msg.role === "user" ? (
                  <div className="flex justify-end">
                    <div className="max-w-[80%] bg-muted rounded-2xl rounded-br-md px-5 py-3">
                      <p className="text-sm text-foreground">{msg.content}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 mt-1">
                      <Dna size={14} className="text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <RichResponse content={msg.content} />
                    </div>
                  </div>
                )}
              </div>
            ))}

            {isLoading && messages[messages.length - 1]?.role === "user" && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 mt-1">
                  <Dna size={14} className="text-primary" />
                </div>
                <div className="flex items-center gap-1.5 py-3">
                  <span className="w-2 h-2 rounded-full bg-primary/40 animate-pulse" />
                  <span className="w-2 h-2 rounded-full bg-primary/40 animate-pulse [animation-delay:0.2s]" />
                  <span className="w-2 h-2 rounded-full bg-primary/40 animate-pulse [animation-delay:0.4s]" />
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 px-4 pb-4 pt-2">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm focus-within:border-primary/30 focus-within:shadow-md transition-all">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about a variant, gene, or phenotype…"
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none leading-relaxed"
              style={{ minHeight: "24px", maxHeight: "200px" }}
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || isLoading}
              className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:opacity-80 transition-opacity disabled:opacity-20 flex-shrink-0"
            >
              <ArrowUp size={16} />
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-2 text-center">
            Singlet AI PGI · Responses are AI-generated and should be verified by qualified professionals
          </p>
        </div>
      </div>
    </div>
  );
};

export default ChatDemo;
