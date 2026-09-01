export async function saveFile(blob: Blob, name: string): Promise<void> {
  // The conversion can take long enough for Safari to expire the original
  // click's user-activation token. Web Share and showSaveFilePicker then fail
  // with NotAllowedError even though the conversion itself succeeded. A
  // regular download does not have that timing problem and works in both the
  // macOS and iPadOS installed PWA.
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
