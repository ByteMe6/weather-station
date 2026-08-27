// PRD T1: /start greets and explains registration.
import type { Reply } from '../reply.ts'

export const startReply = (): Reply => ({
  text: [
    'Hi! I am the Weather Station bot. 🌤',
    '',
    'I report live readings from your weather station and send scheduled alerts.',
    'To connect a station, send /register <device-id> — the id is printed on',
    'the device label. Then /current shows the latest readings and /menu has',
    'everything else.',
  ].join('\n'),
})
