import { test } from 'node:test'
import assert from 'node:assert'
import { currentWindow, parseOfficialPricing } from '../lib/index.js'

// 模拟官方英文定价页的可解析片段（与真实页面同构）
const FIXTURE = `
  deepseek-v4-flash deepseek-v4-pro deepseek-v4-flash-vision-exp
  1M INPUT TOKENS (CACHE HIT) OFF-PEAK $0.007 $0.022 $0.007 PEAK $0.014 $0.044 $0.014
  1M INPUT TOKENS (CACHE MISS) OFF-PEAK $0.22 $0.66 $0.22 PEAK $0.44 $1.32 $0.44
  1M OUTPUT TOKENS OFF-PEAK $0.66 $1.98 $0.66 PEAK $1.32 $3.96 $1.32
  Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday (all other hours are off-peak).
`

test('parseOfficialPricing 解析三个模型的峰谷价', () => {
  const parsed = parseOfficialPricing(FIXTURE)
  assert.ok(parsed)
  assert.deepEqual(parsed.models['deepseek-v4-flash'].peak, { hit: 0.014, miss: 0.44, out: 1.32 })
  assert.deepEqual(parsed.models['deepseek-v4-flash'].offPeak, { hit: 0.007, miss: 0.22, out: 0.66 })
  assert.deepEqual(parsed.models['deepseek-v4-pro'].peak, { hit: 0.044, miss: 1.32, out: 3.96 })
  assert.deepEqual(parsed.models['deepseek-v4-flash-vision-exp'].offPeak, { hit: 0.007, miss: 0.22, out: 0.66 })
  assert.equal(parsed.peakRule.weekdayOnly, true)
  assert.deepEqual(parsed.peakRule.windows, [[1, 4], [6, 10]])
})

test('currentWindow 周末全天谷价', () => {
  const rule = { weekdayOnly: true, windows: [[1, 4], [6, 10]] }
  // 周六 UTC 02:00 落在高峰窗口内，但周末应判谷
  assert.equal(currentWindow(new Date('2026-08-22T02:00:00Z'), rule), 'offPeak')
  // 周日 UTC 07:00 同理
  assert.equal(currentWindow(new Date('2026-08-23T07:00:00Z'), rule), 'offPeak')
})

test('currentWindow 工作日按窗口判峰谷', () => {
  const rule = { weekdayOnly: true, windows: [[1, 4], [6, 10]] }
  assert.equal(currentWindow(new Date('2026-08-24T02:00:00Z'), rule), 'peak') // 周一
  assert.equal(currentWindow(new Date('2026-08-24T05:00:00Z'), rule), 'offPeak') // 周一窗口间隙
  assert.equal(currentWindow(new Date('2026-08-21T07:00:00Z'), rule), 'peak') // 周五
})

test('currentWindow weekdayOnly=false 时周末也按窗口判峰', () => {
  const rule = { weekdayOnly: false, windows: [[1, 4], [6, 10]] }
  assert.equal(currentWindow(new Date('2026-08-22T02:00:00Z'), rule), 'peak')
})
