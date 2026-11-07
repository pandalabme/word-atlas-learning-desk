import type { WordStatus } from "../store/store";

export function StatusSwitch({
  word,
  status,
  manualStatus,
  onChange,
  onReset,
}: {
  word: string;
  status: WordStatus | null;
  manualStatus?: WordStatus;
  onChange: (status: WordStatus) => void;
  onReset: () => void;
}) {
  const mastered = status === "mastered";
  const currentLabel = mastered ? "已掌握" : "学习中";
  const sourceLabel = manualStatus ? `手动${currentLabel}` : `自动${currentLabel}`;
  return (
    <div className="status-control" onClick={(event) => event.stopPropagation()}>
      <label className="toggle status-switch" title={`${sourceLabel}，点击切换`}>
        <input
          type="checkbox"
          role="switch"
          checked={mastered}
          onChange={(event) => onChange(event.target.checked ? "mastered" : "learning")}
          aria-label={`${word}状态：${currentLabel}，点击切换`}
        />
        <span className="switch" aria-hidden="true" />
      </label>
      {manualStatus && (
        <button className="status-auto" type="button" onClick={onReset} title="恢复自动状态">
          自动
        </button>
      )}
    </div>
  );
}
