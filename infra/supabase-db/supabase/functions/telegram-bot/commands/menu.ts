// PRD T2: /menu inline navigation. Builders only — grammY glue is in index.ts.
import type { Reply } from '../reply.ts'

export const backRow = (): { text: string; data: string }[] => [
  { text: '⬅️ Back', data: 'menu:root' },
]

export const mainMenu = (): Reply => ({
  text: 'What would you like to do?',
  buttons: [
    [
      { text: '🌡 Current', data: 'menu:current' },
      { text: '⏰ Alerts', data: 'menu:alerts' },
    ],
    [
      { text: '🔗 Register Device', data: 'register:start' },
      { text: 'ℹ️ About', data: 'menu:about' },
    ],
  ],
})

export const aboutReply = (): Reply => ({
  text:
    'Hyperlocal weather monitoring: an ESP32 station measures temperature, ' +
    'humidity, pressure (and, soon, wind and rain) every 5 minutes. This bot ' +
    'shows live readings and sends scheduled alerts. There is a web ' +
    'dashboard too — link your account there to manage everything in one place.',
  buttons: [backRow()],
})

export const unknownReply = (): Reply => ({
  text: 'I did not understand that. Try /menu to see what I can do.',
})
