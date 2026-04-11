import { beforeEach } from 'vitest'

/**
 * Get a LitElement instance from the rendered screen container.
 * Use this to call public methods like setContent(), setRecords(), etc.
 */
export function getElement<T extends HTMLElement>(container: Element, tagName: string): T {
    const el = container.querySelector(tagName) as T | null
    if (!el) throw new Error(`Element <${tagName}> not found in container`)
    return el
}

/**
 * Query inside a LitElement's shadow root.
 */
export function shadowQuery<T extends Element>(host: HTMLElement, selector: string): T | null {
    return host.shadowRoot?.querySelector<T>(selector) ?? null
}

/**
 * Query all inside a LitElement's shadow root.
 */
export function shadowQueryAll<T extends Element>(host: HTMLElement, selector: string): T[] {
    return Array.from(host.shadowRoot?.querySelectorAll<T>(selector) ?? [])
}

/**
 * Wait for a LitElement to finish updating.
 */
export async function elementUpdated(el: { updateComplete: Promise<boolean> }): Promise<void> {
    await el.updateComplete
}

/**
 * Clear localStorage before each test to avoid Settings state leaking between tests.
 */
beforeEach(() => {
    localStorage.clear()
})
