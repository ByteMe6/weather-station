# Web UI Plan 2 — History, Export, Sharing, Settings, Alerts, Compliance (MRP-33, 34, 35, 37, 38, 40, 41, 42)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining web tickets on top of Plan 1's foundation: 7 d / 30 d bucketed charts, wind & rain surfacing, chunked CSV export, device sharing with roles, Telegram linking, web alert management, account deletion, and the privacy policy.

**Architecture:** Same as Plan 1 — client path (Clerk JWT + RLS) for every read and for `schedules` writes; server actions for export, sharing, Telegram link/unlink, and account deletion; three new migrations (bucketed RPC, sharing policies, link codes) each with pgTAP. One cross-cutting bot handler (`/start link_<code>`) closes the Telegram-link loop.

**Tech Stack:** as Plan 1, plus `qrcode` (link QR), `@clerk/nextjs/webhooks` (`verifyWebhook`), Recharts `ComposedChart`/`Area`/`Bar`.

**Spec:** `docs/superpowers/specs/2026-08-15-web-dashboard-ui-design.md` (§3.4–§3.5, §4.2 range selector, §4.4–§4.9). Depends on Plan 1 (`docs/superpowers/plans/2026-08-15-web-plan-1-foundation-mvp.md`) being merged.

## Global Constraints

Identical to Plan 1's Global Constraints (no `any`, no `eslint-disable`, arrow functions, `testId` on every component, client-first data paths, `ServiceError`, aliased selects, skeletons on every data page, `motion/react` only in client files, springs `bounce: 0`, tests under `tests/`, `yarn regenerate:types` after every migration, pgTAP for every RLS/function change, `yarn lint && yarn check-types && yarn test:unit` before each commit).

Cross-cutting ACs that depend on non-web tickets are marked **[verify when X lands]** — implement the web side fully, write the contract, and record the pending verification in the final task's doc rather than skipping the work.

## Branch & commit policy

- Branch from `dev` after Plan 1's PR merges: `git checkout -b feature/web-history-sharing-settings dev`.
- One commit per task. Push only after the final gate.

## File Structure

```
apps/web/src/
  components/ui/{Select,SegmentedControl,Switch}.tsx            (Task 1)
  components/charts/{RangeSelector.tsx,useRangeParam.ts}         (Task 1)
  components/charts/ParameterChart.tsx (band + bars)              (Task 2, 3)
  lib/chart.ts (bucketed → HistoryPoint, band fields)             (Task 2)
  services/readings/readings.service.ts (+fetchReadingsBucketed)  (Task 2)
  lib/csv.ts, actions/readings.action.ts, components/export/{ExportDialog,useCsvExport}.tsx (Task 4)
  services/devices/devices.service.ts (+fetchDeviceMembers), actions/devices.action.ts (+share/role/remove) (Task 5)
  components/devices/{DeviceHeader,MembersList,ShareDialog}.tsx, app/(app)/devices/[deviceId]/page.tsx, app/(app)/devices/page.tsx (Task 5)
  components/dashboard/DeviceSelect.tsx, useDashboardData.ts (?device=)  (Task 5)
  actions/telegram.action.ts, components/settings/TelegramCard.tsx (Task 6)
  services/schedules/{schedules.service,schedules.queries}.ts, components/alerts/*, app/(app)/alerts/page.tsx (Task 7)
  actions/account.action.ts, app/api/webhooks/clerk/route.ts, components/settings/DeleteAccountCard.tsx (Task 8)
  app/privacy/page.tsx, components/legal/PrivacyPolicy.tsx (Task 9)
  components/shell/nav-items.ts (Alerts, Devices)                 (Tasks 5, 7)
infra/supabase-db/supabase/
  migrations/<ts>_readings_bucketed_fn.sql + tests/readings_bucketed.sql        (Task 2)
  migrations/<ts>_device_sharing_policies.sql + tests/device_sharing.sql        (Task 5)
  migrations/<ts>_telegram_link_codes.sql + tests/telegram_link_codes.sql       (Task 6)
  functions/telegram-bot/{index.ts,link.ts}                                     (Task 6)
docs/{privacy-data-minimisation.md, superpowers/verification/…-plan-2.md}       (Tasks 9, 10)
```

---

### Task 1: Select, SegmentedControl, Switch primitives; RangeSelector with `?range=` (MRP-34 UI)

**Files:**
- Create: `apps/web/src/components/ui/{Select,SegmentedControl,Switch}.tsx`; modify `ui/index.ts`
- Create: `apps/web/src/components/charts/RangeSelector.tsx`, `apps/web/src/components/charts/useRangeParam.ts`
- Modify: `apps/web/src/components/charts/ChartSection.tsx` (accept `range` + `onRangeChange`, render `RangeSelector` once above the panels)
- Modify: `apps/web/src/components/dashboard/DashboardView.tsx`, `useDashboardData.ts` (range from URL)
- Test: `apps/web/tests/unit/components/ui/controls.test.tsx`, `apps/web/tests/unit/components/charts/useRangeParam.test.tsx`

**Interfaces (Produces):**
```ts
export const Select = <T extends string>({ testId, value, onValueChange, options: { value: T; label: string }[], ariaLabel, placeholder? }): ReactElement
export const SegmentedControl = <T extends string>({ testId, value, onValueChange, options: { value: T; label: string }[], ariaLabel, layoutId }): ReactElement
export const Switch = ({ testId, checked, onCheckedChange, ariaLabel }): ReactElement
export const useRangeParam = (): [HistoryRange, (r: HistoryRange) => void]     // reads/writes ?range=, default '24h'
export const RangeSelector = ({ testId, value, onChange }): ReactElement
// useDashboardData now returns { …, range: HistoryRange, setRange }
```

- [ ] **Step 1: Failing tests**

`apps/web/tests/unit/components/ui/controls.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SegmentedControl } from '@/components/ui/SegmentedControl'

describe('SegmentedControl', () => {
  it('marks the selected option and calls onValueChange', async () => {
    const onChange = jest.fn()
    const user = userEvent.setup()
    render(<SegmentedControl testId="seg" ariaLabel="Range" layoutId="seg-test" value="24h" onValueChange={onChange} options={[{ value: '24h', label: '24 h' }, { value: '7d', label: '7 d' }]} />)
    expect(screen.getByTestId('seg-24h')).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByTestId('seg-7d'))
    expect(onChange).toHaveBeenCalledWith('7d')
  })
})
```

`apps/web/tests/unit/components/charts/useRangeParam.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'

import { navState, routerState } from '../../../stubs/next-navigation'

import { useRangeParam } from '@/components/charts/useRangeParam'

describe('useRangeParam', () => {
  it('defaults to 24h, reads ?range=, and writes via router.replace', () => {
    navState.pathname = '/dashboard'
    navState.search = new URLSearchParams('')
    const { result } = renderHook(() => useRangeParam())
    expect(result.current[0]).toBe('24h')
    act(() => result.current[1]('7d'))
    expect(routerState.replace).toHaveBeenCalledWith('/dashboard?range=7d', { scroll: false })
    navState.search = new URLSearchParams('range=30d')
    const { result: r2 } = renderHook(() => useRangeParam())
    expect(r2.current[0]).toBe('30d')
    navState.search = new URLSearchParams('range=bogus')
    const { result: r3 } = renderHook(() => useRangeParam())
    expect(r3.current[0]).toBe('24h')
  })
})
```

- [ ] **Step 2: Run to verify failure** — `yarn workspace @ws/web test:unit -t "SegmentedControl|useRangeParam"` → FAIL.

- [ ] **Step 3: Implement**

`apps/web/src/components/ui/SegmentedControl.tsx`:

```tsx
'use client'

import { motion } from 'motion/react'
import type { ReactElement } from 'react'
import { useCallback } from 'react'

import { springs } from '@/components/motion/variants'
import { cn } from '@/lib/utils'

interface Option<T extends string> { value: T; label: string }
interface SegmentedControlProps<T extends string> {
  testId: string
  value: T
  onValueChange: (value: T) => void
  options: Option<T>[]
  ariaLabel: string
  /** Unique per instance so indicators don't fly between controls. */
  layoutId: string
}

export const SegmentedControl = <T extends string>({ testId, value, onValueChange, options, ariaLabel, layoutId }: SegmentedControlProps<T>): ReactElement => {
  const choose = useCallback((v: T) => () => onValueChange(v), [onValueChange])
  return (
    <div data-testid={testId} role="radiogroup" aria-label={ariaLabel} className="inline-flex gap-0.5 rounded-control border border-line bg-paper p-[3px]">
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-testid={`${testId}-${o.value}`}
            onClick={choose(o.value)}
            className={cn('relative rounded-[7px] px-3 py-1.5 text-[13px] font-medium', selected ? 'text-ink' : 'text-slate hover:text-ink')}
          >
            {selected ? <motion.span layoutId={layoutId} className="absolute inset-0 rounded-[7px] bg-card shadow-card" transition={springs.snappy} /> : null}
            <span className="relative">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
```

`apps/web/src/components/ui/Select.tsx` (Radix Select, hand-styled):

```tsx
'use client'

import { Check, ChevronDown } from 'lucide-react'
import { Select as RadixSelect } from 'radix-ui'
import type { ReactElement } from 'react'

interface Option<T extends string> { value: T; label: string }
interface SelectProps<T extends string> { testId: string; value: T | undefined; onValueChange: (v: T) => void; options: Option<T>[]; ariaLabel: string; placeholder?: string; disabled?: boolean }

export const Select = <T extends string>({ testId, value, onValueChange, options, ariaLabel, placeholder, disabled }: SelectProps<T>): ReactElement => (
  <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
    <RadixSelect.Trigger data-testid={testId} aria-label={ariaLabel} className="inline-flex h-9 min-w-32 items-center justify-between gap-2 rounded-control border border-line bg-card px-3 text-sm disabled:opacity-60">
      <RadixSelect.Value placeholder={placeholder} />
      <RadixSelect.Icon><ChevronDown className="size-4 text-slate" aria-hidden /></RadixSelect.Icon>
    </RadixSelect.Trigger>
    <RadixSelect.Portal>
      <RadixSelect.Content position="popper" sideOffset={4} className="z-50 min-w-[var(--radix-select-trigger-width)] rounded-control border border-line bg-card p-1 shadow-card">
        <RadixSelect.Viewport>
          {options.map((o) => (
            <RadixSelect.Item key={o.value} value={o.value} data-testid={`${testId}-option-${o.value}`} className="flex cursor-pointer items-center justify-between rounded-[7px] px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-paper">
              <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
              <RadixSelect.ItemIndicator><Check className="size-3.5" aria-hidden /></RadixSelect.ItemIndicator>
            </RadixSelect.Item>
          ))}
        </RadixSelect.Viewport>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  </RadixSelect.Root>
)
```

`apps/web/src/components/ui/Switch.tsx`:

```tsx
'use client'

import { Switch as RadixSwitch } from 'radix-ui'
import type { ReactElement } from 'react'

export const Switch = ({ testId, checked, onCheckedChange, ariaLabel }: { testId: string; checked: boolean; onCheckedChange: (c: boolean) => void; ariaLabel: string }): ReactElement => (
  <RadixSwitch.Root data-testid={testId} checked={checked} onCheckedChange={onCheckedChange} aria-label={ariaLabel} className="relative h-6 w-10 rounded-full bg-line transition-colors data-[state=checked]:bg-sky">
    <RadixSwitch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
  </RadixSwitch.Root>
)
```

`apps/web/src/components/charts/useRangeParam.ts`:

```ts
'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

import type { HistoryRange } from '@/lib/chart'

const RANGES: HistoryRange[] = ['24h', '7d', '30d']
const isRange = (v: string | null): v is HistoryRange => v !== null && (RANGES as string[]).includes(v)

/** Range persists in the URL (?range=) so it survives navigation and refresh (spec §4.2). */
export const useRangeParam = (): [HistoryRange, (r: HistoryRange) => void] => {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const raw = params.get('range')
  const range: HistoryRange = isRange(raw) ? raw : '24h'
  const setRange = useCallback(
    (next: HistoryRange) => {
      const q = new URLSearchParams(params.toString())
      if (next === '24h') q.delete('range')
      else q.set('range', next)
      const qs = q.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [params, pathname, router],
  )
  return [range, setRange]
}
```

`apps/web/src/components/charts/RangeSelector.tsx`:

```tsx
'use client'

import type { ReactElement } from 'react'

import { SegmentedControl } from '@/components/ui/SegmentedControl'
import type { HistoryRange } from '@/lib/chart'

const OPTIONS: { value: HistoryRange; label: string }[] = [
  { value: '24h', label: '24 h' },
  { value: '7d', label: '7 d' },
  { value: '30d', label: '30 d' },
]

export const RangeSelector = ({ testId, value, onChange }: { testId: string; value: HistoryRange; onChange: (r: HistoryRange) => void }): ReactElement => (
  <SegmentedControl testId={testId} ariaLabel="Chart range" layoutId="range-selector" value={value} onValueChange={onChange} options={OPTIONS} />
)
```

`ChartSection` gains `onRangeChange` and renders a header row: `<h2 className="text-[15px] font-semibold">History</h2> <span className="flex-1"/> <RangeSelector testId={`${testId}-range`} value={range} onChange={onRangeChange} />` above the panels. `useDashboardData` reads `const [range, setRange] = useRangeParam()`, passes `range` to `useReadingsHistoryQuery(deviceId, range)`, and returns `{ …, range, setRange }`; `DashboardView` passes both to `ChartSection`. While a new range loads, `ChartSection` shows the chart panels' skeleton (`Skeleton className="h-64"` per fitted parameter) — never a blank chart. Note the strip's "24 h range" and cards' 3 h trends must keep using 24 h data: keep a second `useReadingsHistoryQuery(deviceId, '24h')` for those and use the range query only for the charts.

- [ ] **Step 4: Run tests, lint, types** — `yarn workspace @ws/web test:unit -t "SegmentedControl|useRangeParam|dashboard" && yarn lint && yarn check-types` — PASS (dashboard tests still green; 7d/30d selection shows the panels' skeleton then an error state until Task 2 lands — acceptable mid-plan, never merged alone).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src apps/web/tests
git commit -m "feat(web): Select/SegmentedControl/Switch primitives; chart range selector persisted in ?range= (MRP-34)"
```

---

### Task 2: Bucketed history — `readings_bucketed()` RPC, service, 7 d / 30 d charts with min–max band (MRP-34)

**Files:**
- Create: `infra/supabase-db/supabase/migrations/<ts>_readings_bucketed_fn.sql`, `infra/supabase-db/supabase/tests/readings_bucketed.sql`; regenerate types
- Modify: `apps/web/src/lib/chart.ts` (`BucketedPoint`, `bucketMinutesFor`, `bucketedToPoints`), `apps/web/src/services/readings/readings.service.ts` (`fetchReadingsBucketed`, `fetchReadingsHistory` for 7d/30d), `readings.queries.ts` (history returns `HistoryPoint[]`), `apps/web/src/components/charts/{ParameterChart,ChartPanel,useChartData}.tsx` (band)
- Test: `apps/web/tests/unit/lib/chart.test.ts` (extend), `apps/web/tests/unit/services/readings/readings.service.test.ts` (extend), integration test (extend)

**Interfaces (Produces):**
```ts
// SQL: public.readings_bucketed(p_device_id text, p_from timestamptz, p_to timestamptz, p_bucket_minutes int)
//   returns table (bucket timestamptz, avg_temperature numeric, min_temperature numeric, max_temperature numeric,
//                  avg_humidity numeric, min_humidity numeric, max_humidity numeric, avg_pressure numeric, min_pressure numeric, max_pressure numeric,
//                  avg_wind_speed numeric, max_wind_speed numeric, total_precipitation numeric, sample_count int)
//   security invoker (RLS applies), stable, granted to authenticated
export interface BucketedRow { bucket: string; avgTemperature: number|null; minTemperature: number|null; maxTemperature: number|null; avgHumidity: number|null; minHumidity: number|null; maxHumidity: number|null; avgPressure: number|null; minPressure: number|null; maxPressure: number|null; avgWindSpeed: number|null; maxWindSpeed: number|null; totalPrecipitation: number|null; sampleCount: number }
export const fetchReadingsBucketed = (supabase, { deviceId, from, to, bucketMinutes }): Promise<BucketedRow[]>
export const bucketMinutesFor = (range: HistoryRange): number | null      // 24h → null, 7d → 60, 30d → 360
// HistoryPoint gains optional band fields: temperatureMin/Max, humidityMin/Max, pressureMin/Max, windSpeedMax
export const bucketedToPoints = (rows: BucketedRow[]): HistoryPoint[]
export const fetchReadingsHistory = (supabase, { deviceId, range }): Promise<HistoryPoint[]>   // now returns points for every range
```

- [ ] **Step 1: pgTAP first**

`infra/supabase-db/supabase/tests/readings_bucketed.sql`:

```sql
begin;
select plan(5);

insert into public.users (id, clerk_user_id) values
  ('00000000-0000-0000-0000-00000000000a', 'user_a'),
  ('00000000-0000-0000-0000-00000000000b', 'user_b');
insert into public.devices (device_id, secret, status) values ('WS-B1', 's', 'registered');
insert into public.device_users (device_id, user_id, role) values ('WS-B1', '00000000-0000-0000-0000-00000000000a', 'owner');
insert into public.readings (device_id, timestamp, temperature, humidity, pressure) values
  ('WS-B1', '2026-08-01T00:00:00Z', 10, 50, 1000),
  ('WS-B1', '2026-08-01T00:30:00Z', 12, 52, 1001),
  ('WS-B1', '2026-08-01T01:10:00Z', 20, 40, 1002);

select ok(has_function_privilege('authenticated', 'public.readings_bucketed(text, timestamptz, timestamptz, int)', 'execute'), 'authenticated can execute');
select ok(not has_function_privilege('anon', 'public.readings_bucketed(text, timestamptz, timestamptz, int)', 'execute'), 'anon cannot execute');

-- as user A (member): two hourly buckets, first bucket avg 11 / min 10 / max 12
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"user_a","role":"authenticated"}', true);
select is(
  (select count(*) from public.readings_bucketed('WS-B1', '2026-08-01T00:00:00Z', '2026-08-01T02:00:00Z', 60)),
  2::bigint, 'member gets one row per hourly bucket'
);
select is(
  (select round(avg_temperature, 1) from public.readings_bucketed('WS-B1', '2026-08-01T00:00:00Z', '2026-08-01T02:00:00Z', 60) order by bucket limit 1),
  11.0::numeric, 'first bucket averages 10 and 12'
);

-- as user B (not a member): RLS makes the function see nothing
select set_config('request.jwt.claims', '{"sub":"user_b","role":"authenticated"}', true);
select is(
  (select count(*) from public.readings_bucketed('WS-B1', '2026-08-01T00:00:00Z', '2026-08-01T02:00:00Z', 60)),
  0::bigint, 'non-member gets zero rows (security invoker + RLS)'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify failure** — `cd infra/supabase-db && yarn db-reset:local && yarn test:db` → the new file FAILS.

- [ ] **Step 3: Migration**

`yarn migrate:new readings_bucketed_fn` →

```sql
-- MRP-34: server-side bucketing so 7 d / 30 d charts stay in the hundreds of
-- points (SVG limit, docs/research/03-chart-library.md). SECURITY INVOKER —
-- the readings RLS policy applies inside the function, so a non-member gets
-- zero rows. STABLE: read-only. Uses the (device_id, timestamp DESC) index.
create or replace function public.readings_bucketed(
  p_device_id text,
  p_from timestamptz,
  p_to timestamptz,
  p_bucket_minutes int
)
returns table (
  bucket timestamptz,
  avg_temperature numeric, min_temperature numeric, max_temperature numeric,
  avg_humidity numeric, min_humidity numeric, max_humidity numeric,
  avg_pressure numeric, min_pressure numeric, max_pressure numeric,
  avg_wind_speed numeric, max_wind_speed numeric,
  total_precipitation numeric,
  sample_count int
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    date_bin(make_interval(mins => p_bucket_minutes), r.timestamp, p_from) as bucket,
    avg(r.temperature), min(r.temperature), max(r.temperature),
    avg(r.humidity), min(r.humidity), max(r.humidity),
    avg(r.pressure), min(r.pressure), max(r.pressure),
    avg(r.wind_speed), max(r.wind_speed),
    sum(r.precipitation),
    count(*)::int
  from public.readings r
  where r.device_id = p_device_id
    and r.timestamp >= p_from
    and r.timestamp <= p_to
    and p_bucket_minutes between 1 and 1440
  group by 1
  order by 1;
$$;

revoke execute on function public.readings_bucketed(text, timestamptz, timestamptz, int) from public, anon;
grant execute on function public.readings_bucketed(text, timestamptz, timestamptz, int) to authenticated, service_role;
```

Run: `yarn db-reset:local && yarn regenerate:types && yarn test:db` — PASS. Run the `rls-reviewer` agent.

- [ ] **Step 4: Failing web tests**

Extend `chart.test.ts`:

```ts
import { bucketMinutesFor, bucketedToPoints } from '@/lib/chart'

it('bucketMinutesFor maps ranges', () => {
  expect(bucketMinutesFor('24h')).toBeNull()
  expect(bucketMinutesFor('7d')).toBe(60)
  expect(bucketMinutesFor('30d')).toBe(360)
})
it('bucketedToPoints maps averages and bands', () => {
  const pts = bucketedToPoints([{ bucket: '2026-08-01T00:00:00Z', avgTemperature: 11, minTemperature: 10, maxTemperature: 12, avgHumidity: 51, minHumidity: 50, maxHumidity: 52, avgPressure: 1000.5, minPressure: 1000, maxPressure: 1001, avgWindSpeed: null, maxWindSpeed: null, totalPrecipitation: null, sampleCount: 2 }])
  expect(pts[0]).toMatchObject({ temperature: 11, temperatureMin: 10, temperatureMax: 12, humidity: 51, pressure: 1000.5, windSpeed: null, precipitation: null })
})
```

Extend `readings.service.test.ts`:

```ts
it('fetchReadingsHistory("7d") calls the bucketed RPC with 60-minute buckets', async () => {
  const rpc = jest.fn(async () => ({ data: [], error: null }))
  const client = { rpc } as unknown as SupabaseClient<Database>
  await fetchReadingsHistory(client, { deviceId: 'WS-1', range: '7d' })
  expect(rpc).toHaveBeenCalledWith('readings_bucketed', expect.objectContaining({ p_device_id: 'WS-1', p_bucket_minutes: 60 }))
})
```

- [ ] **Step 5: Implement**

`lib/chart.ts` additions:

```ts
export const bucketMinutesFor = (range: HistoryRange): number | null => (range === '24h' ? null : range === '7d' ? 60 : 360)

export interface HistoryPoint {
  t: number
  temperature: number | null; humidity: number | null; pressure: number | null
  windSpeed: number | null; windDirection: number | null; precipitation: number | null
  temperatureMin?: number | null; temperatureMax?: number | null
  humidityMin?: number | null; humidityMax?: number | null
  pressureMin?: number | null; pressureMax?: number | null
  windSpeedMax?: number | null
}

export interface BucketedRow {
  bucket: string
  avgTemperature: number | null; minTemperature: number | null; maxTemperature: number | null
  avgHumidity: number | null; minHumidity: number | null; maxHumidity: number | null
  avgPressure: number | null; minPressure: number | null; maxPressure: number | null
  avgWindSpeed: number | null; maxWindSpeed: number | null
  totalPrecipitation: number | null
  sampleCount: number
}

export const bucketedToPoints = (rows: BucketedRow[]): HistoryPoint[] =>
  rows.map((r) => ({
    t: new Date(r.bucket).getTime(),
    temperature: r.avgTemperature, temperatureMin: r.minTemperature, temperatureMax: r.maxTemperature,
    humidity: r.avgHumidity, humidityMin: r.minHumidity, humidityMax: r.maxHumidity,
    pressure: r.avgPressure, pressureMin: r.minPressure, pressureMax: r.maxPressure,
    windSpeed: r.avgWindSpeed, windSpeedMax: r.maxWindSpeed, windDirection: null,
    precipitation: r.totalPrecipitation,
  }))
```

`readings.service.ts`:

```ts
import type { BucketedRow, HistoryPoint } from '@/lib/chart'
import { bucketMinutesFor, bucketedToPoints, rangeWindow, toHistoryPoints } from '@/lib/chart'

type BucketedSqlRow = Database['public']['Functions']['readings_bucketed']['Returns'][number]
const toBucketedRow = (r: BucketedSqlRow): BucketedRow => ({
  bucket: r.bucket,
  avgTemperature: r.avg_temperature, minTemperature: r.min_temperature, maxTemperature: r.max_temperature,
  avgHumidity: r.avg_humidity, minHumidity: r.min_humidity, maxHumidity: r.max_humidity,
  avgPressure: r.avg_pressure, minPressure: r.min_pressure, maxPressure: r.max_pressure,
  avgWindSpeed: r.avg_wind_speed, maxWindSpeed: r.max_wind_speed,
  totalPrecipitation: r.total_precipitation, sampleCount: r.sample_count,
})

/** RPC returns snake_case columns (no aliasing on rpc), so this is the one place rows are mapped. */
export const fetchReadingsBucketed = async (
  supabase: SupabaseClient<Database>,
  params: { deviceId: string; from: string; to: string; bucketMinutes: number },
): Promise<BucketedRow[]> => {
  const { data, error } = await supabase.rpc('readings_bucketed', {
    p_device_id: params.deviceId, p_from: params.from, p_to: params.to, p_bucket_minutes: params.bucketMinutes,
  })
  if (error) throw new ServiceError(`Failed to fetch bucketed readings: ${error.message}`, error.code, error.details)
  return (data ?? []).map(toBucketedRow)
}

/** History points for any range: 24h raw rows, 7d/30d bucketed averages with min/max bands. */
export const fetchReadingsHistory = async (
  supabase: SupabaseClient<Database>,
  params: { deviceId: string; range: HistoryRange },
): Promise<HistoryPoint[]> => {
  const window = rangeWindow(params.range)
  const bucketMinutes = bucketMinutesFor(params.range)
  if (bucketMinutes === null) return toHistoryPoints(await fetchReadingsRange(supabase, { deviceId: params.deviceId, ...window }))
  return bucketedToPoints(await fetchReadingsBucketed(supabase, { deviceId: params.deviceId, ...window, bucketMinutes }))
}
```

Update `readings.queries.ts` (`useReadingsHistoryQuery` now yields `HistoryPoint[]`), `readings.realtime.ts` (append to the 24h history as a `HistoryPoint` via `toHistoryPoints([reading])[0]`), and `useDashboardData` (`points = history.data ?? []`, no `toHistoryPoints`). Update Plan 1 tests accordingly (the realtime test's history assertion becomes `toMatchObject({ temperature: 21.4 })`).

`ParameterChart`: switch to `ComposedChart`; when `range !== '24h'` and the meta has band keys, render before the `Line`:

```tsx
<Area type="monotone" dataKey={`${meta.key}Max`} stroke="none" fill={meta.cssVar} fillOpacity={0.12} isAnimationActive={false} connectNulls={false} />
<Area type="monotone" dataKey={`${meta.key}Min`} stroke="none" fill="var(--color-card)" fillOpacity={1} isAnimationActive={false} connectNulls={false} />
```

(the second area masks the lower part so the band reads as min–max) and set the tooltip to show `avg · min–max`. `ChartPanel` header adds "hourly averages" / "6-hour averages" after the unit for bucketed ranges. `useChartData` already picks the bucket gap by range.

- [ ] **Step 6: Run everything**

`yarn workspace @ws/web test:unit && yarn lint && yarn check-types && yarn workspace @ws/web test:integration -t readings` — PASS. Manual: 30 d on a device with 3 days of data renders from the first day; switching ranges shows the skeleton then the band; 30 d loads < 2 s (network tab).

- [ ] **Step 7: Commit**

```bash
git add infra/supabase-db apps/web/src apps/web/tests
git commit -m "feat: readings_bucketed() RPC + 7d/30d bucketed charts with min–max band (MRP-34)"
```

---

### Task 3: Wind & precipitation on the dashboard — bars for rain, wind panel, mixed-fleet checks (MRP-33 web part)

**Files:**
- Modify: `apps/web/src/components/charts/ParameterChart.tsx` (precipitation renders `Bar`), `ChartSection.tsx` (wind panel shows direction ticks), `apps/web/src/components/dashboard/ParameterCard.tsx` (wind card shows gust from `windSpeedMax` when bucketed)
- Test: `apps/web/tests/unit/components/dashboard/dashboard.test.tsx` (extend), `apps/web/tests/unit/components/charts/ParameterChart.test.tsx` (extend)

The ingest schema (`lib/ingest/reading-schema.ts`) already validates `windSpeed ≥ 0`, `windDirection 0–360`, `precipitation ≥ 0` as optional/nullable, and `PARAMETERS`, cards, and `ChartSection` already handle nulls as "not fitted" (Plan 1). What remains on the web is presentation: rain as bars, and the wind panel carrying direction. The bot part of MRP-33 (`/current`, alert text) is out of scope here.

- [ ] **Step 1: Failing tests**

Add to `ParameterChart.test.tsx`:

```tsx
it('renders precipitation as bars', () => {
  const now = Date.now()
  const points = Array.from({ length: 6 }, (_, i) => ({ t: now - (5 - i) * 300_000, temperature: null, humidity: null, pressure: null, windSpeed: null, windDirection: null, precipitation: i % 2 }))
  render(<ParameterChart testId="rain" meta={parameterMeta('precipitation')} points={points} range="24h" width={600} height={200} />)
  expect(screen.getByTestId('rain').querySelectorAll('.recharts-bar-rectangle').length).toBeGreaterThan(0)
})
```

Add to `dashboard.test.tsx`:

```tsx
it('renders wind and rain cards as fitted when the latest reading has values', () => {
  const withWind: Reading = { ...latest, windSpeed: 12, windDirection: 315, precipitation: 0 }
  render(<ParameterCardGrid testId="grid" latest={withWind} points={[]} now={new Date('2026-08-15T12:37:00Z')} />)
  expect(screen.getByTestId('grid-windSpeed')).toHaveAttribute('data-fitted', 'true')
  expect(screen.getByTestId('grid-windDirection')).toHaveTextContent('NW')
  expect(screen.getByTestId('grid-precipitation')).toHaveAttribute('data-fitted', 'true')
})
```

(import `ParameterCardGrid` at the top of the test.)

- [ ] **Step 2: Run to verify failure** — the bar assertion fails (currently a `Line`).

- [ ] **Step 3: Implement**

In `ParameterChart.tsx`, branch on `meta.key === 'precipitation'`:

```tsx
{meta.key === 'precipitation' ? (
  <Bar dataKey="precipitation" fill={meta.cssVar} radius={[2, 2, 0, 0]} isAnimationActive={false} maxBarSize={10} />
) : (
  <Line type="monotone" dataKey={meta.key} stroke={meta.cssVar} strokeWidth={2} dot={renderDot} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls={false} />
)}
```

Import `Bar` from `recharts` (the chart is already a `ComposedChart` from Task 2). Precipitation is an accumulation per interval, so bars are the honest mark; the tooltip label reads "mm in this interval" (24 h) or "mm in this bucket" (7 d / 30 d).

`ChartSection`: keep excluding `windDirection` from its own panel; instead pass `showDirection` to the wind panel — `ChartPanel` for `windSpeed` renders, right of the title, the latest bearing as `CompassGlyph` + compass label (from `latest.windDirection`) so direction is visible with the trace. Add an optional prop `aside?: ReactNode` to `ChartPanel` and render it in the header.

- [ ] **Step 4: Run tests, lint, types**

`yarn workspace @ws/web test:unit && yarn lint && yarn check-types` — PASS. Manual mixed-fleet check: post a BMP280-only payload (no wind/rain keys) → those cards read "Sensor not fitted", no wind/rain chart panels; post a full payload → cards flip to fitted, panels appear (card grid `layout` animates the change).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src apps/web/tests
git commit -m "feat(web): precipitation bars, wind direction beside the wind trace, mixed-fleet cards (MRP-33)"
```

---

### Task 4: CSV export — chunked server action, dialog with progress (MRP-35)

**Files:**
- Create: `apps/web/src/lib/csv.ts`, `apps/web/src/actions/_helpers.ts`, `apps/web/src/actions/readings.action.ts`, `apps/web/src/components/export/{ExportDialog,useCsvExport}.tsx`, `apps/web/src/components/export/download.ts`
- Modify: `apps/web/src/components/dashboard/DashboardView.tsx` (Export button in the strip's top-right)
- Test: `apps/web/tests/unit/lib/csv.test.ts`, `apps/web/tests/unit/actions/readings.action.test.ts`, `apps/web/tests/unit/components/export/useCsvExport.test.tsx`

**Interfaces (Produces):**
```ts
export const CSV_HEADER = 'timestamp_utc,device_id,temperature_c,humidity_pct,pressure_hpa,wind_speed_kmh,wind_direction_deg,precipitation_mm'
export const readingToCsvLine = (r: Reading): string
export const exportFilename = (deviceId: string, from: string, to: string): string   // weather_WS-7F3A_2026-06-01_2026-06-30.csv
export const resolveCurrentUserId = (service, clerkUserId): Promise<string | null>          // actions/_helpers.ts
export const resolveMemberRole = (service, userId, deviceId): Promise<DeviceRole | null>
export interface ExportCursor { timestamp: string; id: number }
export const exportReadingsChunkAction = (input: { deviceId: string; from: string; to: string; cursor: ExportCursor | null }): Promise<ActionResult<{ lines: string[]; nextCursor: ExportCursor | null; includesHeader: boolean }>>
// codes: UNAUTHORIZED | INVALID_INPUT | FORBIDDEN | UNKNOWN ; chunk size 10 000 rows
export const useCsvExport = (): { start: (p: { deviceId: string; from: string; to: string }) => Promise<void>; abort: () => void; progress: { rows: number; done: boolean; error: string | null } }
export const triggerDownload = (filename: string, parts: string[]): void       // Blob + <a download>
export const ExportDialog = ({ testId, deviceId, open, onOpenChange }): ReactElement
```

- [ ] **Step 1: Failing tests**

`apps/web/tests/unit/lib/csv.test.ts`:

```ts
import { CSV_HEADER, exportFilename, readingToCsvLine } from '@/lib/csv'

describe('csv', () => {
  it('serialises a reading with nulls as empty fields', () => {
    expect(readingToCsvLine({ id: 1, deviceId: 'WS-1', timestamp: '2026-08-15T12:35:00.000Z', temperature: 21.4, humidity: null, pressure: 1013.2, windSpeed: 12, windDirection: 315, precipitation: null }))
      .toBe('2026-08-15T12:35:00.000Z,WS-1,21.4,,1013.2,12,315,')
    expect(CSV_HEADER.split(',')).toHaveLength(8)
  })
  it('builds the filename from device and dates', () => {
    expect(exportFilename('WS-7F3A', '2026-06-01T00:00:00.000Z', '2026-06-30T23:59:59.000Z')).toBe('weather_WS-7F3A_2026-06-01_2026-06-30.csv')
  })
})
```

`apps/web/tests/unit/actions/readings.action.test.ts`:

```ts
const auth = jest.fn()
jest.mock('@clerk/nextjs/server', () => ({ auth: () => auth() }))
const helpers = { resolveCurrentUserId: jest.fn(), resolveMemberRole: jest.fn() }
jest.mock('@/actions/_helpers', () => helpers)
const rows = jest.fn()
jest.mock('@ws/supabase-db', () => ({
  createServiceRoleClient: () => {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    Object.assign(chain, { select: self, eq: self, gte: self, lte: self, or: self, order: self, limit: self, then: (res: (v: unknown) => void) => res(rows()) })
    return { from: () => chain }
  },
}))

import { exportReadingsChunkAction } from '@/actions/readings.action'

describe('exportReadingsChunkAction', () => {
  beforeEach(() => { jest.clearAllMocks(); auth.mockResolvedValue({ userId: 'user_1' }); helpers.resolveCurrentUserId.mockResolvedValue('uuid-1') })

  it('rejects non-members', async () => {
    helpers.resolveMemberRole.mockResolvedValue(null)
    await expect(exportReadingsChunkAction({ deviceId: 'WS-1', from: '2026-08-01T00:00:00Z', to: '2026-08-02T00:00:00Z', cursor: null })).resolves.toMatchObject({ ok: false, code: 'FORBIDDEN' })
  })

  it('rejects ranges over 366 days', async () => {
    helpers.resolveMemberRole.mockResolvedValue('viewer')
    await expect(exportReadingsChunkAction({ deviceId: 'WS-1', from: '2024-01-01T00:00:00Z', to: '2026-08-02T00:00:00Z', cursor: null })).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' })
  })

  it('returns header + lines on the first chunk and a cursor when full', async () => {
    helpers.resolveMemberRole.mockResolvedValue('viewer')
    const data = Array.from({ length: 10_000 }, (_, i) => ({ id: i + 1, deviceId: 'WS-1', timestamp: `2026-08-01T00:${String(i % 60).padStart(2, '0')}:00.000Z`, temperature: 20, humidity: null, pressure: 1000, windSpeed: null, windDirection: null, precipitation: null }))
    rows.mockReturnValue({ data, error: null })
    const res = await exportReadingsChunkAction({ deviceId: 'WS-1', from: '2026-08-01T00:00:00Z', to: '2026-08-02T00:00:00Z', cursor: null })
    expect(res.ok && res.data.includesHeader).toBe(true)
    expect(res.ok && res.data.lines).toHaveLength(10_001)
    expect(res.ok && res.data.nextCursor).toEqual({ timestamp: data[9999]!.timestamp, id: 10_000 })
  })
})
```

`apps/web/tests/unit/components/export/useCsvExport.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'

const chunk = jest.fn()
jest.mock('@/actions/readings.action', () => ({ exportReadingsChunkAction: (i: unknown) => chunk(i) }))
const download = jest.fn()
jest.mock('@/components/export/download', () => ({ triggerDownload: (...a: unknown[]) => download(...a) }))

import { useCsvExport } from '@/components/export/useCsvExport'

describe('useCsvExport', () => {
  it('loops chunks until the cursor is null, then downloads', async () => {
    chunk
      .mockResolvedValueOnce({ ok: true, data: { lines: ['h', 'a'], nextCursor: { timestamp: 't', id: 1 }, includesHeader: true } })
      .mockResolvedValueOnce({ ok: true, data: { lines: ['b'], nextCursor: null, includesHeader: false } })
    const { result } = renderHook(() => useCsvExport())
    await act(async () => { await result.current.start({ deviceId: 'WS-1', from: '2026-08-01T00:00:00.000Z', to: '2026-08-02T00:00:00.000Z' }) })
    expect(chunk).toHaveBeenCalledTimes(2)
    expect(download).toHaveBeenCalledWith('weather_WS-1_2026-08-01_2026-08-02.csv', ['h\n', 'a\n', 'b\n'])
    expect(result.current.progress).toEqual({ rows: 2, done: true, error: null })
  })
})
```

- [ ] **Step 2: Run to verify failure** — `yarn workspace @ws/web test:unit -t "csv|exportReadingsChunkAction|useCsvExport"` → FAIL.

- [ ] **Step 3: Implement**

`apps/web/src/lib/csv.ts`:

```ts
import type { Reading } from '@ws/shared'

export const CSV_HEADER = 'timestamp_utc,device_id,temperature_c,humidity_pct,pressure_hpa,wind_speed_kmh,wind_direction_deg,precipitation_mm'

const cell = (v: number | null): string => (v === null ? '' : String(v))

export const readingToCsvLine = (r: Reading): string =>
  [r.timestamp, r.deviceId, cell(r.temperature), cell(r.humidity), cell(r.pressure), cell(r.windSpeed), cell(r.windDirection), cell(r.precipitation)].join(',')

export const exportFilename = (deviceId: string, from: string, to: string): string =>
  `weather_${deviceId}_${from.slice(0, 10)}_${to.slice(0, 10)}.csv`
```

`apps/web/src/actions/_helpers.ts` (shared by export, sharing, Telegram, account actions):

```ts
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DeviceRole } from '@ws/shared'
import type { Database } from '@ws/supabase-db'

/** Internal users.id for a Clerk user, or null if ensureCurrentUserAction never ran. */
export const resolveCurrentUserId = async (service: SupabaseClient<Database>, clerkUserId: string): Promise<string | null> => {
  const { data } = await service.from('users').select('id').eq('clerk_user_id', clerkUserId).maybeSingle()
  return data?.id ?? null
}

/** The caller's role on a device, or null if not a member. Service role bypasses RLS, so this is the explicit check. */
export const resolveMemberRole = async (service: SupabaseClient<Database>, userId: string, deviceId: string): Promise<DeviceRole | null> => {
  const { data } = await service.from('device_users').select('role').eq('device_id', deviceId).eq('user_id', userId).maybeSingle()
  return (data?.role as DeviceRole | undefined) ?? null
}
```

`apps/web/src/actions/readings.action.ts`:

```ts
'use server'

import 'server-only'

import { auth } from '@clerk/nextjs/server'
import type { Reading } from '@ws/shared'
import { createServiceRoleClient } from '@ws/supabase-db'
import { z } from 'zod'

import type { ActionResult } from '@/lib/actions/result'
import { actionError, actionOk } from '@/lib/actions/result'
import { CSV_HEADER, readingToCsvLine } from '@/lib/csv'

import { resolveCurrentUserId, resolveMemberRole } from './_helpers'

export interface ExportCursor { timestamp: string; id: number }
const CHUNK = 10_000
const MAX_DAYS = 366

const inputSchema = z.object({
  deviceId: z.string().min(1),
  from: z.string().datetime(),
  to: z.string().datetime(),
  cursor: z.object({ timestamp: z.string(), id: z.number().int() }).nullable(),
}).refine((v) => new Date(v.to).getTime() > new Date(v.from).getTime(), 'to must be after from')
  .refine((v) => (new Date(v.to).getTime() - new Date(v.from).getTime()) <= MAX_DAYS * 86_400_000, 'range too long')

/**
 * CSV export (PRD W5, MRP-35) — chunked so no single response is large.
 * Keyset pagination on (timestamp, id); the client concatenates chunks.
 * Service role + explicit device_users check (RLS is bypassed here).
 */
export const exportReadingsChunkAction = async (input: {
  deviceId: string; from: string; to: string; cursor: ExportCursor | null
}): Promise<ActionResult<{ lines: string[]; nextCursor: ExportCursor | null; includesHeader: boolean }>> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return actionError('UNAUTHORIZED', 'Sign in to continue')

  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return actionError('INVALID_INPUT', 'Pick a range of at most one year')
  const { deviceId, from, to, cursor } = parsed.data

  const service = createServiceRoleClient()
  const userId = await resolveCurrentUserId(service, clerkUserId)
  const role = userId ? await resolveMemberRole(service, userId, deviceId) : null
  if (!role) return actionError('FORBIDDEN', "You don't have access to this station")

  let query = service
    .from('readings')
    .select('id, deviceId:device_id, timestamp, temperature, humidity, pressure, windSpeed:wind_speed, windDirection:wind_direction, precipitation')
    .eq('device_id', deviceId)
    .gte('timestamp', from)
    .lte('timestamp', to)
    .order('timestamp', { ascending: true })
    .order('id', { ascending: true })
    .limit(CHUNK)
  if (cursor) {
    query = query.or(`timestamp.gt.${cursor.timestamp},and(timestamp.eq.${cursor.timestamp},id.gt.${cursor.id})`)
  }
  const { data, error } = await query
  if (error) {
    console.error('exportReadingsChunkAction failed', error)
    return actionError('UNKNOWN', 'Export failed. Try again.')
  }
  const rows = (data ?? []) as Reading[]
  const lines = rows.map(readingToCsvLine)
  const includesHeader = cursor === null
  if (includesHeader) lines.unshift(CSV_HEADER)
  const last = rows[rows.length - 1]
  const nextCursor = rows.length === CHUNK && last ? { timestamp: last.timestamp, id: last.id } : null
  return actionOk({ lines, nextCursor, includesHeader })
}
```

`apps/web/src/components/export/download.ts`:

```ts
/** Assembles the CSV parts into a Blob and triggers a browser download. */
export const triggerDownload = (filename: string, parts: string[]): void => {
  const blob = new Blob(parts, { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
```

`apps/web/src/components/export/useCsvExport.tsx`:

```tsx
'use client'

import { useCallback, useRef, useState } from 'react'

import type { ExportCursor } from '@/actions/readings.action'
import { exportReadingsChunkAction } from '@/actions/readings.action'
import { exportFilename } from '@/lib/csv'

import { triggerDownload } from './download'

export interface ExportProgress { rows: number; done: boolean; error: string | null }

export const useCsvExport = (): { start: (p: { deviceId: string; from: string; to: string }) => Promise<void>; abort: () => void; progress: ExportProgress } => {
  const [progress, setProgress] = useState<ExportProgress>({ rows: 0, done: false, error: null })
  const aborted = useRef(false)

  const abort = useCallback(() => { aborted.current = true }, [])

  const start = useCallback(async ({ deviceId, from, to }: { deviceId: string; from: string; to: string }) => {
    aborted.current = false
    setProgress({ rows: 0, done: false, error: null })
    const parts: string[] = []
    let cursor: ExportCursor | null = null
    let rows = 0
    do {
      const res = await exportReadingsChunkAction({ deviceId, from, to, cursor })
      if (aborted.current) return
      if (!res.ok) { setProgress({ rows, done: false, error: res.message }); return }
      for (const line of res.data.lines) parts.push(`${line}\n`)
      rows += res.data.lines.length - (res.data.includesHeader ? 1 : 0)
      cursor = res.data.nextCursor
      setProgress({ rows, done: false, error: null })
    } while (cursor)
    triggerDownload(exportFilename(deviceId, from, to), parts)
    setProgress({ rows, done: true, error: null })
  }, [])

  return { start, abort, progress }
}
```

`apps/web/src/components/export/ExportDialog.tsx`:

```tsx
'use client'

import { motion } from 'motion/react'
import type { FormEvent, ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { springs } from '@/components/motion/variants'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { DEFAULT_SEND_INTERVAL_MS } from '@ws/shared'

import { useCsvExport } from './useCsvExport'

const isoDay = (d: Date): string => d.toISOString().slice(0, 10)

export const ExportDialog = ({ testId, deviceId, open, onOpenChange }: { testId: string; deviceId: string; open: boolean; onOpenChange: (o: boolean) => void }): ReactElement => {
  const { toast } = useToast()
  const { start, abort, progress } = useCsvExport()
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 7 * 86_400_000)))
  const [to, setTo] = useState(() => isoDay(new Date()))
  const [running, setRunning] = useState(false)

  const estimate = useMemo(() => {
    const days = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 + 1
    return Math.max(0, Math.round((days * 86_400_000) / DEFAULT_SEND_INTERVAL_MS))
  }, [from, to])

  const onFrom = useCallback((e: FormEvent<HTMLInputElement>) => setFrom(e.currentTarget.value), [])
  const onTo = useCallback((e: FormEvent<HTMLInputElement>) => setTo(e.currentTarget.value), [])

  const onSubmit = useCallback(async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setRunning(true)
    await start({ deviceId, from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` })
    setRunning(false)
  }, [deviceId, from, to, start])

  useEffect(() => {
    if (progress.done) { toast({ title: 'CSV downloaded', description: `${progress.rows.toLocaleString()} readings`, tone: 'success' }); onOpenChange(false) }
  }, [progress.done, progress.rows, toast, onOpenChange])

  const close = useCallback((o: boolean) => { if (!o) abort(); onOpenChange(o) }, [abort, onOpenChange])
  const pct = estimate > 0 ? Math.min(100, Math.round((progress.rows / estimate) * 100)) : 0

  return (
    <Dialog testId={testId} open={open} onOpenChange={close} title="Export CSV" description="All readings in the range, one row per reading, timestamps in UTC.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field testId={`${testId}-from`} label="From" htmlFor="export-from"><Input testId={`${testId}-from-input`} id="export-from" type="date" value={from} max={to} onChange={onFrom} required /></Field>
          <Field testId={`${testId}-to`} label="To" htmlFor="export-to"><Input testId={`${testId}-to-input`} id="export-to" type="date" value={to} min={from} onChange={onTo} required /></Field>
        </div>
        <p className="text-[13px] text-slate">≈ {estimate.toLocaleString()} readings</p>
        {running || progress.rows > 0 ? (
          <div data-testid={`${testId}-progress`} className="h-1.5 w-full overflow-hidden rounded-full bg-line">
            <motion.div className="h-full bg-sky" animate={{ width: `${pct}%` }} transition={springs.default} />
          </div>
        ) : null}
        {progress.error ? <p role="alert" className="text-[13px] text-danger">{progress.error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button testId={`${testId}-cancel`} variant="ghost" onClick={() => close(false)}>Cancel</Button>
          <Button testId={`${testId}-download`} type="submit" loading={running}>{running ? `${progress.rows.toLocaleString()} rows…` : 'Download'}</Button>
        </div>
      </form>
    </Dialog>
  )
}
```

Wire an "Export CSV" ghost button (`Download` icon) into `DashboardView`'s data state, top-right of the strip row, opening `ExportDialog` (state in `DashboardView`).

- [ ] **Step 4: Run tests, lint, types**

`yarn workspace @ws/web test:unit -t "csv|exportReadingsChunkAction|useCsvExport|dashboard" && yarn lint && yarn check-types` — PASS. Manual: export 7 days → file opens in Numbers/Excel with 8 columns; export an empty range → header-only file; a 366-day range on a device with a year of data completes with the progress bar moving (~11 chunks) without any Vercel error.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src apps/web/tests
git commit -m "feat(web): chunked CSV export server action + export dialog with progress (MRP-35)"
```

---

### Task 5: Device sharing with roles — migration, members service, share/role/remove actions, devices pages (MRP-38)

**Files:**
- Create: `infra/supabase-db/supabase/migrations/<ts>_device_sharing_policies.sql`, `infra/supabase-db/supabase/tests/device_sharing.sql`; regenerate types
- Uses: `apps/web/src/actions/_helpers.ts` (`resolveCurrentUserId`, `resolveMemberRole` — created in Task 4)
- Modify: `apps/web/src/services/devices/devices.service.ts` (+`fetchDeviceMembers`), `devices.queries.ts` (+`useDeviceMembersQuery`, key `deviceKeys.members(deviceId)`), `apps/web/src/actions/devices.action.ts` (+`shareDeviceAction`, `updateMemberRoleAction`, `removeMemberAction`)
- Create: `apps/web/src/components/devices/{DeviceHeader,MembersList,ShareDialog,maskIdentifier.ts}.tsx`, `apps/web/src/app/(app)/devices/page.tsx` (list of my devices → links), `apps/web/src/app/(app)/devices/[deviceId]/page.tsx`
- Create: `apps/web/src/components/dashboard/DeviceSelect.tsx`; modify `useDashboardData.ts` (`?device=`), `components/shell/nav-items.ts` (+Devices)
- Test: pgTAP; `apps/web/tests/unit/actions/devices.action.test.ts` (extend), `apps/web/tests/unit/services/devices/devices.service.test.ts` (extend), `apps/web/tests/unit/components/devices/sharing.test.tsx`, integration (extend)

**Interfaces (Produces):**
```ts
// SQL: public.is_device_owner(p_device_id text) returns boolean  — security definer, stable, authenticated
// policy on device_users: "device owners can view all links for their devices"
export interface DeviceMember { deviceId: string; userId: string; role: DeviceRole; addedAt: string; user: { clerkUserId: string | null; telegramId: number | null } | null }
export const fetchDeviceMembers = (supabase, { deviceId }): Promise<DeviceMember[]>
export const useDeviceMembersQuery = (deviceId?: string)
export type ShareIdentifier = { kind: 'clerk'; clerkUserId: string } | { kind: 'telegram'; telegramId: number }
export const parseShareIdentifier = (raw: string): ShareIdentifier | null   // digits → telegram, 'user_…' → clerk
export const shareDeviceAction = ({ deviceId, identifier: string, role: DeviceRole }): Promise<ActionResult<{ userId: string }>>
// codes: UNAUTHORIZED | INVALID_INPUT | FORBIDDEN (not owner) | USER_NOT_FOUND | ALREADY_MEMBER | UNKNOWN
export const updateMemberRoleAction = ({ deviceId, userId, role }): Promise<ActionResult<null>>   // + LAST_OWNER
export const removeMemberAction = ({ deviceId, userId }): Promise<ActionResult<null>>             // + LAST_OWNER
export const maskIdentifier = (m: DeviceMember['user']): string   // "user_…3f2a" | "tg · …4821" | "unknown"
```

- [ ] **Step 1: pgTAP first**

`infra/supabase-db/supabase/tests/device_sharing.sql`:

```sql
begin;
select plan(6);

insert into public.users (id, clerk_user_id) values
  ('00000000-0000-0000-0000-00000000000a', 'user_a'),
  ('00000000-0000-0000-0000-00000000000b', 'user_b'),
  ('00000000-0000-0000-0000-00000000000c', 'user_c');
insert into public.devices (device_id, secret, status) values ('WS-S1', 's', 'registered');
insert into public.device_users (device_id, user_id, role) values
  ('WS-S1', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('WS-S1', '00000000-0000-0000-0000-00000000000b', 'viewer');

set local role authenticated;

-- owner sees every link on the device
select set_config('request.jwt.claims', '{"sub":"user_a","role":"authenticated"}', true);
select is((select count(*) from public.device_users where device_id = 'WS-S1'), 2::bigint, 'owner sees all members');

-- viewer sees only their own link
select set_config('request.jwt.claims', '{"sub":"user_b","role":"authenticated"}', true);
select is((select count(*) from public.device_users where device_id = 'WS-S1'), 1::bigint, 'viewer sees only own link');
select ok((select public.is_device_owner('WS-S1')) = false, 'viewer is not owner');

-- viewer cannot write device_users (no policy → 0 rows affected / permission denied)
select throws_ok(
  $$ insert into public.device_users (device_id, user_id, role) values ('WS-S1', '00000000-0000-0000-0000-00000000000c', 'viewer') $$,
  '42501', null, 'viewer cannot insert device_users'
);
select throws_ok(
  $$ delete from public.device_users where device_id = 'WS-S1' and user_id = '00000000-0000-0000-0000-00000000000a' $$,
  '42501', null, 'viewer cannot delete device_users'
);

-- outsider sees nothing
select set_config('request.jwt.claims', '{"sub":"user_c","role":"authenticated"}', true);
select is((select count(*) from public.device_users where device_id = 'WS-S1'), 0::bigint, 'non-member sees nothing');

select * from finish();
rollback;
```

If the delete/insert do not raise (RLS with no policy silently affects 0 rows on DELETE), replace those two `throws_ok` with `is((select count(*) …), 2)` after the statements to prove nothing changed — pick whichever the local run shows and keep the assertion meaningful.

- [ ] **Step 2: Migration**

`yarn migrate:new device_sharing_policies` →

```sql
-- MRP-38: owners need to see every member of their device to manage sharing.
-- A policy on device_users that queries device_users would recurse, so the
-- owner check lives in a SECURITY DEFINER helper. STABLE and wrapped as
-- (select …) in the policy so it runs once per statement (InitPlan).
create or replace function public.is_device_owner(p_device_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.device_users du
    where du.device_id = p_device_id
      and du.user_id = (select public.current_app_user_id())
      and du.role = 'owner'
  );
$$;

revoke execute on function public.is_device_owner(text) from public, anon;
grant execute on function public.is_device_owner(text) to authenticated, service_role;

create policy "device owners can view all links for their devices"
  on public.device_users
  for select
  to authenticated
  using ((select public.is_device_owner(device_id)));

-- Owners also need the members' identifiers (masked in the UI). users has
-- "view own profile" only; extend to rows sharing a device the caller owns.
create policy "device owners can view members of their devices"
  on public.users
  for select
  to authenticated
  using (
    exists (
      select 1 from public.device_users du
      where du.user_id = users.id
        and (select public.is_device_owner(du.device_id))
    )
  );
```

Run: `yarn db-reset:local && yarn regenerate:types && yarn test:db` — PASS; run `rls-reviewer`.

- [ ] **Step 3: Failing web tests**

Extend `devices.service.test.ts`:

```ts
it('fetchDeviceMembers selects members with nested user identifiers', async () => {
  const chain = { select: jest.fn(() => chain), eq: jest.fn(() => chain), order: jest.fn(async () => ({ data: [], error: null })) }
  const client = { from: jest.fn(() => chain) } as unknown as SupabaseClient<Database>
  await fetchDeviceMembers(client, { deviceId: 'WS-1' })
  expect(chain.select).toHaveBeenCalledWith('deviceId:device_id, userId:user_id, role, addedAt:added_at, user:users ( clerkUserId:clerk_user_id, telegramId:telegram_id )')
  expect(chain.eq).toHaveBeenCalledWith('device_id', 'WS-1')
})
```

Extend `devices.action.test.ts` (mock `@/actions/_helpers`):

```ts
const helpers = { resolveCurrentUserId: jest.fn(), resolveMemberRole: jest.fn() }
jest.mock('@/actions/_helpers', () => helpers)
import { parseShareIdentifier, shareDeviceAction } from '@/actions/devices.action'

describe('shareDeviceAction', () => {
  it('parses identifiers', () => {
    expect(parseShareIdentifier('123456')).toEqual({ kind: 'telegram', telegramId: 123456 })
    expect(parseShareIdentifier('user_2abc')).toEqual({ kind: 'clerk', clerkUserId: 'user_2abc' })
    expect(parseShareIdentifier('nope')).toBeNull()
  })
  it('rejects non-owners with FORBIDDEN', async () => {
    helpers.resolveCurrentUserId.mockResolvedValue('uuid-1')
    helpers.resolveMemberRole.mockResolvedValue('viewer')
    await expect(shareDeviceAction({ deviceId: 'WS-1', identifier: 'user_2abc', role: 'viewer' })).resolves.toMatchObject({ ok: false, code: 'FORBIDDEN' })
  })
})
```

`apps/web/tests/unit/components/devices/sharing.test.tsx`: render `MembersList` with two members (owner + viewer) as owner → role selects and remove buttons present; as viewer → read-only text; `maskIdentifier` unit cases.

- [ ] **Step 4: Implement**

`devices.service.ts` addition:

```ts
export interface DeviceMember {
  deviceId: string
  userId: string
  role: DeviceRole
  addedAt: string
  user: { clerkUserId: string | null; telegramId: number | null } | null
}

/** Members of a device — owners see all rows (owner policy), viewers see only themselves. */
export const fetchDeviceMembers = async (supabase: SupabaseClient<Database>, params: { deviceId: string }): Promise<DeviceMember[]> => {
  const { data, error } = await supabase
    .from('device_users')
    .select('deviceId:device_id, userId:user_id, role, addedAt:added_at, user:users ( clerkUserId:clerk_user_id, telegramId:telegram_id )')
    .eq('device_id', params.deviceId)
    .order('added_at', { ascending: true })
  if (error) throw new ServiceError(`Failed to fetch device members: ${error.message}`, error.code, error.details)
  return (data ?? []) as DeviceMember[]
}
```

`devices.queries.ts`: `deviceKeys.members = (deviceId: string) => ['devices', 'members', deviceId] as const`; `useDeviceMembersQuery(deviceId)` with `enabled: !!deviceId`.

`devices.action.ts` additions:

```ts
import type { DeviceRole } from '@ws/shared'

import { resolveCurrentUserId, resolveMemberRole } from './_helpers'

export type ShareIdentifier = { kind: 'clerk'; clerkUserId: string } | { kind: 'telegram'; telegramId: number }

export const parseShareIdentifier = (raw: string): ShareIdentifier | null => {
  const v = raw.trim()
  if (/^\d{5,20}$/.test(v)) return { kind: 'telegram', telegramId: Number(v) }
  if (/^user_[A-Za-z0-9]{10,}$/.test(v)) return { kind: 'clerk', clerkUserId: v }
  return null
}

const ROLES: DeviceRole[] = ['owner', 'editor', 'viewer']

const requireOwner = async (deviceId: string): Promise<{ ok: true; service: ReturnType<typeof createServiceRoleClient>; userId: string } | { ok: false; result: ActionResult<never> }> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return { ok: false, result: actionError('UNAUTHORIZED', 'Sign in to continue') }
  const service = createServiceRoleClient()
  const userId = await resolveCurrentUserId(service, clerkUserId)
  if (!userId) return { ok: false, result: actionError('UNAUTHORIZED', 'Sign in to continue') }
  const role = await resolveMemberRole(service, userId, deviceId)
  if (role !== 'owner') return { ok: false, result: actionError('FORBIDDEN', 'Only owners can manage sharing') }
  return { ok: true, service, userId }
}

/** MRP-38: owner grants access by Clerk user ID or Telegram ID. */
export const shareDeviceAction = async (input: { deviceId: string; identifier: string; role: DeviceRole }): Promise<ActionResult<{ userId: string }>> => {
  if (!ROLES.includes(input.role)) return actionError('INVALID_INPUT', 'Choose a role')
  const ident = parseShareIdentifier(input.identifier)
  if (!ident) return actionError('INVALID_INPUT', 'Enter a Clerk user ID (user_…) or a Telegram ID (digits)', { identifier: 'Enter a Clerk user ID (user_…) or a Telegram ID (digits)' })
  const gate = await requireOwner(input.deviceId)
  if (!gate.ok) return gate.result
  const { service } = gate

  const lookup = ident.kind === 'clerk'
    ? service.from('users').select('id').eq('clerk_user_id', ident.clerkUserId).maybeSingle()
    : service.from('users').select('id').eq('telegram_id', ident.telegramId).maybeSingle()
  const { data: target } = await lookup
  if (!target) return actionError('USER_NOT_FOUND', 'No account with that ID has signed in yet', { identifier: 'No account with that ID has signed in yet' })

  const { error } = await service.from('device_users').insert({ device_id: input.deviceId, user_id: target.id, role: input.role })
  if (error?.code === '23505') return actionError('ALREADY_MEMBER', 'That person already has access', { identifier: 'That person already has access' })
  if (error) { console.error('shareDeviceAction failed', error); return actionError('UNKNOWN', 'Could not share the station. Try again.') }
  return actionOk({ userId: target.id })
}

const ownerCount = async (service: ReturnType<typeof createServiceRoleClient>, deviceId: string): Promise<number> => {
  const { count } = await service.from('device_users').select('user_id', { count: 'exact', head: true }).eq('device_id', deviceId).eq('role', 'owner')
  return count ?? 0
}

export const updateMemberRoleAction = async (input: { deviceId: string; userId: string; role: DeviceRole }): Promise<ActionResult<null>> => {
  if (!ROLES.includes(input.role)) return actionError('INVALID_INPUT', 'Choose a role')
  const gate = await requireOwner(input.deviceId)
  if (!gate.ok) return gate.result
  const current = await resolveMemberRole(gate.service, input.userId, input.deviceId)
  if (current === 'owner' && input.role !== 'owner' && (await ownerCount(gate.service, input.deviceId)) <= 1) {
    return actionError('LAST_OWNER', 'A station needs at least one owner')
  }
  const { error } = await gate.service.from('device_users').update({ role: input.role }).eq('device_id', input.deviceId).eq('user_id', input.userId)
  if (error) { console.error('updateMemberRoleAction failed', error); return actionError('UNKNOWN', 'Could not change the role. Try again.') }
  return actionOk(null)
}

export const removeMemberAction = async (input: { deviceId: string; userId: string }): Promise<ActionResult<null>> => {
  const gate = await requireOwner(input.deviceId)
  if (!gate.ok) return gate.result
  const current = await resolveMemberRole(gate.service, input.userId, input.deviceId)
  if (current === 'owner' && (await ownerCount(gate.service, input.deviceId)) <= 1) {
    return actionError('LAST_OWNER', 'A station needs at least one owner')
  }
  const { error } = await gate.service.from('device_users').delete().eq('device_id', input.deviceId).eq('user_id', input.userId)
  if (error) { console.error('removeMemberAction failed', error); return actionError('UNKNOWN', 'Could not remove access. Try again.') }
  return actionOk(null)
}
```

Removing the last member flips `devices.status` back to `unregistered` via the existing trigger — the LAST_OWNER guard prevents that from the sharing UI; a deliberate "unregister station" is out of scope.

`apps/web/src/components/devices/maskIdentifier.ts`:

```ts
import type { DeviceMember } from '@/services/devices/devices.service'

export const maskIdentifier = (user: DeviceMember['user']): string => {
  if (user?.clerkUserId) return `user_…${user.clerkUserId.slice(-4)}`
  if (user?.telegramId) return `tg · …${String(user.telegramId).slice(-4)}`
  return 'unknown'
}
```

`MembersList` (client): rows with `maskIdentifier`, `Badge` for role, `Select<DeviceRole>` (owners only, disabled on self when last owner) wired to `updateMemberRoleAction`, remove button (owner only, `Dialog` confirm) → `removeMemberAction`; on success `invalidateQueries(deviceKeys.members(deviceId))` and `deviceKeys.mine`; rows use `AnimatePresence` for add/remove. `ShareDialog`: identifier `Input` (mono), role `Select` (default `viewer`), submit → `shareDeviceAction`; field errors inline; success toast "Access granted". `DeviceHeader`: id + status `Badge` + role badge for the viewer.

`app/(app)/devices/page.tsx`: list from `useMyDevicesQuery` (`Card` per device → link to `/devices/[deviceId]`), empty → `NoDeviceState`, plus a "Register another station" ghost link. `app/(app)/devices/[deviceId]/page.tsx`: `DeviceHeader` + "People with access" section (`MembersList`, `ShareDialog` trigger for owners; viewers see "Only owners can share this station."). Skeleton while loading; 404-style `EmptyState` if the device is not in `useMyDevicesQuery`.

Dashboard multi-device: `DeviceSelect` (`Select` of `useMyDevicesQuery` ids) rendered in place of the plain `DeviceChip` text when > 1 device; selection in `?device=` via a `useDeviceParam()` hook shaped like `useRangeParam` (default first device); `useDashboardData` uses it. Add `{ key: 'devices', href: '/devices', label: 'Devices' }` to `NAV_ITEMS`.

- [ ] **Step 5: Run everything**

`yarn workspace @ws/web test:unit && yarn lint && yarn check-types && yarn workspace @ws/web test:integration -t devices` — PASS (integration adds: owner lists both members; viewer lists only self; `shareDeviceAction`-style insert as viewer via the authenticated client is denied). Manual: share by Telegram ID of a bot-registered user **[verify when MRP-21 lands]**; share by Clerk ID of a second test account → it appears on their dashboard; remove → their dashboard shows "No station yet" on next load.

- [ ] **Step 6: Commit**

```bash
git add infra/supabase-db apps/web/src apps/web/tests
git commit -m "feat: device sharing — owner policies, members service, share/role/remove actions, devices pages (MRP-38)"
```

---

### Task 6: Telegram account linking — link codes migration, actions, settings card, bot handler (MRP-37)

**Files:**
- Create: `infra/supabase-db/supabase/migrations/<ts>_telegram_link_codes.sql`, `infra/supabase-db/supabase/tests/telegram_link_codes.sql`; regenerate types
- Create: `apps/web/src/actions/telegram.action.ts`, `apps/web/src/components/settings/TelegramCard.tsx`, `apps/web/src/lib/telegram.ts`
- Modify: `apps/web/src/app/(app)/settings/page.tsx`, `apps/web/.env.example` (+`NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`), `packages/shared/src/constants/index.ts` (+`TELEGRAM_LINK_PREFIX`, `TELEGRAM_LINK_TTL_MS`)
- Create: `infra/supabase-db/supabase/functions/telegram-bot/link.ts`; modify `index.ts` (`/start link_<code>`)
- Test: pgTAP; `apps/web/tests/unit/actions/telegram.action.test.ts`, `apps/web/tests/unit/components/settings/TelegramCard.test.tsx`, `apps/web/tests/unit/lib/telegram.test.ts`

**Interfaces (Produces):**
```ts
// shared
export const TELEGRAM_LINK_PREFIX = 'link_'
export const TELEGRAM_LINK_TTL_MS = 10 * 60_000
// SQL: public.telegram_link_codes (code text pk, user_id uuid fk users on delete cascade, expires_at timestamptz, consumed_at timestamptz null, failed_reason text null, created_at) — RLS on, no client policies, index (user_id)
export const telegramDeepLink = (botUsername: string, code: string): string   // https://t.me/<bot>?start=link_<code>
export const generateLinkCode = (): string                                   // 20 chars, base32 crockford from crypto.getRandomValues
export const startTelegramLinkAction = (): Promise<ActionResult<{ code: string; deepLink: string; expiresAt: string }>>
export const getTelegramLinkStatusAction = ({ code }): Promise<ActionResult<{ state: 'pending' | 'linked' | 'expired' | 'failed'; reason?: string }>>
export const unlinkTelegramAction = (): Promise<ActionResult<null>>
// bot: handleLinkStart(ctx, code) → sets users.telegram_id, marks consumed / failed_reason
```

- [ ] **Step 1: pgTAP**

`infra/supabase-db/supabase/tests/telegram_link_codes.sql`:

```sql
begin;
select plan(4);
insert into public.users (id, clerk_user_id) values ('00000000-0000-0000-0000-00000000000a', 'user_a');
insert into public.telegram_link_codes (code, user_id, expires_at) values ('ABCDEFGHJKMNPQRSTVWX', '00000000-0000-0000-0000-00000000000a', now() + interval '10 minutes');

select ok((select relrowsecurity from pg_class where oid = 'public.telegram_link_codes'::regclass), 'RLS enabled');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"user_a","role":"authenticated"}', true);
select is((select count(*) from public.telegram_link_codes), 0::bigint, 'owner cannot read own link codes from the client');
select throws_ok($$ insert into public.telegram_link_codes (code, user_id, expires_at) values ('X', '00000000-0000-0000-0000-00000000000a', now()) $$, '42501', null, 'client cannot insert link codes');
reset role;
select ok(has_table_privilege('service_role', 'public.telegram_link_codes', 'select, insert, update, delete'), 'service_role has full access');
select * from finish();
rollback;
```

- [ ] **Step 2: Migration**

`yarn migrate:new telegram_link_codes` →

```sql
-- MRP-37: one-time codes proving Telegram account ownership. Created by the
-- web (server action), consumed by the bot (/start link_<code>). Server-side
-- only: no client policies, no grants to anon/authenticated.
create table public.telegram_link_codes (
  code text primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  failed_reason text,
  created_at timestamptz not null default now()
);
create index telegram_link_codes_user_id_idx on public.telegram_link_codes (user_id);
alter table public.telegram_link_codes enable row level security;
revoke all on public.telegram_link_codes from anon, authenticated;
grant all on public.telegram_link_codes to service_role;
```

Run: `yarn db-reset:local && yarn regenerate:types && yarn test:db` — PASS; run `rls-reviewer`.

- [ ] **Step 3: Failing web tests**

`apps/web/tests/unit/lib/telegram.test.ts`:

```ts
import { generateLinkCode, telegramDeepLink } from '@/lib/telegram'

describe('telegram link helpers', () => {
  it('builds the deep link and generates 20-char codes', () => {
    expect(telegramDeepLink('WsWeatherBot', 'ABC')).toBe('https://t.me/WsWeatherBot?start=link_ABC')
    expect(generateLinkCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{20}$/)
    expect(generateLinkCode()).not.toBe(generateLinkCode())
  })
})
```

`apps/web/tests/unit/actions/telegram.action.test.ts`: `startTelegramLinkAction` inserts `{ code, user_id, expires_at }` and returns the deep link using `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`; `getTelegramLinkStatusAction` maps rows: consumed → `linked`, `failed_reason` → `failed`, expired → `expired`, else `pending`; `unlinkTelegramAction` updates `users.telegram_id = null` for the current user only. Mock `auth`, `_helpers.resolveCurrentUserId`, and the service client like earlier action tests.

`apps/web/tests/unit/components/settings/TelegramCard.test.tsx`: not-linked → "Link Telegram" button; after `start` resolves → shows the deep link and "Waiting for Telegram…"; when the polled status returns `linked` → invalidates `userKeys.current` and shows "Linked"; linked user (`telegramId` set) → "Unlink" button.

- [ ] **Step 4: Implement**

`packages/shared/src/constants/index.ts` — append:

```ts
/** Web ↔ bot Telegram account linking (PRD W2b). The bot receives `/start link_<code>`. */
export const TELEGRAM_LINK_PREFIX = 'link_'
export const TELEGRAM_LINK_TTL_MS = 10 * 60_000
```

`apps/web/src/lib/telegram.ts`:

```ts
import { TELEGRAM_LINK_PREFIX } from '@ws/shared'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32 — no I, L, O, U

export const generateLinkCode = (): string => {
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % 32]
  return out
}

export const telegramDeepLink = (botUsername: string, code: string): string =>
  `https://t.me/${botUsername}?start=${TELEGRAM_LINK_PREFIX}${code}`
```

`apps/web/src/actions/telegram.action.ts`:

```ts
'use server'

import 'server-only'

import { auth } from '@clerk/nextjs/server'
import { TELEGRAM_LINK_TTL_MS } from '@ws/shared'
import { createServiceRoleClient } from '@ws/supabase-db'

import type { ActionResult } from '@/lib/actions/result'
import { actionError, actionOk } from '@/lib/actions/result'
import { generateLinkCode, telegramDeepLink } from '@/lib/telegram'

import { resolveCurrentUserId } from './_helpers'

const botUsername = (): string | null => process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? null

/** MRP-37: mint a one-time code; the user opens the deep link and the bot verifies ownership. */
export const startTelegramLinkAction = async (): Promise<ActionResult<{ code: string; deepLink: string; expiresAt: string }>> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return actionError('UNAUTHORIZED', 'Sign in to continue')
  const bot = botUsername()
  if (!bot) return actionError('NOT_CONFIGURED', 'Telegram linking is not configured yet')
  const service = createServiceRoleClient()
  const userId = await resolveCurrentUserId(service, clerkUserId)
  if (!userId) return actionError('UNAUTHORIZED', 'Sign in to continue')

  const code = generateLinkCode()
  const expiresAt = new Date(Date.now() + TELEGRAM_LINK_TTL_MS).toISOString()
  const { error } = await service.from('telegram_link_codes').insert({ code, user_id: userId, expires_at: expiresAt })
  if (error) { console.error('startTelegramLinkAction failed', error); return actionError('UNKNOWN', 'Could not start linking. Try again.') }
  return actionOk({ code, deepLink: telegramDeepLink(bot, code), expiresAt })
}

export const getTelegramLinkStatusAction = async (input: { code: string }): Promise<ActionResult<{ state: 'pending' | 'linked' | 'expired' | 'failed'; reason?: string }>> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return actionError('UNAUTHORIZED', 'Sign in to continue')
  const service = createServiceRoleClient()
  const userId = await resolveCurrentUserId(service, clerkUserId)
  const { data } = await service.from('telegram_link_codes').select('consumed_at, expires_at, failed_reason').eq('code', input.code).eq('user_id', userId ?? '').maybeSingle()
  if (!data) return actionError('NOT_FOUND', 'Unknown link code')
  if (data.consumed_at) return actionOk({ state: 'linked' })
  if (data.failed_reason) return actionOk({ state: 'failed', reason: data.failed_reason })
  if (new Date(data.expires_at).getTime() < Date.now()) return actionOk({ state: 'expired' })
  return actionOk({ state: 'pending' })
}

export const unlinkTelegramAction = async (): Promise<ActionResult<null>> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return actionError('UNAUTHORIZED', 'Sign in to continue')
  const service = createServiceRoleClient()
  const { error } = await service.from('users').update({ telegram_id: null }).eq('clerk_user_id', clerkUserId)
  if (error) { console.error('unlinkTelegramAction failed', error); return actionError('UNKNOWN', 'Could not unlink. Try again.') }
  return actionOk(null)
}
```

`TelegramCard` (client): reads `useCurrentUserQuery`; **linked** state → "Linked as tg · …4821" + Unlink (`Dialog` confirm) → `unlinkTelegramAction` → invalidate `userKeys.current`; **not linked** → "Link Telegram" → `startTelegramLinkAction` → shows: primary link button (`href={deepLink}` target `_blank`), a QR (`qrcode` `toDataURL` in a `useEffect`, `<img>` 160px), "Code expires in 10:00" countdown, and polls `getTelegramLinkStatusAction({ code })` every 3 s (`useQuery` with `refetchInterval` while `pending`) — `linked` → toast "Telegram linked", invalidate `userKeys.current`; `failed` → shows the reason ("That Telegram account is linked to another user"); `expired` → "Code expired — start again". Add `yarn add qrcode && yarn add -D @types/qrcode`.

`settings/page.tsx`: render `<TelegramCard testId="settings-telegram" />` under Appearance.

`.env.example`: `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=` with a comment (bot username without @; from BotFather). CLAUDE.md env table row.

**Bot handler** (`infra/supabase-db/supabase/functions/telegram-bot/link.ts`, Deno):

```ts
// MRP-37 web ↔ bot linking: /start link_<code>. Service-role client (RLS bypassed):
// the Telegram ID comes from the update, never from user text.
import { createClient } from 'npm:@supabase/supabase-js@2'

const service = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SECRET_KEY')!)

export const handleLinkCode = async (code: string, telegramId: number): Promise<string> => {
  const db = service()
  const { data: row } = await db.from('telegram_link_codes').select('code, user_id, expires_at, consumed_at').eq('code', code).maybeSingle()
  if (!row || row.consumed_at) return 'That link is invalid or was already used. Start again from the web app.'
  if (new Date(row.expires_at).getTime() < Date.now()) return 'That link expired. Start again from the web app.'

  const { error } = await db.from('users').update({ telegram_id: telegramId }).eq('id', row.user_id)
  if (error) {
    const reason = error.code === '23505' ? 'This Telegram account is already linked to another user.' : 'Could not link right now.'
    await db.from('telegram_link_codes').update({ failed_reason: reason }).eq('code', code)
    return reason
  }
  await db.from('telegram_link_codes').update({ consumed_at: new Date().toISOString() }).eq('code', code)
  return 'Linked! Your Telegram account is now connected to your Weather Station account.'
}
```

`index.ts` — replace the `start` handler:

```ts
import { handleLinkCode } from './link.ts'

bot.command('start', async (ctx) => {
  const payload = ctx.match?.trim() ?? ''
  if (payload.startsWith('link_') && ctx.from) {
    return ctx.reply(await handleLinkCode(payload.slice('link_'.length), ctx.from.id))
  }
  return ctx.reply('Weather Station bot — registration flow coming soon.')
})
```

(`SUPABASE_SECRET_KEY`/`SUPABASE_URL` are function secrets — `npx supabase secrets set`; document in `supabase/functions/.env.example`.) `deno check` + `deno lint` must pass (CI).

- [ ] **Step 5: Run everything**

`yarn workspace @ws/web test:unit -t "telegram|TelegramCard" && yarn lint && yarn check-types && (cd infra/supabase-db && deno check supabase/functions/telegram-bot/index.ts && deno lint supabase/functions/telegram-bot)` — PASS. Manual with `npx supabase functions serve telegram-bot` + a test bot: link → bot replies "Linked!" → settings flips to Linked within 3 s; second account with the same Telegram → "already linked" on both sides; unlink → not linked. **[verify when MRP-21 lands: bot recognises the linked user for /current without /register]**.

- [ ] **Step 6: Commit**

```bash
git add packages/shared infra/supabase-db apps/web/src apps/web/tests apps/web/.env.example apps/web/package.json yarn.lock
git commit -m "feat: Telegram account linking — link codes, settings card, bot /start link_<code> (MRP-37)"
```

---

### Task 7: Web alert management — schedules service, hooks, alerts page (MRP-42)

**Files:**
- Create: `apps/web/src/services/schedules/{schedules.service,schedules.queries}.ts`
- Create: `apps/web/src/components/alerts/{ScheduleList,ScheduleRow,ScheduleDialog,DayPicker,AlertsSkeleton}.tsx`, `apps/web/src/lib/schedule.ts`
- Create: `apps/web/src/app/(app)/alerts/page.tsx`; modify `components/shell/nav-items.ts` (+Alerts)
- Test: `apps/web/tests/unit/services/schedules/schedules.service.test.ts`, `apps/web/tests/unit/lib/schedule.test.ts`, `apps/web/tests/unit/components/alerts/alerts.test.tsx`, `apps/web/tests/integration/services/schedules/schedules.service.integration.test.ts`

**Interfaces (Produces):**
```ts
export interface Schedule { id: number; userId: string; time: string /* 'HH:MM' */; timezone: string; days: number[]; createdAt: string }
export const fetchSchedules = (supabase): Promise<Schedule[]>                                        // own rows via RLS, ordered by time
export const createSchedule = (supabase, { userId, time, timezone, days }): Promise<Schedule>
export const updateSchedule = (supabase, { id, time, timezone, days }): Promise<Schedule>
export const deleteSchedule = (supabase, { id }): Promise<void>
export const scheduleKeys = { all: ['schedules'] as const, list: ['schedules', 'list'] as const }
export const useSchedulesQuery = (); useCreateScheduleMutation(); useUpdateScheduleMutation(); useDeleteScheduleMutation()
export const WEEKDAYS: { value: 1..7; short: 'Mon'…'Sun' }[]
export const isValidTime = (v: string): boolean            // HH:MM 24h
export const normaliseTime = (v: string): string           // '7:30' → '07:30'; DB 'time' returns 'HH:MM:SS' → 'HH:MM'
export const localTimeZone = (): string
```

- [ ] **Step 1: Failing tests**

`apps/web/tests/unit/lib/schedule.test.ts`:

```ts
import { isValidTime, normaliseTime, WEEKDAYS } from '@/lib/schedule'

describe('schedule helpers', () => {
  it('validates and normalises times', () => {
    expect(isValidTime('07:30')).toBe(true)
    expect(isValidTime('24:00')).toBe(false)
    expect(normaliseTime('7:30')).toBe('07:30')
    expect(normaliseTime('07:30:00')).toBe('07:30')
  })
  it('lists ISO weekdays Monday first', () => {
    expect(WEEKDAYS[0]).toEqual({ value: 1, short: 'Mon' })
    expect(WEEKDAYS[6]).toEqual({ value: 7, short: 'Sun' })
  })
})
```

`apps/web/tests/unit/services/schedules/schedules.service.test.ts` — with the chain-mock pattern: `fetchSchedules` selects `'id, userId:user_id, time, timezone, days, createdAt:created_at'` ordered by `time`; `createSchedule` inserts snake_case `{ user_id, time, timezone, days }` and returns the aliased single row; `deleteSchedule` calls `.delete().eq('id', 3)`; errors → `ServiceError`.

`apps/web/tests/unit/components/alerts/alerts.test.tsx`: `useCurrentUserQuery` mocked with `telegramId: null` → page shows the "Link Telegram to manage alerts here" empty state with a `/settings` link; with `telegramId: 42` and two schedules → two rows with day pills; `ScheduleDialog` submit with no days shows "Pick at least one day".

Integration test: as user A create → list has 1 → update time → delete; as user B, list is `[]` and update/delete of A's id affects 0 rows.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`apps/web/src/lib/schedule.ts`:

```ts
export const WEEKDAYS = [
  { value: 1, short: 'Mon' }, { value: 2, short: 'Tue' }, { value: 3, short: 'Wed' }, { value: 4, short: 'Thu' },
  { value: 5, short: 'Fri' }, { value: 6, short: 'Sat' }, { value: 7, short: 'Sun' },
] as const

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
export const isValidTime = (v: string): boolean => TIME_RE.test(normaliseTime(v))
export const normaliseTime = (v: string): string => {
  const [h = '', m = ''] = v.split(':')
  return `${h.padStart(2, '0')}:${m.slice(0, 2).padStart(2, '0')}`
}
export const localTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone
```

`schedules.service.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { normaliseTime } from '@/lib/schedule'

import { ServiceError } from '../database/types'

export interface Schedule { id: number; userId: string; time: string; timezone: string; days: number[]; createdAt: string }
const COLUMNS = 'id, userId:user_id, time, timezone, days, createdAt:created_at'
const tidy = (row: Schedule): Schedule => ({ ...row, time: normaliseTime(row.time) })

export const fetchSchedules = async (supabase: SupabaseClient<Database>): Promise<Schedule[]> => {
  const { data, error } = await supabase.from('schedules').select(COLUMNS).order('time', { ascending: true })
  if (error) throw new ServiceError(`Failed to fetch schedules: ${error.message}`, error.code, error.details)
  return (data ?? []).map(tidy)
}

export const createSchedule = async (supabase: SupabaseClient<Database>, input: { userId: string; time: string; timezone: string; days: number[] }): Promise<Schedule> => {
  const { data, error } = await supabase
    .from('schedules')
    .insert({ user_id: input.userId, time: normaliseTime(input.time), timezone: input.timezone, days: input.days })
    .select(COLUMNS)
    .single()
  if (error) throw new ServiceError(`Failed to create schedule: ${error.message}`, error.code, error.details)
  return tidy(data)
}

export const updateSchedule = async (supabase: SupabaseClient<Database>, input: { id: number; time: string; timezone: string; days: number[] }): Promise<Schedule> => {
  const { data, error } = await supabase
    .from('schedules')
    .update({ time: normaliseTime(input.time), timezone: input.timezone, days: input.days })
    .eq('id', input.id)
    .select(COLUMNS)
    .single()
  if (error) throw new ServiceError(`Failed to update schedule: ${error.message}`, error.code, error.details)
  return tidy(data)
}

export const deleteSchedule = async (supabase: SupabaseClient<Database>, input: { id: number }): Promise<void> => {
  const { error } = await supabase.from('schedules').delete().eq('id', input.id)
  if (error) throw new ServiceError(`Failed to delete schedule: ${error.message}`, error.code, error.details)
}
```

`schedules.queries.ts`: `scheduleKeys`, `useSchedulesQuery` (`enabled: !!isSignedIn`), and three mutations that call the service with `useSupabaseClient()` and `invalidateQueries({ queryKey: scheduleKeys.all })` on success; the create mutation takes `userId` from `useCurrentUserQuery().data?.id` (guarded — button disabled until loaded).

Components: `DayPicker` (7 toggle buttons, `aria-pressed`, `Mon–Fri` preselected on create); `ScheduleDialog` (time `Input type="time"`, `DayPicker`, timezone `Select` with `Intl.supportedValuesOf('timeZone')` narrowed to a curated list + the local zone first; validation: valid time, ≥1 day → inline errors); `ScheduleRow` (time in `readout`, day pills, timezone in mono, edit + delete with confirm `Dialog`); `ScheduleList` (`AnimatePresence` rows, empty → "No alerts yet — add one"); `AlertsSkeleton`. Page: gate on `useCurrentUserQuery` → `telegramId === null` → `EmptyState` "Link Telegram to manage alerts here" with a `Button` link to `/settings`; else header + "Add alert" + list. Copy line under the header: "Alerts arrive in Telegram at these local times. The bot's alert menu edits the same list."

`nav-items.ts`: insert `{ key: 'alerts', href: '/alerts', label: 'Alerts' }` after Dashboard.

- [ ] **Step 4: Run everything**

`yarn workspace @ws/web test:unit && yarn lint && yarn check-types && yarn workspace @ws/web test:integration -t schedules` — PASS. Manual: create 07:30 Mon–Fri → row appears with a spring; edit → 08:00; delete → row exits. **[verify when MRP-24/26 land: a bot-created slot appears on the web; a web-created slot fires via the dispatcher]**.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src apps/web/tests
git commit -m "feat(web): alert management — schedules service/hooks, alerts page with day picker (MRP-42)"
```

---

### Task 8: Account deletion — action, Clerk webhook, settings danger zone (MRP-40)

**Files:**
- Create: `apps/web/src/actions/account.action.ts`, `apps/web/src/lib/account/erase-user.ts`, `apps/web/src/app/api/webhooks/clerk/route.ts`, `apps/web/src/components/settings/DeleteAccountCard.tsx`
- Modify: `apps/web/src/app/(app)/settings/page.tsx`, `apps/web/.env.example` (+`CLERK_WEBHOOK_SIGNING_SECRET`), CLAUDE.md env table
- Test: `apps/web/tests/unit/lib/account/erase-user.test.ts`, `apps/web/tests/unit/actions/account.action.test.ts`, `apps/web/tests/unit/app/api/webhooks/clerk/route.test.ts`, `apps/web/tests/integration/lib/account/erase-user.integration.test.ts`

**Interfaces (Produces):**
```ts
export const eraseUserByClerkId = (service, clerkUserId): Promise<{ deletedUsers: number }>   // deletes users row → cascades device_users, schedules, telegram_link_codes; devices flip via trigger; readings kept
export const deleteAccountAction = ({ confirmation: string }): Promise<ActionResult<null>>   // requires confirmation === 'delete'; erase → clerkClient().users.deleteUser
// POST /api/webhooks/clerk — verifyWebhook (svix) → on 'user.deleted' → eraseUserByClerkId
```

- [ ] **Step 1: Failing tests**

`erase-user.test.ts`: with a mocked service client, `eraseUserByClerkId` deletes from `users` where `clerk_user_id = X` and returns the count; on error throws `ServiceError`.

`account.action.test.ts`: `confirmation !== 'delete'` → `INVALID_INPUT`; success path calls `eraseUserByClerkId` then `clerkClient().users.deleteUser('user_1')` (mock `@clerk/nextjs/server` `clerkClient` returning `{ users: { deleteUser } }`); Clerk failure after DB erase still returns ok:false `PARTIAL` with a logged error (so the user sees a message and support can finish it) — assert code.

`webhooks/clerk/route.test.ts`: mock `@clerk/nextjs/webhooks` `verifyWebhook` to return `{ type: 'user.deleted', data: { id: 'user_1' } }` → 200 and `eraseUserByClerkId` called; when `verifyWebhook` throws → 400; other event types → 200 without erasing.

Integration: seed user A with device (owner), schedule, link code; run `eraseUserByClerkId` → `users`/`device_users`/`schedules`/`telegram_link_codes` have no rows for A; device status is `unregistered`; readings for the device still exist.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

`apps/web/src/lib/account/erase-user.ts`:

```ts
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '@/services/database/types'

/**
 * Right to erasure (MRP-40). Deleting the users row cascades device_users,
 * schedules and telegram_link_codes; maintain_device_status() flips a device
 * with no remaining members back to 'unregistered' (re-claimable). Readings
 * are device-scoped, not personal — they are kept (decision recorded in the
 * spec §4.9 and the privacy policy).
 */
export const eraseUserByClerkId = async (service: SupabaseClient<Database>, clerkUserId: string): Promise<{ deletedUsers: number }> => {
  const { data, error } = await service.from('users').delete().eq('clerk_user_id', clerkUserId).select('id')
  if (error) throw new ServiceError(`Failed to erase user: ${error.message}`, error.code, error.details)
  return { deletedUsers: data?.length ?? 0 }
}
```

`apps/web/src/actions/account.action.ts`:

```ts
'use server'

import 'server-only'

import { auth, clerkClient } from '@clerk/nextjs/server'
import { createServiceRoleClient } from '@ws/supabase-db'

import type { ActionResult } from '@/lib/actions/result'
import { actionError, actionOk } from '@/lib/actions/result'
import { eraseUserByClerkId } from '@/lib/account/erase-user'

export const deleteAccountAction = async (input: { confirmation: string }): Promise<ActionResult<null>> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return actionError('UNAUTHORIZED', 'Sign in to continue')
  if (input.confirmation.trim().toLowerCase() !== 'delete') return actionError('INVALID_INPUT', 'Type "delete" to confirm', { confirmation: 'Type "delete" to confirm' })

  try {
    await eraseUserByClerkId(createServiceRoleClient(), clerkUserId)
  } catch (err) {
    console.error('deleteAccountAction: erase failed', err)
    return actionError('UNKNOWN', 'Could not delete your data. Try again or contact support.')
  }
  try {
    const client = await clerkClient()
    await client.users.deleteUser(clerkUserId)
  } catch (err) {
    console.error('deleteAccountAction: Clerk deletion failed after DB erase', err)
    return actionError('PARTIAL', 'Your data was deleted but the sign-in account could not be removed. Contact support to finish.')
  }
  return actionOk(null)
}
```

`apps/web/src/app/api/webhooks/clerk/route.ts`:

```ts
import { verifyWebhook } from '@clerk/nextjs/webhooks'
import { createServiceRoleClient } from '@ws/supabase-db'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { eraseUserByClerkId } from '@/lib/account/erase-user'

/** Clerk → us: a user deleted from the Clerk dashboard must not leave orphaned rows (MRP-40). */
export const POST = async (req: NextRequest): Promise<NextResponse> => {
  let evt: Awaited<ReturnType<typeof verifyWebhook>>
  try {
    evt = await verifyWebhook(req)
  } catch (err) {
    console.error('clerk webhook: signature verification failed', err)
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 })
  }
  if (evt.type === 'user.deleted' && evt.data.id) {
    try {
      await eraseUserByClerkId(createServiceRoleClient(), evt.data.id)
    } catch (err) {
      console.error('clerk webhook: erase failed', err)
      return NextResponse.json({ error: 'erase failed' }, { status: 500 })
    }
  }
  return NextResponse.json({ ok: true })
}
```

`verifyWebhook` reads `CLERK_WEBHOOK_SIGNING_SECRET`; `/api/webhooks(.*)` is already public in `proxy.ts`. Register the endpoint in the Clerk dashboard (Webhooks → `user.deleted`).

`DeleteAccountCard` (client): danger `Card` "Delete account" with copy "Removes your account, station links, alerts and Telegram link. Readings stay with the station, which becomes claimable again."; button opens a `Dialog` with an `Input` (type `delete`) and a danger `Button` → `deleteAccountAction` → on ok: `useClerk().signOut({ redirectUrl: '/sign-in' })` + toast; `PARTIAL`/`UNKNOWN` messages inline. Add to settings page as the last section.

Telegram-only users: documented support process — add a "Data & privacy" paragraph on `/privacy` (Task 9) with the contact address; the bot command is MRP-24/26 territory.

- [ ] **Step 4: Run everything**

`yarn workspace @ws/web test:unit -t "erase|deleteAccountAction|clerk webhook" && yarn lint && yarn check-types && yarn workspace @ws/web test:integration -t erase` — PASS. Manual: delete a test account → redirected to sign-in; Supabase Studio shows no rows referencing it; the device is `unregistered`; a fresh account can claim it. Delete another test user from the Clerk dashboard → webhook (use `svix play` or ngrok locally) → rows gone.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src apps/web/tests apps/web/.env.example CLAUDE.md
git commit -m "feat(web): account deletion — erase helper, action, Clerk user.deleted webhook, danger zone (MRP-40)"
```

---

### Task 9: Privacy policy page + data-minimisation review (MRP-41)

**Files:**
- Create: `apps/web/src/app/privacy/page.tsx`, `apps/web/src/components/legal/PrivacyPolicy.tsx`, `apps/web/src/components/legal/LegalFrame.tsx`
- Create: `docs/privacy-data-minimisation.md`
- Modify: `apps/web/src/components/shell/AuthFrame.tsx` (already links `/privacy`), `Footer.tsx` (already links) — verify
- Test: `apps/web/tests/unit/components/legal/PrivacyPolicy.test.tsx` (renders every required section heading)

- [ ] **Step 1: Failing test**

```tsx
/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'

import { PrivacyPolicy } from '@/components/legal/PrivacyPolicy'

describe('PrivacyPolicy', () => {
  it.each(['What we collect', 'Why we collect it', 'How long we keep it', 'Who can see it', 'Your rights', 'Contact'])('has section "%s"', (title) => {
    render(<PrivacyPolicy testId="pp" />)
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Implement**

`LegalFrame`: brand + back link, `max-w-2xl` prose column, `AuthFrame`-like (no app shell). `PrivacyPolicy`: sections with these exact headings and the spec §4.8 content — collected: sensor readings tied to a station ID; your Clerk account ID and email (held by Clerk); your Telegram user ID if you link it; purpose: show you your station's data, send alerts you configure; retention: full-resolution readings 12 months, then daily aggregates kept permanently (matches MRP-36); sharing: no public sharing; you choose who sees a station; your rights: delete your account from Settings (what is removed, what stays: readings, anonymised by station); Telegram-only users email the contact; contact: `privacy@<domain>` (placeholder value must be replaced by the project owner — call it out in the PR). `page.tsx` renders `LegalFrame` + `PrivacyPolicy` with `metadata.title = 'Privacy policy'`.

`docs/privacy-data-minimisation.md`: table of every stored personal field (`users.clerk_user_id`, `users.telegram_id`, `device_users.user_id`, `schedules.user_id/time/days/timezone`, `telegram_link_codes.*`, Clerk-held email/name) with justification and retention; conclusion: nothing unjustified → no removal tickets; note that readings are not personal data once unlinked.

The bot's `/start`/About linking to the policy is **[verify when MRP-20 lands]** — record the URL to link.

- [ ] **Step 3: Run tests, lint, types; commit**

```bash
git add apps/web/src apps/web/tests docs/privacy-data-minimisation.md
git commit -m "feat(web): privacy policy page + data-minimisation review (MRP-41)"
```

---

### Task 10: Docs, verification, final gate, PR

- [ ] **Step 1: Docs**

CLAUDE.md: env table rows for `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`, `CLERK_WEBHOOK_SIGNING_SECRET`; "Server paths" table stays accurate (all new actions are in the listed categories). README: features list update. `apps/web/.env.example` complete.

- [ ] **Step 2: Verification doc**

`docs/superpowers/verification/2026-MM-DD-web-plan-2.md`: table per ticket AC with result; the **[verify when …]** items listed with their blocking ticket (MRP-21 bot recognition, MRP-24/26 alert round-trip and firing, MRP-29/30/31 real wind/rain values, MRP-20 bot policy link, MRP-36 readings_daily switch for 30 d).

- [ ] **Step 3: Final gate**

`yarn format && yarn lint && yarn check-types && yarn test:unit && yarn workspace @ws/web test:integration && (cd infra/supabase-db && yarn test:db && deno check supabase/functions/telegram-bot/index.ts && deno lint supabase/functions/telegram-bot) && yarn build` — all green. Run `data-path-reviewer` on `apps/web/src` and `rls-reviewer` on the three migrations. Run the motion skill's MotionScore audit on `apps/web/src/components` and fix anything below its default threshold.

- [ ] **Step 4: Commit, push, PR**

```bash
git add -A && git commit -m "docs: plan 2 verification, env docs" && git push -u origin feature/web-history-sharing-settings
```

PR to `dev`: "Web — history ranges, CSV export, sharing, Telegram link, alerts, account deletion, privacy (MRP-33/34/35/37/38/40/41/42)"; link spec + plan + verification doc; move tickets to In Review; leave the **[verify when …]** checklist in the PR description.

---

## Amendments (during execution, 2026-08-15)

- **CSV export chunk = 1 000 rows**, not 10 000: PostgREST `max_rows` (1000)
  silently truncates larger `.limit()`s — a 2 300-row export came back as
  1 000 in the browser. `nextCursor` is set while a chunk is full (`>=`).
- **`'use server'` modules export only async functions**: `parseShareIdentifier`
  lives in `lib/share-identifier.ts` (same lesson as Plan 1's `normalizeDeviceId`).
- **Task 5b added (user request mid-plan): station nickname + address** —
  `devices.label`/`devices.address` (check constraints, column-list grant),
  owner-only `updateDeviceProfileAction`, shown in chip/header/list/eyebrow/select;
  Google Map + geocoding **deferred by decision** (spec §4.5b).
- **Telegram link polling** uses `refetchIntervalInBackground: true` (users
  switch to the Telegram app); unlink clears any consumed pending code; the QR
  is a `next/image` with `unoptimized` (data URL) — no `eslint-disable`.
- **Bot**: `@supabase/supabase-js` added to the function's `deno.json` import
  map (deno lint forbids inline `npm:` specifiers); `SUPABASE_URL` /
  `SUPABASE_SECRET_KEY` documented in `functions/.env.example`.
- **Charts**: multi-day ranges use date ticks; precipitation is a `Bar`; the
  wind panel shows the latest bearing as an `aside` on `ChartPanel`.
- **Hidden-tab caveat for browser checks**: TanStack pauses `refetchInterval`
  and Motion pauses animations when the extension tab is hidden — inspect DOM
  state via JS rather than screenshots for those.
