import {
  FileExcelOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FileUnknownOutlined,
  FileWordOutlined,
} from '@ant-design/icons';
import { SearchError } from '../../lib/searchClient';

export function fileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return <FilePdfOutlined />;
  if (ext === 'doc' || ext === 'docx') return <FileWordOutlined />;
  if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') {
    return <FileExcelOutlined />;
  }
  if (ext === 'txt' || ext === 'md') return <FileTextOutlined />;
  return <FileUnknownOutlined />;
}

export function newAttachmentId(): string {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function searchWarning(err: unknown): string {
  if (err instanceof SearchError) {
    if (err.kind === 'auth') return '搜索密钥无效，请检查搜索配置';
    if (err.kind === 'quota') return '搜索额度耗尽或被限流，将仅凭模型知识作答';
  }
  return '联网搜索失败，将仅凭模型知识作答';
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}
