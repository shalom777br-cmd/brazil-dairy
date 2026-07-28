const cheerio = require('cheerio');
const fs = require('fs');

async function testArticle() {
  const urls = JSON.parse(fs.readFileSync('scripts/entry_urls.json', 'utf8'));
  console.log('Sample URL (latest):', urls[0]);
  console.log('Sample URL (oldest):', urls[urls.length - 1]);

  for (const url of [urls[0], urls[Math.floor(urls.length / 2)], urls[urls.length - 1]]) {
    console.log('\n--- Testing URL:', url);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    // Title
    let title = $('.skin-entryTitle, [data-ameba-id="entryTitle"], .entry-title, .title').first().text().trim();
    if (!title) {
      title = $('h1').first().text().trim();
    }

    // Date
    let dateText = $('.skin-entryDate, time, .entry-date, .date').first().text().trim();
    if (!dateText) {
      // try regex for date like 2023-05-12 or 2023年05月12日
      const match = html.match(/(\d{4}[-\/年]\d{1,2}[-\/月]\d{1,2})/);
      if (match) dateText = match[1];
    }

    // Theme / Category
    let theme = $('.skin-entryThemes, .entry-theme, a[href*="theme-"]').first().text().trim();

    // Body
    let bodyHtml = $('.skin-entryBody, .entry-body, #entryBody, .articleText').first().html() || '';
    let bodyClean = $('.skin-entryBody, .entry-body, #entryBody, .articleText').first().text().trim();

    console.log('Title:', title);
    console.log('Date Text:', dateText);
    console.log('Theme:', theme);
    console.log('Body Clean snippet:', bodyClean.slice(0, 150));
  }
}

testArticle();
