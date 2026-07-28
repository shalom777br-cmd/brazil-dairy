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
  source: 'timeline' | 'fc2_epata' | 'brazil_diary' | 'ameblo';
  posted_date: string;
  title: string;
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
  if (error) throw error;

  return {
    items: (data || []) as UnifiedFeedItem[],
    totalCount: count || 0
  };
}
