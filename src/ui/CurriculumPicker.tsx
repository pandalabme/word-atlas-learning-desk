import { useId } from "react";
import type { Curriculum } from "../curriculum/types";
import "../styles/curriculum.css";

export interface CurriculumPickerProps {
  curricula: Curriculum[];
  value: string;
  onChange: (id: string) => void;
  compact?: boolean;
}

function shortLabel(id: string): string {
  return id.replace(/[-_]+/g, " ").toLocaleUpperCase();
}

export function CurriculumPicker({ curricula, value, onChange, compact = false }: CurriculumPickerProps) {
  const selected = curricula.find((curriculum) => curriculum.id === value);
  const instanceId = useId();
  const selectId = `${instanceId}-select`;
  const titleId = `${instanceId}-title`;
  const summaryId = `${instanceId}-summary`;

  return (
    <section className={`curriculum-picker${compact ? " curriculum-picker--compact" : ""}`} aria-labelledby={titleId}>
      <div className="curriculum-picker__heading">
        <div>
          <p className="curriculum-picker__eyebrow">LEARNING PATH</p>
          <h2 className="curriculum-picker__title" id={titleId}>选择学习路径</h2>
        </div>
        {selected && <span className="curriculum-picker__tag" aria-label={`路径短标签：${shortLabel(selected.id)}`}>{shortLabel(selected.id)}</span>}
      </div>

      <label className="curriculum-picker__label" htmlFor={selectId}>学习内容</label>
      <select
        className="curriculum-picker__select"
        id={selectId}
        value={selected?.id ?? ""}
        onChange={(event) => onChange(event.currentTarget.value)}
        aria-describedby={selected ? summaryId : undefined}
      >
        {!selected && <option value="" disabled>请选择学习路径</option>}
        {curricula.map((curriculum) => (
          <option key={curriculum.id} value={curriculum.id}>
            {curriculum.name} · {curriculum.count.toLocaleString("zh-CN")} 词
          </option>
        ))}
      </select>

      {selected ? (
        <div className="curriculum-picker__summary" id={summaryId} aria-live="polite" aria-atomic="true">
          <div className="curriculum-picker__summary-main">
            <span className="curriculum-picker__name">{selected.name}</span>
            <span className="curriculum-picker__count">{selected.count.toLocaleString("zh-CN")} 个词</span>
          </div>
          {!compact && selected.description && <p className="curriculum-picker__description">{selected.description}</p>}
          {!selected.attribution.official && (
            <p className="curriculum-picker__attribution">
              <span className="curriculum-picker__unofficial">非官方词表</span>
              <span>{selected.attribution.note || `由${selected.attribution.curator}整理`}</span>
            </p>
          )}
        </div>
      ) : (
        <p className="curriculum-picker__empty" role="status">暂无可用学习路径</p>
      )}
    </section>
  );
}
