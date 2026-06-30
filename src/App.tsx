import { useState, useEffect } from "react";
import { collection, getDocs, addDoc, query, orderBy, setDoc, doc } from "firebase/firestore";
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
  Info
} from "lucide-react";

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

  // Import State
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [importStatusMessage, setImportStatusMessage] = useState("");
  const [isImportConfirmOpen, setIsImportConfirmOpen] = useState(false);
  const [importResult, setImportResult] = useState<{ success: boolean; message: string } | null>(null);

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

  // Load Admin status from LocalStorage
  useEffect(() => {
    const savedAdmin = localStorage.getItem("brazil_blog_admin");
    if (savedAdmin === "true") {
      setIsAdmin(true);
    }
    fetchPosts();
  }, []);

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

  // Submit Post
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

    const generatedId = "post-" + Date.now();
    const postData: BlogPost = {
      id: generatedId,
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
      const docRef = doc(db, "posts", generatedId);
      await setDoc(docRef, postData);
      
      // Update state and close
      setPosts((prev) => [postData, ...prev]);
      setIsWriteModalOpen(false);
      
      // Reset form
      setNewTitle("");
      setNewPublished(new Date().toISOString().split("T")[0]);
      setNewLabelsStr("");
      setNewContent("");
      setNewUrl("");
    } catch (error) {
      console.error("Error saving post:", error);
      setFormError("保存に失敗しました。接続環境をご確認ください。");
      handleFirestoreError(error, OperationType.WRITE, `posts/${generatedId}`);
    } finally {
      setIsSubmitting(false);
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

  // Filtering posts
  const filteredPosts = posts.filter((post) => {
    const matchesSearch = 
      post.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      post.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      post.labels.some(l => l.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesLabels = 
      selectedLabels.length === 0 || 
      selectedLabels.every(label => post.labels.includes(label));

    return matchesSearch && matchesLabels;
  });

  // Extract all unique labels
  const allLabels = Array.from(
    new Set(posts.flatMap((post) => post.labels))
  );

  // Group by Year
  const postsByYear: { [year: string]: BlogPost[] } = {};
  filteredPosts.forEach((post) => {
    const year = post.published.split("-")[0] || "その他";
    if (!postsByYear[year]) {
      postsByYear[year] = [];
    }
    postsByYear[year].push(post);
  });

  // Sorted Years (descending)
  const sortedYears = Object.keys(postsByYear).sort((a, b) => b.localeCompare(a));

  const toggleLabel = (label: string) => {
    if (selectedLabels.includes(label)) {
      setSelectedLabels(selectedLabels.filter((l) => l !== label));
    } else {
      setSelectedLabels([...selectedLabels, label]);
    }
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
              <span className="text-xs tracking-wider">ブラジル宣教日記</span>
            </div>
            <h1 className="font-serif text-3xl md:text-5xl font-bold tracking-tight text-cream-50">
              ブラジル日記
            </h1>
            <p className="mt-2 text-navy-100/80 max-w-xl text-sm leading-relaxed">
              南米ブラジルの地で神様の導きに従い、福音の種を蒔き続ける宣教の歩み。
              喜びと葛藤、人々との温かい交わりの記録をタイムラインでお届けします。
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
                    id="btn-import-posts"
                    onClick={handleImportPosts}
                    disabled={isImporting}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-cream-100 font-medium text-xs py-1.5 px-3 rounded shadow transition flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isImporting ? "animate-spin" : ""}`} /> 記事インポート
                  </button>
                  <button 
                    id="btn-write-post"
                    onClick={() => setIsWriteModalOpen(true)}
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
          {/* Active Filters Summary */}
          {(searchQuery || selectedLabels.length > 0) && (
            <div className="mb-6 p-4 bg-cream-200 border border-cream-300 rounded-lg flex flex-wrap items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="text-xs text-navy-600 font-serif">
                  検索条件: {searchQuery && `「${searchQuery}」`} 
                  {selectedLabels.length > 0 && ` [タグ: ${selectedLabels.join(", ")}]`}
                </span>
                <span className="text-xs bg-navy-100 text-navy-800 px-2 py-0.5 rounded-full font-mono">
                  {filteredPosts.length} 件
                </span>
              </div>
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedLabels([]);
                }}
                className="text-xs text-gold-700 hover:text-gold-600 underline flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" /> フィルターをクリア
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <RefreshCw className="w-8 h-8 text-gold-500 animate-spin" />
              <p className="text-sm text-navy-600/70 font-serif">航海ログを紐解いています...</p>
            </div>
          ) : filteredPosts.length === 0 ? (
            <div className="text-center py-16 bg-cream-50 border border-cream-200 rounded-xl shadow-inner">
              <Globe className="w-12 h-12 text-cream-400 mx-auto mb-3" />
              <p className="text-lg font-serif text-navy-700 mb-2">該当する日記が見つかりません</p>
              <p className="text-sm text-navy-600/60 max-w-md mx-auto">
                キーワードやタグの組み合わせを変えて、もう一度検索してみてください。
              </p>
            </div>
          ) : (
            <div className="space-y-12">
              {sortedYears.map((year) => (
                <div key={year} className="relative">
                  {/* Year Header Banner */}
                  <div className="sticky top-0 z-10 py-2 mb-6">
                    <span className="font-serif text-2xl font-bold bg-cream-100 text-navy-800 pr-4 inline-block relative after:absolute after:bottom-1/2 after:left-full after:w-screen after:h-px after:bg-gold-500/20 after:pointer-events-none">
                      {year}年
                    </span>
                  </div>

                  {/* Vertical Timeline Thread */}
                  <div className="absolute left-6 md:left-8 top-12 bottom-0 w-0.5 bg-gradient-to-b from-gold-500/30 to-gold-500/5"></div>

                  {/* Posts under this year */}
                  <div className="space-y-8 pl-12 md:pl-16">
                    {postsByYear[year].map((post, idx) => {
                      const stampInfo = getPortugueseMonth(post.published);
                      // Generate stamp styling varieties
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
                          id={`post-card-${post.id}`}
                          key={post.id}
                          className="group relative bg-cream-50 border border-cream-300 hover:border-gold-500/50 rounded-xl p-5 md:p-6 shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer"
                          onClick={() => setSelectedPost(post)}
                        >
                          {/* Passport Stamp Date Marker */}
                          <div className="absolute -left-12 md:-left-16 top-4 z-10">
                            <div className={`stamp stamp-ink w-10 h-10 md:w-12 md:h-12 flex flex-col items-center justify-center transition-transform ${rotationClass} ${colorClass} ${isOval ? 'rounded-[40%_60%_50%_50%/50%_40%_60%_50%]' : 'rounded-full'}`}>
                              <span className="text-[9px] md:text-[10px] font-bold leading-none tracking-widest">{stampInfo.month}</span>
                              <span className="text-sm md:text-base font-serif font-bold leading-none my-0.5">{stampInfo.day}</span>
                              <span className="text-[7px] font-sans opacity-70 leading-none">{stampInfo.year}</span>
                            </div>
                          </div>

                          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                            <div>
                              {/* Labels */}
                              <div className="flex flex-wrap gap-1.5 mb-2.5">
                                {post.labels.map((label) => (
                                  <span 
                                    key={label}
                                    className="inline-flex items-center gap-1 bg-cream-200 text-navy-700 text-[10px] font-serif px-2 py-0.5 rounded"
                                  >
                                    <Tag className="w-2.5 h-2.5 text-gold-500" />
                                    {label}
                                  </span>
                                ))}
                              </div>

                              {/* Title */}
                              <h3 className="font-serif text-lg md:text-xl font-bold text-navy-950 group-hover:text-gold-700 transition duration-200 leading-tight">
                                {post.title}
                              </h3>

                              {/* Excerpt */}
                              <p className="mt-2 text-navy-700/80 text-sm line-clamp-3 leading-relaxed">
                                {post.content.replace(/[#*`\n]/g, " ").slice(0, 150)}...
                              </p>
                            </div>

                            {/* Arrow hint */}
                            <div className="self-end md:self-center text-gold-500 group-hover:translate-x-1.5 transition-transform duration-200 shrink-0">
                              <ChevronRight className="w-5 h-5" />
                            </div>
                          </div>

                          {/* Decorative stamp clip */}
                          {post.url && (
                            <div className="absolute top-3 right-3 text-gold-500/40 hover:text-gold-500/100 transition-colors pointer-events-none md:pointer-events-auto">
                              <span className="text-[9px] font-mono tracking-wider flex items-center gap-0.5">
                                <Globe className="w-3 h-3" /> URLあり
                              </span>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </div>
              ))}
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
              onClick={() => setIsWriteModalOpen(false)}
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
                  新しい日記を執筆する
                </h3>
                <button
                  onClick={() => setIsWriteModalOpen(false)}
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
                  onClick={() => setIsWriteModalOpen(false)}
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
                      日誌に保存する
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
