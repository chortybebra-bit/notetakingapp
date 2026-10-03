// Renders public/icon.svg to the PNG sizes browsers need for "Install app".
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const svg = readFileSync('public/icon.svg', 'utf8')
const browser = await puppeteer.launch({ executablePath: chrome, headless: true })
const page = await browser.newPage()
for (const size of [192, 512]) {
  await page.setViewport({ width: size, height: size })
  await page.setContent(
    `<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`,
  )
  await page.screenshot({ path: `public/icon-${size}.png`, omitBackground: true })
}
await browser.close()
console.log('icons written')
