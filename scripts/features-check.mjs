// Two isolated browsers exercise sections, subpages, tasks with priority and
// due date, the Tasks view, page links with backlinks, and boards.
// Usage: node scripts/features-check.mjs [http://127.0.0.1:5173]
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const url = process.argv[2] || 'http://127.0.0.1:5173/'
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const problems = []
const profiles = []
const passed = []

async function openBrowser(label) {
  const dir = mkdtempSync(join(tmpdir(), 'folio-features-'))
  profiles.push(dir)
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: dir })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  page.on('pageerror', (error) => problems.push(`${label} error: ${error.message}`))
  return { browser, page }
}

async function step(name, run) {
  try {
    await run()
    passed.push(name)
  } catch (error) {
    problems.push(`${name}: ${error.message.split('\n')[0]}`)
    throw error
  }
}

const clickText = (page, selector, text) =>
  page.evaluate(
    (sel, needle) => {
      const match = [...document.querySelectorAll(sel)].find((el) => el.textContent.includes(needle))
      if (!match) return false
      match.click()
      return true
    },
    selector,
    text,
  )

async function setTitle(page, title) {
  await page.click('.page-title')
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Control')
  await page.keyboard.type(title)
}

const a = await openBrowser('A')
let b = null

try {
  await step('create space', async () => {
    await a.page.goto(url, { waitUntil: 'networkidle0' })
    await a.page.type('input[placeholder="Project notes"]', 'Feature team')
    await a.page.click('button.primary')
    await a.page.waitForFunction(() => document.body.innerText.includes('Invite a teammate'), { timeout: 20000 })
  })

  await step('welcome tasks show priority and due chips', async () => {
    await a.page.waitForSelector('.task-meta .chip.prio-high', { timeout: 5000 })
    await a.page.waitForSelector('.task-meta .chip.due-today', { timeout: 5000 })
  })

  await step('sidebar counts due tasks', async () => {
    await a.page.waitForFunction(() => Number(document.querySelector('.due-badge')?.textContent) >= 1, { timeout: 8000 })
  })

  await step('section with a subpage', async () => {
    await a.page.click('.side-actions .secondary')
    if (!(await clickText(a.page, '.new-menu button', 'Section'))) throw new Error('no Section option')
    await a.page.waitForFunction(() => document.querySelector('.page-title')?.value === 'New section')
    await setTitle(a.page, 'Development')
    await clickText(a.page, '.subpage-add button', 'Subpage')
    await a.page.waitForFunction(() => document.querySelector('.crumbs')?.innerText.includes('Development'))
    await setTitle(a.page, 'Bugs')
    await a.page.waitForSelector('.page-body')
  })

  await step('task with urgent priority and a date, then text after it', async () => {
    await a.page.click('.page-body')
    await a.page.keyboard.type('/todo')
    await a.page.waitForSelector('.slash-menu')
    await a.page.keyboard.press('Enter')
    await a.page.keyboard.type('Crash on login')
    await a.page.waitForSelector('ul[data-type="taskList"] li .task-edit')
    await a.page.hover('ul[data-type="taskList"] li')
    await a.page.click('ul[data-type="taskList"] li .task-edit')
    await a.page.waitForSelector('.task-pop')
    await a.page.click('.task-pop .chip.prio-urgent')
    await clickText(a.page, '.task-pop .chip', 'Tomorrow')
    await a.page.keyboard.press('Escape')
    await a.page.waitForSelector('ul[data-type="taskList"] li .chip.prio-urgent')
    await a.page.waitForFunction(() => document.querySelector('ul[data-type="taskList"] li .task-meta')?.innerText.includes('Tomorrow'))
    await a.page.click('ul[data-type="taskList"] li > div p')
    await a.page.keyboard.press('End')
    await a.page.keyboard.press('Enter')
    await a.page.keyboard.press('Enter')
    await a.page.keyboard.type('Regular text after the list. See ')
  })

  await step('[[ links a page', async () => {
    await a.page.keyboard.type('[[Welc')
    await a.page.waitForFunction(() => document.querySelector('.slash-menu')?.innerText.includes('Welcome'))
    await a.page.keyboard.press('Enter')
    await a.page.waitForSelector('.page-body .page-mention')
    const paragraph = await a.page.$eval('.page-body', (el) => el.innerText)
    if (!paragraph.includes('Regular text after the list')) throw new Error('text after the task list missing')
  })

  await step('link opens the page and it shows a backlink', async () => {
    await wait(900)
    await a.page.click('.page-body .page-mention')
    await a.page.waitForFunction(() => document.querySelector('.page-title')?.value === 'Welcome')
    await a.page.waitForFunction(() => document.querySelector('.backlinks')?.innerText.includes('Bugs'), { timeout: 8000 })
  })

  await step('Tasks view lists the task with its priority', async () => {
    await a.page.click('.nav-tasks')
    await a.page.waitForFunction(
      () =>
        [...document.querySelectorAll('.task-row')].some(
          (row) => row.innerText.includes('Crash on login') && row.innerText.includes('Urgent') && row.innerText.includes('Development › Bugs'),
        ),
      { timeout: 8000 },
    )
  })

  await step('board with cards and arrows', async () => {
    await a.page.click('.side-actions .secondary')
    await clickText(a.page, '.new-menu button', 'Board')
    await a.page.waitForFunction(() => document.querySelectorAll('.board-card').length === 3, { timeout: 15000 })
    await a.page.waitForFunction(() => document.querySelectorAll('.react-flow__edge').length === 2)
    const pane = await a.page.$eval('.react-flow__pane', (el) => {
      const box = el.getBoundingClientRect()
      return { x: box.left + 40, y: box.top + 40 }
    })
    await a.page.mouse.click(pane.x, pane.y, { count: 2 })
    await a.page.waitForFunction(() => document.querySelectorAll('.board-card').length === 4)
  })

  const link = await (async () => {
    await a.page.click('.topbar button.primary')
    const value = await a.page.$eval('.share-pop textarea', (el) => el.value)
    await a.page.click('.share-pop .text-button')
    return value
  })()
  await wait(1500)
  await a.page.screenshot({ path: join(tmpdir(), 'folio-features-board.png') })

  b = await openBrowser('B')
  await step('teammate sees the sections, tasks, and board', async () => {
    await b.page.goto(link, { waitUntil: 'domcontentloaded' })
    await b.page.waitForFunction(() => document.querySelector('.page-tree')?.innerText.includes('Development'), { timeout: 30000 })
    await clickText(b.page, '.page-link', 'Board')
    await b.page.waitForFunction(() => document.querySelectorAll('.board-card').length === 4, { timeout: 20000 })
    await b.page.click('.nav-tasks')
    await b.page.waitForFunction(
      () => [...document.querySelectorAll('.task-row')].some((row) => row.innerText.includes('Crash on login')),
      { timeout: 15000 },
    )
  })

  await step('ticking a task in Tasks view updates the page for both', async () => {
    await b.page.evaluate(() => {
      const row = [...document.querySelectorAll('.task-row')].find((el) => el.innerText.includes('Crash on login'))
      row.querySelector('input[type="checkbox"]').click()
    })
    await clickText(a.page, '.page-link', 'Bugs')
    await a.page.waitForFunction(
      () =>
        [...document.querySelectorAll('ul[data-type="taskList"] li')].some(
          (li) => li.dataset.checked === 'true' && li.innerText.includes('Crash on login'),
        ),
      { timeout: 15000 },
    )
  })

  await a.page.click('.nav-tasks')
  await a.page.click('.tasks-done-toggle input')
  await wait(500)
  await a.page.screenshot({ path: join(tmpdir(), 'folio-features-tasks.png') })
  await clickText(a.page, '.page-link', 'Welcome')
  await wait(800)
  await a.page.screenshot({ path: join(tmpdir(), 'folio-features-welcome.png') })
} catch {
  // The failing step is already recorded.
}

await a.browser.close()
if (b) await b.browser.close()
for (const dir of profiles) rmSync(dir, { recursive: true, force: true })

console.log(JSON.stringify({ passed, problems }, null, 2))
if (problems.length) process.exit(1)
