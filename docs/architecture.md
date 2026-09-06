# Architecture

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | React 18 + TypeScript |
| **Build** | Vite |
| **Styling** | Tailwind CSS + shadcn/ui (Radix primitives) |
| **Backend** | Supabase (auth, database) |
| **Charts** | Recharts |
| **Math** | KaTeX |
| **Forms** | React Hook Form + Zod |
| **Data fetching** | TanStack React Query |
| **Routing** | React Router 6 |
| **Icons** | Lucide React |

## Page structure

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | Index | Landing page with floating cells animation |
| `/invest` | Invest | 8-section scrollspy investor pitch |
| `/invest/market` | InvestMarket | TAM & revenue projections |
| `/invest/technology` | InvestTechnology | CPM technical deep-dive |
| `/invest/business` | InvestBusiness | Business model, pricing |
| `/invest/competition` | InvestCompetition | Competitive landscape |
| `/invest/moat` | InvestMoat | Defensibility |
| `/invest/benchmarks` | InvestBenchmarks | Evaluation framework |
| `/invest/need` | InvestNeed | Market problem |
| `/invest/team` | InvestTeam | Founder/advisor info |
| `/docs` | Docs | API documentation with code examples |
| `/gene-programs` | GenePrograms | 10K+ programs dictionary |
| `/target-explorer` | TargetExplorer | Gene expression lookup |
| `/byod` | BYOD | Bring Your Own Data |
| `/intelligence` | Intelligence | Intelligence layers |
| `/singlepress` | SinglePress | Compression format |
| `/enterprise` | Enterprise | Commercial solutions |
| `/dashboard` | Dashboard | Protected user dashboard |

## Design patterns

### Scrollspy navigation
Used in `/invest`, `/docs`, `/gene-programs`. Desktop sidebar shows active section; mobile button reveals table of contents.

### Interactive visualizations
- Recharts for data viz (pie charts, bar charts)
- Canvas animations (floating cells with connection lines)

### Code blocks
- Copy-to-clipboard functionality
- Python/R language highlighting
