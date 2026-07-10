import type { RefObject } from 'react';
import { Button, Input, type InputRef } from 'antd';
import {
  CloseOutlined,
  DownOutlined,
  SearchOutlined,
  UpOutlined,
} from '@ant-design/icons';
import { Panel } from '@xyflow/react';

interface SearchPanelProps {
  inputRef: RefObject<InputRef | null>;
  query: string;
  setQuery: (value: string) => void;
  matchCount: number;
  activeIdx: number;
  gotoNext: () => void;
  gotoPrev: () => void;
  closeSearch: () => void;
}

export function SearchPanel({
  inputRef,
  query,
  setQuery,
  matchCount,
  activeIdx,
  gotoNext,
  gotoPrev,
  closeSearch,
}: SearchPanelProps) {
  return (
    <Panel position="top-center">
      <div className="canvas-search anim-fade-down">
        <SearchOutlined className="canvas-search__icon" />
        <Input
          ref={inputRef}
          size="small"
          autoFocus
          variant="borderless"
          placeholder="搜索节点名称"
          value={query}
          style={{ width: 160 }}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (e.shiftKey) gotoPrev();
              else gotoNext();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              closeSearch();
            }
          }}
        />
        <span className="canvas-search__count">
          {query.trim()
            ? matchCount
              ? `${Math.min(activeIdx, matchCount - 1) + 1}/${matchCount}`
              : '0/0'
            : ''}
        </span>
        <Button
          type="text"
          size="small"
          icon={<UpOutlined />}
          disabled={matchCount === 0}
          onClick={gotoPrev}
        />
        <Button
          type="text"
          size="small"
          icon={<DownOutlined />}
          disabled={matchCount === 0}
          onClick={gotoNext}
        />
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          onClick={closeSearch}
        />
      </div>
    </Panel>
  );
}
