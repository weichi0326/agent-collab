export function isConfirmText(text: string): boolean {
  return /^(确认|确定|执行|可以|开始|冲|ok|yes|y)$/i.test(text.trim());
}

export function isCancelText(text: string): boolean {
  return /^(取消|不用|算了|停止|cancel|no|n)$/i.test(text.trim());
}
