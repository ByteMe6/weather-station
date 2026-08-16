# Station Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners give a station latitude/longitude in the existing "Station details" dialog, and `/devices` shows every located station as a marker on a free OpenStreetMap map.

**Architecture:** Two nullable columns on `public.devices` (column-list grant, same pattern as `label`/`address`), written through the existing owner-only `updateDeviceProfileAction`, read through the existing `fetchMyDevices` query — so the map costs no extra request and refreshes from the mutation that already invalidates `deviceKeys.mine`. The map itself is a `next/dynamic({ ssr: false })` Leaflet component rendered only on `/devices`.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19.2, TypeScript, Tailwind v4, TanStack Query 5, Supabase/Postgres with RLS, `leaflet@1.9.4` + `react-leaflet@5.0.0`, Jest 29 + jsdom, pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-16-station-map-design.md`

## Global Constraints

- **Never `any`** — including `as any`, `any[]`, `Record<string, any>`. Use `unknown` + narrowing.
- **Never `eslint-disable`** or any ESLint suppression comment. If lint complains, refactor.
- **Arrow functions only** (`func-style: ["error", "expression"]`); `const` over `let`.
- **`testId` prop on every component**, rendered as `data-testid`, kebab-case.
- **`import type` separated** from value imports; `ReactElement`/`ReactNode` via named import, never `JSX.Element`.
- **`useCallback` for every function defined in a component**; no inline anonymous functions in JSX. **`useMemo`** for derived values, mapped arrays, and object/array literals passed as props.
- **Tests never sit next to source** — they live in `apps/web/tests/{unit,integration}/`, mirroring `src/`, imported via the `@/` alias.
- **Services are pure async arrow functions** taking `supabase: SupabaseClient<Database>` first and throwing `ServiceError`.
- **Column aliasing:** alias snake_case → camelCase inside `.select()`; filters (`.eq`, `.order`) and insert/update payloads stay snake_case.
- **`devices.secret` is service-role only** — no migration may ever grant it to a user role.
- **Migrations:** create with `yarn migrate:new <name>` from `infra/supabase-db/`; run `yarn regenerate:types` after every migration.
- **OSM tile policy (non-negotiable):** attribution `© OpenStreetMap contributors` always visible, interactive viewing only, no tile pre-fetching, seeding, or offline archive.
- **Coordinate precision:** `numeric(8,6)` latitude, `numeric(9,6)` longitude.
- Run `yarn lint && yarn check-types && yarn test:unit` before calling any task done; `yarn format` before committing.

---

## File Structure

| File                                                                    | Responsibility                                                                    |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `infra/supabase-db/supabase/migrations/<ts>_device_coordinates.sql`     | Columns, check constraints, column-list grant                                     |
| `infra/supabase-db/supabase/tests/device_coordinates.sql`               | pgTAP: grants, `secret` still hidden, range + both-or-neither checks              |
| `apps/web/src/lib/coordinates.ts`                                        | Pure parsing/formatting helpers (`parseCoordinateInput`, `formatCoordinate`)      |
| `apps/web/src/actions/devices.action.ts`                                 | `profileSchema` gains latitude/longitude; action payload + return type widen      |
| `apps/web/src/services/devices/devices.service.ts`                       | `MyDevice.device` gains the columns; `fetchMyDevices` select list                 |
| `apps/web/src/components/devices/DeviceProfileDialog.tsx`                | Two coordinate fields + paste splitting                                           |
| `apps/web/src/components/map/stationPins.ts`                             | `StationPin` type + pure `stationPins(devices)` selector                          |
| `apps/web/src/components/map/StationMap.tsx`                             | The Leaflet map itself (client-only)                                              |
| `apps/web/src/components/map/StationMapCard.tsx`                         | Card wrapper + `next/dynamic({ ssr: false })` boundary + empty-state rule         |
| `apps/web/src/components/devices/DevicesIndex.tsx`                       | Renders the card; per-row "add coordinates" hint                                  |
| `apps/web/tests/stubs/react-leaflet.tsx`                                 | Test stub — jsdom cannot run Leaflet                                              |

---

### Task 1: Database columns

**Files:**

- Create: `infra/supabase-db/supabase/migrations/<timestamp>_device_coordinates.sql`
- Create: `infra/supabase-db/supabase/tests/device_coordinates.sql`
- Modify: `infra/supabase-db/src/types/database.ts` (regenerated, never hand-edited)

**Interfaces:**

- Consumes: nothing.
- Produces: `public.devices.latitude numeric(8,6)`, `public.devices.longitude numeric(9,6)`, both nullable and readable by `authenticated`; constraint name `devices_coords_both_or_neither`.

- [ ] **Step 1: Create the migration file**

From `infra/supabase-db/`:

```bash
yarn migrate:new device_coordinates
```

This prints a path like `supabase/migrations/20260816T…_device_coordinates.sql`. Note it — the next step writes into that exact file. (If the command fails to report the path, list `supabase/migrations/` and take the newest file.)

- [ ] **Step 2: Write the migration**

Write exactly this into the file created above:

```sql
-- Station coordinates (follow-up to device profile): owners type latitude and
-- longitude themselves, the map on /devices draws a marker per located station.
-- No geocoding service is involved, so nothing leaves our stack on save.
alter table public.devices
  add column latitude numeric(8,6) check (latitude between -90 and 90),
  add column longitude numeric(9,6) check (longitude between -180 and 180);

-- Half a pair would put a marker on the equator or the prime meridian; the DB
-- refuses it so no code path has to defend against it.
alter table public.devices
  add constraint devices_coords_both_or_neither
  check ((latitude is null) = (longitude is null));

-- Column-list grant, exactly like label/address: devices has no blanket select
-- grant because devices.secret must stay unreadable on every user path.
grant select (latitude, longitude) on public.devices to authenticated;
```

- [ ] **Step 3: Apply it and regenerate types**

From `infra/supabase-db/`:

```bash
yarn migrate:up
yarn regenerate:types
```

Expected: `Finished supabase db push.` then a rewritten `src/types/database.ts`. Confirm the columns landed:

```bash
grep -n "latitude" src/types/database.ts | head -3
```

Expected: `latitude: number | null` inside the `devices` Row/Insert/Update types.

- [ ] **Step 4: Write the pgTAP test**

Create `infra/supabase-db/supabase/tests/device_coordinates.sql`:

```sql
begin;
select plan(8);

insert into public.users (id, clerk_user_id) values ('00000000-0000-0000-0000-00000000000a', 'user_a');
insert into public.devices (device_id, secret, status, latitude, longitude)
  values ('ws-coords000001', 'topsecret', 'registered', 49.839700, 24.029700);
insert into public.device_users (device_id, user_id, role) values ('ws-coords000001', '00000000-0000-0000-0000-00000000000a', 'owner');

select ok(has_column_privilege('authenticated', 'public.devices', 'latitude', 'select'), 'authenticated can read devices.latitude');
select ok(has_column_privilege('authenticated', 'public.devices', 'longitude', 'select'), 'authenticated can read devices.longitude');
select ok(not has_column_privilege('authenticated', 'public.devices', 'secret', 'select'), 'devices.secret is still unreadable');
select ok(not has_column_privilege('authenticated', 'public.devices', 'latitude', 'update'), 'coordinates are read-only for clients (owners write via the server action)');

select throws_ok(
  $$ update public.devices set latitude = 91 where device_id = 'ws-coords000001' $$,
  '23514', null, 'latitude above 90 is rejected'
);
select throws_ok(
  $$ update public.devices set longitude = -181 where device_id = 'ws-coords000001' $$,
  '23514', null, 'longitude below -180 is rejected'
);
select throws_ok(
  $$ update public.devices set latitude = null where device_id = 'ws-coords000001' $$,
  '23514', null, 'half a coordinate pair is rejected'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"user_a","role":"authenticated"}', true);
select is(
  (select latitude from public.devices where device_id = 'ws-coords000001'),
  49.839700::numeric, 'member reads the latitude through RLS'
);

select * from finish();
rollback;
```

- [ ] **Step 5: Run the DB suite**

From `infra/supabase-db/`:

```bash
yarn db-reset:local && yarn test:db
```

Expected: `Result: PASS` (a reset also proves the new migration applies to a clean database).

- [ ] **Step 6: Commit**

```bash
git add infra/supabase-db
git commit -m "feat(db): station latitude/longitude columns with grants and checks"
```

---

### Task 2: Coordinate parsing helpers

**Files:**

- Create: `apps/web/src/lib/coordinates.ts`
- Test: `apps/web/tests/unit/lib/coordinates.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `parseCoordinateInput(raw: string): { latitude: string; longitude?: string }`
  - `formatCoordinate(value: number): string`

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/lib/coordinates.test.ts`:

```ts
import { formatCoordinate, parseCoordinateInput } from '@/lib/coordinates'

describe('parseCoordinateInput', () => {
  it('passes a single number through untouched', () => {
    expect(parseCoordinateInput('49.8397')).toEqual({ latitude: '49.8397' })
    expect(parseCoordinateInput('  -0.5 ')).toEqual({ latitude: '-0.5' })
  })

  it('splits a pasted "lat, lng" pair across both fields', () => {
    expect(parseCoordinateInput('49.8397, 24.0297')).toEqual({
      latitude: '49.8397',
      longitude: '24.0297',
    })
    expect(parseCoordinateInput('49.8397,24.0297')).toEqual({
      latitude: '49.8397',
      longitude: '24.0297',
    })
    expect(parseCoordinateInput(' -33.8688 , 151.2093 ')).toEqual({
      latitude: '-33.8688',
      longitude: '151.2093',
    })
  })

  it('leaves anything that is not a clean pair alone for the schema to reject', () => {
    expect(parseCoordinateInput('nope')).toEqual({ latitude: 'nope' })
    expect(parseCoordinateInput('1, 2, 3')).toEqual({ latitude: '1, 2, 3' })
    expect(parseCoordinateInput('')).toEqual({ latitude: '' })
  })
})

describe('formatCoordinate', () => {
  it('renders six decimals without exponent notation', () => {
    expect(formatCoordinate(49.8397)).toBe('49.839700')
    expect(formatCoordinate(-0.0000005)).toBe('-0.000001')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
yarn workspace @ws/web test:unit -- tests/unit/lib/coordinates.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/coordinates'`.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/coordinates.ts`:

```ts
/**
 * Coordinates are typed by hand (no geocoding service). Copying a pin from a
 * phone or a maps app yields "49.839700, 24.029700" — one string holding both
 * numbers — so pasting that into the latitude field fills in both instead of
 * failing validation. Anything that is not a clean pair is passed through
 * unchanged and rejected later by the action's schema, which owns the error
 * messages.
 */
const NUMBER = /^-?\d+(\.\d+)?$/

export const parseCoordinateInput = (
  raw: string,
): { latitude: string; longitude?: string } => {
  const parts = raw.split(',').map((p) => p.trim())
  if (parts.length === 2 && parts.every((p) => NUMBER.test(p))) {
    return { latitude: parts[0]!, longitude: parts[1]! }
  }
  return { latitude: raw.trim() }
}

/** Six decimals matches the column precision (~0.11 m) and avoids exponent notation. */
export const formatCoordinate = (value: number): string => value.toFixed(6)
```

- [ ] **Step 4: Run the test again**

```bash
yarn workspace @ws/web test:unit -- tests/unit/lib/coordinates.test.ts
```

Expected: PASS (9 assertions across 4 tests).

- [ ] **Step 5: Commit**

```bash
yarn format
git add apps/web/src/lib/coordinates.ts apps/web/tests/unit/lib/coordinates.test.ts
git commit -m "feat(web): coordinate parsing helpers with pasted-pair support"
```

---

### Task 3: Save coordinates through the existing owner-only action

**Files:**

- Modify: `apps/web/src/actions/devices.action.ts` (`profileSchema` and `updateDeviceProfileAction`)
- Modify: `apps/web/src/services/devices/devices.service.ts` (`MyDevice` interface and the `fetchMyDevices` select list)
- Test: `apps/web/tests/unit/actions/devices.action.test.ts` (extend), `apps/web/tests/integration/services/devices/devices.service.integration.test.ts` (extend)

**Interfaces:**

- Consumes: Task 1's columns.
- Produces:
  - `updateDeviceProfileAction(input: { deviceId: string; label: string; address: string; latitude: string; longitude: string }): Promise<ActionResult<{ label: string | null; address: string | null; latitude: number | null; longitude: number | null }>>`
  - `MyDevice.device` gains `latitude: number | null; longitude: number | null`.

- [ ] **Step 1: Write the failing action tests**

Append to `apps/web/tests/unit/actions/devices.action.test.ts`, inside the existing `describe('updateDeviceProfileAction', …)` block:

```ts
it('rejects an out-of-range latitude and a half-filled pair', async () => {
  helpers.resolveMemberRole.mockResolvedValue('owner')
  await expect(
    updateDeviceProfileAction({
      deviceId: 'ws-1',
      label: '',
      address: '',
      latitude: '91',
      longitude: '24.0297',
    }),
  ).resolves.toMatchObject({
    ok: false,
    code: 'INVALID_INPUT',
    fieldErrors: { latitude: expect.any(String) as string },
  })
  await expect(
    updateDeviceProfileAction({
      deviceId: 'ws-1',
      label: '',
      address: '',
      latitude: '49.8397',
      longitude: '',
    }),
  ).resolves.toMatchObject({
    ok: false,
    code: 'INVALID_INPUT',
    fieldErrors: { longitude: expect.any(String) as string },
  })
})

it('rejects a non-numeric coordinate', async () => {
  helpers.resolveMemberRole.mockResolvedValue('owner')
  await expect(
    updateDeviceProfileAction({
      deviceId: 'ws-1',
      label: '',
      address: '',
      latitude: 'north',
      longitude: '24.0297',
    }),
  ).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
yarn workspace @ws/web test:unit -- tests/unit/actions/devices.action.test.ts
```

Expected: FAIL — TypeScript rejects the extra `latitude`/`longitude` properties, or the assertions fail because the schema ignores them.

- [ ] **Step 3: Extend the schema and the action**

In `apps/web/src/actions/devices.action.ts`, replace the `profileSchema` declaration with:

```ts
// Empty string clears the value; anything else must be a number in range. The
// DB enforces both-or-neither too (devices_coords_both_or_neither), but doing
// it here turns a 23514 into a field error the form can point at.
const coordinateField = (min: number, max: number, name: string) =>
  z
    .string()
    .trim()
    .transform((v) => (v.length === 0 ? null : v))
    .refine((v) => v === null || /^-?\d+(\.\d+)?$/.test(v), {
      message: `Enter ${name} as a decimal number`,
    })
    .transform((v) => (v === null ? null : Number(v)))
    .refine((v) => v === null || (v >= min && v <= max), {
      message: `${name} must be between ${min} and ${max}`,
    })

const profileSchema = z
  .object({
    deviceId: z.string().min(1),
    label: z
      .string()
      .trim()
      .max(40, 'Keep the nickname under 40 characters')
      .transform((v) => (v.length === 0 ? null : v)),
    address: z
      .string()
      .trim()
      .max(200, 'Keep the address under 200 characters')
      .transform((v) => (v.length === 0 ? null : v)),
    latitude: coordinateField(-90, 90, 'latitude'),
    longitude: coordinateField(-180, 180, 'longitude'),
  })
  .superRefine((v, ctx) => {
    if ((v.latitude === null) === (v.longitude === null)) return
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [v.latitude === null ? 'latitude' : 'longitude'],
      message: 'Enter both latitude and longitude, or leave both empty',
    })
  })
```

Then widen the action's input and update payload:

```ts
export const updateDeviceProfileAction = async (input: {
  deviceId: string
  label: string
  address: string
  latitude: string
  longitude: string
}): Promise<
  ActionResult<{
    label: string | null
    address: string | null
    latitude: number | null
    longitude: number | null
  }>
> => {
```

Inside it, change the update call and the success return:

```ts
  const { error } = await gate.service
    .from('devices')
    .update({
      label: parsed.data.label,
      address: parsed.data.address,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
    })
    .eq('device_id', parsed.data.deviceId)
```

```ts
  return actionOk({
    label: parsed.data.label,
    address: parsed.data.address,
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
  })
```

- [ ] **Step 4: Widen the read side**

In `apps/web/src/services/devices/devices.service.ts`, extend the `MyDevice` interface:

```ts
export interface MyDevice {
  deviceId: string
  role: DeviceRole
  addedAt: string
  device: {
    status: DeviceStatus
    createdAt: string
    label: string | null
    address: string | null
    latitude: number | null
    longitude: number | null
  } | null
}
```

and the `fetchMyDevices` select string (one line, replacing the existing one):

```ts
    .select(
      'deviceId:device_id, role, addedAt:added_at, device:devices ( status, createdAt:created_at, label, address, latitude, longitude )',
    )
```

- [ ] **Step 5: Run the unit tests**

```bash
yarn workspace @ws/web test:unit -- tests/unit/actions/devices.action.test.ts
```

Expected: PASS. Also run `yarn check-types` — the new required `latitude`/`longitude` inputs will break `DeviceProfileDialog` and the `useUpdateDeviceProfileMutation` typing; fix both now:

In `apps/web/src/services/devices/devices.queries.ts`, widen the mutation's input type:

```ts
export const useUpdateDeviceProfileMutation = (deviceId: string) => {
  const invalidate = useInvalidateDevice(deviceId)
  return useMutation({
    mutationFn: async (input: {
      label: string
      address: string
      latitude: string
      longitude: string
    }) => unwrapAction(await updateDeviceProfileAction({ deviceId, ...input })),
    onSuccess: invalidate,
  })
}
```

`DeviceProfileDialog` is fully updated in Task 4; to keep this task green, pass empty strings for now:

```ts
        await save.mutateAsync({
          label: labelValue,
          address: addressValue,
          latitude: '',
          longitude: '',
        })
```

- [ ] **Step 6: Write the integration test**

Append a new `it` to `apps/web/tests/integration/services/devices/devices.service.integration.test.ts`:

```ts
it('coordinates: owner writes them, members read them, clearing sets both to null', async () => {
  const { data: a } = await db
    .from('users')
    .insert({ clerk_user_id: CLERK_A })
    .select('id')
    .single()
  await db.from('devices').insert({
    device_id: DEVICE_ID,
    secret: 'x'.repeat(64),
    status: 'registered',
  })
  await db
    .from('device_users')
    .insert({ device_id: DEVICE_ID, user_id: a!.id, role: 'owner' })

  await db
    .from('devices')
    .update({ latitude: 49.8397, longitude: 24.0297 })
    .eq('device_id', DEVICE_ID)

  const mine = await fetchMyDevices(createUserClient(CLERK_A))
  expect(mine[0]?.device).toMatchObject({
    latitude: 49.8397,
    longitude: 24.0297,
  })

  await db
    .from('devices')
    .update({ latitude: null, longitude: null })
    .eq('device_id', DEVICE_ID)
  const cleared = await fetchMyDevices(createUserClient(CLERK_A))
  expect(cleared[0]?.device).toMatchObject({
    latitude: null,
    longitude: null,
  })
})
```

- [ ] **Step 7: Run the integration suite**

```bash
yarn workspace @ws/web test:integration:secrets
```

Expected: PASS (11 tests). Local Supabase must be running — `npx supabase start` from `infra/supabase-db/` if it is not.

- [ ] **Step 8: Commit**

```bash
yarn format
git add apps/web infra
git commit -m "feat(devices): persist station coordinates through the profile action"
```

---

### Task 4: Coordinate fields in the station details dialog

**Files:**

- Modify: `apps/web/src/components/devices/DeviceProfileDialog.tsx`
- Test: `apps/web/tests/unit/components/devices/DeviceProfileDialog.test.tsx` (create)

**Interfaces:**

- Consumes: `parseCoordinateInput`/`formatCoordinate` (Task 2), `useUpdateDeviceProfileMutation` with the widened input (Task 3), `MyDevice.device.latitude/longitude` (Task 3).
- Produces: `DeviceProfileDialogProps` gains `latitude: number | null` and `longitude: number | null`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/components/devices/DeviceProfileDialog.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'

const update = jest.fn<Promise<unknown>, [unknown]>()
jest.mock('@/actions/devices.action', () => ({
  updateDeviceProfileAction: (i: unknown) => update(i),
}))
jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}))

import { DeviceProfileDialog } from '@/components/devices/DeviceProfileDialog'

const wrap = (ui: ReactElement) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>,
  )

const open = (overrides: Partial<Parameters<typeof DeviceProfileDialog>[0]> = {}) =>
  wrap(
    <DeviceProfileDialog
      testId="pd"
      deviceId="ws-1"
      label="Backyard"
      address="1 Main St"
      latitude={null}
      longitude={null}
      open
      onOpenChange={jest.fn()}
      {...overrides}
    />,
  )

describe('DeviceProfileDialog coordinates', () => {
  beforeEach(() => jest.clearAllMocks())

  it('prefills existing coordinates with six decimals', () => {
    open({ latitude: 49.8397, longitude: 24.0297 })
    expect(screen.getByTestId('pd-latitude-input')).toHaveValue('49.839700')
    expect(screen.getByTestId('pd-longitude-input')).toHaveValue('24.029700')
  })

  it('splits a pasted "lat, lng" pair across both fields', async () => {
    const user = userEvent.setup()
    open()
    await user.click(screen.getByTestId('pd-latitude-input'))
    await user.paste('49.8397, 24.0297')
    expect(screen.getByTestId('pd-latitude-input')).toHaveValue('49.8397')
    expect(screen.getByTestId('pd-longitude-input')).toHaveValue('24.0297')
  })

  it('sends the coordinates as strings and surfaces a field error', async () => {
    update.mockResolvedValue({
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Check the highlighted fields',
      fieldErrors: { latitude: 'latitude must be between -90 and 90' },
    })
    const user = userEvent.setup()
    open()
    await user.type(screen.getByTestId('pd-latitude-input'), '91')
    await user.type(screen.getByTestId('pd-longitude-input'), '24')
    await user.click(screen.getByTestId('pd-save'))
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        deviceId: 'ws-1',
        label: 'Backyard',
        address: '1 Main St',
        latitude: '91',
        longitude: '24',
      }),
    )
    expect(await screen.findByTestId('pd-latitude-error')).toHaveTextContent(
      'between -90 and 90',
    )
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
yarn workspace @ws/web test:unit -- tests/unit/components/devices/DeviceProfileDialog.test.tsx
```

Expected: FAIL — `pd-latitude-input` does not exist.

- [ ] **Step 3: Add the props and state**

In `apps/web/src/components/devices/DeviceProfileDialog.tsx`, extend the props interface:

```ts
interface DeviceProfileDialogProps {
  testId: string
  deviceId: string
  label: string | null
  address: string | null
  latitude: number | null
  longitude: number | null
  open: boolean
  onOpenChange: (o: boolean) => void
}
```

Destructure `latitude`/`longitude` alongside the existing props, and add state below `addressValue`:

```ts
  const [latValue, setLatValue] = useState(
    latitude === null ? '' : formatCoordinate(latitude),
  )
  const [lngValue, setLngValue] = useState(
    longitude === null ? '' : formatCoordinate(longitude),
  )
```

Add the imports:

```ts
import { formatCoordinate, parseCoordinateInput } from '@/lib/coordinates'
```

- [ ] **Step 4: Add the change handlers**

```ts
  // Pasting "49.8397, 24.0297" into latitude fills both fields (see lib/coordinates).
  const onLatitude = useCallback((e: FormEvent<HTMLInputElement>) => {
    const parsed = parseCoordinateInput(e.currentTarget.value)
    setLatValue(parsed.latitude)
    if (parsed.longitude !== undefined) setLngValue(parsed.longitude)
  }, [])
  const onLongitude = useCallback(
    (e: FormEvent<HTMLInputElement>) => setLngValue(e.currentTarget.value),
    [],
  )
```

- [ ] **Step 5: Send them on submit**

Replace the `save.mutateAsync` call from Task 3's placeholder with:

```ts
        await save.mutateAsync({
          label: labelValue,
          address: addressValue,
          latitude: latValue,
          longitude: lngValue,
        })
```

and add `latValue, lngValue` to that `useCallback`'s dependency array.

- [ ] **Step 6: Render the fields**

Insert after the address `<Field>` and before the submit row:

```tsx
        <div className="grid grid-cols-2 gap-3">
          <Field
            testId={`${testId}-latitude`}
            label="Latitude"
            htmlFor="device-latitude"
            error={errors.latitude}
            hint="From your phone's GPS — paste both numbers here"
          >
            <Input
              testId={`${testId}-latitude-input`}
              id="device-latitude"
              value={latValue}
              onChange={onLatitude}
              inputMode="decimal"
              placeholder="49.839700"
              mono
              invalid={!!errors.latitude}
            />
          </Field>
          <Field
            testId={`${testId}-longitude`}
            label="Longitude"
            htmlFor="device-longitude"
            error={errors.longitude}
            hint="Leave both empty to hide the station from the map"
          >
            <Input
              testId={`${testId}-longitude-input`}
              id="device-longitude"
              value={lngValue}
              onChange={onLongitude}
              inputMode="decimal"
              placeholder="24.029700"
              mono
              invalid={!!errors.longitude}
            />
          </Field>
        </div>
```

Also update the dialog's `description` prop to mention the map:

```tsx
      description="A nickname shows instead of the id everywhere. Coordinates put the station on the map on your devices page."
```

- [ ] **Step 7: Pass the new props from the caller**

In `apps/web/src/components/devices/DeviceDetail.tsx`, extend the `<DeviceProfileDialog …>` usage:

```tsx
          latitude={link.device?.latitude ?? null}
          longitude={link.device?.longitude ?? null}
```

- [ ] **Step 8: Run the tests**

```bash
yarn workspace @ws/web test:unit
yarn check-types
```

Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
yarn format
git add apps/web
git commit -m "feat(devices): latitude/longitude fields in the station details dialog"
```

---

### Task 5: The map component

**Files:**

- Create: `apps/web/src/components/map/stationPins.ts`
- Create: `apps/web/src/components/map/StationMap.tsx`
- Create: `apps/web/tests/stubs/react-leaflet.tsx`
- Modify: `apps/web/jest.config.mjs` (map the stub)
- Modify: `apps/web/package.json` (dependencies)
- Test: `apps/web/tests/unit/components/map/stationPins.test.ts`, `apps/web/tests/unit/components/map/StationMap.test.tsx`

**Interfaces:**

- Consumes: `MyDevice` with coordinates (Task 3), `deviceDisplayName(d: MyDevice): string` from `@/services/devices/devices.service`.
- Produces:
  - `interface StationPin { deviceId: string; name: string; latitude: number; longitude: number }`
  - `stationPins(devices: MyDevice[]): StationPin[]`
  - `StationMap({ pins, testId }: { pins: StationPin[]; testId: string }): ReactElement`

- [ ] **Step 1: Install the dependencies**

```bash
yarn workspace @ws/web add leaflet@1.9.4 react-leaflet@5.0.0
yarn workspace @ws/web add -D @types/leaflet
```

`react-leaflet@5` declares `react@^19` as a peer — matching this repo. Confirm nothing else moved:

```bash
git diff --stat yarn.lock apps/web/package.json
```

- [ ] **Step 2: Write the failing selector test**

Create `apps/web/tests/unit/components/map/stationPins.test.ts`:

```ts
import type { MyDevice } from '@/services/devices/devices.service'
import { stationPins } from '@/components/map/stationPins'

const device = (
  deviceId: string,
  label: string | null,
  latitude: number | null,
  longitude: number | null,
): MyDevice => ({
  deviceId,
  role: 'owner',
  addedAt: '2026-08-01T00:00:00Z',
  device: {
    status: 'registered',
    createdAt: '2026-08-01T00:00:00Z',
    label,
    address: null,
    latitude,
    longitude,
  },
})

describe('stationPins', () => {
  it('keeps only located stations and names them like the rest of the UI', () => {
    expect(
      stationPins([
        device('ws-1', 'Backyard', 49.8397, 24.0297),
        device('ws-2', null, null, null),
        device('ws-3', null, 51.5, -0.12),
      ]),
    ).toEqual([
      { deviceId: 'ws-1', name: 'Backyard', latitude: 49.8397, longitude: 24.0297 },
      { deviceId: 'ws-3', name: 'ws-3', latitude: 51.5, longitude: -0.12 },
    ])
  })

  it('drops a station whose device row is not readable', () => {
    const orphan: MyDevice = {
      deviceId: 'ws-4',
      role: 'viewer',
      addedAt: '2026-08-01T00:00:00Z',
      device: null,
    }
    expect(stationPins([orphan])).toEqual([])
  })
})
```

- [ ] **Step 3: Run and watch it fail**

```bash
yarn workspace @ws/web test:unit -- tests/unit/components/map/stationPins.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement the selector**

Create `apps/web/src/components/map/stationPins.ts`:

```ts
import type { MyDevice } from '@/services/devices/devices.service'
import { deviceDisplayName } from '@/services/devices/devices.service'

export interface StationPin {
  deviceId: string
  name: string
  latitude: number
  longitude: number
}

/**
 * Located stations only. Coordinates are both-or-neither in the database, so a
 * single null check per axis is belt and braces for rows fetched before the
 * constraint existed.
 */
export const stationPins = (devices: MyDevice[]): StationPin[] =>
  devices.flatMap((d) => {
    const { latitude, longitude } = d.device ?? {}
    if (latitude === null || latitude === undefined) return []
    if (longitude === null || longitude === undefined) return []
    return [
      {
        deviceId: d.deviceId,
        name: deviceDisplayName(d),
        latitude,
        longitude,
      },
    ]
  })
```

- [ ] **Step 5: Run the selector test**

```bash
yarn workspace @ws/web test:unit -- tests/unit/components/map/stationPins.test.ts
```

Expected: PASS.

- [ ] **Step 6: Write the react-leaflet stub**

jsdom has no layout engine, so Leaflet cannot render. Create `apps/web/tests/stubs/react-leaflet.tsx`:

```tsx
/* Test stub for `react-leaflet`: renders plain elements so marker/popup
   content can be asserted without Leaflet touching the DOM or `window`. */
import type { ReactElement, ReactNode } from 'react'

export const MapContainer = ({
  children,
}: {
  children?: ReactNode
}): ReactElement => <div data-testid="map-container">{children}</div>

export const TileLayer = ({
  attribution,
  url,
}: {
  attribution: string
  url: string
}): ReactElement => (
  <div data-testid="tile-layer" data-attribution={attribution} data-url={url} />
)

export const Marker = ({
  children,
  position,
}: {
  children?: ReactNode
  position: [number, number]
}): ReactElement => (
  <div data-testid="marker" data-position={position.join(',')}>
    {children}
  </div>
)

export const Popup = ({ children }: { children?: ReactNode }): ReactElement => (
  <div data-testid="popup">{children}</div>
)

export const useMap = () => ({
  fitBounds: () => undefined,
  setView: () => undefined,
})
```

- [ ] **Step 7: Register the stub**

In `apps/web/jest.config.mjs`, add two entries to `moduleNameMapper` (inside `tsProject`):

```js
    '^react-leaflet$': '<rootDir>/tests/stubs/react-leaflet.tsx',
    '^leaflet$': '<rootDir>/tests/stubs/leaflet.ts',
```

and create `apps/web/tests/stubs/leaflet.ts`:

```ts
/* Test stub for `leaflet`: only the pieces StationMap touches. */
export const divIcon = (options: unknown): unknown => options
export const latLngBounds = (
  coords: [number, number][],
): { isValid: () => boolean } => ({ isValid: () => coords.length > 0 })
```

- [ ] **Step 8: Write the failing map test**

Create `apps/web/tests/unit/components/map/StationMap.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'

import { StationMap } from '@/components/map/StationMap'
import type { StationPin } from '@/components/map/stationPins'

const pins: StationPin[] = [
  { deviceId: 'ws-1', name: 'Backyard', latitude: 49.8397, longitude: 24.0297 },
  { deviceId: 'ws-2', name: 'Rooftop', latitude: 51.5, longitude: -0.12 },
]

describe('StationMap', () => {
  it('renders one marker per pin, with a link to the station', () => {
    render(<StationMap testId="map" pins={pins} />)
    expect(screen.getAllByTestId('marker')).toHaveLength(2)
    expect(screen.getByText('Backyard')).toBeInTheDocument()
    expect(screen.getByTestId('map-popup-ws-2-link')).toHaveAttribute(
      'href',
      '/devices/ws-2',
    )
  })

  it('always shows the OpenStreetMap attribution (tile policy)', () => {
    render(<StationMap testId="map" pins={pins} />)
    expect(screen.getByTestId('tile-layer')).toHaveAttribute(
      'data-attribution',
      expect.stringContaining('OpenStreetMap') as unknown as string,
    )
  })
})
```

- [ ] **Step 9: Run and watch it fail**

```bash
yarn workspace @ws/web test:unit -- tests/unit/components/map/StationMap.test.tsx
```

Expected: FAIL — `@/components/map/StationMap` not found.

- [ ] **Step 10: Implement the map**

Create `apps/web/src/components/map/StationMap.tsx`:

```tsx
'use client'

import { divIcon } from 'leaflet'
import Link from 'next/link'
import type { ReactElement } from 'react'
import { useMemo } from 'react'
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'

import type { StationPin } from './stationPins'

import 'leaflet/dist/leaflet.css'

// Required by the OSM tile usage policy and must stay visible.
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const SINGLE_PIN_ZOOM = 15
const MAX_FIT_ZOOM = 16

/**
 * Leaflet's default marker icon resolves its images by URL and breaks under
 * bundlers; a divIcon carries our own markup instead — and matches the
 * dashboard's language.
 */
const pinIcon = (name: string) =>
  divIcon({
    className: '',
    html: `<span class="ws-pin"><span class="ws-pin-dot"></span><span class="ws-pin-label">${name.replace(/[<>&"]/g, '')}</span></span>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  })

export const StationMap = ({
  pins,
  testId,
}: {
  pins: StationPin[]
  testId: string
}): ReactElement => {
  const center = useMemo<[number, number]>(
    () => [pins[0]?.latitude ?? 0, pins[0]?.longitude ?? 0],
    [pins],
  )
  const bounds = useMemo<[number, number][]>(
    () => pins.map((p) => [p.latitude, p.longitude]),
    [pins],
  )

  return (
    <div
      data-testid={testId}
      className="rounded-card border-line h-80 w-full overflow-hidden border"
    >
      <MapContainer
        center={center}
        zoom={SINGLE_PIN_ZOOM}
        bounds={pins.length > 1 ? bounds : undefined}
        boundsOptions={{ padding: [40, 40], maxZoom: MAX_FIT_ZOOM }}
        // A map that eats page scroll on a trackpad is a usability bug;
        // dragging and the +/- controls still zoom.
        scrollWheelZoom={false}
        className="size-full"
      >
        <TileLayer attribution={ATTRIBUTION} url={TILE_URL} />
        {pins.map((p) => (
          <Marker
            key={p.deviceId}
            position={[p.latitude, p.longitude]}
            icon={pinIcon(p.name)}
          >
            <Popup>
              <span className="flex flex-col gap-1">
                <b>{p.name}</b>
                <span className="font-mono text-[11px]">{p.deviceId}</span>
                <Link
                  data-testid={`${testId}-popup-${p.deviceId}-link`}
                  href={`/devices/${p.deviceId}`}
                  className="underline underline-offset-2"
                >
                  Open station
                </Link>
              </span>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}
```

- [ ] **Step 11: Style the marker and dark mode**

Append to `apps/web/src/app/globals.css`:

```css
/* Station map (Leaflet). The tiles are raster and light-only, so dark mode
   filters the tile pane; markers keep their own colours. */
.ws-pin {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.ws-pin-dot {
  width: 12px;
  height: 12px;
  border-radius: 9999px;
  background: var(--color-sky);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-sky) 30%, transparent);
}
.ws-pin-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-ink);
  text-shadow:
    0 1px 2px var(--color-paper),
    0 -1px 2px var(--color-paper);
}
.dark .leaflet-tile-pane {
  filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9);
}
.leaflet-container {
  background: var(--color-paper-2, var(--color-paper));
}
```

- [ ] **Step 12: Run the map test**

```bash
yarn workspace @ws/web test:unit -- tests/unit/components/map
```

Expected: PASS (4 tests).

- [ ] **Step 13: Commit**

```bash
yarn format
git add apps/web yarn.lock
git commit -m "feat(map): Leaflet station map component with OSM tiles"
```

---

### Task 6: Show the map on /devices

**Files:**

- Create: `apps/web/src/components/map/StationMapCard.tsx`
- Modify: `apps/web/src/components/devices/DevicesIndex.tsx`
- Test: `apps/web/tests/unit/components/devices/DevicesIndex.test.tsx` (create)

**Interfaces:**

- Consumes: `stationPins`, `StationMap` (Task 5), `useMyDevicesQuery` from `@/services/devices/devices.queries`.
- Produces: `StationMapCard({ devices, testId }: { devices: MyDevice[]; testId: string }): ReactElement | null` — renders nothing when no station has coordinates.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/components/devices/DevicesIndex.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'

import type { MyDevice } from '@/services/devices/devices.service'

const devices: { data: MyDevice[] | undefined; isLoading: boolean } = {
  data: [],
  isLoading: false,
}
jest.mock('@clerk/nextjs', () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: true }),
}))
jest.mock('@/services/devices/devices.queries', () => ({
  useMyDevicesQuery: () => devices,
}))
// next/dynamic would defer the map past the assertion; render it directly.
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: (loader: () => Promise<{ StationMap: unknown }>) => {
    const { StationMap } = jest.requireActual<{
      StationMap: unknown
    }>('@/components/map/StationMap')
    void loader
    return StationMap
  },
}))

import { DevicesIndex } from '@/components/devices/DevicesIndex'

const device = (
  deviceId: string,
  latitude: number | null,
  longitude: number | null,
  role: 'owner' | 'viewer' = 'owner',
): MyDevice => ({
  deviceId,
  role,
  addedAt: '2026-08-01T00:00:00Z',
  device: {
    status: 'registered',
    createdAt: '2026-08-01T00:00:00Z',
    label: null,
    address: null,
    latitude,
    longitude,
  },
})

describe('DevicesIndex map card', () => {
  it('shows no map and hints owners when no station has coordinates', () => {
    devices.data = [device('ws-1', null, null)]
    render(<DevicesIndex testId="devices" />)
    expect(screen.queryByTestId('devices-map')).not.toBeInTheDocument()
    expect(screen.getByTestId('devices-hint-ws-1')).toHaveTextContent(
      'Add coordinates',
    )
  })

  it('shows the map when at least one station is located, and hints only the unlocated ones', () => {
    devices.data = [device('ws-1', 49.8397, 24.0297), device('ws-2', null, null)]
    render(<DevicesIndex testId="devices" />)
    expect(screen.getByTestId('devices-map')).toBeInTheDocument()
    expect(screen.queryByTestId('devices-hint-ws-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('devices-hint-ws-2')).toBeInTheDocument()
  })

  it('does not hint a viewer who cannot edit the station', () => {
    devices.data = [device('ws-3', null, null, 'viewer')]
    render(<DevicesIndex testId="devices" />)
    expect(screen.queryByTestId('devices-hint-ws-3')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
yarn workspace @ws/web test:unit -- tests/unit/components/devices/DevicesIndex.test.tsx
```

Expected: FAIL — `devices-map` and `devices-hint-…` do not exist.

- [ ] **Step 3: Write the card**

Create `apps/web/src/components/map/StationMapCard.tsx`:

```tsx
'use client'

import dynamic from 'next/dynamic'
import type { ReactElement } from 'react'
import { useMemo } from 'react'

import { stationPins } from './stationPins'

import { Card, CardBody } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import type { MyDevice } from '@/services/devices/devices.service'

// Leaflet touches `window` at import time, so the map must never render on the
// server; the dynamic import also keeps ~43 KB gzipped off every other route.
const StationMap = dynamic(
  () => import('./StationMap').then((m) => m.StationMap),
  {
    ssr: false,
    loading: () => <Skeleton testId="station-map-skeleton" className="h-80" />,
  },
)

export const StationMapCard = ({
  devices,
  testId,
}: {
  devices: MyDevice[]
  testId: string
}): ReactElement | null => {
  const pins = useMemo(() => stationPins(devices), [devices])
  if (pins.length === 0) return null
  return (
    <Card testId={testId}>
      <CardBody testId={`${testId}-body`} className="pt-4">
        <StationMap testId={`${testId}-map`} pins={pins} />
      </CardBody>
    </Card>
  )
}
```

- [ ] **Step 4: Render it from the index**

In `apps/web/src/components/devices/DevicesIndex.tsx`, add the imports:

```ts
import { StationMapCard } from '@/components/map/StationMapCard'
```

Replace the returned list wrapper so the card sits above the stations:

```tsx
  return (
    <div data-testid={testId} className="flex flex-col gap-3">
      <StationMapCard testId={`${testId}-map`} devices={data} />
      {data.map((d) => (
```

- [ ] **Step 5: Add the per-row hint**

Inside the mapped card body, after the station name/id block, add:

```tsx
              {d.role === 'owner' &&
              (d.device?.latitude === null || d.device?.latitude === undefined) ? (
                <span
                  data-testid={`${testId}-hint-${d.deviceId}`}
                  className="text-slate text-[12px]"
                >
                  Add coordinates in station details to see it on the map
                </span>
              ) : null}
```

- [ ] **Step 6: Run the tests**

```bash
yarn workspace @ws/web test:unit
yarn check-types
yarn lint
```

Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
yarn format
git add apps/web
git commit -m "feat(devices): station map card on the devices page"
```

---

### Task 7: Documentation, verification, and the full gate

**Files:**

- Modify: `docs/privacy-data-minimisation.md`
- Modify: `apps/web/src/components/legal/PrivacyPolicy.tsx`
- Modify: `CLAUDE.md`
- Create: `docs/superpowers/verification/2026-08-16-station-map.md`

**Interfaces:**

- Consumes: everything from Tasks 1–6.
- Produces: no code interfaces.

- [ ] **Step 1: Add the privacy row**

In `docs/privacy-data-minimisation.md`, add to the table after the `devices | label, address` row:

```markdown
| `devices` | `latitude`, `longitude` | Draw the owner's own stations on a map | Until the owner clears them or the device is re-provisioned | Optional, user-entered, never geocoded or sent to a third party |
```

- [ ] **Step 2: Disclose the tile requests**

In `apps/web/src/components/legal/PrivacyPolicy.tsx`, add a sentence to the section that covers what leaves the app (the section mentioning third parties):

```tsx
        Station coordinates are optional and typed in by the owner; they are
        never sent to a geocoding service. Displaying the map does mean your
        browser requests map tiles from OpenStreetMap, which reveals the map
        area you are viewing to them — never a station, an account, or a
        reading.
```

- [ ] **Step 3: Note the convention in CLAUDE.md**

Under the "Architecture — Two Data Paths" section's client-path table, add one row so the next person does not add a second map query:

```markdown
| Station map (`/devices`)                   | reads the same `deviceKeys.mine` cache — no extra query |
```

- [ ] **Step 4: Run the whole gate**

From the repo root:

```bash
yarn format && yarn lint && yarn check-types && yarn test:unit
yarn workspace @ws/web test:integration:secrets
cd infra/supabase-db && yarn db-reset:local && yarn test:db && cd ../..
infisical run -- yarn build
```

Expected: every step green; the build output lists `/devices` as a route.

- [ ] **Step 5: Verify in a real browser**

Start the dev server (`infisical run -- yarn workspace @ws/web dev -p 3001`) and, with two seeded stations, check each of these on `/devices`:

1. A station without coordinates shows the hint and no marker.
2. Adding coordinates through "Edit details" makes the marker appear without a page reload (the mutation invalidates `deviceKeys.mine`).
3. Pasting `49.8397, 24.0297` into the latitude field fills both fields.
4. Entering `91` for latitude shows the inline range error and saves nothing.
5. The `© OpenStreetMap contributors` attribution is visible on the map.
6. The marker popup's "Open station" link navigates to that station.
7. Dark mode: tiles and markers are legible.
8. Mobile width (~390 px): the map fits and does not overflow horizontally.
9. The browser console shows no errors, and the Network tab shows tile requests only for the visible area.

Write the results to `docs/superpowers/verification/2026-08-16-station-map.md` as a table of check → result, including anything that failed and how it was fixed.

- [ ] **Step 6: Commit**

```bash
yarn format
git add docs apps CLAUDE.md
git commit -m "docs: station map privacy rows and verification notes"
```

- [ ] **Step 7: Finish the branch**

**REQUIRED SUB-SKILL:** Use `superpowers:finishing-a-development-branch` — run the full suite on the merge target, then present the merge/PR/keep menu and wait for the decision.

---

## Self-Review

**Spec coverage**

| Spec section                     | Task                                                        |
| -------------------------------- | ----------------------------------------------------------- |
| §3 Data model                    | Task 1                                                      |
| §4 Write path + paste affordance | Task 3 (schema/action), Task 2 + Task 4 (paste)             |
| §5 Read path + `stationPins`     | Task 3 (select/type), Task 5 (selector)                     |
| §6 Map component                 | Task 5                                                      |
| §7 Placement and empty states    | Task 6                                                      |
| §8 Bundle cost                   | Task 6 (`next/dynamic`, `ssr: false`)                       |
| §9 Out of scope                  | No task — deliberately absent                               |
| §10 Privacy                      | Task 7 steps 1–2                                            |
| §11 Testing                      | Tasks 1–6 each carry their tests; Task 7 step 4 is the gate |
| §12 Risks                        | Task 7 step 5 (Referer/console/network checks), Task 4 (range errors) |

**Placeholders:** none — every step carries the literal SQL, TypeScript, or command to run.

**Type consistency:** `StationPin` is defined once (Task 5) and consumed by `StationMap` and `StationMapCard` with the same field names; `MyDevice.device.latitude/longitude` is declared in Task 3 and used identically in Tasks 4, 5, and 6; `updateDeviceProfileAction` takes coordinates as **strings** everywhere (Tasks 3, 4) and returns them as `number | null`; `parseCoordinateInput` returns `{ latitude, longitude? }` in both its definition (Task 2) and its use (Task 4).
