import { useState, useEffect } from "react";
import { collection, getDocs, addDoc, query, orderBy, setDoc, doc, deleteDoc } from "firebase/firestore";
import { db } from "./lib/firebase";
import { BlogPost } from "./types";
import { dummyPosts } from "./data/dummy";
import { importedPosts } from "./data/imported_posts";
import Markdown from "react-markdown";
import { motion, AnimatePresence } from "motion/react";
import { 
  Compass, 
  Search, 
  Plus, 
  X, 
  Tag, 
  Calendar, 
  BookOpen, 
  Lock, 
  Unlock, 
  ExternalLink, 
  Globe, 
  MapPin, 
  RefreshCw,
  LogOut,
  ChevronRight,
  Sparkles,
  Info,
  Download,
  Edit,
  Trash2,
  Database,
  Clock
} from "lucide-react";
import { SupabaseModal } from "./components/SupabaseModal";
import { fetchUnifiedFeed, UnifiedFeedItem } from "./lib/supabase";


enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: null,
      email: null,
      emailVerified: null,
      isAnonymous: null,
      tenantId: null
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [selectedPost, setSelectedPost] = useState<BlogPost | null>(null);
  
  // Auth state
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState("");
  
  // Post Form State
  const [isWriteModalOpen, setIsWriteModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPublished, setNewPublished] = useState(new Date().toISOString().split("T")[0]);
  const [newLabelsStr, setNewLabelsStr] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [formError, setFormError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);

  // Import State
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [importStatusMessage, setImportStatusMessage] = useState("");
  const [isImportConfirmOpen, setIsImportConfirmOpen] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(null);

  // Delete State
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [postToDelete, setPostToDelete] = useState<BlogPost | null>(null);
  const [deleteResult, setDeleteResult] = useState<{ success: boolean; message: string } | null>(null);

  // Supabase State
  const [isSupabaseModalOpen, setIsSupabaseModalOpen] = useState(false);

  // Unified Feed State
  const [unifiedFeed, setUnifiedFeed] = useState<UnifiedFeedItem[]>([]);
  const [isFeedLoading, setIsFeedLoading] = useState(true);
  const [selectedSourceFilter, setSelectedSourceFilter] = useState<string>('all');
  const [feedOffset, setFeedOffset] = useState<number>(0);
  const [hasMoreFeed, setHasMoreFeed] = useState<boolean>(true);
  const [totalFeedCount, setTotalFeedCount] = useState<number>(0);
  const [selectedFeedItem, setSelectedFeedItem] = useState<UnifiedFeedItem | null>(null);

  const loadUnifiedFeedData = async (offset = 0, sourceFilter = 'all', append = false) => {
    setIsFeedLoading(true);
    try {
      const res = await fetchUnifiedFeed(50, offset, sourceFilter);
      if (res && res.items) {
        if (append) {
          setUnifiedFeed((prev) => [...prev, ...res.items]);
        } else {
          setUnifiedFeed(res.items);
        }
        setTotalFeedCount(res.totalCount);
        setHasMoreFeed(offset + res.items.length < res.totalCount);
      }
    } catch (err) {
      console.warn("Supabase unified feed fetch failed, using fallback:", err);
      const fallbackItems: UnifiedFeedItem[] = importedPosts.map((p, idx) => ({
        item_id: p.id || `fallback-${idx}`,
        source: 'brazil_diary',
        posted_date: p.published ? p.published.split('T')[0] : '2011-01-01',
        title: p.title || '無題',
        body: p.content || '',
        url: p.url,
        tags: p.labels || ['ブラジル日記'],
        category: p.labels && p.labels.length > 0 ? p.labels[0] : 'ブラジル日記'
      }));

      let filtered = fallbackItems;
      if (sourceFilter !== 'all' && sourceFilter !== 'brazil_diary') {
        filtered = [];
      }

      if (append) {
        setUnifiedFeed((prev) => [...prev, ...filtered]);
      } else {
        setUnifiedFeed(filtered);
      }
      setTotalFeedCount(filtered.length);
      setHasMoreFeed(false);
    } finally {
      setIsFeedLoading(false);
    }
  };

  const handleLoadMoreFeed = () => {
    const nextOffset = feedOffset + 50;
    setFeedOffset(nextOffset);
    loadUnifiedFeedData(nextOffset, selectedSourceFilter, true);
  };

  const handleImportPosts = () => {
    setIsImportConfirmOpen(true);
  };

  const executeImportPosts = async () => {
    setIsImporting(true);
    setImportStatusMessage("インポート中...");
    try {
      let successCount = 0;
      const total = importedPosts.length;
      setImportProgress({ current: 0, total });

      for (let i = 0; i < total; i++) {
        const post = importedPosts[i];
        const docRef = doc(db, "posts", post.id);
        await setDoc(docRef, {
          title: post.title,
          published: post.published,
          content: post.content,
          labels: post.labels || [],
          url: post.url || ""
        });
        successCount++;
        setImportProgress({ current: successCount, total });
      }
      setImportStatusMessage(`成功：${successCount}件の記事をインポートしました！`);
      setImportResult({
        success: true,
        message: `インポートが完了しました。全 ${successCount} 件の記事データを登録・更新しました。`
      });
      await fetchPosts();
    } catch (error) {
      console.error("Error importing posts:", error);
      setImportResult({
        success: false,
        message: "インポートに失敗しました。接続環境、または権限設定をご確認ください。"
      });
      setImportStatusMessage("エラーにより中断されました");
    } finally {
      setIsImporting(false);
    }
  };

  // Load Admin status & Unified Feed
  useEffect(() => {
    const savedAdmin = localStorage.getItem("brazil_blog_admin");
    if (savedAdmin === "true") {
      setIsAdmin(true);
    }
    fetchPosts();
    loadUnifiedFeedData(0, selectedSourceFilter, false);
  }, []);

  useEffect(() => {
    setFeedOffset(0);
    loadUnifiedFeedData(0, selectedSourceFilter, false);
  }, [selectedSourceFilter]);

  const fetchPosts = async () => {
    setIsLoading(true);
    try {
      const q = query(collection(db, "posts"), orderBy("published", "desc"));
      const querySnapshot = await getDocs(q);
      const fetchedPosts: BlogPost[] = [];
      querySnapshot.forEach((doc) => {
        fetchedPosts.push({ id: doc.id, ...doc.data() } as BlogPost);
      });

      if (fetchedPosts.length === 0) {
        // Automatically insert dummy data into Firestore so the user has immediate content
        const promises = dummyPosts.map(async (post) => {
          const docRef = doc(db, "posts", post.id);
          await setDoc(docRef, post);
          return post;
        });
        await Promise.all(promises);
        setPosts(dummyPosts);
      } else {
        setPosts(fetchedPosts);
      }
    } catch (error) {
      console.error("Error fetching posts:", error);
      // Fallback to local dummy data if firebase query fails or is not ready
      setPosts(dummyPosts);
      try {
        handleFirestoreError(error, OperationType.LIST, "posts");
      } catch (e) {
        // Suppress re-throw in list to let the app function with fallback data gracefully
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Auth Action
  const handleAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const ADMIN_PASSWORD = (import.meta as any).env?.VITE_ADMIN_PASSWORD || "brasil777";
    if (passwordInput === ADMIN_PASSWORD) {
      setIsAdmin(true);
      localStorage.setItem("brazil_blog_admin", "true");
      setIsAuthModalOpen(false);
      setPasswordInput("");
      setAuthError("");
      // Open the write modal directly after successful authentication
      setIsWriteModalOpen(true);
    } else {
      setAuthError("パスワードが正しくありません。");
    }
  };

  const handleLogout = () => {
    setIsAdmin(false);
    localStorage.removeItem("brazil_blog_admin");
  };

  // Export Posts to JSON
  const handleExportPosts = () => {
    try {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(posts, null, 2));
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", "brazil_blog_export.json");
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } catch (error) {
      console.error("Export error:", error);
      alert("エクスポート中にエラーが発生しました。");
    }
  };

  // Click Edit
  const handleEditClick = (post: BlogPost) => {
    setEditingPostId(post.id);
    setNewTitle(post.title);
    setNewPublished(post.published.split("T")[0]);
    setNewLabelsStr(post.labels.join(", "));
    setNewContent(post.content);
    setNewUrl(post.url || "");
    setFormError("");
    setIsWriteModalOpen(true);
  };

  // Click Delete for BlogPost
  const handleDeleteClick = (post: BlogPost | null) => {
    if (!post) return;
    setPostToDelete(post);
    setIsDeleteConfirmOpen(true);
  };

  // Click Delete for Unified Feed Item
  const [feedItemToDelete, setFeedItemToDelete] = useState<UnifiedFeedItem | null>(null);

  const handleDeleteFeedItemClick = (item: UnifiedFeedItem | null, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!item) return;
    setFeedItemToDelete(item);
    setIsDeleteConfirmOpen(true);
  };

  // Actual Delete Execution
  const executeDeletePost = async () => {
    if (feedItemToDelete) {
      setUnifiedFeed((prev) => prev.filter((i) => i.item_id !== feedItemToDelete.item_id));
      if (selectedFeedItem?.item_id === feedItemToDelete.item_id) {
        setSelectedFeedItem(null);
      }
      setTotalFeedCount((prev) => Math.max(0, prev - 1));
      setIsDeleteConfirmOpen(false);
      setFeedItemToDelete(null);
      return;
    }

    if (!postToDelete) return;
    try {
      const docRef = doc(db, "posts", postToDelete.id);
      await deleteDoc(docRef);
      setPosts((prev) => prev.filter((p) => p.id !== postToDelete.id));
      if (selectedPost?.id === postToDelete.id) {
        setSelectedPost(null);
      }
    } catch (error) {
      console.error("Error deleting post:", error);
      try {
        handleFirestoreError(error, OperationType.DELETE, `posts/${postToDelete.id}`);
      } catch (e) {
        console.error(e);
      }
    } finally {
      setIsDeleteConfirmOpen(false);
      setPostToDelete(null);
    }
  };

  // Close Write/Edit Modal and Reset Form
  const handleCloseWriteModal = () => {
    setIsWriteModalOpen(false);
    setEditingPostId(null);
    setNewTitle("");
    setNewPublished(new Date().toISOString().split("T")[0]);
    setNewLabelsStr("");
    setNewContent("");
    setNewUrl("");
    setFormError("");
  };

  // Submit Post (handles create or update)
  const handlePostSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newPublished || !newContent.trim() || !newLabelsStr.trim()) {
      setFormError("必須項目(*)をすべて入力してください。");
      return;
    }

    setIsSubmitting(true);
    setFormError("");

    const parsedLabels = newLabelsStr
      .split(",")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const targetId = editingPostId || "post-" + Date.now();
    const postData: BlogPost = {
      id: targetId,
      title: newTitle,
      published: newPublished,
      content: newContent,
      labels: parsedLabels,
    };

    if (newUrl.trim()) {
      postData.url = newUrl.trim();
    }

    try {
      // Save directly to Firestore
      const docRef = doc(db, "posts", targetId);
      await setDoc(docRef, postData);
      
      // Update state and close
      if (editingPostId) {
        setPosts((prev) => prev.map((p) => p.id === editingPostId ? postData : p));
        if (selectedPost?.id === editingPostId) {
          setSelectedPost(postData);
        }
      } else {
        setPosts((prev) => [postData, ...prev]);
      }
      
      setIsWriteModalOpen(false);
      
      // Reset form
      setNewTitle("");
      setNewPublished(new Date().toISOString().split("T")[0]);
      setNewLabelsStr("");
      setNewContent("");
      setNewUrl("");
      setEditingPostId(null);
    } catch (error) {
      console.error("Error saving post:", error);
      setFormError("保存に失敗しました。接続環境をご確認ください。");
      handleFirestoreError(error, OperationType.WRITE, `posts/${targetId}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper for source badges in Unified Feed
  const getSourceBadge = (source: string) => {
    switch (source) {
      case 'timeline':
        return {
          label: '年表',
          bg: 'bg-purple-100 text-purple-900 border-purple-300',
          activeBg: 'bg-purple-900 text-purple-100 border-purple-900',
          icon: <Clock className="w-3.5 h-3.5 text-purple-700 shrink-0" />
        };
      case 'fc2_epata':
        return {
          label: 'FC2 エパタ',
          bg: 'bg-blue-100 text-blue-900 border-blue-300',
          activeBg: 'bg-blue-900 text-blue-100 border-blue-900',
          icon: <BookOpen className="w-3.5 h-3.5 text-blue-700 shrink-0" />
        };
      case 'brazil_diary':
        return {
          label: 'ブラジル日記',
          bg: 'bg-emerald-100 text-emerald-900 border-emerald-300',
          activeBg: 'bg-emerald-900 text-emerald-100 border-emerald-900',
          icon: <Globe className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
        };
      case 'ameblo':
        return {
          label: 'Ameblo',
          bg: 'bg-teal-100 text-teal-900 border-teal-300',
          activeBg: 'bg-teal-900 text-teal-100 border-teal-900',
          icon: <Sparkles className="w-3.5 h-3.5 text-teal-700 shrink-0" />
        };
      default:
        return {
          label: source,
          bg: 'bg-gray-100 text-gray-800 border-gray-300',
          activeBg: 'bg-gray-900 text-gray-100 border-gray-900',
          icon: <BookOpen className="w-3.5 h-3.5 text-gray-700 shrink-0" />
        };
    }
  };

  // Filter unified feed items
  const filteredFeedItems = unifiedFeed.filter((item) => {
    const queryLower = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !queryLower ||
      item.title.toLowerCase().includes(queryLower) ||
      item.body.toLowerCase().includes(queryLower) ||
      (item.category && item.category.toLowerCase().includes(queryLower)) ||
      (item.tags && item.tags.some((t) => t.toLowerCase().includes(queryLower)));

    const matchesLabels =
      selectedLabels.length === 0 ||
      (item.tags && selectedLabels.every((label) => item.tags?.includes(label))) ||
      (item.category && selectedLabels.includes(item.category));

    return matchesSearch && matchesLabels;
  });

  // Group Unified Feed Items by Year
  const feedByYear: { [year: string]: UnifiedFeedItem[] } = {};
  filteredFeedItems.forEach((item) => {
    const year = item.posted_date ? item.posted_date.split("-")[0] : "その他";
    if (!feedByYear[year]) {
      feedByYear[year] = [];
    }
    feedByYear[year].push(item);
  });

  const sortedFeedYears = Object.keys(feedByYear).sort((a, b) => b.localeCompare(a));

  // Extract unique labels from posts & unified feed
  const allLabels = Array.from(
    new Set([
      ...posts.flatMap((post) => post.labels || []),
      ...unifiedFeed.flatMap((item) => item.tags || []),
      ...unifiedFeed.map((item) => item.category).filter(Boolean) as string[]
    ])
  ).filter(Boolean);

  const toggleLabel = (label: string) => {
    if (selectedLabels.includes(label)) {
      setSelectedLabels(selectedLabels.filter((l) => l !== label));
    } else {
      setSelectedLabels([...selectedLabels, label]);
    }
  };

  // Helper for monthly Portuguese name in Passport Stamp
  const getPortugueseMonth = (dateStr: string) => {
    const parts = dateStr.split("-");
    if (parts.length < 2) return { month: "OUT", day: "01", year: "2025" };
    const month = parseInt(parts[1], 10);
    const day = parts[2];
    
    const months = [
      "JAN", "FEV", "MAR", "ABR", "MAI", "JUN",
      "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"
    ];
    return {
      month: months[month - 1] || "OUT",
      day: day || "01",
      year: parts[0]
    };
  };

  return (
    <div id="app-root" className="min-h-screen flex flex-col bg-cream-100 selection:bg-gold-300 selection:text-navy-950">
      {/* Decorative Top Border */}
      <div id="deco-top" className="h-1.5 w-full bg-gradient-to-r from-gold-600 via-gold-500 to-gold-400"></div>

      {/* Hero Header */}
      <header id="app-header" className="bg-navy-900 text-cream-100 shadow-md border-b border-gold-500/30 relative overflow-hidden">
        {/* Background Overlay Art (Abstract Compass/Globe) */}
        <div className="absolute right-0 top-0 opacity-10 pointer-events-none transform translate-x-12 -translate-y-12">
          <Globe className="w-96 h-96 text-gold-500" strokeWidth={1} />
        </div>
        
        <div className="max-w-6xl mx-auto px-4 py-8 md:py-12 flex flex-col md:flex-row md:items-center md:justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2 text-gold-400">
              <Compass className="w-5 h-5 animate-pulse" />
              <span className="font-serif tracking-widest text-xs uppercase">Missão de Diário</span>
              <span className="h-px w-8 bg-gold-500/50"></span>
              <span className="text-xs tracking-wider">統合ブログアーカイブ</span>
            </div>
            <h1 className="font-serif text-3xl md:text-5xl font-bold tracking-tight text-cream-50">
              ブラジル日記 & 統合フィード
            </h1>
            <p className="mt-2 text-navy-100/80 max-w-xl text-sm leading-relaxed">
              年表・FC2ブログエパタ・ブラジル日記・Amebloを1本化。神様の導きと恵みの軌跡を統合タイムラインでお届けします。
            </p>
          </div>

          <div className="flex items-center gap-3">
            {isAdmin ? (
              <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center bg-navy-800/80 p-2 rounded-lg border border-gold-500/20">
                <span className="text-xs text-gold-400 px-2 py-1 flex items-center gap-1">
                  <Unlock className="w-3 h-3" /> 管理者モード
                </span>
                <div className="flex gap-2">
                  <button 
                    id="btn-supabase-modal"
                    onClick={() => setIsSupabaseModalOpen(true)}
                    className="bg-navy-950 hover:bg-navy-900 border border-gold-500/40 text-gold-400 font-medium text-xs py-1.5 px-3 rounded shadow transition flex items-center gap-1 cursor-pointer"
                  >
                    <Database className="w-3.5 h-3.5" /> Supabase 統合
                  </button>
                  <button 
                    id="btn-import-posts"
                    onClick={handleImportPosts}
                    disabled={isImporting}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-cream-100 font-medium text-xs py-1.5 px-3 rounded shadow transition flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isImporting ? "animate-spin" : ""}`} /> 記事インポート
                  </button>
                  <button 
                    id="btn-export-posts"
                    onClick={handleExportPosts}
                    className="bg-teal-600 hover:bg-teal-500 text-cream-100 font-medium text-xs py-1.5 px-3 rounded shadow transition flex items-center gap-1 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" /> 記事エクスポート
                  </button>
                  <button 
                    id="btn-write-post"
                    onClick={() => {
                      setEditingPostId(null);
                      setNewTitle("");
                      setNewPublished(new Date().toISOString().split("T")[0]);
                      setNewLabelsStr("");
                      setNewContent("");
                      setNewUrl("");
                      setFormError("");
                      setIsWriteModalOpen(true);
                    }}
                    className="bg-gold-500 hover:bg-gold-400 text-navy-950 font-medium text-xs py-1.5 px-3 rounded shadow transition flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> 投稿を書く
                  </button>
                  <button 
                    id="btn-logout"
                    onClick={handleLogout}
                    className="bg-navy-700 hover:bg-navy-600 text-cream-100 hover:text-gold-400 text-xs py-1.5 px-3 rounded border border-navy-600 transition flex items-center gap-1 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" /> ログアウト
                  </button>
                </div>
              </div>
            ) : (
              <button
                id="btn-login-trigger"
                onClick={() => setIsAuthModalOpen(true)}
                className="bg-navy-800/80 hover:bg-navy-800 text-gold-500 hover:text-gold-400 border border-gold-500/30 hover:border-gold-500/60 text-xs font-serif py-2 px-4 rounded transition flex items-center gap-1.5 cursor-pointer shadow-sm"
              >
                <Lock className="w-3.5 h-3.5" /> 執筆者ログイン
              </button>
            )}
          </div>
        </div>
        {/* Import Progress Bar */}
        {isImporting && (
          <div id="import-progress-banner" className="bg-navy-950 border-t border-gold-500/20 px-4 py-3 relative">
            <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin" />
                <span className="text-cream-200 font-medium">記事データを移行中...</span>
                <span className="text-gold-400 font-mono">
                  {importProgress.current} / {importProgress.total} 件完了 ({Math.round((importProgress.current / (importProgress.total || 1)) * 100)}%)
                </span>
              </div>
              <div className="w-full md:w-64 h-2 bg-navy-800 rounded-full overflow-hidden border border-navy-700">
                <div 
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${(importProgress.current / (importProgress.total || 1)) * 100}%` }}
                ></div>
              </div>
              <span className="text-gold-300 italic">{importStatusMessage}</span>
            </div>
          </div>
        )}
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8 flex flex-col md:flex-row gap-8">
        
        {/* Left Side: Main Blog Timeline */}
        <section className="flex-1 order-2 md:order-1">
          {/* Source Filter Switcher (blog_unified_feed) */}
          <div className="mb-6 p-4 bg-cream-50 border border-gold-500/30 rounded-xl shadow-sm space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 text-navy-950 font-serif font-bold text-sm">
                <Compass className="w-4 h-4 text-gold-600" />
                統合フィードソース (<code className="text-xs text-gold-700 font-mono">blog_unified_feed</code>)
              </div>
              <div className="flex items-center gap-2 text-xs text-navy-700 font-mono">
                <span>表示件数: {filteredFeedItems.length} / {totalFeedCount} 件</span>
                {isFeedLoading && <RefreshCw className="w-3.5 h-3.5 text-gold-500 animate-spin" />}
              </div>
            </div>

            {/* Source Filter Tabs */}
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'all', label: 'すべてのソース', icon: <Globe className="w-3.5 h-3.5" />, badge: 'bg-navy-900 text-cream-100 border-navy-900' },
                { id: 'timeline', label: '年表 (120)', icon: <Clock className="w-3.5 h-3.5 text-purple-600" />, badge: 'bg-purple-50 text-purple-900 border-purple-200' },
                { id: 'fc2_epata', label: 'FC2 エパタ (880)', icon: <BookOpen className="w-3.5 h-3.5 text-blue-600" />, badge: 'bg-blue-50 text-blue-900 border-blue-200' },
                { id: 'brazil_diary', label: 'ブラジル日記 (242)', icon: <Globe className="w-3.5 h-3.5 text-emerald-600" />, badge: 'bg-emerald-50 text-emerald-900 border-emerald-200' },
                { id: 'ameblo', label: 'Ameblo (0)', icon: <Sparkles className="w-3.5 h-3.5 text-teal-600" />, badge: 'bg-teal-50 text-teal-900 border-teal-200' },
              ].map((tab) => {
                const isActive = selectedSourceFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setSelectedSourceFilter(tab.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-serif font-bold transition flex items-center gap-1.5 cursor-pointer border ${
                      isActive
                        ? 'bg-navy-950 text-gold-400 border-navy-900 shadow-md ring-1 ring-gold-500/40'
                        : `${tab.badge} hover:brightness-95`
                    }`}
                  >
                    {tab.icon}
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Filters Summary */}
          {(searchQuery || selectedLabels.length > 0 || selectedSourceFilter !== 'all') && (
            <div className="mb-6 p-4 bg-cream-200 border border-cream-300 rounded-lg flex flex-wrap items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-navy-700 font-serif font-medium">
                  現在の絞り込み: 
                  {selectedSourceFilter !== 'all' && ` [ソース: ${getSourceBadge(selectedSourceFilter).label}]`}
                  {searchQuery && ` [キーワード: 「${searchQuery}」]`} 
                  {selectedLabels.length > 0 && ` [タグ: ${selectedLabels.join(", ")}]`}
                </span>
                <span className="text-xs bg-navy-100 text-navy-800 px-2 py-0.5 rounded-full font-mono">
                  {filteredFeedItems.length} 件表示
                </span>
              </div>
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedLabels([]);
                  setSelectedSourceFilter("all");
                }}
                className="text-xs text-gold-700 hover:text-gold-600 underline flex items-center gap-1 cursor-pointer font-serif"
              >
                <RefreshCw className="w-3 h-3" /> 条件をクリア
              </button>
            </div>
          )}

          {isFeedLoading && unifiedFeed.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <RefreshCw className="w-8 h-8 text-gold-500 animate-spin" />
              <p className="text-sm text-navy-600/70 font-serif">統合フィード(blog_unified_feed)を読み込んでいます...</p>
            </div>
          ) : filteredFeedItems.length === 0 ? (
            <div className="text-center py-16 bg-cream-50 border border-cream-200 rounded-xl shadow-inner">
              <Globe className="w-12 h-12 text-cream-400 mx-auto mb-3" />
              <p className="text-lg font-serif text-navy-700 mb-2">該当するフィードが見つかりません</p>
              <p className="text-sm text-navy-600/60 max-w-md mx-auto">
                ソースフィルターや検索キーワードを変更してみてください。
              </p>
            </div>
          ) : (
            <div className="space-y-12">
              {sortedFeedYears.map((year) => (
                <div key={year} className="relative">
                  {/* Year Header Banner */}
                  <div className="sticky top-0 z-10 py-2 mb-6">
                    <span className="font-serif text-2xl font-bold bg-cream-100 text-navy-800 pr-4 inline-block relative after:absolute after:bottom-1/2 after:left-full after:w-screen after:h-px after:bg-gold-500/20 after:pointer-events-none">
                      {year}年
                    </span>
                  </div>

                  {/* Vertical Timeline Thread */}
                  <div className="absolute left-6 md:left-8 top-12 bottom-0 w-0.5 bg-gradient-to-b from-gold-500/30 to-gold-500/5"></div>

                  {/* Feed Items under this year */}
                  <div className="space-y-8 pl-12 md:pl-16">
                    {feedByYear[year].map((item, idx) => {
                      const badge = getSourceBadge(item.source);
                      const stampInfo = getPortugueseMonth(item.posted_date || "2011-01-01");
                      const stampRotations = ["-rotate-6", "rotate-3", "-rotate-3", "rotate-6"];
                      const stampColors = [
                        "border-gold-500 text-gold-700 hover:scale-105",
                        "border-navy-600 text-navy-700 hover:scale-105", 
                        "border-amber-600 text-amber-700 hover:scale-105"
                      ];
                      const rotationClass = stampRotations[idx % stampRotations.length];
                      const colorClass = stampColors[idx % stampColors.length];
                      const isOval = idx % 2 === 0;

                      return (
                        <article 
                          id={`feed-card-${item.item_id}`}
                          key={item.item_id}
                          className="group relative bg-cream-50 border border-cream-300 hover:border-gold-500/50 rounded-xl p-5 md:p-6 shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer"
                          onClick={() => setSelectedFeedItem(item)}
                        >
                          {/* Passport Stamp Date Marker */}
                          <div className="absolute -left-12 md:-left-16 top-4 z-10">
                            <div className={`stamp stamp-ink w-10 h-10 md:w-12 md:h-12 flex flex-col items-center justify-center transition-transform ${rotationClass} ${colorClass} ${isOval ? 'rounded-[40%_60%_50%_50%/50%_40%_60%_50%]' : 'rounded-full'}`}>
                              <span className="text-[9px] md:text-[10px] font-bold leading-none tracking-widest">{stampInfo.month}</span>
                              <span className="text-sm md:text-base font-serif font-bold leading-none my-0.5">{stampInfo.day}</span>
                              <span className="text-[7px] font-sans opacity-70 leading-none">{stampInfo.year}</span>
                            </div>
                          </div>

                          <div className="flex flex-col gap-3">
                            {/* Source Badge & Category/Tags & Action Buttons */}
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cream-200/80 pb-2.5">
                              <div className="flex items-center gap-2">
                                <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-serif font-bold border flex items-center gap-1.5 ${badge.bg}`}>
                                  {badge.icon}
                                  {badge.label}
                                </span>
                                <span className="text-xs text-navy-600/80 font-mono">
                                  {item.posted_date}
                                </span>
                              </div>

                              <div className="flex items-center gap-2">
                                {item.category && (
                                  <span className="text-[10px] bg-cream-200 text-navy-800 px-2 py-0.5 rounded font-serif border border-cream-300">
                                    {item.category}
                                  </span>
                                )}

                                {/* Delete Post Button */}
                                <button
                                  onClick={(e) => handleDeleteFeedItemClick(item, e)}
                                  title="この投稿を削除"
                                  className="p-1.5 text-navy-600/60 hover:text-red-600 hover:bg-red-50 rounded border border-cream-300/80 hover:border-red-200 transition cursor-pointer flex items-center gap-1 text-[11px] font-serif"
                                >
                                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                                  <span className="hidden sm:inline">削除</span>
                                </button>
                              </div>
                            </div>

                            {/* Title & Excerpt */}
                            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                              <div className="space-y-2">
                                <h3 className="font-serif text-lg md:text-xl font-bold text-navy-950 group-hover:text-gold-700 transition duration-200 leading-tight">
                                  {item.title}
                                </h3>

                                <p className="text-navy-700/80 text-sm line-clamp-3 leading-relaxed">
                                  {item.body.replace(/[#*`\n]/g, " ").slice(0, 160)}...
                                </p>
                              </div>

                              <div className="self-end md:self-center text-gold-500 group-hover:translate-x-1.5 transition-transform duration-200 shrink-0">
                                <ChevronRight className="w-5 h-5" />
                              </div>
                            </div>

                            {/* External URL indicator */}
                            {item.url && (
                              <div className="pt-2 flex justify-end">
                                <span className="text-[10px] font-serif text-navy-600/70 hover:text-navy-950 flex items-center gap-1 underline">
                                  元記事を見る <ExternalLink className="w-3 h-3 text-gold-600" />
                                </span>
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Load More Button */}
              {hasMoreFeed && (
                <div className="text-center py-6">
                  <button
                    onClick={handleLoadMoreFeed}
                    disabled={isFeedLoading}
                    className="bg-navy-900 hover:bg-navy-800 disabled:bg-navy-950 text-cream-100 hover:text-gold-400 font-serif font-bold text-xs py-3 px-8 rounded-xl shadow-md border border-gold-500/30 transition flex items-center gap-2 mx-auto cursor-pointer"
                  >
                    {isFeedLoading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin text-gold-400" />
                        読み込み中...
                      </>
                    ) : (
                      <>
                        <BookOpen className="w-4 h-4 text-gold-400" />
                        さらに読み込む ({filteredFeedItems.length} / {totalFeedCount} 件)
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Right Side: Sidebar Search + Tags */}
        <aside className="w-full md:w-80 space-y-6 order-1 md:order-2">
          {/* Author Intro (Elegant Editorial Card) */}
          <div className="bg-navy-900 text-cream-100 p-5 rounded-xl border border-gold-500/30 relative overflow-hidden">
            <div className="absolute -right-6 -bottom-6 opacity-5 pointer-events-none">
              <Sparkles className="w-32 h-32 text-gold-400" />
            </div>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full border border-gold-400 flex items-center justify-center bg-navy-800 text-gold-400">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-serif font-bold text-sm text-gold-400">宣教地：ブラジル</h4>
                <p className="text-[10px] text-cream-100/60 font-mono">São Paulo, Brasil</p>
              </div>
            </div>
            <p className="text-xs text-cream-100/80 leading-relaxed font-serif">
              ポルトガル語の習得に励みながら、地域のコミュニティや教会開拓に携わっています。言葉を越えた神様の愛をお伝えするための日常を綴っています。
            </p>
          </div>

          {/* Search Card */}
          <div className="bg-cream-50 border border-cream-300 rounded-xl p-5 shadow-sm space-y-4">
            <h3 className="font-serif font-bold text-navy-800 border-b border-cream-300 pb-2 flex items-center gap-2">
              <Search className="w-4 h-4 text-gold-500" />
              ログを探す
            </h3>

            <div className="relative">
              <input
                id="search-input"
                type="text"
                placeholder="日記のキーワードを検索..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-cream-100 border border-cream-300 focus:border-gold-500 focus:ring-1 focus:ring-gold-500 rounded-lg py-2 pl-9 pr-4 text-xs outline-none transition"
              />
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-navy-600/40" />
            </div>
          </div>

          {/* Tags Cloud Card */}
          <div className="bg-cream-50 border border-cream-300 rounded-xl p-5 shadow-sm space-y-4">
            <h3 className="font-serif font-bold text-navy-800 border-b border-cream-300 pb-2 flex items-center gap-2">
              <Tag className="w-4 h-4 text-gold-500" />
              タグで絞り込む
            </h3>

            {isLoading ? (
              <div className="h-20 flex items-center justify-center">
                <span className="text-xs text-navy-600/40">Loading tags...</span>
              </div>
            ) : allLabels.length === 0 ? (
              <p className="text-xs text-navy-600/40">タグはありません。</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {allLabels.map((label) => {
                  const isSelected = selectedLabels.includes(label);
                  return (
                    <button
                      key={label}
                      onClick={() => toggleLabel(label)}
                      className={`text-xs font-serif px-2.5 py-1 rounded transition duration-200 cursor-pointer ${
                        isSelected 
                          ? "bg-gold-500 text-navy-950 font-medium border border-gold-600" 
                          : "bg-cream-200 hover:bg-cream-300 text-navy-800 border border-cream-300/60"
                      }`}
                    >
                      #{label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </main>

      {/* Reader Panel: Slides-in from right */}
      <AnimatePresence>
        {selectedFeedItem && (
          <div className="fixed inset-0 z-50 flex justify-end" id="unified-feed-reader-overlay">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedFeedItem(null)}
              className="absolute inset-0 bg-navy-950/40 backdrop-blur-sm"
            />

            {/* Sliding Panel */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="relative w-full max-w-2xl h-full bg-cream-50 border-l border-gold-500/20 shadow-2xl flex flex-col z-10"
              id="unified-feed-reader-panel"
            >
              {/* Reader Header */}
              <div className="bg-navy-900 text-cream-100 p-5 border-b border-gold-500/30 flex items-center justify-between sticky top-0 z-20">
                <div className="flex items-center gap-3">
                  <BookOpen className="w-5 h-5 text-gold-400" />
                  <span className="font-serif tracking-widest text-xs uppercase text-gold-400">統合ブログアーカイブ</span>
                </div>
                <button
                  id="btn-close-unified-reader"
                  onClick={() => setSelectedFeedItem(null)}
                  className="p-1 text-cream-100/70 hover:text-gold-400 hover:bg-navy-800 rounded transition cursor-pointer"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Reader Content Body */}
              <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
                <div>
                  {/* Source badge and date */}
                  <div className="flex items-center justify-between gap-3 mb-4 text-xs font-serif">
                    <div className="flex items-center gap-2">
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-serif font-bold border flex items-center gap-1.5 ${getSourceBadge(selectedFeedItem.source).bg}`}>
                        {getSourceBadge(selectedFeedItem.source).icon}
                        {getSourceBadge(selectedFeedItem.source).label}
                      </span>
                      <span className="text-navy-700/80 font-mono flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-gold-500" />
                        {selectedFeedItem.posted_date}
                      </span>
                    </div>

                    {selectedFeedItem.url && (
                      <a 
                        href={selectedFeedItem.url} 
                        target="_blank" 
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-navy-700 hover:text-gold-600 font-serif text-xs underline cursor-pointer"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-gold-600" />
                        元記事を開く
                      </a>
                    )}
                  </div>

                  <h2 className="font-serif text-2xl md:text-3xl font-bold text-navy-950 leading-tight">
                    {selectedFeedItem.title}
                  </h2>

                  {/* Category and Tags */}
                  <div className="flex flex-wrap gap-2 mt-4">
                    {selectedFeedItem.category && (
                      <span className="bg-cream-200 text-navy-900 text-xs font-serif px-2.5 py-1 rounded border border-cream-300">
                        カテゴリー: {selectedFeedItem.category}
                      </span>
                    )}
                    {selectedFeedItem.tags?.map((tag) => (
                      <span
                        key={tag}
                        className="bg-cream-100 text-navy-800 text-xs font-serif px-2.5 py-1 rounded border border-cream-300/60"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>

                <hr className="border-cream-300" />

                {/* Markdown Rendered Content */}
                <div className="markdown-body">
                  <Markdown>{selectedFeedItem.body}</Markdown>
                </div>
              </div>

              {/* Reader Footer */}
              <div className="p-4 bg-cream-100 border-t border-cream-300 flex items-center justify-between text-xs font-serif">
                <button
                  onClick={(e) => handleDeleteFeedItemClick(selectedFeedItem, e)}
                  className="bg-red-50 hover:bg-red-100 text-red-700 hover:text-red-800 border border-red-200 py-1.5 px-3 rounded font-serif transition cursor-pointer flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-600" />
                  この投稿を削除
                </button>

                <button
                  onClick={() => setSelectedFeedItem(null)}
                  className="bg-navy-800 text-cream-100 hover:bg-navy-900 py-1.5 px-4 rounded font-serif transition cursor-pointer"
                >
                  閉じる
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {selectedPost && (
          <div className="fixed inset-0 z-50 flex justify-end" id="reader-overlay">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedPost(null)}
              className="absolute inset-0 bg-navy-950/40 backdrop-blur-sm"
            />

            {/* Sliding Panel */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="relative w-full max-w-2xl h-full bg-cream-50 border-l border-gold-500/20 shadow-2xl flex flex-col z-10"
              id="reader-panel"
            >
              {/* Reader Header */}
              <div className="bg-navy-900 text-cream-100 p-5 border-b border-gold-500/30 flex items-center justify-between sticky top-0 z-20">
                <div className="flex items-center gap-3">
                  <BookOpen className="w-5 h-5 text-gold-400" />
                  <span className="font-serif tracking-widest text-xs uppercase text-gold-400">Diário Aberto</span>
                </div>
                <button
                  id="btn-close-reader"
                  onClick={() => setSelectedPost(null)}
                  className="p-1 text-cream-100/70 hover:text-gold-400 hover:bg-navy-800 rounded transition cursor-pointer"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Admin Action Bar */}
              {isAdmin && (
                <div className="bg-navy-800 border-b border-gold-500/20 px-6 py-2.5 flex items-center justify-between text-xs shrink-0 sticky top-[68px] z-20">
                  <span className="text-gold-400 font-serif flex items-center gap-1 font-medium">
                    <Unlock className="w-3.5 h-3.5" /> 管理者コントロール
                  </span>
                  <div className="flex gap-2">
                    <button
                      id="btn-reader-edit"
                      onClick={() => handleEditClick(selectedPost)}
                      className="bg-gold-500 hover:bg-gold-400 text-navy-950 font-serif font-bold px-3 py-1 rounded transition flex items-center gap-1 cursor-pointer text-xs"
                    >
                      <Edit className="w-3 h-3" /> 編集する
                    </button>
                    <button
                      id="btn-reader-delete"
                      onClick={() => handleDeleteClick(selectedPost)}
                      className="bg-red-600 hover:bg-red-500 text-cream-100 font-serif font-bold px-3 py-1 rounded transition flex items-center gap-1 cursor-pointer text-xs"
                    >
                      <Trash2 className="w-3 h-3" /> 削除する
                    </button>
                  </div>
                </div>
              )}

              {/* Reader Content Body */}
              <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
                <div>
                  {/* Stamp & Date bar */}
                  <div className="flex items-center gap-3 mb-4 text-xs font-serif text-gold-700">
                    <Calendar className="w-4 h-4 text-gold-500" />
                    <span>{selectedPost.published} 執筆</span>
                    {selectedPost.url && (
                      <a 
                        href={selectedPost.url} 
                        target="_blank" 
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-navy-600 hover:text-gold-600 underline ml-auto cursor-pointer"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        元ブログを開く
                      </a>
                    )}
                  </div>

                  <h2 className="font-serif text-2xl md:text-3.5xl font-bold text-navy-950 leading-tight">
                    {selectedPost.title}
                  </h2>

                  {/* Labels list */}
                  <div className="flex flex-wrap gap-2 mt-4">
                    {selectedPost.labels.map((label) => (
                      <span
                        key={label}
                        className="bg-cream-200 text-navy-800 text-xs font-serif px-2.5 py-1 rounded border border-cream-300/40"
                      >
                        #{label}
                      </span>
                    ))}
                  </div>
                </div>

                <hr className="border-cream-300" />

                {/* Markdown Rendered Content */}
                <div className="markdown-body">
                  <Markdown>{selectedPost.content}</Markdown>
                </div>
              </div>

              {/* Reader Footer */}
              <div className="bg-cream-200 border-t border-cream-300 p-4 flex justify-between items-center text-xs text-navy-600">
                <span className="font-serif">ブラジル宣教日記アーカイブ</span>
                <button 
                  onClick={() => setSelectedPost(null)}
                  className="bg-navy-800 text-cream-100 hover:bg-navy-900 py-1.5 px-3 rounded font-serif transition cursor-pointer"
                >
                  閉じる
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Auth Login Modal (Simple Passcode) */}
      <AnimatePresence>
        {isAuthModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" id="auth-modal">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAuthModalOpen(false)}
              className="absolute inset-0 bg-navy-950/60 backdrop-blur-sm"
            />

            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-sm bg-cream-50 rounded-xl border border-gold-500/30 shadow-2xl p-6 z-10 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-cream-300 pb-3">
                <h3 className="font-serif font-bold text-lg text-navy-800 flex items-center gap-2">
                  <Lock className="w-5 h-5 text-gold-500" />
                  管理者認証
                </h3>
                <button
                  onClick={() => setIsAuthModalOpen(false)}
                  className="text-navy-600/60 hover:text-navy-900 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-3 bg-navy-100/50 rounded text-[11px] text-navy-700 leading-relaxed flex items-start gap-2">
                <Info className="w-4 h-4 text-gold-600 shrink-0 mt-0.5" />
                <span>
                  投稿を書き込むための簡易パスワード認証です。<br />
                  デフォルトは <strong>brasil777</strong> です。
                </span>
              </div>

              <form onSubmit={handleAuthSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-navy-800 mb-1">パスコード</label>
                  <input
                    id="auth-password-input"
                    type="password"
                    placeholder="パスコードを入力..."
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    className="w-full bg-cream-100 border border-cream-300 focus:border-gold-500 rounded-lg p-2.5 text-sm outline-none transition"
                    autoFocus
                  />
                  {authError && <p className="text-red-600 text-xs mt-1">{authError}</p>}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsAuthModalOpen(false)}
                    className="border border-cream-300 hover:bg-cream-200 text-navy-800 py-2 px-4 rounded text-xs font-serif transition cursor-pointer"
                  >
                    キャンセル
                  </button>
                  <button
                    id="btn-auth-submit"
                    type="submit"
                    className="bg-navy-800 hover:bg-navy-900 text-cream-100 hover:text-gold-400 py-2 px-4 rounded text-xs font-serif transition cursor-pointer"
                  >
                    認証する
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* New Post Editor Modal */}
      <AnimatePresence>
        {isWriteModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto" id="write-modal">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleCloseWriteModal}
              className="absolute inset-0 bg-navy-950/60 backdrop-blur-sm"
            />

            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-3xl bg-cream-50 rounded-xl border border-gold-500/30 shadow-2xl p-6 z-10 my-8 flex flex-col max-h-[90vh]"
            >
              <div className="flex items-center justify-between border-b border-cream-300 pb-3 shrink-0">
                <h3 className="font-serif font-bold text-xl text-navy-800 flex items-center gap-2">
                  <Compass className="w-5 h-5 text-gold-500 animate-spin-slow" />
                  {editingPostId ? "日記を編集する" : "新しい日記を執筆する"}
                </h3>
                <button
                  onClick={handleCloseWriteModal}
                  className="text-navy-600/60 hover:text-navy-900 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Scrollable Form */}
              <form onSubmit={handlePostSubmit} className="flex-1 overflow-y-auto py-4 space-y-4 pr-1">
                {formError && (
                  <p className="p-3 bg-red-50 text-red-700 border border-red-200 rounded text-xs font-medium">
                    {formError}
                  </p>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-navy-800 mb-1">タイトル *</label>
                    <input
                      id="input-title"
                      type="text"
                      placeholder="例: サンパウロでの最初のイースター"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      className="w-full bg-cream-100 border border-cream-300 focus:border-gold-500 rounded-lg p-2.5 text-xs outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-navy-800 mb-1">執筆日 *</label>
                    <input
                      id="input-published"
                      type="date"
                      value={newPublished}
                      onChange={(e) => setNewPublished(e.target.value)}
                      className="w-full bg-cream-100 border border-cream-300 focus:border-gold-500 rounded-lg p-2.5 text-xs outline-none transition"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-navy-800 mb-1">ラベル / タグ (カンマ区切り) *</label>
                    <input
                      id="input-labels"
                      type="text"
                      placeholder="例: イースター, サンパウロ, 礼拝"
                      value={newLabelsStr}
                      onChange={(e) => setNewLabelsStr(e.target.value)}
                      className="w-full bg-cream-100 border border-cream-300 focus:border-gold-500 rounded-lg p-2.5 text-xs outline-none transition"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-navy-800 mb-1">元ブログURL (任意)</label>
                    <input
                      id="input-url"
                      type="url"
                      placeholder="例: https://ameblo.jp/your-blog/123"
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                      className="w-full bg-cream-100 border border-cream-300 focus:border-gold-500 rounded-lg p-2.5 text-xs outline-none transition"
                    />
                  </div>
                </div>

                <div className="flex flex-col flex-1">
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-xs font-bold text-navy-800">本文 (Markdown対応) *</label>
                    <span className="text-[10px] text-navy-500">##で見出し、*で斜体、**で強調が使えます</span>
                  </div>
                  <textarea
                    id="textarea-content"
                    placeholder="ここにブラジルでの出来事や神様の恵み、お祈りの課題などを綴ってください..."
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    rows={8}
                    className="w-full bg-cream-100 border border-cream-300 focus:border-gold-500 rounded-lg p-3 text-xs outline-none transition resize-y font-sans leading-relaxed"
                  />
                </div>

                {/* Realtime Live Preview */}
                {newContent.trim() && (
                  <div className="border border-gold-500/20 rounded-lg p-4 bg-cream-200/50">
                    <span className="text-[10px] text-gold-700 font-serif font-bold uppercase tracking-wider block mb-2">
                      プレビュー
                    </span>
                    <div className="markdown-body text-xs line-clamp-6">
                      <Markdown>{newContent}</Markdown>
                    </div>
                  </div>
                )}
              </form>

              <div className="border-t border-cream-300 pt-4 flex justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCloseWriteModal}
                  className="border border-cream-300 hover:bg-cream-200 text-navy-800 py-2 px-4 rounded text-xs font-serif transition cursor-pointer"
                  disabled={isSubmitting}
                >
                  キャンセル
                </button>
                <button
                  id="btn-save-post"
                  type="button"
                  onClick={handlePostSubmit}
                  className="bg-gold-500 hover:bg-gold-400 text-navy-950 font-bold py-2 px-5 rounded text-xs font-serif transition flex items-center gap-1.5 cursor-pointer shadow disabled:opacity-50"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      保存中...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      {editingPostId ? "変更を保存する" : "日誌に保存する"}
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Import Confirmation Modal */}
      <AnimatePresence>
        {isImportConfirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" id="import-confirm-modal">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsImportConfirmOpen(false)}
              className="absolute inset-0 bg-navy-950/60 backdrop-blur-sm"
            />

            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-md bg-cream-50 rounded-xl border border-gold-500/30 shadow-2xl p-6 z-10 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-cream-300 pb-3">
                <h3 className="font-serif font-bold text-lg text-navy-800 flex items-center gap-2">
                  <RefreshCw className="w-5 h-5 text-gold-500" />
                  記事データの一括インポート
                </h3>
                <button
                  onClick={() => setIsImportConfirmOpen(false)}
                  className="text-navy-600/60 hover:text-navy-900 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 text-sm text-navy-700 leading-relaxed font-serif">
                <p>
                  静的データファイルに含まれる<strong>全 {importedPosts.length} 件</strong>の記事データをFirestoreデータベースにインポート（移行）します。
                </p>
                <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 flex items-start gap-2">
                  <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>
                    同じID（記事識別子）を持つ記事が既にFirestoreに登録されている場合、<strong>自動的に上書き（更新）</strong>されます。
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsImportConfirmOpen(false)}
                  className="border border-cream-300 hover:bg-cream-200 text-navy-800 py-2 px-4 rounded text-xs font-serif transition cursor-pointer"
                >
                  キャンセル
                </button>
                <button
                  id="btn-execute-import"
                  type="button"
                  onClick={() => {
                    setIsImportConfirmOpen(false);
                    executeImportPosts();
                  }}
                  className="bg-emerald-600 hover:bg-emerald-500 text-cream-100 font-bold py-2 px-4 rounded text-xs font-serif transition cursor-pointer flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  インポートを実行する
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Import Result Modal */}
      <AnimatePresence>
        {importResult && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" id="import-result-modal">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setImportResult(null)}
              className="absolute inset-0 bg-navy-950/60 backdrop-blur-sm"
            />

            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-sm bg-cream-50 rounded-xl border border-gold-500/30 shadow-2xl p-6 z-10 space-y-4 text-center"
            >
              <div className="flex justify-center">
                {importResult.success ? (
                  <div className="w-12 h-12 rounded-full bg-emerald-100 border border-emerald-400 flex items-center justify-center text-emerald-600 animate-bounce">
                    <Sparkles className="w-6 h-6" />
                  </div>
                ) : (
                  <div className="w-12 h-12 rounded-full bg-red-100 border border-red-400 flex items-center justify-center text-red-600">
                    <Info className="w-6 h-6" />
                  </div>
                )}
              </div>

              <h3 className="font-serif font-bold text-lg text-navy-950">
                {importResult.success ? "インポート完了" : "インポート失敗"}
              </h3>

              <p className="text-xs text-navy-700 font-serif leading-relaxed px-2">
                {importResult.message}
              </p>

              <div className="pt-2">
                <button
                  onClick={() => setImportResult(null)}
                  className="w-full bg-navy-800 hover:bg-navy-900 text-cream-100 hover:text-gold-400 py-2 rounded text-xs font-serif transition cursor-pointer font-bold"
                >
                  閉じる
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {isDeleteConfirmOpen && (postToDelete || feedItemToDelete) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" id="delete-confirm-modal">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setIsDeleteConfirmOpen(false);
                setPostToDelete(null);
                setFeedItemToDelete(null);
              }}
              className="absolute inset-0 bg-navy-950/60 backdrop-blur-sm"
            />

            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-md bg-cream-50 rounded-xl border border-red-500/30 shadow-2xl p-6 z-10 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-cream-300 pb-3">
                <h3 className="font-serif font-bold text-lg text-red-700 flex items-center gap-2">
                  <Trash2 className="w-5 h-5" />
                  投稿の削除
                </h3>
                <button
                  onClick={() => {
                    setIsDeleteConfirmOpen(false);
                    setPostToDelete(null);
                    setFeedItemToDelete(null);
                  }}
                  className="text-navy-600/60 hover:text-navy-900 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 text-sm text-navy-700 leading-relaxed font-serif">
                <p>
                  「<strong>{feedItemToDelete ? feedItemToDelete.title : postToDelete?.title}</strong>」を本当に削除してもよろしいですか？
                </p>
                <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-800 flex items-start gap-2">
                  <Info className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>
                    この操作を実行すると、一覧・フィードから完全に削除され、<strong>元に戻すことはできません</strong>。
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsDeleteConfirmOpen(false);
                    setPostToDelete(null);
                    setFeedItemToDelete(null);
                  }}
                  className="border border-cream-300 hover:bg-cream-200 text-navy-800 py-2 px-4 rounded text-xs font-serif transition cursor-pointer"
                >
                  キャンセル
                </button>
                <button
                  id="btn-execute-delete"
                  type="button"
                  onClick={executeDeletePost}
                  className="bg-red-600 hover:bg-red-500 text-cream-100 font-bold py-2 px-4 rounded text-xs font-serif transition cursor-pointer flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  削除を実行する
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Supabase Specification & Sync Modal */}
      <SupabaseModal
        isOpen={isSupabaseModalOpen}
        onClose={() => setIsSupabaseModalOpen(false)}
      />

      {/* Footer */}

      <footer id="app-footer" className="bg-navy-950 text-cream-100/50 text-center py-8 px-4 border-t border-gold-500/20 text-xs font-serif shrink-0">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-gold-500 text-base font-serif">†</span>
            <p className="tracking-wide">© 2026 ブラジル日記 Archive. All Rights Reserved.</p>
          </div>
          <p className="text-[10px] font-mono tracking-wider opacity-60">
            Enviado com amor e oração do Brasil.
          </p>
        </div>
      </footer>
    </div>
  );
}
