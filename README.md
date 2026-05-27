# Seq

View the world through one, unified interface.

Seq is a real-time transit visualization and mapping platform that displays vehicle positions, service disruptions, and transit information on an interactive map. Built with Next.js 16, React 19, and MapTiler GL.

## Features

- **Interactive Map**: Real-time vehicle tracking and transit visualization using MapTiler SDK and MapLibre GL
- **Vehicle Tracking**: Display GTFS real-time vehicle positions and transit data
- **Disruptions Panel**: Monitor service alerts and transit disruptions in real-time
- **Layer Controller**: Toggle and manage map layers for different data types
- **Info Panel**: Access detailed information about selected entities
- **Responsive Design**: Works seamlessly on desktop and mobile devices
- **Dark Mode Support**: Theme switching with next-themes

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher (or yarn/pnpm/bun)
- **Git**: For version control

## Installation

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd seq
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables** (if needed):
   Create a `.env.local` file in the root directory and add any required API keys:
   ```
   NEXT_PUBLIC_MAPTILER_API_KEY=your_api_key_here
   ```

## Getting Started

### Development Server

To start the development server with hot-reload:

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

The application will automatically reload as you make changes to the code.

### Building for Production

To create a production build:

```bash
npm run build
```

To start the production server:

```bash
npm start
```

### Linting

To check code quality and style:

```bash
npm run lint
```

## Project Structure

```
src/
├── app/                    # Next.js app directory
│   ├── page.tsx           # Main map interface
│   ├── layout.tsx         # Root layout
│   ├── providers.tsx      # Context providers
│   └── globals.css        # Global styles
├── components/
│   ├── map/               # Map-related components
│   │   ├── MapCanvas.tsx       # Main map canvas
│   │   ├── LayerController.tsx # Layer management
│   │   ├── DisruptionsPanel.tsx# Alerts & disruptions
│   │   └── InfoPanel.tsx       # Entity details
│   └── ui/                # Reusable UI components
├── hooks/                 # Custom React hooks
│   ├── useBubblers.ts     # Waypoint data hook
│   ├── useVehicles.ts     # Vehicle tracking hook
│   ├── useDisruptions.ts  # Disruptions data hook
│   └── use-mobile.ts      # Mobile detection
├── lib/                   # Utility functions
│   ├── geo.ts            # Geospatial utilities
│   ├── overpass.ts       # OpenStreetMap Overpass API
│   ├── seqApi.ts         # Seq API integration
│   └── utils.ts          # General utilities
├── types/                # TypeScript definitions
│   ├── api.ts            # API interfaces
│   └── index.ts          # Type exports
└── public/               # Static assets
    └── maplibre-gl-csp-worker.js # Map worker script
```

## Key Technologies

- **Framework**: [Next.js 16](https://nextjs.org/) - React metaframework with App Router
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) with TailwindCSS v4
- **UI Components**: [shadcn/ui](https://ui.shadcn.com/) & [Radix UI](https://www.radix-ui.com/)
- **Mapping**: [MapTiler SDK](https://docs.maptiler.com/sdk-js/) with MapLibre GL
- **Data Fetching**: [@tanstack/react-query](https://tanstack.com/query/) for server state management
- **Theme**: [next-themes](https://github.com/pacocoursey/next-themes) for dark mode
- **Charts**: [Recharts](https://recharts.org/) for data visualization
- **Icons**: [Lucide React](https://lucide.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)

## Development Workflow

### Adding a New Component

1. Create a new component file in `src/components/`
2. Use TypeScript with proper type definitions
3. Follow the existing code style and conventions
4. Import UI components from `src/components/ui/`

### Adding a New Hook

1. Create a new hook file in `src/hooks/`
2. Use the `use` prefix for the filename and export name
3. Document the hook's purpose and usage

### Fetching Data

Use `@tanstack/react-query` for data fetching:

```typescript
import { useQuery } from '@tanstack/react-query';

const { data, isLoading, error } = useQuery({
  queryKey: ['entities'],
  queryFn: () => fetch('/api/entities').then(r => r.json()),
});
```

## API Integration

The application integrates with:

- **GTFS Real-time API**: For vehicle positions and trip updates
- **OpenStreetMap Overpass API**: For geographic data queries
- **Seq API**: Custom backend for disruptions and local data

## Configuration

Key configuration files:

- `next.config.ts` - Next.js configuration
- `tsconfig.json` - TypeScript configuration
- `tailwind.config.mjs` - Tailwind CSS configuration
- `eslint.config.mjs` - ESLint rules
- `components.json` - shadcn/ui configuration
- `postcss.config.mjs` - PostCSS configuration

## Deployment

### Deploy on Vercel (Recommended)

1. Push your code to a Git repository (GitHub, GitLab, or Bitbucket)
2. Go to [Vercel](https://vercel.com/new) and import your repository
3. Configure environment variables if needed
4. Click "Deploy"

For more details, see [Next.js Deployment Documentation](https://nextjs.org/docs/app/building-your-application/deploying)

### Deploy with Docker

A Dockerfile is included for containerized deployment:

```bash
docker build -t seq .
docker run -p 3000:3000 seq
```

## Environment Variables

Create a `.env.local` file in the root directory:

```env
# Map API Keys
NEXT_PUBLIC_MAPTILER_API_KEY=your_maptiler_key

# API Endpoints
NEXT_PUBLIC_API_URL=https://api.example.com
```

Note: Variables prefixed with `NEXT_PUBLIC_` are exposed to the browser.

## Troubleshooting

### Port 3000 Already in Use

If port 3000 is already in use, specify a different port:

```bash
npm run dev -- -p 3001
```

### Module Not Found Errors

Clear the Next.js cache and reinstall dependencies:

```bash
rm -rf .next node_modules
npm install
npm run dev
```

### Build Errors

Check for TypeScript errors:

```bash
npm run build
```

Run linting to check for code issues:

```bash
npm run lint
```

## Performance Optimization

The application uses several optimization techniques:

- **Dynamic Imports**: Map component uses dynamic import to reduce initial bundle
- **Code Splitting**: Automatic by Next.js with the App Router
- **Image Optimization**: Using Next.js Image component
- **Font Optimization**: Using next/font with Geist

## Contributing

Contributions are welcome! Please follow these steps:

1. Create a new branch for your feature
2. Make your changes and test thoroughly
3. Ensure code passes linting: `npm run lint`
4. Submit a pull request with a clear description

## License

This project is licensed under the Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0). See the LICENSE file for details.

**Author**: linuskang  
**Version**: 0.0.1

## Additional Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [React Documentation](https://react.dev)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Tailwind CSS Docs](https://tailwindcss.com/docs)
- [MapTiler SDK Docs](https://docs.maptiler.com/sdk-js/)
- [shadcn/ui Components](https://ui.shadcn.com/)

## Support

For issues, questions, or suggestions, please open an issue on the repository.
