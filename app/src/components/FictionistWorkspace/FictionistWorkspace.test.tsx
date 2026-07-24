import { App as AntdApp } from 'antd';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProfessionalTask } from '../../features/professionalTasks/domain';
import {
  CHAPTER_CANON_CHECK_RESULT_ROLE,
  CHAPTER_CONTEXT_RESULT_ROLE,
} from '../../features/fictionist/chapterInsights';
import FictionistWorkspace, {
  FictionBookCover,
  InsightOutputPanel,
  PendingDraftInsights,
} from './FictionistWorkspace';
import { buildFictionWorkflowEntries } from './workflowEntries';

type FictionistSection = 'library' | 'chapters' | 'outline' | 'canon' | 'timeline' | 'workflows';
const workspaceSource = readFileSync(
  new URL('./FictionistWorkspace.tsx', import.meta.url),
  'utf8',
);

function renderWorkspace(initialSection?: FictionistSection): string {
  return renderToStaticMarkup(
    <AntdApp>
      <FictionistWorkspace initialSection={initialSection} />
    </AntdApp>,
  );
}

describe('fictionist workspace mock', () => {
  it('renders the library as a categorized bookshelf', () => {
    const html = renderWorkspace();

    expect(html).toContain('小说家');
    expect(html).toContain('工作流中心');
    expect(html).toContain('我的书架');
    expect(html).toContain('书库统计');
    expect(html).toContain('总字数');
    expect(html).toContain('章节');
    expect(html).toContain('aria-label="书籍状态筛选"');
    expect(html).toContain('aria-label="作品分类筛选"');
    expect(html).toContain('按创作进度');
    expect(html).toContain('作品分类');
    expect(html).toContain('长篇悬疑');
    expect(html).not.toContain('新建作品');
    expect((html.match(/新建一本书/g) ?? []).length).toBe(1);
    expect(html).toContain('雾港来信');
    expect(html).toContain('打开《雾港来信》');
    expect(html).toContain('导出《雾港来信》');
    expect(html).toContain('编辑《雾港来信》');
    expect(html).toContain('删除《雾港来信》');
    expect(html).not.toContain('作品功能');
    expect(html).not.toContain('设定库');
    expect(workspaceSource).not.toContain('版本历史');
    expect(workspaceSource).toContain('exportFictionProjectText');
  });

  it('shows a custom cover without rendering the book title on the cover', () => {
    const html = renderToStaticMarkup(
      <FictionBookCover
        title="雾港来信"
        genre="长篇悬疑"
        coverTone="teal"
        coverImage="data:image/png;base64,iVBORw0KGgo="
      />,
    );

    expect(html).toContain('fictionist-book-cover--custom');
    expect(html).toContain('<img');
    expect(html).not.toContain('雾港来信');
  });

  it('provides persisted editing controls for category, status and cover', () => {
    expect(workspaceSource).toContain('作品分类');
    expect(workspaceSource).toContain('书籍状态');
    expect(workspaceSource).toContain('选择自定义书籍封面');
    expect(workspaceSource).toContain('移除自定义封面');
    expect(workspaceSource).toContain('为新作品选择自定义书籍封面');
    expect(workspaceSource).toContain('createProject(title, newBookGenre, newBookCover)');
  });

  it('centers fictionist dialogs in the desktop viewport', () => {
    expect(workspaceSource.match(/\bcentered\b/gu) ?? []).toHaveLength(18);
  });

  it('provides persistent volume and chapter management controls', () => {
    const html = renderWorkspace('chapters');

    expect(html).toContain('第一卷 · 潮汐失语');
    expect(html).toContain('在“第一卷 · 潮汐失语”中新建章节');
    expect(html).toContain('管理“第一卷 · 潮汐失语”');
    expect(html).toContain('管理《七号泊位》');
    expect(workspaceSource).toContain("{ key: 'rename', label: '重命名章节'");
    expect(workspaceSource).toContain("{ key: 'delete', label: '删除章节'");
    expect(workspaceSource).toContain("else if (key === 'delete') confirmDeleteChapter(chapter.id)");
    expect(workspaceSource).toContain("createStoredChapter(targetVolumeId)");
    expect(workspaceSource).toContain('reorderVolume(volumeId, targetIndex)');
    expect(workspaceSource).toContain('moveStoredChapter(chapterId, targetVolumeId, targetIndex)');
  });

  it('opens a real full-book search surface instead of demo feedback', () => {
    expect(workspaceSource).toContain('全书搜索 ·');
    expect(workspaceSource).toContain('searchCurrentProject(searchValue)');
    expect(workspaceSource).toContain('搜索章节名、卷名或正文');
    expect(workspaceSource).not.toContain("message.info('演示：全书搜索')");
    expect(workspaceSource).toContain('replaceCurrentProjectText(search, bookReplaceText)');
  });

  it('renders project tools as a second-level workspace after opening a book', () => {
    const html = renderWorkspace('chapters');

    expect(html).toContain('作品功能');
    expect(html).toContain('正文');
    expect(html).toContain('大纲');
    expect(html).toContain('设定库');
    expect(html).toContain('时间线');
    expect(html).toContain('工作流绑定');
    expect(html).toContain('返回书架');
    expect(html).not.toContain('返回书库切换作品');
    expect(html).not.toContain('fictionist-project-switcher');
    expect(html).not.toContain('书架分类');
    expect(workspaceSource).not.toContain("{ id: 'workflows', label: '工作流'");
    expect(workspaceSource).not.toContain('featured: true');
    expect(workspaceSource).toContain("{ label: '工作流中心', value: 'workflows'");
  });

  it('renders the chapter editor baseline', () => {
    const html = renderWorkspace('chapters');

    expect(html).toContain('卷与章节');
    expect(html).toContain('章节正文编辑区');
    expect(html).toContain('续写下一章');
    expect(html).toContain('本章上下文');
    expect(html).toContain('本章还没有上下文分析结果');
    expect(html).toContain('运行“AI 起草”或“续写下一章”后');
    expect(html).not.toContain('调查记者 · 知道蓝墨水来信');
    expect(html).toContain('七号泊位');
    expect(workspaceSource).toContain("writingMode === 'draft-current' ? '本章名称' : '下一章名称'");
    expect(workspaceSource).toContain('proposedChapterTitle: normalizedChapterTitle');
    expect(workspaceSource).toContain('chapterInsightResult(professionalTasks, selectedChapter)');
    expect(workspaceSource).toContain('data.resultRole === CHAPTER_CONTEXT_RESULT_ROLE');
    expect(workspaceSource).toContain('aria-label="章节状态"');
    expect(workspaceSource).toContain("event.key.toLowerCase() !== 's'");
  });

  it('renders the latest writing task insight output instead of sample context', () => {
    const html = renderToStaticMarkup(
      <InsightOutputPanel
        kind="context"
        output={{
          nodeId: 'context-node',
          resultRole: CHAPTER_CONTEXT_RESULT_ROLE,
          outputFormat: 'markdown',
          label: '上下文分析',
          content: '## 场景状态\n\n时间：凌晨 02:46',
        }}
      />,
    );

    expect(html).toContain('上下文分析');
    expect(html).toContain('场景状态');
    expect(html).toContain('凌晨 02:46');
    expect(html).not.toContain('本章还没有上下文分析结果');
  });

  it('shows context and canon outputs beside a pending chapter draft', () => {
    const task: ProfessionalTask = {
      id: 'pending-writing-task',
      packageId: 'fictionist',
      taskType: 'continue-chapter',
      taskLabel: '续写下一章',
      sourceLabel: '《雾港来信》· 七号泊位',
      status: 'review_required',
      sourceRefs: [{ type: 'fiction-chapter', id: 'chapter-1', revision: 1 }],
      contextSnapshot: { title: '章节上下文', format: 'markdown', content: '来源正文' },
      expectedResult: { role: 'fictionist.chapter-draft', outputFormat: 'txt' },
      packagePayload: {},
      outputs: [
        {
          nodeId: 'context-node',
          resultRole: CHAPTER_CONTEXT_RESULT_ROLE,
          outputFormat: 'markdown',
          label: '上下文分析',
          content: '未回收线索：蓝墨水来信',
        },
        {
          nodeId: 'check-node',
          resultRole: CHAPTER_CANON_CHECK_RESULT_ROLE,
          outputFormat: 'markdown',
          label: '设定检查',
          content: '未发现设定冲突',
        },
      ],
      createdAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-07-25T00:00:00.000Z',
    };

    const html = renderToStaticMarkup(<PendingDraftInsights task={task} />);

    expect(html).toContain('本次任务分析');
    expect(html).toContain('蓝墨水来信');
    expect(html).toContain('未发现设定冲突');
    expect(html).not.toContain(CHAPTER_CONTEXT_RESULT_ROLE);
    expect(html).not.toContain(CHAPTER_CANON_CHECK_RESULT_ROLE);
  });

  it('explains when the writing workflow did not contain the selected insight node', () => {
    const task: ProfessionalTask = {
      id: 'task-without-check',
      packageId: 'fictionist',
      taskType: 'draft-chapter',
      taskLabel: 'AI 起草',
      sourceLabel: '《雾港来信》· 七号泊位',
      status: 'accepted',
      sourceRefs: [],
      contextSnapshot: { title: '章节上下文', format: 'markdown', content: '' },
      expectedResult: { role: 'fictionist.chapter-draft', outputFormat: 'txt' },
      packagePayload: {},
      outputs: [],
      createdAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-24T00:00:00.000Z',
    };
    const html = renderToStaticMarkup(
      <InsightOutputPanel
        kind="checks"
        task={task}
        nodeAvailable={false}
      />,
    );

    expect(html).toContain(`本次工作流未添加“设定检查”节点`);
    expect(html).toContain('添加“设定检查”节点后重新运行');
    expect(html).not.toContain(CHAPTER_CANON_CHECK_RESULT_ROLE);
  });

  it('renders a persistent outline editor bound to the existing volume and chapters', () => {
    const html = renderWorkspace('outline');

    expect(html).toContain('大纲结构');
    expect(html).toContain('故事总纲');
    expect(html).toContain('第一卷 · 潮汐失语');
    expect(html).toContain('章节纲要');
    expect(html).toContain('一句话梗概');
    expect(html).toContain('核心冲突');
    expect(html).toContain('结局方向');
    expect(html).toContain('详细大纲');
    expect(html).toContain('导入大纲');
    expect(html).toContain('AI 优化');
    expect(html).toContain('保存大纲');
    expect(workspaceSource).toContain('saveProjectOutline(activeProjectId, input)');
    expect(workspaceSource).toContain("selectOutlineTarget({ kind: 'chapter', id: chapter.id })");
  });

  it('supports direct outline import and review-gated AI outline workflows', () => {
    expect(workspaceSource).toContain('void importOutlineFile(file)');
    expect(workspaceSource).toContain('applyDirectOutlineImport(');
    expect(workspaceSource).toContain("createOutlineWorkflowTask('import')");
    expect(workspaceSource).toContain("createOutlineWorkflowTask('optimize')");
    expect(workspaceSource).toContain('role: OUTLINE_RESULT_ROLE');
    expect(workspaceSource).toContain("task.status !== 'review_required'");
    expect(workspaceSource).toContain('currentOutline.updatedAt !== payload.sourceOutlineUpdatedAt');
    expect(workspaceSource).toContain('applyOutlineWorkflowResult(currentOutline');
  });

  it('imports a local text file into the writing requirements field', () => {
    expect(workspaceSource).toContain("import { TEXT_EXTENSIONS, fileToText, isTextFile } from '../../lib/textFile'");
    expect(workspaceSource).toContain('ref={writingRequirementsInputRef}');
    expect(workspaceSource).toContain('void importWritingRequirements(file)');
    expect(workspaceSource).toContain('导入本地文本');
    expect(workspaceSource).toContain('icon={<DownloadOutlined />}');
    expect(workspaceSource).toContain('setContinuationRequirements(text)');
  });

  it('renders the canon baseline', () => {
    const html = renderWorkspace('canon');

    expect(html).toContain('作品事实库');
    expect(html).toContain('设定库');
    expect(html).toContain('新建设定');
    expect(html).toContain('林砚');
    expect(html).toContain('旧海关钟塔');
    expect(workspaceSource).toContain('void importCanonFile(file)');
    expect(workspaceSource).toContain('void exportCanon()');
  });

  it('renders the timeline baseline', () => {
    const html = renderWorkspace('timeline');

    expect(html).toContain('事件与章节同步');
    expect(html).toContain('故事时间线');
    expect(html).toContain('新增事件');
    expect(html).toContain('七号泊位因事故永久封闭');
    expect(html).toContain('编辑时间线事件“七号泊位因事故永久封闭”');
    expect(html).toContain('删除时间线事件“七号泊位因事故永久封闭”');
    expect(html).toContain('全部事件');
    expect(workspaceSource).toContain('visibleTimelineEvents.map');
    expect(workspaceSource).toContain('setTimelineKindFilter(filter)');
    expect(workspaceSource).toContain('reorderTimelineEvent(event.id, targetIndex)');
    expect(workspaceSource).toContain('void importTimelineFile(file)');
  });

  it('renders the workflow baseline', () => {
    const html = renderWorkspace('workflows');

    expect(html).toContain('小说家专业包 · 所有作品共享');
    expect(html).toContain('工作流中心');
    expect(html).toContain('新建工作流');
    expect(html).toContain('小说家内置');
    expect(html).toContain('用户创建');
    expect(html).toContain('配置主流程');
    expect(html).toContain('查看备用流程');
    expect(html).toContain('备用开关');
    expect(html).toContain('主流程失败时运行备用流程');
    expect(html).toContain('fictionist-workflow-fallback-control');
    expect(html).not.toContain('fictionist-workflow-policy-row');
    expect(html).not.toContain('返回书架');
    expect(html).not.toContain('aria-label="作品功能"');
    expect(html).not.toContain('任务入口');
    expect(html).not.toContain('常用流程参考');
    expect(html).not.toContain('章节连续性检查');
    expect(html).not.toContain('配置任务');
    expect(html).toContain('AI 起草');
    expect(html).not.toContain('AI 起草本章');
    expect(html).not.toMatch(/[12]\s*号(?:主|备用|保底)流程/u);
    expect(html).toContain('续写下一章');
    expect(html).toContain('导入大纲整理');
    expect(html).toContain('大纲优化');
    expect(workspaceSource).toContain('FICTIONIST_SYSTEM_WORKFLOW_CATALOG_SIGNATURE');
    expect(workspaceSource).toContain('systemWorkflowCatalogSignature,\n  ]);');
    expect(workspaceSource).toContain('isSystemWorkflowSpecModified');
    expect(workspaceSource).toContain('isWorkflowFallbackEnabled');
    expect(workspaceSource).toContain('setFallbackEnabled(FICTIONIST_PACKAGE_ID');
    expect(workspaceSource).toContain('createWorkflowCanvas(name');
    expect(workspaceSource).toContain('confirmDeleteWorkflow(workflow)');
    expect(workspaceSource).toContain('renameUserWorkflow(workflow)');
    expect(workspaceSource).toContain('duplicateUserWorkflow(workflow)');
    expect(workspaceSource).toContain('restoreSystemWorkflow(workflow.key, primary)');
    expect(workspaceSource).toContain('aria-label={`删除工作流“${workflow.name}”`}');
    expect(workspaceSource).toContain('const openCanvases = useCanvasStore');
    expect(workspaceSource).toContain('workflowId: origin.taskId');
    expect(workspaceSource).not.toContain('const openWritingWorkflow');
    expect(workspaceSource).toContain('requestAppView(\'workspace\')');
    expect(workspaceSource).toContain("setWorkspaceReturn({");
    expect(workspaceSource).toContain("target: 'fictionist-workflows'");
    expect(workspaceSource).toContain("setFictionistEntrySection('workflows')");
    expect(workspaceSource).toContain('historyDescriptor: {');
    expect(workspaceSource).toContain("actionLabel: draftingCurrent ? 'AI起草' : '续写'");
  });

  it('excludes an unsaved task canvas from package workflows', () => {
    const taskOrigin = {
      packageId: 'fictionist',
      taskId: 'task-draft-1',
      taskType: 'draft-chapter',
    } as const;
    const entries = buildFictionWorkflowEntries({
      projectId: 'mist-harbor',
      savedCanvases: [],
      openCanvases: [{
        id: 'task-canvas',
        name: '雾港来信 · AI 起草',
        nodes: [],
        edges: [],
        origin: taskOrigin,
        workflowRef: {
          packageId: 'fictionist',
          projectId: 'mist-harbor',
          workflowId: taskOrigin.taskId,
        },
      }],
      professionalTasks: {},
    });

    expect(entries).toEqual([]);
  });

  it('excludes legacy task canvases from package workflows', () => {
    const taskOrigin = {
      packageId: 'fictionist',
      taskId: 'task-legacy',
      taskType: 'continue-chapter',
    } as const;
    const entries = buildFictionWorkflowEntries({
      projectId: 'mist-harbor',
      savedCanvases: [{
        id: 'saved-legacy',
        name: '雾港来信 · 续写下一章',
        nodes: [],
        edges: [],
        savedAt: '2026-07-23T00:00:00.000Z',
        origin: taskOrigin,
      }],
      openCanvases: [],
      professionalTasks: {
        [taskOrigin.taskId]: {
          id: taskOrigin.taskId,
          packageId: 'fictionist',
          taskType: taskOrigin.taskType,
          taskLabel: '续写下一章',
          sourceLabel: '雾港来信 · 七号泊位',
          status: 'ready',
          sourceRefs: [],
          contextSnapshot: { title: '续写任务', format: 'markdown', content: '' },
          expectedResult: { role: 'fictionist.chapter-draft', outputFormat: 'txt' },
          packagePayload: {
            projectId: 'mist-harbor',
            sourceChapterId: 'chapter-1',
            sourceVolumeId: 'volume-1',
            sourceRevision: 0,
            proposedChapterTitle: '续写下一章',
            targetWordCount: 2000,
          },
          outputs: [],
          createdAt: '2026-07-23T00:00:00.000Z',
          updatedAt: '2026-07-23T00:00:00.000Z',
        },
      },
    });

    expect(entries).toEqual([]);
  });

  it('shows a recoverable error instead of sample data when hydration fails', () => {
    expect(workspaceSource).toContain("hydrationState === 'error'");
    expect(workspaceSource).toContain('小说数据加载失败');
    expect(workspaceSource).toContain('重新加载');
  });

  it('renders an intentional empty editor for a project without chapters', () => {
    expect(workspaceSource).toContain("section === 'chapters' && selectedChapter");
    expect(workspaceSource).toContain('这部作品还没有章节');
    expect(workspaceSource).toContain('新建空白章节');
    expect(workspaceSource).toContain('AI 起草第一章');
  });

  it('uses real persistence copy for creation and saving', () => {
    expect(workspaceSource).toContain('作品和章节保存在本机');
    expect(workspaceSource).not.toContain('关闭软件后新建内容不会保留');
    expect(workspaceSource).not.toContain('演示：已在书库中新建');
    expect(workspaceSource).not.toContain('演示：已保存');
  });

  it('guards unsaved content when leaving the workspace or closing the window', () => {
    expect(workspaceSource).toContain('registerAppViewGuard');
    expect(workspaceSource).toContain("window.addEventListener('beforeunload'");
    expect(workspaceSource).toContain('saveCurrentChapter');
  });
});
