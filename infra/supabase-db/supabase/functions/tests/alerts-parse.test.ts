import { assertEquals } from '@std/assert'

import {
  bitsToDays,
  daysToBits,
  formatDays,
  parseAlertAdd,
  parseDays,
  parseTime,
} from '../telegram-bot/alerts-parse.ts'

Deno.test('parseTime accepts 24h HH:MM only', () => {
  assertEquals(parseTime('07:30'), '07:30')
  assertEquals(parseTime('7:30'), '07:30')
  assertEquals(parseTime('23:59'), '23:59')
  assertEquals(parseTime('24:00'), null)
  assertEquals(parseTime('07:60'), null)
  assertEquals(parseTime('0730'), null)
})

Deno.test('parseDays handles lists, ranges, case, dedupe', () => {
  assertEquals(parseDays('Mon,Wed,Fri'), [1, 3, 5])
  assertEquals(parseDays('mon-fri'), [1, 2, 3, 4, 5])
  assertEquals(parseDays('Sat,Sun,sat'), [6, 7])
  assertEquals(parseDays('Mon-Wed,Fri'), [1, 2, 3, 5])
  assertEquals(parseDays('Fri-Mon'), null)
  assertEquals(parseDays('Funday'), null)
  assertEquals(parseDays(''), null)
})

Deno.test('parseAlertAdd grammar with optional timezone', () => {
  assertEquals(parseAlertAdd('07:30 Mon-Fri'), {
    time: '07:30',
    days: [1, 2, 3, 4, 5],
  })
  assertEquals(parseAlertAdd('07:30 Mon-Fri Europe/Kyiv'), {
    time: '07:30',
    days: [1, 2, 3, 4, 5],
    timezone: 'Europe/Kyiv',
  })
  assertEquals('error' in parseAlertAdd('25:00 Mon'), true)
  assertEquals('error' in parseAlertAdd('07:30'), true)
  assertEquals('error' in parseAlertAdd('07:30 Mon Not/AZone'), true)
})

Deno.test('bits codec round-trips', () => {
  assertEquals(daysToBits([1, 3, 5]), '1010100')
  assertEquals(bitsToDays('1010100'), [1, 3, 5])
  assertEquals(bitsToDays(daysToBits([7])), [7])
})

Deno.test('formatDays collapses runs of three or more', () => {
  assertEquals(formatDays([1, 2, 3, 4, 5]), 'Mon–Fri')
  assertEquals(formatDays([1, 3, 4, 5]), 'Mon, Wed–Fri')
  assertEquals(formatDays([6, 7]), 'Sat, Sun')
})
