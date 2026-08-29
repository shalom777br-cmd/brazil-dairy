import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));

// Serve public and dist static assets (favicons, icons, etc.)
app.use(express.static(path.join(process.cwd(), "public")));
app.use(express.static(path.join(process.cwd(), "dist")));

const serveFaviconFile = (fileName: string, contentType: string) => {
  return (req: express.Request, res: express.Response) => {
    const pubPath = path.join(process.cwd(), "public", fileName);
    const distPath = path.join(process.cwd(), "dist", fileName);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.sendFile(pubPath, (err) => {
      if (err) {
        res.sendFile(distPath, (err2) => {
          if (err2) res.status(404).end();
        });
      }
    });
  };
};

app.get("/favicon.ico", serveFaviconFile("favicon.ico", "image/x-icon"));
app.get("/favicon.svg", serveFaviconFile("favicon.svg", "image/svg+xml"));
app.get("/favicon.png", serveFaviconFile("favicon.png", "image/png"));
app.get("/favicon-32x32.png", serveFaviconFile("favicon-32x32.png", "image/png"));
app.get("/favicon-16x16.png", serveFaviconFile("favicon-16x16.png", "image/png"));
app.get("/apple-touch-icon.png", serveFaviconFile("apple-touch-icon.png", "image/png"));

// Initialize Supabase admin client using service role key if available
const supabaseUrl = process.env.VITE_SUPABASE_URL || "https://cyzfspgnybrdgvmokhth.supabase.co";
const DEFAULT_SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5emZzcGdueWJyZGd2bW9raHRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTYzNTMxMSwiZXhwIjoyMDk3MjExMzExfQ.91U98ih-KIDgQT80gWDCKww4ACcyzrSnx3jo_TsIum4";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

function parseOriginalContent(content: string, itemTitle?: string | null) {
  if (!content) return { title: itemTitle || null, body: "" };
  if (content.startsWith("# ")) {
    const lines = content.split("\n");
    const title = lines[0].replace("# ", "").trim();
    const body = lines.slice(1).join("\n").trim();
    return { title, body };
  }
  return { title: itemTitle || null, body: content };
}

// Helper to fetch all rows across 1000-item PostgREST chunk boundaries
async function fetchTableInChunks(
  tableName: string,
  orderCol: string,
  ascending = false,
  offset = 0,
  limit = 10000
) {
  const CHUNK_SIZE = 1000;
  // If requesting within 1000 items
  if (limit <= CHUNK_SIZE) {
    const { data, count, error } = await supabase!
      .from(tableName)
      .select("*", { count: "exact" })
      .order(orderCol, { ascending })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return { data: data || [], count: count || (data ? data.length : 0) };
  }

  // Fetch count and first chunk
  const { data: firstChunk, count, error } = await supabase!
    .from(tableName)
    .select("*", { count: "exact" })
    .order(orderCol, { ascending })
    .range(offset, offset + CHUNK_SIZE - 1);

  if (error) throw error;
  if (!firstChunk) return { data: [], count: 0 };

  const totalCount = count || firstChunk.length;
  const allData = [...firstChunk];

  const targetCount = Math.min(totalCount, offset + limit);
  if (targetCount > offset + CHUNK_SIZE) {
    const chunkPromises = [];
    for (let from = offset + CHUNK_SIZE; from < targetCount; from += CHUNK_SIZE) {
      const to = Math.min(from + CHUNK_SIZE - 1, targetCount - 1);
      chunkPromises.push(
        supabase!
          .from(tableName)
          .select("*")
          .order(orderCol, { ascending })
          .range(from, to)
      );
    }
    const results = await Promise.all(chunkPromises);
    for (const r of results) {
      if (r.error) throw r.error;
      if (r.data) allData.push(...r.data);
    }
  }

  return { data: allData, count: totalCount };
}

// API Routes
app.get("/api/feed", async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: "Supabase client not initialized" });
  }

  const limit = parseInt((req.query.limit as string) || "10000", 10);
  const offset = parseInt((req.query.offset as string) || "0", 10);
  const sourceFilter = (req.query.source as string) || "all";

  try {
    let items: any[] = [];
    let totalCount = 0;

    if (sourceFilter === "blog_original") {
      const { data, count } = await fetchTableInChunks("blog_queue", "created_at", false, offset, limit);
      totalCount = count;
      items = (data || []).map((q: any) => {
        const parsed = parseOriginalContent(q.content || "");
        return {
          item_id: String(q.id),
          source: "blog_original",
          posted_date: (q.posted_at || q.created_at || "").split("T")[0] || new Date().toISOString().split("T")[0],
          title: parsed.title,
          body: parsed.body,
          url: undefined,
          tags: ["つぶやき"],
          category: "ブログ原本",
        };
      });
    } else if (sourceFilter === "ameblo") {
      const { data, count } = await fetchTableInChunks("ameblo_posts", "posted_at", false, offset, limit);
      totalCount = count;
      items = (data || []).map((a: any) => ({
        item_id: String(a.id),
        source: "ameblo",
        posted_date: a.posted_at,
        title: a.title || "無題",
        body: a.body_clean || a.body_text || "",
        url: a.url,
        tags: [a.category || "ヘブライ語学習"],
        category: a.category || "ヘブライ語学習",
      }));
    } else if (sourceFilter === "brazil_diary") {
      const { data, count } = await fetchTableInChunks("brazil_diary_posts", "posted_at", false, offset, limit);
      totalCount = count;
      items = (data || []).map((d: any) => ({
        item_id: String(d.id),
        source: "brazil_diary",
        posted_date: d.posted_at,
        title: d.title || "無題",
        body: d.body_clean || d.body_text || "",
        url: d.url,
        tags: [d.category || "ブラジル日記"],
        category: d.category || "ブラジル日記",
      }));
    } else if (sourceFilter === "fc2_epata") {
      const { data, count } = await fetchTableInChunks("fc2_epata_blog_posts", "posted_at", false, offset, limit);
      totalCount = count;
      items = (data || []).map((f: any) => ({
        item_id: String(f.id),
        source: "fc2_epata",
        posted_date: f.posted_at,
        title: f.title || "無題",
        body: f.body_clean || f.body_text || "",
        url: f.url,
        tags: [f.category || "FC2エパタ"],
        category: f.category || "FC2エパタ",
      }));
    } else if (sourceFilter === "timeline") {
      const { data, count } = await fetchTableInChunks("memory_timeline_events", "event_date", false, offset, limit);
      totalCount = count;
      items = (data || []).map((t: any) => ({
        item_id: String(t.id),
        source: "timeline",
        posted_date: t.event_date || (t.year ? `${t.year}-01-01` : "1986-01-01"),
        title: t.title || "年表出来事",
        body: t.body || t.summary || "",
        url: undefined,
        tags: t.categories ? (Array.isArray(t.categories) ? t.categories : [t.categories]) : ["年表"],
        category: t.primary_category || "年表出来事",
      }));
    } else {
      // 'all' filter: Try unified feed view first across chunk boundaries
      try {
        const { data: viewData, count: viewCount } = await fetchTableInChunks(
          "blog_unified_feed",
          "posted_date",
          false,
          offset,
          limit
        );

        if (viewData && viewData.length > 0) {
          totalCount = viewCount;
          items = (viewData as any[]).map((item) => ({
            ...item,
            body: item.body || "",
            title: item.title || null,
          }));
        }
      } catch (viewErr) {
        console.warn("blog_unified_feed query failed, falling back to multi-table combine:", viewErr);
      }

      // If view returned empty or failed, combine across all tables
      if (items.length === 0) {
        const [qRes, aRes, dRes, fRes, tRes] = await Promise.all([
          fetchTableInChunks("blog_queue", "created_at", false, 0, limit),
          fetchTableInChunks("ameblo_posts", "posted_at", false, 0, limit),
          fetchTableInChunks("brazil_diary_posts", "posted_at", false, 0, limit),
          fetchTableInChunks("fc2_epata_blog_posts", "posted_at", false, 0, limit),
          fetchTableInChunks("memory_timeline_events", "event_date", false, 0, limit),
        ]);

        const allItems: any[] = [];

        (qRes.data || []).forEach((q: any) => {
          const parsed = parseOriginalContent(q.content || "");
          allItems.push({
            item_id: String(q.id),
            source: "blog_original",
            posted_date: (q.posted_at || q.created_at || "").split("T")[0] || new Date().toISOString().split("T")[0],
            title: parsed.title,
            body: parsed.body,
            tags: ["つぶやき"],
            category: "ブログ原本",
          });
        });

        (aRes.data || []).forEach((a: any) => {
          allItems.push({
            item_id: String(a.id),
            source: "ameblo",
            posted_date: a.posted_at,
            title: a.title || "無題",
            body: a.body_clean || a.body_text || "",
            url: a.url,
            tags: [a.category || "ヘブライ語学習"],
            category: a.category || "ヘブライ語学習",
          });
        });

        (dRes.data || []).forEach((d: any) => {
          allItems.push({
            item_id: String(d.id),
            source: "brazil_diary",
            posted_date: d.posted_at,
            title: d.title || "無題",
            body: d.body_clean || d.body_text || "",
            url: d.url,
            tags: [d.category || "ブラジル日記"],
            category: d.category || "ブラジル日記",
          });
        });

        (fRes.data || []).forEach((f: any) => {
          allItems.push({
            item_id: String(f.id),
            source: "fc2_epata",
            posted_date: f.posted_at,
            title: f.title || "無題",
            body: f.body_clean || f.body_text || "",
            url: f.url,
            tags: [f.category || "FC2エパタ"],
            category: f.category || "FC2エパタ",
          });
        });

        (tRes.data || []).forEach((t: any) => {
          allItems.push({
            item_id: String(t.id),
            source: "timeline",
            posted_date: t.event_date || (t.year ? `${t.year}-01-01` : "1986-01-01"),
            title: t.title || "年表出来事",
            body: t.body || t.summary || "",
            tags: t.categories ? (Array.isArray(t.categories) ? t.categories : [t.categories]) : ["年表"],
            category: t.primary_category || "年表出来事",
          });
        });

        allItems.sort((a, b) => {
          if (a.source === "blog_original" && b.source !== "blog_original") return -1;
          if (b.source === "blog_original" && a.source !== "blog_original") return 1;
          return (b.posted_date || "").localeCompare(a.posted_date || "");
        });

        totalCount = (qRes.count || 0) + (aRes.count || 0) + (dRes.count || 0) + (fRes.count || 0) + (tRes.count || 0) || allItems.length;
        items = allItems.slice(offset, offset + limit);
      }
    }

    res.json({ items, totalCount });
  } catch (error: any) {
    console.error("Error fetching feed:", error);
    res.status(500).json({ error: error.message || "Failed to fetch feed" });
  }
});

app.post("/api/feed/insert", async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });
  const { title, body, posted_date } = req.body;

  const content = title ? `# ${title}\n\n${body}` : body;
  try {
    const { data, error } = await supabase
      .from("blog_queue")
      .insert({
        content,
        posted_at: posted_date || new Date().toISOString(),
        status: "approved",
      })
      .select("id");

    if (error) throw error;
    res.json({ success: true, id: data && data.length > 0 ? String(data[0].id) : null });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/feed/update", async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });
  const { item_id, source, title, body, posted_date, category } = req.body;

  try {
    let error = null;
    if (source === "blog_original") {
      const content = title ? `# ${title}\n\n${body}` : body;
      const res = await supabase.from("blog_queue").update({ content, posted_at: posted_date }).eq("id", item_id);
      error = res.error;
    } else if (source === "ameblo") {
      const res = await supabase.from("ameblo_posts").update({ title, body_clean: body, posted_at: posted_date, category }).eq("id", item_id);
      error = res.error;
    } else if (source === "brazil_diary") {
      const res = await supabase.from("brazil_diary_posts").update({ title, body_clean: body, posted_at: posted_date, category }).eq("id", item_id);
      error = res.error;
    } else if (source === "fc2_epata") {
      const res = await supabase.from("fc2_epata_blog_posts").update({ title, body_clean: body, posted_at: posted_date, category }).eq("id", item_id);
      error = res.error;
    } else if (source === "timeline") {
      const res = await supabase.from("memory_timeline_events").update({ title, body, event_date: posted_date, primary_category: category }).eq("id", item_id);
      error = res.error;
    }

    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/feed/delete", async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Supabase client not initialized" });
  const { item_id, source } = req.body;

  try {
    let error = null;
    if (source === "blog_original") {
      const res = await supabase.from("blog_queue").delete().eq("id", item_id);
      error = res.error;
    } else if (source === "ameblo") {
      const res = await supabase.from("ameblo_posts").delete().eq("id", item_id);
      error = res.error;
    } else if (source === "brazil_diary") {
      const res = await supabase.from("brazil_diary_posts").delete().eq("id", item_id);
      error = res.error;
    } else if (source === "fc2_epata") {
      const res = await supabase.from("fc2_epata_blog_posts").delete().eq("id", item_id);
      error = res.error;
    } else if (source === "timeline") {
      const res = await supabase.from("memory_timeline_events").delete().eq("id", item_id);
      error = res.error;
    }

    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Vite Middleware setup
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

export default app;

if (process.env.VERCEL !== "1" && !process.env.VERCEL_ENV) {
  startServer();
}
