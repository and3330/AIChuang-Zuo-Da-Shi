import { tr } from "@/lib/i18n";
import { useEffect } from "react";

interface SeoOptions {
  title: string;
  description?: string;
  keywords?: string;
  canonical?: string;
}

function getOrCreateMeta(attr: string, value: string): HTMLMetaElement {
  let el = document.querySelector(`meta[${attr}="${value}"]`) as HTMLMetaElement;
  if (!el) {
    el = document.createElement("meta");
    if (attr === "property") {
      el.setAttribute("property", value);
    } else {
      el.setAttribute("name", value);
    }
    document.head.appendChild(el);
  }
  return el;
}

export function useSeo({ title, description, keywords, canonical }: SeoOptions) {
  useEffect(() => {
    const brand = tr("AI 創意工坊");
    const fullTitle = title.includes(brand) ? title : `${title} | ${brand}`;
    document.title = fullTitle;

    getOrCreateMeta("property", "og:title").setAttribute("content", fullTitle);
    getOrCreateMeta("name", "twitter:title").setAttribute("content", fullTitle);

    const pageUrl = canonical || window.location.origin + window.location.pathname;
    getOrCreateMeta("property", "og:url").setAttribute("content", pageUrl);

    let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("rel", "canonical");
      document.head.appendChild(link);
    }
    link.href = pageUrl;

    if (description) {
      getOrCreateMeta("name", "description").setAttribute("content", description);
      getOrCreateMeta("property", "og:description").setAttribute("content", description);
      getOrCreateMeta("name", "twitter:description").setAttribute("content", description);
    }

    if (keywords) {
      getOrCreateMeta("name", "keywords").setAttribute("content", keywords);
    }

    return () => {
      document.title = tr("AI 創意工坊 - AI 圖片與影片生成平台");
    };
  }, [title, description, keywords, canonical]);
}
