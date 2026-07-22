import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Ref,
} from 'react';
import { App, Input, type InputRef } from 'antd';
import {
  ApiOutlined,
  DatabaseOutlined,
  GlobalOutlined,
  RobotOutlined,
  SearchOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import {
  SETTINGS_CATALOG,
  filterSettingsCatalog,
  type SettingsGroup,
  type SettingsSection,
} from '../../settings/settingsCatalog';
import { requiresSettingsLeaveConfirmation } from '../../settings/settingsNavigation';
import { useUiStore } from '../../stores/uiStore';
import { ModelSettingsPanel } from '../ModelConfigModal';
import { SearchSettingsPanel } from '../SearchConfigModal';
import { JiziSettingsPanel } from '../MasterConfigModal';
import { ToolSettingsPanel } from '../ToolConfigModal';
import SystemDataSettingsPanel from './SystemDataSettingsPanel';
import SettingsPanelErrorBoundary from './SettingsPanelErrorBoundary';
import LiveAnnouncement from '../LiveAnnouncement';

const GROUPS: SettingsGroup[] = ['AI 能力', '姬子', '扩展', '系统'];

const ICONS = {
  models: <ApiOutlined />,
  search: <GlobalOutlined />,
  jizi: <RobotOutlined />,
  tools: <ToolOutlined />,
  system: <DatabaseOutlined />,
} satisfies Record<SettingsSection, React.ReactNode>;

interface FocusTarget {
  focus: () => void;
}

// oxlint-disable-next-line react/only-export-components
export function focusSettingsEntry(
  searchInput: FocusTarget | null,
  pageHeading: FocusTarget | null,
): void {
  (searchInput ?? pageHeading)?.focus();
}

interface SettingsCenterNavigationProps {
  query: string;
  section: SettingsSection;
  onQueryChange: (value: string) => void;
  onSelect: (section: SettingsSection) => void;
  searchInputRef?: Ref<InputRef>;
}

export function SettingsCenterNavigation({
  query,
  section,
  onQueryChange,
  onSelect,
  searchInputRef,
}: SettingsCenterNavigationProps) {
  const visible = query.trim() ? filterSettingsCatalog(query) : SETTINGS_CATALOG;

  return (
    <aside className="settings-nav" aria-label="设置分类">
      <Input
        ref={searchInputRef}
        allowClear
        prefix={<SearchOutlined />}
        placeholder="搜索设置"
        value={query}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          onQueryChange(event.target.value)
        }
      />
      <div className="settings-nav__groups">
        {GROUPS.map((group) => {
          const items = visible.filter((item) => item.group === group);
          if (items.length === 0) return null;
          return (
            <section className="settings-nav__group" key={group}>
              <div className="settings-nav__group-label">{group}</div>
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-onboarding={
                    item.id === 'models'
                      ? 'settings-models'
                      : item.id === 'search'
                        ? 'settings-search'
                        : item.id === 'tools'
                          ? 'settings-tools'
                          : item.id === 'jizi'
                            ? 'settings-jizi'
                            : undefined
                  }
                  className={`settings-nav__item${
                    item.id === section ? ' settings-nav__item--active' : ''
                  }`}
                  aria-current={item.id === section ? 'page' : undefined}
                  onClick={() => onSelect(item.id)}
                >
                  <span className="settings-nav__item-icon">{ICONS[item.id]}</span>
                  <span className="settings-nav__item-copy">
                    <strong>{item.title}</strong>
                    <span>{item.description}</span>
                  </span>
                </button>
              ))}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

interface SettingsCenterPanelProps {
  section: SettingsSection;
  onDirtyChange: (dirty: boolean) => void;
}

export function SettingsCenterPanel({
  section,
  onDirtyChange,
}: SettingsCenterPanelProps) {
  if (section === 'models') {
    return <ModelSettingsPanel onDirtyChange={onDirtyChange} />;
  }
  if (section === 'search') {
    return <SearchSettingsPanel />;
  }
  if (section === 'jizi') {
    return <JiziSettingsPanel onDirtyChange={onDirtyChange} />;
  }
  if (section === 'tools') {
    return <ToolSettingsPanel active />;
  }
  return <SystemDataSettingsPanel />;
}

export default function SettingsCenter() {
  const { modal } = App.useApp();
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<InputRef>(null);
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);
  const section = useUiStore((state) => state.settingsSection);
  const dirty = useUiStore((state) => state.settingsDirty);
  const setSection = useUiStore((state) => state.setSettingsSection);
  const setDirty = useUiStore((state) => state.setSettingsDirty);
  const activeItem = SETTINGS_CATALOG.find((item) => item.id === section)!;

  useEffect(() => {
    focusSettingsEntry(searchInputRef.current, pageHeadingRef.current);
  }, []);

  const onDirtyChange = useCallback(
    (nextDirty: boolean) => setDirty(nextDirty),
    [setDirty],
  );

  const selectSection = (nextSection: SettingsSection) => {
    if (nextSection === section) return;
    if (!requiresSettingsLeaveConfirmation(dirty)) {
      setSection(nextSection);
      return;
    }
    modal.confirm({
      title: '放弃未保存的修改？',
      content: '当前设置页有尚未保存的内容。离开后这些修改将丢失。',
      okText: '放弃修改',
      cancelText: '继续编辑',
      onOk: () => {
        setDirty(false);
        setSection(nextSection);
      },
    });
  };

  return (
    <div className="settings-center" aria-label="设置中心">
      <LiveAnnouncement message={`当前设置分区：${activeItem.title}`} />
      <SettingsCenterNavigation
        query={query}
        section={section}
        onQueryChange={setQuery}
        onSelect={selectSection}
        searchInputRef={searchInputRef}
      />
      <main className="settings-content">
        <header className="settings-content__header">
          <span className="settings-content__kicker">设置中心</span>
          <h1
            className="settings-content__title"
            ref={pageHeadingRef}
            tabIndex={-1}
          >
            {activeItem.title}
          </h1>
          <p className="settings-content__subtitle">{activeItem.description}</p>
        </header>
        <div className={`settings-content__body settings-content__body--${section}`}>
          <SettingsPanelErrorBoundary key={section}>
            <SettingsCenterPanel
              section={section}
              onDirtyChange={onDirtyChange}
            />
          </SettingsPanelErrorBoundary>
        </div>
      </main>
    </div>
  );
}
