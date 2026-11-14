export async function writeClipboard(text: string) {
  if (!navigator.clipboard?.writeText)
    throw new Error("当前浏览器不支持剪贴板 API，请使用 HTTPS 或手动选择复制");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    throw new Error("浏览器拒绝剪贴板写入，请允许剪贴板权限并再次点击复制");
  }
}
