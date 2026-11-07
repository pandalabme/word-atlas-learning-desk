import { Grid3x3, List, Search, Sparkles, X } from "lucide-react";
import { Galaxy } from "../galaxy/Galaxy";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAtlas, useCurriculum } from "../atlas/context";
import type { WordRef } from "../atlas/types";
import { morphFrom } from "../lib/motion";
import { go, openWord, type Route } from "../lib/router";
import type { CardState } from "../store/srs";
import { useStore, wordStatus } from "../store/store";
import { Illustration } from "../ui/Illustration";
import { searchAtlas } from "../ui/Palette";
import { Speak } from "../ui/Speak";

type Status = "all" | "new" | "learning" | "mastered" | "saved";
const STATUS: [Status, string][] = [
  ["all", "全部"],
  ["new", "未学"],
  ["learning", "学习中"],
  ["mastered", "已掌握"],
  ["saved", "收藏"],
];

type View = "grid" | "list" | "galaxy";
function readView(): View {
  try {
    const v = localStorage.getItem("word-atlas:view");
    return v === "list" || v === "galaxy" ? v : "grid";
  } catch {
    return "grid";
  }
}

export function AtlasPage({
  route,
}: {
  route: Extract<Route, { page: "atlas" }>;
}) {
  const atlas = useAtlas();
  const curriculum = useCurriculum();
  const cards = useStore((s) => s.progress.cards);
  const manualStatuses = useStore((s) => s.progress.manualStatuses);
  const bookmarks = useStore((s) => s.progress.bookmarks);
  const [q, setQ] = useState(route.q ?? "");
  const [status, setStatus] = useState<Status>("all");
  const [view, setViewState] = useState<View>(() =>
    route.view === "galaxy" || route.view === "list" || route.view === "grid"
      ? route.view
      : readView(),
  );
  // Follow the URL when a link switches views while this page is already open.
  useEffect(() => {
    if (route.view === "grid" || route.view === "list" || route.view === "galaxy") setViewState(route.view);
  }, [route.view]);
  const setView = (v: View) => {
    setViewState(v);
    go(
      {
        page: "atlas",
        topic: route.topic,
        level: route.level,
        view: v === "grid" ? undefined : v,
      },
      null,
      true,
    );
  };
  const topic = route.topic;
  const level = route.level;

  useEffect(() => {
    try {
      localStorage.setItem("word-atlas:view", view);
    } catch {
      /* optional */
    }
  }, [view]);

  const list = useMemo(() => {
    const saved = new Set(bookmarks);
    const ti = topic ? atlas.topics.findIndex((t) => t[0] === topic) : -1;
    const li = level ? atlas.cefr.indexOf(level) : -1;
    const base = q.trim() ? searchAtlas(atlas, q, 5000).filter((word) => curriculum.byId.has(word.id)) : curriculum.words;
    return base.filter((w) => {
      if (ti >= 0 && w.topic !== ti) return false;
      if (li >= 0 && w.cefr !== li) return false;
      const c = cards[w.id];
      const currentStatus = wordStatus(c, manualStatuses[w.id]);
      if (status === "new") return !currentStatus;
      if (status === "learning") return currentStatus === "learning";
      if (status === "mastered") return currentStatus === "mastered";
      if (status === "saved") return saved.has(w.id);
      return true;
    });
  }, [atlas, curriculum, q, topic, level, status, cards, manualStatuses, bookmarks]);

  const topicCounts = useMemo(() => {
    const counts = new Array(atlas.topics.length).fill(0);
    curriculum.words.forEach((word) => counts[word.topic]++);
    return counts;
  }, [atlas, curriculum]);

  const setFilter = (patch: Partial<Extract<Route, { page: "atlas" }>>) =>
    go({ page: "atlas", topic, level, view: route.view, ...patch }, null, true);

  return (
    <div className={`page atlas ${view === "galaxy" ? "is-galaxy" : ""}`}>
      <header className="atlas-head">
        <div>
          <p className="eyebrow">{curriculum.name} · {curriculum.count.toLocaleString()} 词</p>
          <h1 className="display">
            每个词，
            <br className="br-sm" />
            都有一幅画。
          </h1>
          <p className="lede">
            词条来自统一词典 · 原创例句与英美发音 · 当前按 {curriculum.name} 筛选
          </p>
        </div>
        <label className="search">
          <Search size={19} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索单词或中文释义"
            spellCheck={false}
            autoComplete="off"
          />
          {q && (
            <button
              className="icon-btn"
              onClick={() => setQ("")}
              aria-label="清空搜索"
            >
              <X size={16} />
            </button>
          )}
        </label>
      </header>

      <div className="filters">
        {view !== "galaxy" && (
          <>
            <div className="chips chips-scroll" role="group" aria-label="难度">
              <button
                className={`chip-btn ${!level ? "is-on" : ""}`}
                onClick={() => setFilter({ level: undefined })}
              >
                所有难度
              </button>
              {atlas.cefr.map((l) => (
                <button
                  key={l}
                  className={`chip-btn lv lv-${l} ${level === l ? "is-on" : ""}`}
                  onClick={() =>
                    setFilter({ level: level === l ? undefined : l })
                  }
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="chips chips-scroll" role="group" aria-label="主题">
              <button
                className={`chip-btn ${!topic ? "is-on" : ""}`}
                onClick={() => setFilter({ topic: undefined })}
              >
                所有主题
              </button>
              {atlas.topics.map(([k, name], index) => topicCounts[index] > 0 && (
                <button
                  key={k}
                  className={`chip-btn ${topic === k ? "is-on" : ""}`}
                  onClick={() =>
                    setFilter({ topic: topic === k ? undefined : k })
                  }
                >
                  {name}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="filters-row">
          {view !== "galaxy" && (
            <div className="segmented" role="group" aria-label="学习状态">
              {STATUS.map(([k, label]) => (
                <button
                  key={k}
                  className={status === k ? "is-on" : ""}
                  onClick={() => setStatus(k)}
                  aria-pressed={status === k}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <span className="result-count">
            {view === "galaxy"
              ? "搜索一个词，星图会带你飞过去"
              : `${list.length.toLocaleString()} 个结果`}
          </span>
          <div
            className="segmented segmented-icons"
            role="group"
            aria-label="视图"
          >
            <button
              className={view === "grid" ? "is-on" : ""}
              onClick={() => setView("grid")}
              aria-label="图片视图"
              aria-pressed={view === "grid"}
            >
              <Grid3x3 size={17} />
            </button>
            <button
              className={view === "list" ? "is-on" : ""}
              onClick={() => setView("list")}
              aria-label="列表视图"
              aria-pressed={view === "list"}
            >
              <List size={17} />
            </button>
            <button
              className={view === "galaxy" ? "is-on" : ""}
              onClick={() => setView("galaxy")}
              aria-label="星图视图"
              aria-pressed={view === "galaxy"}
            >
              <Sparkles size={17} />
            </button>
          </div>
        </div>
      </div>

      {view === "galaxy" ? (
        <Galaxy mode="full" focus={q.trim() ? list[0]?.id : null} words={curriculum.words} />
      ) : list.length === 0 ? (
        <div className="empty">
          <img src={`${import.meta.env.BASE_URL}brand/empty.webp`} alt="" />
          <p>这片星域还没有词。换个筛选条件试试。</p>
        </div>
      ) : view === "grid" ? (
        <VirtualGrid items={list} cards={cards} manualStatuses={manualStatuses} />
      ) : (
        <VirtualList items={list} cards={cards} manualStatuses={manualStatuses} />
      )}
    </div>
  );
}

function useWindowRange(
  container: React.RefObject<HTMLDivElement | null>,
  rowHeight: number,
  rows: number,
  overscan = 4,
) {
  const [range, setRange] = useState<[number, number]>([0, 12]);
  useLayoutEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = container.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const first = Math.max(0, Math.floor(-top / rowHeight) - overscan);
      const last = Math.min(
        rows,
        Math.ceil((window.innerHeight - top) / rowHeight) + overscan,
      );
      setRange((r) => (r[0] === first && r[1] === last ? r : [first, last]));
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      cancelAnimationFrame(raf);
    };
  }, [container, rowHeight, rows, overscan]);
  return range;
}

function useWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    setW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function VirtualGrid({
  items,
  cards,
  manualStatuses,
}: {
  items: WordRef[];
  cards: Record<string, CardState>;
  manualStatuses: Record<string, "learning" | "mastered">;
}) {
  const atlas = useAtlas();
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const gap = width < 560 ? 10 : 16;
  const cols = Math.max(
    2,
    Math.floor((width + gap) / ((width < 560 ? 150 : 188) + gap)),
  );
  const cell = (width - gap * (cols - 1)) / cols;
  const rowH = cell + (width < 560 ? 62 : 74) + gap;
  const rows = Math.ceil(items.length / cols);
  const [a, b] = useWindowRange(box, rowH, rows);
  const visible: React.ReactNode[] = [];
  if (width > 0)
    for (let r = a; r < b; r++)
      for (let c = 0; c < cols; c++) {
        const w = items[r * cols + c];
        if (!w) break;
        const card = cards[w.id];
        const st = wordStatus(card, manualStatuses[w.id]);
        visible.push(
          <button
            key={w.id}
            className={`tile ${st ? `is-${st}` : ""}`}
            style={{
              transform: `translate(${c * (cell + gap)}px, ${r * rowH}px)`,
              width: cell,
              height: rowH - gap,
            }}
            onClick={(e) => morphFrom(e.currentTarget.querySelector<HTMLElement>(".illo"), () => openWord(w.id))}
          >
            <Illustration
              src={atlas.img(w, "thumb")}
              word={w.word}
              topic={w.topic}
            />
            <span className="tile-no">
              № {String(w.order + 1).padStart(4, "0")}
            </span>
            <span className="tile-text">
              <span className="tile-word" lang="en">
                {w.word}
              </span>
              <span className={`tile-lv lv-${atlas.cefr[w.cefr]}`}>
                {atlas.cefr[w.cefr]}
              </span>
              <span className="tile-zh">{w.zh}</span>
            </span>
          </button>,
        );
      }
  return (
    <div ref={box} className="vgrid" style={{ height: rows * rowH }}>
      {visible}
    </div>
  );
}

function VirtualList({
  items,
  cards,
  manualStatuses,
}: {
  items: WordRef[];
  cards: Record<string, CardState>;
  manualStatuses: Record<string, "learning" | "mastered">;
}) {
  const atlas = useAtlas();
  const accent = useStore((s) => s.settings.accent);
  const box = useRef<HTMLDivElement>(null);
  const rowH = 68;
  const [a, b] = useWindowRange(box, rowH, items.length, 8);
  return (
    <div ref={box} className="vlist" style={{ height: items.length * rowH }}>
      {items.slice(a, b).map((w, i) => {
        const card = cards[w.id];
        return (
          <div
            key={w.id}
            className="row"
            style={{ transform: `translateY(${(a + i) * rowH}px)` }}
            onClick={() => openWord(w.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && openWord(w.id)}
          >
            <Illustration
              src={atlas.img(w, "thumb")}
              word={w.word}
              topic={w.topic}
              className="row-art"
            />
            <span className="row-word" lang="en">
              {w.word}
            </span>
            <span className="row-ipa ipa">{w.ipa}</span>
            <span className="row-zh">{w.zh}</span>
            <span className={`row-dot ${wordStatus(card, manualStatuses[w.id]) ? `is-${wordStatus(card, manualStatuses[w.id])}` : ""}`} />
            <Speak
              url={atlas.audio(w, accent)}
              text={w.word}
              accent={accent}
              size="sm"
            />
          </div>
        );
      })}
    </div>
  );
}
