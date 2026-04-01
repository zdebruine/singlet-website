# Content Guide

## Adding new pages

1. Create a component in `src/pages/YourPage.tsx`
2. Add a route in `src/App.tsx` (or the router config)
3. Add navigation link in `src/components/Navbar.tsx`

## Invest subpages

Invest subpages follow the scrollspy pattern:

1. Create page in `src/pages/invest/YourSection.tsx`
2. Use the scrollspy hook for section tracking
3. Sidebar shows active section on desktop
4. Mobile button reveals table of contents

## Styling conventions

- Use Tailwind CSS utility classes
- shadcn/ui components are in `src/components/ui/`
- Lucide icons: `import { IconName } from "lucide-react"`
- Math rendering: KaTeX with `react-katex`

## Adding components

shadcn/ui components can be added via:

```bash
npx shadcn@latest add component-name
```

## Image assets

Place team photos and other images in `src/assets/`. Reference with standard imports.
