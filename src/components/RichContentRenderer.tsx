import React from "react";
import Markdown from "react-markdown";

/**
 * HTMLタグおよびMarkdown記法を除去し、純粋なテキスト要約を生成する
 */
export function stripHtmlAndMarkdown(content: string, maxLength: number = 140): string {
  if (!content) return "";

  let text = content;

  // 1. script, style などのブロックを除去
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");

  // 2. ブロック要素の終了タグや <br> を空白に置換して単語の結合を防ぐ
  text = text.replace(/<br\s*[\/]?>/gi, " ");
  text = text.replace(/<\/(p|div|li|h[1-6]|tr|td|blockquote|article|section)>/gi, " ");

  // 3. 全てのHTMLタグを除去
  text = text.replace(/<[^>]+>/g, " ");

  // 4. Markdown記法の除去
  // 画像 ![alt](url) -> 空
  text = text.replace(/!\[.*?\]\(.*?\)/g, " ");
  // リンク [text](url) -> text
  text = text.replace(/\[(.*?)\]\(.*?\)/g, "$1");
  // 見出し #, リスト -, 引用 >
  text = text.replace(/^[#>\-\*\+]\s+/gm, " ");
  // 強調 **text**, *text*, ~~text~~, `code`
  text = text.replace(/[\*_~`]{1,3}/g, "");

  // 5. HTML実体参照（エンティティ）のデコード
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  // 6. 連続する空白・改行を単一の半角スペースに正規化
  text = text.replace(/[\s\r\n\t]+/g, " ").trim();

  // 7. 長さ制限
  if (text.length > maxLength) {
    return text.slice(0, maxLength).trim() + "...";
  }

  return text;
}

/**
 * 記事本文から最初の画像URL（サムネイル候補）を抽出する
 */
export function extractThumbnailUrl(content: string): string | null {
  if (!content) return null;

  // 1. <img> タグの src 属性
  const imgMatch = content.match(/<img[^>]+src=["']?([^"'>\s]+)["']?/i);
  if (imgMatch && imgMatch[1]) {
    const url = imgMatch[1].trim();
    if (!url.startsWith("data:") && (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/"))) {
      return url;
    }
  }

  // 2. Supabase storage の画像URLを含む <a href="..."> または直接のURL
  const supabaseStorageMatch = content.match(
    /(https?:\/\/[^\s"'<>]+\/storage\/v1\/object\/public\/(?:fc2-blog-images|[^\s"'<>]+)\/[^\s"'<>]+)/i
  );
  if (supabaseStorageMatch && supabaseStorageMatch[1]) {
    return supabaseStorageMatch[1].trim();
  }

  // 3. 画像拡張子へのリンク <a href="...jpg|png|gif|webp">
  const linkImgMatch = content.match(
    /<a[^>]+href=["']?([^"'>\s]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^"'>\s]*)?)["']?/i
  );
  if (linkImgMatch && linkImgMatch[1]) {
    return linkImgMatch[1].trim();
  }

  // 4. Markdown 画像 ![alt](url)
  const mdImgMatch = content.match(/!\[.*?\]\((https?:\/\/[^\s\)]+)\)/i);
  if (mdImgMatch && mdImgMatch[1]) {
    return mdImgMatch[1].trim();
  }

  return null;
}

/**
 * 記事HTMLを安全にサニタイズ＆画像・リンク表示用に整形する
 */
export function sanitizeAndFormatHtml(rawHtml: string): string {
  if (!rawHtml) return "";

  let html = rawHtml;

  // 1. 危険な要素・属性の除去（XSS対策・サニタイズ）
  html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  html = html.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  html = html.replace(/\son[a-z]+\s*=\s*(?:["'][^"']*["']|[^\s>]+)/gi, "");
  html = html.replace(/href=["']?javascript:[^"'>\s]*["']?/gi, 'href="#"');

  // 2. もし <a href="...fc2-blog-images/...または画像URL"> の中に <img> が含まれていない場合、
  //    自動で <img> タグを埋め込んで画像として確実に表示できるように補正
  html = html.replace(
    /<a\b([^>]*?)href=["']?(https?:\/\/[^"'\s<>]+\/(?:fc2-blog-images|storage\/v1\/object\/public)\/[^"'\s<>]+|\S+?\.(?:jpg|jpeg|png|gif|webp)(?:\?[^"'\s<>]*)?)["']?([^>]*)>(.*?)<\/a>/gi,
    (match, beforeHref, imgUrl, afterHref, innerContent) => {
      // 既に中に <img> タグがあるならそのまま
      if (/<img\b/i.test(innerContent)) {
        return match;
      }
      // 中身が空またはテキストの場合、画像タグを中に生成
      const altText = innerContent.replace(/<[^>]+>/g, "").trim() || "画像";
      return `<a ${beforeHref} href="${imgUrl}" ${afterHref} target="_blank" rel="noopener noreferrer" class="block my-3 text-center cursor-pointer hover:opacity-95 transition-opacity"><img src="${imgUrl}" alt="${altText}" class="rich-content-img rounded-lg shadow-md max-w-full h-auto mx-auto border border-cream-300" loading="lazy" referrerpolicy="no-referrer" />${innerContent && innerContent !== altText ? `<span class="block text-xs text-navy-600/80 mt-1">${innerContent}</span>` : ""}</a>`;
    }
  );

  // 3. 既存の <img> タグにスタイリングクラスや属性を付与
  html = html.replace(/<img\b([^>]*)>/gi, (match, attrs) => {
    let newAttrs = attrs;
    // クラスを上書きまたは追加
    if (/class=["']/i.test(newAttrs)) {
      newAttrs = newAttrs.replace(/class=["']([^"']*)["']/i, 'class="$1 rich-content-img rounded-lg shadow-md max-w-full h-auto my-3 mx-auto block border border-cream-300"');
    } else {
      newAttrs += ' class="rich-content-img rounded-lg shadow-md max-w-full h-auto my-3 mx-auto block border border-cream-300"';
    }
    // loading="lazy"
    if (!/loading=/i.test(newAttrs)) {
      newAttrs += ' loading="lazy"';
    }
    // referrerpolicy="no-referrer"
    if (!/referrerpolicy=/i.test(newAttrs)) {
      newAttrs += ' referrerpolicy="no-referrer"';
    }
    return `<img ${newAttrs}>`;
  });

  // 4. すべての <a> タグに target="_blank" rel="noopener noreferrer" を付与
  html = html.replace(/<a\b([^>]*)>/gi, (match, attrs) => {
    let newAttrs = attrs;
    if (!/target=/i.test(newAttrs)) {
      newAttrs += ' target="_blank"';
    }
    if (!/rel=/i.test(newAttrs)) {
      newAttrs += ' rel="noopener noreferrer"';
    }
    if (!/class=/i.test(newAttrs)) {
      newAttrs += ' class="text-gold-700 hover:text-gold-800 underline underline-offset-2 transition-colors break-words"';
    }
    return `<a ${newAttrs}>`;
  });

  // 5. 改行タグが一切使われておらず生改行 \n がある場合、<br /> に補正
  if (!/<br\s*\/?>/i.test(html) && !/<\/p>/i.test(html) && html.includes("\n")) {
    html = html.replace(/\r\n|\r|\n/g, "<br />");
  }

  return html;
}

interface RichContentRendererProps {
  content: string;
  className?: string;
}

/**
 * 記事本文が HTML か Markdown かを自動判定し、
 * 画像やリンク、段落を適切にパース＆レンダリングするコンポーネント
 */
export const RichContentRenderer: React.FC<RichContentRendererProps> = ({
  content,
  className = ""
}) => {
  if (!content || !content.trim()) {
    return <p className="text-navy-400 italic text-sm font-serif py-4">本文はありません</p>;
  }

  // HTMLタグ（<p>, <div>, <br>, <img>, <a>, <span>, <table>, <ul>, <ol> 等）が含まれているか判定
  const hasHtmlTags = /<\/?(?:p|div|span|br|img|a|h[1-6]|ul|ol|li|table|tr|td|blockquote|b|strong|i|em|font|center)\b[^>]*>/i.test(content);

  if (hasHtmlTags) {
    const processedHtml = sanitizeAndFormatHtml(content);
    return (
      <div
        className={`rich-html-content leading-relaxed text-navy-900 font-sans text-sm md:text-base space-y-3.5 ${className}`}
        dangerouslySetInnerHTML={{ __html: processedHtml }}
      />
    );
  }

  // 純粋なMarkdown記事の場合
  return (
    <div className={`markdown-body ${className}`}>
      <Markdown>{content}</Markdown>
    </div>
  );
};
