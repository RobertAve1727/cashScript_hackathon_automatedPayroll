import type { VendorScriptRuntime } from '@ui/application/ports/VendorScriptRuntime'
import { isLibraryScript } from './scriptClassification'

type Listener = {
  target: EventTarget
  type: string
  handler: EventListenerOrEventListenerObject
  options?: boolean | AddEventListenerOptions
}

interface SimpleBarLike {
  unMount?: () => void
}

interface TomSelectLike {
  destroy?: () => void
}

/**
 * Runs the template's browser scripts inside a single-page app.
 *
 * Three problems have to be solved for the port to behave like the original:
 *
 * 1. The template's initialisers run at load time and wire up whatever markup
 *    exists then. React swaps that markup on every navigation, so they are
 *    re-evaluated per page.
 * 2. Those scripts also attach delegated listeners to `document`. Re-evaluating
 *    them naively would stack a new copy on each navigation, so every listener
 *    added during evaluation is recorded and removed before the next run.
 * 3. Plugin bundles register their work under `DOMContentLoaded`, which has
 *    long since fired. Handlers registered during evaluation are captured and
 *    invoked directly instead.
 */
export class DomVendorScriptRuntime implements VendorScriptRuntime {
  private readonly loadedLibraries = new Set<string>()
  private readonly libraryPromises = new Map<string, Promise<void>>()
  private recordedListeners: Listener[] = []

  async load(urls: readonly string[]): Promise<void> {
    if (typeof document === 'undefined') return

    for (const url of urls) {
      if (isLibraryScript(url)) {
        await this.loadLibraryOnce(url)
      } else {
        await this.evaluateInitializer(url)
      }
    }
  }

  /**
   * Re-applies the initialisers that are cheap and safe to repeat, for cases
   * where markup changed without a navigation.
   */
  refresh(): void {
    if (typeof window === 'undefined') return
    const feather = (window as unknown as { feather?: { replace: () => void } }).feather
    try {
      feather?.replace()
    } catch {
      // A malformed data-feather value must not break rendering.
    }
    this.dedupeSidebarOverlay()
  }

  /**
   * Reverses the side effects of the previous page's initialisers so the next
   * evaluation starts from a clean document.
   */
  teardown(): void {
    if (typeof document === 'undefined') return

    for (const { target, type, handler, options } of this.recordedListeners) {
      target.removeEventListener(type, handler, options)
    }
    this.recordedListeners = []

    this.unmountSimpleBars()
    this.destroyTomSelects()
  }

  /** Loads a vendor bundle at most once, sharing the promise across callers. */
  private loadLibraryOnce(url: string): Promise<void> {
    if (this.loadedLibraries.has(url)) return Promise.resolve()

    const existing = this.libraryPromises.get(url)
    if (existing) return existing

    const promise = this.injectScript(url, { record: false })
      .then(() => {
        this.loadedLibraries.add(url)
      })
      .finally(() => {
        this.libraryPromises.delete(url)
      })

    this.libraryPromises.set(url, promise)
    return promise
  }

  /**
   * Evaluates a template initialiser, capturing everything it registers.
   *
   * A cache-busting query is deliberately omitted: the browser serves the file
   * from cache while still re-executing its top-level code.
   */
  private async evaluateInitializer(url: string): Promise<void> {
    await this.injectScript(url, { record: true })
  }

  /**
   * Appends a <script> and resolves when it has finished evaluating.
   *
   * While `record` is set, `addEventListener` on `document` and `window` is
   * intercepted so the runtime can both replay `DOMContentLoaded` and undo the
   * registrations later.
   */
  private injectScript(url: string, { record }: { record: boolean }): Promise<void> {
    return new Promise<void>((resolve) => {
      const domContentLoaded: EventListenerOrEventListenerObject[] = []
      const restore = record ? this.interceptListeners(domContentLoaded) : undefined

      const finish = () => {
        restore?.()
        // Plugins that deferred their work to DOMContentLoaded are driven here,
        // because the real event fired before the app ever mounted.
        for (const handler of domContentLoaded) {
          try {
            if (typeof handler === 'function') handler(new Event('DOMContentLoaded'))
            else handler.handleEvent(new Event('DOMContentLoaded'))
          } catch (error) {
            console.error(`[vendor] ${url} DOMContentLoaded handler failed`, error)
          }
        }
        resolve()
      }

      const script = document.createElement('script')
      script.src = url
      script.async = false
      script.dataset.vendorScript = record ? 'initializer' : 'library'
      script.onload = finish
      script.onerror = () => {
        console.error(`[vendor] failed to load ${url}`)
        finish()
      }

      // Initialiser tags are removed once evaluated; re-adding the same src on
      // the next navigation is what triggers re-execution.
      if (record) {
        const previous = document.querySelector(
          `script[data-vendor-script="initializer"][src="${CSS.escape(url)}"]`,
        )
        previous?.remove()
      }

      document.body.appendChild(script)
    })
  }

  /**
   * Patches `addEventListener` on `document` and `window` for the duration of a
   * script evaluation. Returns a function that restores the originals.
   */
  private interceptListeners(
    domContentLoaded: EventListenerOrEventListenerObject[],
  ): () => void {
    // Each target is paired with its own original rather than kept in a
    // second array indexed in lockstep, which cannot be shown to be safe
    // under `noUncheckedIndexedAccess`.
    const patched = ([document, window] as EventTarget[]).map((target) => ({
      target,
      original: target.addEventListener,
    }))

    for (const { target, original } of patched) {
      target.addEventListener = (
        type: string,
        handler: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ) => {
        if (!handler) return

        // Replayed manually once evaluation completes.
        if (type === 'DOMContentLoaded') {
          domContentLoaded.push(handler)
          return
        }

        // `options` is spread in only when it was actually passed: under
        // `exactOptionalPropertyTypes` an explicit `undefined` is not a legal
        // value for an optional property.
        this.recordedListeners.push({
          target,
          type,
          handler,
          ...(options === undefined ? {} : { options }),
        })
        original.call(target, type, handler, options)
      }
    }

    return () => {
      for (const { target, original } of patched) {
        target.addEventListener = original
      }
    }
  }

  /** script.js appends an overlay on every evaluation; keep only the first. */
  private dedupeSidebarOverlay(): void {
    const overlays = document.querySelectorAll('.sidebar-overlay')
    for (let index = 1; index < overlays.length; index += 1) {
      overlays[index]?.remove()
    }
  }

  /**
   * SimpleBar wraps its host in generated markup. Without unmounting, a second
   * evaluation would nest a whole new wrapper chain inside the previous one.
   */
  private unmountSimpleBars(): void {
    const SimpleBar = (window as unknown as {
      SimpleBar?: { instances?: WeakMap<Element, SimpleBarLike> }
    }).SimpleBar

    document.querySelectorAll('[data-simplebar]').forEach((element) => {
      const instance = SimpleBar?.instances?.get(element)
      try {
        instance?.unMount?.()
      } catch {
        // An already-detached instance is not an error.
      }
    })
  }

  /** Tom Select keeps its instance on the element; drop it with the markup. */
  private destroyTomSelects(): void {
    document.querySelectorAll('select').forEach((element) => {
      const instance = (element as HTMLSelectElement & { tomselect?: TomSelectLike }).tomselect
      if (!instance) return
      // Only tear down selects React is discarding; ones still in the document
      // keep working exactly as they did in the template.
      if (element.isConnected) return
      try {
        instance.destroy?.()
      } catch {
        // Ignore: the node is being removed anyway.
      }
    })
  }
}
