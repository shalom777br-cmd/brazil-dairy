const cheerio = require('cheerio');
const fs = require('fs');

async function crawlAmebloList() {
  console.log('Starting Ameblo entrylist crawler for https://ameblo.jp/shalom777 ...');
  let page = 1;
  const entryUrls = new Set();
  
  while (true) {
    const listUrl = page === 1 
      ? 'https://ameblo.jp/shalom777/entrylist.html'
      : `https://ameblo.jp/shalom777/entrylist-${page}.html`;
      
    console.log(`Fetching page ${page}: ${listUrl}`);
    try {
      const res = await fetch(listUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      
      if (!res.ok) {
        console.log(`Response not OK at page ${page}: status ${res.status}`);
        break;
      }
      
      const html = await res.text();
      const $ = cheerio.load(html);
      
      // Ameblo entry links matching /shalom777/entry-\d+.html
      let countOnPage = 0;
      $('a').each((_, el) => {
        const href = $(el).attr('href');
        if (href && href.match(/\/shalom777\/entry-\d+\.html/)) {
          let fullUrl = href.startsWith('http') ? href : 'https://ameblo.jp' + href;
          // remove query params if any
          fullUrl = fullUrl.split('?')[0];
          if (!entryUrls.has(fullUrl)) {
            entryUrls.add(fullUrl);
            countOnPage++;
          }
        }
      });
      
      console.log(`Page ${page}: found ${countOnPage} new entries. Total collected: ${entryUrls.size}`);
      
      // Check if there is a next page or if entry count is 0
      if (countOnPage === 0 && page > 1) {
        console.log(`No entries found on page ${page}. Ending pagination.`);
        break;
      }
      
      // Check if page navigation exists or if list reaches end
      const hasNext = $('.skin-paginationNext') .length > 0 || $('a[href*="entrylist-' + (page + 1) + '.html"]').length > 0 || countOnPage > 0;
      if (!hasNext && page > 1) {
        console.log('No next page indicator found. Reached end.');
        break;
      }
      
      page++;
      // Wait 300ms
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`Error fetching page ${page}:`, err);
      break;
    }
  }
  
  const urlList = Array.from(entryUrls);
  console.log(`List crawl finished! Total entries found: ${urlList.length}`);
  fs.writeFileSync('scripts/entry_urls.json', JSON.stringify(urlList, null, 2));
}

crawlAmebloList();
