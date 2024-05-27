import { html, LitElement } from 'lit'
import { customElement } from 'lit/decorators.js'
import '@material/web/tabs/tabs'
import '@material/web/tabs/primary-tab'
import { MdTabs } from '@material/web/tabs/tabs'
import { Tab } from '@material/web/tabs/internal/tab'

@customElement('option-tab')
export class OptionTab extends LitElement {
    public constructor() {
        super()
    }

    private static getPanel(tabs: MdTabs, tab: Tab): HTMLElement | null {
        const panelId = tab.getAttribute('aria-controls')
        const root = tabs.getRootNode() as Document | ShadowRoot
        return root.querySelector<HTMLElement>(`#${panelId}`)
    }

    private static changeTab(e: Event) {
        if (!(e.target instanceof MdTabs)) return
        const tabs = e.target
        e.target.tabs.forEach(tab => {
            if (tab.active) return
            const panel = OptionTab.getPanel(tabs, tab)
            if (panel == null || panel.hidden) return
            panel.hidden = true
        })

        if (e.target.activeTab == null) return
        const currentPanel = OptionTab.getPanel(tabs, e.target.activeTab)
        if (currentPanel == null) return
        currentPanel.hidden = false
    }

    public render() {
        return html`
        <md-tabs @change=${OptionTab.changeTab}>
            <md-primary-tab id="tab-main" aria-controls="panel-main" inlineIcon active>
                Records
            </md-primary-tab>
            <md-primary-tab id="tab-settings" aria-controls="panel-settings" inlineIcon>
                Settings
            </md-primary-tab>
        </md-tabs>
        <div role="tabpanel" id="panel-main" aria-labelledby="tab-main">
            <slot name="panel-main"></slot>
        </div>
        <div role="tabpanel" id="panel-settings" aria-labelledby="tab-settings" hidden>
            <slot name="panel-settings"></slot>
        </div>
        `
    }
}
