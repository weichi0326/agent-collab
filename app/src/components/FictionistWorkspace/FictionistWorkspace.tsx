import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  App,
  Button,
  Drawer,
  Dropdown,
  Input,
  InputNumber,
  Modal,
  Result,
  Segmented,
  Select,
  Spin,
  Switch,
  Tag,
  Tooltip,
} from 'antd';
import {
  ArrowDownOutlined,
  ArrowLeftOutlined,
  ArrowUpOutlined,
  BookOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  DownOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  EyeOutlined,
  FileTextOutlined,
  FolderOutlined,
  MoreOutlined,
  PartitionOutlined,
  PlusOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  RightOutlined,
  SaveOutlined,
  SearchOutlined,
  SwapOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  canonEntriesForProject,
  chaptersForProject,
  countFictionWords,
  createEmptyFictionChapterOutline,
  createEmptyFictionProjectOutline,
  createEmptyFictionVolumeOutline,
  projectWordCount,
  timelineEventsForProject,
  type FictionProjectOutline,
  type FictionChapterStatus,
  type FictionProject,
  type FictionistIndex,
  type FictionProjectStatus,
  type FictionCanonEntry,
  type FictionCanonEntryType,
  type FictionTimelineEvent,
  type FictionTimelineEventKind,
} from '../../features/fictionist/domain';
import { useFictionistStore } from '../../features/fictionist/fictionistStore';
import type { FictionSearchMatch } from '../../features/fictionist/repository';
import {
  exportFictionCollection,
  exportFictionProjectText,
  parseCanonTransfer,
  parseTimelineTransfer,
} from '../../features/fictionist/dataTransfer';
import { FICTIONIST_AGENT_IDS } from '../../features/fictionist/agents';
import {
  CHAPTER_CANON_CHECK_RESULT_ROLE,
  CHAPTER_CONTEXT_RESULT_ROLE,
  chapterInsightNodeAvailability,
  chapterInsightResult,
} from '../../features/fictionist/chapterInsights';
import {
  buildContinuationSnapshot,
  chapterWritingMode,
  CHAPTER_DRAFT_RESULT_ROLE,
  CONTINUE_CHAPTER_TASK_TYPE,
  continuationPayload,
  DRAFT_CHAPTER_TASK_TYPE,
  FICTIONIST_PACKAGE_ID,
  isFictionistChapterWritingTaskType,
  isFictionistContinuationPayload,
  type ChapterWritingMode,
} from '../../features/fictionist/continuation';
import {
  FICTIONIST_SYSTEM_WORKFLOW_CATALOG_SIGNATURE,
  FICTIONIST_SYSTEM_WORKFLOW_SPECS,
  ensureFictionistSystemWorkflows,
  isFictionistSystemWorkflow,
  isSystemWorkflowSpecModified,
  systemWorkflowContentSignature,
  systemWorkflowTemplateForSpec,
  type FictionistSystemWorkflowKey,
} from '../../features/fictionist/systemWorkflows';
import {
  applyDirectOutlineImport,
  applyOutlineWorkflowResult,
  buildOutlineTaskSnapshot,
  FICTIONIST_OUTLINE_WORKFLOW_KEYS,
  isFictionistOutlineTaskPayload,
  MAX_OUTLINE_WORKFLOW_SOURCE_CHARS,
  OUTLINE_IMPORT_TASK_TYPE,
  OUTLINE_OPTIMIZE_TASK_TYPE,
  outlineTargetFromValue,
  outlineTargetLabel,
  outlineTargetValue,
  OUTLINE_RESULT_ROLE,
  parseOutlineWorkflowResult,
  type FictionOutlineImportStrategy,
  type FictionOutlineOptimizationIntensity,
  type FictionOutlineTaskOperation,
  type FictionOutlineWorkflowResult,
} from '../../features/fictionist/outlineWorkflows';
import type {
  ProfessionalTask,
  ProfessionalTaskOutput,
} from '../../features/professionalTasks/domain';
import { useProfessionalTaskStore } from '../../features/professionalTasks/professionalTaskStore';
import {
  isWorkflowFallbackEnabled,
  useWorkflowPolicyStore,
} from '../../features/professionalTasks/workflowPolicyStore';
import {
  buildFictionWorkflowEntries,
  type FictionWorkflowEntry,
} from './workflowEntries';
import OutlineEditor, {
  type ChapterOutlineField,
  type FictionOutlineTarget,
  type StoryOutlineField,
  type VolumeOutlineField,
} from './OutlineEditor';
import CanonEditor, { type CanonEntryDraft } from './CanonEditor';
import TimelineEditor, { type TimelineEventDraft } from './TimelineEditor';
import {
  OutlineImportModal,
  OutlineOptimizeModal,
  OutlineReviewModal,
  type OutlineTargetOption,
} from './OutlineWorkflowDialogs';
import { CANON_ENTRY_TYPE_LABELS } from './canonTypes';
import { subscribeFictionistWorkflowInitialization } from './systemWorkflowInitialization';
import { packModelRef, unpackModelRef } from '../../lib/modelRef';
import { TEXT_EXTENSIONS, fileToText, isTextFile } from '../../lib/textFile';
import { registerAppViewGuard, requestAppView } from '../../settings/appNavigation';
import {
  canvasLimitMessage,
  useCanvasStore,
  validateCanvasName,
  type AgentNodeData,
} from '../../stores/canvasStore';
import { useUiStore } from '../../stores/uiStore';
import { useEnabledModels } from '../../stores/modelStore';
import './FictionistWorkspace.css';

type FictionistSection = 'library' | 'chapters' | 'outline' | 'canon' | 'timeline' | 'workflows';
type ProjectSection = Exclude<FictionistSection, 'library' | 'workflows'>;
type EditorMode = 'edit' | 'preview';
type InspectorMode = 'context' | 'checks';
type StructureEditor =
  | { kind: 'create-volume' }
  | { kind: 'rename-volume'; id: string }
  | { kind: 'rename-chapter'; id: string };

interface OutlineDraftState {
  projectId: string;
  outline: FictionProjectOutline;
}

interface OutlineTargetState {
  projectId: string;
  target: FictionOutlineTarget;
}

interface OutlineReviewState {
  taskId: string;
  result: FictionOutlineWorkflowResult;
}

function outlineWorkflowResultForTask(
  task: ProfessionalTask,
  index: FictionistIndex,
): FictionOutlineWorkflowResult {
  if (!isFictionistOutlineTaskPayload(task.packagePayload)) {
    throw new Error('大纲任务信息无效');
  }
  const output = task.outputs.find((item) => item.resultRole === OUTLINE_RESULT_ROLE);
  if (!output) throw new Error('没有找到可确认的大纲结果');
  return parseOutlineWorkflowResult(
    output.content,
    index,
    task.packagePayload.projectId,
    task.packagePayload.target,
  );
}

const PROJECT_STATUS_LABELS = {
  drafting: '写作中',
  paused: '筹备中',
  archived: '已归档',
} as const;

const PROJECT_STATUS_OPTIONS = Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => ({
  value: value as FictionProjectStatus,
  label,
}));
const LIBRARY_STATUS_FILTERS = [
  { key: 'all', label: '全部书籍' },
  ...PROJECT_STATUS_OPTIONS.map(({ value, label }) => ({ key: `status:${value}`, label })),
];
const CUSTOM_COVER_FILE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_CUSTOM_COVER_FILE_BYTES = 2 * 1024 * 1024;
const WRITING_REQUIREMENTS_FILE_ACCEPT = TEXT_EXTENSIONS.map((extension) => `.${extension}`).join(',');
const MAX_WRITING_REQUIREMENTS_FILE_BYTES = 1024 * 1024;
const WRITING_REQUIREMENTS_CHAR_CAP = 1000;
const MAX_OUTLINE_IMPORT_FILE_BYTES = 2 * 1024 * 1024;
const OUTLINE_FILE_ACCEPT = TEXT_EXTENSIONS.map((extension) => `.${extension}`).join(',');
const SEARCH_FIELD_LABELS: Record<FictionSearchMatch['field'], string> = {
  'chapter-title': '章节名',
  content: '正文',
  'volume-title': '卷名',
};

const TIMELINE_KIND_LABELS: Record<FictionTimelineEventKind, string> = {
  background: '背景事件',
  confirmed: '已确认',
  chapter: '章节事件',
};
const FICTIONIST_MARKDOWN_PLUGINS = [remarkGfm];

const CHAPTER_STATUS_LABELS = {
  outline: '大纲',
  draft: '草稿',
  revised: '修改中',
  final: '定稿',
} as const;
const CHAPTER_STATUS_OPTIONS = Object.entries(CHAPTER_STATUS_LABELS).map(([value, label]) => ({
  value: value as FictionChapterStatus,
  label,
}));

interface BookView extends FictionProject {
  statusLabel: (typeof PROJECT_STATUS_LABELS)[FictionProject['status']];
  chapterCount: number;
  wordCount: number;
}

interface FictionBookCoverProps {
  title: string;
  genre: string;
  coverTone: FictionProject['coverTone'];
  coverImage?: string;
  current?: boolean;
}

export function FictionBookCover({
  title,
  genre,
  coverTone,
  coverImage,
  current = false,
}: FictionBookCoverProps) {
  return (
    <span className={`fictionist-book-cover fictionist-book-cover--${coverTone}${coverImage ? ' fictionist-book-cover--custom' : ''}`}>
      {coverImage ? (
        <img src={coverImage} alt="" />
      ) : (
        <><small>FICTION</small><strong>{title}</strong><span>{genre}</span></>
      )}
      {current ? <em>当前</em> : null}
    </span>
  );
}

function bookViews(index: FictionistIndex): BookView[] {
  return Object.values(index.projects)
    .map((project) => ({
      ...project,
      statusLabel: PROJECT_STATUS_LABELS[project.status],
      chapterCount: chaptersForProject(index, project.id).length,
      wordCount: projectWordCount(index, project.id),
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

const PROJECT_SECTION_ITEMS: Array<{
  id: ProjectSection;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: 'chapters', label: '正文', icon: <FileTextOutlined /> },
  { id: 'outline', label: '大纲', icon: <PartitionOutlined /> },
  { id: 'canon', label: '设定库', icon: <DatabaseOutlined /> },
  { id: 'timeline', label: '时间线', icon: <ClockCircleOutlined /> },
];

const PACKAGE_SECTION_ITEMS: Array<{
  label: string;
  value: Extract<FictionistSection, 'library' | 'workflows'>;
  icon: React.ReactNode;
}> = [
  { label: '书库', value: 'library', icon: <BookOutlined /> },
  { label: '工作流中心', value: 'workflows', icon: <BranchesOutlined /> },
];

function statusClass(status: FictionChapterStatus): string {
  if (status === 'final') return 'is-final';
  if (status === 'revised') return 'is-editing';
  return 'is-draft';
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('读取封面失败'));
    reader.onerror = () => reject(reader.error ?? new Error('读取封面失败'));
    reader.readAsDataURL(file);
  });
}

function ChapterPreview({ content }: { content: string }) {
  if (!content.trim()) {
    return (
      <div className="fictionist-empty-copy">
        <FileTextOutlined />
        <strong>这一章还没有正文</strong>
        <span>切换到编辑模式开始写作，或从工作流生成一份草稿。</span>
      </div>
    );
  }
  return (
    <article className="fictionist-prose" aria-label="章节预览">
      {content.split(/\n{2,}/).map((paragraph, index) => (
        <p key={`${index}-${paragraph.slice(0, 12)}`}>{paragraph}</p>
      ))}
    </article>
  );
}

export function InsightOutputPanel({
  kind,
  output,
  task,
  nodeAvailable,
}: {
  kind: InspectorMode;
  output?: ProfessionalTaskOutput;
  task?: ProfessionalTask;
  nodeAvailable?: boolean;
}) {
  const nodeName = kind === 'context' ? '上下文分析' : '设定检查';
  if (!output) {
    const title = !task
      ? `本章还没有${nodeName}结果`
      : nodeAvailable === false
        ? `本次工作流未添加“${nodeName}”节点`
        : `本次任务没有产出${nodeName}内容`;
    const description = !task
      ? '运行“AI 起草”或“续写下一章”后，对应节点的输出会显示在这里。'
      : nodeAvailable === false
        ? `打开本次使用的工作流画布，添加“${nodeName}”节点后重新运行。`
        : `“${nodeName}”节点可能尚未完成或运行失败，请到任务画布查看节点状态。`;
    return (
      <div className="fictionist-insight-empty" role="status">
        {kind === 'context' ? <ClockCircleOutlined /> : <DatabaseOutlined />}
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
    );
  }
  return (
    <article className="fictionist-insight-output">
      <header>
        <span><strong>{output.label || nodeName}</strong><small>{task?.taskLabel ?? '小说家写作任务'}</small></span>
        <Tag color="green">已产出</Tag>
      </header>
      <div className="fictionist-insight-markdown">
        <ReactMarkdown remarkPlugins={FICTIONIST_MARKDOWN_PLUGINS}>
          {output.content}
        </ReactMarkdown>
      </div>
    </article>
  );
}

export function PendingDraftInsights({ task }: { task?: ProfessionalTask }) {
  if (!task) return null;
  const contextOutput = task.outputs.find(
    (output) => output.resultRole === CHAPTER_CONTEXT_RESULT_ROLE,
  );
  const canonCheckOutput = task.outputs.find(
    (output) => output.resultRole === CHAPTER_CANON_CHECK_RESULT_ROLE,
  );
  if (!contextOutput && !canonCheckOutput) return null;

  return (
    <section className="fictionist-pending-insights" aria-label="本次任务分析">
      <h3>本次任务分析</h3>
      <div className="fictionist-pending-insights__grid">
        {contextOutput ? (
          <div className="fictionist-pending-insights__item">
            <InsightOutputPanel kind="context" output={contextOutput} task={task} />
          </div>
        ) : null}
        {canonCheckOutput ? (
          <div className="fictionist-pending-insights__item">
            <InsightOutputPanel kind="checks" output={canonCheckOutput} task={task} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ContextInspector({
  mode,
  onModeChange,
  task,
  contextOutput,
  canonCheckOutput,
  contextNodeAvailable,
  canonCheckNodeAvailable,
}: {
  mode: InspectorMode;
  onModeChange: (mode: InspectorMode) => void;
  task?: ProfessionalTask;
  contextOutput?: ProfessionalTaskOutput;
  canonCheckOutput?: ProfessionalTaskOutput;
  contextNodeAvailable?: boolean;
  canonCheckNodeAvailable?: boolean;
}) {
  return (
    <div className="fictionist-inspector-content">
      <Segmented
        block
        size="small"
        value={mode}
        onChange={(value) => onModeChange(value as InspectorMode)}
        options={[
          { label: '本章上下文', value: 'context' },
          { label: '检查', value: 'checks' },
        ]}
      />
      <InsightOutputPanel
        kind={mode}
        output={mode === 'context' ? contextOutput : canonCheckOutput}
        task={task}
        nodeAvailable={mode === 'context' ? contextNodeAvailable : canonCheckNodeAvailable}
      />
    </div>
  );
}

function FictionistWorkspace({ initialSection = 'library' }: { initialSection?: FictionistSection }) {
  const systemWorkflowCatalogSignature = FICTIONIST_SYSTEM_WORKFLOW_CATALOG_SIGNATURE;
  const { message, modal } = App.useApp();
  const index = useFictionistStore((state) => state.index);
  const activeProjectId = useFictionistStore((state) => state.activeProjectId);
  const activeChapterId = useFictionistStore((state) => state.activeChapterId);
  const chapterContent = useFictionistStore((state) => state.chapterContent);
  const dirty = useFictionistStore((state) => state.dirty);
  const hydrationState = useFictionistStore((state) => state.hydrationState);
  const saveState = useFictionistStore((state) => state.saveState);
  const errorMessage = useFictionistStore((state) => state.errorMessage);
  const hydrate = useFictionistStore((state) => state.hydrate);
  const createProject = useFictionistStore((state) => state.createProject);
  const updateProject = useFictionistStore((state) => state.updateProject);
  const createCanonEntry = useFictionistStore((state) => state.createCanonEntry);
  const importCanonEntries = useFictionistStore((state) => state.importCanonEntries);
  const updateCanonEntry = useFictionistStore((state) => state.updateCanonEntry);
  const deleteCanonEntry = useFictionistStore((state) => state.deleteCanonEntry);
  const createTimelineEvent = useFictionistStore((state) => state.createTimelineEvent);
  const importTimelineEvents = useFictionistStore((state) => state.importTimelineEvents);
  const updateTimelineEvent = useFictionistStore((state) => state.updateTimelineEvent);
  const reorderTimelineEvent = useFictionistStore((state) => state.reorderTimelineEvent);
  const deleteTimelineEvent = useFictionistStore((state) => state.deleteTimelineEvent);
  const saveProjectOutline = useFictionistStore((state) => state.saveProjectOutline);
  const deleteProject = useFictionistStore((state) => state.deleteProject);
  const createVolume = useFictionistStore((state) => state.createVolume);
  const renameVolume = useFictionistStore((state) => state.renameVolume);
  const reorderVolume = useFictionistStore((state) => state.reorderVolume);
  const deleteVolume = useFictionistStore((state) => state.deleteVolume);
  const openProject = useFictionistStore((state) => state.openProject);
  const createStoredChapter = useFictionistStore((state) => state.createChapter);
  const renameChapter = useFictionistStore((state) => state.renameChapter);
  const updateChapterStatus = useFictionistStore((state) => state.updateChapterStatus);
  const moveStoredChapter = useFictionistStore((state) => state.moveChapter);
  const deleteChapter = useFictionistStore((state) => state.deleteChapter);
  const selectChapter = useFictionistStore((state) => state.selectChapter);
  const searchCurrentProject = useFictionistStore((state) => state.searchCurrentProject);
  const replaceCurrentProjectText = useFictionistStore((state) => state.replaceCurrentProjectText);
  const updateChapterContent = useFictionistStore((state) => state.updateChapterContent);
  const saveCurrentChapter = useFictionistStore((state) => state.saveCurrentChapter);
  const acceptContinuationDraft = useFictionistStore((state) => state.acceptContinuationDraft);
  const enabledModels = useEnabledModels();
  const savedCanvases = useCanvasStore((state) => state.savedCanvases);
  const openCanvases = useCanvasStore((state) => state.canvases);
  const runHistory = useCanvasStore((state) => state.runHistory);
  const professionalTasks = useProfessionalTaskStore((state) => state.tasks);
  const focusedTaskId = useProfessionalTaskStore((state) => state.focusedTaskId);
  const createProfessionalTask = useProfessionalTaskStore((state) => state.createTask);
  const removeProfessionalTask = useProfessionalTaskStore((state) => state.removeTask);
  const linkTaskCanvas = useProfessionalTaskStore((state) => state.linkCanvas);
  const markTaskAccepted = useProfessionalTaskStore((state) => state.markAccepted);
  const markTaskDiscarded = useProfessionalTaskStore((state) => state.markDiscarded);
  const focusTask = useProfessionalTaskStore((state) => state.focusTask);
  const workflowPolicies = useWorkflowPolicyStore((state) => state.policies);
  const setFallbackEnabled = useWorkflowPolicyStore((state) => state.setFallbackEnabled);
  const setFictionistEntrySection = useUiStore((state) => state.setFictionistEntrySection);
  const [section, setSection] = useState<FictionistSection>(initialSection);
  const [editorMode, setEditorMode] = useState<EditorMode>('edit');
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>('context');
  const [continueOpen, setContinueOpen] = useState(false);
  const [writingMode, setWritingMode] = useState<ChapterWritingMode>('continue');
  const [creatingContinuation, setCreatingContinuation] = useState(false);
  const [proposedChapterTitle, setProposedChapterTitle] = useState('');
  const [continuationGoal, setContinuationGoal] = useState('');
  const [continuationRequirements, setContinuationRequirements] = useState('');
  const [writingRequirementsSourceName, setWritingRequirementsSourceName] = useState<string>();
  const [targetWordCount, setTargetWordCount] = useState(2000);
  const [selectedModel, setSelectedModel] = useState<string>();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewDraft, setReviewDraft] = useState('');
  const [reviewTitle, setReviewTitle] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const [compactInspectorOpen, setCompactInspectorOpen] = useState(false);
  const [createBookOpen, setCreateBookOpen] = useState(false);
  const [creatingBook, setCreatingBook] = useState(false);
  const [newBookTitle, setNewBookTitle] = useState('');
  const [newBookGenre, setNewBookGenre] = useState('');
  const [newBookCover, setNewBookCover] = useState<string>();
  const [createWorkflowOpen, setCreateWorkflowOpen] = useState(false);
  const [creatingWorkflow, setCreatingWorkflow] = useState(false);
  const [newWorkflowName, setNewWorkflowName] = useState('');
  const [workflowBindingOpen, setWorkflowBindingOpen] = useState(false);
  const [editingBook, setEditingBook] = useState<BookView>();
  const [editedBookTitle, setEditedBookTitle] = useState('');
  const [editedBookGenre, setEditedBookGenre] = useState('');
  const [editedBookStatus, setEditedBookStatus] = useState<FictionProjectStatus>('paused');
  const [editedBookCover, setEditedBookCover] = useState<string>();
  const [savingBookDetails, setSavingBookDetails] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string>();
  const [structureEditor, setStructureEditor] = useState<StructureEditor>();
  const [structureTitle, setStructureTitle] = useState('');
  const [savingStructure, setSavingStructure] = useState(false);
  const [collapsedVolumeIds, setCollapsedVolumeIds] = useState<Set<string>>(() => new Set());
  const [bookSearchOpen, setBookSearchOpen] = useState(false);
  const [bookSearchQuery, setBookSearchQuery] = useState('');
  const [bookReplaceText, setBookReplaceText] = useState('');
  const [bookSearchResults, setBookSearchResults] = useState<FictionSearchMatch[]>([]);
  const [bookSearchTruncated, setBookSearchTruncated] = useState(false);
  const [bookSearchState, setBookSearchState] = useState<'idle' | 'searching' | 'done'>('idle');
  const [libraryFilter, setLibraryFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [outlineDraftState, setOutlineDraftState] = useState<OutlineDraftState>();
  const [outlineTargetState, setOutlineTargetState] = useState<OutlineTargetState>();
  const [savingOutline, setSavingOutline] = useState(false);
  const [outlineImportOpen, setOutlineImportOpen] = useState(false);
  const [outlineImportMethod, setOutlineImportMethod] = useState<'direct' | 'analyze'>('direct');
  const [outlineImportStrategy, setOutlineImportStrategy] = useState<FictionOutlineImportStrategy>('replace');
  const [outlineImportSourceName, setOutlineImportSourceName] = useState<string>();
  const [outlineImportSourceText, setOutlineImportSourceText] = useState('');
  const [outlineImportTargetValue, setOutlineImportTargetValue] = useState('story');
  const [outlineOptimizeOpen, setOutlineOptimizeOpen] = useState(false);
  const [outlineOptimizeTargetValue, setOutlineOptimizeTargetValue] = useState('story');
  const [outlineOptimizeGoals, setOutlineOptimizeGoals] = useState<string[]>(['主线结构', '节奏推进']);
  const [outlineOptimizeIntensity, setOutlineOptimizeIntensity] = useState<FictionOutlineOptimizationIntensity>('balanced');
  const [outlineOptimizeRequirements, setOutlineOptimizeRequirements] = useState('');
  const [creatingOutlineTask, setCreatingOutlineTask] = useState(false);
  const [outlineReviewState, setOutlineReviewState] = useState<OutlineReviewState>();
  const [savingOutlineReview, setSavingOutlineReview] = useState(false);
  const [canonEditorOpen, setCanonEditorOpen] = useState(false);
  const [canonEditorEntry, setCanonEditorEntry] = useState<FictionCanonEntry>();
  const [savingCanonEntry, setSavingCanonEntry] = useState(false);
  const [canonTypeFilter, setCanonTypeFilter] = useState<'all' | FictionCanonEntryType>('all');
  const [timelineEditorOpen, setTimelineEditorOpen] = useState(false);
  const [timelineEditorEvent, setTimelineEditorEvent] = useState<FictionTimelineEvent>();
  const [savingTimelineEvent, setSavingTimelineEvent] = useState(false);
  const [timelineKindFilter, setTimelineKindFilter] = useState<'all' | FictionTimelineEventKind>('all');
  const createCoverInputRef = useRef<HTMLInputElement>(null);
  const editCoverInputRef = useRef<HTMLInputElement>(null);
  const writingRequirementsInputRef = useRef<HTMLInputElement>(null);
  const canonTransferInputRef = useRef<HTMLInputElement>(null);
  const timelineTransferInputRef = useRef<HTMLInputElement>(null);
  const bookSearchRequestRef = useRef(0);
  const outlineDirtyRef = useRef(false);
  const saveOutlineRef = useRef<() => Promise<boolean>>(async () => true);
  const saveChapterRef = useRef<() => Promise<void>>(async () => undefined);

  const persistedOutline = useMemo(() => activeProjectId
    ? index.projects[activeProjectId]?.outline ?? createEmptyFictionProjectOutline()
    : createEmptyFictionProjectOutline(), [activeProjectId, index.projects]);
  const outlineDraft = outlineDraftState?.projectId === activeProjectId
    ? outlineDraftState.outline
    : persistedOutline;
  const outlineDirty = Boolean(
    activeProjectId && outlineDraftState?.projectId === activeProjectId,
  );
  outlineDirtyRef.current = outlineDirty;

  const persistOutlineDraft = async (showSuccess = true): Promise<boolean> => {
    const draft = outlineDraftState;
    if (!activeProjectId || draft?.projectId !== activeProjectId) return true;
    if (savingOutline) return false;
    setSavingOutline(true);
    try {
      const { updatedAt: _updatedAt, ...input } = draft.outline;
      if (!(await saveProjectOutline(activeProjectId, input))) {
        if (showSuccess) {
          message.error(useFictionistStore.getState().errorMessage || '保存大纲失败');
        }
        return false;
      }
      setOutlineDraftState((current) => current === draft ? undefined : current);
      if (showSuccess) message.success('大纲已保存到本机');
      return true;
    } finally {
      setSavingOutline(false);
    }
  };
  saveOutlineRef.current = () => persistOutlineDraft(false);

  useEffect(() => {
    if (initialSection !== 'library') setFictionistEntrySection(null);
  }, [initialSection, setFictionistEntrySection]);

  const modelOptions = useMemo(() => enabledModels.map((model) => ({
    value: packModelRef(model)!,
    label: `${model.label}（${model.providerName}）`,
  })), [enabledModels]);
  const focusedTask = focusedTaskId ? professionalTasks[focusedTaskId] : undefined;
  const focusedTaskUpdatedAt = focusedTask?.updatedAt;

  useEffect(() => registerAppViewGuard(async () => {
    const fictionist = useFictionistStore.getState();
    if (fictionist.dirty && !(await fictionist.saveCurrentChapter())) {
      message.error(
        useFictionistStore.getState().errorMessage || '保存失败，已留在小说家工作区',
      );
      return false;
    }
    if (outlineDirtyRef.current && !(await saveOutlineRef.current())) {
      message.error(
        useFictionistStore.getState().errorMessage || '大纲保存失败，已留在小说家工作区',
      );
      return false;
    }
    return true;
  }), [message]);

  useEffect(() => {
    const preventUnsavedExit = (event: BeforeUnloadEvent) => {
      if (!useFictionistStore.getState().dirty && !outlineDirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventUnsavedExit);
    return () => window.removeEventListener('beforeunload', preventUnsavedExit);
  }, []);

  useEffect(() => {
    if (!continueOpen && !outlineImportOpen && !outlineOptimizeOpen) return;
    if (selectedModel && modelOptions.some((option) => option.value === selectedModel)) return;
    setSelectedModel(modelOptions[0]?.value);
  }, [continueOpen, modelOptions, outlineImportOpen, outlineOptimizeOpen, selectedModel]);

  useEffect(() => {
    const task = focusedTaskId
      ? useProfessionalTaskStore.getState().tasks[focusedTaskId]
      : undefined;
    if (!task
      || task.packageId !== FICTIONIST_PACKAGE_ID
      || !isFictionistChapterWritingTaskType(task.taskType)
      || !isFictionistContinuationPayload(task.packagePayload)) return;
    const payload = task.packagePayload;
    let cancelled = false;
    const showTask = async () => {
      const fictionist = useFictionistStore.getState();
      if (fictionist.activeProjectId !== payload.projectId
        && outlineDirtyRef.current
        && !(await saveOutlineRef.current())) return;
      if (fictionist.activeProjectId !== payload.projectId
        && !(await fictionist.openProject(payload.projectId))) return;
      if (useFictionistStore.getState().activeChapterId !== payload.sourceChapterId
        && !(await useFictionistStore.getState().selectChapter(payload.sourceChapterId))) return;
      if (cancelled) return;
      setSection('chapters');
      setEditorMode('edit');
      if (task.status !== 'review_required') return;
      const output = task.outputs.find(
        (item) => item.resultRole === CHAPTER_DRAFT_RESULT_ROLE,
      );
      if (!output) return;
      setReviewDraft(output.content);
      setReviewTitle(payload.proposedChapterTitle);
      setReviewOpen(true);
    };
    void showTask();
    return () => {
      cancelled = true;
    };
  }, [focusedTaskId, focusedTaskUpdatedAt]);

  useEffect(() => {
    const task = focusedTaskId
      ? useProfessionalTaskStore.getState().tasks[focusedTaskId]
      : undefined;
    if (!task
      || task.packageId !== FICTIONIST_PACKAGE_ID
      || !isFictionistOutlineTaskPayload(task.packagePayload)) return;
    const payload = task.packagePayload;
    let cancelled = false;
    const showTask = async () => {
      const fictionist = useFictionistStore.getState();
      if (fictionist.activeProjectId !== payload.projectId
        && outlineDirtyRef.current
        && !(await saveOutlineRef.current())) return;
      if (fictionist.activeProjectId !== payload.projectId
        && !(await fictionist.openProject(payload.projectId))) return;
      if (cancelled) return;
      setSection('outline');
      setOutlineTargetState({ projectId: payload.projectId, target: payload.target });
      if (task.status !== 'review_required') return;
      try {
        setOutlineReviewState({
          taskId: task.id,
          result: outlineWorkflowResultForTask(
            task,
            useFictionistStore.getState().index,
          ),
        });
      } catch (reason) {
        message.error(reason instanceof Error ? reason.message : '大纲结果无法读取');
      }
    };
    void showTask();
    return () => {
      cancelled = true;
    };
  }, [focusedTaskId, focusedTaskUpdatedAt, message]);

  const books = useMemo(() => bookViews(index), [index]);
  const libraryCategories = useMemo(() => Array.from(
    new Set(books.map((book) => book.genre)),
  ).sort((left, right) => left.localeCompare(right, 'zh-CN')), [books]);
  const activeBook = books.find((book) => book.id === activeProjectId) ?? books[0] ?? null;
  const canonEntries = useMemo(
    () => (activeProjectId ? canonEntriesForProject(index, activeProjectId) : []),
    [activeProjectId, index],
  );
  const visibleCanonEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return canonEntries.filter((entry) => {
      const matchesType = canonTypeFilter === 'all' || entry.type === canonTypeFilter;
      const matchesQuery = !normalizedQuery
        || `${entry.name}${entry.summary}${entry.content}`.toLocaleLowerCase().includes(normalizedQuery);
      return matchesType && matchesQuery;
    });
  }, [canonEntries, canonTypeFilter, query]);
  const timelineEvents = useMemo(
    () => (activeProjectId ? timelineEventsForProject(index, activeProjectId) : []),
    [activeProjectId, index],
  );
  const visibleTimelineEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return timelineEvents.filter((event) => {
      const matchesKind = timelineKindFilter === 'all' || event.kind === timelineKindFilter;
      const sourceTitle = event.sourceChapterId ? index.chapters[event.sourceChapterId]?.title ?? '' : '';
      const matchesQuery = !normalizedQuery
        || `${event.timeLabel}${event.title}${event.description}${sourceTitle}`
          .toLocaleLowerCase().includes(normalizedQuery);
      return matchesKind && matchesQuery;
    });
  }, [index.chapters, query, timelineEvents, timelineKindFilter]);

  useEffect(() => {
    if (hydrationState !== 'ready') return;
    return subscribeFictionistWorkflowInitialization();
  }, [
    hydrationState,
    openCanvases.length,
    savedCanvases.length,
    systemWorkflowCatalogSignature,
  ]);

  const chapters = useMemo(
    () => (activeProjectId ? chaptersForProject(index, activeProjectId) : []),
    [activeProjectId, index],
  );
  const selectedChapter = activeChapterId ? index.chapters[activeChapterId] ?? null : null;
  const chapterInsights = useMemo(
    () => chapterInsightResult(professionalTasks, selectedChapter),
    [professionalTasks, selectedChapter],
  );
  const insightNodeAvailability = useMemo(() => {
    const task = chapterInsights.task;
    if (!task) return undefined;
    const graph = (task.runId
      ? runHistory.find((record) => record.id === task.runId)
      : undefined)
      ?? openCanvases.find((canvas) =>
        canvas.id === task.runCanvasId
        || canvas.id === task.canvasId
        || canvas.origin?.taskId === task.id)
      ?? savedCanvases.find((canvas) => canvas.origin?.taskId === task.id);
    return chapterInsightNodeAvailability(graph?.nodes);
  }, [chapterInsights.task, openCanvases, runHistory, savedCanvases]);
  const currentChapterIsEmpty = Boolean(
    selectedChapter && selectedChapter.wordCount === 0 && !chapterContent.trim(),
  );
  const selectedChapterNumber = selectedChapter
    ? chapters.findIndex((chapter) => chapter.id === selectedChapter.id) + 1
    : 0;
  const activeVolumes = useMemo(() => activeBook
    ? activeBook.volumeIds.flatMap((volumeId) => {
        const volume = index.volumes[volumeId];
        return volume ? [volume] : [];
      })
    : [], [activeBook, index.volumes]);
  const activeVolume = selectedChapter
    ? index.volumes[selectedChapter.volumeId]
    : activeVolumes[0];
  const outlineTargetOptions = useMemo<OutlineTargetOption[]>(() => [
    { label: '全书大纲', value: 'story' },
    ...activeVolumes.flatMap((volume) => [
      { label: `卷：${volume.title}`, value: outlineTargetValue({ kind: 'volume', id: volume.id }) },
      ...volume.chapterIds.flatMap((chapterId) => {
        const chapter = index.chapters[chapterId];
        return chapter ? [{
          label: `章节：${chapter.title}`,
          value: outlineTargetValue({ kind: 'chapter', id: chapter.id }),
        }] : [];
      }),
    ]),
  ], [activeVolumes, index.chapters]);
  const outlineImportSourceChars = useMemo(
    () => Array.from(outlineImportSourceText).length,
    [outlineImportSourceText],
  );
  const outlineImportSourcePreview = useMemo(() => {
    const characters = Array.from(outlineImportSourceText);
    const preview = characters.slice(0, 4_000).join('');
    return characters.length > 4_000 ? `${preview}\n\n[预览已截断]` : preview;
  }, [outlineImportSourceText]);
  const chapterNumberById = useMemo(() => new Map(
    chapters.map((chapter, chapterIndex) => [chapter.id, chapterIndex + 1]),
  ), [chapters]);
  const outlineReviewVolumeLabels = useMemo(
    () => Object.fromEntries(activeVolumes.map((volume) => [volume.id, volume.title])),
    [activeVolumes],
  );
  const outlineReviewChapterLabels = useMemo(
    () => Object.fromEntries(chapters.map((chapter, chapterIndex) => [
      chapter.id,
      `第 ${chapterIndex + 1} 章 · ${chapter.title}`,
    ])),
    [chapters],
  );
  const requestedOutlineTarget = outlineTargetState?.projectId === activeProjectId
    ? outlineTargetState.target
    : { kind: 'story' } as const;
  const outlineTarget: FictionOutlineTarget = requestedOutlineTarget.kind === 'volume'
    && activeVolumes.some((volume) => volume.id === requestedOutlineTarget.id)
    ? requestedOutlineTarget
    : requestedOutlineTarget.kind === 'chapter'
      && chapters.some((chapter) => chapter.id === requestedOutlineTarget.id)
      ? requestedOutlineTarget
      : { kind: 'story' };
  const outlineVolume = outlineTarget.kind === 'volume'
    ? index.volumes[outlineTarget.id]
    : outlineTarget.kind === 'chapter'
      ? index.volumes[index.chapters[outlineTarget.id]?.volumeId]
      : undefined;
  const outlineChapter = outlineTarget.kind === 'chapter'
    ? index.chapters[outlineTarget.id]
    : undefined;
  const visibleChapters = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return chapters;
    return chapters.filter((chapter) => {
      const volumeTitle = index.volumes[chapter.volumeId]?.title ?? '';
      return `${chapterNumberById.get(chapter.id) ?? ''}${chapter.title}${volumeTitle}`
        .toLocaleLowerCase()
        .includes(normalized);
    });
  }, [chapterNumberById, chapters, index.volumes, query]);
  const visibleChapterIds = useMemo(
    () => new Set(visibleChapters.map((chapter) => chapter.id)),
    [visibleChapters],
  );
  const visibleBooks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return books.filter((book) => {
      const matchesQuery = !normalized
        || `${book.title}${book.genre}${book.statusLabel}`.toLocaleLowerCase().includes(normalized);
      const matchesFilter = libraryFilter === 'all'
        || libraryFilter === `status:${book.status}`
        || libraryFilter === `category:${book.genre}`;
      return matchesQuery && matchesFilter;
    });
  }, [books, libraryFilter, query]);
  const libraryFilterLabel = libraryFilter === 'all'
    ? '全部书籍'
    : LIBRARY_STATUS_FILTERS.find((item) => item.key === libraryFilter)?.label
      ?? libraryFilter.slice('category:'.length);
  const libraryStats = books.reduce(
    (totals, book) => ({
      chapters: totals.chapters + book.chapterCount,
      words: totals.words + book.wordCount,
    }),
    { chapters: 0, words: 0 },
  );
  const packageWorkflows = useMemo(
    () => buildFictionWorkflowEntries({
      savedCanvases,
      openCanvases,
      professionalTasks,
    }),
    [openCanvases, professionalTasks, savedCanvases],
  );
  const systemWorkflowEntries = useMemo(
    () => packageWorkflows.filter((workflow) => workflow.systemWorkflow),
    [packageWorkflows],
  );
  const customPackageWorkflows = useMemo(
    () => packageWorkflows.filter((workflow) => !workflow.systemWorkflow),
    [packageWorkflows],
  );
  const visiblePackageWorkflows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? customPackageWorkflows.filter((workflow) => workflow.name.toLocaleLowerCase().includes(normalized))
      : customPackageWorkflows;
  }, [customPackageWorkflows, query]);
  const systemWorkflowCards = useMemo(() => FICTIONIST_SYSTEM_WORKFLOW_SPECS.map((workflow) => {
    const primary = systemWorkflowEntries.find((entry) =>
      entry.systemWorkflow?.key === workflow.key
      && entry.systemWorkflow.version === 1,
    );
    const fallback = systemWorkflowEntries.find((entry) =>
      entry.systemWorkflow?.key === workflow.key
      && entry.systemWorkflow.version === 2,
    );
    const primaryCanvas = openCanvases.find((canvas) => canvas.id === primary?.canvasId)
      ?? savedCanvases.find((canvas) => canvas.id === primary?.savedId);
    return {
      workflow,
      primary,
      fallback,
      modified: primaryCanvas
        ? isSystemWorkflowSpecModified(primaryCanvas.nodes, primaryCanvas.edges, workflow)
        : false,
      fallbackEnabled: isWorkflowFallbackEnabled(
        FICTIONIST_PACKAGE_ID,
        workflow.key,
        workflowPolicies,
      ),
    };
  }), [openCanvases, savedCanvases, systemWorkflowEntries, workflowPolicies]);
  const pendingTask = Object.values(professionalTasks).find((task) =>
    task.packageId === FICTIONIST_PACKAGE_ID
    && isFictionistChapterWritingTaskType(task.taskType)
    && task.status === 'review_required'
    && isFictionistContinuationPayload(task.packagePayload)
    && task.packagePayload.projectId === activeProjectId,
  );
  const pendingOutlineTask = Object.values(professionalTasks).find((task) =>
    task.packageId === FICTIONIST_PACKAGE_ID
    && task.status === 'review_required'
    && isFictionistOutlineTaskPayload(task.packagePayload)
    && task.packagePayload.projectId === activeProjectId,
  );
  const outlineReviewTask = outlineReviewState
    ? professionalTasks[outlineReviewState.taskId]
    : undefined;
  const outlineReviewPayload = outlineReviewTask
    && isFictionistOutlineTaskPayload(outlineReviewTask.packagePayload)
    ? outlineReviewTask.packagePayload
    : undefined;
  const reviewWritingMode = focusedTask && isFictionistContinuationPayload(focusedTask.packagePayload)
    ? chapterWritingMode(focusedTask.packagePayload)
    : 'continue';

  const storeError = (fallback: string) =>
    useFictionistStore.getState().errorMessage || fallback;

  const updateOutlineDraft = (
    updater: (current: FictionProjectOutline) => FictionProjectOutline,
  ) => {
    if (!activeProjectId) return;
    setOutlineDraftState((current) => ({
      projectId: activeProjectId,
      outline: updater(
        current?.projectId === activeProjectId ? current.outline : persistedOutline,
      ),
    }));
  };

  const updateStoryOutline = (field: StoryOutlineField, value: string) => {
    updateOutlineDraft((current) => ({ ...current, [field]: value }));
  };

  const updateVolumeOutline = (
    volumeId: string,
    field: VolumeOutlineField,
    value: string,
  ) => {
    if (!activeVolumes.some((volume) => volume.id === volumeId)) return;
    updateOutlineDraft((current) => {
      const volumeOutline = current.volumes[volumeId] ?? createEmptyFictionVolumeOutline();
      return {
        ...current,
        volumes: {
          ...current.volumes,
          [volumeId]: { ...volumeOutline, [field]: value },
        },
      };
    });
  };

  const updateChapterOutline = (
    chapterId: string,
    field: ChapterOutlineField,
    value: string,
  ) => {
    if (!chapters.some((chapter) => chapter.id === chapterId)) return;
    updateOutlineDraft((current) => {
      const chapterOutline = current.chapters[chapterId] ?? createEmptyFictionChapterOutline();
      return {
        ...current,
        chapters: {
          ...current.chapters,
          [chapterId]: { ...chapterOutline, [field]: value },
        },
      };
    });
  };

  const selectOutlineTarget = (target: FictionOutlineTarget) => {
    if (!activeProjectId) return;
    setOutlineTargetState({ projectId: activeProjectId, target });
  };

  const openOutlineImport = () => {
    setOutlineImportMethod('direct');
    setOutlineImportStrategy('replace');
    setOutlineImportSourceName(undefined);
    setOutlineImportSourceText('');
    setOutlineImportTargetValue(outlineTargetValue(outlineTarget));
    setOutlineImportOpen(true);
  };

  const closeOutlineImport = () => {
    if (creatingOutlineTask) return;
    setOutlineImportOpen(false);
  };

  const openOutlineOptimize = () => {
    setOutlineOptimizeTargetValue(outlineTargetValue(outlineTarget));
    setOutlineOptimizeOpen(true);
  };

  const closeOutlineOptimize = () => {
    if (creatingOutlineTask) return;
    setOutlineOptimizeOpen(false);
  };

  const importOutlineFile = async (file: File) => {
    if (!isTextFile(file)) {
      message.error('请选择纯文本类大纲文件');
      return;
    }
    if (file.size > MAX_OUTLINE_IMPORT_FILE_BYTES) {
      message.error('大纲文件不能超过 2 MiB');
      return;
    }
    try {
      const text = (await fileToText(file)).replace(/^\uFEFF/u, '').trim();
      if (!text) {
        message.error('大纲文件为空');
        return;
      }
      if (Array.from(text).length > MAX_OUTLINE_WORKFLOW_SOURCE_CHARS) {
        message.error(`大纲文件不能超过 ${MAX_OUTLINE_WORKFLOW_SOURCE_CHARS.toLocaleString()} 个字符`);
        return;
      }
      setOutlineImportSourceName(file.name);
      setOutlineImportSourceText(text);
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : '读取大纲文件失败');
    }
  };

  const confirmDirectOutlineImport = async () => {
    if (!activeProjectId || !outlineImportSourceText) return;
    const target = outlineTargetFromValue(outlineImportTargetValue);
    if (!target) {
      message.error('导入目标无效，请重新选择');
      return;
    }
    setCreatingOutlineTask(true);
    try {
      const next = applyDirectOutlineImport(
        outlineDraft,
        index,
        activeProjectId,
        target,
        outlineImportSourceText,
        outlineImportStrategy,
      );
      const { updatedAt: _updatedAt, ...input } = next;
      if (!(await saveProjectOutline(activeProjectId, input))) {
        message.error(storeError('导入大纲失败'));
        return;
      }
      setOutlineDraftState(undefined);
      setOutlineTargetState({ projectId: activeProjectId, target });
      setOutlineImportOpen(false);
      message.success(`已直接导入到${outlineTargetLabel(index, target)}`);
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : '导入大纲失败');
    } finally {
      setCreatingOutlineTask(false);
    }
  };

  const openCreateCanonEntry = () => {
    setCanonEditorEntry(undefined);
    setCanonEditorOpen(true);
  };

  const openEditCanonEntry = (entry: FictionCanonEntry) => {
    setCanonEditorEntry(entry);
    setCanonEditorOpen(true);
  };

  const closeCanonEditor = () => {
    if (savingCanonEntry) return;
    setCanonEditorOpen(false);
    setCanonEditorEntry(undefined);
  };

  const saveCanonEntry = async (draft: CanonEntryDraft) => {
    if (savingCanonEntry) return;
    setSavingCanonEntry(true);
    try {
      const targetProjectId = activeBook?.id;
      if (!targetProjectId) {
        message.error('当前没有可用作品');
        return;
      }
      if (targetProjectId !== activeProjectId && !(await openProject(targetProjectId))) {
        message.error(storeError('当前作品已失效，请返回书架后重新打开'));
        return;
      }
      const saved = canonEditorEntry
        ? await updateCanonEntry(canonEditorEntry.id, draft)
        : Boolean(await createCanonEntry(draft, targetProjectId));
      if (!saved) {
        message.error(storeError('保存设定失败'));
        return;
      }
      setCanonEditorOpen(false);
      setCanonEditorEntry(undefined);
      message.success(canonEditorEntry ? '设定已更新' : '设定已创建');
    } finally {
      setSavingCanonEntry(false);
    }
  };

  const confirmDeleteCanonEntry = (entry: FictionCanonEntry) => {
    modal.confirm({
      title: `删除设定“${entry.name}”？`,
      content: '删除后这条设定不会再被小说家上下文引用，且无法恢复。',
      okText: '删除设定',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        if (!(await deleteCanonEntry(entry.id))) {
          message.error(storeError('删除设定失败'));
          throw new Error(storeError('删除设定失败'));
        }
        message.success(`已删除设定“${entry.name}”`);
      },
    });
  };

  const exportBook = async (book: BookView) => {
    try {
      const fictionist = useFictionistStore.getState();
      if (fictionist.activeProjectId === book.id
        && fictionist.dirty
        && !(await fictionist.saveCurrentChapter())) {
        message.error(storeError('当前章节保存失败，未导出作品'));
        return;
      }
      const result = await exportFictionProjectText(useFictionistStore.getState().index, book.id);
      if (result === 'ok') message.success(`《${book.title}》已导出为 TXT`);
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : '导出小说失败');
    }
  };

  const exportCanon = async () => {
    if (!activeBook) return;
    try {
      const result = await exportFictionCollection(
        'fictionist-canon',
        activeBook.title,
        canonEntries.map(({ type, name, summary, content }) => ({ type, name, summary, content })),
      );
      if (result === 'ok') message.success('设定库已导出');
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : '导出设定库失败');
    }
  };

  const importCanonFile = async (file: File) => {
    if (!activeBook) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('导入文件不能超过 5 MiB');
      const entries = parseCanonTransfer(await fileToText(file));
      modal.confirm({
        centered: true,
        title: `导入 ${entries.length} 条设定？`,
        content: '导入内容会追加到当前设定库，不会覆盖已有设定。',
        okText: '确认导入',
        cancelText: '取消',
        onOk: async () => {
          const count = await importCanonEntries(activeBook.id, entries);
          if (count === null) {
            const error = storeError('批量导入设定失败');
            message.error(error);
            throw new Error(error);
          }
          message.success(`已导入 ${count} 条设定`);
        },
      });
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : '读取设定库文件失败');
    }
  };

  const openCreateTimelineEvent = () => {
    setTimelineEditorEvent(undefined);
    setTimelineEditorOpen(true);
  };

  const openEditTimelineEvent = (event: FictionTimelineEvent) => {
    setTimelineEditorEvent(event);
    setTimelineEditorOpen(true);
  };

  const closeTimelineEditor = () => {
    if (savingTimelineEvent) return;
    setTimelineEditorOpen(false);
    setTimelineEditorEvent(undefined);
  };

  const saveTimelineEvent = async (draft: TimelineEventDraft) => {
    if (savingTimelineEvent) return;
    setSavingTimelineEvent(true);
    try {
      const targetProjectId = activeBook?.id;
      if (!targetProjectId) {
        message.error('当前没有可用作品');
        return;
      }
      if (targetProjectId !== activeProjectId && !(await openProject(targetProjectId))) {
        message.error(storeError('当前作品已失效，请返回书架后重新打开'));
        return;
      }
      const saved = timelineEditorEvent
        ? await updateTimelineEvent(timelineEditorEvent.id, draft)
        : Boolean(await createTimelineEvent(draft, targetProjectId));
      if (!saved) {
        message.error(storeError('保存时间线事件失败'));
        return;
      }
      setTimelineEditorOpen(false);
      setTimelineEditorEvent(undefined);
      message.success(timelineEditorEvent ? '时间线事件已更新' : '时间线事件已创建');
    } finally {
      setSavingTimelineEvent(false);
    }
  };

  const moveTimelineEvent = async (event: FictionTimelineEvent, targetIndex: number) => {
    if (await reorderTimelineEvent(event.id, targetIndex)) return;
    message.error(storeError('调整时间线顺序失败'));
  };

  const confirmDeleteTimelineEvent = (event: FictionTimelineEvent) => {
    modal.confirm({
      centered: true,
      title: `删除时间线事件“${event.title}”？`,
      icon: <ExclamationCircleOutlined />,
      content: '删除后这条事件记录无法恢复，但不会删除关联章节正文。',
      okText: '删除事件',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        if (!(await deleteTimelineEvent(event.id))) {
          message.error(storeError('删除时间线事件失败'));
          throw new Error(storeError('删除时间线事件失败'));
        }
        message.success(`已删除时间线事件“${event.title}”`);
      },
    });
  };

  const exportTimeline = async () => {
    if (!activeBook) return;
    try {
      const result = await exportFictionCollection(
        'fictionist-timeline',
        activeBook.title,
        timelineEvents.map((event) => ({
          timeLabel: event.timeLabel,
          title: event.title,
          description: event.description,
          kind: event.kind,
          sourceChapterTitle: event.sourceChapterId
            ? index.chapters[event.sourceChapterId]?.title
            : undefined,
          order: event.order,
        })),
      );
      if (result === 'ok') message.success('时间线已导出');
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : '导出时间线失败');
    }
  };

  const importTimelineFile = async (file: File) => {
    if (!activeBook) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('导入文件不能超过 5 MiB');
      const entries = parseTimelineTransfer(await fileToText(file));
      const chapterByTitle = new Map(chapters.map((chapter) => [chapter.title, chapter.id]));
      const unmatched = entries.filter(
        (entry) => entry.sourceChapterTitle && !chapterByTitle.has(entry.sourceChapterTitle),
      ).length;
      modal.confirm({
        centered: true,
        title: `导入 ${entries.length} 条时间线事件？`,
        content: unmatched > 0
          ? `有 ${unmatched} 条事件找不到同名章节，将保留事件但不建立章节关联。`
          : '导入内容会追加到当前时间线，不会覆盖已有事件。',
        okText: '确认导入',
        cancelText: '取消',
        onOk: async () => {
          const count = await importTimelineEvents(activeBook.id, entries.map((entry) => ({
            ...entry,
            sourceChapterId: entry.sourceChapterTitle
              ? chapterByTitle.get(entry.sourceChapterTitle)
              : undefined,
          })));
          if (count === null) {
            const error = storeError('批量导入时间线失败');
            message.error(error);
            throw new Error(error);
          }
          message.success(`已导入 ${count} 条时间线事件`);
        },
      });
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : '读取时间线文件失败');
    }
  };

  const switchSection = async (nextSection: FictionistSection) => {
    if (nextSection === section) return;
    if (dirty && !(await saveCurrentChapter())) {
      message.error(storeError('保存失败，已留在当前页面'));
      return;
    }
    if (section === 'outline' && outlineDirty && !(await persistOutlineDraft(false))) {
      message.error(storeError('大纲保存失败，已留在当前页面'));
      return;
    }
    setSection(nextSection);
    setQuery('');
    if (nextSection !== 'canon') setCanonTypeFilter('all');
    if (nextSection !== 'timeline') setTimelineKindFilter('all');
  };

  const createBook = async () => {
    const title = newBookTitle.trim();
    if (!title || creatingBook) return;
    setCreatingBook(true);
    try {
      const projectId = await createProject(title, newBookGenre, newBookCover);
      if (!projectId) {
        message.error(storeError('创建作品失败'));
        return;
      }
      setNewBookTitle('');
      setNewBookGenre('');
      setNewBookCover(undefined);
      setCreateBookOpen(false);
      message.success(`已创建《${title}》`);
    } finally {
      setCreatingBook(false);
    }
  };

  const closeCreateBook = () => {
    if (creatingBook) return;
    setCreateBookOpen(false);
    setNewBookTitle('');
    setNewBookGenre('');
    setNewBookCover(undefined);
  };

  const openCreateWorkflow = () => {
    setNewWorkflowName('');
    setCreateWorkflowOpen(true);
  };

  const closeCreateWorkflow = () => {
    if (creatingWorkflow) return;
    setCreateWorkflowOpen(false);
    setNewWorkflowName('');
  };

  const createWorkflow = async () => {
    const name = newWorkflowName.trim();
    if (!name || creatingWorkflow) return;
    setCreatingWorkflow(true);
    try {
      const canvasState = useCanvasStore.getState();
      const check = validateCanvasName(name, canvasState.savedCanvases);
      if (!check.ok) {
        message.warning(check.error);
        return;
      }
      if (canvasState.canvases.some((canvas) => canvas.name === name)) {
        message.warning('已存在同名画布，请换一个名称');
        return;
      }
      const created = canvasState.createWorkflowCanvas(name, {
        packageId: FICTIONIST_PACKAGE_ID,
      });
      if (!created) {
        message.error(canvasLimitMessage(canvasState.maxCanvases));
        return;
      }
      const switched = await requestAppView('workspace');
      if (!switched) {
        useCanvasStore.getState().deleteSaved(created.savedId);
        message.error('无法打开工作台，工作流创建已撤销');
        return;
      }
      setCreateWorkflowOpen(false);
      setNewWorkflowName('');
      message.success(`已创建工作流“${name}”，并打开同名画布`);
    } finally {
      setCreatingWorkflow(false);
    }
  };

  const confirmDeleteWorkflow = (workflow: FictionWorkflowEntry) => {
    if (workflow.systemWorkflow) {
      message.warning('小说家内置工作流不能删除');
      return;
    }
    const canvasState = useCanvasStore.getState();
    const openCanvas = workflow.canvasId
      ? canvasState.canvases.find((canvas) => canvas.id === workflow.canvasId)
      : undefined;
    const running = openCanvas?.lockClose || openCanvas?.runState?.status === 'running';
    modal.confirm({
      centered: true,
      title: `删除工作流“${workflow.name}”？`,
      icon: <ExclamationCircleOutlined />,
      okText: '删除工作流',
      okButtonProps: { danger: true },
      cancelText: '取消',
      content: (
        <div className="fictionist-delete-warning">
          <p>将删除这条工作流及其已保存画布，删除后无法恢复。</p>
          {running
            ? <p>该画布正在运行，本次运行不会被中断；当前页签会保留为普通未保存画布。</p>
            : <p>如果画布正在打开，对应页签和未保存修改也会一并删除。</p>}
          <p>既有运行历史和已经生成的输出不会自动删除。</p>
        </div>
      ),
      onOk: async () => {
        const latestState = useCanvasStore.getState();
        const latestWorkflow = buildFictionWorkflowEntries({
          savedCanvases: latestState.savedCanvases,
          openCanvases: latestState.canvases,
        }).find((entry) => entry.id === workflow.id && !entry.systemWorkflow);
        if (!latestWorkflow) {
          message.info('该工作流已经不存在');
          return;
        }
        if (latestWorkflow.savedId) latestState.deleteSaved(latestWorkflow.savedId);
        else if (latestWorkflow.canvasId) latestState.removeCanvas(latestWorkflow.canvasId);

        const nextState = useCanvasStore.getState();
        const stillExists = buildFictionWorkflowEntries({
          savedCanvases: nextState.savedCanvases,
          openCanvases: nextState.canvases,
        }).some((entry) => entry.id === workflow.id);
        if (stillExists) {
          const error = '工作流画布正在运行或被锁定，暂时无法删除';
          message.error(error);
          throw new Error(error);
        }
        message.success(`已删除工作流“${workflow.name}”`);
      },
    });
  };

  const renameUserWorkflow = (workflow: FictionWorkflowEntry) => {
    if (workflow.systemWorkflow) return;
    let nextName = workflow.name;
    modal.confirm({
      centered: true,
      title: '重命名工作流',
      okText: '保存名称',
      cancelText: '取消',
      content: (
        <Input
          autoFocus
          maxLength={60}
          defaultValue={workflow.name}
          aria-label="工作流名称"
          onChange={(event) => { nextName = event.target.value; }}
        />
      ),
      onOk: () => {
        const name = nextName.trim();
        const state = useCanvasStore.getState();
        const check = validateCanvasName(
          name,
          state.savedCanvases.filter((canvas) => canvas.id !== workflow.savedId),
        );
        if (!check.ok || state.canvases.some(
          (canvas) => canvas.id !== workflow.canvasId && canvas.name === name,
        )) {
          const error = check.ok ? '已存在同名画布，请换一个名称' : check.error;
          message.warning(error);
          throw new Error(error);
        }
        if (workflow.savedId) state.renameSaved(workflow.savedId, name);
        else if (workflow.canvasId) state.renameCanvas(workflow.canvasId, name);
        message.success(`工作流已重命名为“${name}”`);
      },
    });
  };

  const duplicateUserWorkflow = (workflow: FictionWorkflowEntry) => {
    if (workflow.systemWorkflow) return;
    const state = useCanvasStore.getState();
    const source = workflow.savedId
      ? state.savedCanvases.find((canvas) => canvas.id === workflow.savedId)
      : state.canvases.find((canvas) => canvas.id === workflow.canvasId);
    if (!source) {
      message.warning('工作流画布不存在或尚未保存');
      return;
    }
    let nextName = `${workflow.name} 副本`;
    modal.confirm({
      centered: true,
      title: '复制工作流',
      okText: '创建副本',
      cancelText: '取消',
      content: (
        <Input
          autoFocus
          maxLength={60}
          defaultValue={nextName}
          aria-label="工作流副本名称"
          onChange={(event) => { nextName = event.target.value; }}
        />
      ),
      onOk: () => {
        const name = nextName.trim();
        const latest = useCanvasStore.getState();
        const check = validateCanvasName(name, latest.savedCanvases);
        if (!check.ok || latest.canvases.some((canvas) => canvas.name === name)) {
          const error = check.ok ? '已存在同名画布，请换一个名称' : check.error;
          message.warning(error);
          throw new Error(error);
        }
        const created = latest.createSavedWorkflowCanvas(
          name,
          { packageId: FICTIONIST_PACKAGE_ID },
          { nodes: source.nodes, edges: source.edges },
        );
        if (!created) {
          const error = '创建工作流副本失败';
          message.error(error);
          throw new Error(error);
        }
        message.success(`已创建工作流“${name}”`);
      },
    });
  };

  const restoreSystemWorkflow = (
    workflowKey: FictionistSystemWorkflowKey,
    primary?: FictionWorkflowEntry,
  ) => {
    if (!primary?.savedId) return;
    const spec = FICTIONIST_SYSTEM_WORKFLOW_SPECS.find((item) => item.key === workflowKey);
    if (!spec) return;
    modal.confirm({
      centered: true,
      title: `恢复“${spec.name}”默认主流程？`,
      content: '将用小说家专业包的默认节点和连线覆盖当前主流程，现有修改无法撤销。',
      okText: '恢复默认',
      cancelText: '取消',
      onOk: () => {
        const template = systemWorkflowTemplateForSpec(spec);
        if (!useCanvasStore.getState().resetSavedSystemWorkflow(
          primary.savedId!,
          template.nodes,
          template.edges,
        )) {
          message.error('恢复默认主流程失败');
          throw new Error('恢复默认主流程失败');
        }
        message.success(`“${spec.name}”已恢复专业包默认主流程`);
      },
    });
  };

  const openWorkflowCanvas = async (workflow: FictionWorkflowEntry) => {
    const canvasState = useCanvasStore.getState();
    const previousActiveId = canvasState.activeId;
    let opened = false;
    if (workflow.canvasId && canvasState.canvases.some((canvas) => canvas.id === workflow.canvasId)) {
      canvasState.setActive(workflow.canvasId);
      opened = true;
    } else if (workflow.savedId) {
      const result = canvasState.openSaved(workflow.savedId);
      if (result === 'limit') {
        message.warning(canvasLimitMessage(canvasState.maxCanvases));
        return;
      }
      if (result === 'not-found') {
        message.warning('该工作流画布不存在或已被删除');
        return;
      }
      opened = true;
    }
    if (!opened) {
      message.warning('该工作流画布已关闭且未保存');
      return;
    }
    if (!(await requestAppView('workspace'))) {
      useCanvasStore.getState().setActive(previousActiveId);
      return;
    }
    const activeCanvasId = useCanvasStore.getState().activeId;
    if (activeCanvasId) {
      useUiStore.getState().setWorkspaceReturn({
        target: 'fictionist-workflows',
        canvasId: activeCanvasId,
      });
      useUiStore.getState().setFictionistEntrySection('workflows');
    }
  };

  const openSystemWorkflow = async (
    key: FictionistSystemWorkflowKey,
    version: 1 | 2 = 1,
  ) => {
    let workflow = systemWorkflowEntries.find(
      (entry) => entry.systemWorkflow?.key === key
        && entry.systemWorkflow.version === version,
    );
    if (!workflow) {
      const initialization = ensureFictionistSystemWorkflows();
      if (initialization.failed.length === 0) {
        const state = useCanvasStore.getState();
        workflow = buildFictionWorkflowEntries({
          savedCanvases: state.savedCanvases,
          openCanvases: state.canvases,
        }).find((entry) => entry.systemWorkflow?.key === key
          && entry.systemWorkflow.version === version);
      }
    }
    if (!workflow) {
      message.warning('小说家内置工作流画布正在初始化，请稍后再试');
      return;
    }
    await openWorkflowCanvas(workflow);
  };

  const openBook = async (book: BookView) => {
    if (book.status === 'archived') {
      message.info('请先恢复已归档作品，再进入写作');
      return;
    }
    if (!(await openProject(book.id))) {
      message.error(storeError('打开作品失败'));
      return;
    }
    setSection('chapters');
    setQuery('');
    setEditorMode('edit');
    setOutlineTargetState({ projectId: book.id, target: { kind: 'story' } });
  };

  const openEditBook = (book: BookView) => {
    setEditingBook(book);
    setEditedBookTitle(book.title);
    setEditedBookGenre(book.genre);
    setEditedBookStatus(book.status);
    setEditedBookCover(book.coverImage);
  };

  const confirmEditBook = async () => {
    if (!editingBook || !editedBookTitle.trim() || savingBookDetails) return;
    setSavingBookDetails(true);
    try {
      const title = editedBookTitle.trim();
      if (!(await updateProject(editingBook.id, {
        title,
        genre: editedBookGenre,
        status: editedBookStatus,
        coverImage: editedBookCover,
      }))) {
        message.error(storeError('保存作品资料失败'));
        return;
      }
      setEditingBook(undefined);
      message.success(`已更新《${title}》`);
    } finally {
      setSavingBookDetails(false);
    }
  };

  const selectCustomCover = async (file: File, onSelected: (cover: string) => void) => {
    if (!CUSTOM_COVER_FILE_TYPES.has(file.type)) {
      message.error('封面只支持 PNG、JPEG 或 WebP 图片');
      return;
    }
    if (file.size > MAX_CUSTOM_COVER_FILE_BYTES) {
      message.error('封面图片不能超过 2 MiB');
      return;
    }
    try {
      onSelected(await readFileAsDataUrl(file));
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : '读取封面失败');
    }
  };

  const importWritingRequirements = async (file: File) => {
    if (!isTextFile(file)) {
      message.warning('请选择纯文本格式的文件（TXT、Markdown、CSV、JSON、LOG、XML 或 YAML）');
      return;
    }
    if (file.size > MAX_WRITING_REQUIREMENTS_FILE_BYTES) {
      message.warning('写作要求文件不能超过 1 MiB');
      return;
    }
    try {
      let text = (await fileToText(file)).replace(/^\uFEFF/u, '');
      if (!text.trim()) {
        message.warning('所选文件没有可导入的文本内容');
        return;
      }
      const truncated = text.length > WRITING_REQUIREMENTS_CHAR_CAP;
      if (truncated) text = text.slice(0, WRITING_REQUIREMENTS_CHAR_CAP);
      setContinuationRequirements(text);
      setWritingRequirementsSourceName(file.name);
      if (truncated) {
        message.warning(`已导入「${file.name}」，内容已截断至 ${WRITING_REQUIREMENTS_CHAR_CAP} 字`);
      } else {
        message.success(`已导入写作要求「${file.name}」`);
      }
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : '读取写作要求文件失败');
    }
  };

  const confirmDeleteBook = (book: BookView) => {
    modal.confirm({
      centered: true,
      title: `删除《${book.title}》？`,
      icon: <ExclamationCircleOutlined />,
      okText: '永久删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      content: (
        <div className="fictionist-delete-warning">
          <p>将删除这部作品的 {book.chapterCount} 个章节、{book.wordCount.toLocaleString()} 字正文和本地元数据，删除后无法恢复。</p>
          <p>小说家共享工作流不会随作品删除；用户任务画布和已经生成的输出也不会自动删除。</p>
        </div>
      ),
      onOk: async () => {
        setDeletingProjectId(book.id);
        try {
          if (!(await deleteProject(book.id))) {
            message.error(storeError('删除作品失败'));
            throw new Error(storeError('删除作品失败'));
          }
          message.success(`已删除《${book.title}》`);
        } finally {
          setDeletingProjectId(undefined);
        }
      },
    });
  };

  const saveChapter = async () => {
    if (!selectedChapter) return;
    if (await saveCurrentChapter()) {
      message.success(`已保存《${selectedChapter.title}》`);
    } else {
      message.error(storeError('保存章节失败'));
    }
  };
  saveChapterRef.current = saveChapter;

  const changeChapterStatus = async (status: FictionChapterStatus) => {
    if (!selectedChapter || status === selectedChapter.status) return;
    if (!(await updateChapterStatus(selectedChapter.id, status))) {
      message.error(storeError('更新章节状态失败'));
    }
  };

  useEffect(() => {
    if (section !== 'chapters') return undefined;
    const saveWithShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      if (useFictionistStore.getState().dirty) void saveChapterRef.current();
    };
    window.addEventListener('keydown', saveWithShortcut);
    return () => window.removeEventListener('keydown', saveWithShortcut);
  }, [section]);

  const addChapter = async (volumeId?: string) => {
    const targetVolumeId = volumeId ?? selectedChapter?.volumeId ?? activeVolumes.at(-1)?.id;
    const chapterId = await createStoredChapter(targetVolumeId);
    if (!chapterId) {
      message.error(storeError('创建章节失败'));
      return;
    }
    if (targetVolumeId) {
      setCollapsedVolumeIds((current) => {
        const next = new Set(current);
        next.delete(targetVolumeId);
        return next;
      });
    }
    setSection('chapters');
    setEditorMode('edit');
    message.success('已创建一个空白章节');
  };

  const moveVolume = async (volumeId: string, targetIndex: number) => {
    if (await reorderVolume(volumeId, targetIndex)) return;
    message.error(storeError('调整卷顺序失败'));
  };

  const moveChapter = async (
    chapterId: string,
    targetVolumeId: string,
    targetIndex: number,
  ) => {
    if (!(await moveStoredChapter(chapterId, targetVolumeId, targetIndex))) {
      message.error(storeError('移动章节失败'));
      return;
    }
    setCollapsedVolumeIds((current) => {
      const next = new Set(current);
      next.delete(targetVolumeId);
      return next;
    });
  };

  const openCreateVolume = () => {
    setStructureEditor({ kind: 'create-volume' });
    setStructureTitle(`第${activeVolumes.length + 1}卷`);
  };

  const openRenameVolume = (volumeId: string) => {
    const volume = index.volumes[volumeId];
    if (!volume) return;
    setStructureEditor({ kind: 'rename-volume', id: volumeId });
    setStructureTitle(volume.title);
  };

  const openRenameChapter = (chapterId: string) => {
    const chapter = index.chapters[chapterId];
    if (!chapter) return;
    setStructureEditor({ kind: 'rename-chapter', id: chapterId });
    setStructureTitle(chapter.title);
  };

  const confirmStructureEdit = async () => {
    const title = structureTitle.trim();
    if (!structureEditor || !title || savingStructure) return;
    setSavingStructure(true);
    try {
      if (structureEditor.kind === 'create-volume') {
        const volumeId = await createVolume(title);
        if (!volumeId) {
          message.error(storeError('创建卷失败'));
          return;
        }
        setCollapsedVolumeIds((current) => {
          const next = new Set(current);
          next.delete(volumeId);
          return next;
        });
        message.success(`已创建“${title}”`);
      } else if (structureEditor.kind === 'rename-volume') {
        if (!(await renameVolume(structureEditor.id, title))) {
          message.error(storeError('卷重命名失败'));
          return;
        }
        message.success(`卷已重命名为“${title}”`);
      } else {
        if (!(await renameChapter(structureEditor.id, title))) {
          message.error(storeError('章节重命名失败'));
          return;
        }
        message.success(`章节已重命名为“${title}”`);
      }
      setStructureEditor(undefined);
    } finally {
      setSavingStructure(false);
    }
  };

  const confirmDeleteVolume = (volumeId: string) => {
    const volume = index.volumes[volumeId];
    if (!volume || !activeBook) return;
    if (activeBook.volumeIds.length <= 1) {
      message.info('每部作品至少需要保留一个卷，请先新建其他卷');
      return;
    }
    const volumeChapters = volume.chapterIds.flatMap((chapterId) => {
      const chapter = index.chapters[chapterId];
      return chapter ? [chapter] : [];
    });
    const wordCount = volumeChapters.reduce((total, chapter) => total + chapter.wordCount, 0);
    const deletesUnsavedChapter = Boolean(
      dirty && activeChapterId && volume.chapterIds.includes(activeChapterId),
    );
    modal.confirm({
      centered: true,
      title: `删除“${volume.title}”？`,
      icon: <ExclamationCircleOutlined />,
      okText: '永久删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      content: (
        <div className="fictionist-delete-warning">
          <p>将同时删除本卷的 {volumeChapters.length} 个章节和 {wordCount.toLocaleString()} 字正文，删除后无法恢复。</p>
          {deletesUnsavedChapter ? <p>当前尚未保存的修改也会一并丢失。</p> : null}
        </div>
      ),
      onOk: async () => {
        if (!(await deleteVolume(volumeId))) {
          message.error(storeError('删除卷失败'));
          throw new Error(storeError('删除卷失败'));
        }
        setCollapsedVolumeIds((current) => {
          const next = new Set(current);
          next.delete(volumeId);
          return next;
        });
        message.success(`已删除“${volume.title}”`);
      },
    });
  };

  const confirmDeleteChapter = (chapterId: string) => {
    const chapter = index.chapters[chapterId];
    if (!chapter) return;
    modal.confirm({
      centered: true,
      title: `删除《${chapter.title}》？`,
      icon: <ExclamationCircleOutlined />,
      okText: '永久删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      content: (
        <div className="fictionist-delete-warning">
          <p>将删除本章的 {chapter.wordCount.toLocaleString()} 字正文，删除后无法恢复。</p>
          {dirty && activeChapterId === chapterId
            ? <p>当前尚未保存的修改也会一并丢失。</p>
            : null}
        </div>
      ),
      onOk: async () => {
        if (!(await deleteChapter(chapterId))) {
          message.error(storeError('删除章节失败'));
          throw new Error(storeError('删除章节失败'));
        }
        message.success(`已删除《${chapter.title}》`);
      },
    });
  };

  const openBookSearch = () => {
    setBookSearchOpen(true);
    setBookSearchQuery('');
    setBookSearchResults([]);
    setBookSearchTruncated(false);
    setBookSearchState('idle');
    setBookReplaceText('');
  };

  const closeBookSearch = () => {
    bookSearchRequestRef.current += 1;
    setBookSearchOpen(false);
  };

  const runBookSearch = async (value?: string) => {
    const searchValue = (value ?? bookSearchQuery).trim();
    const requestId = ++bookSearchRequestRef.current;
    setBookSearchQuery(searchValue);
    setBookSearchResults([]);
    setBookSearchTruncated(false);
    if (!searchValue) {
      setBookSearchState('idle');
      return;
    }
    setBookSearchState('searching');
    const result = await searchCurrentProject(searchValue);
    if (requestId !== bookSearchRequestRef.current) return;
    if (!result) {
      setBookSearchState('done');
      message.error(storeError('全书搜索失败'));
      return;
    }
    setBookSearchResults(result.matches);
    setBookSearchTruncated(result.truncated);
    setBookSearchState('done');
  };

  const openSearchResult = async (match: FictionSearchMatch) => {
    if (match.kind === 'chapter' && !(await selectChapter(match.chapterId))) {
      message.error(storeError('打开搜索结果失败'));
      return;
    }
    setCollapsedVolumeIds((current) => {
      const next = new Set(current);
      next.delete(match.volumeId);
      return next;
    });
    setQuery('');
    setSection('chapters');
    setEditorMode('edit');
    closeBookSearch();
  };

  const confirmReplaceBookText = async () => {
    const search = bookSearchQuery.trim();
    if (!search) return;
    if (dirty && !(await saveCurrentChapter())) {
      message.error(storeError('当前章节保存失败，无法执行全书替换'));
      return;
    }
    modal.confirm({
      centered: true,
      title: `替换全书正文中的“${search}”？`,
      content: `将只修改章节正文，不修改卷名、章节名、大纲、设定库或时间线。替换为：${bookReplaceText || '（空文本）'}`,
      okText: '全部替换',
      cancelText: '取消',
      onOk: async () => {
        const result = await replaceCurrentProjectText(search, bookReplaceText);
        if (!result) {
          const error = storeError('全书替换失败');
          message.error(error);
          throw new Error(error);
        }
        message.success(`已在 ${result.changedChapterIds.length} 章中替换 ${result.replacementCount} 处`);
        await runBookSearch(search);
      },
    });
  };

  const openChapterWriting = () => {
    if (!selectedChapter) return;
    const mode = currentChapterIsEmpty ? 'draft-current' : 'continue';
    const volume = index.volumes[selectedChapter.volumeId];
    const position = volume?.chapterIds.indexOf(selectedChapter.id) ?? -1;
    const nextChapterId = position >= 0 ? volume?.chapterIds[position + 1] : undefined;
    const nextChapter = nextChapterId ? index.chapters[nextChapterId] : undefined;
    setWritingMode(mode);
    setProposedChapterTitle(mode === 'draft-current'
      ? selectedChapter.title
      : nextChapter?.title ?? `未命名章节 ${chapters.length + 1}`);
    setContinueOpen(true);
  };

  const startFirstChapterDraft = async () => {
    const chapterId = await createStoredChapter();
    if (!chapterId) {
      message.error(storeError('创建第一章失败'));
      return;
    }
    setSection('chapters');
    setEditorMode('edit');
    setWritingMode('draft-current');
    setProposedChapterTitle(
      useFictionistStore.getState().index.chapters[chapterId]?.title ?? '未命名章节 1',
    );
    setContinueOpen(true);
  };

  const confirmContinue = async () => {
    if (creatingContinuation || !selectedChapter || !activeBook) return;
    const normalizedChapterTitle = proposedChapterTitle.trim();
    if (!normalizedChapterTitle) {
      message.error('章节名称不能为空');
      return;
    }
    const selectedModelRef = unpackModelRef(selectedModel);
    const canvasState = useCanvasStore.getState();
    if (canvasState.canvases.length >= canvasState.maxCanvases) {
      message.error(canvasLimitMessage(canvasState.maxCanvases));
      return;
    }
    setCreatingContinuation(true);
    try {
      if (!(await saveCurrentChapter())) {
        message.error(storeError('当前章节保存失败，未创建续写任务'));
        return;
      }
      const current = useFictionistStore.getState();
      const project = current.index.projects[activeBook.id];
      const chapter = current.index.chapters[selectedChapter.id];
      if (!project || !chapter) {
        message.error('当前作品或章节已不存在');
        return;
      }
      const draftingCurrent = writingMode === 'draft-current';
      const workflowKey = draftingCurrent
        ? 'fictionist.chapter-draft'
        : 'fictionist.chapter-continue';
      const taskType = draftingCurrent ? DRAFT_CHAPTER_TASK_TYPE : CONTINUE_CHAPTER_TASK_TYPE;
      const workflowVersion = 1 as const;
      if (draftingCurrent && (chapter.wordCount !== 0 || current.chapterContent.trim())) {
        message.error('当前章节已经有正文，请关闭弹窗后使用“续写下一章”');
        return;
      }
      const volume = current.index.volumes[chapter.volumeId];
      const sourcePosition = volume?.chapterIds.indexOf(chapter.id) ?? -1;
      const trailingIds = !draftingCurrent && sourcePosition >= 0
        ? volume?.chapterIds.slice(sourcePosition + 1) ?? []
        : [];
      const targetChapter = draftingCurrent
        ? chapter
        : trailingIds.length === 1
          ? current.index.chapters[trailingIds[0]]
          : undefined;
      if (!draftingCurrent && trailingIds.length > 0
        && (!targetChapter || targetChapter.wordCount !== 0 || targetChapter.revision !== 0)) {
        message.error('当前章节之后已有其他正文或多个章节，请选择最后一章再续写');
        return;
      }
      const request = {
        mode: writingMode,
        workflowKey,
        workflowVersion,
        proposedChapterTitle: normalizedChapterTitle,
        project,
        chapter,
        chapterContent: current.chapterContent,
        nextChapterGoal: continuationGoal,
        writingRequirements: continuationRequirements,
        targetWordCount,
        targetChapter,
        canonEntries: canonEntriesForProject(current.index, project.id),
        timelineEvents: timelineEventsForProject(current.index, project.id),
        projectOutline: project.outline,
      };
      const snapshot = buildContinuationSnapshot(request);
      const payload = continuationPayload(request);
      const taskLabel = draftingCurrent ? 'AI 起草' : '续写下一章';
      const workflowSpec = FICTIONIST_SYSTEM_WORKFLOW_SPECS.find(
        (spec) => spec.key === workflowKey,
      );
      if (!workflowSpec) {
        message.error('小说家内置工作流配置缺失');
        return;
      }
      const initialization = ensureFictionistSystemWorkflows();
      if (initialization.failed.length > 0) {
        message.error('小说家内置工作流画布初始化失败，无法创建任务');
        return;
      }
      let sourceCanvas = useCanvasStore.getState().canvases.find((canvas) =>
        isFictionistSystemWorkflow(
          canvas.workflowRef,
          workflowKey,
          workflowVersion,
        ));
      if (!sourceCanvas) {
        const saved = useCanvasStore.getState().savedCanvases.find((canvas) =>
          isFictionistSystemWorkflow(
            canvas.workflowRef,
            workflowKey,
            workflowVersion,
          ));
        if (saved) {
          useCanvasStore.getState().openSaved(saved.id);
          sourceCanvas = useCanvasStore.getState().canvases.find((canvas) =>
            isFictionistSystemWorkflow(
              canvas.workflowRef,
              workflowKey,
              workflowVersion,
            ));
        }
      }
      if (!sourceCanvas) {
        message.error('对应的小说家内置工作流画布不存在，无法创建任务');
        return;
      }
      const hasUnconfiguredModel = sourceCanvas.nodes.some((node) => {
        const data = node.data as AgentNodeData;
        return !data.gateType
          && typeof data.timerSeconds !== 'number'
          && !(data.modelRef ?? selectedModelRef);
      });
      if (hasUnconfiguredModel) {
        message.error('请先在小说家内置工作流画布中为 Agent 节点选择模型');
        return;
      }
      const origin = createProfessionalTask({
        packageId: FICTIONIST_PACKAGE_ID,
        taskType,
        taskLabel,
        sourceLabel: `《${project.title}》· ${draftingCurrent
          ? payload.proposedChapterTitle
          : chapter.title}`,
        sourceRefs: [
          { type: 'fiction-project', id: project.id },
          { type: 'fiction-chapter', id: chapter.id, revision: chapter.revision },
        ],
        contextSnapshot: {
          title: `《${project.title}》${draftingCurrent ? '章节起草' : '续写'}上下文`,
          format: 'markdown',
          content: snapshot,
        },
        expectedResult: {
          role: CHAPTER_DRAFT_RESULT_ROLE,
          outputFormat: 'txt',
        },
        historyDescriptor: {
          subjectType: 'fiction-chapter',
          subjectId: payload.targetChapterId,
          subjectLabel: payload.proposedChapterTitle,
          actionLabel: draftingCurrent ? 'AI起草' : '续写',
        },
        packagePayload: payload,
      });
      const graph = {
        nodes: sourceCanvas.nodes.map((node) => {
          const data = node.data as AgentNodeData;
          const needsTaskContext = data.professionalAgentId === FICTIONIST_AGENT_IDS.chapterWriter
            || data.resultRole === CHAPTER_CONTEXT_RESULT_ROLE
            || data.resultRole === CHAPTER_CANON_CHECK_RESULT_ROLE;
          return {
            ...node,
            data: {
              ...data,
              modelRef: data.modelRef ?? selectedModelRef,
              ...(needsTaskContext ? {
                capabilities: {
                  ...data.capabilities,
                  input: {
                    ...data.capabilities?.input,
                    enabled: true,
                    includeSupplementalSources: true,
                  },
                },
                dataSourceMode: 'inline',
                inlineDataSource: {
                  name: draftingCurrent ? '章节起草任务上下文快照' : '续写任务上下文快照',
                  content: snapshot,
                },
              } : {}),
            },
          };
        }),
        edges: sourceCanvas.edges.map((edge) => ({ ...edge })),
      };
      const canvasId = useCanvasStore.getState().createCanvasFromTemplate(
        `${payload.proposedChapterTitle} · ${taskLabel}`,
        graph.nodes,
        graph.edges,
        origin,
        {
          packageId: FICTIONIST_PACKAGE_ID,
          projectId: project.id,
          workflowId: origin.taskId,
          sourceWorkflow: {
            key: workflowKey,
            version: workflowVersion,
            workflowId: sourceCanvas.workflowRef?.workflowId,
            contentSignature: systemWorkflowContentSignature(
              sourceCanvas.nodes,
              sourceCanvas.edges,
            ),
            fallbackEnabled: isWorkflowFallbackEnabled(
              FICTIONIST_PACKAGE_ID,
              workflowKey,
              workflowPolicies,
            ),
          },
        },
      );
      if (!canvasId) {
        removeProfessionalTask(origin.taskId);
        message.error(canvasLimitMessage(useCanvasStore.getState().maxCanvases));
        return;
      }
      linkTaskCanvas(origin, canvasId);
      setContinueOpen(false);
      const switched = await requestAppView('workspace');
      if (switched) {
        message.success(`${draftingCurrent ? '章节起草' : '续写'}已引用主流程，正在启动`);
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('agent-titlebar-command', {
            detail: { type: 'run-canvas', canvasId },
          }));
        }, 0);
      }
    } finally {
      setCreatingContinuation(false);
    }
  };

  const createOutlineWorkflowTask = async (operation: FictionOutlineTaskOperation) => {
    if (creatingOutlineTask || !activeProjectId) return;
    const targetValue = operation === 'import'
      ? outlineImportTargetValue
      : outlineOptimizeTargetValue;
    const target = outlineTargetFromValue(targetValue);
    if (!target) {
      message.error('大纲任务目标无效，请重新选择');
      return;
    }
    if (operation === 'import' && !outlineImportSourceText) {
      message.error('请先选择本地大纲文件');
      return;
    }
    if (operation === 'optimize' && outlineOptimizeGoals.length === 0) {
      message.error('请至少选择一个优化方向');
      return;
    }
    const selectedModelRef = unpackModelRef(selectedModel);
    if (!selectedModelRef) {
      message.error('请选择运行模型');
      return;
    }
    const canvasState = useCanvasStore.getState();
    if (canvasState.canvases.length >= canvasState.maxCanvases) {
      message.error(canvasLimitMessage(canvasState.maxCanvases));
      return;
    }
    setCreatingOutlineTask(true);
    try {
      if (outlineDirty && !(await persistOutlineDraft(false))) {
        message.error(storeError('当前大纲保存失败，未创建任务'));
        return;
      }
      const fictionist = useFictionistStore.getState();
      const project = fictionist.index.projects[activeProjectId];
      if (!project) {
        message.error('当前作品已不存在');
        return;
      }
      const targetExists = target.kind === 'story'
        || (target.kind === 'volume'
          ? fictionist.index.volumes[target.id]?.projectId === project.id
          : fictionist.index.chapters[target.id]?.projectId === project.id);
      if (!targetExists) {
        message.error('所选大纲范围已不存在，请重新选择');
        return;
      }
      const workflowKey = operation === 'import'
        ? FICTIONIST_OUTLINE_WORKFLOW_KEYS.import
        : FICTIONIST_OUTLINE_WORKFLOW_KEYS.optimize;
      const initialization = ensureFictionistSystemWorkflows();
      if (initialization.failed.length > 0) {
        message.error('小说家大纲工作流初始化失败，无法创建任务');
        return;
      }
      const latestCanvasState = useCanvasStore.getState();
      const sourceCanvas = latestCanvasState.canvases.find((canvas) =>
        isFictionistSystemWorkflow(canvas.workflowRef, workflowKey, 1))
        ?? latestCanvasState.savedCanvases.find((canvas) =>
          isFictionistSystemWorkflow(canvas.workflowRef, workflowKey, 1));
      if (!sourceCanvas) {
        message.error('对应的大纲工作流主流程不存在，无法创建任务');
        return;
      }
      const outline = project.outline ?? createEmptyFictionProjectOutline();
      const targetLabel = outlineTargetLabel(fictionist.index, target);
      const snapshot = buildOutlineTaskSnapshot({
        operation,
        project,
        index: fictionist.index,
        outline,
        target,
        sourceName: operation === 'import' ? outlineImportSourceName : undefined,
        sourceText: operation === 'import' ? outlineImportSourceText : undefined,
        optimizationGoals: operation === 'optimize' ? outlineOptimizeGoals : undefined,
        intensity: operation === 'optimize' ? outlineOptimizeIntensity : undefined,
        requirements: operation === 'optimize' ? outlineOptimizeRequirements : undefined,
      });
      const taskLabel = operation === 'import' ? '导入大纲整理' : '大纲优化';
      const sourceRefs = [{ type: 'fiction-project', id: project.id }];
      if (target.kind !== 'story') {
        sourceRefs.push({ type: `fiction-${target.kind}`, id: target.id });
      }
      const origin = createProfessionalTask({
        packageId: FICTIONIST_PACKAGE_ID,
        taskType: operation === 'import' ? OUTLINE_IMPORT_TASK_TYPE : OUTLINE_OPTIMIZE_TASK_TYPE,
        taskLabel,
        sourceLabel: `《${project.title}》· ${targetLabel}`,
        sourceRefs,
        contextSnapshot: {
          title: `《${project.title}》${taskLabel}上下文`,
          format: 'markdown',
          content: snapshot,
        },
        expectedResult: {
          role: OUTLINE_RESULT_ROLE,
          outputFormat: 'markdown',
        },
        historyDescriptor: {
          subjectType: 'fiction-outline',
          subjectId: target.kind === 'story' ? project.id : target.id,
          subjectLabel: targetLabel,
          actionLabel: operation === 'import' ? '大纲整理' : '大纲优化',
        },
        packagePayload: {
          operation,
          projectId: project.id,
          target,
          targetLabel,
          sourceOutlineUpdatedAt: outline.updatedAt,
          ...(operation === 'import' && outlineImportSourceName
            ? { sourceName: outlineImportSourceName }
            : {}),
          ...(operation === 'optimize' ? {
            optimizationGoals: outlineOptimizeGoals,
            intensity: outlineOptimizeIntensity,
          } : {}),
        },
      });
      const graph = {
        nodes: sourceCanvas.nodes.map((node) => {
          const data = node.data as AgentNodeData;
          if (data.gateType || typeof data.timerSeconds === 'number') return { ...node };
          return {
            ...node,
            data: {
              ...data,
              modelRef: data.modelRef ?? selectedModelRef,
              capabilities: {
                ...data.capabilities,
                input: {
                  ...data.capabilities?.input,
                  enabled: true,
                  includeSupplementalSources: true,
                },
              },
              dataSourceMode: 'inline',
              inlineDataSource: {
                name: `${taskLabel}任务上下文快照`,
                content: snapshot,
              },
            },
          };
        }),
        edges: sourceCanvas.edges.map((edge) => ({ ...edge })),
      };
      const canvasId = useCanvasStore.getState().createCanvasFromTemplate(
        `${targetLabel} · ${taskLabel}`,
        graph.nodes,
        graph.edges,
        origin,
        {
          packageId: FICTIONIST_PACKAGE_ID,
          projectId: project.id,
          workflowId: origin.taskId,
          sourceWorkflow: {
            key: workflowKey,
            version: 1,
            workflowId: sourceCanvas.workflowRef?.workflowId,
            contentSignature: systemWorkflowContentSignature(
              sourceCanvas.nodes,
              sourceCanvas.edges,
            ),
            fallbackEnabled: isWorkflowFallbackEnabled(
              FICTIONIST_PACKAGE_ID,
              workflowKey,
              workflowPolicies,
            ),
          },
        },
      );
      if (!canvasId) {
        removeProfessionalTask(origin.taskId);
        message.error(canvasLimitMessage(useCanvasStore.getState().maxCanvases));
        return;
      }
      linkTaskCanvas(origin, canvasId);
      setOutlineImportOpen(false);
      setOutlineOptimizeOpen(false);
      if (await requestAppView('workspace')) {
        message.success(`${taskLabel}已引用主流程，正在启动`);
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('agent-titlebar-command', {
            detail: { type: 'run-canvas', canvasId },
          }));
        }, 0);
      }
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : '创建大纲任务失败');
    } finally {
      setCreatingOutlineTask(false);
    }
  };

  const openTaskReview = (task: ProfessionalTask) => {
    if (!isFictionistContinuationPayload(task.packagePayload)) return;
    const output = task.outputs.find((item) => item.resultRole === CHAPTER_DRAFT_RESULT_ROLE);
    if (!output) {
      message.error('没有找到可确认的章节草稿');
      return;
    }
    focusTask(task.id);
    setReviewDraft(output.content);
    setReviewTitle(task.packagePayload.proposedChapterTitle);
    setReviewOpen(true);
  };

  const openOutlineTaskReview = (task: ProfessionalTask) => {
    if (!isFictionistOutlineTaskPayload(task.packagePayload)) return;
    try {
      const result = outlineWorkflowResultForTask(task, index);
      focusTask(task.id);
      setSection('outline');
      setOutlineTargetState({
        projectId: task.packagePayload.projectId,
        target: task.packagePayload.target,
      });
      setOutlineReviewState({ taskId: task.id, result });
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : '大纲结果无法读取');
    }
  };

  const reopenTaskCanvas = async () => {
    if (!focusedTask) return;
    const canvasState = useCanvasStore.getState();
    const openCanvas = canvasState.canvases.find((canvas) =>
      canvas.id === focusedTask.canvasId || canvas.id === focusedTask.runCanvasId);
    if (openCanvas) {
      canvasState.setActive(openCanvas.id);
    } else {
      const saved = canvasState.savedCanvases.find((canvas) =>
        canvas.origin?.taskId === focusedTask.id
        && canvas.workflowRef?.sourceWorkflow?.version
          === (focusedTask.fallbackAttempt?.status === 'succeeded' ? 2 : 1));
      const result = saved
        ? canvasState.openSaved(saved.id)
        : focusedTask.runId
          ? canvasState.openRun(focusedTask.runId)
          : 'not-found';
      if (result === 'limit') {
        message.error(canvasLimitMessage(canvasState.maxCanvases));
        return;
      }
      if (result === 'not-found') {
        message.error('对应画布已关闭且未保存，无法重新打开');
        return;
      }
    }
    setReviewOpen(false);
    setOutlineReviewState(undefined);
    await requestAppView('workspace');
  };

  const discardReview = () => {
    if (!focusedTask) return;
    markTaskDiscarded(focusedTask.id);
    setReviewOpen(false);
    message.info(reviewWritingMode === 'draft-current'
      ? '已放弃这份草稿，当前空白章节没有变化'
      : '已放弃这份草稿，原章节没有变化');
  };

  const discardOutlineReview = () => {
    if (!outlineReviewTask) return;
    markTaskDiscarded(outlineReviewTask.id);
    setOutlineReviewState(undefined);
    message.info('已放弃这份大纲结果，正式大纲没有变化');
  };

  const applyOutlineReview = async () => {
    if (!outlineReviewTask || !outlineReviewPayload || !outlineReviewState) return;
    const payload = outlineReviewPayload;
    const fictionist = useFictionistStore.getState();
    const project = fictionist.index.projects[payload.projectId];
    if (!project) {
      message.error('对应作品已不存在');
      return;
    }
    if (outlineDraftState?.projectId === payload.projectId) {
      message.error('当前大纲还有未保存修改，请保存后重新运行工作流');
      return;
    }
    const currentOutline = project.outline ?? createEmptyFictionProjectOutline();
    if (currentOutline.updatedAt !== payload.sourceOutlineUpdatedAt) {
      message.error('正式大纲在任务运行期间已经修改。为避免覆盖新内容，请重新运行工作流');
      return;
    }
    setSavingOutlineReview(true);
    try {
      const merged = applyOutlineWorkflowResult(currentOutline, outlineReviewState.result);
      const { updatedAt: _updatedAt, ...input } = merged;
      if (!(await saveProjectOutline(project.id, input))) {
        message.error(storeError('写入正式大纲失败'));
        return;
      }
      markTaskAccepted(outlineReviewTask.id);
      setOutlineReviewState(undefined);
      setOutlineDraftState(undefined);
      setOutlineTargetState({ projectId: project.id, target: payload.target });
      setSection('outline');
      message.success(`${payload.targetLabel}已更新，工作流结果已写入正式大纲`);
    } finally {
      setSavingOutlineReview(false);
    }
  };

  const saveReviewAsChapter = async () => {
    if (!focusedTask || !isFictionistContinuationPayload(focusedTask.packagePayload)) return;
    if (!reviewTitle.trim() || !reviewDraft.trim()) {
      message.error('章节名称和正文不能为空');
      return;
    }
    setSavingReview(true);
    try {
      const payload = focusedTask.packagePayload;
      const result = await acceptContinuationDraft({
        writingMode: chapterWritingMode(payload),
        taskId: focusedTask.id,
        projectId: payload.projectId,
        sourceChapterId: payload.sourceChapterId,
        sourceRevision: payload.sourceRevision,
        targetChapterId: payload.targetChapterId,
        targetRevision: payload.targetRevision,
        title: reviewTitle,
        content: reviewDraft,
      });
      if (!result.ok) {
        message.error(result.message);
        return;
      }
      markTaskAccepted(focusedTask.id);
      setReviewOpen(false);
      setSection('chapters');
      setEditorMode('edit');
      message.success(chapterWritingMode(payload) === 'draft-current'
        ? `草稿已写入《${reviewTitle.trim()}》`
        : `草稿已保存为《${reviewTitle.trim()}》，原章节没有被覆盖`);
    } finally {
      setSavingReview(false);
    }
  };

  if (hydrationState === 'error') {
    return (
      <div className="fictionist-workspace fictionist-load-state pearl-page-enter">
        <Result
          status="error"
          title="小说数据加载失败"
          subTitle={errorMessage || '无法读取本地小说数据'}
          extra={<Button type="primary" onClick={() => void hydrate()}>重新加载</Button>}
        />
      </div>
    );
  }

  if (hydrationState === 'loading') {
    return (
      <div className="fictionist-workspace fictionist-load-state pearl-page-enter">
        <Spin description="正在加载小说数据…" size="large" />
      </div>
    );
  }

  return (
    <div className="fictionist-workspace pearl-page-enter">
      <header className="fictionist-project-bar">
        {section === 'library' || section === 'workflows' ? (
          <div className="fictionist-project-identity fictionist-project-identity--library">
            <span className="fictionist-project-mark"><BookOutlined /></span>
            <span><strong>小说家</strong><small>专业包 · {books.length} 部作品</small></span>
          </div>
        ) : (
          <div className="fictionist-project-identity">
            <span className="fictionist-project-mark"><BookOutlined /></span>
            <span><strong>{activeBook?.title ?? '未选择作品'}</strong><small>{activeBook?.genre ?? '未设置题材'}</small></span>
          </div>
        )}
        {section === 'library' || section === 'workflows' ? (
          <Segmented
            className="fictionist-package-navigation"
            value={section}
            options={PACKAGE_SECTION_ITEMS}
            onChange={(value) => void switchSection(value as FictionistSection)}
          />
        ) : (
          <div className="fictionist-project-stats" aria-label="项目概况">
            <span><strong>{activeBook?.chapterCount ?? 0}</strong> 章</span>
            <span><strong>{(activeBook?.wordCount ?? 0).toLocaleString()}</strong> 字</span>
            <span><strong>{canonEntries.length}</strong> 条正式设定</span>
          </div>
        )}
        {section !== 'library' && section !== 'workflows' ? (
          <div className="fictionist-project-actions">
            <Button icon={<ArrowLeftOutlined />} onClick={() => void switchSection('library')}>返回书架</Button>
            <Button icon={<BranchesOutlined />} onClick={() => setWorkflowBindingOpen(true)}>工作流绑定</Button>
            <Button className="fictionist-search-action" icon={<SearchOutlined />} onClick={openBookSearch}>全书搜索</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => void addChapter()}>新建章节</Button>
          </div>
        ) : null}
      </header>

      <div className={`fictionist-layout fictionist-layout--${section}`}>
        {section !== 'library' && section !== 'workflows' ? (
          <nav className="fictionist-rail" aria-label="作品功能">
            {PROJECT_SECTION_ITEMS.map((item) => (
              <Tooltip key={item.id} title={item.label} placement="right">
                <button
                  type="button"
                  className={section === item.id ? 'is-active' : ''}
                  aria-current={section === item.id ? 'page' : undefined}
                  onClick={() => void switchSection(item.id)}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              </Tooltip>
            ))}
          </nav>
        ) : null}

        {section !== 'workflows' ? (
          <aside className="fictionist-navigator">
          <div className="fictionist-panel-title">
            <span>
              <strong>{section === 'library' ? '作品分类' : section === 'chapters' ? '卷与章节' : section === 'outline' ? '大纲结构' : PROJECT_SECTION_ITEMS.find((item) => item.id === section)?.label}</strong>
              <small>{section === 'library' ? '按状态与分类查找' : section === 'outline' ? '总纲与卷章规划' : '项目内容导航'}</small>
            </span>
            {section !== 'library' && section !== 'outline' ? (
              <Tooltip title={section === 'chapters' ? '新建卷' : section === 'timeline' ? '新增事件' : '添加'}>
                <Button
                  type="text"
                  size="small"
                  aria-label={section === 'chapters' ? '新建卷' : section === 'timeline' ? '新增时间线事件' : '添加内容'}
                  icon={<PlusOutlined />}
                  onClick={section === 'chapters'
                    ? openCreateVolume
                    : section === 'timeline'
                      ? openCreateTimelineEvent
                      : openCreateCanonEntry}
                />
              </Tooltip>
            ) : null}
          </div>
          <Input
            allowClear
            size="small"
            prefix={<SearchOutlined />}
            placeholder={section === 'library' ? '搜索书名或分类' : section === 'chapters' ? '筛选卷名或章节名' : section === 'outline' ? '搜索卷纲或章节纲要' : '搜索当前分区'}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {section === 'library' ? (
            <div className="fictionist-library-filters">
              <section className="fictionist-filter-group fictionist-filter-group--status" aria-label="书籍状态筛选">
                <div className="fictionist-filter-heading">
                  <span><ClockCircleOutlined /><strong>书籍状态</strong></span>
                  <small>按创作进度</small>
                </div>
                <div className="fictionist-filter-options">
                  {LIBRARY_STATUS_FILTERS.map((item) => (
                    <button
                      type="button"
                      className={`fictionist-filter-option fictionist-filter-option--${item.key.replace(':', '-')}${libraryFilter === item.key ? ' is-active' : ''}`}
                      key={item.key}
                      onClick={() => setLibraryFilter(item.key)}
                    >
                      <span><i aria-hidden="true" />{item.label}</span>
                      <small>{item.key === 'all' ? books.length : books.filter((book) => `status:${book.status}` === item.key).length}</small>
                    </button>
                  ))}
                </div>
              </section>
              <section className="fictionist-filter-group fictionist-filter-group--category" aria-label="作品分类筛选">
                <div className="fictionist-filter-heading">
                  <span><FolderOutlined /><strong>作品分类</strong></span>
                  <small>{libraryCategories.length} 个分类</small>
                </div>
                <div className="fictionist-filter-options">
                  {libraryCategories.map((category) => (
                    <button
                      type="button"
                      className={`fictionist-filter-option${libraryFilter === `category:${category}` ? ' is-active' : ''}`}
                      key={category}
                      onClick={() => setLibraryFilter(`category:${category}`)}
                    >
                      <span><FolderOutlined />{category}</span>
                      <small>{books.filter((book) => book.genre === category).length}</small>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          ) : section === 'chapters' ? (
            <div className="fictionist-chapter-tree">
              {activeVolumes.map((volume, volumeIndex) => {
                const volumeChapters = volume.chapterIds.flatMap((chapterId) => {
                  const chapter = index.chapters[chapterId];
                  return chapter && visibleChapterIds.has(chapterId) ? [chapter] : [];
                });
                const volumeMatchesQuery = volume.title
                  .toLocaleLowerCase()
                  .includes(query.trim().toLocaleLowerCase());
                if (query.trim() && volumeChapters.length === 0 && !volumeMatchesQuery) return null;
                const collapsed = collapsedVolumeIds.has(volume.id) && !query.trim();
                return (
                  <section className="fictionist-volume-group" key={volume.id}>
                    <div className="fictionist-volume-label">
                      <button
                        className="fictionist-volume-toggle"
                        type="button"
                        aria-expanded={!collapsed}
                        onClick={() => setCollapsedVolumeIds((current) => {
                          const next = new Set(current);
                          if (next.has(volume.id)) next.delete(volume.id);
                          else next.add(volume.id);
                          return next;
                        })}
                      >
                        {collapsed ? <RightOutlined /> : <DownOutlined />}
                        <FolderOutlined />
                        <span>{volume.title}</span>
                        <small>{volume.chapterIds.length} 章</small>
                      </button>
                      <span className="fictionist-volume-actions">
                        <Tooltip title="在本卷新建章节">
                          <Button
                            type="text"
                            size="small"
                            aria-label={`在“${volume.title}”中新建章节`}
                            icon={<PlusOutlined />}
                            onClick={() => void addChapter(volume.id)}
                          />
                        </Tooltip>
                        <Dropdown
                          trigger={['click']}
                          menu={{
                            items: [
                              {
                                key: 'up',
                                label: '上移卷',
                                icon: <ArrowUpOutlined />,
                                disabled: volumeIndex === 0,
                              },
                              {
                                key: 'down',
                                label: '下移卷',
                                icon: <ArrowDownOutlined />,
                                disabled: volumeIndex === activeVolumes.length - 1,
                              },
                              { key: 'rename', label: '重命名卷', icon: <EditOutlined /> },
                              {
                                key: 'delete',
                                label: '删除卷',
                                icon: <DeleteOutlined />,
                                danger: true,
                                disabled: activeVolumes.length <= 1,
                              },
                            ],
                            onClick: ({ key }) => {
                              if (key === 'up') void moveVolume(volume.id, volumeIndex - 1);
                              else if (key === 'down') void moveVolume(volume.id, volumeIndex + 1);
                              else if (key === 'rename') openRenameVolume(volume.id);
                              else if (key === 'delete') confirmDeleteVolume(volume.id);
                            },
                          }}
                        >
                          <Button
                            type="text"
                            size="small"
                            aria-label={`管理“${volume.title}”`}
                            icon={<MoreOutlined />}
                          />
                        </Dropdown>
                      </span>
                    </div>
                    {!collapsed ? volumeChapters.map((chapter) => {
                      const chapterIndex = volume.chapterIds.indexOf(chapter.id);
                      return (
                      <div
                        className={`fictionist-chapter-row${selectedChapter?.id === chapter.id ? ' is-active' : ''}`}
                        key={chapter.id}
                      >
                        <button
                          className="fictionist-chapter-open"
                          type="button"
                          onClick={() => void selectChapter(chapter.id).then((selected) => {
                            if (selected) setEditorMode('edit');
                            else message.error(storeError('切换章节失败'));
                          })}
                        >
                          <span className="fictionist-chapter-index">{String(chapterNumberById.get(chapter.id) ?? 0).padStart(2, '0')}</span>
                          <span className="fictionist-chapter-copy">
                            <strong>{chapter.title}</strong>
                            <small>{chapter.wordCount.toLocaleString()} 字</small>
                          </span>
                          <span className={`fictionist-status-dot ${statusClass(chapter.status)}`} title={CHAPTER_STATUS_LABELS[chapter.status]} />
                        </button>
                        <span className="fictionist-chapter-actions">
                          <Dropdown
                            trigger={['click']}
                            menu={{
                              items: [
                                {
                                  key: 'up',
                                  label: '上移章节',
                                  icon: <ArrowUpOutlined />,
                                  disabled: chapterIndex === 0,
                                },
                                {
                                  key: 'down',
                                  label: '下移章节',
                                  icon: <ArrowDownOutlined />,
                                  disabled: chapterIndex === volume.chapterIds.length - 1,
                                },
                                {
                                  key: 'move',
                                  label: '移动到其他卷',
                                  icon: <SwapOutlined />,
                                  disabled: activeVolumes.length <= 1,
                                  children: activeVolumes
                                    .filter((target) => target.id !== volume.id)
                                    .map((target) => ({
                                      key: `move:${target.id}`,
                                      label: target.title,
                                    })),
                                },
                                { key: 'rename', label: '重命名章节', icon: <EditOutlined /> },
                                { key: 'delete', label: '删除章节', icon: <DeleteOutlined />, danger: true },
                              ],
                              onClick: ({ key }) => {
                                if (key === 'up') void moveChapter(chapter.id, volume.id, chapterIndex - 1);
                                else if (key === 'down') void moveChapter(chapter.id, volume.id, chapterIndex + 1);
                                else if (key === 'rename') openRenameChapter(chapter.id);
                                else if (key === 'delete') confirmDeleteChapter(chapter.id);
                                else if (key.startsWith('move:')) {
                                  const targetId = key.slice('move:'.length);
                                  const target = index.volumes[targetId];
                                  if (target) void moveChapter(chapter.id, targetId, target.chapterIds.length);
                                }
                              },
                            }}
                          >
                            <Button
                              type="text"
                              size="small"
                              aria-label={`管理《${chapter.title}》`}
                              icon={<MoreOutlined />}
                            />
                          </Dropdown>
                        </span>
                      </div>
                      );
                    }) : null}
                  </section>
                );
              })}
              {query.trim()
                && visibleChapters.length === 0
                && !activeVolumes.some((volume) => volume.title
                  .toLocaleLowerCase()
                  .includes(query.trim().toLocaleLowerCase()))
                ? <div className="fictionist-tree-empty">没有匹配的卷或章节</div>
                : null}
            </div>
          ) : section === 'outline' ? (
            <div className="fictionist-outline-tree">
              <button
                type="button"
                className={`fictionist-outline-tree-item fictionist-outline-tree-item--story${outlineTarget.kind === 'story' ? ' is-active' : ''}`}
                onClick={() => selectOutlineTarget({ kind: 'story' })}
              >
                <PartitionOutlined />
                <span><strong>故事总纲</strong><small>全书方向</small></span>
              </button>
              {activeVolumes.map((volume) => {
                const normalizedQuery = query.trim().toLocaleLowerCase();
                const volumeMatches = volume.title.toLocaleLowerCase().includes(normalizedQuery);
                const matchingChapters = volume.chapterIds.flatMap((chapterId) => {
                  const chapter = index.chapters[chapterId];
                  if (!chapter) return [];
                  return !normalizedQuery
                    || volumeMatches
                    || chapter.title.toLocaleLowerCase().includes(normalizedQuery)
                    ? [chapter]
                    : [];
                });
                if (normalizedQuery && !volumeMatches && matchingChapters.length === 0) return null;
                return (
                  <section className="fictionist-outline-tree-group" key={volume.id}>
                    <button
                      type="button"
                      className={`fictionist-outline-tree-item fictionist-outline-tree-item--volume${outlineTarget.kind === 'volume' && outlineTarget.id === volume.id ? ' is-active' : ''}`}
                      onClick={() => selectOutlineTarget({ kind: 'volume', id: volume.id })}
                    >
                      <FolderOutlined />
                      <span><strong>{volume.title}</strong><small>卷纲 · {volume.chapterIds.length} 章</small></span>
                    </button>
                    <div className="fictionist-outline-tree-chapters">
                      {matchingChapters.map((chapter) => (
                        <button
                          type="button"
                          className={`fictionist-outline-tree-item fictionist-outline-tree-item--chapter${outlineTarget.kind === 'chapter' && outlineTarget.id === chapter.id ? ' is-active' : ''}`}
                          key={chapter.id}
                          onClick={() => selectOutlineTarget({ kind: 'chapter', id: chapter.id })}
                        >
                          <span className="fictionist-chapter-index">{String(chapterNumberById.get(chapter.id) ?? 0).padStart(2, '0')}</span>
                          <span><strong>{chapter.title}</strong><small>章节纲要</small></span>
                        </button>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : section === 'canon' ? (
            <div className="fictionist-simple-list">
              <button
                type="button"
                className={canonTypeFilter === 'all' ? 'is-active' : ''}
                onClick={() => setCanonTypeFilter('all')}
              >全部设定 <small>{canonEntries.length}</small></button>
              {Object.entries(CANON_ENTRY_TYPE_LABELS).map(([type, label]) => {
                const count = canonEntries.filter((entry) => entry.type === type).length;
                return (
                  <button
                    type="button"
                    className={canonTypeFilter === type ? 'is-active' : ''}
                    key={type}
                    onClick={() => setCanonTypeFilter(type as FictionCanonEntryType)}
                  >{label} <small>{count}</small></button>
                );
              })}
            </div>
          ) : section === 'timeline' ? (
            <div className="fictionist-simple-list">
              {[
                ['all', '全部事件'],
                ['background', TIMELINE_KIND_LABELS.background],
                ['confirmed', TIMELINE_KIND_LABELS.confirmed],
                ['chapter', TIMELINE_KIND_LABELS.chapter],
              ].map(([kind, label]) => {
                const filter = kind as 'all' | FictionTimelineEventKind;
                const count = filter === 'all'
                  ? timelineEvents.length
                  : timelineEvents.filter((event) => event.kind === filter).length;
                return (
                  <button
                    type="button"
                    className={timelineKindFilter === filter ? 'is-active' : ''}
                    key={kind}
                    onClick={() => setTimelineKindFilter(filter)}
                  >
                    {label}
                    <small>{count}</small>
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="fictionist-navigator-footer">
            <span><CheckCircleOutlined />{section === 'library' ? '作品数据仅保存在本机' : section === 'outline' ? outlineDirty ? '大纲有未保存修改' : '大纲已保存到本机' : dirty ? '有未保存修改' : '本地草稿已同步'}</span>
          </div>
          </aside>
        ) : null}

        <main className="fictionist-main">
          {section === 'library' ? (
            <div className="fictionist-content-view fictionist-library-view">
              <header className="fictionist-library-header">
                <span><small>全部作品</small><h1>我的书架</h1></span>
                <div className="fictionist-library-overview" aria-label="书库统计">
                  <span><strong>{books.length}</strong><small>部作品</small></span>
                  <span><strong>{libraryStats.chapters}</strong><small>章节</small></span>
                  <span><strong>{libraryStats.words.toLocaleString()}</strong><small>总字数</small></span>
                </div>
              </header>
              <div className="fictionist-shelf-toolbar">
                <strong>{libraryFilterLabel}</strong>
                <small>显示 {visibleBooks.length} 本 · 最近编辑优先</small>
              </div>
              <div className="fictionist-bookshelf-grid" aria-label="书架">
                <button className="fictionist-new-book-tile" type="button" onClick={() => setCreateBookOpen(true)}>
                  <span className="fictionist-new-book-cover"><PlusOutlined /></span>
                  <strong>新建一本书</strong>
                  <small>空白作品</small>
                </button>
                {visibleBooks.map((book) => (
                  <article className={`fictionist-book-card ${book.id === activeProjectId ? 'is-current' : ''}`} key={book.id}>
                    <button
                      className="fictionist-book-open"
                      type="button"
                      aria-label={`打开《${book.title}》`}
                      disabled={book.status === 'archived'}
                      onClick={() => void openBook(book)}
                    >
                      <FictionBookCover
                        title={book.title}
                        genre={book.genre}
                        coverTone={book.coverTone}
                        coverImage={book.coverImage}
                        current={book.id === activeProjectId}
                      />
                      <span className="fictionist-book-copy">
                        <strong>{book.title}</strong>
                        <small>{book.genre} · {book.statusLabel}</small>
                      </span>
                    </button>
                    <span className="fictionist-book-footer">
                      <span className="fictionist-book-metrics" aria-label={`${book.chapterCount} 章，${book.wordCount.toLocaleString()} 字`}>
                        <span><strong>{book.chapterCount}</strong><small>章节</small></span>
                        <span><strong>{book.wordCount.toLocaleString()}</strong><small>字数</small></span>
                      </span>
                      <span className="fictionist-book-actions">
                      <Tooltip title="导出小说正文">
                        <Button
                          aria-label={`导出《${book.title}》`}
                          icon={<DownloadOutlined />}
                          onClick={() => void exportBook(book)}
                        />
                      </Tooltip>
                      <Tooltip title="编辑作品资料">
                        <Button
                          aria-label={`编辑《${book.title}》`}
                          icon={<EditOutlined />}
                          onClick={() => openEditBook(book)}
                        />
                      </Tooltip>
                      <Tooltip title="删除作品">
                        <Button
                          danger
                          aria-label={`删除《${book.title}》`}
                          icon={<DeleteOutlined />}
                          loading={deletingProjectId === book.id}
                          onClick={() => confirmDeleteBook(book)}
                        />
                      </Tooltip>
                      </span>
                    </span>
                  </article>
                ))}
                {visibleBooks.length === 0 ? (
                  <div className="fictionist-library-empty">
                    <SearchOutlined />
                    <strong>没有符合条件的书</strong>
                    <Button type="link" onClick={() => { setLibraryFilter('all'); setQuery(''); }}>查看全部书籍</Button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : section === 'chapters' && selectedChapter ? (
            <>
              <div className="fictionist-editor-header">
                <div>
                  <div className="fictionist-editor-eyebrow">{activeVolume?.title ?? '第一卷'} · 第 {selectedChapterNumber} 章</div>
                  <h1>{selectedChapter.title}</h1>
                  <div className="fictionist-editor-meta">
                    <span>{(dirty ? countFictionWords(chapterContent) : selectedChapter.wordCount).toLocaleString()} 字</span>
                    <Select<FictionChapterStatus>
                      size="small"
                      aria-label="章节状态"
                      value={selectedChapter.status}
                      options={CHAPTER_STATUS_OPTIONS}
                      onChange={(status) => void changeChapterStatus(status)}
                    />
                    <span>{dirty ? '有未保存修改' : saveState === 'error' ? '保存失败' : '已保存'}</span>
                  </div>
                </div>
                <div className="fictionist-editor-actions">
                  <Segmented
                    size="small"
                    value={editorMode}
                    onChange={(value) => setEditorMode(value as EditorMode)}
                    options={[
                      { label: '编辑', value: 'edit', icon: <EditOutlined /> },
                      { label: '预览', value: 'preview', icon: <EyeOutlined /> },
                    ]}
                  />
                  <Button className="fictionist-context-trigger" onClick={() => setCompactInspectorOpen(true)}>上下文</Button>
                  <Button icon={<SaveOutlined />} loading={saveState === 'saving'} onClick={() => void saveChapter()}>保存</Button>
                  {pendingTask ? (
                    <Button icon={<FileTextOutlined />} onClick={() => openTaskReview(pendingTask)}>
                      待确认草稿
                    </Button>
                  ) : null}
                  <Button type="primary" icon={<PlayCircleOutlined />} onClick={openChapterWriting}>
                    {currentChapterIsEmpty ? 'AI 起草' : '续写下一章'}
                  </Button>
                </div>
              </div>
              <div className="fictionist-editor-surface">
                {editorMode === 'edit' ? (
                  <textarea
                    aria-label="章节正文编辑区"
                    value={chapterContent}
                    placeholder="从这里开始写这一章……"
                    spellCheck={false}
                    onChange={(event) => updateChapterContent(event.target.value)}
                  />
                ) : <ChapterPreview content={chapterContent} />}
              </div>
              <footer className="fictionist-editor-footer">
                <span>纯文本正文</span>
                <span>手动保存</span>
                <span>缩放 100%</span>
              </footer>
            </>
          ) : section === 'chapters' ? (
            <div className="fictionist-empty-copy">
              <FileTextOutlined />
              <strong>这部作品还没有章节</strong>
              <span>可以自己新建空白章节，也可以让 AI 起草第一章。</span>
              <div className="fictionist-empty-actions">
                <Button icon={<PlusOutlined />} onClick={() => void addChapter()}>新建空白章节</Button>
                <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => void startFirstChapterDraft()}>
                  AI 起草第一章
                </Button>
              </div>
            </div>
          ) : section === 'outline' && activeBook ? (
            <OutlineEditor
              projectTitle={activeBook.title}
              target={outlineTarget}
              outline={outlineDraft}
              volume={outlineVolume}
              chapter={outlineChapter}
              chapterNumber={outlineChapter ? chapterNumberById.get(outlineChapter.id) : undefined}
              dirty={outlineDirty}
              saving={savingOutline}
              onStoryChange={updateStoryOutline}
              onVolumeChange={updateVolumeOutline}
              onChapterChange={updateChapterOutline}
              onSave={() => void persistOutlineDraft()}
              onImport={openOutlineImport}
              onOptimize={openOutlineOptimize}
              hasPendingReview={Boolean(pendingOutlineTask)}
              onOpenPendingReview={() => {
                if (pendingOutlineTask) openOutlineTaskReview(pendingOutlineTask);
              }}
            />
          ) : section === 'canon' ? (
            <div className="fictionist-content-view">
              <header>
                <span><small>作品事实库 · {canonEntries.length} 条</small><h1>设定库</h1></span>
                <div className="fictionist-editor-actions">
                  <input
                    ref={canonTransferInputRef}
                    hidden
                    type="file"
                    accept="application/json,.json"
                    aria-label="导入设定库文件"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = '';
                      if (file) void importCanonFile(file);
                    }}
                  />
                  <Button icon={<UploadOutlined />} onClick={() => canonTransferInputRef.current?.click()}>导入</Button>
                  <Button icon={<DownloadOutlined />} onClick={() => void exportCanon()}>导出</Button>
                  <Button type="primary" icon={<PlusOutlined />} onClick={openCreateCanonEntry}>新建设定</Button>
                </div>
              </header>
              <div className="fictionist-canon-table" role="table" aria-label="设定库">
                <div className="fictionist-table-head" role="row"><span>名称与摘要</span><span>类型</span><span>更新时间</span><span>操作</span></div>
                {visibleCanonEntries.map((entry) => (
                  <div className="fictionist-canon-row" role="row" key={entry.id}>
                    <button type="button" className="fictionist-canon-row-main" onClick={() => openEditCanonEntry(entry)}>
                      <span><strong>{entry.name}</strong><small>{entry.summary || '暂无摘要'}</small></span>
                      <Tag>{CANON_ENTRY_TYPE_LABELS[entry.type]}</Tag>
                      <small>{new Date(entry.updatedAt).toLocaleDateString('zh-CN')}</small>
                    </button>
                    <span className="fictionist-canon-row-actions">
                      <Tooltip title="编辑设定"><Button type="text" aria-label={`编辑设定“${entry.name}”`} icon={<EditOutlined />} onClick={() => openEditCanonEntry(entry)} /></Tooltip>
                      <Tooltip title="删除设定"><Button danger type="text" aria-label={`删除设定“${entry.name}”`} icon={<DeleteOutlined />} onClick={() => confirmDeleteCanonEntry(entry)} /></Tooltip>
                    </span>
                  </div>
                ))}
                {visibleCanonEntries.length === 0 ? (
                  <div className="fictionist-canon-empty">
                    <DatabaseOutlined />
                    <strong>{canonEntries.length === 0 ? '还没有设定' : '没有符合条件的设定'}</strong>
                    <span>{canonEntries.length === 0 ? '把人物、地点、组织和规则集中记录在这里。' : '调整左侧类型筛选或搜索词。'}</span>
                    {canonEntries.length === 0 ? <Button type="link" onClick={openCreateCanonEntry}>新建设定</Button> : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : section === 'timeline' ? (
            <div className="fictionist-content-view">
              <header>
                <span><small>事件与章节同步 · 显示 {visibleTimelineEvents.length} / {timelineEvents.length} 条</small><h1>故事时间线</h1></span>
                <div className="fictionist-editor-actions">
                  <input
                    ref={timelineTransferInputRef}
                    hidden
                    type="file"
                    accept="application/json,.json"
                    aria-label="导入时间线文件"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = '';
                      if (file) void importTimelineFile(file);
                    }}
                  />
                  <Button icon={<UploadOutlined />} onClick={() => timelineTransferInputRef.current?.click()}>导入</Button>
                  <Button icon={<DownloadOutlined />} onClick={() => void exportTimeline()}>导出</Button>
                  <Button type="primary" icon={<PlusOutlined />} onClick={openCreateTimelineEvent}>新增事件</Button>
                </div>
              </header>
              <div className="fictionist-timeline">
                {visibleTimelineEvents.map((event) => {
                  const sourceChapter = event.sourceChapterId
                    ? index.chapters[event.sourceChapterId]
                    : undefined;
                  const eventIndex = timelineEvents.findIndex((item) => item.id === event.id);
                  return (
                    <article className="fictionist-timeline-item" key={event.id}>
                      <span className="fictionist-timeline-dot" aria-hidden="true" />
                      <time>{event.timeLabel}</time>
                      <div className="fictionist-timeline-item-content">
                        <div className="fictionist-timeline-item-heading">
                          <strong>{event.title}</strong>
                          <Tag>{TIMELINE_KIND_LABELS[event.kind]}</Tag>
                        </div>
                        {event.description ? <p>{event.description}</p> : null}
                        {sourceChapter ? <small><FileTextOutlined />关联章节：{sourceChapter.title}</small> : null}
                      </div>
                      <span className="fictionist-timeline-item-actions">
                        <Tooltip title="上移事件">
                          <Button
                            type="text"
                            disabled={eventIndex <= 0}
                            aria-label={`上移时间线事件“${event.title}”`}
                            icon={<ArrowUpOutlined />}
                            onClick={() => void moveTimelineEvent(event, eventIndex - 1)}
                          />
                        </Tooltip>
                        <Tooltip title="下移事件">
                          <Button
                            type="text"
                            disabled={eventIndex < 0 || eventIndex >= timelineEvents.length - 1}
                            aria-label={`下移时间线事件“${event.title}”`}
                            icon={<ArrowDownOutlined />}
                            onClick={() => void moveTimelineEvent(event, eventIndex + 1)}
                          />
                        </Tooltip>
                        <Tooltip title="编辑事件">
                          <Button type="text" aria-label={`编辑时间线事件“${event.title}”`} icon={<EditOutlined />} onClick={() => openEditTimelineEvent(event)} />
                        </Tooltip>
                        <Tooltip title="删除事件">
                          <Button danger type="text" aria-label={`删除时间线事件“${event.title}”`} icon={<DeleteOutlined />} onClick={() => confirmDeleteTimelineEvent(event)} />
                        </Tooltip>
                      </span>
                    </article>
                  );
                })}
                {visibleTimelineEvents.length === 0 ? (
                  <div className="fictionist-timeline-empty">
                    <ClockCircleOutlined />
                    <strong>{timelineEvents.length === 0 ? '还没有时间线事件' : '没有符合条件的事件'}</strong>
                    <span>{timelineEvents.length === 0 ? '把关键事实、章节节点和时间关系记录在这里。' : '调整左侧类型筛选或搜索词。'}</span>
                    {timelineEvents.length === 0 ? <Button type="link" onClick={openCreateTimelineEvent}>新增第一条事件</Button> : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="fictionist-content-view fictionist-workflow-view">
              <header>
                <span><small>小说家专业包 · 所有作品共享</small><h1>工作流中心</h1></span>
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreateWorkflow}>
                  新建工作流
                </Button>
              </header>
              <div className="fictionist-workflow-sections">
                <section className="fictionist-workflow-section">
                  <div className="fictionist-workflow-section-heading">
                    <span>
                      <strong>小说家内置</strong>
                      <small>专业包提供 · 每条系统工作流提供两张画布，主流程可自由配置，备用流程不可修改；主流程异常时，可通过备用开关决定是否切换。</small>
                    </span>
                    <Tag>{FICTIONIST_SYSTEM_WORKFLOW_SPECS.length}</Tag>
                  </div>
                  <div className="fictionist-workflow-list fictionist-workflow-list--actions">
                    {systemWorkflowCards.map(({
                      workflow,
                      primary,
                      fallback,
                      modified,
                      fallbackEnabled,
                    }, index) => (
                      <div
                        className={`fictionist-system-workflow-row${modified ? ' is-modified' : ''}`}
                        key={workflow.key}
                      >
                        <div className="fictionist-system-workflow-main">
                          <span className="fictionist-workflow-icon">{index + 1}</span>
                          <span className="fictionist-system-workflow-copy">
                            <span className="fictionist-workflow-title-line">
                              <strong>{workflow.name}</strong>
                              <Tag color="blue">小说家内置</Tag>
                              {primary ? (
                                <Tag color={modified ? 'gold' : 'green'}>
                                  {modified ? '已修改' : '原始版本'}
                                </Tag>
                              ) : <Tag>正在初始化</Tag>}
                            </span>
                            <small>{workflow.description}</small>
                          </span>
                          <span className="fictionist-workflow-card-actions">
                            <Button
                              icon={<EditOutlined />}
                              disabled={!primary}
                              onClick={() => void openSystemWorkflow(workflow.key, 1)}
                            >
                              配置主流程
                            </Button>
                            <Button
                              icon={<EyeOutlined />}
                              disabled={!fallback}
                              onClick={() => void openSystemWorkflow(workflow.key, 2)}
                            >
                              查看备用流程
                            </Button>
                            {modified ? (
                              <Button
                                icon={<ReloadOutlined />}
                                disabled={!primary?.savedId}
                                onClick={() => restoreSystemWorkflow(workflow.key, primary)}
                              >
                                恢复默认
                              </Button>
                            ) : null}
                            <Tooltip title={fallbackEnabled
                              ? '已开启：主流程失败后，备用流程最多再运行一次。'
                              : '已关闭：主流程失败时任务会直接结束。'}>
                              <span className="fictionist-workflow-fallback-control">
                                <span>备用开关</span>
                                <Switch
                                  size="small"
                                  checked={fallbackEnabled}
                                  disabled={!fallback}
                                  aria-label={`${workflow.name}主流程失败时运行备用流程`}
                                  onChange={(enabled) => {
                                    setFallbackEnabled(FICTIONIST_PACKAGE_ID, workflow.key, enabled);
                                    if (enabled) {
                                      message.success(`已为“${workflow.name}”开启备用流程；主流程失败后会额外运行一次。`);
                                    } else {
                                      message.info(`已关闭“${workflow.name}”的备用流程；主流程失败时任务会直接结束。`);
                                    }
                                  }}
                                />
                              </span>
                            </Tooltip>
                          </span>
                        </div>
                        {modified ? (
                          <div className="fictionist-workflow-modified-note" role="status">
                            <ExclamationCircleOutlined />
                            <span><strong>主流程已被编辑</strong><small>后续运行会使用你的版本；备用流程仍保持专业包原始内容。</small></span>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>

                <section className="fictionist-workflow-section">
                  <div className="fictionist-workflow-section-heading">
                    <span><strong>用户创建</strong><small>归小说家专业包所有 · 所有作品均可使用</small></span>
                    <span className="fictionist-workflow-section-tools">
                      <Input
                        allowClear
                        prefix={<SearchOutlined />}
                        placeholder="搜索用户工作流"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                      <Tag>{customPackageWorkflows.length}</Tag>
                    </span>
                  </div>
                  {visiblePackageWorkflows.length > 0 ? (
                    <div className="fictionist-workflow-list fictionist-workflow-list--saved">
                      {visiblePackageWorkflows.map((workflow) => (
                        <div key={workflow.id}>
                          <span className="fictionist-workflow-icon"><BranchesOutlined /></span>
                          <span>
                            <strong>{workflow.name}</strong>
                            <small>{workflow.savedAt ? `保存于 ${workflow.savedAt}` : `${workflow.nodeCount} 个节点 · 未保存`}</small>
                          </span>
                          <Tag>{workflow.savedId ? '用户创建 · 已保存' : '用户创建 · 未保存'}</Tag>
                          <span className="fictionist-workflow-card-actions">
                            <Button icon={<RightOutlined />} onClick={() => void openWorkflowCanvas(workflow)}>
                              打开画布
                            </Button>
                            <Tooltip title="重命名工作流">
                              <Button
                                type="text"
                                icon={<EditOutlined />}
                                aria-label={`重命名工作流“${workflow.name}”`}
                                onClick={() => renameUserWorkflow(workflow)}
                              />
                            </Tooltip>
                            <Tooltip title="复制工作流">
                              <Button
                                type="text"
                                icon={<CopyOutlined />}
                                aria-label={`复制工作流“${workflow.name}”`}
                                onClick={() => duplicateUserWorkflow(workflow)}
                              />
                            </Tooltip>
                            <Tooltip title="删除工作流">
                              <Button
                                danger
                                type="text"
                                icon={<DeleteOutlined />}
                                aria-label={`删除工作流“${workflow.name}”`}
                                onClick={() => confirmDeleteWorkflow(workflow)}
                              />
                            </Tooltip>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="fictionist-workflow-empty">
                      <BranchesOutlined />
                      <span>{customPackageWorkflows.length > 0 ? '没有匹配的用户工作流' : '暂无用户创建的工作流'}</span>
                    </div>
                  )}
                </section>

              </div>
            </div>
          )}
        </main>

        {section === 'chapters' && selectedChapter ? (
          <aside className="fictionist-inspector">
            <ContextInspector
              mode={inspectorMode}
              onModeChange={setInspectorMode}
              task={chapterInsights.task}
              contextOutput={chapterInsights.contextOutput}
              canonCheckOutput={chapterInsights.canonCheckOutput}
              contextNodeAvailable={insightNodeAvailability?.context}
              canonCheckNodeAvailable={insightNodeAvailability?.canonCheck}
            />
          </aside>
        ) : null}
      </div>

      <Drawer
        title="本章上下文"
        open={compactInspectorOpen}
        onClose={() => setCompactInspectorOpen(false)}
        size="default"
      >
        <ContextInspector
          mode={inspectorMode}
          onModeChange={setInspectorMode}
          task={chapterInsights.task}
          contextOutput={chapterInsights.contextOutput}
          canonCheckOutput={chapterInsights.canonCheckOutput}
          contextNodeAvailable={insightNodeAvailability?.context}
          canonCheckNodeAvailable={insightNodeAvailability?.canonCheck}
        />
      </Drawer>

      <Drawer
        className="fictionist-book-search"
        title={`全书搜索 · ${activeBook?.title ?? '未选择作品'}`}
        open={bookSearchOpen}
        onClose={closeBookSearch}
        size={520}
      >
        <Input.Search
          autoFocus
          allowClear
          enterButton="搜索"
          maxLength={100}
          loading={bookSearchState === 'searching'}
          placeholder="搜索章节名、卷名或正文"
          value={bookSearchQuery}
          onChange={(event) => {
            bookSearchRequestRef.current += 1;
            setBookSearchQuery(event.target.value);
            setBookSearchResults([]);
            setBookSearchTruncated(false);
            setBookSearchState('idle');
          }}
          onSearch={(value) => void runBookSearch(value)}
        />
        <div className="fictionist-book-replace">
          <Input
            allowClear
            maxLength={500}
            placeholder="替换为（留空表示删除匹配文字）"
            value={bookReplaceText}
            onChange={(event) => setBookReplaceText(event.target.value)}
          />
          <Button
            danger
            disabled={!bookSearchQuery.trim() || bookSearchState === 'searching'}
            onClick={() => void confirmReplaceBookText()}
          >
            全部替换
          </Button>
        </div>
        <div className="fictionist-book-search-results" aria-live="polite">
          {bookSearchState === 'idle' ? (
            <div className="fictionist-book-search-empty">
              <SearchOutlined />
              <strong>在整部作品中查找</strong>
              <span>搜索不会保存或修改当前尚未保存的正文。</span>
            </div>
          ) : bookSearchState === 'searching' ? (
            <div className="fictionist-book-search-loading"><Spin /><span>正在读取章节正文…</span></div>
          ) : bookSearchResults.length > 0 ? (
            <>
              <div className="fictionist-book-search-summary">
                <strong>{bookSearchResults.length} 个结果</strong>
                {bookSearchTruncated ? <span>仅显示前 100 个结果</span> : null}
              </div>
              <div className="fictionist-book-search-list">
                {bookSearchResults.map((match) => (
                  <button
                    type="button"
                    key={match.kind === 'chapter'
                      ? `${match.chapterId}-${match.field}`
                      : `volume-${match.volumeId}`}
                    onClick={() => void openSearchResult(match)}
                  >
                    <span className="fictionist-book-search-meta">
                      <small>{match.volumeTitle}</small>
                      <Tag>{SEARCH_FIELD_LABELS[match.field]}</Tag>
                    </span>
                    <strong>{match.kind === 'chapter' ? match.chapterTitle : match.volumeTitle}</strong>
                    <span>{match.excerpt}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="fictionist-book-search-empty">
              <SearchOutlined />
              <strong>没有找到相关内容</strong>
              <span>可以缩短关键词，或检查是否有错别字。</span>
            </div>
          )}
        </div>
      </Drawer>

      <Modal
        centered
        title={`工作流绑定 · ${activeBook?.title ?? '未选择作品'}`}
        open={workflowBindingOpen}
        onCancel={() => setWorkflowBindingOpen(false)}
        width={680}
        footer={[
          <Button key="close" onClick={() => setWorkflowBindingOpen(false)}>关闭</Button>,
          <Button
            key="manage"
            type="primary"
            icon={<BranchesOutlined />}
            onClick={() => {
              setWorkflowBindingOpen(false);
              void switchSection('workflows');
            }}
          >
            打开工作流中心
          </Button>,
        ]}
      >
        <div className="fictionist-workflow-binding">
          <p>当前作品继承小说家专业包的共享工作流。正文中的写作命令会调用下列绑定，工作流本身在工作流中心统一管理。</p>
          <div className="fictionist-workflow-binding-list">
            {systemWorkflowCards.map(({ workflow, modified, fallbackEnabled }) => (
              <div key={workflow.key}>
                <span className="fictionist-workflow-icon"><BranchesOutlined /></span>
                <span>
                  <strong>{workflow.name}</strong>
                  <small>小说家默认绑定 · 所有作品共享</small>
                </span>
                <span className="fictionist-workflow-binding-status">
                  {modified ? <Tag color="gold">主流程已修改</Tag> : <Tag color="green">原始版本</Tag>}
                  <Tag color={fallbackEnabled ? 'blue' : undefined}>
                    {fallbackEnabled ? '备用已开启' : '备用未开启'}
                  </Tag>
                </span>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      <Modal
        centered
        title="新建工作流"
        open={createWorkflowOpen}
        onCancel={closeCreateWorkflow}
        onOk={() => void createWorkflow()}
        okText="创建并打开画布"
        cancelText="取消"
        confirmLoading={creatingWorkflow}
        okButtonProps={{ disabled: !newWorkflowName.trim() }}
        width={520}
      >
        <div className="fictionist-create-form">
          <p className="fictionist-modal-copy">创建后会在工作台打开一张同名空白画布，并归小说家专业包所有，供全部作品绑定和调用。</p>
          <label>
            <span>工作流名称</span>
            <Input
              autoFocus
              maxLength={60}
              placeholder="例如：章节连续性检查"
              value={newWorkflowName}
              onChange={(event) => setNewWorkflowName(event.target.value)}
              onPressEnter={() => void createWorkflow()}
            />
          </label>
        </div>
      </Modal>

      <Modal
        centered
        title={structureEditor?.kind === 'create-volume'
          ? '新建卷'
          : structureEditor?.kind === 'rename-volume'
            ? '重命名卷'
            : '重命名章节'}
        open={Boolean(structureEditor)}
        onCancel={() => setStructureEditor(undefined)}
        onOk={() => void confirmStructureEdit()}
        okText={structureEditor?.kind === 'create-volume' ? '创建卷' : '保存名称'}
        cancelText="取消"
        confirmLoading={savingStructure}
        okButtonProps={{ disabled: !structureTitle.trim() }}
        width={520}
      >
        <div className="fictionist-create-form">
          <label>
            <span>{structureEditor?.kind === 'rename-chapter' ? '章节名称' : '卷名称'}</span>
            <Input
              autoFocus
              maxLength={structureEditor?.kind === 'rename-chapter' ? 80 : 40}
              value={structureTitle}
              onChange={(event) => setStructureTitle(event.target.value)}
              onPressEnter={() => void confirmStructureEdit()}
            />
          </label>
        </div>
      </Modal>

      <Modal
        centered
        title="新建作品"
        open={createBookOpen}
        onCancel={closeCreateBook}
        onOk={createBook}
        okText="创建作品"
        cancelText="取消"
        confirmLoading={creatingBook}
        okButtonProps={{ disabled: !newBookTitle.trim() }}
        width={640}
      >
        <div className="fictionist-create-form">
          <label>
            <span>作品名称</span>
            <Input
              autoFocus
              maxLength={40}
              placeholder="例如：群星沉入海底"
              value={newBookTitle}
              onChange={(event) => setNewBookTitle(event.target.value)}
              onPressEnter={() => void createBook()}
            />
          </label>
          <label>
            <span>作品分类</span>
            <Input
              maxLength={30}
              placeholder="例如：长篇奇幻"
              value={newBookGenre}
              onChange={(event) => setNewBookGenre(event.target.value)}
              onPressEnter={() => void createBook()}
            />
          </label>
          <div className="fictionist-cover-editor">
            <div className="fictionist-cover-preview">
              {newBookCover
                ? <img src={newBookCover} alt="新作品封面预览" />
                : <span><BookOutlined /><small>使用默认封面</small></span>}
            </div>
            <div className="fictionist-cover-controls">
              <strong>自定义书籍封面</strong>
              <small>PNG、JPEG 或 WebP，最大 2 MiB。图片仅保存在本机。</small>
              <input
                ref={createCoverInputRef}
                hidden
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="为新作品选择自定义书籍封面"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void selectCustomCover(file, setNewBookCover);
                }}
              />
              <div>
                <Button icon={<UploadOutlined />} onClick={() => createCoverInputRef.current?.click()}>
                  选择封面
                </Button>
                {newBookCover ? (
                  <Button danger icon={<DeleteOutlined />} onClick={() => setNewBookCover(undefined)}>
                    移除自定义封面
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
          <p className="fictionist-modal-note">作品和章节保存在本机，重启应用后仍可继续编辑。</p>
        </div>
      </Modal>

      <Modal
        centered
        title={editingBook ? `编辑《${editingBook.title}》` : '编辑作品'}
        open={Boolean(editingBook)}
        onCancel={() => setEditingBook(undefined)}
        onOk={() => void confirmEditBook()}
        okText="保存资料"
        cancelText="取消"
        confirmLoading={savingBookDetails}
        okButtonProps={{ disabled: !editedBookTitle.trim() }}
        width={640}
      >
        <div className="fictionist-create-form">
          <label>
            <span>作品名称</span>
            <Input
              autoFocus
              maxLength={40}
              value={editedBookTitle}
              onChange={(event) => setEditedBookTitle(event.target.value)}
            />
          </label>
          <label>
            <span>作品分类</span>
            <Input
              maxLength={30}
              placeholder="例如：都市悬疑"
              value={editedBookGenre}
              onChange={(event) => setEditedBookGenre(event.target.value)}
            />
          </label>
          <label>
            <span>书籍状态</span>
            <Select<FictionProjectStatus>
              value={editedBookStatus}
              options={PROJECT_STATUS_OPTIONS}
              onChange={setEditedBookStatus}
            />
          </label>
          <div className="fictionist-cover-editor">
            <div className="fictionist-cover-preview">
              {editedBookCover
                ? <img src={editedBookCover} alt="自定义封面预览" />
                : <span><BookOutlined /><small>使用默认封面</small></span>}
            </div>
            <div className="fictionist-cover-controls">
              <strong>自定义书籍封面</strong>
              <small>PNG、JPEG 或 WebP，最大 2 MiB。图片仅保存在本机。</small>
              <input
                ref={editCoverInputRef}
                hidden
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="选择自定义书籍封面"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void selectCustomCover(file, setEditedBookCover);
                }}
              />
              <div>
                <Button icon={<UploadOutlined />} onClick={() => editCoverInputRef.current?.click()}>
                  选择封面
                </Button>
                {editedBookCover ? (
                  <Button danger icon={<DeleteOutlined />} onClick={() => setEditedBookCover(undefined)}>
                    移除自定义封面
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        centered
        title={writingMode === 'draft-current' ? 'AI 起草' : '续写下一章'}
        open={continueOpen}
        onCancel={() => setContinueOpen(false)}
        onOk={() => void confirmContinue()}
        okText="启动主流程"
        cancelText="取消"
        confirmLoading={creatingContinuation}
        okButtonProps={{
          disabled: !selectedChapter
            || modelOptions.length === 0
            || !proposedChapterTitle.trim(),
        }}
        width={720}
        styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
      >
        <p className="fictionist-modal-copy">
          {writingMode === 'draft-current'
            ? `本次将为《${proposedChapterTitle.trim() || '未填写章节名'}》起草正文。`
            : `本次将从《${selectedChapter?.title ?? '当前章节'}》修订 ${selectedChapter?.revision ?? 0} 续写为《${proposedChapterTitle.trim() || '未填写章节名'}》。`}
          确认后生成不可变上下文快照；此后修改章节不会改变该任务。
        </p>
        <div className="fictionist-create-form fictionist-continuation-form">
          <label className="fictionist-continuation-form__wide">
            <span>{writingMode === 'draft-current' ? '本章名称' : '下一章名称'}</span>
            <Input
              maxLength={80}
              value={proposedChapterTitle}
              placeholder={writingMode === 'draft-current'
                ? '输入本章名称'
                : '输入下一章名称'}
              onChange={(event) => setProposedChapterTitle(event.target.value)}
            />
          </label>
          <label className="fictionist-continuation-form__wide">
            <span>使用模型</span>
            <Select
              value={selectedModel}
              options={modelOptions}
              placeholder={modelOptions.length > 0 ? '选择运行模型' : '请先在设置中启用模型'}
              onChange={setSelectedModel}
            />
          </label>
          <label className="fictionist-continuation-form__wide">
            <span>{writingMode === 'draft-current' ? '本章目标' : '下一章目标'}</span>
            <Input
              maxLength={300}
              value={continuationGoal}
              placeholder={writingMode === 'draft-current'
                ? '例如：建立雨夜开篇，让主角收到一封无法解释的来信'
                : '例如：让主角进入钟塔，并揭示来信与失踪船只的第一层联系'}
              onChange={(event) => setContinuationGoal(event.target.value)}
            />
          </label>
          <div className="fictionist-continuation-form__wide fictionist-writing-requirements">
            <div className="fictionist-writing-requirements__header">
              <span>写作要求</span>
              <Button
                size="small"
                icon={<DownloadOutlined />}
                onClick={() => writingRequirementsInputRef.current?.click()}
              >
                导入本地文本
              </Button>
            </div>
            <input
              ref={writingRequirementsInputRef}
              hidden
              type="file"
              accept={WRITING_REQUIREMENTS_FILE_ACCEPT}
              aria-label="导入写作要求文本文件"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void importWritingRequirements(file);
              }}
            />
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 5 }}
              maxLength={WRITING_REQUIREMENTS_CHAR_CAP}
              value={continuationRequirements}
              placeholder="例如：第三人称限知，保持悬疑节奏，不要直接揭露幕后身份"
              onChange={(event) => {
                setContinuationRequirements(event.target.value);
                setWritingRequirementsSourceName(undefined);
              }}
            />
            {writingRequirementsSourceName ? (
              <small className="fictionist-writing-requirements__source">
                已导入：{writingRequirementsSourceName}
              </small>
            ) : null}
          </div>
          <label>
            <span>预计字数</span>
            <InputNumber
              min={500}
              max={20000}
              step={500}
              value={targetWordCount}
              onChange={(value) => setTargetWordCount(value ?? 2000)}
            />
          </label>
        </div>
        <ul className="fictionist-context-preview">
          <li><CheckCircleOutlined />作品名称、题材、目标章节名称和{writingMode === 'draft-current' ? '目标' : '来源'}章节修订号</li>
          <li><CheckCircleOutlined />当前章节{writingMode === 'draft-current' ? '为空，将作为写入目标' : `完整正文，共 ${countFictionWords(chapterContent).toLocaleString()} 字`}</li>
          <li><CheckCircleOutlined />上面填写的目标、预计字数和写作要求</li>
        </ul>
        <details className="fictionist-context-details">
          <summary>{writingMode === 'draft-current' ? '查看当前章节状态' : '查看将送入画布的当前正文'}</summary>
          <pre>{chapterContent || '（当前章节暂无正文）'}</pre>
        </details>
        <p className="fictionist-modal-note">设定库内容已保存到本机；当前任务上下文仍按现有章节信息生成。</p>
      </Modal>

      <Modal
        centered
        title={reviewWritingMode === 'draft-current' ? '确认本章草稿' : '确认续写草稿'}
        open={reviewOpen}
        width={900}
        styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
        onCancel={() => setReviewOpen(false)}
        footer={[
          <Button key="canvas" onClick={() => void reopenTaskCanvas()}>重新打开画布</Button>,
          <Button key="discard" danger onClick={discardReview}>放弃草稿</Button>,
          <Button
            key="save"
            type="primary"
            loading={savingReview}
            onClick={() => void saveReviewAsChapter()}
          >
            {reviewWritingMode === 'draft-current' ? '写入当前章节' : '保存为下一章'}
          </Button>,
        ]}
      >
        <p className="fictionist-modal-copy">
          下面是画布最终节点返回的草稿。你可以先修改标题和正文；只有点击“{reviewWritingMode === 'draft-current' ? '写入当前章节' : '保存为下一章'}”才会写入作品。
          {reviewWritingMode === 'draft-current' ? ' 若当前章节不再为空或修订号发生变化，系统会阻止覆盖。' : ' 原章节不会被覆盖。'}
        </p>
        <PendingDraftInsights task={focusedTask} />
        <div className="fictionist-create-form fictionist-draft-review">
          <label>
            <span>章节名称</span>
            <Input
              maxLength={80}
              value={reviewTitle}
              onChange={(event) => setReviewTitle(event.target.value)}
            />
          </label>
          <label>
            <span>章节正文</span>
            <Input.TextArea
              value={reviewDraft}
              spellCheck={false}
              onChange={(event) => setReviewDraft(event.target.value)}
            />
          </label>
        </div>
      </Modal>

      <OutlineImportModal
        open={outlineImportOpen}
        sourceName={outlineImportSourceName}
        sourcePreview={outlineImportSourcePreview}
        sourceChars={outlineImportSourceChars}
        accept={OUTLINE_FILE_ACCEPT}
        method={outlineImportMethod}
        strategy={outlineImportStrategy}
        targetValue={outlineImportTargetValue}
        targetOptions={outlineTargetOptions}
        selectedModel={selectedModel}
        modelOptions={modelOptions}
        loading={creatingOutlineTask}
        onCancel={closeOutlineImport}
        onFile={(file) => void importOutlineFile(file)}
        onMethodChange={setOutlineImportMethod}
        onStrategyChange={setOutlineImportStrategy}
        onTargetChange={setOutlineImportTargetValue}
        onModelChange={setSelectedModel}
        onSubmit={() => {
          if (outlineImportMethod === 'direct') void confirmDirectOutlineImport();
          else void createOutlineWorkflowTask('import');
        }}
      />

      <OutlineOptimizeModal
        open={outlineOptimizeOpen}
        targetValue={outlineOptimizeTargetValue}
        targetOptions={outlineTargetOptions}
        goals={outlineOptimizeGoals}
        intensity={outlineOptimizeIntensity}
        requirements={outlineOptimizeRequirements}
        selectedModel={selectedModel}
        modelOptions={modelOptions}
        loading={creatingOutlineTask}
        onCancel={closeOutlineOptimize}
        onTargetChange={setOutlineOptimizeTargetValue}
        onGoalsChange={setOutlineOptimizeGoals}
        onIntensityChange={setOutlineOptimizeIntensity}
        onRequirementsChange={setOutlineOptimizeRequirements}
        onModelChange={setSelectedModel}
        onSubmit={() => void createOutlineWorkflowTask('optimize')}
      />

      <OutlineReviewModal
        open={Boolean(outlineReviewState && outlineReviewPayload)}
        operation={outlineReviewPayload?.operation ?? 'optimize'}
        targetLabel={outlineReviewPayload?.targetLabel ?? ''}
        result={outlineReviewState?.result}
        volumeLabels={outlineReviewVolumeLabels}
        chapterLabels={outlineReviewChapterLabels}
        loading={savingOutlineReview}
        onClose={() => setOutlineReviewState(undefined)}
        onReopenCanvas={() => void reopenTaskCanvas()}
        onDiscard={discardOutlineReview}
        onApply={() => void applyOutlineReview()}
      />

      <CanonEditor
        open={canonEditorOpen}
        entry={canonEditorEntry}
        saving={savingCanonEntry}
        onCancel={closeCanonEditor}
        onSave={(draft) => void saveCanonEntry(draft)}
      />

      <TimelineEditor
        open={timelineEditorOpen}
        event={timelineEditorEvent}
        chapters={chapters}
        saving={savingTimelineEvent}
        onCancel={closeTimelineEditor}
        onSave={(draft) => void saveTimelineEvent(draft)}
      />
    </div>
  );
}

export default FictionistWorkspace;
