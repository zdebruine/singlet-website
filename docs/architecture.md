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
| `/` | Index | Landing page |
| `/browse` | Browse | Ranked study and sample search |
| `/gse/:id` | StudyDetail | Study page: metadata, QC, files, download |
| `/docs` | Docs | Loading, API and data documentation |
| `/docs/mcp` | DocsMcp | MCP server documentation |
| `/quickstart` | Quickstart | Install and first load |
| `/my-data` | ProductHub | Private projects, cohorts and workspaces |
| `/projects/:id` | ProjectDetail | One private project and its files |
| `/p/:projectId/:study` | PrivateStudyDetail | A private study page |
| `/c/:id` | CohortDetail | A saved cohort |
| `/workspaces/:slug` | WorkspaceDetail | Workspace members and shared items |
| `/account` | Account | API keys, usage and preferences |
| `/brand` | Brand | Brand assets |
| `/about` | About | About the data and how to cite |

## Design patterns

### Scrollspy navigation
Used in `/docs`. Desktop sidebar shows active section; mobile button reveals table of contents.

### Interactive visualizations
- Recharts for data viz (pie charts, bar charts)
- Canvas animations (floating cells with connection lines)

### Code blocks
- Copy-to-clipboard functionality
- Python/R language highlighting
