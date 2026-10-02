import 'server-only'

import { ownApiKeyProvider } from './own-provider'
import type { ApiKeyProvider } from './provider'

/**
 * The single switch point between API-key implementations (spec §5.1, §11).
 * Routes, withApiKey and the actions call this; none of them may import a
 * provider module directly (tests/unit/app/api/v1/stations/registry.test.ts).
 */
export const getApiKeyProvider = (): ApiKeyProvider => ownApiKeyProvider
