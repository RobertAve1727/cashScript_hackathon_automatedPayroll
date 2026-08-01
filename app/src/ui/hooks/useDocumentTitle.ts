import { useEffect } from 'react'

/** Restores the <title> each mirrored page declared. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    if (title) document.title = title
  }, [title])
}
