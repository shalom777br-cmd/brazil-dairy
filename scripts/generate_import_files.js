import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Get directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import post files
async function run() {
  console.log("Loading imported posts...");
  const p1 = (await import("../src/data/posts_part1.ts")).postsPart1;
  const p2 = (await import("../src/data/posts_part2.ts")).postsPart2;
  const p3 = (await import("../src/data/posts_part3.ts")).postsPart3;
  const p4 = (await import("../src/data/posts_part4.ts")).postsPart4;
  const p5 = (await import("../src/data/posts_part5.ts")).postsPart5;

  const allPosts = [...p1, ...p2, ...p3, ...p4, ...p5];
  console.log(`Total posts loaded: ${allPosts.length}`);

  const formattedRecords = allPosts.map((post, idx) => {
    // Clean HTML tags
    const rawContent = post.content || "";
    const bodyClean = rawContent
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?[^>]+(>|$)/g, "")
      .trim();

    // Format date YYYY-MM-DD
    let postedAt = "2011-01-01";
    if (post.published) {
      postedAt = post.published.split("T")[0];
    }

    // Convert string numeric ID to integer entry_id if valid
    let entryId = null;
    if (post.id && !isNaN(Number(post.id))) {
      // Fit in safe int range or string
      const num = parseInt(post.id, 10);
      if (num < 2147483647 && num > -2147483648) {
        entryId = num;
      } else {
        entryId = idx + 1;
      }
    } else {
      entryId = idx + 1;
    }

    return {
      entry_id: entryId,
      title: post.title || "無題",
      url: post.url || "",
      posted_at: postedAt,
      category: post.labels && post.labels.length > 0 ? post.labels[0] : "ブラジル日記",
      body_text: rawContent,
      body_clean: bodyClean,
      importance_score: post.importance_score || "C",
      duplicate_of: null,
      source: "brazil_diary_blogger"
    };
  });

  // Ensure /supabase directory exists
  const supabaseDir = path.join(__dirname, "../supabase");
  if (!fs.existsSync(supabaseDir)) {
    fs.mkdirSync(supabaseDir, { recursive: true });
  }

  // 1. Output JSON
  const jsonPath = path.join(supabaseDir, "brazil_diary_posts_import.json");
  fs.writeFileSync(jsonPath, JSON.stringify(formattedRecords, null, 2), "utf-8");
  console.log(`Saved JSON import file: ${jsonPath} (${formattedRecords.length} records)`);

  // 2. Output SQL Inserts
  const escapeSql = (str) => {
    if (!str) return "NULL";
    return "'" + str.replace(/'/g, "''").replace(/\\/g, "\\\\") + "'";
  };

  let sqlContent = `-- Brazil Diary Posts Batch Insert (${formattedRecords.length} records)\n`;
  sqlContent += `INSERT INTO public.brazil_diary_posts (entry_id, title, url, posted_at, category, body_text, body_clean, importance_score, source)\nVALUES\n`;

  const valueRows = formattedRecords.map((r) => {
    return `(${r.entry_id}, ${escapeSql(r.title)}, ${escapeSql(r.url)}, ${escapeSql(r.posted_at)}, ${escapeSql(r.category)}, ${escapeSql(r.body_text)}, ${escapeSql(r.body_clean)}, ${escapeSql(r.importance_score)}, 'brazil_diary_blogger')`;
  });

  sqlContent += valueRows.join(",\n") + ";\n";

  const sqlPath = path.join(supabaseDir, "brazil_diary_posts_import.sql");
  fs.writeFileSync(sqlPath, sqlContent, "utf-8");
  console.log(`Saved SQL import file: ${sqlPath}`);
}

run().catch((err) => {
  console.error("Error generating import files:", err);
  process.exit(1);
});
