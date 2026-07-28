const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const records = JSON.parse(fs.readFileSync('scripts/ameblo_records_scraped.json', 'utf8'));

// Keywords for unrelated topics (Art, Etsy, Tech tools unrelated to mission)
const UNRELATED_PATTERNS = [
  'etsy', 'printify', '油絵', '手描きフォント', 'calligraphr', 'アイビスペイント', 
  'キャンバス', 'アトリエ', '画材', '個展', '額縁', 'reserved listing', '限定あるいは予約販売', '絵を描'
];

// Keywords for high / critical mission topics
const MISSION_CORE = [
  'ヘブライ語', '聖書', '語根', '動詞', '文法', '名詞', 'ヘブライ文字',
  'ディボーション', 'イエス', 'キリスト', '神様', '主の', '信仰', '宣教', 'ブラジル',
  'ハレルヤ', '詩篇', '福音', '御言葉', '聖句', '祈り', '礼拝', '賛美', '葡萄の木', 'イスラエル'
];

let criticalCount = 0;
let highCount = 0;
let mediumCount = 0;
let lowCount = 0;

records.forEach(r => {
  // Check body and theme, ignoring generic blog title "ヘブライ語学習ノート"
  const bodyText = (r.category + ' ' + r.body_clean).toLowerCase();
  
  const hasUnrelated = UNRELATED_PATTERNS.some(p => bodyText.includes(p));
  const missionHits = MISSION_CORE.filter(p => bodyText.includes(p.toLowerCase())).length;
  
  if (hasUnrelated && missionHits < 2) {
    r.importance_score = '低';
    r.category = '宣教アーカイブとは無関係';
    lowCount++;
  } else if (missionHits >= 5) {
    r.importance_score = '最重要';
    criticalCount++;
  } else if (missionHits >= 1) {
    r.importance_score = '高';
    highCount++;
  } else {
    r.importance_score = '中';
    mediumCount++;
  }
});

console.log('--- Corrected Rescoring Results ---');
console.log('最重要 (Critical):', criticalCount);
console.log('高 (High):', highCount);
console.log('中 (Medium):', mediumCount);
console.log('低 / 宣教アーカイブとは無関係 (Low):', lowCount);
console.log('Total:', records.length);

fs.writeFileSync('scripts/ameblo_records_scraped.json', JSON.stringify(records, null, 2));

async function updateSupabase() {
  console.log('Batch updating Supabase ameblo_posts table...');
  const BATCH_SIZE = 50;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);
    const promises = chunk.map(item => 
      supabase
        .from('ameblo_posts')
        .update({
          importance_score: item.importance_score,
          category: item.category
        })
        .eq('entry_id', item.entry_id)
    );
    await Promise.all(promises);
  }
  
  console.log('Update finished!');
  
  // Verify counts by importance_score in Supabase
  const { data: counts, error } = await supabase
    .from('ameblo_posts')
    .select('importance_score, category');
    
  if (error) {
    console.error('Error fetching verification:', error);
  } else {
    const stats = {};
    counts.forEach(c => {
      stats[c.importance_score] = (stats[c.importance_score] || 0) + 1;
    });
    console.log('\nSupabase Database Verification Stats:', stats);
  }
}

updateSupabase();
