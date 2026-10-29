import { ArrowLeft, ArrowRight, BookOpen, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAtlas } from "../atlas/context";
import { openWord, go } from "../lib/router";
import { fetchReadingJson, parseReadingArticle, parseReadingIndex, recommendReadings, readingArticleUrl, readingIndexUrl, splitMarkedText, type ReadingArticle, type ReadingIndexItem } from "../lib/readings";
import { useStore } from "../store/store";

const PRACTICED_KEY = "word-atlas:reading-practiced:v1";

function readPracticed(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PRACTICED_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, count]) => typeof count === "number" && Number.isFinite(count)));
  } catch {
    return {};
  }
}

function recordPracticed(id: string) {
  const practiced = readPracticed();
  practiced[id] = (practiced[id] ?? 0) + 1;
  try { localStorage.setItem(PRACTICED_KEY, JSON.stringify(practiced)); } catch { /* local reading remains available if storage is full */ }
}

export function Reader({ id }: { id?: string }) {
  const atlas = useAtlas();
  const progress = useStore((s) => s.progress);
  const session = progress.session;
  const preferredIds = useMemo(() => (session?.finished ? session.steps.map((step) => step.id) : []), [session]);
  const learnedIds = useMemo(() => Object.keys(progress.cards), [progress.cards]);
  const [items, setItems] = useState<ReadingIndexItem[]>([]);
  const [article, setArticle] = useState<ReadingArticle | null>(null);
  const [loadingIndex, setLoadingIndex] = useState(true);
  const [loadingArticle, setLoadingArticle] = useState(false);
  const [error, setError] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const [translation, setTranslation] = useState(false);
  const [fontSize, setFontSize] = useState(19);
  const [answers, setAnswers] = useState<Record<number, "T" | "F" | "NG">>({});
  const [practiced, setPracticed] = useState(() => readPracticed());
  const recommendations = useMemo(() => recommendReadings(items, preferredIds, learnedIds), [items, preferredIds, learnedIds]);
  const currentIndex = recommendations.findIndex((item) => item.id === id);
  const returnRoute = session?.finished ? ({ page: "learn" } as const) : ({ page: "today" } as const);

  useEffect(() => {
    let live = true;
    setLoadingIndex(true);
    fetchReadingJson(readingIndexUrl())
      .then((data) => { if (live) { setItems(parseReadingIndex(data)); setError(""); } })
      .catch((reason: unknown) => live && setError(reason instanceof TypeError ? "阅读目录暂时无法连接。" : reason instanceof Error ? `阅读目录加载失败（${reason.message}）。` : "阅读目录加载失败。"))
      .finally(() => live && setLoadingIndex(false));
    return () => { live = false; };
  }, [retryNonce]);

  useEffect(() => {
    if (!id && recommendations.length) go({ page: "read", id: recommendations[0].id }, null, true);
  }, [id, recommendations]);

  useEffect(() => {
    if (!id || !items.length) { setArticle(null); return; }
    const item = items.find((entry) => entry.id === id);
    if (!item) {
      setArticle(null);
      const replacement = recommendations[0];
      if (replacement) go({ page: "read", id: replacement.id }, null, true);
      else setError("这篇短文不在阅读目录中。");
      return;
    }
    let live = true;
    setLoadingArticle(true);
    setArticle(null);
    setAnswers({});
    setTranslation(false);
    fetchReadingJson(readingArticleUrl(item.id))
      .then((data) => { if (live) { setArticle(parseReadingArticle(data, item)); setError(""); } })
      .catch((reason: unknown) => live && setError(reason instanceof TypeError ? "短文暂时无法连接。" : reason instanceof Error ? `短文加载失败（${reason.message}）。` : "短文加载失败。"))
      .finally(() => live && setLoadingArticle(false));
    return () => { live = false; };
  }, [id, items, recommendations, retryNonce]);

  const select = (item: ReadingIndexItem) => go({ page: "read", id: item.id });
  const next = recommendations[(currentIndex + 1) % recommendations.length];
  const allAnswered = !!article && article.q.every((_, index) => answers[index] !== undefined);
  const finish = () => {
    if (!article || !allAnswered) return;
    recordPracticed(article.id);
    setPracticed(readPracticed());
    go(returnRoute);
  };

  return (
    <div className="page reader-page">
      <header className="page-head reader-head">
        <p className="eyebrow">书房 · Reading Room</p>
        <h1 className="display">在故事里遇见新词。</h1>
        <p className="lede">短文优先匹配本次学过的词；点击高亮词可查看词条。阅读练习只在本机记录，不改变记忆排程。</p>
      </header>

      {error && <div className="reader-error" role="alert"><span>{error}</span><button className="btn btn-ghost" onClick={() => { setError(""); setRetryNonce((value) => value + 1); }}>重新加载</button></div>}
      {loadingIndex ? <section className="panel reader-loading"><span className="spinner" /><span>正在打开书架…</span></section> : (
        <div className="reader-layout">
          <aside className="panel reader-shelf">
            <h2 className="eyebrow"><BookOpen size={16} /> 短篇书架</h2>
            {!recommendations.length && <p className="muted">暂时没有可读短文。</p>}
            <ol>
              {recommendations.map((item, index) => (
                <li key={item.id}>
                  <button className={`reader-book ${item.id === id ? "is-current" : ""}`} onClick={() => select(item)} aria-current={item.id === id ? "page" : undefined}>
                    <span className="reader-book-index">{String(index + 1).padStart(2, "0")}</span>
                    <span><b>{item.titleZh}</b><small>{item.title} · {atlas.cefr[item.cefr] ?? ""}</small></span>
                    {practiced[item.id] ? <small className="reader-practiced">读过 {practiced[item.id]} 次</small> : null}
                  </button>
                </li>
              ))}
            </ol>
          </aside>

          <section className="panel reader-content">
            {!id ? (
              <div className="reader-empty">
                <BookOpen size={30} />
                <h2>挑一篇短文开始阅读</h2>
                <p>书架优先显示包含本次学习词汇的文章，其次是与你已学词汇相关的短文。</p>
                {recommendations[0] && <button className="btn btn-primary" onClick={() => select(recommendations[0])}>打开推荐短文 <ArrowRight size={18} /></button>}
              </div>
            ) : loadingArticle ? <div className="reader-loading"><span className="spinner" /><span>正在加载短文…</span></div> : article ? (
              <>
                <div className="reader-article-head">
                  <div><p className="eyebrow">{atlas.topics.find(([id]) => id === article.topic)?.[1] ?? article.topic} · {atlas.cefr[article.cefr] ?? ""}</p><h2>{article.titleZh}</h2><p lang="en">{article.title}</p></div>
                  <div className="reader-tools" aria-label="阅读设置">
                    <button className="icon-btn" aria-label="缩小字号" onClick={() => setFontSize((size) => Math.max(15, size - 1))}><Minus size={16} /></button>
                    <span>{fontSize}</span>
                    <button className="icon-btn" aria-label="放大字号" onClick={() => setFontSize((size) => Math.min(28, size + 1))}><Plus size={16} /></button>
                    <button className="btn btn-ghost" onClick={() => setTranslation((show) => !show)}>{translation ? "隐藏译文" : "显示译文"}</button>
                  </div>
                </div>
                <div className="reader-paragraphs" style={{ "--reader-size": `${fontSize}px` } as React.CSSProperties}>
                  {article.paras.map((paragraph, index) => (
                    <div className="reader-paragraph" key={`${index}-${paragraph.slice(0, 12)}`}>
                      <p lang="en">{splitMarkedText(paragraph).map((segment, segmentIndex) => {
                        const knownEntry = !!segment.id && atlas.byId.has(segment.id);
                        const learned = knownEntry && !!progress.cards[segment.id!];
                        return knownEntry ? <button key={segmentIndex} className={`reader-word ${learned ? "is-learned" : ""}`} onClick={() => openWord(segment.id!)}>{segment.surface}</button> : <span key={segmentIndex}>{segment.text}</span>;
                      })}</p>
                      {translation && <p className="reader-translation" lang="zh">{article.zh[index]}</p>}
                    </div>
                  ))}
                </div>
                {article.q.length > 0 && <section className="reader-quiz">
                  <h3 className="eyebrow">读后理解 · True / False / Not Given</h3>
                  {article.q.map((question, index) => (
                    <div className="reader-question" key={`${index}-${question.s}`}>
                      <p><b>{index + 1}.</b> {question.s}</p>
                      <div className="segmented">
                        {([["T", "正确"], ["F", "错误"], ["NG", "未提及"]] as const).map(([value, label]) => (
                          <button key={value} className={answers[index] === value ? "is-on" : ""} onClick={() => setAnswers((prev) => ({ ...prev, [index]: value }))} aria-pressed={answers[index] === value}>{label}</button>
                        ))}
                      </div>
                      {answers[index] && <p className={`reader-explanation ${answers[index] === question.a ? "is-correct" : "is-wrong"}`}>
                        {answers[index] === question.a ? "答对了。" : `答案：${question.a === "T" ? "正确" : question.a === "F" ? "错误" : "未提及"}。`} {question.why}
                      </p>}
                    </div>
                  ))}
                </section>}
                <footer className="reader-footer">
                  <button className="btn btn-ghost" onClick={() => go(returnRoute)}><ArrowLeft size={18} /> {session?.finished ? "返回学习总结" : "返回今日"}</button>
                  <div>
                    {next && next.id !== article.id && <button className="btn btn-ghost" onClick={() => select(next)}>下一篇：{next.titleZh} <ArrowRight size={18} /></button>}
                    <button className="btn btn-primary" disabled={!allAnswered} onClick={finish}>完成阅读，{session?.finished ? "返回学习总结" : "返回今日"}</button>
                  </div>
                </footer>
              </>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
