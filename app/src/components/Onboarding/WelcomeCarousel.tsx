import { Button } from 'antd';
import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  RobotOutlined,
  SettingOutlined,
  ToolOutlined,
} from '@ant-design/icons';

const PAGES = [
  {
    kicker: '01 · 工具用途',
    title: '把复杂任务变成可运行的协作流程',
    description:
      '创建不同职责的 Agent，把它们放入画布并连接起来。上游结果会沿连线交给下游，最终形成清晰、可复用的工作流。',
    visual: 'workflow',
  },
  {
    kicker: '02 · 认识姬子',
    title: '让姬子协助规划、配置与诊断',
    description:
      '姬子理解整个画布，可以帮你拆解任务、设计 Agent、检查配置，并在运行失败时分析原因和给出修复建议。',
    visual: 'jizi',
  },
  {
    kicker: '03 · 首次设置',
    title: '连接模型，让工作台真正运行起来',
    description:
      '首先配置并测试一个可用模型。联网搜索和姬子能力可按需启用，完成后将进入新手示例画布。',
    visual: 'settings',
  },
] as const;

function MotionVisual({ type }: { type: (typeof PAGES)[number]['visual'] }) {
  if (type === 'workflow') {
    return (
      <div className="onboarding-welcome__motion onboarding-welcome__motion--workflow">
        <div className="onboarding-workflow-heading">
          <span>WORKFLOW</span>
          <em>从目标到交付物</em>
        </div>
        <div className="onboarding-workflow-flow">
          <section className="onboarding-workflow-stage onboarding-workflow-stage--brief">
            <small>01</small>
            <i><FileTextOutlined /></i>
            <b>需求输入</b>
            <em>明确目标与约束</em>
          </section>
          <span className="onboarding-workflow-connector" aria-hidden="true"><i /></span>
          <section className="onboarding-workflow-stage onboarding-workflow-stage--collaborate">
            <small>02</small>
            <i><ApartmentOutlined /></i>
            <b>Agent 协作</b>
            <em>分析与整理串联</em>
          </section>
          <span className="onboarding-workflow-connector" aria-hidden="true"><i /></span>
          <section className="onboarding-workflow-stage onboarding-workflow-stage--deliver">
            <small>03</small>
            <i><CheckCircleOutlined /></i>
            <b>形成交付物</b>
            <em>结果清晰可复用</em>
          </section>
        </div>
        <div className="onboarding-workflow-summary">
          <span>任务已拆解</span><i />
          <span>顺序已连接</span><i />
          <span>输出可复用</span>
        </div>
      </div>
    );
  }
  if (type === 'jizi') {
    return (
      <div className="onboarding-welcome__motion onboarding-welcome__motion--jizi">
        <div className="onboarding-jizi-request">
          <span>目标</span>
          <strong>规划一条可执行的需求分析流程</strong>
        </div>
        <div className="onboarding-jizi-signal" aria-hidden="true" />
        <div className="onboarding-jizi-core">
          <span className="onboarding-jizi-core__icon"><RobotOutlined /></span>
          <span className="onboarding-jizi-core__copy">
            <b>姬子</b>
            <em>正在理解画布与上下文</em>
          </span>
          <i className="onboarding-jizi-core__status">协作中</i>
        </div>
        <div className="onboarding-jizi-paths" aria-hidden="true">
          <i /><i /><i />
        </div>
        <div className="onboarding-jizi-results">
          <span className="onboarding-jizi-result onboarding-jizi-result--plan">
            <i><ApartmentOutlined /></i>
            <span><b>规划</b><em>拆解角色与顺序</em></span>
          </span>
          <span className="onboarding-jizi-result onboarding-jizi-result--configure">
            <i><SettingOutlined /></i>
            <span><b>配置</b><em>检查节点与模型</em></span>
          </span>
          <span className="onboarding-jizi-result onboarding-jizi-result--diagnose">
            <i><ToolOutlined /></i>
            <span><b>诊断</b><em>定位问题并修复</em></span>
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="onboarding-welcome__motion onboarding-welcome__motion--settings">
      {[
        ['M', '模型服务', '必须配置'],
        ['S', '联网搜索', '可选'],
        ['J', '姬子', '可选'],
      ].map(([icon, label, status]) => (
        <span className="onboarding-motion-setting" key={label}>
          <i>{icon}</i><b>{label}</b><em>{status}</em>
        </span>
      ))}
    </div>
  );
}

export default function WelcomeCarousel({
  page,
  onPrevious,
  onNext,
}: {
  page: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const safePage = Math.min(Math.max(page, 0), PAGES.length - 1);
  const current = PAGES[safePage];
  return (
    <div className="onboarding-welcome">
      <div className="onboarding-welcome__progress">
        {PAGES.map((item, index) => (
          <span
            key={item.kicker}
            className={index === safePage ? 'is-active' : ''}
          />
        ))}
      </div>
      <div className="onboarding-welcome__body">
        <div className="onboarding-welcome__copy">
          <small>{current.kicker}</small>
          <h2>{current.title}</h2>
          <p>{current.description}</p>
        </div>
        <MotionVisual type={current.visual} />
      </div>
      <div className="onboarding-welcome__footer">
        <span>{safePage + 1} / {PAGES.length}</span>
        <div>
          {safePage > 0 && (
            <Button icon={<ArrowLeftOutlined />} onClick={onPrevious}>上一页</Button>
          )}
          <Button type="primary" onClick={onNext}>
            {safePage === PAGES.length - 1 ? '开始配置' : '下一页'}
            {safePage < PAGES.length - 1 && <ArrowRightOutlined />}
          </Button>
        </div>
      </div>
    </div>
  );
}
