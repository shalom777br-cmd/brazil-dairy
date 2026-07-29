import { createClient, SupabaseClient } from "@supabase/supabase-js";

let supabaseInstance: SupabaseClient | null = null;

export const DEFAULT_SUPABASE_PROJECT = "cyzfspgnybrdgvmokhth";
export const DEFAULT_SUPABASE_URL = `https://${DEFAULT_SUPABASE_PROJECT}.supabase.co`;

export function getSupabaseClient(customUrl?: string, customKey?: string): SupabaseClient | null {
  const env = (import.meta as any).env || {};
  const url = customUrl || env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const key = customKey || env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

  if (!key) {
    return null;
  }

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

export async function fetchUnifiedFeed(
  limit = 50,
  offset = 0,
  sourceFilter?: string,
  customKey?: string
) {
  const client = getSupabaseClient(undefined, customKey);
  if (!client) {
    throw new Error("Supabase クライアントが初期化されていません。");
  }

  let query = client
    .from('blog_unified_feed')
    .select('*', { count: 'exact' })
    .order('posted_date', { ascending: false });

  if (sourceFilter && sourceFilter !== 'all') {
    query = query.eq('source', sourceFilter);
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);

  if (!error && data && data.length > 0) {
    let items = [...(data as UnifiedFeedItem[])];

    // If 'all' filter and view only has partial sources (e.g. missing ameblo or blog_original)
    if (!sourceFilter || sourceFilter === 'all') {
      const existingSources = new Set(items.map(i => i.source));
      
      // Fetch x_post_queue if not in view
      if (!existingSources.has('blog_original')) {
        const { data: qData } = await client.from('x_post_queue').select('*');
        if (qData) {
          qData.forEach(q => {
            items.push({
              item_id: String(q.id),
              source: 'blog_original',
              posted_date: (q.posted_at || q.created_at || '').split('T')[0],
              title: null,
              body: q.content || '',
              url: undefined,
              tags: ['つぶやき'],
              category: 'ブログ原本'
            });
          });
        }
      }

      // Fetch ameblo_posts if not in view
      if (!existingSources.has('ameblo')) {
        const { data: aData } = await client.from('ameblo_posts').select('*').limit(200);
        if (aData) {
          aData.forEach(a => {
            items.push({
              item_id: String(a.id),
              source: 'ameblo',
              posted_date: a.posted_at,
              title: a.title,
              body: a.body_clean || a.body_text || '',
              url: a.url,
              tags: [a.category || 'ヘブライ語学習'],
              category: a.category || 'ヘブライ語学習'
            });
          });
        }
      }

      // Fetch brazil_diary_posts if not in view
      if (!existingSources.has('brazil_diary')) {
        const { data: dData } = await client.from('brazil_diary_posts').select('*').limit(200);
        if (dData) {
          dData.forEach(d => {
            items.push({
              item_id: String(d.id),
              source: 'brazil_diary',
              posted_date: d.posted_at,
              title: d.title,
              body: d.body_clean || d.body_text || '',
              url: d.url,
              tags: [d.category || 'ブラジル日記'],
              category: d.category || 'ブラジル日記'
            });
          });
        }
      }

      items.sort((a, b) => {
        if (a.source === 'blog_original' && b.source !== 'blog_original') return -1;
        if (b.source === 'blog_original' && a.source !== 'blog_original') return 1;
        return (b.posted_date || '').localeCompare(a.posted_date || '');
      });
      return {
        items: items.slice(0, limit),
        totalCount: (count || 0) + items.length - data.length
      };
    }

    return {
      items: items as UnifiedFeedItem[],
      totalCount: count || 0
    };
  }

  // Fallback direct table queries if database view has not yet included specific source
  if (sourceFilter === 'blog_original') {
    const { data: queueData, count: queueCount, error: qErr } = await client
      .from('x_post_queue')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (!qErr && queueData) {
      const items: UnifiedFeedItem[] = queueData.map(q => ({
        item_id: String(q.id),
        source: 'blog_original',
        posted_date: (q.posted_at || q.created_at || '').split('T')[0],
        title: null,
        body: q.content || '',
        url: undefined,
        tags: ['つぶやき'],
        category: 'ブログ原本'
      }));
      return { items, totalCount: queueCount || items.length };
    }
  } else if (sourceFilter === 'ameblo') {
    const { data: amebloData, count: amebloCount, error: aErr } = await client
      .from('ameblo_posts')
      .select('*', { count: 'exact' })
      .order('posted_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (!aErr && amebloData) {
      const items: UnifiedFeedItem[] = amebloData.map(a => ({
        item_id: String(a.id),
        source: 'ameblo',
        posted_date: a.posted_at,
        title: a.title,
        body: a.body_clean || a.body_text || '',
        url: a.url,
        tags: [a.category || 'ヘブライ語学習'],
        category: a.category || 'ヘブライ語学習'
      }));
      return { items, totalCount: amebloCount || items.length };
    }
  } else if (sourceFilter === 'brazil_diary') {
    const { data: diaryData, count: diaryCount, error: dErr } = await client
      .from('brazil_diary_posts')
      .select('*', { count: 'exact' })
      .order('posted_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (!dErr && diaryData) {
      const items: UnifiedFeedItem[] = diaryData.map(d => ({
        item_id: String(d.id),
        source: 'brazil_diary',
        posted_date: d.posted_at,
        title: d.title,
        body: d.body_clean || d.body_text || '',
        url: d.url,
        tags: [d.category || 'ブラジル日記'],
        category: d.category || 'ブラジル日記'
      }));
      return { items, totalCount: diaryCount || items.length };
    }
  }

  return {
    items: (data || []) as UnifiedFeedItem[],
    totalCount: count || 0
  };
}

export async function updateFeedItemInSupabase(item: UnifiedFeedItem): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;

  try {
    if (item.source === 'blog_original') {
      const content = item.title ? `# ${item.title}\n\n${item.body}` : item.body;
      const { error } = await client
        .from('x_post_queue')
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
  const client = getSupabaseClient();
  if (!client) return null;

  try {
    const content = item.title ? `# ${item.title}\n\n${item.body}` : item.body;
    const { data, error } = await client
      .from('x_post_queue')
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

