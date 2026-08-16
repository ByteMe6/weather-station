/** Assembles the CSV parts into a Blob and triggers a browser download. */
export const triggerDownload = (filename: string, parts: string[]): void => {
  const blob = new Blob(parts, { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
