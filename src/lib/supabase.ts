import { createClient, SupabaseClient } from "@supabase/supabase-js";

let supabaseInstance: SupabaseClient | null = null;

export const DEFAULT_SUPABASE_PROJECT = "cyzfspgnybrdgvmokhth";
export const DEFAULT_SUPABASE_URL = `https://${DEFAULT_SUPABASE_PROJECT}.supabase.co`;
export const DEFAULT_SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5emZzcGdueWJyZGd2bW9raHRoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTYzNTMxMSwiZXhwIjoyMDk3MjExMzExfQ.91U98ih-KIDgQT80gWDCKww4ACcyzrSnx3jo_TsIum4";

export function getSupabaseClient(customUrl?: string, customKey?: string): SupabaseClient | null {
  const env = (import.meta as any).env || {};
  const url = customUrl || env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const key = customKey || env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_KEY;

  if (!supabaseInstance || customUrl || customKey) {
    supabaseInstance = createClient(url, key);
  }

  return supabaseInstance;
}

export interface BrazilDiaryPostRecord {
  id?: number;
  entry_id?: number | null;
  title: string;
  url?: string;
  posted_at: string;
  category?: string;
  body_text: string;
  body_clean: string;
  importance_score?: string;
  duplicate_of?: number | null;
  source?: string;
}

export interface AmebloPostRecord {
  id?: number;
  entry_id?: string;
  title: string;
  url?: string;
  posted_at: string;
  category?: string;
  body_text: string;
  body_clean: string;
  importance_score?: string;
  source?: string;
}

export interface UnifiedFeedItem {
  item_id: string;
  source: 'timeline' | 'fc2_epata' | 'brazil_diary' | 'ameblo' | 'blog_original';
  posted_date: string;
  title: string | null;
  body: string;
  url?: string;
  tags?: string[];
  category?: string;
}

// Helper to fetch all rows across 1000-item PostgREST chunk boundaries on client
async function fetchClientTableInChunks(
  client: SupabaseClient,
  tableName: string,
  orderCol: string,
  ascending = false,
  offset = 0,
  limit = 10000,
  filterSource?: string
) {
  const CHUNK_SIZE = 1000;
  let baseQuery = client.from(tableName).select('*', { count: 'exact' });
  if (filterSource && filterSource !== 'all') {
    baseQuery = baseQuery.eq('source', filterSource);
  }

  // Fetch count and first chunk
  const { data: firstChunk, count, error } = await baseQuery
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
      let query = client.from(tableName).select('*');
      if (filterSource && filterSource !== 'all') {
        query = query.eq('source', filterSource);
      }
      chunkPromises.push(
        query.order(orderCol, { ascending }).range(from, to)
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

export async function fetchUnifiedFeed(
  limit = 10000,
  offset = 0,
  sourceFilter?: string,
  customKey?: string
) {
  // Try server API first (which uses service role key to bypass RLS in production)
  try {
    const apiRes = await fetch(
      `/api/feed?limit=${limit}&offset=${offset}&source=${sourceFilter || 'all'}`
    );
    if (apiRes.ok) {
      const data = await apiRes.json();
      if (data && Array.isArray(data.items)) {
        return {
          items: data.items as UnifiedFeedItem[],
          totalCount: data.totalCount || data.items.length,
        };
      }
    }
  } catch (err) {
    console.warn("Server API fetch not available, falling back to direct Supabase client:", err);
  }

  const client = getSupabaseClient(undefined, customKey);
  if (!client) {
    throw new Error("Supabase クライアントが初期化されていません。");
  }

  try {
    // 1. First try view 'blog_unified_feed'
    const { data: viewData, count: viewCount } = await fetchClientTableInChunks(
      client,
      'blog_unified_feed',
      'posted_date',
      false,
      offset,
      limit,
      sourceFilter && sourceFilter !== 'all' ? sourceFilter : undefined
    );

    if (viewData && viewData.length > 0) {
      const items: UnifiedFeedItem[] = (viewData as any[]).map(v => ({
        ...v,
        body: v.body || '',
        title: v.title || null,
      }));
      return {
        items,
        totalCount: viewCount || items.length
      };
    }
  } catch (viewErr) {
    console.warn("Direct query on blog_unified_feed failed, falling back to table queries:", viewErr);
  }

  // Fallback direct table queries if database view is unavailable
  if (sourceFilter === 'blog_original') {
    const { data, count } = await fetchClientTableInChunks(client, 'blog_queue', 'created_at', false, offset, limit);
    const items: UnifiedFeedItem[] = (data || []).map(q => ({
      item_id: String(q.id),
      source: 'blog_original',
      posted_date: (q.posted_at || q.created_at || '').split('T')[0] || new Date().toISOString().split('T')[0],
      title: null,
      body: q.content || '',
      url: undefined,
      tags: ['つぶやき'],
      category: 'ブログ原本'
    }));
    return { items, totalCount: count };
  } else if (sourceFilter === 'ameblo') {
    const { data, count } = await fetchClientTableInChunks(client, 'ameblo_posts', 'posted_at', false, offset, limit);
    const items: UnifiedFeedItem[] = (data || []).map(a => ({
      item_id: String(a.id),
      source: 'ameblo',
      posted_date: a.posted_at,
      title: a.title || '無題',
      body: a.body_clean || a.body_text || '',
      url: a.url,
      tags: [a.category || 'ヘブライ語学習'],
      category: a.category || 'ヘブライ語学習'
    }));
    return { items, totalCount: count };
  } else if (sourceFilter === 'brazil_diary') {
    const { data, count } = await fetchClientTableInChunks(client, 'brazil_diary_posts', 'posted_at', false, offset, limit);
    const items: UnifiedFeedItem[] = (data || []).map(d => ({
      item_id: String(d.id),
      source: 'brazil_diary',
      posted_date: d.posted_at,
      title: d.title || '無題',
      body: d.body_clean || d.body_text || '',
      url: d.url,
      tags: [d.category || 'ブラジル日記'],
      category: d.category || 'ブラジル日記'
    }));
    return { items, totalCount: count };
  } else if (sourceFilter === 'fc2_epata') {
    const { data, count } = await fetchClientTableInChunks(client, 'fc2_epata_blog_posts', 'posted_at', false, offset, limit);
    const items: UnifiedFeedItem[] = (data || []).map(f => ({
      item_id: String(f.id),
      source: 'fc2_epata',
      posted_date: f.posted_at,
      title: f.title || '無題',
      body: f.body_clean || f.body_text || '',
      url: f.url,
      tags: [f.category || 'FC2エパタ'],
      category: f.category || 'FC2エパタ'
    }));
    return { items, totalCount: count };
  } else if (sourceFilter === 'timeline') {
    const { data, count } = await fetchClientTableInChunks(client, 'memory_timeline_events', 'event_date', false, offset, limit);
    const items: UnifiedFeedItem[] = (data || []).map(t => ({
      item_id: String(t.id),
      source: 'timeline',
      posted_date: t.event_date || (t.year ? `${t.year}-01-01` : '1986-01-01'),
      title: t.title || '年表出来事',
      body: t.body || t.summary || '',
      url: undefined,
      tags: t.categories ? (Array.isArray(t.categories) ? t.categories : [t.categories]) : ['年表'],
      category: t.primary_category || '年表出来事'
    }));
    return { items, totalCount: count };
  } else {
    // All sources combined fallback
    const [qRes, aRes, dRes, fRes, tRes] = await Promise.all([
      fetchClientTableInChunks(client, 'blog_queue', 'created_at', false, 0, limit),
      fetchClientTableInChunks(client, 'ameblo_posts', 'posted_at', false, 0, limit),
      fetchClientTableInChunks(client, 'brazil_diary_posts', 'posted_at', false, 0, limit),
      fetchClientTableInChunks(client, 'fc2_epata_blog_posts', 'posted_at', false, 0, limit),
      fetchClientTableInChunks(client, 'memory_timeline_events', 'event_date', false, 0, limit),
    ]);

    const allItems: UnifiedFeedItem[] = [];

    (qRes.data || []).forEach(q => {
      allItems.push({
        item_id: String(q.id),
        source: 'blog_original',
        posted_date: (q.posted_at || q.created_at || '').split('T')[0] || new Date().toISOString().split('T')[0],
        title: null,
        body: q.content || '',
        url: undefined,
        tags: ['つぶやき'],
        category: 'ブログ原本'
      });
    });

    (aRes.data || []).forEach(a => {
      allItems.push({
        item_id: String(a.id),
        source: 'ameblo',
        posted_date: a.posted_at,
        title: a.title || '無題',
        body: a.body_clean || a.body_text || '',
        url: a.url,
        tags: [a.category || 'ヘブライ語学習'],
        category: a.category || 'ヘブライ語学習'
      });
    });

    (dRes.data || []).forEach(d => {
      allItems.push({
        item_id: String(d.id),
        source: 'brazil_diary',
        posted_date: d.posted_at,
        title: d.title || '無題',
        body: d.body_clean || d.body_text || '',
        url: d.url,
        tags: [d.category || 'ブラジル日記'],
        category: d.category || 'ブラジル日記'
      });
    });

    (fRes.data || []).forEach(f => {
      allItems.push({
        item_id: String(f.id),
        source: 'fc2_epata',
        posted_date: f.posted_at,
        title: f.title || '無題',
        body: f.body_clean || f.body_text || '',
        url: f.url,
        tags: [f.category || 'FC2エパタ'],
        category: f.category || 'FC2エパタ'
      });
    });

    (tRes.data || []).forEach(t => {
      allItems.push({
        item_id: String(t.id),
        source: 'timeline',
        posted_date: t.event_date || (t.year ? `${t.year}-01-01` : '1986-01-01'),
        title: t.title || '年表出来事',
        body: t.body || t.summary || '',
        tags: t.categories ? (Array.isArray(t.categories) ? t.categories : [t.categories]) : ['年表'],
        category: t.primary_category || '年表出来事'
      });
    });

    allItems.sort((a, b) => {
      if (a.source === 'blog_original' && b.source !== 'blog_original') return -1;
      if (b.source === 'blog_original' && a.source !== 'blog_original') return 1;
      return (b.posted_date || '').localeCompare(a.posted_date || '');
    });

    const totalCount = (qRes.count || 0) + (aRes.count || 0) + (dRes.count || 0) + (fRes.count || 0) + (tRes.count || 0) || allItems.length;
    return {
      items: allItems.slice(offset, offset + limit),
      totalCount
    };
  }
}

export async function updateFeedItemInSupabase(item: UnifiedFeedItem): Promise<boolean> {
  try {
    const apiRes = await fetch("/api/feed/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });
    if (apiRes.ok) {
      const result = await apiRes.json();
      if (result.success) return true;
    }
  } catch (err) {
    console.warn("API update failed, attempting direct Supabase update:", err);
  }

  const client = getSupabaseClient();
  if (!client) return false;

  try {
    if (item.source === 'blog_original') {
      const content = item.title ? `# ${item.title}\n\n${item.body}` : item.body;
      const { error } = await client
        .from('blog_queue')
        .update({ content, posted_at: item.posted_date })
        .eq('id', item.item_id);
      return !error;
    } else if (item.source === 'ameblo') {
      const { error } = await client
        .from('ameblo_posts')
        .update({
          title: item.title,
          body_clean: item.body,
          posted_at: item.posted_date,
          category: item.category
        })
        .eq('id', item.item_id);
      return !error;
    } else if (item.source === 'brazil_diary') {
      const { error } = await client
        .from('brazil_diary_posts')
        .update({
          title: item.title,
          body_clean: item.body,
          posted_at: item.posted_date,
          category: item.category
        })
        .eq('id', item.item_id);
      return !error;
    } else if (item.source === 'fc2_epata') {
      const { error } = await client
        .from('fc2_epata_blog_posts')
        .update({
          title: item.title,
          body_clean: item.body,
          posted_at: item.posted_date,
          category: item.category
        })
        .eq('id', item.item_id);
      return !error;
    } else if (item.source === 'timeline') {
      const { error } = await client
        .from('memory_timeline_events')
        .update({
          title: item.title,
          body: item.body,
          event_date: item.posted_date,
          primary_category: item.category
        })
        .eq('id', item.item_id);
      return !error;
    }
  } catch (err) {
    console.warn("Supabase update error:", err);
  }
  return false;
}

export async function insertNewBlogOriginalInSupabase(item: UnifiedFeedItem): Promise<string | null> {
  try {
    const apiRes = await fetch("/api/feed/insert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });
    if (apiRes.ok) {
      const result = await apiRes.json();
      if (result.success && result.id) return String(result.id);
    }
  } catch (err) {
    console.warn("API insert failed, attempting direct Supabase insert:", err);
  }

  const client = getSupabaseClient();
  if (!client) return null;

  try {
    const content = item.title ? `# ${item.title}\n\n${item.body}` : item.body;
    const { data, error } = await client
      .from('blog_queue')
      .insert({
        content,
        posted_at: item.posted_date,
        status: 'approved'
      })
      .select('id');

    if (!error && data && data.length > 0) {
      return String(data[0].id);
    }
  } catch (err) {
    console.warn("Supabase insert error:", err);
  }
  return null;
}

