# Research: Chart Library for the Web Dashboard

## Context

The dashboard needs line charts for time-series sensor data: temperature, humidity, pressure, wind speed, precipitation. Time-range selector (24h / 7 days / 30 days). Real-time updates every 5 minutes via Supabase Realtime WebSocket. Built with Next.js App Router on Vercel.

---

## Part 1 — Rendering Technologies

Before picking a library, the first question is: what rendering technology should be used? There are three main approaches.

### SVG

SVG renders chart elements as DOM nodes — every line, axis tick, and data point is a real HTML element in the page.

**Where SVG wins:**
- CSS styling works natively — you can style any chart element with Tailwind classes or CSS variables
- Accessibility: screen readers can read SVG elements; you can add `aria-label` to individual data points
- Tooltips, hover effects, and click handlers are just DOM events — no special handling needed
- Scales perfectly to any screen size and resolution (vector)
- Works server-side (SSR) — SVG is just markup

**Where SVG struggles:**
- Performance degrades with large datasets. Each data point is a DOM node; at ~5,000+ points, rendering and re-rendering becomes slow
- For high-frequency streaming (updates every 100ms), SVG re-renders are visually janky

**For our use case:** ~288 points max per 24h chart, updates every 5 minutes. SVG is more than fast enough.

---

### Canvas

Canvas renders to a bitmap via the HTML5 `<canvas>` API. The chart is a flat image — no individual DOM nodes per data point.

**Where Canvas wins:**
- Handles massive datasets (100k+ points) without performance degradation — ideal for high-frequency trading charts, scientific data, dense time-series
- High-frequency streaming (multiple updates per second) is smooth because only the changed pixels are redrawn
- Imperative update API: you can push a new point and call `update()` without React re-rendering the whole component

**Where Canvas struggles:**
- No CSS styling — chart appearance is configured via a JavaScript API
- No native accessibility — the canvas is a black box to screen readers
- SSR is broken by default: `canvas` requires a browser environment. In Next.js, you need `next/dynamic({ ssr: false })` or a canvas polyfill
- Custom tooltips and click events require manual coordinate math

**For our use case:** Canvas's main advantages (massive datasets, high-frequency updates) are not needed. 288 data points, 5-minute update interval.

---

### WebGL

WebGL uses the GPU for rendering, via the browser's OpenGL ES API. Libraries like SciChart build their own rendering pipeline on top of WebGL.

**Where WebGL wins:**
- Extreme scale: millions of data points rendered in real time
- Sub-millisecond re-renders even on very large datasets
- Smooth zoom and pan on dense data without any lag

**Where WebGL struggles:**
- Complexity: WebGL APIs are low-level; libraries that abstract them are niche and expensive
- SciChart (the most capable WebGL chart library) requires a paid commercial license for production use — free tier is limited
- Overkill for anything below ~100k points; setup cost is high
- Even less CSS-friendly than Canvas
- SSR not possible

**For our use case:** We are measuring 6 parameters at 5-minute intervals. WebGL is engineering for a problem we don't have.

---

### Technology Comparison Summary

| | SVG | Canvas | WebGL |
|---|---|---|---|
| Max comfortable data points | ~10,000 | ~500,000 | 10M+ |
| Update frequency | Low–medium (5 min is fine) | High (100ms+) | Extreme |
| CSS styling | Native | No | No |
| Accessibility | Yes | No | No |
| SSR (Next.js) | Works | Needs workaround | Not possible |
| Our use case fit | ✅ | Overkill | Overkill |

**Conclusion for our use case: SVG is the right rendering technology.** We have small datasets, infrequent updates, and we want CSS-native styling in a Tailwind project.

---

## Part 2 — Libraries by Type

### SVG — Recharts

React-native SVG chart library. 27k GitHub stars, 53M weekly npm downloads. v3 (2024) added tree-shaking.

**Features:**
- Composable JSX API: `<LineChart>`, `<Line>`, `<XAxis>`, `<YAxis>`, `<Tooltip>`, `<Legend>` — each is a React component
- Updates via React state — `setData([...prev, newPoint])`. No imperative API needed
- `ResponsiveContainer` for adaptive sizing (needs `initialWidth` prop for SSR)
- Time axis: `XAxis type="number" scale="time"` with manual `tickFormatter` — works but requires formatting code
- Tree-shaken bundle for a line chart: ~50 KB gzipped
- TypeScript: first-party types, mature in v3

**Limitations:**
- Time axis is less ergonomic than Chart.js — no built-in date adapter, tick density is manual
- No built-in pan/zoom or brush range selector

---

### SVG — Nivo

D3-backed SVG library with strong design defaults. 14k GitHub stars.

**Features:**
- `@nivo/line` has first-class `xScale={{ type: 'time' }}` with D3 formatting — the best time axis ergonomics of any SVG library
- Beautiful defaults, good animation system
- Modular packages (`@nivo/line` alone is ~80 KB gzipped)
- TypeScript: first-party, thorough

**Limitations:**
- All components wrap `MotionConfigProvider` (React Context) — incompatible with React Server Components. GitHub issue #2626 closed as "not planned"
- Known animation artifacts when data updates while animation is in progress — requires `animate={false}` for live data
- One core maintainer; bus factor risk

---

### Canvas — Chart.js (via react-chartjs-2)

The most widely used JS chart library overall. 67k GitHub stars. Canvas-based.

**Features:**
- Built-in `time` and `timeseries` scale types — the most ergonomic time axis of any option here
- Imperative update API (`chart.update('none')`) — best for high-frequency streaming
- Large ecosystem of plugins (annotations, zoom, etc.)
- Bundle: ~106 KB gzipped (Chart.js + react-chartjs-2 + chartjs-adapter-date-fns)
- TypeScript: first-party in v4+

**Limitations:**
- Canvas — requires `next/dynamic({ ssr: false })` in Next.js
- No CSS styling; no DOM accessibility
- Imperative API breaks React's model — you manage a `ref` to the chart instance

---

### WebGL — SciChart

High-performance WebGL chart library used in trading, medical, and scientific applications.

**Features:**
- Renders millions of data points in real time
- Sub-millisecond redraws
- Full zoom, pan, brush range selection built in
- Very feature-rich: annotations, multiple Y-axes, real-time streaming API

**Limitations:**
- Paid commercial license required for production (community edition is restricted)
- Significant setup complexity
- No SSR
- No CSS styling

---

## Part 3 — Feature Comparison

|                        | Recharts        | Nivo                  | Chart.js             | SciChart     |
| ---------------------- | --------------- | --------------------- | -------------------- | ------------ |
| Rendering              | SVG             | SVG                   | Canvas               | WebGL        |
| Bundle (gzipped)       | ~50 KB          | ~80 KB                | ~106 KB              | Heavy        |
| Time axis              | Manual          | Excellent (D3)        | Excellent (built-in) | Excellent    |
| React API              | JSX composition | JSX composition       | Imperative + ref     | Imperative   |
| SSR / App Router       | Works           | Works (use client)    | Needs ssr:false      | Not possible |
| CSS / Tailwind styling | Native          | Native                | No                   | No           |
| Real-time at 5 min     | Great           | Adequate              | Great (overkill)     | Overkill     |
| Pan / zoom built in    | No              | No                    | Plugin               | Yes          |
| Accessibility          | Yes             | Yes                   | No                   | No           |
| License                | MIT             | MIT                   | MIT                  | Commercial   |
| GitHub stars           | 27k             | 14k                   | 67k                  | —            |
| Maintenance            | Very active     | Active (1 maintainer) | Very active          | Active       |

---

## Part 4 — Summary and Decision

**What we need:** SVG rendering (our dataset is small), React-native state updates (not imperative), works in Next.js App Router without workarounds, fits a Tailwind project, MIT license.

**SciChart** — eliminated. WebGL is engineering for a problem we don't have, and the license is commercial.

**Chart.js** — eliminated for this use case. Its advantages (fast canvas rendering, imperative high-frequency updates, ergonomic time axis) are real but irrelevant at 5-minute update intervals. The downsides (no SSR, no CSS, three packages to set up) add friction with no payoff.

**Nivo** — strong time axis, beautiful defaults, but the animation issues with updating data require `animate={false}`, and it has a single core maintainer. Recharts is a safer long-term bet with a larger community.

**Recharts** — wins. Smallest bundle (~50 KB), React-native API, works in App Router, Tailwind-friendly, very actively maintained community. The time axis requires manual `tickFormatter` code, but for our time-range selector (which filters data in state rather than zooming) this is straightforward. The limitation only matters if we later want a zoomable explorer with dynamic tick density — at which point ApexCharts would become the better choice.

**Decision: Recharts v3.**
