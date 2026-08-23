import { assertThrows } from '@std/assert'

import { serviceClient } from '../_shared/db.ts'

Deno.test('serviceClient throws a pointed error when env is missing', () => {
  const url = Deno.env.get('SUPABASE_URL')
  Deno.env.delete('SUPABASE_URL')
  try {
    assertThrows(
      () => serviceClient(),
      Error,
      'SUPABASE_URL / SUPABASE_SECRET_KEY are not set',
    )
  } finally {
    if (url !== undefined) Deno.env.set('SUPABASE_URL', url)
  }
})
