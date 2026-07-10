import { useEffect, useState } from 'react';
import { Modal, Input, Select, App } from 'antd';
import {
  useAgentStore,
  blankDraft,
  type AgentDraft,
} from '../stores/agentStore';
import { useAgentEditorStore } from '../stores/agentEditorStore';
import { useModelOptions } from '../stores/modelStore';
import { useToolTags } from '../stores/toolStore';
import { packModelRef, unpackModelRef, isValidModelRef } from '../lib/modelRef';

// Agent 配置弹窗:全局挂一处,由 agentEditorStore 驱动开合与「编辑/新建」两态。
function AgentConfigModal() {
  const { message } = App.useApp();
  const open = useAgentEditorStore((s) => s.open);
  const editingId = useAgentEditorStore((s) => s.editingId);
  const close = useAgentEditorStore((s) => s.close);

  const addAgent = useAgentStore((s) => s.addAgent);
  const updateAgent = useAgentStore((s) => s.updateAgent);

  const modelOptions = useModelOptions();
  const toolTags = useToolTags();

  const [draft, setDraft] = useState<AgentDraft>(blankDraft);

  // 打开时回填:编辑态读现有 Agent,新建态清空。依赖 open/editingId 变化触发。
  useEffect(() => {
    if (!open) return;
    if (editingId) {
      const a = useAgentStore.getState().agents.find((x) => x.id === editingId);
      if (a) {
        setDraft({
          name: a.name,
          description: a.description,
          systemPrompt: a.systemPrompt,
          toolTags: [...a.toolTags],
          modelRef: a.modelRef ? { ...a.modelRef } : null,
          inputSchemaText: a.inputSchemaText ?? '',
          outputSchemaText: a.outputSchemaText ?? '',
        });
        return;
      }
    }
    setDraft(blankDraft());
  }, [open, editingId]);

  const modelValue = packModelRef(draft.modelRef);
  const modelValid = isValidModelRef(modelValue, modelOptions);

  const onChangeModel = (val: string | undefined) => {
    setDraft((d) => ({ ...d, modelRef: unpackModelRef(val) }));
  };

  const onSave = () => {
    const name = draft.name.trim();
    if (!name) {
      message.warning('请填写 Agent 名称');
      return;
    }
    const payload: AgentDraft = { ...draft, name };
    if (editingId) {
      updateAgent(editingId, payload);
      message.success('已保存');
    } else {
      addAgent(payload);
      message.success('已创建');
    }
    close();
  };

  return (
    <Modal
      title={editingId ? '编辑 Agent' : '新建 Agent'}
      open={open}
      onOk={onSave}
      onCancel={close}
      okText="保存"
      cancelText="取消"
      destroyOnHidden
      mask={{ closable: false }}
      width={560}
    >
      <div className="agent-form">
        <div className="agent-form__field">
          <div className="agent-form__label">名称</div>
          <Input
            value={draft.name}
            maxLength={40}
            placeholder="给这个 Agent 起个名字"
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </div>

        <div className="agent-form__field">
          <div className="agent-form__label">描述</div>
          <Input.TextArea
            value={draft.description}
            autoSize={{ minRows: 2, maxRows: 3 }}
            placeholder="一句话说明这个 Agent 的职责(可选)"
            onChange={(e) =>
              setDraft((d) => ({ ...d, description: e.target.value }))
            }
          />
        </div>

        <div className="agent-form__field">
          <div className="agent-form__label">系统提示词</div>
          <Input.TextArea
            value={draft.systemPrompt}
            autoSize={{ minRows: 5, maxRows: 10 }}
            placeholder="定义 Agent 的角色、任务与输出要求"
            onChange={(e) =>
              setDraft((d) => ({ ...d, systemPrompt: e.target.value }))
            }
          />
        </div>

        <div className="agent-form__field">
          <div className="agent-form__label">工具标签</div>
          <Select
            mode="multiple"
            allowClear
            style={{ width: '100%' }}
            placeholder="选择该 Agent 可用的工具(可多选)"
            value={draft.toolTags}
            onChange={(vals) => setDraft((d) => ({ ...d, toolTags: vals }))}
            options={toolTags}
          />
        </div>

        <div className="agent-form__field">
          <div className="agent-form__label">选用 LLM</div>
          <Select
            allowClear
            style={{ width: '100%' }}
            placeholder={
              modelOptions.length === 0
                ? '尚未配置模型,请到「模型配置」添加'
                : '选择该 Agent 使用的模型'
            }
            disabled={modelOptions.length === 0}
            value={modelValid ? modelValue : undefined}
            onChange={onChangeModel}
            options={modelOptions}
          />
        </div>
      </div>
    </Modal>
  );
}

export default AgentConfigModal;
