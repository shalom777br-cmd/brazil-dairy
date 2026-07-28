const cheerio = require('cheerio');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase credentials missing!');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Keyword definitions
const MISSION_KEYWORDS = [
  'ヘブライ', 'ヘブライ語', '聖書', '神様', '神の', '主よ', '主の', 'イエス', 'キリスト',
  '信仰', '宣教', 'ブラジル', '祈り', '礼拝', '賛美', '教会', 'ディボーション',
  '葡萄の木', 'イスラエル', '語学', '語根', '動詞', '名詞', 'ハレルヤ', '詩篇',
  '福音', '御言葉', '聖句', 'アーメン', 'パウロ', '創世記', '出エジプト', 'イザヤ'
];

const UNRELATED_KEYWORDS = [
  '油絵', '絵画', 'etsy', 'Etsy', 'キャンバス', '額縁', '個展', '画房', '作品販売',
  'イラスト', 'アトリエ', '水彩', 'スケッチ', '絵を描', 'ショップ'
];

function scoreArticle(title, category, bodyClean) {
  const text = (title + ' ' + category + ' ' + bodyClean).toLowerCase();
  
  let missionScore = 0;
  for (const kw of MISSION_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) {
      missionScore += 1;
    }
  }
  
  let unrelatedScore = 0;
  for (const kw of UNRELATED_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) {
      unrelatedScore += 1;
    }
  }
  
  if (missionScore >= 3) {
    return '最重要';
  } else if (missionScore >= 1) {
    return '高';
  } else if (unrelatedScore >= 1 && missionScore === 0) {
    return '低';
  } else {
    return '中';
  }
}

function parseDate(dateStr) {
  if (!dateStr) return '2011-01-01';
  // match YYYY-MM-DD or YYYY年MM月DD日
  const match = dateStr.match(/(\d{4})[-\/年](\d{1,2})[-\/月](\d{1,2})/);
  if (match) {
    const y = match[1];
    const m = match[2].padStart(2, '0');
    const d = match[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return '2011-01-01';
}

async function processAll() {
  const urls = JSON.parse(fs.readFileSync('scripts/entry_urls.json', 'utf8'));
  console.log(`Starting Ameblo processing for ${urls.length} URLs...`);
  
  const records = [];
  let relatedCount = 0;
  let unrelatedCount = 0;
  let oldestDate = '9999-99-99';
  let newestDate = '0000-00-00';
  
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (i % 25 === 0 || i === urls.length - 1) {
      console.log(`Processing [${i + 1}/${urls.length}] ${url}`);
    }
    
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      
      if (!res.ok) {
        console.warn(`Failed to fetch ${url}: status ${res.status}`);
        continue;
      }
      
      const html = await res.text();
      const $ = cheerio.load(html);
      
      // Extract entry_id
      const entryIdMatch = url.match(/entry-(\d+)\.html/);
      const entry_id = entryIdMatch ? entryIdMatch[1] : `ameblo-${i}`;
      
      // Title
      let title = $('.skin-entryTitle, [data-ameba-id="entryTitle"], .entry-title, h1.title').first().text().trim();
      if (!title || title === 'ヘブライ語学習') {
        const themeText = $('.skin-entryThemes, .entry-theme, a[href*="theme-"]').first().text().trim();
        if (themeText) {
          title = themeText;
        } else {
          title = 'ヘブライ語学習ノート';
        }
      }
      
      // Date
      let rawDate = $('.skin-entryDate, time, .entry-date, .date').first().text().trim();
      if (!rawDate) {
        const dMatch = html.match(/(\d{4}[-\/年]\d{1,2}[-\/月]\d{1,2})/);
        if (dMatch) rawDate = dMatch[1];
      }
      const posted_at = parseDate(rawDate);
      
      if (posted_at < oldestDate) oldestDate = posted_at;
      if (posted_at > newestDate) newestDate = posted_at;
      
      // Category / Theme
      const category = $('.skin-entryThemes, .entry-theme, a[href*="theme-"]').first().text().trim() || 'ヘブライ語学習';
      
      // Body HTML & Clean
      const body_text = $('.skin-entryBody, .entry-body, #entryBody, .articleText').first().html() || '';
      const body_clean = $('.skin-entryBody, .entry-body, #entryBody, .articleText').first().text().trim();
      
      // Importance Score
      const importance_score = scoreArticle(title, category, body_clean);
      
      if (importance_score === '低') {
        unrelatedCount++;
      } else {
        relatedCount++;
      }
      
      records.push({
        entry_id,
        url,
        title,
        posted_at,
        category,
        body_text,
        body_clean,
        importance_score,
        source: 'ameblo_hebrew_study',
        updated_at: new Date().toISOString()
      });
      
      // 100ms pause to avoid hammering Ameblo
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      console.error(`Error processing ${url}:`, err);
    }
  }
  
  console.log('\n==========================================');
  console.log('Crawling & Scoring Summary:');
  console.log(`Total Processed: ${records.length}`);
  console.log(`Oldest Posted Date: ${oldestDate}`);
  console.log(`Newest Posted Date: ${newestDate}`);
  console.log(`Related (最重要/高/中): ${relatedCount}`);
  console.log(`Unrelated (低): ${unrelatedCount}`);
  console.log('==========================================\n');
  
  // Save locally as backup
  fs.writeFileSync('scripts/ameblo_records_scraped.json', JSON.stringify(records, null, 2));
  console.log('Saved scraped records to scripts/ameblo_records_scraped.json');
  
  // Upsert to Supabase ameblo_posts in batches of 50
  console.log('\nInserting records into Supabase ameblo_posts...');
  const BATCH_SIZE = 50;
  let insertedTotal = 0;
  
  for (let b = 0; b < records.length; b += BATCH_SIZE) {
    const batch = records.slice(b, b + BATCH_SIZE);
    const { data, error } = await supabase
      .from('ameblo_posts')
      .upsert(batch, { onConflict: 'entry_id' });
      
    if (error) {
      console.error(`Error upserting batch [${b}..${b + batch.length}]:`, error);
      // fallback without entry_id onConflict if unique constraint is different
      const { error: err2 } = await supabase.from('ameblo_posts').insert(batch);
      if (err2) console.error('Fallback insert error:', err2);
      else insertedTotal += batch.length;
    } else {
      insertedTotal += batch.length;
    }
  }
  
  console.log(`Supabase batch insert complete! Inserted/Upserted: ${insertedTotal}`);
  
  // Verify count from ameblo_posts
  const { count, error: countErr } = await supabase
    .from('ameblo_posts')
    .select('*', { count: 'exact', head: true });
    
  if (countErr) {
    console.error('Error fetching final count:', countErr);
  } else {
    console.log(`\nSELECT COUNT(*) FROM ameblo_posts Result: ${count} rows`);
  }
}

processAll();
