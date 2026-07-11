import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { isSafeHttpUrl } from './fileHelpers';

const components: Components = {
  a({ href, children }) {
    if (!href || !isSafeHttpUrl(href)) return <span>{children}</span>;
    return (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
  img({ alt }) {
    return <span className="master-markdown__image-placeholder">[图片：{alt || '未命名'}]</span>;
  },
};

export function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="master-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
