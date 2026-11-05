import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useAtlas, useCurricula, useCurriculum } from "../atlas/context";
import { store } from "../store/store";
import { CurriculumPicker } from "../ui/CurriculumPicker";

const LEVELS = [
  ["A2", "基础", "先巩固高频日常词"],
  ["B1", "进阶", "进入完整语境学习"],
  ["B2", "中高", "加强学术与抽象表达"],
  ["C1", "高级", "挑战更精准的高级词汇"],
];

export function Onboarding() {
  const atlas = useAtlas();
  const currentCurriculum = useCurriculum();
  const curricula = useCurricula();
  const [level, setLevel] = useState(1);
  const [goal, setGoal] = useState(10);
  const [curriculumId, setCurriculumId] = useState(currentCurriculum.id);
  const selectedCurriculum = curricula.find((item) => item.id === curriculumId) ?? currentCurriculum;
  const finish = () => store.settings({ onboarded: true, curriculum: selectedCurriculum.id, startLevel: atlas.cefr.indexOf(LEVELS[level][0]), dailyNew: goal });
  return (
    <div className="onboard" role="dialog" aria-modal="true" aria-label="欢迎">
      <div className="onboard-card">
        <img className="onboard-art" src={`${import.meta.env.BASE_URL}brand/hero.webp`} alt="" />
        <div className="onboard-body">
          <p className="eyebrow">欢迎来到词光</p>
          <h1 className="display">
            {selectedCurriculum.count.toLocaleString()} 颗星，
            <br />
            等你一颗颗点亮。
          </h1>
          <CurriculumPicker curricula={curricula} value={selectedCurriculum.id} onChange={setCurriculumId} compact />
          <fieldset>
            <legend>你从哪里出发？</legend>
            <div className="choice-grid">
              {LEVELS.map(([code, name, desc], i) => (
                <button key={code} className={`choice ${level === i ? "is-on" : ""}`} onClick={() => setLevel(i)} aria-pressed={level === i}>
                  <span className={`chip chip-level lv-${code}`}>{code}</span>
                  <b>{name}</b>
                  <small>{desc}</small>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>每天点亮几颗新星？</legend>
            <div className="segmented segmented-wide">
              {[5, 10, 15, 20].map((n) => (
                <button key={n} className={goal === n ? "is-on" : ""} onClick={() => setGoal(n)} aria-pressed={goal === n}>
                  {n} 颗{n === 10 ? " · 推荐" : ""}
                </button>
              ))}
            </div>
          </fieldset>
          <button className="btn btn-primary btn-xl" onClick={finish}>
            出发 <ArrowRight size={20} />
          </button>
          <p className="muted">不用注册。进度只留在这台设备上，随时可以在「我的」里修改。</p>
        </div>
      </div>
    </div>
  );
}
