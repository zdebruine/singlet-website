# Deployment

## Development

```bash
# Install dependencies
bun install
# or
npm install

# Start dev server
bun run dev
# or
npm run dev
```

## Production build

```bash
bun run build
# Output in dist/
```

## Deployment targets

### GitHub Pages

The repository includes `.github/workflows/docs.yml` for Sphinx operational documentation.

For the React app itself, add a separate workflow:

```yaml
# .github/workflows/deploy.yml
name: Deploy Website
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run build
      - uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

### Vercel / Netlify

Standard Vite deployment. Framework preset: Vite. Build command: `bun run build`. Output directory: `dist`.

## Environment variables

Configure in `.env` or hosting platform:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## Supabase

The app uses Supabase for authentication and the user dashboard. Configuration is in `src/integrations/supabase/`.
