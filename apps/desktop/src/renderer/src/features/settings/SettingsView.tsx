import { ModelSection } from './ModelSection.js'
import { CcSwitchSection } from './CcSwitchSection.js'
import { AgentTestSection } from './AgentTestSection.js'

export function SettingsView(): React.JSX.Element {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-8 py-7">
        <header>
          <h1 className="text-lg font-semibold">设置</h1>
          <p className="mt-0.5 text-xs text-faint">
            模型端点、cc-switch 导入与端到端验证都在这里完成。
          </p>
        </header>

        <ModelSection />
        <CcSwitchSection />
        <AgentTestSection />
      </div>
    </div>
  )
}
