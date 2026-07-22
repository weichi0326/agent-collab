import { useMemo, useState } from 'react';
import { App, Button, Drawer, Input, Modal, Segmented, Tag, Tooltip } from 'antd';
import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  BookOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  DownOutlined,
  EditOutlined,
  EnvironmentOutlined,
  ExclamationCircleOutlined,
  EyeOutlined,
  FileTextOutlined,
  HistoryOutlined,
  InboxOutlined,
  LinkOutlined,
  PlusOutlined,
  PlayCircleOutlined,
  SaveOutlined,
  SearchOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import './FictionistWorkspace.css';

type FictionistSection = 'library' | 'chapters' | 'canon' | 'timeline' | 'workflows';
type ProjectSection = Exclude<FictionistSection, 'library'>;
type EditorMode = 'edit' | 'preview';
type InspectorMode = 'context' | 'checks';

interface DemoBook {
  id: string;
  title: string;
  genre: string;
  status: '写作中' | '筹备中' | '已归档';
  chapters: number;
  words: number;
  canonEntries: number;
  updatedAt: string;
  coverTone: 'teal' | 'blue' | 'red' | 'gold';
}

interface DemoChapter {
  id: string;
  index: number;
  title: string;
  status: '定稿' | '修改中' | '草稿';
  words: number;
  content: string;
}

const INITIAL_CHAPTERS: DemoChapter[] = [
  {
    id: 'chapter-1',
    index: 1,
    title: '潮声之外',
    status: '定稿',
    words: 3280,
    content:
      '港区停电后的第十七分钟，林砚终于听见了那封信里提到的钟声。\n\n声音从雾里传来，隔着废弃的引水渠，一下，又一下。码头所有机械钟都停在凌晨两点十四分，只有旧海关塔顶的铜钟仍在走。\n\n她把信纸折回原样，塞进外套内袋。纸角擦过指尖时，留下了一点潮湿的蓝色墨迹。寄信人知道她会来，也知道今晚不会有船靠岸。',
  },
  {
    id: 'chapter-2',
    index: 2,
    title: '没有靠岸的船',
    status: '修改中',
    words: 2860,
    content:
      '林砚沿着防波堤向东走。雾把灯塔切成两截，上半截悬在黑暗里，像一枚没有落下的句号。\n\n值夜人老杜不在岗亭，桌上却摆着两杯刚泡好的茶。第二只杯子下面压着一张航道图，图上有一条不属于任何登记航线的红线。\n\n红线的终点，是三年前已经封闭的七号泊位。',
  },
  {
    id: 'chapter-3',
    index: 3,
    title: '七号泊位',
    status: '草稿',
    words: 1140,
    content:
      '七号泊位的铁门没有上锁。\n\n林砚推门时，门轴发出的声音和信里那句“不要惊动守钟人”同时浮进脑海。她停了一秒，还是走了进去。',
  },
  {
    id: 'chapter-4',
    index: 4,
    title: '守钟人的名单',
    status: '草稿',
    words: 0,
    content: '',
  },
];

const INITIAL_BOOKS: DemoBook[] = [
  {
    id: 'mist-harbor',
    title: '雾港来信',
    genre: '长篇悬疑',
    status: '写作中',
    chapters: 4,
    words: 7280,
    canonEntries: 18,
    updatedAt: '今天 14:32',
    coverTone: 'teal',
  },
  {
    id: 'summer-orbit',
    title: '夏日轨道',
    genre: '青春科幻',
    status: '筹备中',
    chapters: 0,
    words: 0,
    canonEntries: 7,
    updatedAt: '昨天 21:08',
    coverTone: 'blue',
  },
  {
    id: 'north-window',
    title: '北窗旧事',
    genre: '年代短篇集',
    status: '已归档',
    chapters: 10,
    words: 46200,
    canonEntries: 12,
    updatedAt: '2026-06-18',
    coverTone: 'red',
  },
];

const SECTION_ITEMS: Array<{
  id: ProjectSection;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: 'chapters', label: '正文', icon: <FileTextOutlined /> },
  { id: 'canon', label: '设定库', icon: <DatabaseOutlined /> },
  { id: 'timeline', label: '时间线', icon: <ClockCircleOutlined /> },
  { id: 'workflows', label: '工作流', icon: <BranchesOutlined /> },
];

const CANON_ITEMS = [
  { type: '人物', name: '林砚', detail: '调查记者 · 当前位于七号泊位', icon: <TeamOutlined /> },
  { type: '人物', name: '老杜', detail: '港区值夜人 · 当前下落不明', icon: <TeamOutlined /> },
  { type: '地点', name: '雾港', detail: '沿海工业港 · 常年受潮雾影响', icon: <EnvironmentOutlined /> },
  { type: '地点', name: '旧海关钟塔', detail: '停电后仍在运行的机械钟塔', icon: <EnvironmentOutlined /> },
  { type: '组织', name: '航标署', detail: '负责航道与灯塔维护', icon: <ApartmentOutlined /> },
  { type: '物品', name: '蓝墨水来信', detail: '来源未知 · 与失踪船只有关', icon: <BookOutlined /> },
];

const TIMELINE_ITEMS = [
  ['三年前 · 10月', '七号泊位因事故永久封闭', '背景事件'],
  ['七天前 · 22:40', '林砚收到没有邮戳的蓝墨水来信', '已确认'],
  ['今晚 · 02:14', '港区停电，所有机械钟同时停止', '第 1 章'],
  ['今晚 · 02:31', '林砚在值夜岗亭发现异常航道图', '第 2 章'],
  ['今晚 · 02:46', '林砚进入七号泊位', '第 3 章'],
];

const WORKFLOWS = [
  ['续写下一章', '汇总上一章结尾、当前人物状态和未回收伏笔', '5 项上下文'],
  ['章节连续性检查', '检查时间、地点、人物认知和物品状态', '最近运行：通过'],
  ['场景拆分', '把章纲拆为目标、冲突、转折和场景结果', '章纲 → 场景卡'],
  ['章节定向润色', '保留情节事实，只调整节奏、对白或叙述', '生成差异稿'],
];

const LIBRARY_STATUS_FILTERS = ['全部书籍', '写作中', '筹备中', '已归档'];
const LIBRARY_GENRE_FILTERS = ['悬疑', '科幻', '奇幻', '年代'];

function statusClass(status: DemoChapter['status']): string {
  if (status === '定稿') return 'is-final';
  if (status === '修改中') return 'is-editing';
  return 'is-draft';
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

function ContextInspector({ mode, onModeChange }: {
  mode: InspectorMode;
  onModeChange: (mode: InspectorMode) => void;
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
      {mode === 'context' ? (
        <div className="fictionist-inspector-sections">
          <section>
            <div className="fictionist-section-heading">
              <span>出场人物</span>
              <button type="button">查看全部</button>
            </div>
            <button className="fictionist-context-row" type="button">
              <span className="fictionist-avatar">林</span>
              <span><strong>林砚</strong><small>调查记者 · 知道蓝墨水来信</small></span>
            </button>
            <button className="fictionist-context-row" type="button">
              <span className="fictionist-avatar fictionist-avatar--gold">杜</span>
              <span><strong>老杜</strong><small>值夜人 · 当前下落不明</small></span>
            </button>
          </section>
          <section>
            <div className="fictionist-section-heading"><span>场景状态</span></div>
            <dl className="fictionist-facts">
              <div><dt>时间</dt><dd>凌晨 02:46</dd></div>
              <div><dt>地点</dt><dd>七号泊位</dd></div>
              <div><dt>天气</dt><dd>浓雾，无风</dd></div>
              <div><dt>视角</dt><dd>林砚 · 第三人称限知</dd></div>
            </dl>
          </section>
          <section>
            <div className="fictionist-section-heading"><span>未回收线索</span><Tag>3</Tag></div>
            <ul className="fictionist-thread-list">
              <li><LinkOutlined />停摆后仍在走的铜钟</li>
              <li><LinkOutlined />航道图上的未知红线</li>
              <li><LinkOutlined />岗亭里的第二杯热茶</li>
            </ul>
          </section>
        </div>
      ) : (
        <div className="fictionist-check-list">
          <div className="fictionist-check-summary">
            <CheckCircleOutlined />
            <span><strong>当前没有硬性冲突</strong><small>基于 18 条正式设定检查</small></span>
          </div>
          <button type="button"><CheckCircleOutlined /><span><strong>人物认知一致</strong><small>林砚尚不知道守钟人的身份</small></span></button>
          <button type="button"><CheckCircleOutlined /><span><strong>时间线连续</strong><small>与上一章间隔 15 分钟</small></span></button>
          <button type="button" className="is-warning"><ExclamationCircleOutlined /><span><strong>待确认的地点细节</strong><small>七号泊位入口方向尚未写入设定</small></span></button>
        </div>
      )}
    </div>
  );
}

function FictionistWorkspace({ initialSection = 'library' }: { initialSection?: FictionistSection }) {
  const { message } = App.useApp();
  const [section, setSection] = useState<FictionistSection>(initialSection);
  const [books, setBooks] = useState(INITIAL_BOOKS);
  const [activeBookId, setActiveBookId] = useState(INITIAL_BOOKS[0].id);
  const [chapters, setChapters] = useState(INITIAL_CHAPTERS);
  const [selectedChapterId, setSelectedChapterId] = useState(INITIAL_CHAPTERS[2].id);
  const [editorMode, setEditorMode] = useState<EditorMode>('edit');
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>('context');
  const [dirtyChapterIds, setDirtyChapterIds] = useState<Set<string>>(() => new Set());
  const [continueOpen, setContinueOpen] = useState(false);
  const [compactInspectorOpen, setCompactInspectorOpen] = useState(false);
  const [createBookOpen, setCreateBookOpen] = useState(false);
  const [newBookTitle, setNewBookTitle] = useState('');
  const [newBookGenre, setNewBookGenre] = useState('');
  const [libraryFilter, setLibraryFilter] = useState('全部书籍');
  const [query, setQuery] = useState('');

  const activeBook = books.find((book) => book.id === activeBookId) ?? books[0];
  const selectedChapter = chapters.find((chapter) => chapter.id === selectedChapterId) ?? chapters[0];
  const visibleChapters = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return chapters;
    return chapters.filter((chapter) =>
      `${chapter.index}${chapter.title}`.toLocaleLowerCase().includes(normalized),
    );
  }, [chapters, query]);
  const visibleBooks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return books.filter((book) => {
      const matchesQuery = !normalized
        || `${book.title}${book.genre}${book.status}`.toLocaleLowerCase().includes(normalized);
      const matchesFilter = libraryFilter === '全部书籍'
        || book.status === libraryFilter
        || book.genre.includes(libraryFilter);
      return matchesQuery && matchesFilter;
    });
  }, [books, libraryFilter, query]);
  const libraryStats = books.reduce(
    (totals, book) => ({
      chapters: totals.chapters + book.chapters,
      words: totals.words + book.words,
    }),
    { chapters: 0, words: 0 },
  );

  const switchSection = (nextSection: FictionistSection) => {
    setSection(nextSection);
    setQuery('');
    const label = SECTION_ITEMS.find((item) => item.id === nextSection)?.label;
    if (nextSection !== 'chapters' && nextSection !== 'library') message.info(`已切换到${label}演示视图`);
  };

  const createBook = () => {
    const title = newBookTitle.trim();
    if (!title) return;
    setBooks((current) => [{
      id: `book-${Date.now()}`,
      title,
      genre: newBookGenre.trim() || '未设置题材',
      status: '筹备中',
      chapters: 0,
      words: 0,
      canonEntries: 0,
      updatedAt: '刚刚',
      coverTone: 'gold',
    }, ...current]);
    setNewBookTitle('');
    setNewBookGenre('');
    setCreateBookOpen(false);
    message.success(`演示：已在书库中新建《${title}》`);
  };

  const openBook = (book: DemoBook) => {
    if (book.status === '已归档') {
      message.info('演示：请先恢复已归档作品，再进入写作');
      return;
    }
    setActiveBookId(book.id);
    setSection('chapters');
    setQuery('');
    message.success(`演示：已切换到《${book.title}》`);
  };

  const updateSelectedChapter = (content: string) => {
    setChapters((current) => current.map((chapter) => (
      chapter.id === selectedChapter.id
        ? { ...chapter, content, words: content.replace(/\s/g, '').length }
        : chapter
    )));
    setDirtyChapterIds((current) => new Set(current).add(selectedChapter.id));
  };

  const saveChapter = () => {
    setDirtyChapterIds((current) => {
      const next = new Set(current);
      next.delete(selectedChapter.id);
      return next;
    });
    message.success(`演示：已保存《${selectedChapter.title}》`);
  };

  const addChapter = () => {
    const nextIndex = chapters.length + 1;
    const chapter: DemoChapter = {
      id: `chapter-${Date.now()}`,
      index: nextIndex,
      title: `未命名章节 ${nextIndex}`,
      status: '草稿',
      words: 0,
      content: '',
    };
    setChapters((current) => [...current, chapter]);
    setSelectedChapterId(chapter.id);
    setSection('chapters');
    setEditorMode('edit');
    message.success('演示：已创建一个空白章节');
  };

  const confirmContinue = () => {
    setContinueOpen(false);
    message.success('演示：续写上下文已准备，功能实现后将在这里创建写作画布');
  };

  return (
    <div className="fictionist-workspace pearl-page-enter">
      <header className="fictionist-project-bar">
        {section === 'library' ? (
          <div className="fictionist-project-identity fictionist-project-identity--library">
            <span className="fictionist-project-mark"><BookOutlined /></span>
            <span><strong>我的书库</strong><small>小说家专业包 · {books.length} 部作品</small></span>
          </div>
        ) : (
          <button className="fictionist-project-identity fictionist-project-switcher" type="button" onClick={() => switchSection('library')}>
            <span className="fictionist-project-mark"><BookOutlined /></span>
            <span><strong>{activeBook.title}</strong><small>{activeBook.genre} · 返回书库切换作品</small></span>
            <DownOutlined />
          </button>
        )}
        {section !== 'library' ? (
          <div className="fictionist-project-stats" aria-label="项目概况">
            <span><strong>{activeBook.chapters}</strong> 章</span>
            <span><strong>{activeBook.words.toLocaleString()}</strong> 字</span>
            <span><strong>{activeBook.canonEntries}</strong> 条正式设定</span>
          </div>
        ) : null}
        {section !== 'library' ? (
          <div className="fictionist-project-actions">
            <Button icon={<ArrowLeftOutlined />} onClick={() => switchSection('library')}>返回书架</Button>
            <Button className="fictionist-search-action" icon={<SearchOutlined />} onClick={() => message.info('演示：全书搜索')}>全书搜索</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={addChapter}>新建章节</Button>
          </div>
        ) : null}
      </header>

      <div className={`fictionist-layout fictionist-layout--${section}`}>
        {section !== 'library' ? (
          <nav className="fictionist-rail" aria-label="作品功能">
            {SECTION_ITEMS.map((item) => (
              <Tooltip key={item.id} title={item.label} placement="right">
                <button
                  type="button"
                  className={section === item.id ? 'is-active' : ''}
                  aria-current={section === item.id ? 'page' : undefined}
                  onClick={() => switchSection(item.id)}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              </Tooltip>
            ))}
          </nav>
        ) : null}

        <aside className="fictionist-navigator">
          <div className="fictionist-panel-title">
            <span>
              <strong>{section === 'library' ? '书架分类' : section === 'chapters' ? '卷与章节' : SECTION_ITEMS.find((item) => item.id === section)?.label}</strong>
              <small>{section === 'library' ? '按状态与题材查找' : '项目内容导航'}</small>
            </span>
            <Tooltip title={section === 'library' ? '新建作品' : '添加'}>
              <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                onClick={section === 'library' ? () => setCreateBookOpen(true) : addChapter}
              />
            </Tooltip>
          </div>
          <Input
            allowClear
            size="small"
            prefix={<SearchOutlined />}
            placeholder={section === 'library' ? '搜索书名或题材' : '搜索当前分区'}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {section === 'library' ? (
            <div className="fictionist-library-filters">
              <span className="fictionist-filter-label">状态</span>
              {LIBRARY_STATUS_FILTERS.map((item) => (
                <button type="button" className={libraryFilter === item ? 'is-active' : ''} key={item} onClick={() => setLibraryFilter(item)}>
                  <span>{item}</span>
                  <small>{item === '全部书籍' ? books.length : books.filter((book) => book.status === item).length}</small>
                </button>
              ))}
              <span className="fictionist-filter-label">题材</span>
              {LIBRARY_GENRE_FILTERS.map((item) => (
                <button type="button" className={libraryFilter === item ? 'is-active' : ''} key={item} onClick={() => setLibraryFilter(item)}>
                  <span>{item}</span>
                  <small>{books.filter((book) => book.genre.includes(item)).length}</small>
                </button>
              ))}
            </div>
          ) : section === 'chapters' ? (
            <div className="fictionist-chapter-tree">
              <div className="fictionist-volume-label"><span>第一卷 · 潮汐失语</span><small>4 章</small></div>
              {visibleChapters.map((chapter) => (
                <button
                  type="button"
                  key={chapter.id}
                  className={selectedChapter.id === chapter.id ? 'is-active' : ''}
                  onClick={() => {
                    setSelectedChapterId(chapter.id);
                    setEditorMode('edit');
                  }}
                >
                  <span className="fictionist-chapter-index">{String(chapter.index).padStart(2, '0')}</span>
                  <span className="fictionist-chapter-copy">
                    <strong>{chapter.title}</strong>
                    <small>{chapter.words.toLocaleString()} 字</small>
                  </span>
                  <span className={`fictionist-status-dot ${statusClass(chapter.status)}`} title={chapter.status} />
                </button>
              ))}
            </div>
          ) : section === 'canon' ? (
            <div className="fictionist-simple-list">
              {['全部设定', '人物（6）', '地点（4）', '组织（3）', '物品（5）', '世界规则（8）'].map((item, index) => (
                <button type="button" className={index === 0 ? 'is-active' : ''} key={item} onClick={() => message.info(`演示：筛选${item}`)}>{item}</button>
              ))}
            </div>
          ) : section === 'timeline' ? (
            <div className="fictionist-simple-list">
              {['故事时间', '章节顺序', '人物轨迹', '待确认事件'].map((item, index) => (
                <button type="button" className={index === 0 ? 'is-active' : ''} key={item} onClick={() => message.info(`演示：切换到${item}`)}>{item}</button>
              ))}
            </div>
          ) : (
            <div className="fictionist-simple-list">
              {['写作流程', '检查流程', '整理流程', '我的模板'].map((item, index) => (
                <button type="button" className={index === 0 ? 'is-active' : ''} key={item} onClick={() => message.info(`演示：筛选${item}`)}>{item}</button>
              ))}
            </div>
          )}
          <div className="fictionist-navigator-footer">
            <span><CheckCircleOutlined />{section === 'library' ? '作品数据仅保存在本机' : '本地草稿已同步'}</span>
          </div>
        </aside>

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
                <strong>{libraryFilter}</strong>
                <small>显示 {visibleBooks.length} 本 · 最近编辑优先</small>
              </div>
              <div className="fictionist-bookshelf-grid" aria-label="书架">
                <button className="fictionist-new-book-tile" type="button" onClick={() => setCreateBookOpen(true)}>
                  <span className="fictionist-new-book-cover"><PlusOutlined /></span>
                  <strong>新建一本书</strong>
                  <small>空白作品</small>
                </button>
                {visibleBooks.map((book) => (
                  <article className={`fictionist-book-card ${book.id === activeBookId ? 'is-current' : ''}`} key={book.id}>
                    <button
                      className="fictionist-book-open"
                      type="button"
                      aria-label={`打开《${book.title}》`}
                      disabled={book.status === '已归档'}
                      onClick={() => openBook(book)}
                    >
                      <span className={`fictionist-book-cover fictionist-book-cover--${book.coverTone}`}>
                        <small>FICTION</small>
                        <strong>{book.title}</strong>
                        <span>{book.genre}</span>
                        {book.id === activeBookId ? <em>当前</em> : null}
                      </span>
                      <span className="fictionist-book-copy">
                        <strong>{book.title}</strong>
                        <small>{book.genre} · {book.status}</small>
                      </span>
                    </button>
                    <span className="fictionist-book-footer">
                      <span className="fictionist-book-metrics" aria-label={`${book.chapters} 章，${book.words.toLocaleString()} 字`}>
                        <span><strong>{book.chapters}</strong><small>章节</small></span>
                        <span><strong>{book.words.toLocaleString()}</strong><small>字数</small></span>
                      </span>
                      <span className="fictionist-book-actions">
                      <Tooltip title="项目设置"><Button aria-label={`设置《${book.title}》`} icon={<SettingOutlined />} onClick={() => message.info(`演示：打开《${book.title}》项目设置`)} /></Tooltip>
                      <Tooltip title={book.status === '已归档' ? '恢复作品' : '归档作品'}>
                        <Button
                          aria-label={`${book.status === '已归档' ? '恢复' : '归档'}《${book.title}》`}
                          icon={<InboxOutlined />}
                          onClick={() => message.info(`演示：${book.status === '已归档' ? '恢复' : '归档'}《${book.title}》`)}
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
                    <Button type="link" onClick={() => { setLibraryFilter('全部书籍'); setQuery(''); }}>查看全部书籍</Button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : section === 'chapters' ? (
            <>
              <div className="fictionist-editor-header">
                <div>
                  <div className="fictionist-editor-eyebrow">第一卷 · 第 {selectedChapter.index} 章</div>
                  <h1>{selectedChapter.title}</h1>
                  <div className="fictionist-editor-meta">
                    <span>{selectedChapter.words.toLocaleString()} 字</span>
                    <span>{selectedChapter.status}</span>
                    <span>{dirtyChapterIds.has(selectedChapter.id) ? '有未保存修改' : '已保存'}</span>
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
                  <Tooltip title="版本历史"><Button icon={<HistoryOutlined />} onClick={() => message.info('演示：这里将打开章节版本历史')} /></Tooltip>
                  <Button className="fictionist-context-trigger" onClick={() => setCompactInspectorOpen(true)}>上下文</Button>
                  <Button icon={<SaveOutlined />} onClick={saveChapter}>保存</Button>
                  <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => setContinueOpen(true)}>续写下一章</Button>
                </div>
              </div>
              <div className="fictionist-editor-surface">
                {editorMode === 'edit' ? (
                  <textarea
                    aria-label="章节正文编辑区"
                    value={selectedChapter.content}
                    placeholder="从这里开始写这一章……"
                    spellCheck={false}
                    onChange={(event) => updateSelectedChapter(event.target.value)}
                  />
                ) : <ChapterPreview content={selectedChapter.content} />}
              </div>
              <footer className="fictionist-editor-footer">
                <span>Markdown 正文</span>
                <span>自动保存演示已关闭</span>
                <span>缩放 100%</span>
              </footer>
            </>
          ) : section === 'canon' ? (
            <div className="fictionist-content-view">
              <header><span><small>作品事实库</small><h1>设定库</h1></span><Button type="primary" icon={<PlusOutlined />} onClick={() => message.success('演示：新建设定')}>新建设定</Button></header>
              <div className="fictionist-canon-table" role="table" aria-label="设定库">
                <div className="fictionist-table-head" role="row"><span>名称</span><span>类型</span><span>当前状态</span></div>
                {CANON_ITEMS.map((item) => (
                  <button type="button" role="row" key={item.name} onClick={() => message.info(`演示：打开${item.name}详情`)}>
                    <span>{item.icon}<strong>{item.name}</strong></span><Tag>{item.type}</Tag><small>{item.detail}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : section === 'timeline' ? (
            <div className="fictionist-content-view">
              <header><span><small>事件与章节同步</small><h1>故事时间线</h1></span><Button type="primary" icon={<PlusOutlined />} onClick={() => message.success('演示：新建时间线事件')}>新增事件</Button></header>
              <div className="fictionist-timeline">
                {TIMELINE_ITEMS.map(([time, event, source]) => (
                  <button type="button" key={time} onClick={() => message.info(`演示：打开事件“${event}”`)}>
                    <span className="fictionist-timeline-dot" /><time>{time}</time><strong>{event}</strong><Tag>{source}</Tag>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="fictionist-content-view">
              <header><span><small>从画布能力组合而来</small><h1>小说工作流</h1></span><Button icon={<BranchesOutlined />} onClick={() => message.info('演示：打开画布工作台')}>在画布中编辑</Button></header>
              <div className="fictionist-workflow-list">
                {WORKFLOWS.map(([name, description, meta], index) => (
                  <div key={name}>
                    <span className="fictionist-workflow-icon">{index + 1}</span>
                    <span><strong>{name}</strong><small>{description}</small></span>
                    <Tag>{meta}</Tag>
                    <Button icon={<PlayCircleOutlined />} onClick={() => message.success(`演示：已准备运行“${name}”`)}>运行</Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>

        {section === 'chapters' ? (
          <aside className="fictionist-inspector">
            <ContextInspector mode={inspectorMode} onModeChange={setInspectorMode} />
          </aside>
        ) : null}
      </div>

      <Drawer
        title="本章上下文"
        open={compactInspectorOpen}
        onClose={() => setCompactInspectorOpen(false)}
        size="default"
      >
        <ContextInspector mode={inspectorMode} onModeChange={setInspectorMode} />
      </Drawer>

      <Modal
        title="新建作品"
        open={createBookOpen}
        onCancel={() => setCreateBookOpen(false)}
        onOk={createBook}
        okText="创建作品"
        cancelText="取消"
        okButtonProps={{ disabled: !newBookTitle.trim() }}
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
              onPressEnter={createBook}
            />
          </label>
          <label>
            <span>题材或类型</span>
            <Input
              maxLength={30}
              placeholder="例如：长篇奇幻"
              value={newBookGenre}
              onChange={(event) => setNewBookGenre(event.target.value)}
              onPressEnter={createBook}
            />
          </label>
          <p className="fictionist-modal-note">这是界面演示，关闭软件后新建内容不会保留。</p>
        </div>
      </Modal>

      <Modal
        title="续写下一章"
        open={continueOpen}
        onCancel={() => setContinueOpen(false)}
        onOk={confirmContinue}
        okText="准备写作画布"
        cancelText="取消"
      >
        <p className="fictionist-modal-copy">本次续写将以《{selectedChapter.title}》当前版本为起点，并注入以下内容：</p>
        <ul className="fictionist-context-preview">
          <li><CheckCircleOutlined />本章正文与结尾片段</li>
          <li><CheckCircleOutlined />林砚、老杜的当前人物状态</li>
          <li><CheckCircleOutlined />七号泊位与旧海关钟塔设定</li>
          <li><CheckCircleOutlined />3 条尚未回收的线索</li>
        </ul>
        <p className="fictionist-modal-note">这是界面演示，不会创建画布或写入文件。</p>
      </Modal>
    </div>
  );
}

export default FictionistWorkspace;
