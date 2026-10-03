// Two isolated browsers create, join, and co-edit a space, then verify the
// privacy properties: no WebRTC, no third-party requests, no key left in the
// address bar, and no plaintext on the server.
// Usage: node scripts/ui-check.mjs [http://127.0.0.1:5173] [path/to/rooms.json]
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const roomsFile = process.argv[3] || 'server/data/rooms.json'
const origin = new URL(url).origin
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const problems = []
const profiles = []

async function openBrowser(label) {
  const dir = mkdtempSync(join(tmpdir(), 'folio-check-'))
  profiles.push(dir)
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: dir })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  await page.evaluateOnNewDocument(() => {
    window.__rtc = 0
    const Original = window.RTCPeerConnection
    window.RTCPeerConnection = function (...args) {
      window.__rtc += 1
      return new Original(...args)
    }
  })
  page.on('request', (request) => {
    const target = request.url()
    if (!target.startsWith(origin) && !target.startsWith('data:') && !target.startsWith('blob:')) {
      problems.push(`${label} contacted ${target}`)
    }
  })
  page.on('pageerror', (error) => problems.push(`${label} error: ${error.message}`))
  return { browser, page }
}

const a = await openBrowser('A')
await a.page.goto(url, { waitUntil: 'networkidle0' })
await a.page.type('input[placeholder="Project notes"]', 'Launch team')
await a.page.click('button.primary')
await a.page.waitForFunction(() => document.body.innerText.includes('Invite a teammate'), { timeout: 15000 })
await a.page.waitForFunction(() => document.body.innerText.includes('Synced through blind relay'), { timeout: 10000 })

await a.page.click('.page-body')
await a.page.keyboard.type('Secret roadmap alpha-77')
await a.page.click('.topbar button.primary')
const link = await a.page.$eval('.share-pop textarea', (el) => el.value)
if (!/#v=[0-9a-f-]{36}&k=[A-Za-z0-9_-]{40,}/.test(link)) throw new Error(`bad invite: ${link}`)
await a.page.click('.share-pop .text-button')
const aliasA = await a.page.$eval('input[aria-label="Your alias"]', (el) => el.value)
await wait(1000)

const b = await openBrowser('B')
await b.page.goto(link, { waitUntil: 'domcontentloaded' })
await b.page.waitForFunction(() => document.body.innerText.includes('Secret roadmap alpha-77'), { timeout: 20000 })
const addressBar = b.page.url()
if (addressBar.includes('&k=') || addressBar.includes('k=')) problems.push(`key left in address bar: ${addressBar}`)
const aliasB = await b.page.$eval('input[aria-label="Your alias"]', (el) => el.value)
if (!aliasA || !aliasB) problems.push('missing random alias')

await b.page.click('.page-title')
await b.page.keyboard.down('Control')
await b.page.keyboard.press('KeyA')
await b.page.keyboard.up('Control')
await b.page.keyboard.type('Shared brief')
await b.page.click('.page-body')
await b.page.keyboard.press('End')
await b.page.keyboard.type(' from B')

await a.page.waitForFunction(() => document.querySelector('.page-title')?.value === 'Shared brief', { timeout: 10000 })
await a.page.waitForFunction(() => document.querySelector('.page-body')?.innerText.includes('from B'), { timeout: 10000 })
await a.page.waitForFunction((name) => document.querySelector('.presence')?.innerText.includes(name), { timeout: 10000 }, aliasB)

await a.page.click('.page-body')
await a.page.keyboard.press('End')
await a.page.keyboard.press('Enter')
await a.page.keyboard.type('/todo')
await a.page.waitForSelector('.slash-menu')
await a.page.keyboard.press('Enter')
await a.page.waitForSelector('ul[data-type="taskList"]')

await wait(1500)
for (const [label, page] of [['A', a.page], ['B', b.page]]) {
  const rtc = await page.evaluate(() => window.__rtc)
  if (rtc) problems.push(`${label} opened ${rtc} WebRTC connection(s)`)
}

const stored = readFileSync(roomsFile, 'utf8')
const vaultId = link.match(/#v=([0-9a-f-]{36})/)[1]
for (const text of ['Secret roadmap', 'Shared brief', 'Invite a teammate', 'Launch team', aliasA, aliasB, vaultId]) {
  if (stored.includes(text)) problems.push(`server stored plaintext: ${text}`)
}

await a.page.screenshot({ path: join(tmpdir(), 'folio-a.png') })
await b.page.screenshot({ path: join(tmpdir(), 'folio-b.png') })
await a.browser.close()
await b.browser.close()
for (const dir of profiles) rmSync(dir, { recursive: true, force: true })

if (problems.length) {
  console.log(problems.join('\n'))
  process.exit(1)
}
console.log(JSON.stringify({
  synced: true,
  aliases: [aliasA, aliasB],
  webrtc: 0,
  thirdPartyRequests: 0,
  keyInAddressBar: false,
  plaintextOnServer: false,
  screenshots: [join(tmpdir(), 'folio-a.png'), join(tmpdir(), 'folio-b.png')],
}, null, 2))
