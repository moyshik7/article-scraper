/**
 * Ultra-low-RAM Article Scraper (512MB–1GB VPS)
 * Streams URLs line-by-line instead of storing in memory.
 */

const fs = require("fs");
const readline = require("readline");
const path = require("path");
const puppeteer = require("puppeteer");
const { Readability } = require("@mozilla/readability");
const { JSDOM } = require("jsdom");

const URL_FILE = path.join(__dirname, "url.list");
const OUTPUT_FILE = "digital_marketing_corpus.jsonl";

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Block heavy resources (images, css, fonts, ads) for speed + RAM savings
 */
async function enableResourceBlocking(page) {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
        const type = req.resourceType();
        if (
            ["image", "stylesheet", "font", "media", "websocket"].includes(type)
        ) {
            req.abort();
        } else req.continue();
    });
}

/**
 * Scrape a single URL
 */
async function scrapeUrl(page, url) {
    if (!url || url.length < 5) return null;

    // skip images/PDF
    if (/\.(png|jpg|jpeg|svg|gif|pdf)(\/)?$/i.test(url)) return null;

    try {
        console.log(`→ Navigating: ${url}`);
        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
        });

        const html = await page.content();
        const dom = new JSDOM(html, { url });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();

        if (!article || article.textContent.length < 200) {
            console.log(`✗ Too short: ${url}`);
            return null;
        }

        return {
            url,
            title: article.title,
            content: article.textContent.replace(/\s+/g, " ").trim(),
            site_name: article.siteName,
            scraped_at: new Date().toISOString(),
        };
    } catch (e) {
        console.log(`✗ Failed ${url}: ${e.message}`);
        return null;
    }
}

/**
 * MAIN
 */
(async () => {
    const browser = await puppeteer.launch({
        headless: "new",
        
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--single-process", // huge RAM savings
        ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await enableResourceBlocking(page);

    const rl = readline.createInterface({
        input: fs.createReadStream(URL_FILE),
        crlfDelay: Infinity,
    });

    console.log("Starting scraper");

    for await (const url of rl) {
        const cleanUrl = url.trim();
        if (!cleanUrl) continue;

        const data = await scrapeUrl(page, cleanUrl);
        if (data) {
            fs.appendFileSync(OUTPUT_FILE, JSON.stringify(data) + "\n");
            console.log(`✓ Saved: ${data.title}`);
        }

        // Short random delay
        await new Promise((res) => setTimeout(res, 200 + Math.random() * 300));
    }

    await browser.close();
    console.log("✔ Scraping finished.");
})();
