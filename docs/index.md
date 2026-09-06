# singletdb

Operational documentation for the [SingletDB](https://singletdb.com) website and dashboard.

## Overview

**singletdb** is a React + TypeScript + Vite web application serving as the primary interface for Singlet Bio. This documentation covers deployment, architecture, and content management.

- **Technology Stack** — React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, Supabase
- **Pages** — Landing, Browse, study pages, Docs, MCP docs, Your data, Brand
- **Design Patterns** — Scrollspy navigation, KaTeX math rendering, canvas animations

```{toctree}
:maxdepth: 2
:caption: Contents

architecture
deployment
content_guide
singlepress
```

## Related Projects

- [singlet](https://singlet-ai.github.io/singlet/) — Python client for data access
- [singlepress](https://singlet-ai.github.io/singlepress/) — Compression format documented on site
- [geo-reprocess](https://singlet-ai.github.io/geo-reprocess/) — Pipeline powering the data
- [singlet-intelligence](https://singlet-ai.github.io/singlet-intelligence/) — ML models featured on site
- [singlet-strategy](https://singlet-ai.github.io/singlet-strategy/) — Strategy informing site content
