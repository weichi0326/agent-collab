// 纯文本类文件的识别与读取。Tauri 的 WebView 与浏览器一样支持标准 <input type=file> + FileReader,
// 两端代码无需分叉,读到的是内容快照(非文件路径),不会随源文件后续修改而自动更新。

export const TEXT_EXTENSIONS = [
  'txt',
  'md',
  'csv',
  'json',
  'log',
  'xml',
  'yaml',
  'yml',
];

export function isTextFile(file: File): boolean {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return TEXT_EXTENSIONS.includes(ext) || file.type.startsWith('text/');
}

export function fileToText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsText(file);
  });
}
