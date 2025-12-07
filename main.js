/**
 * Ultra-low-RAM Article Scraper (512MB–1GB VPS)
 * Streams URLs line-by-line instead of storing in memory.
 */

const fs = require('fs')
const readline = require('readline')
const path = require('path')
const puppeteer = require('puppeteer')
const { Readability } = require('@mozilla/readability')
const { JSDOM } = require('jsdom')

const URL_FILE = path.join(__dirname, 'url.list')
const OUTPUT_FILE = 'digital_marketing_corpus.jsonl'
const PROXY_LIST_FILE = path.join(__dirname, 'proxy.list') // Optional proxy file

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * Load proxies from proxy.list file (one per line)
 */
async function loadProxies() {
    if (!fs.existsSync(PROXY_LIST_FILE)) {
        console.log('⚠ No proxy.list file found, running without proxy')
        return []
    }
    const content = await fs.promises.readFile(PROXY_LIST_FILE, 'utf-8')
    return content
        .split('\n')
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
}

/**
 * Get a random proxy from the list
 */
function getRandomProxy(proxies) {
    if (proxies.length === 0) return null
    return proxies[Math.floor(Math.random() * proxies.length)]
}

/**
 * Block heavy resources (images, css, fonts, ads) for speed + RAM savings
 */
async function enableResourceBlocking(page) {
    await page.setRequestInterception(true)
    page.on('request', (req) => {
        const type = req.resourceType()
        if (
            ['image', 'stylesheet', 'font', 'media', 'websocket'].includes(type)
        ) {
            req.abort()
        } else req.continue()
    })
}

/**
 * Scrape a single URL
 */
async function scrapeUrl(page, url) {
    if (!url || url.length < 5) return null

    // skip images/PDF
    if (/\.(png|jpg|jpeg|svg|gif|pdf)(\/)?$/i.test(url)) return null

    try {
        console.log(`→ Navigating: ${url}`)
        await page.goto(url, {
            //waitUntil: "domcontentloaded",
            waitUntil: 'networkidle2',
            timeout: 30000,
        })

        const html = await page.content()
        const dom = new JSDOM(html, { url })
        const reader = new Readability(dom.window.document)
        const article = reader.parse()

        if (!article || article.textContent.length < 200) {
            console.log(`✗ Too short: ${url}`)
            return null
        }

        return {
            url,
            title: article.title,
            content: article.textContent.replace(/\s+/g, ' ').trim(),
            site_name: article.siteName,
            scraped_at: new Date().toISOString(),
        }
    } catch (e) {
        console.log(`✗ Failed ${url}: ${e.message}`)
        return null
    }
}

/**
 * MAIN
 */
;(async () => {
    const proxies = await loadProxies()

    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath: '/usr/bin/chromium',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--single-process',
            ...(proxies.length > 0 ? [`--proxy-server=${getRandomProxy(proxies)}`] : []),
        ],
    })

    const page = await browser.newPage()
    await page.setUserAgent(USER_AGENT)
    await enableResourceBlocking(page)

    const rl = readline.createInterface({
        input: fs.createReadStream(URL_FILE),
        crlfDelay: Infinity,
    })

    console.log('Starting scraper')

    for await (const url of rl) {
        const cleanUrl = url.trim()
        if (!cleanUrl) continue

        const data = await scrapeUrl(page, cleanUrl)
        if (data) {
            fs.appendFileSync(OUTPUT_FILE, JSON.stringify(data) + '\n')
            console.log(`✓ Saved: ${data.title}`)
        }

        // Short random delay
        await new Promise((res) => setTimeout(res, 200 + Math.random() * 300))
    }

    await browser.close()
    console.log('✔ Scraping finished.')
})()
