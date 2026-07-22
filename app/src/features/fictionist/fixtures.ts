import {
  FICTIONIST_SCHEMA_VERSION,
  type FictionChapter,
  type FictionistIndex,
} from './domain';

export interface FictionistSeedData {
  index: FictionistIndex;
  chapterContents: Record<string, string>;
}

const MIST_CHAPTERS: FictionChapter[] = [
  {
    id: 'chapter-1',
    projectId: 'mist-harbor',
    volumeId: 'mist-harbor-volume-1',
    title: '潮声之外',
    status: 'final',
    wordCount: 3280,
    revision: 1,
    createdAt: '2026-06-01T08:00:00.000Z',
    updatedAt: '2026-07-20T14:32:00.000Z',
  },
  {
    id: 'chapter-2',
    projectId: 'mist-harbor',
    volumeId: 'mist-harbor-volume-1',
    title: '没有靠岸的船',
    status: 'revised',
    wordCount: 2860,
    revision: 2,
    createdAt: '2026-06-03T08:00:00.000Z',
    updatedAt: '2026-07-21T14:32:00.000Z',
  },
  {
    id: 'chapter-3',
    projectId: 'mist-harbor',
    volumeId: 'mist-harbor-volume-1',
    title: '七号泊位',
    status: 'draft',
    wordCount: 1140,
    revision: 1,
    createdAt: '2026-06-05T08:00:00.000Z',
    updatedAt: '2026-07-23T14:32:00.000Z',
  },
  {
    id: 'chapter-4',
    projectId: 'mist-harbor',
    volumeId: 'mist-harbor-volume-1',
    title: '守钟人的名单',
    status: 'outline',
    wordCount: 0,
    revision: 0,
    createdAt: '2026-07-22T08:00:00.000Z',
    updatedAt: '2026-07-22T08:00:00.000Z',
  },
];

const NORTH_CHAPTERS: FictionChapter[] = Array.from({ length: 10 }, (_, index) => ({
  id: `north-window-chapter-${index + 1}`,
  projectId: 'north-window',
  volumeId: 'north-window-volume-1',
  title: `旧事 ${index + 1}`,
  status: 'final',
  wordCount: 4620,
  revision: 1,
  createdAt: '2026-05-01T08:00:00.000Z',
  updatedAt: '2026-06-18T08:00:00.000Z',
}));

export function createDemoFictionistData(): FictionistSeedData {
  const chapters = [...MIST_CHAPTERS, ...NORTH_CHAPTERS];
  return {
    index: {
      schemaVersion: FICTIONIST_SCHEMA_VERSION,
      projects: {
        'mist-harbor': {
          id: 'mist-harbor',
          title: '雾港来信',
          genre: '长篇悬疑',
          status: 'drafting',
          volumeIds: ['mist-harbor-volume-1'],
          canonEntryCount: 18,
          coverTone: 'teal',
          createdAt: '2026-06-01T08:00:00.000Z',
          updatedAt: '2026-07-23T14:32:00.000Z',
        },
        'summer-orbit': {
          id: 'summer-orbit',
          title: '夏日轨道',
          genre: '青春科幻',
          status: 'paused',
          volumeIds: ['summer-orbit-volume-1'],
          canonEntryCount: 7,
          coverTone: 'blue',
          createdAt: '2026-07-20T08:00:00.000Z',
          updatedAt: '2026-07-22T21:08:00.000Z',
        },
        'north-window': {
          id: 'north-window',
          title: '北窗旧事',
          genre: '年代短篇集',
          status: 'archived',
          volumeIds: ['north-window-volume-1'],
          canonEntryCount: 12,
          coverTone: 'red',
          createdAt: '2026-04-01T08:00:00.000Z',
          updatedAt: '2026-06-18T08:00:00.000Z',
        },
      },
      volumes: {
        'mist-harbor-volume-1': {
          id: 'mist-harbor-volume-1',
          projectId: 'mist-harbor',
          title: '第一卷 · 潮汐失语',
          chapterIds: MIST_CHAPTERS.map((chapter) => chapter.id),
        },
        'summer-orbit-volume-1': {
          id: 'summer-orbit-volume-1',
          projectId: 'summer-orbit',
          title: '第一卷',
          chapterIds: [],
        },
        'north-window-volume-1': {
          id: 'north-window-volume-1',
          projectId: 'north-window',
          title: '旧事',
          chapterIds: NORTH_CHAPTERS.map((chapter) => chapter.id),
        },
      },
      chapters: Object.fromEntries(chapters.map((chapter) => [chapter.id, chapter])),
      activeProjectId: 'mist-harbor',
      activeChapterId: 'chapter-3',
      updatedAt: '2026-07-23T14:32:00.000Z',
    },
    chapterContents: {
      'chapter-1': '港区停电后的第十七分钟，林砚终于听见了那封信里提到的钟声。\n\n声音从雾里传来，隔着废弃的引水渠，一下，又一下。码头所有机械钟都停在凌晨两点十四分，只有旧海关塔顶的铜钟仍在走。\n\n她把信纸折回原样，塞进外套内袋。纸角擦过指尖时，留下了一点潮湿的蓝色墨迹。寄信人知道她会来，也知道今晚不会有船靠岸。',
      'chapter-2': '林砚沿着防波堤向东走。雾把灯塔切成两截，上半截悬在黑暗里，像一枚没有落下的句号。\n\n值夜人老杜不在岗亭，桌上却摆着两杯刚泡好的茶。第二只杯子下面压着一张航道图，图上有一条不属于任何登记航线的红线。\n\n红线的终点，是三年前已经封闭的七号泊位。',
      'chapter-3': '七号泊位的铁门没有上锁。\n\n林砚推门时，门轴发出的声音和信里那句“不要惊动守钟人”同时浮进脑海。她停了一秒，还是走了进去。',
      'chapter-4': '',
      ...Object.fromEntries(NORTH_CHAPTERS.map((chapter) => [chapter.id, ''])),
    },
  };
}
