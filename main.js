/**
 * article_scraper.js
 * A production-grade scraper for extracting clean marketing text.
 *
 * Dependencies:
 *   npm install puppeteer @mozilla/readability jsdom fs-extra
 */

const puppeteer = require('puppeteer')
const { Readability } = require('@mozilla/readability')
const { JSDOM } = require('jsdom')
const fs = require('fs-extra')
const path = require('path')

// Configuration
const OUTPUT_FILE = 'digital_marketing_corpus.jsonl'
const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function loadTargetUrls() {
    const filePath = path.join(__dirname, 'url.list')
    const fileContent = await fs.promises.readFile(filePath, 'utf-8')
    const TARGET_URLS = fileContent
        .split('\n')
        .map((url) => url.trim())
        .filter((url) => url.length > 0)
    return TARGET_URLS
}

/**
 * Simulates human-like scrolling to trigger lazy-loading elements.
 * Critical for modern blogs that load content as you scroll.
 */
async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0
            const distance = 100
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight
                window.scrollBy(0, distance)
                totalHeight += distance

                if (totalHeight >= scrollHeight) {
                    clearInterval(timer)
                    resolve()
                }
            }, 5) // Reduced from 10ms to 5ms
        })
    })
}

async function scrapeUrl(browser, url) {
    if (url.endsWith('.png') || url.endsWith('.png/') || url.endsWith('.jpg') || url.endsWith('.jpg/') || url.endsWith('.svg') || url.endsWith('.svg/') || url.endsWith('.jpeg') || url.endsWith('.jpeg/')) {
        console.warn(` Skipping image URL: ${url}`)
        return null
    }
    if (url.endsWith('.gif') || url.endsWith('.gif/')) {
        console.warn(` Skipping image URL: ${url}`)
        return null
    }
    if (url.endsWith('.pdf') || url.endsWith('.pdf/')) {
        console.warn(` Skipping PDF URL: ${url}`)
        return null
    }
    if (url.length < 3) {
        console.warn(` Skipping invalid URL: ${url}`)
        return null
    }

    const page = await browser.newPage()
    try {
        // Set generic headers to avoid immediate bot detection
        await page.setUserAgent(USER_AGENT)
        await page.setViewport({ width: 1920, height: 1080 })

        console.log(`[INFO] Navigating to: ${url}`)

        // waitUntil: 'networkidle2' waits until there are no more than 2 network connections for at least 500 ms.
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })

        // Scroll to ensure all text is rendered
        // await autoScroll(page);

        // Extract the raw HTML content
        const html = await page.content()

        // Virtual DOM creation for Readability
        const doc = new JSDOM(html, { url: url })
        const reader = new Readability(doc.window.document)
        const article = reader.parse()

        if (article && article.textContent.length > 200) {
            // Data Structure for LLM Training
            const entry = {
                url: url,
                title: article.title,
                content: article.textContent.replace(/\s+/g, ' ').trim(), // Normalize whitespace
                site_name: article.siteName,
                scraped_at: new Date().toISOString(),
            }
            return entry
        } else {
            console.warn(` Content too short or unparseable: ${url}`)
            return null
        }
    } catch (error) {
        console.error(` Failed to scrape ${url}: ${error.message}`)
        return null
    } finally {
        await page.close()
    }
}

(async () => {
    // Launch options for Docker/Linux environments
    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Prevent shared memory crashes
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
        ],
    })

    console.log('Beginning scraping job...')

    const TARGET_URLS = await loadTargetUrls()

    console.log(`Loaded ${TARGET_URLS.length} URLs`)

    for (const url of TARGET_URLS) {
        const data = await scrapeUrl(browser, url)
        if (data) {
            await fs.appendFile(OUTPUT_FILE, JSON.stringify(data) + '\n')
            console.log(` Saved: ${data.title}`)
        }

        // Reduced delay (0.5-1.5 seconds instead of 2-5 seconds)
        const delay = Math.floor(Math.random() * 1000) + 500
        await new Promise((resolve) => setTimeout(resolve, delay))
    }

    await browser.close()
    console.log(' Scraping finished.')
})()
